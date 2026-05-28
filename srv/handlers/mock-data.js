const cds = require('@sap/cds');
const crypto = require('crypto');
const { ingestPayload } = require('./ingestion');

function pick(items, index) {
  return items[index % items.length];
}

function dayIso(offsetDays, minuteOffset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  date.setUTCMinutes(date.getUTCMinutes() + minuteOffset);
  return date.toISOString();
}

function dateOnly(offsetDays) {
  return dayIso(offsetDays).slice(0, 10);
}

function deterministicNoise(seed, amplitude) {
  const x = Math.sin(seed * 999) * 10000;
  return (x - Math.floor(x) - 0.5) * amplitude * 2;
}

async function seedDemoData(tx, options = {}) {
  const days = Math.max(7, Math.min(120, Number(options.days) || 45));
  const storeLimit = Math.max(1, Math.min(20, Number(options.stores) || 20));
  const anomalyRate = Math.max(0.02, Math.min(0.35, Number(options.anomalyRate) || 0.12));
  const entities = cds.entities('freshchain');
  const { Stores, Zones, Products, Batches, InventoryPlacements, SalesObservations, MLDatasets } = entities;
  const [allStores, allZones, products] = await Promise.all([
    tx.run(SELECT.from(Stores).where({ active: true })),
    tx.run(SELECT.from(Zones).where({ active: true })),
    tx.run(SELECT.from(Products))
  ]);
  const stores = allStores.slice(0, storeLimit);
  const storeIds = new Set(stores.map(row => row.ID));
  const zones = allZones.filter(row => storeIds.has(row.store_ID));

  let salesCount = 0;
  for (let d = -days; d <= 0; d += 1) {
    for (let s = 0; s < stores.length; s += 1) {
      for (let p = 0; p < products.length; p += 1) {
        const product = products[p];
        const weekendLift = [0, 6].includes(new Date(dateOnly(d)).getUTCDay()) ? 1.18 : 1;
        const promo = (Math.abs(d) + p + s) % 13 === 0;
        const categoryBase = product.category === 'MEAT' ? 9 : product.category === 'PRODUCE' ? 16 : 22;
        const unitsSold = Math.max(1, Math.round(categoryBase * weekendLift * (promo ? 1.35 : 1) + deterministicNoise(d * 17 + p * 5 + s, 4)));
        const unitsWasted = Math.max(0, Math.round(unitsSold * (0.025 + (p === 3 ? 0.04 : 0.015) + Math.max(0, deterministicNoise(d + p, 0.02)))));
        await tx.run(INSERT.into(SalesObservations).entries({
          store_ID: stores[s].ID,
          product_ID: product.ID,
          businessDate: dateOnly(d),
          unitsSold,
          unitsWasted,
          averagePrice: product.category === 'MEAT' ? 9.99 : product.category === 'DAIRY' ? 2.49 : 3.99,
          promotionActive: promo,
          weatherCode: d % 9 === 0 ? 'HOT' : d % 11 === 0 ? 'RAIN' : 'NORMAL'
        }));
        salesCount += 1;
      }
    }
  }

  const existingBatches = await tx.run(SELECT.from(Batches));
  if (!existingBatches.length) {
    for (let p = 0; p < products.length; p += 1) {
      const product = products[p];
      await tx.run(INSERT.into(Batches).entries({
        product_ID: product.ID,
        batchNumber: `MOCK-${product.sku}-001`,
        productionDate: dateOnly(-6),
        packingDate: dateOnly(-5),
        bestBeforeDate: dateOnly(Number(product.standardShelfLifeDays) || 7),
        receivedAt: dayIso(-4)
      }));
    }
  }

  const batches = await tx.run(SELECT.from(Batches));
  const placements = await tx.run(SELECT.from(InventoryPlacements).where({ active: true }));
  if (!placements.length) {
    for (let z = 0; z < zones.length; z += 1) {
      const batch = pick(batches, z);
      await tx.run(INSERT.into(InventoryPlacements).entries({
        batch_ID: batch.ID,
        zone_ID: zones[z].ID,
        placedAt: dayIso(-3),
        quantity: 35 + z * 8,
        unit: 'EA',
        active: true
      }));
    }
  }

  let readingCount = 0;
  let incidentCount = 0;
  const scenarioCounts = {};
  const scenarios = ['TEMPERATURE_EXCURSION', 'DOOR_LEFT_OPEN', 'COMPRESSOR_FAILURE', 'DEMAND_SPIKE', 'WASTE_RISK', 'STALE_SENSOR'];
  for (let d = -Math.min(days, 6); d <= 0; d += 1) {
    for (let z = 0; z < zones.length; z += 1) {
      const zone = zones[z];
      const store = stores.find(row => row.ID === zone.store_ID) || stores[0];
      for (let t = 0; t < 4; t += 1) {
        const anomaly = ((Math.abs(d) * 7 + z * 3 + t) % Math.round(1 / anomalyRate)) === 0;
        const scenario = anomaly ? pick(scenarios, Math.abs(d) + z + t) : 'NORMAL';
        const tempBase = (Number(zone.safeTempMinC) + Number(zone.safeTempMaxC)) / 2;
        const measuredAt = dayIso(d, t * 180);
        const temp = scenario === 'COMPRESSOR_FAILURE'
          ? Number(zone.safeTempMaxC) + 7 + t
          : scenario === 'TEMPERATURE_EXCURSION' || scenario === 'DOOR_LEFT_OPEN' || scenario === 'WASTE_RISK'
            ? Number(zone.safeTempMaxC) + 2.5 + t
            : tempBase + deterministicNoise(d * 31 + z * 11 + t, 0.7);
        if (anomaly) incidentCount += 1;
        scenarioCounts[scenario] = (scenarioCounts[scenario] || 0) + 1;
        await ingestPayload(tx, {
          schemaVersion: '1.0',
          messageId: `MOCK-${zone.zoneCode}-${measuredAt}`,
          correlationId: `${store.storeCode}-${zone.zoneCode}-${measuredAt}`,
          eventType: 'SensorReadingCreated',
          storeId: store.storeCode,
          zoneId: zone.zoneCode,
          sensorId: `MOCK_SENSOR_${zone.zoneCode}`,
          measuredAt,
          publishedAt: measuredAt,
          readings: {
            temperatureC: Math.round(temp * 10) / 10,
            humidityPct: Math.round(((Number(zone.safeHumidityMin) + Number(zone.safeHumidityMax)) / 2 + deterministicNoise(d + z + t, 4)) * 10) / 10,
            co2Ppm: anomaly ? 1100 + t * 80 : 780 + t * 15,
            oxygenPct: anomaly ? 20.1 - t * 0.2 : 20.7,
            lightLux: scenario === 'DOOR_LEFT_OPEN' ? 420 : anomaly ? 260 : 95,
            doorOpen: scenario === 'DOOR_LEFT_OPEN' || (anomaly && t > 1)
          },
          quality: {
            batteryPct: scenario === 'STALE_SENSOR' ? 14 : 88,
            signalStrength: scenario === 'STALE_SENSOR' ? -83 : -45,
            sensorHealth: scenario === 'STALE_SENSOR' ? 'STALE' : 'OK'
          },
          scenarioCode: scenario
        }, { sourceQueue: 'mock.generator' });
        readingCount += 1;
      }
    }
  }

  const datasetCode = `mock-${Date.now()}`;
  await tx.run(INSERT.into(MLDatasets).entries({
    datasetCode,
    description: 'Generated FreshChain historical sensor, sales, waste, and incident data',
    source: 'CAP_MOCK_GENERATOR',
    storeCount: stores.length,
    zoneCount: zones.length,
    readingCount,
    salesCount,
    incidentCount,
    historyDays: days,
    anomalyRate,
    generatedAt: new Date().toISOString(),
    parameters: JSON.stringify({ ...options, scenarios: scenarioCounts, generatorVersion: '1.1.0' })
  }));

  return {
    datasetCode,
    storeCount: stores.length,
    zoneCount: zones.length,
    productCount: products.length,
    readingCount,
    salesCount,
    incidentCount,
    scenarioCounts,
    runId: crypto.randomUUID()
  };
}

module.exports = {
  seedDemoData
};

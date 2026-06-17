const cds = require('@sap/cds');
const crypto = require('crypto');
const { ingestPayload, recordIngestionError } = require('./handlers/ingestion');
const { scoreLatest } = require('./handlers/ml-engine');
const {
  readZoneOccupancy,
  stockAtRiskForZone,
  recordPotentialImpact,
  completeRescueImpact,
  criticalityForStatus,
  activeImpactSettings
} = require('./handlers/stock-ledger');
const {
  acknowledgeAlert,
  assignAlert,
  reopenAlert,
  resolveAlert
} = require('./handlers/alert-workflow');

const SENSOR_TOPIC = 'freshchain/sensor/reading/created';
const SCENARIOS = [
  'NORMAL',
  'DOOR_LEFT_OPEN',
  'TEMPERATURE_EXCURSION',
  'COMPRESSOR_FAILURE',
  'DEMAND_SPIKE',
  'WASTE_RISK'
];

const runState = {
  ID: 'current',
  status: 'STOPPED',
  startedAt: null,
  stoppedAt: null,
  lastTickAt: null,
  lastMessageId: null,
  lastScenario: null,
  message: 'Live demo is stopped. Start it before creating demo events.'
};

let messagingPromise;
let subscribed = false;
let dynamicTileKpiReadPromise;
const ACTION_BRIEF_PROMPT_VERSION = 'freshchain-brief-v2';
const DEFAULT_GENAI_MODEL = 'gpt-4.1-mini';

function parseJson(value, defaultValue = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return defaultValue;
  }
}

function redact(value, maxLength = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function firstText(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function envText(name, defaultValue = null) {
  return firstText(process.env[name], defaultValue);
}

function serviceBindingsFromEnv() {
  const services = parseJson(envText('VCAP_SERVICES', '{}'), {}) || {};
  return Object.values(services).flat();
}

function serviceBindingLabel(service) {
  return `${service.label || ''} ${service.name || ''} ${(service.tags || []).join(' ')}`;
}

function counted(rows) {
  if (Array.isArray(rows)) rows.$count = rows.length;
  return rows;
}

function hasMessagingBinding() {
  return serviceBindingsFromEnv().some(service => (
    /enterprise-messaging|event mesh|messaging/i.test(serviceBindingLabel(service))
      && service.credentials
      && (service.credentials.httprest || service.credentials.messaging || service.credentials.uaa)
  ));
}

function isoNow() {
  return new Date().toISOString();
}

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function compactNumber(value) {
  const number = numeric(value);
  const abs = Math.abs(number);
  if (abs >= 1000000) return String(Math.round(number / 1000000));
  if (abs >= 1000) return number >= 10000
    ? String(Math.round(number / 1000))
    : (number / 1000).toFixed(1).replace(/\.0$/, '');
  return String(Math.round(number));
}

function currencyUnit(value) {
  const abs = Math.abs(numeric(value));
  if (abs >= 1000000) return 'ZAR m';
  if (abs >= 1000) return 'ZAR k';
  return 'ZAR';
}

function tileStateFromCriticality(criticality) {
  return criticality === 1 ? 'Error'
    : criticality === 2 ? 'Warning'
      : criticality === 3 ? 'Good'
        : 'Neutral';
}

function stateRow(message) {
  if (message) runState.message = message;
  return { ...runState };
}

async function messaging() {
  if (!messagingPromise) {
    messagingPromise = cds.connect.to('messaging').catch((error) => {
      messagingPromise = null;
      cds.log('live-demo').warn(`Event Mesh unavailable: ${error.message}`);
      throw error;
    });
  }
  return messagingPromise;
}

async function subscribeMessaging() {
  if (subscribed) return;
  const bus = await messaging();
  if (!bus || typeof bus.on !== 'function') {
    throw new Error('Configured messaging service does not support subscriptions');
  }
  bus.on(SENSOR_TOPIC, async (msg) => {
    const payload = msg && msg.data ? msg.data : msg;
    await processPayload(payload).catch((error) => {
      cds.log('live-demo').error(`Live event processing failed: ${error.message}`);
    });
  });
  subscribed = true;
}

async function withTimeout(promise, milliseconds, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function noise(seed, amplitude) {
  const value = Math.sin(seed * 9173) * 10000;
  return (value - Math.floor(value) - 0.5) * amplitude * 2;
}

async function assertLiveFoundationReady(tx) {
  const { Stores, Zones, Products, InventoryPlacements, StockLots } = cds.entities('freshchain');
  const [store, zone, product, placement, stockLot] = await Promise.all([
    tx.run(SELECT.one.from(Stores).where({ active: true })),
    tx.run(SELECT.one.from(Zones).where({ active: true })),
    tx.run(SELECT.one.from(Products)),
    tx.run(SELECT.one.from(InventoryPlacements).where({ active: true })),
    tx.run(SELECT.one.from(StockLots).where({ status: { in: ['AVAILABLE', 'RESERVED', 'MARKDOWN'] } }))
  ]);
  if (!store || !zone || !product || !placement || !stockLot) {
    throw Object.assign(
      new Error('FreshChain live proof requires maintained stores, zones, products, inventory placements, and stock lots before simulating readings. Open FreshChain Configure and Stock Ledger first.'),
      { statusCode: 409 }
    );
  }
  await activeImpactSettings(tx);
}

async function pickZone(tx) {
  const { Zones, Stores, InventoryPlacements, StockLots } = cds.entities('freshchain');
  await assertLiveFoundationReady(tx);
  const stockedLots = await tx.run(SELECT.from(StockLots).columns('zone_ID').where({ status: { in: ['AVAILABLE', 'RESERVED', 'MARKDOWN'] } }));
  const stockedZoneIds = [...new Set(stockedLots.map(row => row.zone_ID).filter(Boolean))];
  const zones = stockedZoneIds.length
    ? await tx.run(SELECT.from(Zones).where({ active: true, ID: { in: stockedZoneIds } }).orderBy('modifiedAt desc').limit(20))
    : await tx.run(SELECT.from(Zones).where({ active: true }).orderBy('modifiedAt desc').limit(20));
  if (!zones.length) throw new Error('No active FreshChain zones are available for live demo generation');

  const readingCount = await tx.run(SELECT.one`count(*) as count`.from(cds.entities('freshchain').SensorReadings));
  const zone = zones[Number(readingCount && readingCount.count || 0) % zones.length];
  const store = await tx.run(SELECT.one.from(Stores).where({ ID: zone.store_ID }));
  const placement = await tx.run(SELECT.one.from(InventoryPlacements).where({ zone_ID: zone.ID, active: true }).orderBy('placedAt desc'));
  return { zone, store, placement };
}

function readingForScenario(zone, scenario, tick) {
  const minTemp = Number(zone.safeTempMinC);
  const maxTemp = Number(zone.safeTempMaxC);
  const minHumidity = Number(zone.safeHumidityMin || 70);
  const maxHumidity = Number(zone.safeHumidityMax || 92);
  const midpoint = (minTemp + maxTemp) / 2;
  const humidityMidpoint = (minHumidity + maxHumidity) / 2;

  const profile = {
    NORMAL: {
      temperatureC: midpoint + noise(tick, 0.35),
      humidityPct: humidityMidpoint + noise(tick + 10, 2),
      co2Ppm: 760 + tick % 80,
      oxygenPct: 20.7,
      lightLux: 85,
      doorOpen: false,
      sensorHealth: 'OK',
      batteryPct: 91
    },
    DOOR_LEFT_OPEN: {
      temperatureC: maxTemp + 2.2 + noise(tick, 0.4),
      humidityPct: Math.min(98, maxHumidity + 4 + noise(tick, 1.2)),
      co2Ppm: 1180,
      oxygenPct: 20.1,
      lightLux: 520,
      doorOpen: true,
      sensorHealth: 'OK',
      batteryPct: 84
    },
    TEMPERATURE_EXCURSION: {
      temperatureC: maxTemp + 4.8 + noise(tick, 0.6),
      humidityPct: maxHumidity + 1,
      co2Ppm: 1320,
      oxygenPct: 20.0,
      lightLux: 180,
      doorOpen: false,
      sensorHealth: 'OK',
      batteryPct: 87
    },
    COMPRESSOR_FAILURE: {
      temperatureC: maxTemp + 8.2 + noise(tick, 0.8),
      humidityPct: Math.min(99, maxHumidity + 7),
      co2Ppm: 1580,
      oxygenPct: 19.6,
      lightLux: 140,
      doorOpen: false,
      sensorHealth: 'WARN',
      batteryPct: 73
    },
    DEMAND_SPIKE: {
      temperatureC: maxTemp + 1.5,
      humidityPct: humidityMidpoint + 3,
      co2Ppm: 1050,
      oxygenPct: 20.2,
      lightLux: 260,
      doorOpen: true,
      sensorHealth: 'OK',
      batteryPct: 88
    },
    WASTE_RISK: {
      temperatureC: maxTemp + 3.1,
      humidityPct: Math.min(97, maxHumidity + 5),
      co2Ppm: 1460,
      oxygenPct: 19.8,
      lightLux: 160,
      doorOpen: false,
      sensorHealth: 'OK',
      batteryPct: 82
    }
  }[scenario];

  return Object.fromEntries(Object.entries(profile).map(([key, value]) => (
    typeof value === 'number' ? [key, Math.round(value * 10) / 10] : [key, value]
  )));
}

async function generatePayload(tx) {
  const tick = Date.now();
  const { zone, store } = await pickZone(tx);
  const readingCount = await tx.run(SELECT.one`count(*) as count`.from(cds.entities('freshchain').SensorReadings));
  const scenario = SCENARIOS[Number(readingCount && readingCount.count || 0) % SCENARIOS.length];
  const reading = readingForScenario(zone, scenario, tick);
  const timestamp = isoNow();
  const messageId = `LIVE-${zone.zoneCode}-${tick}-${crypto.randomUUID().slice(0, 8)}`;

  return {
    schemaVersion: '1.0',
    messageId,
    correlationId: `LIVE-${store.storeCode}-${zone.zoneCode}-${timestamp}`,
    eventType: 'SensorReadingCreated',
    storeId: store.storeCode,
    zoneId: zone.zoneCode,
    sensorId: `LIVE_SENSOR_${zone.zoneCode}`,
    measuredAt: timestamp,
    publishedAt: timestamp,
    readings: {
      temperatureC: reading.temperatureC,
      humidityPct: reading.humidityPct,
      co2Ppm: reading.co2Ppm,
      oxygenPct: reading.oxygenPct,
      lightLux: reading.lightLux,
      doorOpen: reading.doorOpen
    },
    quality: {
      batteryPct: reading.batteryPct,
      signalStrength: reading.sensorHealth === 'WARN' ? -68 : -45,
      sensorHealth: reading.sensorHealth
    },
    scenarioCode: scenario
  };
}

async function generateRescuePayload(tx) {
  const tick = Date.now();
  const { zone, store } = await pickZone(tx);
  const reading = readingForScenario(zone, 'COMPRESSOR_FAILURE', tick);
  const timestamp = isoNow();
  const messageId = `RESCUE-${zone.zoneCode}-${tick}-${crypto.randomUUID().slice(0, 8)}`;

  return {
    schemaVersion: '1.0',
    messageId,
    correlationId: `RESCUE-${store.storeCode}-${zone.zoneCode}-${timestamp}`,
    eventType: 'SensorReadingCreated',
    storeId: store.storeCode,
    zoneId: zone.zoneCode,
    sensorId: `RESCUE_SENSOR_${zone.zoneCode}`,
    measuredAt: timestamp,
    publishedAt: timestamp,
    readings: {
      temperatureC: reading.temperatureC,
      humidityPct: reading.humidityPct,
      co2Ppm: reading.co2Ppm,
      oxygenPct: reading.oxygenPct,
      lightLux: reading.lightLux,
      doorOpen: reading.doorOpen
    },
    quality: {
      batteryPct: reading.batteryPct,
      signalStrength: -71,
      sensorHealth: reading.sensorHealth
    },
    scenarioCode: 'COMPRESSOR_FAILURE'
  };
}

async function processPayload(payload) {
  return cds.tx(async (tx) => {
    try {
      const ingestion = await ingestPayload(tx, payload, { sourceQueue: SENSOR_TOPIC });
      const { SensorReadings } = cds.entities('freshchain');
      const reading = await tx.run(SELECT.one.from(SensorReadings).where({ ID: ingestion.readingId }));
      const scored = reading && await scoreLatest(tx, { zoneId: reading.zone_ID });
      const prediction = scored && !scored.failed ? scored : null;
      return {
        reading,
        prediction,
        ingestion,
        scoringFailed: scored && scored.failed,
        scoringError: scored && scored.failed && scored.error
      };
    } catch (error) {
      await recordIngestionError(tx, payload, error, SENSOR_TOPIC).catch(() => {});
      throw error;
    }
  });
}

async function liveReadingByMessageId(tx, sourceMessageId) {
  return readLiveSensorEvents(tx, { sourceMessageId, one: true });
}

async function latestRiskDecision(tx) {
  return readRiskDecisions(tx, { one: true });
}

function requestKey(req) {
  const key = req.params && req.params.find(param => param !== undefined);
  return key && typeof key === 'object' ? key.ID : key;
}

function riskCriticality(riskLevel) {
  return riskLevel === 'CRITICAL' ? 1
    : riskLevel === 'HIGH' ? 2
      : riskLevel === 'MEDIUM' ? 3
        : 0;
}

function statusCriticality(status) {
  return ['OPEN', 'REOPENED'].includes(status) ? 1
    : ['ACKNOWLEDGED', 'ASSIGNED'].includes(status) ? 2
      : status === 'RESOLVED' ? 3
        : 0;
}

function workflowCriticality(scenario) {
  if (Number.isInteger(scenario.criticality)) return scenario.criticality;
  return riskCriticality(scenario.riskLevel);
}

async function readLiveSensorEvents(tx, options = {}) {
  const { SensorReadings } = cds.entities('freshchain');
  const columns = [
    'ID',
    'measuredAt',
    'publishedAt',
    'store.storeCode as storeCode',
    'zone.zoneCode as zoneCode',
    'sensor.sensorId as sensorId',
    'temperatureC',
    'humidityPct',
    'doorOpen',
    'sensorHealth',
    'scenarioCode',
    'sourceMessageId'
  ];
  const query = options.one
    ? SELECT.one.from(SensorReadings).columns(...columns).orderBy('measuredAt desc')
    : SELECT.from(SensorReadings).columns(...columns).orderBy('measuredAt desc').limit(options.limit || 100);
  if (options.ID) query.where({ ID: options.ID });
  if (options.sourceMessageId) query.where({ sourceMessageId: options.sourceMessageId });
  return tx.run(query);
}

async function readRiskDecisions(tx, options = {}) {
  const { Predictions } = cds.entities('freshchain');
  const columns = [
    'ID',
    'createdAt',
    'modelName',
    'modelVersion',
    'deploymentId',
    'store.storeCode as storeCode',
    'zone.zoneCode as zoneCode',
    'predictionType',
    'riskLevel',
    'score',
    'confidence',
    'anomalyType',
    'remainingShelfLifeDays',
    'demandUnitsForecast',
    'replenishmentUnits',
    'routePriority',
    'recommendedAction',
    'aiCoreUnavailable',
    'modelUnavailableReason'
  ];
  const query = options.one
    ? SELECT.one.from(Predictions).columns(...columns).orderBy('createdAt desc')
    : SELECT.from(Predictions).columns(...columns).orderBy('createdAt desc').limit(options.limit || 100);
  if (options.ID) query.where({ ID: options.ID });
  const result = await tx.run(query);
  const decorate = row => row && ({ ...row, criticality: riskCriticality(row.riskLevel) });
  return Array.isArray(result) ? result.map(decorate) : decorate(result);
}

async function readSpoilageInterventions(tx, options = {}) {
  const { Alerts } = cds.entities('freshchain');
  const columns = [
    'ID',
    'createdAt',
    'modifiedAt',
    'store.storeCode as storeCode',
    'zone.zoneCode as zoneCode',
    'prediction.ID as prediction_ID',
    'severity',
    'status',
    'alertType',
    'title',
    'recommendation',
    'assignedTo',
    'outcome'
  ];
  const query = options.one
    ? SELECT.one.from(Alerts).columns(...columns).orderBy('createdAt desc')
    : SELECT.from(Alerts).columns(...columns).orderBy('createdAt desc').limit(options.limit || 100);
  if (options.ID) query.where({ ID: options.ID });
  return tx.run(query);
}

async function readRiskByZone(tx) {
  const { Predictions, Alerts } = cds.entities('freshchain');
  const predictions = await tx.run(SELECT.from(Predictions).columns(
    'ID',
    'createdAt',
    'zone.zoneCode as zoneCode',
    'store.storeCode as storeCode',
    'riskLevel',
    'score'
  ).orderBy('createdAt desc').limit(250));
  const latestByZone = new Map();
  for (const row of predictions) {
    if (row.zoneCode && !latestByZone.has(row.zoneCode)) latestByZone.set(row.zoneCode, row);
  }
  const alerts = await tx.run(SELECT.from(Alerts).columns(
    'zone.zoneCode as zoneCode',
    'severity',
    'status'
  ).where({ status: { in: ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'REOPENED'] } }));
  const alertCounts = new Map();
  for (const alert of alerts) {
    const count = alertCounts.get(alert.zoneCode) || 0;
    alertCounts.set(alert.zoneCode, count + 1);
  }
  return [...latestByZone.values()].map(row => ({
    ID: row.zoneCode,
    zoneCode: row.zoneCode,
    storeCode: row.storeCode,
    riskLevel: row.riskLevel,
    riskScore: Number(row.score || 0),
    openAlerts: alertCounts.get(row.zoneCode) || 0,
    criticality: riskCriticality(row.riskLevel)
  }));
}

async function readScenarioMix(tx) {
  const { SensorReadings } = cds.entities('freshchain');
  const rows = await tx.run(SELECT.from(SensorReadings).columns('scenarioCode').orderBy('measuredAt desc').limit(500));
  const counts = new Map();
  for (const row of rows) {
    const scenario = row.scenarioCode || 'UNKNOWN';
    counts.set(scenario, (counts.get(scenario) || 0) + 1);
  }
  const total = rows.length || 1;
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([scenarioCode, readingCount]) => ({
    scenarioCode,
    readingCount,
    sharePct: Math.round((readingCount / total) * 10000) / 100,
    criticality: scenarioCode === 'NORMAL' ? 3 : scenarioCode === 'DEMAND_SPIKE' ? 2 : 1
  }));
}

async function readInterventionStatusMix(tx) {
  const { Alerts } = cds.entities('freshchain');
  const rows = await tx.run(SELECT.from(Alerts).columns('status').limit(1000));
  const counts = new Map();
  for (const row of rows) {
    const status = row.status || 'UNKNOWN';
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([status, alertCount]) => ({
    status,
    alertCount,
    criticality: statusCriticality(status)
  }));
}

async function productNameForScenario(tx, zoneCode) {
  const { StockLots, Products, Zones } = cds.entities('freshchain');
  const zone = zoneCode && await tx.run(SELECT.one.from(Zones).columns('ID').where({ zoneCode }));
  const where = zone
    ? { zone_ID: zone.ID, status: { in: ['AVAILABLE', 'RESERVED', 'MARKDOWN'] } }
    : { status: { in: ['AVAILABLE', 'RESERVED', 'MARKDOWN'] } };
  const lot = await tx.run(SELECT.one.from(StockLots).columns('product_ID').where(where).orderBy('lastMovementAt desc'));
  if (!lot || !lot.product_ID) return `${zoneCode} chilled stock`;
  const product = await tx.run(SELECT.one.from(Products).columns('name').where({ ID: lot.product_ID }));
  return product && product.name || `${zoneCode} chilled stock`;
}

function joinValues(values) {
  return (values || []).filter(Boolean).join(', ');
}

function splitValues(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function scenarioRecord(scenario) {
  return {
    ID: scenario.ID,
    status: scenario.status,
    headline: scenario.headline,
    store_ID: scenario.store_ID || null,
    zone_ID: scenario.zone_ID || null,
    product_ID: scenario.product_ID || null,
    prediction_ID: scenario.prediction_ID || null,
    affectedLotIDs: joinValues(scenario.affectedLotIDs),
    affectedLotNumbers: joinValues(scenario.affectedLotNumbers),
    storeCode: scenario.storeCode,
    zoneCode: scenario.zoneCode,
    productName: scenario.productName,
    affectedLotCount: scenario.affectedLotCount,
    affectedUnits: scenario.affectedUnits,
    riskLevel: scenario.riskLevel,
    riskScore: scenario.riskScore,
    confidence: scenario.confidence,
    spoilageProbability: scenario.spoilageProbability,
    shelfLifeHoursRemaining: scenario.shelfLifeHoursRemaining,
    businessValueAtRiskZar: scenario.businessValueAtRiskZar,
    potentialProtectedRevenueZar: scenario.potentialProtectedRevenueZar,
    protectedRevenueZar: scenario.protectedRevenueZar,
    expectedLossZar: scenario.expectedLossZar,
    salvageRate: scenario.salvageRate,
    wasteAvoidedUnits: scenario.wasteAvoidedUnits,
    lostSalesAvoidedUnits: scenario.lostSalesAvoidedUnits,
    responseSlaMinutes: scenario.responseSlaMinutes,
    processStatus: scenario.processStatus,
    actionBriefStatus: scenario.actionBriefStatus,
    nextBestAction: scenario.nextBestAction,
    managerMessage: scenario.managerMessage,
    aiCoreProof: scenario.aiCoreProof,
    bpaProof: scenario.bpaProof,
    calculationSummary: scenario.calculationSummary,
    criticality: scenario.criticality
  };
}

function inflateScenario(row) {
  if (!row) return null;
  return {
    ...row,
    affectedLotIDs: splitValues(row.affectedLotIDs),
    affectedLotNumbers: splitValues(row.affectedLotNumbers)
  };
}

async function writeRescueScenario(tx, scenario) {
  const { RescueScenarios } = cds.entities('freshchain');
  const entry = scenarioRecord(scenario);
  const existing = await tx.run(SELECT.one.from(RescueScenarios).where({ ID: scenario.ID }));
  if (existing) await tx.run(UPDATE(RescueScenarios).set(entry).where({ ID: scenario.ID }));
  else await tx.run(INSERT.into(RescueScenarios).entries(entry));
  return inflateScenario(await tx.run(SELECT.one.from(RescueScenarios).where({ ID: scenario.ID })));
}

async function latestRescueScenario(tx) {
  const { RescueScenarios } = cds.entities('freshchain');
  return inflateScenario(await tx.run(SELECT.one.from(RescueScenarios).orderBy('createdAt desc')));
}

async function readCurrentRescueScenarios(tx) {
  const scenario = await latestRescueScenario(tx);
  return scenario ? [{
    ID: scenario.ID,
    generatedAt: scenario.createdAt,
    headline: scenario.headline,
    riskLevel: scenario.riskLevel,
    potentialProtectedRevenueZar: scenario.potentialProtectedRevenueZar,
    nextBestAction: scenario.nextBestAction,
    criticality: scenario.criticality
  }] : [];
}

async function rescueScenarioById(tx, scenarioID) {
  const { RescueScenarios } = cds.entities('freshchain');
  return inflateScenario(await tx.run(SELECT.one.from(RescueScenarios).where({ ID: scenarioID })));
}

async function updateRescueScenario(tx, scenarioID, values) {
  const { RescueScenarios } = cds.entities('freshchain');
  await tx.run(UPDATE(RescueScenarios).set(values).where({ ID: scenarioID }));
  return rescueScenarioById(tx, scenarioID);
}

async function buildScenario(tx, result, inputProductName) {
  const prediction = result.prediction;
  const reading = result.reading || {};
  if (!prediction || !prediction.ID || prediction.aiCoreUnavailable) {
    throw Object.assign(new Error('A successful SAP AI Core prediction is required before creating rescue proof'), { statusCode: 409 });
  }
  const { Zones, Stores } = cds.entities('freshchain');
  const zone = await tx.run(SELECT.one.from(Zones).where({ zoneCode: prediction.zoneCode || reading.zoneCode }));
  if (!zone) throw Object.assign(new Error('The AI Core prediction is not linked to a maintained zone'), { statusCode: 409 });
  const store = zone && await tx.run(SELECT.one.from(Stores).where({ ID: zone.store_ID }));
  const financials = await stockAtRiskForZone(tx, zone.ID, prediction);
  const productName = financials.productName || inputProductName;
  const shelfLifeHoursRemaining = Math.max(0, Math.round(Number(prediction.remainingShelfLifeDays) * 24 * 10) / 10);
  const scenario = {
    ID: `SCN-${Date.now()}`,
    status: 'ACTION_REQUIRED',
    headline: `${prediction.riskLevel} spoilage risk: rescue ${productName} before the next trading window`,
    store_ID: store && store.ID,
    zone_ID: zone && zone.ID,
    product_ID: financials.lots && financials.lots[0] && financials.lots[0].product_ID,
    prediction_ID: prediction.ID,
    affectedLotIDs: financials.lotIds,
    affectedLotNumbers: financials.lots.map(lot => lot.lotNumber).filter(Boolean),
    storeCode: prediction.storeCode || reading.storeCode || store && store.storeCode,
    zoneCode: prediction.zoneCode || reading.zoneCode || zone && zone.zoneCode,
    productName,
    affectedLotCount: financials.lotCount,
    affectedUnits: financials.affectedUnits,
    riskLevel: prediction.riskLevel,
    riskScore: Number(prediction.score),
    confidence: Number(prediction.confidence),
    spoilageProbability: financials.spoilageProbability,
    shelfLifeHoursRemaining,
    businessValueAtRiskZar: financials.stockValueAtRiskZar,
    potentialProtectedRevenueZar: financials.potentialProtectedRevenueZar,
    protectedRevenueZar: 0,
    expectedLossZar: financials.expectedLossZar,
    salvageRate: financials.salvageRate,
    wasteAvoidedUnits: financials.wasteAvoidedUnits,
    lostSalesAvoidedUnits: financials.lostSalesAvoidedUnits,
    responseSlaMinutes: financials.responseSlaMinutes,
    processStatus: 'WAITING_FOR_WORKFLOW',
    actionBriefStatus: 'WAITING_FOR_BRIEF',
    nextBestAction: prediction.recommendedAction || 'Move affected stock to a safe zone, inspect compressor status, and markdown items at risk.',
    managerMessage: 'Action brief not generated yet.',
    aiCoreProof: `SAP AI Core scored the latest reading through deployment ${prediction.deploymentId}.`,
    bpaProof: 'FreshChain in-app rescue workflow not started yet.',
    calculationSummary: financials.calculationSummary,
    criticality: riskCriticality(prediction.riskLevel)
  };
  await recordPotentialImpact(tx, scenario, prediction);
  return writeRescueScenario(tx, scenario);
}

function aiCoreCredentials() {
  return serviceBindingsFromEnv().find(service => (
    /aicore|ai-core|SAP AI Core/i.test(serviceBindingLabel(service)) && service.credentials
  ))?.credentials || null;
}

function aiCoreTokenConfig() {
  const credentials = aiCoreCredentials();
  if (!credentials) return null;
  const uaa = credentials.uaa || credentials.oauth || {};
  const serviceUrls = credentials.serviceurls || credentials.serviceUrls || {};
  const apiUrl = firstText(
    credentials.AI_API_URL,
    credentials.ai_api_url,
    credentials.apiurl,
    serviceUrls.AI_API_URL,
    serviceUrls.ai_api_url,
    serviceUrls.apiurl
  );
  const tokenUrl = firstText(
    credentials.tokenurl,
    credentials.tokenUrl,
    uaa.url && `${String(uaa.url).replace(/\/+$/, '')}/oauth/token`,
    credentials.url && /\/oauth\/token(?:$|\?)/.test(credentials.url)
      ? credentials.url
      : credentials.url && `${String(credentials.url).replace(/\/+$/, '')}/oauth/token`
  );
  const clientId = firstText(credentials.clientid, credentials.clientId, uaa.clientid, uaa.clientId);
  const clientSecret = firstText(credentials.clientsecret, credentials.clientSecret, uaa.clientsecret, uaa.clientSecret);
  return apiUrl && tokenUrl && clientId && clientSecret
    ? { apiUrl: String(apiUrl).replace(/\/+$/, ''), tokenUrl, clientId, clientSecret }
    : null;
}

async function aiCoreAccessToken() {
  const config = aiCoreTokenConfig();
  if (!config) throw new Error('SAP AI Core credentials are not available');
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  });
  const text = await response.text();
  const payload = parseJson(text, {});
  if (!response.ok || !payload.access_token) {
    throw new Error(`SAP AI Core token request failed with HTTP ${response.status}`);
  }
  return payload.access_token;
}

function aiCoreResourceGroup() {
  return envText('AICORE_RESOURCE_GROUP', 'freshchain-demo');
}

function aiCoreOrchestrationResourceGroup() {
  return envText('AICORE_ORCHESTRATION_RESOURCE_GROUP', 'default');
}

function genAiEndpoint() {
  return firstText(envText('FRESHCHAIN_GENAI_ENDPOINT'), envText('AICORE_ORCHESTRATION_ENDPOINT'));
}

function genAiModelName() {
  return envText('FRESHCHAIN_GENAI_MODEL', DEFAULT_GENAI_MODEL);
}

function hasGenAiConfiguration() {
  return Boolean(genAiEndpoint() || envText('AICORE_ORCHESTRATION_RESOURCE_GROUP'));
}

function managedBaseUrl() {
  return envText('FRESHCHAIN_MANAGED_BASE_URL');
}

function buildBriefPrompt(scenario) {
  return [
    'You are FreshChain, an SAP BTP spoilage-prevention assistant for South African grocery operations.',
    'Return strict JSON only with keys: actionSummary, managerNotification, auditSummary, customerSafeExplanation.',
    'Do not invent metrics. Use only the supplied values. Keep every value operational, concise, and demo-safe.',
    '',
    JSON.stringify({
      scenarioID: scenario.ID,
      storeCode: scenario.storeCode,
      zoneCode: scenario.zoneCode,
      productName: scenario.productName,
      riskLevel: scenario.riskLevel,
      riskScore: scenario.riskScore,
      confidence: scenario.confidence,
      shelfLifeHoursRemaining: scenario.shelfLifeHoursRemaining,
      protectedRevenueZar: scenario.protectedRevenueZar,
      potentialProtectedRevenueZar: scenario.potentialProtectedRevenueZar,
      stockValueAtRiskZar: scenario.businessValueAtRiskZar,
      affectedLots: scenario.affectedLotCount,
      affectedUnits: scenario.affectedUnits,
      expectedLossZar: scenario.expectedLossZar,
      salvageRate: scenario.salvageRate,
      wasteAvoidedUnits: scenario.wasteAvoidedUnits,
      lostSalesAvoidedUnits: scenario.lostSalesAvoidedUnits,
      requiredAction: scenario.nextBestAction,
      responseSlaMinutes: scenario.responseSlaMinutes
    })
  ].join('\n');
}

function normalizeGenAiResponse(payload) {
  const candidates = [
    payload?.orchestration_result?.choices?.[0]?.message?.content,
    payload?.module_results?.templating?.[0]?.content,
    payload?.choices?.[0]?.message?.content,
    payload?.choices?.[0]?.text,
    payload?.content,
    payload?.message
  ];
  const text = firstText(...candidates);
  if (!text) return {};
  const parsed = typeof text === 'string' ? parseGenAiText(text) : text;
  return parsed && typeof parsed === 'object' ? parsed : { actionSummary: String(text) };
}

function parseGenAiText(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return parseJson(cleaned, null);
}

function genAiBriefFromContent(scenario, content, metadata = {}) {
  const generated = typeof content === 'string'
    ? (parseGenAiText(content) || { actionSummary: content })
    : content || {};
  const generatedText = (name, fallback) => {
    const value = generated[name];
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return fallback;
    return redact(JSON.stringify(value), 500) || fallback;
  };
  return {
    ID: `BRIEF-${scenario.ID}`,
    scenario_ID: scenario.ID,
    generationMode: 'SAP AI Core Generative AI Hub',
    modelProvider: metadata.modelProvider || 'SAP AI Core Orchestration',
    modelName: metadata.modelName || genAiModelName(),
    generationLatencyMs: metadata.generationLatencyMs || 0,
    promptVersion: ACTION_BRIEF_PROMPT_VERSION,
    unavailableReason: null,
    title: `GenAI action brief: ${scenario.riskLevel} risk in ${scenario.zoneCode}`,
    actionSummary: generatedText('actionSummary', generatedText('storeAction', scenario.nextBestAction)),
    managerNotification: generatedText('managerNotification', `FreshChain detected ${scenario.riskLevel} spoilage risk in ${scenario.zoneCode}. Protect up to R ${Math.round(scenario.potentialProtectedRevenueZar || scenario.protectedRevenueZar).toLocaleString('en-ZA')} by moving stock now.`),
    auditSummary: generatedText('auditSummary', `AI Core risk ${scenario.riskScore} with confidence ${scenario.confidence}. Potential protected revenue R ${scenario.potentialProtectedRevenueZar}.`),
    customerSafeExplanation: generatedText('customerSafeExplanation', 'FreshChain is rotating stock early because telemetry showed a refrigeration risk.'),
    criticality: scenario.criticality
  };
}

function unavailableActionBrief(scenario, reason) {
  return {
    ID: `BRIEF-${scenario.ID}`,
    scenario_ID: scenario.ID,
    generationMode: 'UNAVAILABLE',
    modelProvider: 'SAP AI Core Orchestration',
    modelName: genAiModelName(),
    generationLatencyMs: 0,
    promptVersion: ACTION_BRIEF_PROMPT_VERSION,
    unavailableReason: redact(reason),
    title: `GenAI action brief unavailable for ${scenario.zoneCode}`,
    actionSummary: null,
    managerNotification: null,
    auditSummary: null,
    customerSafeExplanation: null,
    criticality: scenario.criticality
  };
}

async function callGenAiBrief(scenario) {
  const endpoint = genAiEndpoint();
  const startedAt = Date.now();
  const prompt = buildBriefPrompt(scenario);
  const modelName = genAiModelName();
  if (!endpoint) {
    const { OrchestrationClient } = await import('@sap-ai-sdk/orchestration');
    const client = new OrchestrationClient({
      promptTemplating: {
        model: {
          name: modelName,
          params: {
            temperature: 0.2,
            max_tokens: 500
          }
        }
      }
    }, { resourceGroup: aiCoreOrchestrationResourceGroup() });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await client.chatCompletion({
        messages: [
          { role: 'user', content: prompt }
        ]
      }, { signal: controller.signal });
      return genAiBriefFromContent(scenario, response.getContent(), {
        modelProvider: 'SAP AI Core Orchestration SDK',
        modelName,
        generationLatencyMs: Date.now() - startedAt
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  const token = await aiCoreAccessToken();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'AI-Resource-Group': aiCoreOrchestrationResourceGroup()
    },
    body: JSON.stringify({
      orchestration_config: {
        module_configurations: {
          templating_module_config: {
            template: [
              { role: 'user', content: prompt }
            ],
            defaults: {}
          },
          llm_module_config: {
            model_name: modelName,
            model_params: {
              temperature: 0.2,
              max_tokens: 500
            }
          }
        }
      },
      input_params: {}
    })
  });
  const text = await response.text();
  const payload = parseJson(text, { raw: text });
  if (!response.ok) {
    throw new Error(`SAP AI Core GenAI request failed with HTTP ${response.status}: ${redact(text)}`);
  }
  const generated = normalizeGenAiResponse(payload);
  return genAiBriefFromContent(scenario, generated, {
    modelProvider: 'SAP AI Core Orchestration',
    modelName,
    generationLatencyMs: Date.now() - startedAt,
  });
}

async function writeActionBrief(tx, brief) {
  const { ActionBriefs } = cds.entities('freshchain');
  const existing = await tx.run(SELECT.one.from(ActionBriefs).where({ ID: brief.ID }));
  if (existing) await tx.run(UPDATE(ActionBriefs).set(brief).where({ ID: brief.ID }));
  else await tx.run(INSERT.into(ActionBriefs).entries(brief));
  return tx.run(SELECT.one.from(ActionBriefs).where({ ID: brief.ID }));
}

async function buildActionBrief(tx, scenario) {
  let brief;
  try {
    brief = await withTimeout(callGenAiBrief(scenario), 8000, 'SAP AI Core GenAI request timed out');
  } catch (error) {
    cds.log('live-demo').warn(`GenAI brief unavailable: ${error.message}`);
    brief = unavailableActionBrief(scenario, error.message);
  }
  const stored = await writeActionBrief(tx, brief);
  await updateRescueScenario(tx, scenario.ID, {
    actionBriefStatus: stored.unavailableReason ? 'GENAI_UNAVAILABLE' : 'GENAI_GENERATED',
    managerMessage: stored.managerNotification,
    nextBestAction: stored.actionSummary || scenario.nextBestAction
  });
  return stored;
}

async function writeProcessTask(tx, task) {
  const { ProcessTasks } = cds.entities('freshchain');
  const existing = await tx.run(SELECT.one.from(ProcessTasks).where({ ID: task.ID }));
  if (existing) await tx.run(UPDATE(ProcessTasks).set(task).where({ ID: task.ID }));
  else await tx.run(INSERT.into(ProcessTasks).entries(task));
  return tx.run(SELECT.one.from(ProcessTasks).where({ ID: task.ID }));
}

async function readCurrentProcessTasks(tx) {
  const { ProcessTasks } = cds.entities('freshchain');
  const scenario = await latestRescueScenario(tx);
  const query = SELECT.from(ProcessTasks).columns(
    'ID',
    'createdAt',
    'scenario.ID as scenarioID',
    'taskTitle',
    'priority',
    'assignee',
    'dueInMinutes',
    'criticality'
  ).orderBy('createdAt desc').limit(2);

  if (scenario && scenario.ID) query.where({ scenario_ID: scenario.ID });
  return tx.run(query);
}

async function writeNotificationEvent(tx, notification) {
  const { NotificationEvents } = cds.entities('freshchain');
  const existing = await tx.run(SELECT.one.from(NotificationEvents).where({ ID: notification.ID }));
  if (existing) await tx.run(UPDATE(NotificationEvents).set(notification).where({ ID: notification.ID }));
  else await tx.run(INSERT.into(NotificationEvents).entries(notification));
  return tx.run(SELECT.one.from(NotificationEvents).where({ ID: notification.ID }));
}

async function buildProcessTask(tx, scenario) {
  const task = {
    ID: `TASK-${scenario.ID}`,
    scenario_ID: scenario.ID,
    processName: 'FreshChain Store Rescue Workflow',
    assignee: 'store.manager',
    status: 'READY',
    priority: scenario.riskLevel === 'CRITICAL' ? 'VERY_HIGH' : 'HIGH',
    dueInMinutes: scenario.responseSlaMinutes,
    taskTitle: `Rescue ${scenario.productName} in ${scenario.zoneCode}`,
    taskInstruction: scenario.nextBestAction,
    outcome: null,
    completedAt: null,
    bpaMode: 'FreshChain in-app workflow',
    bpaInstanceId: `WF-${scenario.ID}`,
    bpaProcessId: 'freshchain-store-rescue',
    bpaTriggerStatus: 'READY',
    bpaStartedAt: isoNow(),
    bpaTaskUrl: null,
    unavailableReason: null,
    criticality: workflowCriticality(scenario)
  };
  const storedTask = await writeProcessTask(tx, task);
  const notification = {
    ID: `NOTIF-${scenario.ID}`,
    scenario_ID: scenario.ID,
    channel: 'FreshChain Demo Notification',
    recipient: storedTask.assignee,
    subject: task.taskTitle,
    message: scenario.managerMessage,
    status: 'SENT',
    criticality: workflowCriticality(scenario)
  };
  await writeNotificationEvent(tx, notification);
  await updateRescueScenario(tx, scenario.ID, {
    processStatus: 'TASK_READY',
    bpaProof: `${storedTask.bpaMode} task ${storedTask.ID} is ready for ${storedTask.assignee}.`,
  });
  return storedTask;
}

async function completeTask(tx, req, taskID, outcome) {
  const { ProcessTasks } = cds.entities('freshchain');
  const task = await tx.run(SELECT.one.from(ProcessTasks).where({ ID: taskID }));
  if (!task) return null;
  if (task.status !== 'READY') {
    throw Object.assign(new Error(`Process task ${taskID} is ${task.status}; only READY tasks can be completed`), { statusCode: 409 });
  }
  if (!outcome) {
    throw Object.assign(new Error('Completion outcome is required for intervention proof'), { statusCode: 400 });
  }
  const performedBy = req.user && req.user.id;
  if (!performedBy) {
    throw Object.assign(new Error('Authenticated user is required to complete intervention proof'), { statusCode: 401 });
  }
  const scenario = await rescueScenarioById(tx, task.scenario_ID);
  if (!scenario) throw Object.assign(new Error(`Rescue scenario for task ${taskID} was not found`), { statusCode: 404 });
  const impact = await completeRescueImpact(tx, scenario, task, outcome, performedBy);
  const completed = {
    status: 'COMPLETED',
    outcome,
    completedAt: isoNow(),
    criticality: 3
  };
  await tx.run(UPDATE(ProcessTasks).set(completed).where({ ID: taskID }));
  await updateRescueScenario(tx, scenario.ID, {
    status: 'RESCUED',
    processStatus: 'COMPLETED',
    protectedRevenueZar: Number(impact.actualProtectedRevenueZar || 0),
    headline: `${Math.round(Number(impact.actualProtectedRevenueZar || 0)).toLocaleString('en-ZA')} ZAR protected by completing the spoilage rescue workflow`,
    bpaProof: `${task.bpaMode} task ${task.ID} completed by ${task.assignee}.`,
    calculationSummary: impact.calculationSummary || scenario.calculationSummary,
    criticality: 3
  });
  return tx.run(SELECT.one.from(ProcessTasks).where({ ID: taskID }));
}

async function readBusinessImpactSummary(tx) {
  const latestImpact = await readLatestPersistedImpact(tx);
  if (latestImpact) return [latestImpactToSummary(latestImpact)];
  return [emptyBusinessImpactSummary()];
}

async function readLatestPersistedImpact(tx) {
  const { InterventionImpacts } = cds.entities('freshchain');
  return tx.run(SELECT.one.from(InterventionImpacts).columns(
    '*',
    'store.storeCode as storeCode',
    'zone.zoneCode as zoneCode',
    'product.name as productName'
  ).orderBy('createdAt desc'));
}

function latestImpactToSummary(impact) {
  const actualProtectedRevenueZar = numeric(impact.actualProtectedRevenueZar);
  const confidencePct = Math.round(numeric(impact.confidence) * 100);
  return {
    ID: 'current',
    generatedAt: impact.completedAt || impact.modifiedAt || impact.createdAt || isoNow(),
    incidentStatus: impact.status || 'POTENTIAL',
    protectedRevenueZar: actualProtectedRevenueZar,
    potentialProtectedRevenueZar: numeric(impact.potentialProtectedRevenueZar),
    actualProtectedRevenueZar,
    stockValueAtRiskZar: numeric(impact.stockValueAtRiskZar),
    affectedLotCount: numeric(impact.lotCount),
    affectedUnits: numeric(impact.affectedUnits),
    expectedLossZar: numeric(impact.expectedLossZar),
    salvageRate: numeric(impact.salvageRate),
    wasteAvoidedUnits: numeric(impact.wasteAvoidedUnits),
    lostSalesAvoidedUnits: numeric(impact.lostSalesAvoidedUnits),
    responseSlaMinutes: numeric(impact.responseSlaMinutes),
    processCompletionPct: impact.status === 'ACTIONED' || impact.status === 'VERIFIED' ? 100 : impact.status === 'POTENTIAL' ? 25 : 0,
    confidencePct,
    executiveHeadline: impact.status === 'ACTIONED' || impact.status === 'VERIFIED'
      ? `${Math.round(actualProtectedRevenueZar).toLocaleString('en-ZA')} ZAR protected with movement evidence`
      : `${Math.round(numeric(impact.potentialProtectedRevenueZar)).toLocaleString('en-ZA')} ZAR potential protection awaiting store action`,
    criticality: criticalityForStatus(impact.status)
  };
}

function emptyBusinessImpactSummary() {
  return {
    ID: 'current',
    generatedAt: isoNow(),
    incidentStatus: 'AWAITING_LIVE_PROOF',
    protectedRevenueZar: 0,
    potentialProtectedRevenueZar: 0,
    actualProtectedRevenueZar: 0,
    stockValueAtRiskZar: 0,
    affectedLotCount: 0,
    affectedUnits: 0,
    expectedLossZar: 0,
    salvageRate: 0,
    wasteAvoidedUnits: 0,
    lostSalesAvoidedUnits: 0,
    responseSlaMinutes: 0,
    processCompletionPct: 0,
    confidencePct: 0,
    executiveHeadline: 'Awaiting live sensor reading, AI Core score, store action, and movement proof.',
    criticality: 0
  };
}

async function readDynamicTileKpis(tx) {
  const latestImpact = await readLatestPersistedImpact(tx);
  const summary = latestImpact ? latestImpactToSummary(latestImpact) : emptyBusinessImpactSummary();
  return buildDynamicTileKpis(summary, latestImpact);
}

async function readSharedDynamicTileKpis(tx) {
  dynamicTileKpiReadPromise ??= readDynamicTileKpis(tx).finally(() => {
    dynamicTileKpiReadPromise = null;
  });
  const rows = await dynamicTileKpiReadPromise;
  return rows.map(row => ({ ...row }));
}

function buildDynamicTileKpis(summary, latestImpact) {
  const zone = latestImpact && latestImpact.zoneCode || 'all zones';
  const store = latestImpact && latestImpact.storeCode || 'all stores';
  const product = latestImpact && latestImpact.productName || 'current stock';
  const status = summary.incidentStatus || 'READY';
  const updatedAt = summary.generatedAt || isoNow();
  const confidence = Math.round(numeric(summary.confidencePct));
  const state = tileStateFromCriticality(summary.criticality);
  const controlTowerUrl = '#FreshChainControlTower-display';
  const proveUrl = '#FreshChainProve-display';

  return [
    {
      ID: 'protectedRevenue',
      number: compactNumber(summary.protectedRevenueZar),
      numberUnit: currencyUnit(summary.protectedRevenueZar),
      state,
      numberState: state,
      info: `${confidence}% confidence`,
      infoState: state,
      title: 'Revenue Protected by Intervention',
      subtitle: `Live proof from ${zone}`,
      targetUrl: `${controlTowerUrl}?kpi=protected-revenue`,
      updatedAt
    },
    {
      ID: 'stockAtRisk',
      number: compactNumber(summary.stockValueAtRiskZar),
      numberUnit: currencyUnit(summary.stockValueAtRiskZar),
      state: summary.stockValueAtRiskZar > 0 ? 'Warning' : 'Good',
      numberState: summary.stockValueAtRiskZar > 0 ? 'Warning' : 'Good',
      info: `${product}`.slice(0, 80),
      infoState: summary.stockValueAtRiskZar > 0 ? 'Warning' : 'Good',
      title: 'Cold-Chain Stock at Risk',
      subtitle: `${store} / ${zone}`,
      targetUrl: `${controlTowerUrl}?kpi=stock-at-risk`,
      updatedAt
    },
    {
      ID: 'rescueProof',
      number: status === 'ACTIONED' || status === 'RESCUED' ? '100' : String(Math.round(numeric(summary.processCompletionPct))),
      numberUnit: '%',
      state,
      numberState: state,
      info: status,
      infoState: state,
      title: 'Intervention Completion Proof',
      subtitle: latestImpact && latestImpact.movementReferences ? 'Movement evidence linked' : 'Awaiting movement proof',
      targetUrl: proveUrl,
      updatedAt
    },
    {
      ID: 'wasteAvoided',
      number: compactNumber(summary.wasteAvoidedUnits),
      numberUnit: 'units',
      state: numeric(summary.wasteAvoidedUnits) > 0 ? 'Good' : 'Neutral',
      numberState: numeric(summary.wasteAvoidedUnits) > 0 ? 'Good' : 'Neutral',
      info: `${Math.round(numeric(summary.lostSalesAvoidedUnits))} lost-sales units`,
      infoState: numeric(summary.wasteAvoidedUnits) > 0 ? 'Good' : 'Neutral',
      title: 'Waste Avoided by Rescue Action',
      subtitle: 'Units saved and lost sales prevented',
      targetUrl: `${controlTowerUrl}?kpi=waste-avoided`,
      updatedAt
    }
  ];
}

function integrationStatus(ID, serviceName, isReady, message, proofSource) {
  return {
    ID,
    checkedAt: isoNow(),
    serviceName,
    status: isReady ? 'READY' : 'UNAVAILABLE',
    proofSource,
    message,
    criticality: isReady ? 3 : 1
  };
}

function hasAiCoreBinding() {
  return Boolean(aiCoreTokenConfig());
}

async function readHanaPersistenceStatus(req) {
  const { SensorReadings } = cds.entities('freshchain');
  try {
    const row = await cds.tx(req).run(SELECT.one`count(*) as count`.from(SensorReadings));
    return integrationStatus(
      'hanaPersistence',
      'SAP HANA persistence',
      true,
      `Live HANA read succeeded (${Number(row && row.count || 0)} sensor readings)`,
      'SensorReadings count query'
    );
  } catch (error) {
    return integrationStatus(
      'hanaPersistence',
      'SAP HANA persistence',
      false,
      `Live HANA read failed: ${redact(error.message)}`,
      'SensorReadings count query'
    );
  }
}

async function readIntegrationStatuses(req) {
  const aiCoreConfigured = hasAiCoreBinding();
  const genAiConfigured = hasGenAiConfiguration();
  const eventMeshConfigured = hasMessagingBinding();
  const managedBaseUrlConfigured = Boolean(managedBaseUrl());
  const hanaStatus = await readHanaPersistenceStatus(req);
  const hanaReady = hanaStatus.status === 'READY';
  return [
    hanaStatus,
    integrationStatus(
      'aiCore',
      'SAP AI Core scoring',
      aiCoreConfigured,
      aiCoreConfigured ? `Resource group ${aiCoreResourceGroup()} is configured` : 'SAP AI Core service binding is required',
      'VCAP_SERVICES'
    ),
    integrationStatus(
      'genAi',
      'SAP AI Core GenAI action brief',
      genAiConfigured && aiCoreConfigured,
      genAiConfigured && aiCoreConfigured ? 'Orchestration endpoint or SDK resource group is configured' : 'GenAI orchestration configuration is required',
      'Environment and AI Core binding'
    ),
    integrationStatus(
      'workflow',
      'FreshChain in-app workflow',
      hanaReady,
      hanaReady
        ? 'Store rescue workflow is handled by CAP actions and persisted task proof'
        : 'Persisted task proof is unavailable until live HANA reads recover',
      hanaReady ? 'LiveDemoService' : 'HANA health check'
    ),
    integrationStatus(
      'eventMesh',
      'SAP Event Mesh',
      eventMeshConfigured,
      eventMeshConfigured ? 'Enterprise messaging binding is available' : 'Enterprise messaging binding is required for brokered live events',
      'VCAP_SERVICES'
    ),
    integrationStatus(
      'workZone',
      'SAP Build Work Zone dynamic tiles',
      managedBaseUrlConfigured,
      managedBaseUrlConfigured ? 'Managed app base URL is configured' : 'FRESHCHAIN_MANAGED_BASE_URL is required for deployed Work Zone navigation',
      'Environment'
    )
  ];
}

function registerLiveDemoReadHandlers(service, entities) {
  service.on('READ', 'RiskByZone', readRiskByZoneForRequest);
  service.on('READ', 'ScenarioMix', readScenarioMixForRequest);
  service.on('READ', 'InterventionStatusMix', readInterventionStatusMixForRequest);
  service.on('READ', 'ZoneOccupancy', readZoneOccupancyForRequest);
  service.on('READ', 'BusinessImpactSummary', readBusinessImpactSummaryForRequest);
  service.on('READ', 'CurrentRescueScenarios', readCurrentRescueScenariosForRequest);
  service.on('READ', 'CurrentProcessTasks', readCurrentProcessTasksForRequest);
  service.on('READ', 'IntegrationStatuses', readIntegrationStatusesForRequest);
  service.on('READ', 'DynamicTileKpis', readDynamicTileKpisForRequest);
  service.after('READ', 'RiskDecisions', addRiskDecisionCriticality);
  service.after('READ', 'InterventionImpacts', addInterventionImpactCriticality);
  service.on('READ', 'DemoRunStatus', readDemoRunStatus);
  service.on('READ', 'DemoImpactMetrics', req => readDemoImpactMetrics(req, entities));
}

async function readCountedRows(req, reader) {
  return counted(await reader(cds.tx(req)));
}

function readRiskByZoneForRequest(req) {
  return readCountedRows(req, readRiskByZone);
}

function readScenarioMixForRequest(req) {
  return readCountedRows(req, readScenarioMix);
}

function readInterventionStatusMixForRequest(req) {
  return readCountedRows(req, readInterventionStatusMix);
}

function readZoneOccupancyForRequest(req) {
  return readCountedRows(req, readZoneOccupancy);
}

function readBusinessImpactSummaryForRequest(req) {
  return readCountedRows(req, readBusinessImpactSummary);
}

function readCurrentRescueScenariosForRequest(req) {
  return readCountedRows(req, readCurrentRescueScenarios);
}

function readCurrentProcessTasksForRequest(req) {
  return readCountedRows(req, readCurrentProcessTasks);
}

async function readIntegrationStatusesForRequest(req) {
  return counted(await readIntegrationStatuses(req));
}

async function readDynamicTileKpisForRequest(req) {
  const rows = await readSharedDynamicTileKpis(cds.tx(req));
  const ID = requestKey(req);
  return ID ? rows.find(row => row.ID === ID) : counted(rows);
}

function addRiskDecisionCriticality(rows) {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  for (const row of list) row.criticality = riskCriticality(row.riskLevel);
}

function addInterventionImpactCriticality(rows) {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  for (const row of list) row.criticality = criticalityForStatus(row.status);
}

function readDemoRunStatus() {
  return [stateRow()];
}

async function readDemoImpactMetrics(req, entities) {
  const {
    Alerts,
    SensorReadings,
    Predictions,
    InferenceRequests,
    ReplenishmentRecommendations
  } = entities;
  const tx = cds.tx(req);
  const latestReading = await tx.run(SELECT.one.from(SensorReadings).orderBy('measuredAt desc'));
  const latestPrediction = await tx.run(SELECT.one.from(Predictions).orderBy('createdAt desc'));
  const activeAlerts = await tx.run(SELECT.one`count(*) as count`.from(Alerts).where({ status: { in: ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'REOPENED'] } }));
  const criticalAlerts = await tx.run(SELECT.one`count(*) as count`.from(Alerts).where({ severity: 'CRITICAL', status: { in: ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'REOPENED'] } }));
  const inferenceCount = await tx.run(SELECT.one`count(*) as count`.from(InferenceRequests));
  const successfulInferences = await tx.run(SELECT.one`count(*) as count`.from(InferenceRequests).where({ status: 'SUCCEEDED' }));
  const acceptedInterventions = await tx.run(SELECT.one`count(*) as count`.from(ReplenishmentRecommendations).where({ status: { in: ['ACCEPTED', 'APPLIED'] } }));
  const latency = await tx.run(SELECT.one`avg(latencyMs) as value`.from(InferenceRequests).where({ status: 'SUCCEEDED' }));
  const impact = await tx.run(SELECT.one`sum(expectedWasteAvoidedUnits) as waste, sum(expectedLostSalesAvoidedUnits) as lostSales`.from(ReplenishmentRecommendations));
  const integrations = await readIntegrationStatuses(req);
  const platformProof = integrations
    .map(row => `${row.serviceName}: ${row.status}`)
    .join(' | ');

  return [{
    ID: 'current',
    generatedAt: isoNow(),
    runStatus: runState.status,
    latestScenario: latestReading && latestReading.scenarioCode || 'No live reading yet',
    latestRisk: latestPrediction && latestPrediction.riskLevel || 'No AI Core score yet',
    activeAlerts: Number(activeAlerts && activeAlerts.count || 0),
    activeAlertsCriticality: Number(activeAlerts && activeAlerts.count || 0) > 0 ? 2 : 3,
    criticalAlerts: Number(criticalAlerts && criticalAlerts.count || 0),
    criticalAlertsCriticality: Number(criticalAlerts && criticalAlerts.count || 0) > 0 ? 1 : 3,
    inferenceCount: Number(inferenceCount && inferenceCount.count || 0),
    successfulInferences: Number(successfulInferences && successfulInferences.count || 0),
    averageLatencyMs: Math.round(Number(latency && latency.value || 0)),
    latencyCriticality: Number(latency && latency.value || 0) > 1200 ? 2 : 3,
    expectedWasteAvoidedUnits: Number(impact && impact.waste || 0),
    expectedLostSalesAvoidedUnits: Number(impact && impact.lostSales || 0),
    acceptedInterventions: Number(acceptedInterventions && acceptedInterventions.count || 0),
    latestRiskCriticality: riskCriticality(latestPrediction && latestPrediction.riskLevel),
    platformProof
  }];
}

async function publishSensorPayload(req, payload) {
  const bus = await messaging();
  if (!bus || typeof bus.emit !== 'function') {
    req.reject(503, 'Configured messaging service does not support Event Mesh publishing');
  }
  await withTimeout(bus.emit(SENSOR_TOPIC, payload), 2000, 'Event Mesh publish timed out');
}

function requireRunningDemo(req, actionLabel) {
  if (runState.status !== 'RUNNING' && !req.data.force) {
    req.reject(409, `Live demo is stopped. Call startLiveDemo first, or pass force=true for a single manual ${actionLabel}.`);
  }
}

async function startLiveDemo() {
  await subscribeMessaging();
  Object.assign(runState, {
    status: 'RUNNING',
    startedAt: runState.startedAt || isoNow(),
    stoppedAt: null,
    message: 'Live demo is running. Use Create Reading or Run Rescue Scenario to trigger live events.'
  });
  return stateRow();
}

function stopLiveDemo() {
  Object.assign(runState, {
    status: 'STOPPED',
    stoppedAt: isoNow(),
    message: 'Live demo is stopped. Demo actions can still run when forced by the app.'
  });
  return stateRow();
}

function resetDemoRun() {
  Object.assign(runState, {
    status: 'STOPPED',
    startedAt: null,
    stoppedAt: isoNow(),
    lastTickAt: null,
    lastMessageId: null,
    lastScenario: null,
    message: 'Live demo run state was reset.'
  });
  return stateRow();
}

async function createLiveReading(req) {
  requireRunningDemo(req, 'reading');
  const payload = await cds.tx(tx => generatePayload(tx));
  await publishSensorPayload(req, payload);
  const result = await processPayload(payload);
  Object.assign(runState, {
    lastTickAt: isoNow(),
    lastMessageId: payload.messageId,
    lastScenario: payload.scenarioCode,
    message: result.scoringFailed
      ? 'Live reading was created, but AI Core scoring failed. See inference telemetry.'
      : 'Live reading was created and scored through SAP AI Core.'
  });
  return cds.tx(tx => liveReadingByMessageId(tx, payload.messageId));
}

async function scoreLatestLiveReading(req, entities) {
  requireRunningDemo(req, 'score');
  const prediction = await cds.tx(async tx => {
    const reading = await tx.run(SELECT.one.from(entities.SensorReadings).orderBy('measuredAt desc'));
    if (!reading) req.reject(409, 'No sensor readings are available to score');
    const scored = await scoreLatest(tx, { zoneId: reading.zone_ID });
    if (scored && scored.failed) req.reject(502, scored.error.message);
    return latestRiskDecision(tx);
  });
  Object.assign(runState, {
    lastTickAt: isoNow(),
    message: 'Latest reading was scored through SAP AI Core.'
  });
  return prediction;
}

async function runRescueScenario(req) {
  const payload = await cds.tx(tx => generateRescuePayload(tx));
  await publishSensorPayload(req, payload);
  const result = await processPayload(payload);
  if (result.scoringFailed) {
    req.reject(
      result.scoringError && result.scoringError.statusCode || 502,
      'SAP AI Core scoring failed; rescue proof was not created. Review inference telemetry.'
    );
  }
  const scenario = await cds.tx(async tx => {
    const [reading, prediction] = await Promise.all([
      liveReadingByMessageId(tx, payload.messageId),
      latestRiskDecision(tx)
    ]);
    const productName = await productNameForScenario(tx, reading && reading.zoneCode);
    return buildScenario(tx, { reading, prediction }, productName);
  });
  const { storedScenario } = await cds.tx(async tx => {
    const brief = await buildActionBrief(tx, scenario);
    const afterBrief = await rescueScenarioById(tx, scenario.ID);
    const task = await buildProcessTask(tx, afterBrief);
    return { brief, task, storedScenario: await rescueScenarioById(tx, scenario.ID) };
  });
  Object.assign(runState, {
    status: 'STOPPED',
    stoppedAt: isoNow(),
    lastTickAt: isoNow(),
    lastMessageId: payload.messageId,
    lastScenario: payload.scenarioCode,
    message: 'One rescue scenario was created and scored. Demo run stopped to control AI Core usage.'
  });
  return storedScenario;
}

async function rescueScenarioForRequest(req) {
  const scenarioID = req.data.scenarioID;
  const scenario = await cds.tx(tx => scenarioID ? rescueScenarioById(tx, scenarioID) : latestRescueScenario(tx));
  if (!scenario) req.reject(404, `Rescue scenario ${scenarioID || 'current'} not found`);
  return scenario;
}

async function generateActionBriefForRequest(req) {
  const scenario = await rescueScenarioForRequest(req);
  return cds.tx(tx => buildActionBrief(tx, scenario));
}

async function triggerInterventionProcessForRequest(req) {
  const scenario = await rescueScenarioForRequest(req);
  return cds.tx(tx => buildProcessTask(tx, scenario));
}

async function completeInterventionTaskForRequest(req) {
  const task = await completeTask(cds.tx(req), req, req.data.taskID, req.data.outcome);
  if (!task) req.reject(404, `Process task ${req.data.taskID} not found`);
  return task;
}

function acknowledgeSpoilageIntervention(req, actions) {
  return acknowledgeAlert(req, actions);
}

function assignSpoilageIntervention(req, actions) {
  return assignAlert(req, actions);
}

function resolveSpoilageIntervention(req, actions) {
  return resolveAlert(req, actions);
}

function reopenSpoilageIntervention(req, actions) {
  return reopenAlert(req, actions);
}

function registerLiveDemoActionHandlers(service, entities, interventionActions) {
  service.on('startLiveDemo', startLiveDemo);
  service.on('stopLiveDemo', stopLiveDemo);
  service.on('resetDemoRun', resetDemoRun);
  service.on('createLiveReading', createLiveReading);
  service.on('scoreLatestLiveReading', req => scoreLatestLiveReading(req, entities));
  service.on('runRescueScenario', runRescueScenario);
  service.on('generateActionBrief', generateActionBriefForRequest);
  service.on('triggerInterventionProcess', triggerInterventionProcessForRequest);
  service.on('completeInterventionTask', completeInterventionTaskForRequest);
  service.on('acknowledge', 'SpoilageInterventions', req => acknowledgeSpoilageIntervention(req, interventionActions));
  service.on('assign', 'SpoilageInterventions', req => assignSpoilageIntervention(req, interventionActions));
  service.on('resolve', 'SpoilageInterventions', req => resolveSpoilageIntervention(req, interventionActions));
  service.on('reopen', 'SpoilageInterventions', req => reopenSpoilageIntervention(req, interventionActions));
}

module.exports = cds.service.impl(function LiveDemoService() {
  const { Alerts, AlertActions, SensorReadings, Predictions, InferenceRequests, ReplenishmentRecommendations } = cds.entities('freshchain');
  const demoImpactEntities = {
    Alerts,
    SensorReadings,
    Predictions,
    InferenceRequests,
    ReplenishmentRecommendations
  };
  const interventionActions = {
    Alerts,
    AlertActions,
    auditMessage: 'Authenticated user is required for intervention audit proof',
    notFoundLabel: 'Spoilage intervention',
    now: isoNow,
    readUpdated: (tx, alert) => readSpoilageInterventions(tx, { ID: alert.ID, one: true })
  };

  registerLiveDemoReadHandlers(this, demoImpactEntities);
  registerLiveDemoActionHandlers(this, demoImpactEntities, interventionActions);
});

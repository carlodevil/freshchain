const cds = require('@sap/cds');
const crypto = require('crypto');

function isoNow() {
  return new Date().toISOString();
}

function dateOnly(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function qty(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function quantity(value, field = 'quantity') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw Object.assign(new Error(`${field} must be greater than zero`), { statusCode: 400 });
  }
  return Math.round(parsed * 1000) / 1000;
}

function criticalityForStatus(status) {
  return status === 'POTENTIAL' ? 2 : status === 'ACTIONED' || status === 'VERIFIED' ? 3 : 0;
}

async function activeImpactSettings(tx) {
  const { ImpactSettings } = cds.entities('freshchain');
  const settings = await tx.run(SELECT.one.from(ImpactSettings).where({ active: true }).orderBy('modifiedAt desc'));
  if (!settings) {
    throw Object.assign(new Error('No active impact settings are maintained. Open FreshChain Configure before running rescue proof.'), { statusCode: 409 });
  }
  return settings;
}

function salvageRateForRisk(score, settings) {
  const riskScore = Number(score || 0);
  if (riskScore >= 0.85) return Number(settings.criticalRiskSalvageRate || 0);
  if (riskScore >= 0.65) return Number(settings.highRiskSalvageRate || 0);
  if (riskScore >= 0.35) return Number(settings.mediumRiskSalvageRate || 0);
  return Number(settings.lowRiskSalvageRate || 0);
}

function responseSlaMinutesForRisk(riskLevel, settings) {
  const field = riskLevel === 'CRITICAL' ? 'criticalResponseSlaMinutes'
    : riskLevel === 'HIGH' ? 'highResponseSlaMinutes'
      : riskLevel === 'MEDIUM' ? 'mediumResponseSlaMinutes'
        : 'lowResponseSlaMinutes';
  const minutes = Number(settings[field]);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw Object.assign(new Error(`Impact setting ${settings.settingCode} is missing ${field}`), { statusCode: 409 });
  }
  return Math.round(minutes);
}

function freshchainEntities() {
  return cds.entities('freshchain');
}

async function zoneStore(tx, zoneId, entities = freshchainEntities()) {
  const { Zones } = entities;
  const zone = await tx.run(SELECT.one.from(Zones).where({ ID: zoneId }));
  if (!zone) throw Object.assign(new Error(`Zone ${zoneId} not found`), { statusCode: 404 });
  return zone.store_ID;
}

async function productDefaults(tx, productId, entities = freshchainEntities()) {
  const { Products } = entities;
  const product = await tx.run(SELECT.one.from(Products).where({ ID: productId }));
  if (!product) throw Object.assign(new Error(`Product ${productId} not found`), { statusCode: 404 });
  return {
    product,
    unit: product.uom || 'EA',
    unitCostZar: Number(product.unitCostZar || 0),
    sellingPriceZar: Number(product.sellingPriceZar || 0)
  };
}

async function recordMovement(tx, data, entities = freshchainEntities()) {
  const { StockMovements } = entities;
  if (!data.performedBy) {
    throw Object.assign(new Error('performedBy is required for stock movement audit proof'), { statusCode: 401 });
  }
  const movementId = crypto.randomUUID();
  await tx.run(INSERT.into(StockMovements).entries({
    ID: movementId,
    stockLot_ID: data.stockLot_ID,
    product_ID: data.product_ID,
    batch_ID: data.batch_ID || null,
    store_ID: data.store_ID || null,
    fromZone_ID: data.fromZone_ID || null,
    toZone_ID: data.toZone_ID || null,
    movementType: data.movementType,
    movementSign: data.movementSign || 1,
    quantity: data.quantity,
    quantityBalanceAfter: data.quantityBalanceAfter ?? null,
    unit: data.unit || 'EA',
    unitCostZar: money(data.unitCostZar),
    sellingPriceZar: money(data.sellingPriceZar),
    movementValueZar: money(data.movementValueZar ?? (Number(data.quantity || 0) * Number(data.sellingPriceZar || 0))),
    valueBasis: data.valueBasis || 'RETAIL',
    reasonCode: data.reasonCode || null,
    referenceDocument: data.referenceDocument || null,
    performedBy: data.performedBy,
    businessTimestamp: data.businessTimestamp || isoNow()
  }));
  return movementId;
}

async function receiveStock(tx, data, user, entities = freshchainEntities()) {
  const { StockLots } = entities;
  const { product, unit, unitCostZar, sellingPriceZar } = await productDefaults(tx, data.productId, entities);
  const storeId = await zoneStore(tx, data.zoneId, entities);
  const receivedQuantity = quantity(data.quantity);
  const now = isoNow();
  const entry = {
    lotNumber: data.lotNumber || `LOT-${product.sku}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
    product_ID: data.productId,
    batch_ID: data.batchId || null,
    store_ID: storeId,
    zone_ID: data.zoneId,
    quantityOnHand: receivedQuantity,
    unit: data.unit || unit,
    unitCostZar: money(data.unitCostZar ?? unitCostZar),
    sellingPriceZar: money(data.sellingPriceZar ?? sellingPriceZar),
    bestBeforeDate: data.bestBeforeDate || dateOnly(Number(product.standardShelfLifeDays || 7)),
    status: 'AVAILABLE',
    sourceSystem: data.sourceSystem || 'CAP_DEMO_WMS',
    lastMovementAt: now
  };
  await tx.run(INSERT.into(StockLots).entries(entry));
  const lot = await tx.run(SELECT.one.from(StockLots).where({ lotNumber: entry.lotNumber }));
  await recordMovement(tx, {
    stockLot_ID: lot.ID,
    product_ID: lot.product_ID,
    batch_ID: lot.batch_ID,
    store_ID: lot.store_ID,
    toZone_ID: lot.zone_ID,
    movementType: 'RECEIPT',
    movementSign: 1,
    quantity: lot.quantityOnHand,
    quantityBalanceAfter: lot.quantityOnHand,
    unit: lot.unit,
    unitCostZar: lot.unitCostZar,
    sellingPriceZar: lot.sellingPriceZar,
    valueBasis: 'RETAIL',
    reasonCode: data.reasonCode || 'GOODS_RECEIPT',
    referenceDocument: data.referenceDocument,
    performedBy: user,
    businessTimestamp: now
  }, entities);
  return lot;
}

async function moveStock(tx, data, user, entities = freshchainEntities()) {
  const { StockLots } = entities;
  const lot = await tx.run(SELECT.one.from(StockLots).where({ ID: data.stockLotId }));
  if (!lot) throw Object.assign(new Error(`Stock lot ${data.stockLotId} not found`), { statusCode: 404 });
  const moveQuantity = quantity(data.quantity || lot.quantityOnHand);
  const currentQuantity = Number(lot.quantityOnHand || 0);
  if (moveQuantity > currentQuantity) {
    throw Object.assign(new Error(`Cannot move ${moveQuantity}; only ${currentQuantity} is available`), { statusCode: 409 });
  }
  const toStoreId = await zoneStore(tx, data.toZoneId, entities);
  if (lot.store_ID && toStoreId !== lot.store_ID) {
    throw Object.assign(new Error('Cross-store stock movement is not supported by moveStock; receive or transfer through ERP/WMS first'), { statusCode: 409 });
  }
  const now = isoNow();
  let returnedLotId = lot.ID;

  if (moveQuantity === currentQuantity) {
    await tx.run(UPDATE(StockLots).set({
      store_ID: toStoreId,
      zone_ID: data.toZoneId,
      status: 'AVAILABLE',
      lastMovementAt: now
    }).where({ ID: lot.ID }));
  } else {
    await tx.run(UPDATE(StockLots).set({
      quantityOnHand: qty(currentQuantity - moveQuantity),
      lastMovementAt: now
    }).where({ ID: lot.ID }));
    const newLotNumber = `${lot.lotNumber}-MV-${crypto.randomUUID().slice(0, 6)}`;
    await tx.run(INSERT.into(StockLots).entries({
      lotNumber: newLotNumber,
      product_ID: lot.product_ID,
      batch_ID: lot.batch_ID,
      store_ID: toStoreId,
      zone_ID: data.toZoneId,
      quantityOnHand: moveQuantity,
      unit: lot.unit,
      unitCostZar: lot.unitCostZar,
      sellingPriceZar: lot.sellingPriceZar,
      bestBeforeDate: lot.bestBeforeDate,
      status: 'AVAILABLE',
      sourceSystem: lot.sourceSystem,
      lastMovementAt: now
    }));
    const movedLot = await tx.run(SELECT.one.from(StockLots).where({ lotNumber: newLotNumber }));
    returnedLotId = movedLot.ID;
  }

  const returnedLot = await tx.run(SELECT.one.from(StockLots).where({ ID: returnedLotId }));
  const movementId = await recordMovement(tx, {
    stockLot_ID: returnedLotId,
    product_ID: lot.product_ID,
    batch_ID: lot.batch_ID,
    store_ID: toStoreId,
    fromZone_ID: lot.zone_ID,
    toZone_ID: data.toZoneId,
    movementType: data.movementType || 'ZONE_TRANSFER',
    movementSign: 0,
    quantity: moveQuantity,
    quantityBalanceAfter: returnedLot && returnedLot.quantityOnHand,
    unit: lot.unit,
    unitCostZar: lot.unitCostZar,
    sellingPriceZar: lot.sellingPriceZar,
    movementValueZar: money(moveQuantity * Number(lot.sellingPriceZar || 0)),
    valueBasis: 'RETAIL',
    reasonCode: data.reasonCode || 'ZONE_TRANSFER',
    referenceDocument: data.referenceDocument,
    performedBy: user,
    businessTimestamp: now
  }, entities);
  if (returnedLot) returnedLot.lastMovementID = movementId;
  return returnedLot;
}

async function applyMarkdown(tx, data, user, entities = freshchainEntities()) {
  const { StockLots } = entities;
  const lot = await tx.run(SELECT.one.from(StockLots).where({ ID: data.stockLotId }));
  if (!lot) throw Object.assign(new Error(`Stock lot ${data.stockLotId} not found`), { statusCode: 404 });
  const price = money(data.sellingPriceZar);
  const now = isoNow();
  await tx.run(UPDATE(StockLots).set({
    sellingPriceZar: price,
    status: 'MARKDOWN',
    lastMovementAt: now
  }).where({ ID: lot.ID }));
  await recordMovement(tx, {
    stockLot_ID: lot.ID,
    product_ID: lot.product_ID,
    batch_ID: lot.batch_ID,
    store_ID: lot.store_ID,
    fromZone_ID: lot.zone_ID,
    toZone_ID: lot.zone_ID,
    movementType: 'MARKDOWN',
    movementSign: 0,
    quantity: lot.quantityOnHand,
    quantityBalanceAfter: lot.quantityOnHand,
    unit: lot.unit,
    unitCostZar: lot.unitCostZar,
    sellingPriceZar: price,
    movementValueZar: money(Number(lot.quantityOnHand || 0) * (price - Number(lot.sellingPriceZar || 0))),
    valueBasis: 'MARKDOWN_DELTA',
    reasonCode: data.reasonCode || 'CONTROLLED_MARKDOWN',
    referenceDocument: data.referenceDocument,
    performedBy: user,
    businessTimestamp: now
  }, entities);
  return tx.run(SELECT.one.from(StockLots).where({ ID: lot.ID }));
}

async function writeOffStock(tx, data, user, entities = freshchainEntities()) {
  const { StockLots } = entities;
  const lot = await tx.run(SELECT.one.from(StockLots).where({ ID: data.stockLotId }));
  if (!lot) throw Object.assign(new Error(`Stock lot ${data.stockLotId} not found`), { statusCode: 404 });
  const writeOffQuantity = quantity(data.quantity || lot.quantityOnHand);
  const currentQuantity = Number(lot.quantityOnHand || 0);
  if (writeOffQuantity > currentQuantity) {
    throw Object.assign(new Error(`Cannot write off ${writeOffQuantity}; only ${currentQuantity} is available`), { statusCode: 409 });
  }
  const remaining = qty(currentQuantity - writeOffQuantity);
  const now = isoNow();
  await tx.run(UPDATE(StockLots).set({
    quantityOnHand: remaining,
    status: remaining > 0 ? lot.status : 'WASTE',
    lastMovementAt: now
  }).where({ ID: lot.ID }));
  await recordMovement(tx, {
    stockLot_ID: lot.ID,
    product_ID: lot.product_ID,
    batch_ID: lot.batch_ID,
    store_ID: lot.store_ID,
    fromZone_ID: lot.zone_ID,
    movementType: 'WASTE_WRITE_OFF',
    movementSign: -1,
    quantity: writeOffQuantity,
    quantityBalanceAfter: remaining,
    unit: lot.unit,
    unitCostZar: lot.unitCostZar,
    sellingPriceZar: lot.sellingPriceZar,
    movementValueZar: money(writeOffQuantity * Number(lot.sellingPriceZar || 0)),
    valueBasis: 'RETAIL_LOSS',
    reasonCode: data.reasonCode || 'SPOILAGE_WRITE_OFF',
    referenceDocument: data.referenceDocument,
    performedBy: user,
    businessTimestamp: now
  }, entities);
  return tx.run(SELECT.one.from(StockLots).where({ ID: lot.ID }));
}

async function readZoneOccupancy(tx, entities = freshchainEntities()) {
  const { StockLots, Zones, Stores } = entities;
  const lots = await tx.run(SELECT.from(StockLots).where({ status: { in: ['AVAILABLE', 'RESERVED', 'MARKDOWN'] } }));
  const zones = new Map((await tx.run(SELECT.from(Zones))).map(row => [row.ID, row]));
  const stores = new Map((await tx.run(SELECT.from(Stores))).map(row => [row.ID, row]));
  const rows = new Map();
  for (const lot of lots) {
    if (Number(lot.quantityOnHand || 0) <= 0 || !lot.zone_ID) continue;
    const zone = zones.get(lot.zone_ID) || {};
    const store = stores.get(lot.store_ID) || {};
    const current = rows.get(lot.zone_ID) || {
      ID: lot.zone_ID,
      storeCode: store.storeCode,
      zoneCode: zone.zoneCode,
      zoneType: zone.type,
      lotCount: 0,
      unitsOnHand: 0,
      stockValueZar: 0,
      oldestBestBeforeDate: lot.bestBeforeDate,
      criticality: 3
    };
    current.lotCount += 1;
    current.unitsOnHand = qty(current.unitsOnHand + Number(lot.quantityOnHand || 0));
    current.stockValueZar = money(current.stockValueZar + Number(lot.quantityOnHand || 0) * Number(lot.sellingPriceZar || 0));
    if (lot.bestBeforeDate && (!current.oldestBestBeforeDate || lot.bestBeforeDate < current.oldestBestBeforeDate)) {
      current.oldestBestBeforeDate = lot.bestBeforeDate;
    }
    rows.set(lot.zone_ID, current);
  }
  return [...rows.values()].sort((a, b) => b.stockValueZar - a.stockValueZar);
}

async function stockAtRiskForZone(tx, zoneId, prediction = {}) {
  const { StockLots, Products } = cds.entities('freshchain');
  const settings = await activeImpactSettings(tx);
  const lots = await tx.run(SELECT.from(StockLots).where({
    zone_ID: zoneId,
    status: { in: ['AVAILABLE', 'RESERVED', 'MARKDOWN'] }
  }).orderBy('bestBeforeDate asc'));
  const activeLots = lots.filter(lot => Number(lot.quantityOnHand || 0) > 0);
  const products = new Map((await tx.run(SELECT.from(Products))).map(row => [row.ID, row]));
  const stockValueAtRiskZar = money(activeLots.reduce((sum, lot) => sum + Number(lot.quantityOnHand || 0) * Number(lot.sellingPriceZar || 0), 0));
  const affectedUnits = qty(activeLots.reduce((sum, lot) => sum + Number(lot.quantityOnHand || 0), 0));
  const scoreValue = Number(prediction.score);
  const confidenceValue = Number(prediction.confidence);
  if (!Number.isFinite(scoreValue) || !Number.isFinite(confidenceValue)) {
    throw Object.assign(new Error('AI Core prediction score and confidence are required for financial proof'), { statusCode: 409 });
  }
  const score = Math.min(0.99, Math.max(0.01, scoreValue));
  const confidence = Math.min(0.99, Math.max(0.01, confidenceValue));
  const expectedLossZar = money(stockValueAtRiskZar * score * confidence);
  const salvageRate = salvageRateForRisk(score, settings);
  const responseSlaMinutes = responseSlaMinutesForRisk(prediction.riskLevel, settings);
  const potentialProtectedRevenueZar = money(Math.min(expectedLossZar, stockValueAtRiskZar * salvageRate));
  const productNames = [...new Set(activeLots.map(lot => products.get(lot.product_ID)?.name).filter(Boolean))];
  const currency = settings.currencyCode || 'ZAR';
  return {
    lots: activeLots,
    lotIds: activeLots.map(lot => lot.ID),
    productName: productNames.length === 1 ? productNames[0] : productNames.length ? `${productNames.length} chilled product groups` : 'No active stock',
    lotCount: activeLots.length,
    affectedUnits,
    stockValueAtRiskZar,
    spoilageProbability: score,
    confidence,
    expectedLossZar,
    salvageRate,
    responseSlaMinutes,
    potentialProtectedRevenueZar,
    wasteAvoidedUnits: affectedUnits,
    lostSalesAvoidedUnits: money(Math.max(0, Number(prediction.demandUnitsForecast || 0))),
    calculationSummary: `Stock at risk is active stock in the affected zone. Expected loss = stock value ${currency} ${stockValueAtRiskZar.toLocaleString('en-ZA')} x risk ${score} x confidence ${confidence}. Potential protected revenue uses maintained salvage rate ${salvageRate} from ${settings.settingCode}.`
  };
}

async function firstSafeZone(tx, sourceZoneId, storeId) {
  const { Zones } = cds.entities('freshchain');
  return tx.run(SELECT.one.from(Zones).where({
    store_ID: storeId,
    active: true,
    ID: { '!=': sourceZoneId }
  }).orderBy('safeTempMaxC asc'));
}

async function recordPotentialImpact(tx, scenario, prediction) {
  const { InterventionImpacts } = cds.entities('freshchain');
  const existing = await tx.run(SELECT.one.from(InterventionImpacts).where({ scenarioID: scenario.ID }));
  const values = {
    scenarioID: scenario.ID,
    prediction_ID: prediction && prediction.ID || null,
    store_ID: scenario.store_ID || null,
    zone_ID: scenario.zone_ID || null,
    product_ID: scenario.product_ID || null,
    status: 'POTENTIAL',
    actionType: 'PENDING_RESCUE_MOVE',
    lotCount: scenario.affectedLotCount,
    affectedUnits: scenario.affectedUnits,
    stockValueAtRiskZar: scenario.businessValueAtRiskZar,
    spoilageProbability: scenario.spoilageProbability,
    confidence: scenario.confidence,
    expectedLossZar: scenario.expectedLossZar,
    salvageRate: scenario.salvageRate,
    potentialProtectedRevenueZar: scenario.potentialProtectedRevenueZar,
    actualProtectedRevenueZar: 0,
    wasteAvoidedUnits: scenario.wasteAvoidedUnits,
    lostSalesAvoidedUnits: scenario.lostSalesAvoidedUnits,
    responseSlaMinutes: scenario.responseSlaMinutes,
    completedAt: null,
    affectedLotNumbers: (scenario.affectedLotNumbers || []).join(', '),
    movementReferences: null,
    calculationSummary: scenario.calculationSummary
  };
  if (existing) await tx.run(UPDATE(InterventionImpacts).set(values).where({ ID: existing.ID }));
  else await tx.run(INSERT.into(InterventionImpacts).entries(values));
  return tx.run(SELECT.one.from(InterventionImpacts).where({ scenarioID: scenario.ID }));
}

async function completeRescueImpact(tx, scenario, task, outcome, user) {
  const { InterventionImpacts, StockLots } = cds.entities('freshchain');
  const lotIds = scenario.affectedLotIDs || [];
  const lots = lotIds.length
    ? await tx.run(SELECT.from(StockLots).where({ ID: { in: lotIds } }))
    : [];
  const storeId = scenario.store_ID || (lots[0] && lots[0].store_ID);
  const safeZone = storeId ? await firstSafeZone(tx, scenario.zone_ID, storeId) : null;
  let rescuedRetailValue = 0;
  const movementReferences = [];
  for (const lot of lots) {
    if (safeZone && Number(lot.quantityOnHand || 0) > 0) {
      const moved = await moveStock(tx, {
        stockLotId: lot.ID,
        toZoneId: safeZone.ID,
        quantity: lot.quantityOnHand,
        movementType: 'RESCUE_MOVE',
        reasonCode: 'SPOILAGE_RESCUE',
        referenceDocument: task && task.ID
      }, user);
      rescuedRetailValue += Number(lot.quantityOnHand || 0) * Number(lot.sellingPriceZar || 0);
      if (moved && moved.lastMovementID) movementReferences.push(moved.lastMovementID);
    }
  }
  const actualProtectedRevenueZar = money(Math.min(
    Number(scenario.potentialProtectedRevenueZar || scenario.protectedRevenueZar || 0),
    rescuedRetailValue * Number(scenario.salvageRate || 0)
  ));
  const values = {
    status: 'ACTIONED',
    actionType: safeZone ? 'RESCUE_MOVE' : 'CONTROLLED_MARKDOWN',
    actualProtectedRevenueZar,
    completedAt: isoNow(),
    movementReferences: movementReferences.join(', '),
    calculationSummary: `${scenario.calculationSummary || ''} Completed action: ${safeZone ? `moved stock to ${safeZone.zoneCode}` : 'controlled markdown'}; outcome: ${outcome}.`.trim()
  };
  const existing = await tx.run(SELECT.one.from(InterventionImpacts).where({ scenarioID: scenario.ID }));
  if (existing) await tx.run(UPDATE(InterventionImpacts).set(values).where({ ID: existing.ID }));
  else await tx.run(INSERT.into(InterventionImpacts).entries({
    scenarioID: scenario.ID,
    store_ID: scenario.store_ID,
    zone_ID: scenario.zone_ID,
    status: 'ACTIONED',
    lotCount: scenario.affectedLotCount,
    affectedUnits: scenario.affectedUnits,
    stockValueAtRiskZar: scenario.businessValueAtRiskZar,
    spoilageProbability: scenario.spoilageProbability,
    confidence: scenario.confidence,
    expectedLossZar: scenario.expectedLossZar,
    salvageRate: scenario.salvageRate,
    potentialProtectedRevenueZar: scenario.potentialProtectedRevenueZar,
    wasteAvoidedUnits: scenario.wasteAvoidedUnits,
    lostSalesAvoidedUnits: scenario.lostSalesAvoidedUnits,
    responseSlaMinutes: scenario.responseSlaMinutes,
    ...values
  }));
  return tx.run(SELECT.one.from(InterventionImpacts).where({ scenarioID: scenario.ID }));
}

module.exports = {
  receiveStock,
  moveStock,
  applyMarkdown,
  writeOffStock,
  readZoneOccupancy,
  stockAtRiskForZone,
  recordPotentialImpact,
  completeRescueImpact,
  criticalityForStatus,
  activeImpactSettings,
  responseSlaMinutesForRisk
};

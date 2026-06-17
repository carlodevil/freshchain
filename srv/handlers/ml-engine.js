const cds = require('@sap/cds');
const crypto = require('crypto');
const { AiCoreClient, AiCoreError } = require('./ai-core-client');

function isoNow() {
  return new Date().toISOString();
}

function daysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function modelVersion() {
  return 'freshchain-ai-core-1.0.0';
}

async function latestDeployment(tx) {
  const { MLDeployments } = cds.entities('freshchain');
  const deployments = await tx.run(SELECT.from(MLDeployments).where({ status: 'SUCCEEDED' }).orderBy('modifiedAt desc'));
  const aiCoreApiUrl = new AiCoreClient().config.apiUrl || '';
  const deployment = deployments.find(deployment => deployment.aiCoreDeploymentId || deployment.endpointUrl);
  if (deployment) return deployment;
  if (!aiCoreApiUrl) return null;
  const activeAiCoreDeployment = await new AiCoreClient().findActiveDeployment();
  if (!activeAiCoreDeployment) return null;
  return {
    deploymentId: activeAiCoreDeployment.deploymentId,
    aiCoreDeploymentId: activeAiCoreDeployment.deploymentId,
    modelName: 'freshchain-intelligence',
    modelVersion: modelVersion(),
    endpointUrl: activeAiCoreDeployment.endpointUrl,
    status: activeAiCoreDeployment.status,
    healthStatus: activeAiCoreDeployment.healthStatus
  };
}

async function featureSnapshot(tx, zoneId, batchId) {
  const { Stores, Zones, Batches, Products, InventoryPlacements, SensorReadings, ReadingAggregates, SalesObservations } = cds.entities('freshchain');
  const zone = await tx.run(SELECT.one.from(Zones).where({ ID: zoneId }));
  if (!zone) return null;
  const store = await tx.run(SELECT.one.from(Stores).where({ ID: zone.store_ID }));
  const latestReading = await tx.run(SELECT.one.from(SensorReadings).where({ zone_ID: zone.ID }).orderBy('measuredAt desc'));
  const sensorReadings = await tx.run(SELECT.from(SensorReadings).where({ zone_ID: zone.ID }).orderBy('measuredAt desc').limit(2500));
  const aggregate = await tx.run(SELECT.one.from(ReadingAggregates).where({ zone_ID: zone.ID }).orderBy('windowEnd desc'));

  let batch = null;
  let product = null;
  let placement = null;
  if (batchId) {
    batch = await tx.run(SELECT.one.from(Batches).where({ ID: batchId }));
    placement = await tx.run(SELECT.one.from(InventoryPlacements).where({ zone_ID: zone.ID, batch_ID: batchId, active: true }).orderBy('placedAt desc'));
  } else {
    placement = await tx.run(SELECT.one.from(InventoryPlacements).where({ zone_ID: zone.ID, active: true }).orderBy('placedAt desc'));
    if (placement) batch = await tx.run(SELECT.one.from(Batches).where({ ID: placement.batch_ID }));
  }
  if (batch) product = await tx.run(SELECT.one.from(Products).where({ ID: batch.product_ID }));

  const sales = product && store
    ? await tx.run(SELECT.from(SalesObservations).where({ store_ID: store.ID, product_ID: product.ID }).orderBy('businessDate desc').limit(14))
    : [];

  return { store, zone, batch, product, placement, latestReading, sensorReadings, aggregate, sales };
}

function requiredNumber(output, key) {
  const value = Number(output[key]);
  if (!Number.isFinite(value)) {
    throw new AiCoreError(`AI Core inference response is missing numeric field ${key}`, { statusCode: 502 });
  }
  return value;
}

function normalizeOutput(output) {
  const normalized = {
    predictionType: output.predictionType || 'REAL_TIME_INTELLIGENCE',
    riskLevel: output.riskLevel,
    score: requiredNumber(output, 'score'),
    confidence: requiredNumber(output, 'confidence'),
    anomalyType: output.anomalyType,
    remainingShelfLifeDays: requiredNumber(output, 'remainingShelfLifeDays'),
    demandUnitsForecast: requiredNumber(output, 'demandUnitsForecast'),
    replenishmentUnits: requiredNumber(output, 'replenishmentUnits'),
    routePriority: Number(output.routePriority),
    recommendedAction: output.recommendedAction,
    businessImpact: output.businessImpact || {}
  };
  if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized.riskLevel)) {
    throw new AiCoreError('AI Core inference response is missing a valid riskLevel', { statusCode: 502 });
  }
  if (!normalized.anomalyType || !normalized.recommendedAction || !Number.isFinite(normalized.routePriority)) {
    throw new AiCoreError('AI Core inference response is missing required recommendation fields', { statusCode: 502 });
  }
  return normalized;
}

async function recordFailedInference(tx, requestId, deployment, features, error) {
  const { InferenceRequests } = cds.entities('freshchain');
  await tx.run(INSERT.into(InferenceRequests).entries({
    requestId,
    deployment_ID: deployment && deployment.ID,
    store_ID: features.store && features.store.ID,
    zone_ID: features.zone.ID,
    batch_ID: features.batch && features.batch.ID,
    status: 'FAILED',
    latencyMs: 0,
    aiCoreUnavailable: true,
    featurePayload: JSON.stringify(features),
    responsePayload: null,
    errorMessage: error.message
  }));
}

async function scoreLatest(tx, input, client = new AiCoreClient()) {
  const entities = cds.entities('freshchain');
  const { Predictions, InferenceRequests, DemandForecasts, ReplenishmentRecommendations, RouteRecommendations, Stores, MLDeployments } = entities;
  const features = await featureSnapshot(tx, input.zoneId, input.batchId);
  if (!features) return null;

  const requestId = crypto.randomUUID();
  let deployment;
  try {
    deployment = await latestDeployment(tx);
  } catch (error) {
    await recordFailedInference(tx, requestId, null, features, error);
    return { failed: true, error };
  }
  if (!deployment) {
    const error = new AiCoreError('No successful SAP AI Core deployment is active for FreshChain scoring', { statusCode: 409 });
    await recordFailedInference(tx, requestId, deployment, features, error);
    return { failed: true, error };
  }

  let result;
  let output;
  try {
    result = await client.invokeDeployment(deployment, features);
    output = normalizeOutput(result.output);
  } catch (error) {
    await recordFailedInference(tx, requestId, deployment, features, error);
    if (deployment.ID) {
      await tx.run(UPDATE(MLDeployments).set({ healthStatus: 'UNAVAILABLE' }).where({ ID: deployment.ID }));
    }
    return { failed: true, error };
  }

  const now = isoNow();
  await tx.run(INSERT.into(InferenceRequests).entries({
    requestId,
    deployment_ID: deployment.ID,
    store_ID: features.store && features.store.ID,
    zone_ID: features.zone.ID,
    batch_ID: features.batch && features.batch.ID,
    status: 'SUCCEEDED',
    latencyMs: result.latencyMs || 0,
    aiCoreUnavailable: false,
    featurePayload: JSON.stringify(features),
    responsePayload: JSON.stringify(output),
    errorMessage: null
  }));
  if (deployment.ID) {
    await tx.run(UPDATE(MLDeployments).set({ lastScoredAt: now, healthStatus: 'ONLINE' }).where({ ID: deployment.ID }));
  }

  await tx.run(INSERT.into(Predictions).entries({
    modelName: deployment.modelName || 'freshchain-ai-core',
    modelVersion: deployment.modelVersion || modelVersion(),
    deploymentId: deployment.deploymentId,
    store_ID: features.store && features.store.ID,
    zone_ID: features.zone.ID,
    batch_ID: features.batch && features.batch.ID,
    predictionType: output.predictionType,
    riskLevel: output.riskLevel,
    score: output.score,
    confidence: output.confidence,
    anomalyType: output.anomalyType,
    remainingShelfLifeDays: output.remainingShelfLifeDays,
    demandUnitsForecast: output.demandUnitsForecast,
    replenishmentUnits: output.replenishmentUnits,
    routePriority: output.routePriority,
    recommendedAction: output.recommendedAction,
    featureSnapshot: JSON.stringify(features),
    outputPayload: JSON.stringify(output),
    aiCoreUnavailable: false,
    modelUnavailableReason: null
  }));

  const prediction = await tx.run(SELECT.one.from(Predictions).where({ zone_ID: features.zone.ID }).orderBy('createdAt desc'));
  if (features.product && features.store) {
    await tx.run(INSERT.into(DemandForecasts).entries({
      prediction_ID: prediction.ID,
      store_ID: features.store.ID,
      product_ID: features.product.ID,
      forecastDate: daysFromNow(1),
      horizonDays: 3,
      forecastUnits: output.demandUnitsForecast,
      lowerBoundUnits: Math.max(0, output.demandUnitsForecast * 0.82),
      upperBoundUnits: output.demandUnitsForecast * 1.18,
      confidence: output.confidence
    }));
    await tx.run(INSERT.into(ReplenishmentRecommendations).entries({
      prediction_ID: prediction.ID,
      store_ID: features.store.ID,
      product_ID: features.product.ID,
      recommendedUnits: output.replenishmentUnits,
      priority: output.routePriority,
      reasonCode: output.anomalyType,
      expectedWasteAvoidedUnits: Number(output.businessImpact.expectedWasteAvoidedUnits || 0),
      expectedLostSalesAvoidedUnits: Number(output.businessImpact.expectedLostSalesAvoidedUnits || 0),
      status: 'NEW'
    }));
    const alternateStore = await tx.run(SELECT.one.from(Stores).where({ ID: { '!=': features.store.ID }, active: true }));
    if (alternateStore) {
      await tx.run(INSERT.into(RouteRecommendations).entries({
        prediction_ID: prediction.ID,
        fromStore_ID: alternateStore.ID,
        toStore_ID: features.store.ID,
        product_ID: features.product.ID,
        recommendedUnits: Math.max(1, Math.round(output.replenishmentUnits / 2)),
        priority: output.routePriority,
        reasonCode: output.anomalyType,
        status: 'NEW'
      }));
    }
  }

  return prediction;
}

module.exports = {
  scoreLatest,
  modelVersion,
  featureSnapshot,
  normalizeOutput
};

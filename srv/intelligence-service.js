const cds = require('@sap/cds');
const { scoreLatest, modelVersion } = require('./handlers/ml-engine');
const { AiCoreClient } = require('./handlers/ai-core-client');
const datasetUpload = require('./handlers/dataset-upload');

function now() {
  return new Date().toISOString();
}

function isTerminalTrainingStatus(status) {
  return ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status);
}

function errorMessageForStatus(status) {
  return status === 'FAILED' ? 'SAP AI Core execution failed. Check AI Launchpad logs.' : null;
}

function openStatus() {
  return { in: ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'REOPENED'] };
}

function limitOf(req, defaultRows = 20) {
  const rows = req.query && req.query.SELECT && req.query.SELECT.limit && req.query.SELECT.limit.rows;
  const value = rows && (rows.val || rows);
  return Number(value) || defaultRows;
}

function byId(rows) {
  return Object.fromEntries(rows.map(row => [row.ID, row]));
}

function minutesSince(timestamp) {
  if (!timestamp) return null;
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round((Date.now() - value) / 60000));
}

function qualityStatus(metricName, value) {
  const targets = {
    auc: 0.88,
    maeShelfLifeDays: 1.2,
    mapeDemand: 0.18,
    precisionCritical: 0.82
  };
  const targetValue = targets[metricName] || 0;
  const lowerIsBetter = metricName === 'maeShelfLifeDays' || metricName === 'mapeDemand';
  const status = lowerIsBetter
    ? Number(value) <= targetValue ? 'GOOD' : Number(value) <= targetValue * 1.25 ? 'WATCH' : 'BREACH'
    : Number(value) >= targetValue ? 'GOOD' : Number(value) >= targetValue * 0.9 ? 'WATCH' : 'BREACH';
  return { targetValue, status };
}

async function latestSpoilageDemo(tx) {
  const {
    Predictions,
    InferenceRequests,
    MLTrainingRuns,
    MLDeployments,
    Stores,
    Zones,
    Batches,
    Products,
    ReplenishmentRecommendations
  } = cds.entities('freshchain');
  const prediction = await tx.run(SELECT.one.from(Predictions).orderBy('createdAt desc'));
  const inference = await tx.run(SELECT.one.from(InferenceRequests).orderBy('createdAt desc'));
  const training = await tx.run(SELECT.one.from(MLTrainingRuns).orderBy('startedAt desc'));
  const deployment = await tx.run(SELECT.one.from(MLDeployments).orderBy('modifiedAt desc'));
  const replenishment = await tx.run(SELECT.one.from(ReplenishmentRecommendations).orderBy('createdAt desc'));

  const [store, zone, batch] = await Promise.all([
    prediction && prediction.store_ID ? tx.run(SELECT.one.from(Stores).where({ ID: prediction.store_ID })) : null,
    prediction && prediction.zone_ID ? tx.run(SELECT.one.from(Zones).where({ ID: prediction.zone_ID })) : null,
    prediction && prediction.batch_ID ? tx.run(SELECT.one.from(Batches).where({ ID: prediction.batch_ID })) : null
  ]);
  const product = batch && batch.product_ID
    ? await tx.run(SELECT.one.from(Products).where({ ID: batch.product_ID }))
    : null;

  const riskLevel = prediction && prediction.riskLevel || 'PENDING';
  const status = riskLevel === 'CRITICAL' || riskLevel === 'HIGH' ? 'ATTENTION'
    : riskLevel === 'PENDING' ? 'PENDING'
      : 'STABLE';
  const aiCoreReached = inference && inference.status === 'SUCCEEDED';
  const wasteAvoided = replenishment ? Number(replenishment.expectedWasteAvoidedUnits || 0) : 0;
  const lostSalesAvoided = replenishment ? Number(replenishment.expectedLostSalesAvoidedUnits || 0) : 0;
  const proofParts = [
    prediction && `CAP prediction ${prediction.ID}`,
    aiCoreReached && inference && `AI Core inference ${inference.requestId}`,
    training && training.aiCoreExecutionId && `AI Core execution ${training.aiCoreExecutionId}`,
    (deployment && (deployment.aiCoreDeploymentId || deployment.deploymentId)) && `AI Core deployment ${deployment.aiCoreDeploymentId || deployment.deploymentId}`
  ].filter(Boolean);
  return {
    ID: 'current',
    generatedAt: prediction && prediction.createdAt || now(),
    status,
    headline: prediction
      ? `${riskLevel} spoilage risk detected${product && product.name ? ` for ${product.name}` : ''}`
      : 'Run the demo to generate a live spoilage-prevention recommendation',
    storeName: store && store.name || 'No store scored yet',
    zoneName: zone && zone.name || 'No zone scored yet',
    productName: product && product.name || 'No product scored yet',
    riskLevel,
    score: prediction && prediction.score || 0,
    confidence: prediction && prediction.confidence || 0,
    remainingShelfLifeDays: prediction && prediction.remainingShelfLifeDays || 0,
    demandUnitsForecast: prediction && prediction.demandUnitsForecast || 0,
    replenishmentUnits: prediction && prediction.replenishmentUnits || 0,
    expectedWasteAvoidedUnits: wasteAvoided || 0,
    expectedLostSalesAvoidedUnits: lostSalesAvoided || 0,
    recommendedAction: prediction && prediction.recommendedAction || 'Generate realistic sensor and sales data, score a cold-chain zone, and review the ML recommendation.',
    aiCoreStatus: aiCoreReached ? 'Reached' : inference && inference.status || 'Not scored',
    aiCoreExecutionId: training && training.aiCoreExecutionId,
    aiCoreDeploymentId: deployment && deployment.aiCoreDeploymentId || prediction && prediction.deploymentId,
    inferenceLatencyMs: inference && inference.latencyMs || 0,
    platformProof: proofParts.length ? proofParts.join(' | ') : 'Awaiting live proof'
  };
}

async function latestDemoZoneId(tx) {
  const { SensorReadings, InventoryPlacements, Zones } = cds.entities('freshchain');
  const incidents = await tx.run(
    SELECT.from(SensorReadings)
      .where({ scenarioCode: { '!=': 'NORMAL' } })
      .orderBy('measuredAt desc')
      .limit(50)
  );
  for (const incident of incidents) {
    if (!incident.zone_ID) continue;
    const placement = await tx.run(SELECT.one.from(InventoryPlacements).where({ zone_ID: incident.zone_ID, active: true }));
    if (placement) return incident.zone_ID;
  }
  const reading = await tx.run(SELECT.one.from(SensorReadings).orderBy('measuredAt desc'));
  if (!reading || !reading.zone_ID) return null;
  const zone = await tx.run(SELECT.one.from(Zones).where({ ID: reading.zone_ID, active: true }));
  return zone && zone.ID;
}

async function runSpoilagePreventionDemo(tx, _input = {}, req) {
  const zoneId = await latestDemoZoneId(tx);
  if (!zoneId && req) {
    req.reject(409, 'No live incoming sensor reading is available for AI Core scoring. Start FreshChain Live and create a reading first.');
  }
  const prediction = await scoreLatest(tx, { zoneId });
  if (prediction && prediction.failed && req) req.reject(prediction.error.statusCode || 502, prediction.error.message);
  return latestSpoilageDemo(tx);
}

async function dashboardContext(tx) {
  const {
    Stores,
    Zones,
    Products,
    SensorReadings,
    Alerts,
    Predictions,
    MLDeployments,
    InferenceRequests
  } = cds.entities('freshchain');
  const [stores, zones, products, readings, alerts, predictions, deployments, inferences] = await Promise.all([
    tx.run(SELECT.from(Stores).where({ active: true })),
    tx.run(SELECT.from(Zones).where({ active: true })),
    tx.run(SELECT.from(Products)),
    tx.run(SELECT.from(SensorReadings).orderBy('measuredAt desc').limit(50)),
    tx.run(SELECT.from(Alerts).where({ status: openStatus() })),
    tx.run(SELECT.from(Predictions).orderBy('createdAt desc').limit(50)),
    tx.run(SELECT.from(MLDeployments).orderBy('modifiedAt desc').limit(10)),
    tx.run(SELECT.from(InferenceRequests).orderBy('createdAt desc').limit(50))
  ]);
  return {
    stores,
    zones,
    products,
    readings,
    alerts,
    predictions,
    deployments,
    inferences,
    storeById: byId(stores),
    productById: byId(products)
  };
}

function overviewRow(context) {
  const latestPrediction = context.predictions[0] || {};
  const relevantInferences = context.inferences;
  const highestRisk = latestPrediction.riskLevel || 'LOW';
  const aiFailureRate = relevantInferences.length
    ? relevantInferences.filter(row => row.status === 'FAILED').length / relevantInferences.length
    : 0;
  const activeDeployment = context.deployments.find(row => row.status === 'SUCCEEDED') || context.deployments[0] || {};
  const status = context.alerts.some(a => a.severity === 'CRITICAL') ? 'CRITICAL'
    : context.alerts.some(a => a.severity === 'HIGH') ? 'ATTENTION'
      : 'HEALTHY';

  return {
    ID: 'current',
    generatedAt: now(),
    status,
    stores: context.stores.length,
    zones: context.zones.length,
    activeAlerts: context.alerts.length,
    criticalAlerts: context.alerts.filter(a => a.severity === 'CRITICAL').length,
    highAlerts: context.alerts.filter(a => a.severity === 'HIGH').length,
    highestRisk,
    latestReadingAt: context.readings[0] && context.readings[0].measuredAt,
    aiFailureRate: Math.round(aiFailureRate * 1000) / 1000,
    inferenceCount: relevantInferences.length,
    activeDeploymentId: activeDeployment.deploymentId || null,
    modelVersion: activeDeployment.modelVersion || null,
    deploymentHealth: activeDeployment.healthStatus || 'NOT_DEPLOYED'
  };
}

async function readForecastDashboard(tx, req) {
  const { Stores, Products, DemandForecasts } = cds.entities('freshchain');
  const [stores, products, forecasts] = await Promise.all([
    tx.run(SELECT.from(Stores)),
    tx.run(SELECT.from(Products)),
    tx.run(SELECT.from(DemandForecasts).orderBy('createdAt desc').limit(limitOf(req, 20)))
  ]);
  const storeById = byId(stores);
  const productById = byId(products);
  return forecasts.map(row => ({
    ID: row.ID,
    createdAt: row.createdAt,
    storeName: storeById[row.store_ID] && storeById[row.store_ID].name,
    productName: productById[row.product_ID] && productById[row.product_ID].name,
    forecastDate: row.forecastDate,
    horizonDays: row.horizonDays,
    forecastUnits: row.forecastUnits,
    lowerBoundUnits: row.lowerBoundUnits,
    upperBoundUnits: row.upperBoundUnits,
    confidence: row.confidence
  }));
}

async function readReplenishmentDashboard(tx, req) {
  const { Stores, Products, ReplenishmentRecommendations } = cds.entities('freshchain');
  const [stores, products, rows] = await Promise.all([
    tx.run(SELECT.from(Stores)),
    tx.run(SELECT.from(Products)),
    tx.run(SELECT.from(ReplenishmentRecommendations).orderBy('createdAt desc', 'priority asc').limit(limitOf(req, 20)))
  ]);
  const storeById = byId(stores);
  const productById = byId(products);
  return rows.map(row => ({
    ID: row.ID,
    createdAt: row.createdAt,
    storeName: storeById[row.store_ID] && storeById[row.store_ID].name,
    productName: productById[row.product_ID] && productById[row.product_ID].name,
    recommendedUnits: row.recommendedUnits,
    priority: row.priority,
    reasonCode: row.reasonCode,
    expectedWasteAvoidedUnits: row.expectedWasteAvoidedUnits,
    expectedLostSalesAvoidedUnits: row.expectedLostSalesAvoidedUnits,
    status: row.status
  }));
}

async function readRouteDashboard(tx, req) {
  const { Stores, Products, RouteRecommendations } = cds.entities('freshchain');
  const [stores, products, rows] = await Promise.all([
    tx.run(SELECT.from(Stores)),
    tx.run(SELECT.from(Products)),
    tx.run(SELECT.from(RouteRecommendations).orderBy('createdAt desc', 'priority asc').limit(limitOf(req, 20)))
  ]);
  const storeById = byId(stores);
  const productById = byId(products);
  return rows.map(row => ({
    ID: row.ID,
    createdAt: row.createdAt,
    fromStoreName: storeById[row.fromStore_ID] && storeById[row.fromStore_ID].name,
    toStoreName: storeById[row.toStore_ID] && storeById[row.toStore_ID].name,
    productName: productById[row.product_ID] && productById[row.product_ID].name,
    recommendedUnits: row.recommendedUnits,
    priority: row.priority,
    reasonCode: row.reasonCode,
    status: row.status
  }));
}

async function readModelQualityDashboard(tx, req) {
  const { ModelMetrics, MLTrainingRuns } = cds.entities('freshchain');
  const [metrics, runs] = await Promise.all([
    tx.run(SELECT.from(ModelMetrics).orderBy('measuredAt desc').limit(limitOf(req, 20))),
    tx.run(SELECT.from(MLTrainingRuns))
  ]);
  const runById = byId(runs);
  return metrics.map(row => {
    const quality = qualityStatus(row.metricName, row.metricValue);
    const run = runById[row.trainingRun_ID] || {};
    return {
      ID: row.ID,
      metricName: row.metricName,
      metricValue: row.metricValue,
      targetValue: quality.targetValue,
      status: quality.status,
      measuredAt: row.measuredAt,
      segment: row.segment,
      trainingRunId: run.runId
    };
  });
}

async function readScenarioMix(tx) {
  const { SensorReadings } = cds.entities('freshchain');
  const readings = await tx.run(SELECT.from(SensorReadings).columns('scenarioCode', 'sourceMessageId'));
  const totals = readings.reduce((acc, row) => {
    const scenario = row.scenarioCode || 'UNKNOWN';
    acc[scenario] = acc[scenario] || { scenarioCode: scenario, readingCount: 0, incidentCount: 0 };
    acc[scenario].readingCount += 1;
    if (scenario !== 'NORMAL') acc[scenario].incidentCount += 1;
    return acc;
  }, {});
  const totalReadings = Math.max(1, readings.length);
  return Object.values(totals)
    .sort((left, right) => right.readingCount - left.readingCount)
    .map(row => {
      const incidentShare = row.incidentCount / totalReadings;
      return {
        ID: row.scenarioCode,
        scenarioCode: row.scenarioCode,
        readingCount: row.readingCount,
        incidentCount: row.incidentCount,
        incidentShare: Math.round(incidentShare * 1000) / 1000,
        severityHint: row.scenarioCode === 'COMPRESSOR_FAILURE' ? 'CRITICAL'
          : row.scenarioCode === 'NORMAL' ? 'LOW'
            : incidentShare >= 0.08 ? 'HIGH' : 'MEDIUM'
      };
    });
}

async function readDataFreshness(tx) {
  const { SensorReadings, InferenceRequests, Sensors } = cds.entities('freshchain');
  const [latestReading, latestInference, sensors] = await Promise.all([
    tx.run(SELECT.one.from(SensorReadings).orderBy('measuredAt desc')),
    tx.run(SELECT.one.from(InferenceRequests).orderBy('createdAt desc')),
    tx.run(SELECT.from(Sensors))
  ]);
  const staleSensors = sensors.filter(row => row.healthStatus === 'STALE' || row.healthStatus === 'FAILED').length;
  const minutesSinceReading = minutesSince(latestReading && latestReading.measuredAt);
  const minutesSinceInference = minutesSince(latestInference && latestInference.createdAt);
  const health = staleSensors > 0 || minutesSinceReading === null || minutesSinceReading > 180 ? 'BREACH'
    : minutesSinceInference === null || minutesSinceInference > 180 ? 'WATCH'
      : 'GOOD';
  const message = health === 'BREACH'
    ? 'Sensor coverage needs attention before automated decisions are trusted.'
    : health === 'WATCH'
      ? 'Sensor data is current; run inference to refresh ML decisions.'
      : 'Sensor and inference telemetry are current.';
  return [{
    ID: 'current',
    latestReadingAt: latestReading && latestReading.measuredAt,
    latestInferenceAt: latestInference && latestInference.createdAt,
    sensorCount: sensors.length,
    staleSensors,
    minutesSinceReading,
    minutesSinceInference,
    health,
    message
  }];
}

async function readOverviewMetrics(req) {
  const context = await dashboardContext(cds.tx(req));
  return [overviewRow(context)];
}

async function readRiskTrend(req) {
  const { Predictions } = cds.entities('freshchain');
  const rows = await cds.tx(req).run(SELECT.from(Predictions).orderBy('createdAt desc').limit(limitOf(req, 20)));

  return rows.map(row => ({
    ID: row.ID,
    zoneId: row.zone_ID,
    createdAt: row.createdAt,
    riskLevel: row.riskLevel,
    score: row.score,
    anomalyType: row.anomalyType,
    recommendedAction: row.recommendedAction
  }));
}

async function readInferenceTelemetry(req) {
  const { InferenceRequests, MLDeployments } = cds.entities('freshchain');
  const tx = cds.tx(req);
  const [rows, deployments] = await Promise.all([
    tx.run(SELECT.from(InferenceRequests).orderBy('createdAt desc').limit(limitOf(req, 20))),
    tx.run(SELECT.from(MLDeployments))
  ]);
  const deploymentById = byId(deployments);

  return rows.map(row => ({
    ID: row.ID,
    createdAt: row.createdAt,
    requestId: row.requestId,
    status: row.status,
    latencyMs: row.latencyMs,
    aiCoreUnavailable: row.status === 'FAILED',
    errorMessage: row.errorMessage,
    deploymentId: deploymentById[row.deployment_ID] && deploymentById[row.deployment_ID].deploymentId
  }));
}

async function readSpoilagePreventionDemo(req) {
  const row = await latestSpoilageDemo(cds.tx(req));
  if (req.query && req.query.SELECT && req.query.SELECT.one) return row;
  return [row];
}

function readForecastDashboardForRequest(req) {
  return readForecastDashboard(cds.tx(req), req);
}

function readReplenishmentDashboardForRequest(req) {
  return readReplenishmentDashboard(cds.tx(req), req);
}

function readRouteDashboardForRequest(req) {
  return readRouteDashboard(cds.tx(req), req);
}

function readModelQualityDashboardForRequest(req) {
  return readModelQualityDashboard(cds.tx(req), req);
}

function readScenarioMixForRequest(req) {
  return readScenarioMix(cds.tx(req));
}

function readDataFreshnessForRequest(req) {
  return readDataFreshness(cds.tx(req));
}

async function getOverview(req) {
  const tx = cds.tx(req);
  const context = await dashboardContext(tx);
  const metrics = overviewRow(context);
  return JSON.stringify({
    generatedAt: now(),
    health: {
      status: metrics.status,
      stores: metrics.stores,
      zones: metrics.zones,
      activeAlerts: metrics.activeAlerts,
      criticalAlerts: metrics.criticalAlerts,
      highAlerts: metrics.highAlerts,
      highestRisk: metrics.highestRisk,
      latestReadingAt: metrics.latestReadingAt
    },
    ml: {
      activeDeployment: context.deployments[0] || null,
      inferenceCount: metrics.inferenceCount,
      aiFailureRate: metrics.aiFailureRate,
      latestPrediction: context.predictions[0] || null
    },
    forecasts: await readForecastDashboard(tx, { query: { SELECT: { limit: { rows: { val: 10 } } } } }),
    replenishments: await readReplenishmentDashboard(tx, { query: { SELECT: { limit: { rows: { val: 10 } } } } }),
    routes: await readRouteDashboard(tx, { query: { SELECT: { limit: { rows: { val: 10 } } } } }),
    riskTrend: context.predictions.slice(0, 12).map(row => ({
      ID: row.ID,
      createdAt: row.createdAt,
      riskLevel: row.riskLevel,
      score: row.score,
      anomalyType: row.anomalyType,
      action: row.recommendedAction
    })),
    alerts: context.alerts.slice(0, 10)
  });
}

async function scoreLatestReading(req) {
  const prediction = await cds.tx(tx => scoreLatest(tx, req.data));
  if (prediction && prediction.failed) {
    return req.reject(prediction.error.statusCode || 502, prediction.error.message);
  }
  if (!prediction) return req.reject(404, `No zone found for ${req.data.zoneId}`);

  return prediction;
}

function runSpoilagePreventionDemoAction(req) {
  return runSpoilagePreventionDemo(cds.tx(req), req.data, req);
}

function downloadDatasetPackageTemplate() {
  return datasetUpload.datasetPackageTemplate();
}

async function uploadDatasetPackage(req) {
  try {
    return await datasetUpload.uploadDatasetPackage(cds.tx(req), req.data);
  } catch (error) {
    return req.reject(error.statusCode || 400, error.message);
  }
}

async function validateDatasetPackage(req) {
  try {
    return await datasetUpload.validateDatasetPackage(cds.tx(req), req.data.uploadId);
  } catch (error) {
    return req.reject(error.statusCode || 400, error.message);
  }
}

async function importDatasetPackage(req) {
  try {
    return await datasetUpload.importDatasetPackage(cds.tx(req), req.data.uploadId);
  } catch (error) {
    return req.reject(error.statusCode || 400, error.message);
  }
}

async function deleteDatasetUpload(req) {
  try {
    return await datasetUpload.deleteDatasetUpload(cds.tx(req), req.data.uploadId);
  } catch (error) {
    return req.reject(error.statusCode || 400, error.message);
  }
}

async function runAiCoreOperation(req, operation) {
  try {
    return await operation(new AiCoreClient());
  } catch (error) {
    return req.reject(error.statusCode || 502, error.message);
  }
}

function metricsFromExecution(execution) {
  const payloadMetrics = execution.payload && execution.payload.metrics;
  return Array.isArray(payloadMetrics) ? payloadMetrics
    : Array.isArray(execution.metrics) ? execution.metrics
      : [];
}

async function insertModelMetrics(tx, ModelMetrics, trainingRunId, metrics) {
  for (const metric of metrics) {
    const metricName = metric.name || metric.metricName;
    const metricValue = Number(metric.value || metric.metricValue);
    if (!metricName || !Number.isFinite(metricValue)) continue;

    await tx.run(INSERT.into(ModelMetrics).entries({
      trainingRun_ID: trainingRunId,
      metricName,
      metricValue,
      segment: metric.segment || 'global',
      measuredAt: now()
    }));
  }
}

async function startTraining(req) {
  const { MLDatasets, MLTrainingRuns, ModelMetrics } = cds.entities('freshchain');
  const tx = cds.tx(req);
  const dataset = await tx.run(SELECT.one.from(MLDatasets).where({ datasetCode: req.data.datasetCode }));
  if (!dataset) return req.reject(404, `Dataset ${req.data.datasetCode} not found`);

  const execution = await runAiCoreOperation(req, client => client.createExecution(dataset));
  const runId = `freshchain-train-${Date.now()}`;
  const version = modelVersion();
  await tx.run(INSERT.into(MLTrainingRuns).entries({
    runId,
    dataset_ID: dataset.ID,
    modelName: 'freshchain-intelligence',
    modelVersion: version,
    status: execution.status,
    aiCoreExecutionId: execution.executionId,
    startedAt: now(),
    completedAt: isTerminalTrainingStatus(execution.status) ? now() : null,
    metrics: JSON.stringify(execution.payload || {}),
    errorMessage: errorMessageForStatus(execution.status)
  }));

  const run = await tx.run(SELECT.one.from(MLTrainingRuns).where({ runId }));
  await insertModelMetrics(tx, ModelMetrics, run.ID, metricsFromExecution(execution));
  return run;
}

async function activateDeployment(req) {
  const { MLTrainingRuns, MLDeployments } = cds.entities('freshchain');
  const tx = cds.tx(req);
  const run = await tx.run(SELECT.one.from(MLTrainingRuns).where({ ID: req.data.trainingRunId }));
  if (!run) return req.reject(404, `Training run ${req.data.trainingRunId} not found`);
  if (!run.aiCoreExecutionId) return req.reject(409, 'Training run does not have an SAP AI Core execution ID');

  const deployment = await runAiCoreOperation(req, client => client.createDeployment(run));
  const deploymentId = deployment.deploymentId || `freshchain-live-${Date.now()}`;
  await tx.run(INSERT.into(MLDeployments).entries({
    deploymentId,
    trainingRun_ID: run.ID,
    modelName: run.modelName,
    modelVersion: run.modelVersion,
    status: deployment.status,
    aiCoreDeploymentId: deployment.deploymentId,
    endpointUrl: deployment.endpointUrl,
    healthStatus: deployment.healthStatus || (deployment.status === 'SUCCEEDED' ? 'ONLINE' : deployment.status),
  }));

  return tx.run(SELECT.one.from(MLDeployments).where({ deploymentId }));
}

async function refreshTrainingRun(req) {
  const { MLTrainingRuns, ModelMetrics } = cds.entities('freshchain');
  const tx = cds.tx(req);
  const run = await tx.run(SELECT.one.from(MLTrainingRuns).where({ ID: req.data.trainingRunId }));
  if (!run) return req.reject(404, `Training run ${req.data.trainingRunId} not found`);
  if (!run.aiCoreExecutionId) return req.reject(409, 'Training run does not have an SAP AI Core execution ID');

  const execution = await runAiCoreOperation(req, client => client.getExecution(run.aiCoreExecutionId));
  await tx.run(UPDATE(MLTrainingRuns).set({
    status: execution.status,
    completedAt: isTerminalTrainingStatus(execution.status) ? now() : run.completedAt,
    metrics: JSON.stringify(execution.payload || {}),
    errorMessage: errorMessageForStatus(execution.status)
  }).where({ ID: run.ID }));
  await insertModelMetrics(tx, ModelMetrics, run.ID, metricsFromExecution(execution));
  return tx.run(SELECT.one.from(MLTrainingRuns).where({ ID: run.ID }));
}

async function refreshDeployment(req) {
  const { MLDeployments } = cds.entities('freshchain');
  const tx = cds.tx(req);
  const row = await tx.run(SELECT.one.from(MLDeployments).where({ ID: req.data.deploymentId }));
  if (!row) return req.reject(404, `Deployment ${req.data.deploymentId} not found`);
  if (!row.aiCoreDeploymentId) return req.reject(409, 'Deployment does not have an SAP AI Core deployment ID');

  const deployment = await runAiCoreOperation(req, client => client.getDeployment(row.aiCoreDeploymentId));
  await tx.run(UPDATE(MLDeployments).set({
    status: deployment.status,
    endpointUrl: deployment.endpointUrl || row.endpointUrl,
    healthStatus: deployment.healthStatus || (deployment.status === 'SUCCEEDED' ? 'ONLINE' : deployment.status),
  }).where({ ID: row.ID }));

  return tx.run(SELECT.one.from(MLDeployments).where({ ID: row.ID }));
}

module.exports = cds.service.impl(function IntelligenceService() {
  this.on('READ', 'OverviewMetrics', readOverviewMetrics);
  this.on('READ', 'RiskTrend', readRiskTrend);
  this.on('READ', 'ForecastDashboard', readForecastDashboardForRequest);
  this.on('READ', 'ReplenishmentDashboard', readReplenishmentDashboardForRequest);
  this.on('READ', 'RouteDashboard', readRouteDashboardForRequest);
  this.on('READ', 'InferenceTelemetry', readInferenceTelemetry);
  this.on('READ', 'ModelQualityDashboard', readModelQualityDashboardForRequest);
  this.on('READ', 'ScenarioMix', readScenarioMixForRequest);
  this.on('READ', 'DataFreshness', readDataFreshnessForRequest);
  this.on('READ', 'SpoilagePreventionDemo', readSpoilagePreventionDemo);

  this.on('getOverview', getOverview);
  this.on('scoreLatest', scoreLatestReading);
  this.on('runSpoilagePreventionDemo', runSpoilagePreventionDemoAction);
  this.on('runDemo', 'SpoilagePreventionDemo', runSpoilagePreventionDemoAction);
  this.on('uploadDatasetPackage', uploadDatasetPackage);
  this.on('downloadDatasetPackageTemplate', downloadDatasetPackageTemplate);
  this.on('validateDatasetPackage', validateDatasetPackage);
  this.on('importDatasetPackage', importDatasetPackage);
  this.on('deleteDatasetUpload', deleteDatasetUpload);
  this.on('startTraining', startTraining);
  this.on('activateDeployment', activateDeployment);
  this.on('refreshTrainingRun', refreshTrainingRun);
  this.on('refreshDeployment', refreshDeployment);

  const {
    ReplenishmentRecommendations,
    RouteRecommendations
  } = cds.entities('freshchain');

  async function updateRecommendationStatus(req, entity, nextStatus, label) {
    const tx = cds.tx(req);
    const recommendationId = req.data.recommendationId;
    const row = await tx.run(SELECT.one.from(entity).where({ ID: recommendationId }));
    if (!row) return req.reject(404, `${label} ${recommendationId} not found`);

    await tx.run(UPDATE(entity).set({ status: nextStatus }).where({ ID: recommendationId }));
    return tx.run(SELECT.one.from(entity).where({ ID: recommendationId }));
  }

  function applyReplenishmentRecommendation(req) {
    return updateRecommendationStatus(req, ReplenishmentRecommendations, 'APPLIED', 'Replenishment recommendation');
  }

  function rejectReplenishmentRecommendation(req) {
    return updateRecommendationStatus(req, ReplenishmentRecommendations, 'REJECTED', 'Replenishment recommendation');
  }

  function applyRouteRecommendation(req) {
    return updateRecommendationStatus(req, RouteRecommendations, 'APPLIED', 'Route recommendation');
  }

  function rejectRouteRecommendation(req) {
    return updateRecommendationStatus(req, RouteRecommendations, 'REJECTED', 'Route recommendation');
  }

  this.on('applyReplenishmentRecommendation', applyReplenishmentRecommendation);
  this.on('rejectReplenishmentRecommendation', rejectReplenishmentRecommendation);
  this.on('applyRouteRecommendation', applyRouteRecommendation);
  this.on('rejectRouteRecommendation', rejectRouteRecommendation);
});

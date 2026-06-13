const cds = require('@sap/cds');
const { scoreLatest, modelVersion } = require('./handlers/ml-engine');
const { seedDemoData } = require('./handlers/mock-data');
const { AiCoreClient } = require('./handlers/ai-core-client');
const datasetUpload = require('./handlers/dataset-upload');

function now() {
  return new Date().toISOString();
}

function openStatus() {
  return { in: ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'REOPENED'] };
}

function limitOf(req, fallback = 20) {
  const rows = req.query && req.query.SELECT && req.query.SELECT.limit && req.query.SELECT.limit.rows;
  const value = rows && (rows.val || rows);
  return Number(value) || fallback;
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
  const localMode = latestPrediction.deploymentId === 'freshchain-local';
  const relevantInferences = localMode ? context.inferences.filter(row => !row.deployment_ID) : context.inferences;
  const highestRisk = latestPrediction.riskLevel || 'LOW';
  const aiFailureRate = relevantInferences.length
    ? relevantInferences.filter(row => row.status === 'FAILED').length / relevantInferences.length
    : 0;
  const activeDeployment = localMode
    ? {
        deploymentId: latestPrediction.deploymentId,
        modelVersion: latestPrediction.modelVersion,
        healthStatus: relevantInferences[0] && relevantInferences[0].status === 'SUCCEEDED' ? 'ONLINE' : 'UNAVAILABLE'
      }
    : context.deployments.find(row => row.status === 'SUCCEEDED') || context.deployments[0] || {};
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

module.exports = cds.service.impl(function () {
  this.on('READ', 'OverviewMetrics', async req => {
    const context = await dashboardContext(cds.tx(req));
    return [overviewRow(context)];
  });

  this.on('READ', 'RiskTrend', async req => {
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
  });

  this.on('READ', 'ForecastDashboard', req => readForecastDashboard(cds.tx(req), req));
  this.on('READ', 'ReplenishmentDashboard', req => readReplenishmentDashboard(cds.tx(req), req));
  this.on('READ', 'RouteDashboard', req => readRouteDashboard(cds.tx(req), req));

  this.on('READ', 'InferenceTelemetry', async req => {
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
  });

  this.on('READ', 'ModelQualityDashboard', req => readModelQualityDashboard(cds.tx(req), req));
  this.on('READ', 'ScenarioMix', req => readScenarioMix(cds.tx(req)));
  this.on('READ', 'DataFreshness', req => readDataFreshness(cds.tx(req)));

  this.on('getOverview', async req => {
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
  });

  this.on('scoreLatest', async req => {
    const prediction = await cds.tx(tx => scoreLatest(tx, req.data));
    if (prediction && prediction.failed) req.reject(prediction.error.statusCode || 502, prediction.error.message);
    if (!prediction) req.reject(404, `No zone found for ${req.data.zoneId}`);
    return prediction;
  });

  this.on('seedDemoData', async req => {
    const tx = cds.tx(req);
    const result = await seedDemoData(tx, req.data);
    return JSON.stringify(result);
  });

  this.on('uploadDatasetPackage', async req => {
    try {
      return await datasetUpload.uploadDatasetPackage(cds.tx(req), req.data);
    } catch (error) {
      req.reject(error.statusCode || 400, error.message);
    }
  });

  this.on('downloadDatasetPackageTemplate', () => datasetUpload.datasetPackageTemplate());

  this.on('validateDatasetPackage', async req => {
    try {
      return await datasetUpload.validateDatasetPackage(cds.tx(req), req.data.uploadId);
    } catch (error) {
      req.reject(error.statusCode || 400, error.message);
    }
  });

  this.on('importDatasetPackage', async req => {
    try {
      return await datasetUpload.importDatasetPackage(cds.tx(req), req.data.uploadId);
    } catch (error) {
      req.reject(error.statusCode || 400, error.message);
    }
  });

  this.on('deleteDatasetUpload', async req => {
    try {
      return await datasetUpload.deleteDatasetUpload(cds.tx(req), req.data.uploadId);
    } catch (error) {
      req.reject(error.statusCode || 400, error.message);
    }
  });

  this.on('startTraining', async req => {
    const { MLDatasets, MLTrainingRuns, ModelMetrics } = cds.entities('freshchain');
    const tx = cds.tx(req);
    const dataset = await tx.run(SELECT.one.from(MLDatasets).where({ datasetCode: req.data.datasetCode }));
    if (!dataset) req.reject(404, `Dataset ${req.data.datasetCode} not found`);

    const runId = `freshchain-train-${Date.now()}`;
    const version = modelVersion();
    let execution;
    try {
      execution = await new AiCoreClient().createExecution(dataset);
    } catch (error) {
      req.reject(error.statusCode || 502, error.message);
    }

    await tx.run(INSERT.into(MLTrainingRuns).entries({
      runId,
      dataset_ID: dataset.ID,
      modelName: 'freshchain-intelligence',
      modelVersion: version,
      status: execution.status,
      aiCoreExecutionId: execution.executionId,
      startedAt: now(),
      completedAt: ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(execution.status) ? now() : null,
      metrics: JSON.stringify(execution.payload || {}),
      errorMessage: execution.status === 'FAILED' ? 'SAP AI Core execution failed. Check AI Launchpad logs.' : null
    }));

    const run = await tx.run(SELECT.one.from(MLTrainingRuns).where({ runId }));
    const metrics = Array.isArray(execution.payload && execution.payload.metrics) ? execution.payload.metrics : [];
    for (const metric of metrics) {
      const metricName = metric.name || metric.metricName;
      const metricValue = Number(metric.value || metric.metricValue);
      if (!metricName || !Number.isFinite(metricValue)) continue;
      await tx.run(INSERT.into(ModelMetrics).entries({
        trainingRun_ID: run.ID,
        metricName,
        metricValue,
        segment: metric.segment || 'global',
        measuredAt: now()
      }));
    }
    return run;
  });

  this.on('activateDeployment', async req => {
    const { MLTrainingRuns, MLDeployments } = cds.entities('freshchain');
    const tx = cds.tx(req);
    const run = await tx.run(SELECT.one.from(MLTrainingRuns).where({ ID: req.data.trainingRunId }));
    if (!run) req.reject(404, `Training run ${req.data.trainingRunId} not found`);
    if (!run.aiCoreExecutionId) req.reject(409, 'Training run does not have an SAP AI Core execution ID');
    let deployment;
    try {
      deployment = await new AiCoreClient().createDeployment(run);
    } catch (error) {
      req.reject(error.statusCode || 502, error.message);
    }
    const deploymentId = deployment.deploymentId || `freshchain-live-${Date.now()}`;
    await tx.run(INSERT.into(MLDeployments).entries({
      deploymentId,
      trainingRun_ID: run.ID,
      modelName: run.modelName,
      modelVersion: run.modelVersion,
      status: deployment.status,
      aiCoreDeploymentId: deployment.deploymentId,
      endpointUrl: deployment.endpointUrl,
      healthStatus: deployment.status === 'SUCCEEDED' ? 'ONLINE' : deployment.status,
    }));
    return tx.run(SELECT.one.from(MLDeployments).where({ deploymentId }));
  });

  this.on('refreshTrainingRun', async req => {
    const { MLTrainingRuns, ModelMetrics } = cds.entities('freshchain');
    const tx = cds.tx(req);
    const run = await tx.run(SELECT.one.from(MLTrainingRuns).where({ ID: req.data.trainingRunId }));
    if (!run) req.reject(404, `Training run ${req.data.trainingRunId} not found`);
    if (!run.aiCoreExecutionId) req.reject(409, 'Training run does not have an SAP AI Core execution ID');
    let execution;
    try {
      execution = await new AiCoreClient().getExecution(run.aiCoreExecutionId);
    } catch (error) {
      req.reject(error.statusCode || 502, error.message);
    }
    await tx.run(UPDATE(MLTrainingRuns).set({
      status: execution.status,
      completedAt: ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(execution.status) ? now() : run.completedAt,
      metrics: JSON.stringify(execution.payload || {}),
      errorMessage: execution.status === 'FAILED' ? 'SAP AI Core execution failed. Check AI Launchpad logs.' : null
    }).where({ ID: run.ID }));
    for (const metric of execution.metrics || []) {
      const metricName = metric.name || metric.metricName;
      const metricValue = Number(metric.value || metric.metricValue);
      if (!metricName || !Number.isFinite(metricValue)) continue;
      await tx.run(INSERT.into(ModelMetrics).entries({
        trainingRun_ID: run.ID,
        metricName,
        metricValue,
        segment: metric.segment || 'global',
        measuredAt: now()
      }));
    }
    return tx.run(SELECT.one.from(MLTrainingRuns).where({ ID: run.ID }));
  });

  this.on('refreshDeployment', async req => {
    const { MLDeployments } = cds.entities('freshchain');
    const tx = cds.tx(req);
    const row = await tx.run(SELECT.one.from(MLDeployments).where({ ID: req.data.deploymentId }));
    if (!row) req.reject(404, `Deployment ${req.data.deploymentId} not found`);
    if (!row.aiCoreDeploymentId) req.reject(409, 'Deployment does not have an SAP AI Core deployment ID');
    let deployment;
    try {
      deployment = await new AiCoreClient().getDeployment(row.aiCoreDeploymentId);
    } catch (error) {
      req.reject(error.statusCode || 502, error.message);
    }
    await tx.run(UPDATE(MLDeployments).set({
      status: deployment.status,
      endpointUrl: deployment.endpointUrl || row.endpointUrl,
      healthStatus: deployment.status === 'SUCCEEDED' ? 'ONLINE' : deployment.status,
    }).where({ ID: row.ID }));
    return tx.run(SELECT.one.from(MLDeployments).where({ ID: row.ID }));
  });

  async function updateRecommendation(req, entityName, id, status) {
    const tx = cds.tx(req);
    const entity = cds.entities('freshchain')[entityName];
    const row = await tx.run(SELECT.one.from(entity).where({ ID: id }));
    if (!row) req.reject(404, `${entityName} ${id} not found`);
    await tx.run(UPDATE(entity).set({ status }).where({ ID: id }));
    return tx.run(SELECT.one.from(entity).where({ ID: id }));
  }

  this.on('applyReplenishmentRecommendation', req =>
    updateRecommendation(req, 'ReplenishmentRecommendations', req.data.recommendationId, 'APPLIED'));
  this.on('rejectReplenishmentRecommendation', req =>
    updateRecommendation(req, 'ReplenishmentRecommendations', req.data.recommendationId, 'REJECTED'));
  this.on('applyRouteRecommendation', req =>
    updateRecommendation(req, 'RouteRecommendations', req.data.recommendationId, 'APPLIED'));
  this.on('rejectRouteRecommendation', req =>
    updateRecommendation(req, 'RouteRecommendations', req.data.recommendationId, 'REJECTED'));
});

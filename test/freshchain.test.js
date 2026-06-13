const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const cds = require('@sap/cds');

const { GET, POST } = cds.test(__dirname + '/..');
let aiCoreServer;
let aiCoreBaseUrl;
let inferenceFails = false;

function zipPackage(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  Object.entries(files).forEach(([name, content]) => {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuffer.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  });
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDirectory, eocd]).toString('base64');
}

function validDatasetPackage(messageId = `UPLOAD-${Date.now()}`) {
  const measuredAt = new Date().toISOString();
  return zipPackage({
    'sensor_readings.csv': [
      'messageId,storeCode,zoneCode,sensorId,measuredAt,temperatureC,humidityPct,co2Ppm,oxygenPct,lightLux,doorOpen,scenarioCode',
      `${messageId},ST001,ZN_DAIRY_01,UPLOAD_SENSOR_001,${measuredAt},4.4,62,820,20.8,120,false,NORMAL`
    ].join('\n'),
    'sales_observations.csv': [
      'storeCode,sku,businessDate,unitsSold,unitsWasted,averagePrice,promotionActive,weatherCode',
      'ST001,MILK-1L,2026-05-28,21,1,3.79,false,CLEAR'
    ].join('\n'),
    'metadata.csv': [
      'key,value',
      'datasetCode,science-upload',
      'description,Data science upload package',
      'historyDays,1',
      'anomalyRate,0'
    ].join('\n')
  });
}

function aiPrediction() {
  return {
    predictionType: 'REAL_TIME_INTELLIGENCE',
    riskLevel: 'HIGH',
    score: 0.72,
    confidence: 0.91,
    anomalyType: 'TEMPERATURE_EXCURSION',
    remainingShelfLifeDays: 1.7,
    demandUnitsForecast: 18.5,
    replenishmentUnits: 24,
    routePriority: 2,
    recommendedAction: 'Prioritize markdown or rotation for affected batches and inspect airflow.',
    businessImpact: {
      expectedWasteAvoidedUnits: 4,
      expectedLostSalesAvoidedUnits: 3
    }
  };
}

test.before(async () => {
  aiCoreServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/oauth/token') {
        res.end(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v2/lm/executions') {
        res.end(JSON.stringify({
          id: 'exec-test-1',
          status: 'SUCCEEDED',
          metrics: [
            { name: 'auc', value: 0.91, segment: 'global' },
            { name: 'maeShelfLifeDays', value: 0.84, segment: 'global' },
            { name: 'mapeDemand', value: 0.13, segment: 'global' },
            { name: 'precisionCritical', value: 0.88, segment: 'global' }
          ]
        }));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/v2/lm/executions/')) {
        res.end(JSON.stringify({ id: 'exec-test-1', status: 'SUCCEEDED' }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v2/lm/deployments') {
        res.end(JSON.stringify({
          id: 'dep-test-1',
          status: 'SUCCEEDED',
          deploymentUrl: `${aiCoreBaseUrl}/inference`
        }));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/v2/lm/deployments/')) {
        res.end(JSON.stringify({
          id: 'dep-test-1',
          status: 'SUCCEEDED',
          deploymentUrl: `${aiCoreBaseUrl}/inference`
        }));
        return;
      }
      if (req.method === 'POST' && req.url === '/inference') {
        if (inferenceFails) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: 'AI Core unavailable' }));
          return;
        }
        const payload = JSON.parse(body || '{}');
        assert.ok(payload.features.zone);
        assert.ok(Array.isArray(payload.features.sensorReadings));
        res.end(JSON.stringify(aiPrediction()));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise(resolve => aiCoreServer.listen(0, '127.0.0.1', resolve));
  aiCoreBaseUrl = `http://127.0.0.1:${aiCoreServer.address().port}`;
  process.env.VCAP_SERVICES = JSON.stringify({
    aicore: [{
      name: 'freshchain-ai-core',
      label: 'aicore',
      credentials: {
        AI_API_URL: aiCoreBaseUrl,
        tokenurl: `${aiCoreBaseUrl}/oauth/token`,
        clientid: 'test-client',
        clientsecret: 'test-secret'
      }
    }]
  });
});

test.after(async () => {
  await new Promise(resolve => aiCoreServer.close(resolve));
  delete process.env.VCAP_SERVICES;
});

function reading(overrides = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    messageId: overrides.messageId || `MSG-${Date.now()}-${Math.random()}`,
    correlationId: overrides.correlationId || `ST001-ZN_DAIRY_01-${now}`,
    eventType: 'SensorReadingCreated',
    storeId: overrides.storeId || 'ST001',
    zoneId: overrides.zoneId || 'ZN_DAIRY_01',
    sensorId: overrides.sensorId || 'SIM_TEMP_HUM_GAS_001',
    measuredAt: overrides.measuredAt || now,
    publishedAt: overrides.publishedAt || now,
    readings: {
      temperatureC: 4.2,
      humidityPct: 63.5,
      co2Ppm: 780,
      oxygenPct: 20.7,
      lightLux: 95,
      doorOpen: false,
      ...(overrides.readings || {})
    },
    quality: {
      batteryPct: 98,
      signalStrength: -48,
      sensorHealth: 'OK'
    },
    scenarioCode: overrides.scenarioCode || 'NORMAL'
  };
}

test('ingests a normal reading through the simulator HTTP adapter', async () => {
  const payload = reading();
  const response = await POST('/ingest/sensor-readings', payload);
  assert.equal(response.status, 201);
  assert.equal(response.data.ok, true);

  const stored = await GET(`/odata/v4/catalog/SensorReadings?$filter=sourceMessageId eq '${payload.messageId}'`);
  assert.equal(stored.data.value.length, 1);
});

test('duplicate message replay is idempotent', async () => {
  const payload = reading();
  await POST('/ingest/sensor-readings', payload);
  const replay = await POST('/ingest/sensor-readings', payload);
  assert.equal(replay.data.duplicate, true);

  const stored = await GET(`/odata/v4/catalog/SensorReadings?$filter=sourceMessageId eq '${payload.messageId}'`);
  assert.equal(stored.data.value.length, 1);
});

test('temperature excursion creates a high operational alert without local ML prediction', async () => {
  const payload = reading({
    readings: { temperatureC: 8.4 },
    scenarioCode: 'DOOR_LEFT_OPEN'
  });
  const response = await POST('/ingest/sensor-readings', payload);
  assert.equal(response.data.severity, 'HIGH');
  assert.ok(response.data.alertId);

  const alerts = await GET('/odata/v4/catalog/Alerts?$filter=status ne \'RESOLVED\'');
  assert.ok(alerts.data.value.some(alert => alert.alertType === 'TEMPERATURE_EXCURSION'));

});

test('catalog bound alert actions support the operations UI workflow', async () => {
  const payload = reading({
    readings: { temperatureC: 8.6 },
    scenarioCode: 'DOOR_LEFT_OPEN'
  });
  const response = await POST('/ingest/sensor-readings', payload);
  const alertId = response.data.alertId;
  assert.ok(alertId);

  const acknowledged = await POST(`/odata/v4/catalog/Alerts(ID=${alertId})/CatalogService.acknowledge`, {
    comment: 'Acknowledged from test'
  });
  assert.equal(acknowledged.data.status, 'ACKNOWLEDGED');

  const resolved = await POST(`/odata/v4/catalog/Alerts(ID=${alertId})/CatalogService.resolve`, {
    outcome: 'Temperature recovered',
    comment: 'Resolved from test'
  });
  assert.equal(resolved.data.status, 'RESOLVED');

  const reopened = await POST(`/odata/v4/catalog/Alerts(ID=${alertId})/CatalogService.reopen`, {
    comment: 'Reopened from test'
  });
  assert.equal(reopened.data.status, 'REOPENED');
});

test('invalid oxygen reading is quarantined in IngestionErrors', async () => {
  const payload = reading({ readings: { oxygenPct: 30 } });
  await assert.rejects(() => POST('/ingest/sensor-readings', payload), /400/);

  const errors = await GET(`/odata/v4/admin/IngestionErrors?$filter=messageId eq '${payload.messageId}'`);
  assert.equal(errors.data.value.length, 1);
  assert.equal(errors.data.value[0].errorClass, 'PLAUSIBILITY_ERROR');
});

test('intelligence service generates mock data and overview metrics', async () => {
  const generated = await POST('/odata/v4/intelligence/seedDemoData', {
    days: 7,
    stores: 2,
    anomalyRate: 0.15
  });
  const result = JSON.parse(generated.data.value);
  assert.ok(result.datasetCode);
  assert.ok(result.readingCount > 0);
  assert.ok(result.salesCount > 0);

  const overviewResponse = await POST('/odata/v4/intelligence/getOverview', {});
  const overview = JSON.parse(overviewResponse.data.value);
  assert.ok(overview.health.stores >= 1);
  assert.ok(overview.health.zones >= 1);
  assert.ok(Array.isArray(overview.riskTrend));
});

test('data science team can upload, validate, import, and train on a CSV ZIP dataset', async () => {
  const uploaded = await POST('/odata/v4/intelligence/uploadDatasetPackage', {
    fileName: 'science-upload.zip',
    mimeType: 'application/zip',
    contentBase64: validDatasetPackage()
  });
  assert.equal(uploaded.data.status, 'UPLOADED');
  assert.ok(uploaded.data.checksumSha256);

  const validated = await POST('/odata/v4/intelligence/validateDatasetPackage', {
    uploadId: uploaded.data.ID
  });
  assert.equal(validated.data.status, 'VALIDATED');
  const validation = JSON.parse(validated.data.validationSummary);
  assert.equal(validation.rowCounts['sensor_readings.csv'], 1);
  assert.equal(validation.errors.length, 0);

  const imported = await POST('/odata/v4/intelligence/importDatasetPackage', {
    uploadId: uploaded.data.ID
  });
  assert.equal(imported.data.status, 'IMPORTED');
  const importSummary = JSON.parse(imported.data.importSummary);
  assert.ok(importSummary.datasetCode.startsWith('science-upload-'));

  const datasets = await GET(`/odata/v4/intelligence/MLDatasets?$filter=datasetCode eq '${importSummary.datasetCode}'`);
  assert.equal(datasets.data.value.length, 1);
  assert.equal(datasets.data.value[0].source, 'DATASET_UPLOAD');
  assert.equal(datasets.data.value[0].readingCount, 1);
  assert.equal(datasets.data.value[0].salesCount, 1);

  const training = await POST('/odata/v4/intelligence/startTraining', {
    datasetCode: importSummary.datasetCode
  });
  assert.equal(training.data.status, 'SUCCEEDED');
  assert.equal(training.data.aiCoreExecutionId, 'exec-test-1');

  await assert.rejects(() => POST('/odata/v4/intelligence/deleteDatasetUpload', {
    uploadId: uploaded.data.ID
  }), /409/);
});

test('dataset package validation rejects missing required CSVs', async () => {
  const uploaded = await POST('/odata/v4/intelligence/uploadDatasetPackage', {
    fileName: 'broken-upload.zip',
    mimeType: 'application/zip',
    contentBase64: zipPackage({
      'sensor_readings.csv': [
        'messageId,storeCode,zoneCode,sensorId,measuredAt,temperatureC,humidityPct,co2Ppm,oxygenPct,lightLux,doorOpen',
        `BROKEN-${Date.now()},ST001,ZN_DAIRY_01,BROKEN_SENSOR,${new Date().toISOString()},4,60,700,20.8,80,false`
      ].join('\n')
    })
  });
  const validated = await POST('/odata/v4/intelligence/validateDatasetPackage', {
    uploadId: uploaded.data.ID
  });
  assert.equal(validated.data.status, 'FAILED');
  const validation = JSON.parse(validated.data.validationSummary);
  assert.ok(validation.errors.some(error => error.includes('sales_observations.csv')));

  const deleted = await POST('/odata/v4/intelligence/deleteDatasetUpload', {
    uploadId: uploaded.data.ID
  });
  assert.equal(deleted.data.value, true);
});

test('dataset package template can be downloaded and validated', async () => {
  const template = await POST('/odata/v4/intelligence/downloadDatasetPackageTemplate', {});
  assert.ok(template.data.value);

  const uploaded = await POST('/odata/v4/intelligence/uploadDatasetPackage', {
    fileName: 'freshchain-dataset-template.zip',
    mimeType: 'application/zip',
    contentBase64: template.data.value
  });
  const validated = await POST('/odata/v4/intelligence/validateDatasetPackage', {
    uploadId: uploaded.data.ID
  });
  assert.equal(validated.data.status, 'VALIDATED');
  const validation = JSON.parse(validated.data.validationSummary);
  assert.equal(validation.errors.length, 0);
  assert.ok(validation.rowCounts['sensor_readings.csv'] >= 2);
});

test('intelligence service records training, deployment, and real-time scoring output', async () => {
  const generated = await POST('/odata/v4/intelligence/seedDemoData', {
    days: 7,
    stores: 2,
    anomalyRate: 0.2
  });
  const datasetCode = JSON.parse(generated.data.value).datasetCode;

  const training = await POST('/odata/v4/intelligence/startTraining', { datasetCode });
  assert.equal(training.data.modelName, 'freshchain-intelligence');
  assert.equal(training.data.status, 'SUCCEEDED');
  assert.equal(training.data.aiCoreExecutionId, 'exec-test-1');

  const deployment = await POST('/odata/v4/intelligence/activateDeployment', {
    trainingRunId: training.data.ID
  });
  assert.equal(deployment.data.status, 'SUCCEEDED');
  assert.equal(deployment.data.aiCoreDeploymentId, 'dep-test-1');

  const zones = await GET('/odata/v4/catalog/Zones?$top=1');
  const prediction = await POST('/odata/v4/intelligence/scoreLatest', {
    zoneId: zones.data.value[0].ID
  });
  assert.equal(prediction.data.predictionType, 'REAL_TIME_INTELLIGENCE');
  assert.equal(prediction.data.aiCoreUnavailable, false);
  assert.ok(prediction.data.recommendedAction);
});

test('intelligence dashboard exposes structured OData views and recommendation lifecycle', async () => {
  const generated = await POST('/odata/v4/intelligence/seedDemoData', {
    days: 7,
    stores: 2,
    anomalyRate: 0.2
  });
  const datasetCode = JSON.parse(generated.data.value).datasetCode;
  const training = await POST('/odata/v4/intelligence/startTraining', { datasetCode });
  await POST('/odata/v4/intelligence/activateDeployment', { trainingRunId: training.data.ID });

  const zones = await GET('/odata/v4/intelligence/Zones?$top=1');
  await POST('/odata/v4/intelligence/scoreLatest', { zoneId: zones.data.value[0].ID });

  const metrics = await GET('/odata/v4/intelligence/OverviewMetrics');
  assert.equal(metrics.data.value.length, 1);
  assert.ok(metrics.data.value[0].zones >= 1);

  const risk = await GET('/odata/v4/intelligence/RiskTrend?$top=5');
  assert.ok(risk.data.value.length >= 1);
  assert.ok(risk.data.value[0].zoneId);

  const replenishments = await GET('/odata/v4/intelligence/ReplenishmentDashboard?$top=1');
  assert.ok(replenishments.data.value.length >= 1);
  const applied = await POST('/odata/v4/intelligence/applyReplenishmentRecommendation', {
    recommendationId: replenishments.data.value[0].ID
  });
  assert.equal(applied.data.status, 'APPLIED');

  const telemetry = await GET('/odata/v4/intelligence/InferenceTelemetry?$top=5');
  assert.ok(telemetry.data.value.some(row => row.requestId));
  assert.ok(telemetry.data.value.some(row => row.aiCoreUnavailable === false));

  const quality = await GET('/odata/v4/intelligence/ModelQualityDashboard?$top=5');
  assert.ok(quality.data.value.length >= 1);
  assert.ok(['GOOD', 'WATCH', 'BREACH'].includes(quality.data.value[0].status));

  const scenarios = await GET('/odata/v4/intelligence/ScenarioMix?$top=10');
  assert.ok(scenarios.data.value.some(row => row.scenarioCode === 'NORMAL'));

  const freshness = await GET('/odata/v4/intelligence/DataFreshness');
  assert.equal(freshness.data.value.length, 1);
  assert.ok(['GOOD', 'WATCH', 'BREACH'].includes(freshness.data.value[0].health));
});

test('local model mode scores without SAP AI Core credentials or deployment lookup', async () => {
  const previousServices = process.env.VCAP_SERVICES;
  process.env.FRESHCHAIN_LOCAL_MODEL_URL = `${aiCoreBaseUrl}/inference`;
  delete process.env.VCAP_SERVICES;
  try {
    const zones = await GET('/odata/v4/intelligence/Zones?$top=1');
    const prediction = await POST('/odata/v4/intelligence/scoreLatest', { zoneId: zones.data.value[0].ID });
    assert.equal(prediction.data.deploymentId, 'freshchain-local');
    assert.equal(prediction.data.aiCoreUnavailable, false);
  } finally {
    delete process.env.FRESHCHAIN_LOCAL_MODEL_URL;
    process.env.VCAP_SERVICES = previousServices;
  }
});

test('scoring fails closed when SAP AI Core inference is unavailable', async () => {
  const generated = await POST('/odata/v4/intelligence/seedDemoData', {
    days: 7,
    stores: 2,
    anomalyRate: 0.2
  });
  const datasetCode = JSON.parse(generated.data.value).datasetCode;
  const training = await POST('/odata/v4/intelligence/startTraining', { datasetCode });
  await POST('/odata/v4/intelligence/activateDeployment', { trainingRunId: training.data.ID });

  const zones = await GET('/odata/v4/intelligence/Zones?$top=1');
  inferenceFails = true;
  await assert.rejects(() => POST('/odata/v4/intelligence/scoreLatest', { zoneId: zones.data.value[0].ID }), /502/);
  inferenceFails = false;

  const telemetry = await GET('/odata/v4/intelligence/InferenceTelemetry?$top=10');
  const failed = telemetry.data.value.find(row => row.status === 'FAILED');
  assert.ok(failed);
  assert.equal(failed.aiCoreUnavailable, true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cds = require('@sap/cds');
const { normalizeLifecycleStatus, deploymentStatusOf } = require('../srv/handlers/ai-core-client');

fs.rmSync(path.join(__dirname, '..', 'db.sqlite'), { force: true });
fs.rmSync(path.join(__dirname, '..', 'db.sqlite-journal'), { force: true });
execFileSync('npx', ['cds', 'deploy', '--to', 'sqlite:db.sqlite'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'ignore'
});

const testEnv = cds.test(__dirname + '/..');
testEnv.axios.defaults.auth = { username: 'demo.manager', password: '' };
const { GET, POST } = testEnv;
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
      if (req.method === 'GET' && req.url.startsWith('/v2/lm/configurations')) {
        res.end(JSON.stringify({ count: 0, resources: [] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v2/lm/configurations') {
        const payload = JSON.parse(body || '{}');
        assert.equal(payload.executableId, 'freshchain-train');
        assert.ok(payload.parameterBindings.some(parameter => parameter.key === 'datasetCode'));
        res.statusCode = 201;
        res.end(JSON.stringify({ id: 'config-test-1', message: 'Configuration created' }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v2/lm/executions') {
        const payload = JSON.parse(body || '{}');
        assert.equal(payload.configurationId, 'config-test-1');
        res.end(JSON.stringify({
          id: 'exec-test-1',
          status: 'COMPLETED',
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
        res.end(JSON.stringify({ id: 'exec-test-1', status: 'COMPLETED' }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v2/lm/deployments') {
        res.end(JSON.stringify({
          id: 'dep-test-1',
          status: 'RUNNING',
          deploymentUrl: `${aiCoreBaseUrl}/inference`
        }));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/v2/lm/deployments/')) {
        res.end(JSON.stringify({
          id: 'dep-test-1',
          status: 'RUNNING',
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
      if (req.method === 'POST' && req.url === '/genai') {
        const payload = JSON.parse(body || '{}');
        assert.equal(payload.orchestration_config.module_configurations.llm_module_config.model_name, 'gpt-5');
        res.end(JSON.stringify({
          orchestration_result: {
            choices: [{
              message: {
                content: JSON.stringify({
                  actionSummary: {
                    primaryAction: 'GenAI: move stock, start markdown, and escalate compressor service within 12 minutes.'
                  },
                  managerNotification: 'GenAI: FreshChain detected CRITICAL spoilage risk. Protect the stock now.',
                  auditSummary: 'GenAI: AI Core evidence, financial impact, and SLA were converted into an auditable action brief.',
                  customerSafeExplanation: 'GenAI: stock is being rotated early because refrigeration telemetry showed risk.'
                })
              }
            }]
          }
        }));
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

test('reads SAP AI Core API URL from nested serviceurls credentials', () => {
  const previousServices = process.env.VCAP_SERVICES;
  process.env.VCAP_SERVICES = JSON.stringify({
    aicore: [{
      name: 'ai-core',
      label: 'aicore',
      credentials: {
        url: 'https://issuer.example',
        serviceurls: {
          AI_API_URL: 'https://api.ai.example/'
        },
        clientid: 'test-client',
        clientsecret: 'test-secret'
      }
    }]
  });

  try {
    const { aiCoreConfig } = require('../srv/handlers/ai-core-client');
    const config = aiCoreConfig();
    assert.equal(config.apiUrl, 'https://api.ai.example');
    assert.equal(config.tokenUrl, 'https://issuer.example/oauth/token');
  } finally {
    process.env.VCAP_SERVICES = previousServices;
  }
});

test('normalizes SAP AI Core lifecycle statuses for app workflows', () => {
  assert.equal(normalizeLifecycleStatus('COMPLETED'), 'SUCCEEDED');
  assert.equal(normalizeLifecycleStatus('DEAD'), 'FAILED');
  assert.equal(normalizeLifecycleStatus('UNKNOWN'), 'RUNNING');
  assert.equal(deploymentStatusOf({ status: 'RUNNING' }), 'SUCCEEDED');
});

test('intelligence lifecycle actions reject missing AI Core prerequisites', async () => {
  const missingId = '00000000-0000-0000-0000-000000000000';
  await assert.rejects(
    () => POST('/odata/v4/intelligence/startTraining', { datasetCode: 'missing-dataset' }),
    /404/
  );
  await assert.rejects(
    () => POST('/odata/v4/intelligence/activateDeployment', { trainingRunId: missingId }),
    /404/
  );
  await assert.rejects(
    () => POST('/odata/v4/intelligence/refreshTrainingRun', { trainingRunId: missingId }),
    /404/
  );
  await assert.rejects(
    () => POST('/odata/v4/intelligence/refreshDeployment', { deploymentId: missingId }),
    /404/
  );

  const manualRun = await POST('/odata/v4/intelligence/MLTrainingRuns', {
    runId: `manual-no-exec-${Date.now()}`,
    modelName: 'freshchain-intelligence',
    modelVersion: 'manual',
    status: 'SUCCEEDED'
  });
  await assert.rejects(
    () => POST('/odata/v4/intelligence/activateDeployment', { trainingRunId: manualRun.data.ID }),
    /409/
  );
  await assert.rejects(
    () => POST('/odata/v4/intelligence/refreshTrainingRun', { trainingRunId: manualRun.data.ID }),
    /409/
  );

  const manualDeployment = await POST('/odata/v4/intelligence/MLDeployments', {
    deploymentId: `manual-no-ai-core-${Date.now()}`,
    modelName: 'freshchain-intelligence',
    modelVersion: 'manual',
    status: 'SUCCEEDED'
  });
  await assert.rejects(
    () => POST('/odata/v4/intelligence/refreshDeployment', { deploymentId: manualDeployment.data.ID }),
    /409/
  );
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

async function importTrainingDataset(prefix = 'science-upload') {
  const uploaded = await POST('/odata/v4/intelligence/uploadDatasetPackage', {
    fileName: `${prefix}.zip`,
    mimeType: 'application/zip',
    contentBase64: validDatasetPackage(`${prefix.toUpperCase()}-${Date.now()}-${Math.random()}`)
  });
  await POST('/odata/v4/intelligence/validateDatasetPackage', {
    uploadId: uploaded.data.ID
  });
  const imported = await POST('/odata/v4/intelligence/importDatasetPackage', {
    uploadId: uploaded.data.ID
  });
  return JSON.parse(imported.data.importSummary).datasetCode;
}

async function prepareAiCoreDeployment(prefix = 'science-upload') {
  const datasetCode = await importTrainingDataset(prefix);
  const training = await POST('/odata/v4/intelligence/startTraining', { datasetCode });
  const deployment = await POST('/odata/v4/intelligence/activateDeployment', {
    trainingRunId: training.data.ID
  });
  return { datasetCode, training, deployment };
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

test('internal ingestion action returns a typed result object', async () => {
  const payload = reading({ messageId: `ACTION-${Date.now()}-${Math.random()}` });
  const ingestion = await cds.connect.to('IngestionService');
  const result = await ingestion.send('ingestSensorReading', {
    payload: JSON.stringify(payload)
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.messageId, payload.messageId);
  assert.ok(result.readingId);
});

test('catalog sensor readings are append-only through the service contract', async () => {
  const [stores, zones, sensors] = await Promise.all([
    GET('/odata/v4/catalog/Stores?$filter=storeCode eq \'ST001\'&$top=1'),
    GET('/odata/v4/catalog/Zones?$filter=zoneCode eq \'ZN_DAIRY_01\'&$top=1'),
    GET('/odata/v4/catalog/Sensors?$filter=sensorId eq \'SIM_TEMP_HUM_GAS_001\'&$top=1')
  ]);
  const now = new Date().toISOString();
  const created = await POST('/odata/v4/catalog/SensorReadings', {
    store_ID: stores.data.value[0].ID,
    zone_ID: zones.data.value[0].ID,
    sensor_ID: sensors.data.value[0].ID,
    measuredAt: now,
    publishedAt: now,
    temperatureC: 4.5,
    humidityPct: 62,
    co2Ppm: 770,
    oxygenPct: 20.8,
    lightLux: 90,
    doorOpen: false,
    batteryPct: 98,
    signalStrength: -46,
    sensorHealth: 'OK',
    scenarioCode: 'NORMAL',
    sourceMessageId: `DIRECT-${Date.now()}`
  });
  assert.ok(created.data.ID);

  await assert.rejects(
    testEnv.axios.patch(`/odata/v4/catalog/SensorReadings(${created.data.ID})`, { temperatureC: 6.1 }),
    /403|405/
  );
  await assert.rejects(
    testEnv.axios.delete(`/odata/v4/catalog/SensorReadings(${created.data.ID})`),
    /403|405/
  );
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

  const zones = await GET(`/odata/v4/catalog/Zones?$filter=zoneCode eq '${payload.zoneId}'&$top=1`);
  assert.equal(zones.data.value.length, 1);
  const manual = await POST('/odata/v4/catalog/triggerManualRiskEvaluation', {
    zoneId: zones.data.value[0].ID
  });
  assert.equal(manual.data.alertType, 'TEMPERATURE_EXCURSION');
  assert.equal(manual.data.severity, 'HIGH');
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

  const assigned = await POST(`/odata/v4/catalog/Alerts(ID=${alertId})/CatalogService.assign`, {
    userId: 'fresh.ops',
    comment: 'Assigned from test'
  });
  assert.equal(assigned.data.status, 'ASSIGNED');
  assert.equal(assigned.data.assignedTo, 'fresh.ops');

  const resolved = await POST(`/odata/v4/catalog/Alerts(ID=${alertId})/CatalogService.resolve`, {
    outcome: 'Temperature recovered',
    comment: 'Resolved from test'
  });
  assert.equal(resolved.data.status, 'RESOLVED');

  const reopened = await POST(`/odata/v4/catalog/Alerts(ID=${alertId})/CatalogService.reopen`, {
    comment: 'Reopened from test'
  });
  assert.equal(reopened.data.status, 'REOPENED');

  const noted = await POST(`/odata/v4/catalog/Alerts(ID=${alertId})/CatalogService.addNote`, {
    comment: 'Note from test'
  });
  assert.equal(noted.data.status, 'REOPENED');

  const actions = await GET(`/odata/v4/catalog/AlertActions?$filter=alert_ID eq ${alertId}`);
  const byType = Object.fromEntries(actions.data.value.map(row => [row.actionType, row]));
  for (const actionType of ['ACKNOWLEDGED', 'ASSIGNED', 'NOTE', 'REOPENED', 'RESOLVED']) {
    assert.ok(byType[actionType], `Expected ${actionType} audit action`);
  }
  assert.equal(byType.ACKNOWLEDGED.previousStatus, 'OPEN');
  assert.equal(byType.ASSIGNED.previousStatus, 'ACKNOWLEDGED');
  assert.equal(byType.ASSIGNED.newStatus, 'ASSIGNED');
  assert.equal(byType.ASSIGNED.assignedTo, 'fresh.ops');
  assert.equal(byType.RESOLVED.outcome, 'Temperature recovered');
  assert.equal(byType.NOTE.comment, 'Note from test');
  assert.equal(byType.NOTE.performedBy, 'demo.manager');
});

test('invalid oxygen reading is quarantined in IngestionErrors', async () => {
  const payload = reading({ readings: { oxygenPct: 30 } });
  await assert.rejects(() => POST('/ingest/sensor-readings', payload), /400/);

  const errors = await GET(`/odata/v4/admin/IngestionErrors?$filter=messageId eq '${payload.messageId}'`);
  assert.equal(errors.data.value.length, 1);
  assert.equal(errors.data.value[0].errorClass, 'PLAUSIBILITY_ERROR');

  const replay = await POST('/odata/v4/admin/replayIngestionError', {
    errorId: errors.data.value[0].ID
  });
  assert.equal(replay.data.status, 'REPLAY_FAILED');
  assert.match(replay.data.reason, /oxygenPct/);
  assert.equal(replay.data.messageId, payload.messageId);
  assert.equal(Object.prototype.hasOwnProperty.call(replay.data, 'value'), false);
});

test('analytics summary action returns structured dashboard metrics', async () => {
  const summary = await POST('/odata/v4/analytics/getDashboardSummary', {});

  assert.ok(summary.data.stores >= 1);
  assert.ok(summary.data.zones >= 1);
  assert.ok(summary.data.activeAlerts >= 0);
  assert.ok(summary.data.openIngestionErrors >= 0);
  assert.equal(Object.prototype.hasOwnProperty.call(summary.data, 'value'), false);
});

test('intelligence service exposes maintained data and overview metrics', async () => {
  const overviewResponse = await POST('/odata/v4/intelligence/getOverview', {});
  const overview = JSON.parse(overviewResponse.data.value);
  assert.ok(overview.health.stores >= 1);
  assert.ok(overview.health.zones >= 1);
  assert.ok(Array.isArray(overview.riskTrend));

  const settings = await GET('/odata/v4/configuration/ImpactSettings?$top=1');
  assert.equal(settings.data.value.length, 1);
  assert.equal(settings.data.value[0].active, true);
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
  const { training, deployment } = await prepareAiCoreDeployment('training-output');
  assert.equal(training.data.modelName, 'freshchain-intelligence');
  assert.equal(training.data.status, 'SUCCEEDED');
  assert.equal(training.data.aiCoreExecutionId, 'exec-test-1');
  assert.equal(deployment.data.status, 'SUCCEEDED');
  assert.equal(deployment.data.aiCoreDeploymentId, 'dep-test-1');

  const refreshedTraining = await POST('/odata/v4/intelligence/refreshTrainingRun', {
    trainingRunId: training.data.ID
  });
  assert.equal(refreshedTraining.data.status, 'SUCCEEDED');
  assert.equal(refreshedTraining.data.aiCoreExecutionId, 'exec-test-1');

  const refreshedDeployment = await POST('/odata/v4/intelligence/refreshDeployment', {
    deploymentId: deployment.data.ID
  });
  assert.equal(refreshedDeployment.data.status, 'SUCCEEDED');
  assert.equal(refreshedDeployment.data.aiCoreDeploymentId, 'dep-test-1');

  await POST('/ingest/sensor-readings', reading({
    messageId: `TRAIN-SCORE-${Date.now()}`,
    readings: { temperatureC: 8.8 },
    scenarioCode: 'TEMPERATURE_EXCURSION'
  }));
  const zones = await GET('/odata/v4/catalog/Zones?$top=1');
  const prediction = await POST('/odata/v4/intelligence/scoreLatest', {
    zoneId: zones.data.value[0].ID
  });
  assert.equal(prediction.data.predictionType, 'REAL_TIME_INTELLIGENCE');
  assert.equal(prediction.data.aiCoreUnavailable, false);
  assert.ok(prediction.data.recommendedAction);
});

test('intelligence dashboard exposes structured OData views and recommendation lifecycle', async () => {
  await prepareAiCoreDeployment('dashboard');

  await POST('/ingest/sensor-readings', reading({
    messageId: `DASHBOARD-${Date.now()}`,
    readings: { temperatureC: 7.9 },
    scenarioCode: 'TEMPERATURE_EXCURSION'
  }));
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
  const rejected = await POST('/odata/v4/intelligence/rejectReplenishmentRecommendation', {
    recommendationId: replenishments.data.value[0].ID
  });
  assert.equal(rejected.data.status, 'REJECTED');

  const routes = await GET('/odata/v4/intelligence/RouteDashboard?$top=1');
  assert.ok(routes.data.value.length >= 1);
  const appliedRoute = await POST('/odata/v4/intelligence/applyRouteRecommendation', {
    recommendationId: routes.data.value[0].ID
  });
  assert.equal(appliedRoute.data.status, 'APPLIED');
  const rejectedRoute = await POST('/odata/v4/intelligence/rejectRouteRecommendation', {
    recommendationId: routes.data.value[0].ID
  });
  assert.equal(rejectedRoute.data.status, 'REJECTED');

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

test('spoilage prevention demo action creates realistic business and platform proof', async () => {
  await prepareAiCoreDeployment('spoilage-demo');
  await POST('/ingest/sensor-readings', reading({
    messageId: `SPOILAGE-DEMO-${Date.now()}`,
    readings: { temperatureC: 9.1 },
    scenarioCode: 'COMPRESSOR_FAILURE'
  }));

  const result = await POST('/odata/v4/intelligence/runSpoilagePreventionDemo', {});
  assert.equal(result.data.ID, 'current');
  assert.ok(['ATTENTION', 'STABLE'].includes(result.data.status));
  assert.ok(result.data.headline.includes('spoilage risk'));
  assert.notEqual(result.data.productName, 'No product scored yet');
  assert.ok(result.data.recommendedAction);
  assert.ok(Number(result.data.remainingShelfLifeDays) >= 0);
  assert.ok(Number(result.data.expectedWasteAvoidedUnits) >= 0);
  assert.equal(result.data.aiCoreStatus, 'Reached');
  assert.ok(result.data.platformProof.includes('AI Core'));

  const rows = await GET('/odata/v4/intelligence/SpoilagePreventionDemo');
  assert.equal(rows.data.value.length, 1);
  assert.equal(rows.data.value[0].ID, 'current');
});

test('live demo creates a sensor event, scores it, and exposes demo proof metrics', async () => {
  await prepareAiCoreDeployment('live-demo');

  const started = await POST('/odata/v4/live-demo/startLiveDemo', {});
  assert.equal(started.data.status, 'RUNNING');

  const reading = await POST('/odata/v4/live-demo/createLiveReading', { force: true });
  assert.ok(reading.data.ID);
  assert.ok(reading.data.sourceMessageId.startsWith('LIVE-'));
  assert.ok(['NORMAL', 'DOOR_LEFT_OPEN', 'TEMPERATURE_EXCURSION', 'COMPRESSOR_FAILURE', 'DEMAND_SPIKE', 'WASTE_RISK'].includes(reading.data.scenarioCode));

  const decisions = await GET('/odata/v4/live-demo/RiskDecisions?$top=1&$orderby=createdAt desc');
  assert.equal(decisions.data.value.length, 1);
  assert.equal(decisions.data.value[0].predictionType, 'REAL_TIME_INTELLIGENCE');
  assert.equal(decisions.data.value[0].aiCoreUnavailable, false);
  assert.equal(decisions.data.value[0].criticality, 2);

  const interventions = await GET('/odata/v4/live-demo/SpoilageInterventions?$top=5');
  assert.ok(interventions.data.value.length >= 1);
  const interventionId = interventions.data.value[0].ID;

  const acknowledged = await POST(`/odata/v4/live-demo/SpoilageInterventions(ID=${interventionId})/LiveDemoService.acknowledge`, {
    comment: 'Live acknowledged from test'
  });
  assert.equal(acknowledged.data.status, 'ACKNOWLEDGED');

  const assigned = await POST(`/odata/v4/live-demo/SpoilageInterventions(ID=${interventionId})/LiveDemoService.assign`, {
    userId: 'fresh.rescue',
    comment: 'Live assigned from test'
  });
  assert.equal(assigned.data.status, 'ASSIGNED');
  assert.equal(assigned.data.assignedTo, 'fresh.rescue');

  const resolved = await POST(`/odata/v4/live-demo/SpoilageInterventions(ID=${interventionId})/LiveDemoService.resolve`, {
    outcome: 'Live intervention completed',
    comment: 'Live resolved from test'
  });
  assert.equal(resolved.data.status, 'RESOLVED');
  assert.equal(resolved.data.outcome, 'Live intervention completed');

  const reopened = await POST(`/odata/v4/live-demo/SpoilageInterventions(ID=${interventionId})/LiveDemoService.reopen`, {
    comment: 'Live reopened from test'
  });
  assert.equal(reopened.data.status, 'REOPENED');

  const proof = await GET('/odata/v4/live-demo/DemoImpactMetrics');
  assert.equal(proof.data.value.length, 1);
  assert.ok(Number(proof.data.value[0].inferenceCount) >= 1);
  assert.ok(proof.data.value[0].platformProof.includes('SAP AI Core'));

  const riskByZone = await GET('/odata/v4/live-demo/RiskByZone');
  assert.ok(riskByZone.data.value.length >= 1);
  assert.ok(riskByZone.data.value[0].zoneCode);
  assert.ok(Number.isInteger(riskByZone.data.value[0].criticality));

  const scenarioMix = await GET('/odata/v4/live-demo/ScenarioMix');
  assert.ok(scenarioMix.data.value.length >= 1);
  assert.ok(Number(scenarioMix.data.value[0].readingCount) >= 1);

  const statusMix = await GET('/odata/v4/live-demo/InterventionStatusMix');
  assert.ok(statusMix.data.value.length >= 1);
  assert.ok(Number(statusMix.data.value[0].alertCount) >= 1);

  const stopped = await POST('/odata/v4/live-demo/stopLiveDemo', {});
  assert.equal(stopped.data.status, 'STOPPED');
});

test('stock ledger supports receiving, moving, markdown, write-off, and zone occupancy', async () => {
  const products = await GET('/odata/v4/catalog/Products?$top=1');
  const zones = await GET('/odata/v4/catalog/Zones');
  assert.ok(products.data.value.length >= 1);
  assert.ok(zones.data.value.length >= 2);
  const sourceZone = zones.data.value[0];
  const sameStoreZone = zones.data.value.find(zone => zone.store_ID === sourceZone.store_ID && zone.ID !== sourceZone.ID);
  const otherStoreZone = zones.data.value.find(zone => zone.store_ID !== sourceZone.store_ID);
  assert.ok(sameStoreZone);
  assert.ok(otherStoreZone);

  await assert.rejects(
    testEnv.axios.post('/odata/v4/catalog/receiveStock', {
      productId: products.data.value[0].ID,
      zoneId: sourceZone.ID,
      quantity: 0
    }),
    /400/
  );

  const received = await POST('/odata/v4/catalog/receiveStock', {
    productId: products.data.value[0].ID,
    zoneId: sourceZone.ID,
    quantity: 12,
    unitCostZar: 21.5,
    sellingPriceZar: 39.99,
    bestBeforeDate: '2026-06-20',
    lotNumber: `TEST-LOT-${Date.now()}`,
    referenceDocument: 'TEST-GR'
  });
  assert.equal(Number(received.data.quantityOnHand), 12);
  assert.equal(received.data.status, 'AVAILABLE');

  const moved = await POST('/odata/v4/catalog/moveStock', {
    stockLotId: received.data.ID,
    toZoneId: sameStoreZone.ID,
    quantity: 5,
    reasonCode: 'TEST_TRANSFER'
  });
  assert.equal(Number(moved.data.quantityOnHand), 5);
  assert.equal(moved.data.zone_ID, sameStoreZone.ID);

  await assert.rejects(
    testEnv.axios.post('/odata/v4/catalog/moveStock', {
      stockLotId: moved.data.ID,
      toZoneId: otherStoreZone.ID,
      quantity: 1,
      reasonCode: 'TEST_CROSS_STORE'
    }),
    /409/
  );

  const markdown = await POST('/odata/v4/catalog/applyMarkdown', {
    stockLotId: moved.data.ID,
    sellingPriceZar: 29.99,
    reasonCode: 'TEST_MARKDOWN'
  });
  assert.equal(markdown.data.status, 'MARKDOWN');
  assert.equal(Number(markdown.data.sellingPriceZar), 29.99);

  const writtenOff = await POST('/odata/v4/catalog/writeOffStock', {
    stockLotId: markdown.data.ID,
    quantity: 2,
    reasonCode: 'TEST_WRITE_OFF'
  });
  assert.equal(Number(writtenOff.data.quantityOnHand), 3);

  await assert.rejects(
    testEnv.axios.patch(`/odata/v4/catalog/StockLots(${writtenOff.data.ID})`, { quantityOnHand: 99 }),
    /405/
  );
  await assert.rejects(
    testEnv.axios.post('/odata/v4/catalog/StockMovements', {
      movementType: 'ADJUSTMENT',
      quantity: 1
    }),
    /405/
  );

  const occupancy = await GET('/odata/v4/catalog/ZoneOccupancy');
  assert.ok(occupancy.data.value.some(row => row.zoneCode && Number(row.stockValueZar) > 0));

  const movements = await GET(`/odata/v4/catalog/StockMovements?$filter=referenceDocument eq 'TEST-GR' or reasonCode eq 'TEST_TRANSFER' or reasonCode eq 'TEST_MARKDOWN' or reasonCode eq 'TEST_WRITE_OFF'`);
  assert.ok(movements.data.value.length >= 4);
});

test('rescue scenario creates executive impact, action brief, workflow task, and notification', async () => {
  await prepareAiCoreDeployment('rescue-scenario');

  const scenario = await POST('/odata/v4/live-demo/runRescueScenario', {});
  assert.ok(scenario.data.ID);
  assert.match(scenario.data.headline, /spoilage risk|protected|rescue/i);
  assert.equal(Number(scenario.data.protectedRevenueZar), 0);
  assert.ok(Number(scenario.data.businessValueAtRiskZar) > 0);
  assert.ok(Number(scenario.data.potentialProtectedRevenueZar) > 0);
  assert.ok(Number(scenario.data.potentialProtectedRevenueZar) <= Number(scenario.data.businessValueAtRiskZar));
  assert.ok(Number(scenario.data.expectedLossZar) > 0);
  assert.ok(Number(scenario.data.affectedLotCount) > 0);
  assert.ok(Number(scenario.data.responseSlaMinutes) > 0);
  assert.ok(scenario.data.calculationSummary.includes('Expected loss'));
  assert.equal(scenario.data.actionBriefStatus, 'GENAI_UNAVAILABLE');
  assert.equal(scenario.data.processStatus, 'TASK_READY');

  const briefRows = await GET(`/odata/v4/live-demo/ActionBriefs?$filter=scenarioID eq '${scenario.data.ID}'`);
  assert.ok(briefRows.data.value.length >= 1);
  assert.equal(briefRows.data.value[0].generationMode, 'UNAVAILABLE');
  assert.equal(briefRows.data.value[0].modelProvider, 'SAP AI Core Orchestration');
  assert.equal(briefRows.data.value[0].promptVersion, 'freshchain-brief-v2');
  assert.ok(briefRows.data.value[0].unavailableReason);

  const taskRows = await GET(`/odata/v4/live-demo/ProcessTasks?$filter=scenarioID eq '${scenario.data.ID}'`);
  assert.ok(taskRows.data.value.length >= 1);
  assert.equal(taskRows.data.value[0].status, 'READY');
  assert.equal(taskRows.data.value[0].workflowMode, 'FreshChain in-app workflow');
  assert.equal(taskRows.data.value[0].workflowStatus, 'READY');
  assert.equal(taskRows.data.value[0].workflowProcessId, 'freshchain-store-rescue');
  assert.equal(taskRows.data.value[0].unavailableReason, null);

  const notificationRows = await GET(`/odata/v4/live-demo/NotificationEvents?$filter=scenarioID eq '${scenario.data.ID}'`);
  assert.ok(notificationRows.data.value.length >= 1);
  assert.equal(notificationRows.data.value[0].status, 'SENT');

  const completed = await POST('/odata/v4/live-demo/completeInterventionTask', {
    taskID: taskRows.data.value[0].ID,
    outcome: 'Stock moved to safe refrigeration and markdown started.'
  });
  assert.equal(completed.data.status, 'COMPLETED');

  const impact = await GET('/odata/v4/live-demo/BusinessImpactSummary');
  assert.equal(impact.data.value[0].incidentStatus, 'ACTIONED');
  assert.equal(Number(impact.data.value[0].processCompletionPct), 100);
  assert.ok(Number(impact.data.value[0].actualProtectedRevenueZar) > 0);
  assert.ok(Number(impact.data.value[0].responseSlaMinutes) > 0);

  const impactRows = await GET(`/odata/v4/live-demo/InterventionImpacts?$filter=scenarioID eq '${scenario.data.ID}'`);
  assert.equal(impactRows.data.value.length, 1);
  assert.equal(impactRows.data.value[0].status, 'ACTIONED');
  assert.ok(Number(impactRows.data.value[0].responseSlaMinutes) > 0);
  assert.ok(impactRows.data.value[0].movementReferences);
});

test('rescue scenario can use live-style GenAI and in-app workflow integrations', async () => {
  const previousGenAiEndpoint = process.env.FRESHCHAIN_GENAI_ENDPOINT;
  const previousGenAiModel = process.env.FRESHCHAIN_GENAI_MODEL;
  process.env.FRESHCHAIN_GENAI_ENDPOINT = `${aiCoreBaseUrl}/genai`;
  process.env.FRESHCHAIN_GENAI_MODEL = 'gpt-5';
  try {
    await prepareAiCoreDeployment('rescue-integrations');

    const scenario = await POST('/odata/v4/live-demo/runRescueScenario', {});
    assert.equal(scenario.data.actionBriefStatus, 'GENAI_GENERATED');
    assert.equal(scenario.data.processStatus, 'TASK_READY');
    assert.ok(scenario.data.managerMessage.startsWith('GenAI:'));

    const briefRows = await GET(`/odata/v4/live-demo/ActionBriefs?$filter=scenarioID eq '${scenario.data.ID}'`);
    assert.equal(briefRows.data.value[0].generationMode, 'SAP AI Core Generative AI Hub');
    assert.equal(briefRows.data.value[0].modelProvider, 'SAP AI Core Orchestration');
    assert.equal(briefRows.data.value[0].modelName, 'gpt-5');
    assert.ok(Number(briefRows.data.value[0].generationLatencyMs) >= 0);
    assert.equal(briefRows.data.value[0].unavailableReason, null);
    assert.match(briefRows.data.value[0].actionSummary, /primaryAction/);

    const taskRows = await GET(`/odata/v4/live-demo/ProcessTasks?$filter=scenarioID eq '${scenario.data.ID}'`);
    assert.equal(taskRows.data.value[0].workflowMode, 'FreshChain in-app workflow');
    assert.equal(taskRows.data.value[0].workflowStatus, 'READY');
    assert.equal(taskRows.data.value[0].workflowInstanceId, `WF-${scenario.data.ID}`);
    assert.equal(taskRows.data.value[0].workflowProcessId, 'freshchain-store-rescue');
    assert.equal(taskRows.data.value[0].workflowUrl, null);
  } finally {
    if (previousGenAiEndpoint === undefined) delete process.env.FRESHCHAIN_GENAI_ENDPOINT;
    else process.env.FRESHCHAIN_GENAI_ENDPOINT = previousGenAiEndpoint;
    if (previousGenAiModel === undefined) delete process.env.FRESHCHAIN_GENAI_MODEL;
    else process.env.FRESHCHAIN_GENAI_MODEL = previousGenAiModel;
  }
});

test('scoring fails closed when SAP AI Core binding is missing', async () => {
  const previousServices = process.env.VCAP_SERVICES;
  delete process.env.VCAP_SERVICES;
  try {
    const zones = await GET('/odata/v4/intelligence/Zones?$top=1');
    await assert.rejects(
      () => POST('/odata/v4/intelligence/scoreLatest', { zoneId: zones.data.value[0].ID }),
      /SAP AI Core service binding/
    );
  } finally {
    process.env.VCAP_SERVICES = previousServices;
  }
});

test('scoring fails closed when SAP AI Core inference is unavailable', async () => {
  await prepareAiCoreDeployment('scoring-fails');

  const zones = await GET('/odata/v4/intelligence/Zones?$top=1');
  inferenceFails = true;
  await assert.rejects(() => POST('/odata/v4/intelligence/scoreLatest', { zoneId: zones.data.value[0].ID }), /502/);
  inferenceFails = false;

  const telemetry = await GET('/odata/v4/intelligence/InferenceTelemetry?$top=10');
  const failed = telemetry.data.value.find(row => row.status === 'FAILED');
  assert.ok(failed);
  assert.equal(failed.aiCoreUnavailable, true);
});

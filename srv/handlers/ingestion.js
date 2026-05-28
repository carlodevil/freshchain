const crypto = require('crypto');
const cds = require('@sap/cds');
const { evaluateZoneRisk } = require('./rules');

const SUPPORTED_SCHEMA = '1.0';

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function bad(errorClass, message, statusCode = 400) {
  const error = new Error(message);
  error.errorClass = errorClass;
  error.statusCode = statusCode;
  return error;
}

function required(payload, path) {
  const value = path.split('.').reduce((acc, key) => acc && acc[key], payload);
  if (value === undefined || value === null || value === '') throw bad('VALIDATION_ERROR', `Missing required field ${path}`);
  return value;
}

function ensureRange(name, value, min, max) {
  if (value === undefined || value === null) return;
  if (Number.isNaN(Number(value)) || Number(value) < min || Number(value) > max) {
    throw bad('PLAUSIBILITY_ERROR', `${name} outside plausible range ${min}..${max}`);
  }
}

function parseDate(name, value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw bad('VALIDATION_ERROR', `${name} must be an ISO timestamp`);
  return date;
}

function validatePayload(payload) {
  required(payload, 'schemaVersion');
  required(payload, 'messageId');
  required(payload, 'correlationId');
  required(payload, 'eventType');
  required(payload, 'storeId');
  required(payload, 'zoneId');
  required(payload, 'sensorId');
  required(payload, 'measuredAt');
  required(payload, 'publishedAt');
  required(payload, 'readings.temperatureC');
  required(payload, 'readings.humidityPct');
  required(payload, 'readings.co2Ppm');
  required(payload, 'readings.oxygenPct');
  required(payload, 'readings.lightLux');
  required(payload, 'readings.doorOpen');

  if (payload.schemaVersion !== SUPPORTED_SCHEMA) throw bad('SCHEMA_VERSION_UNSUPPORTED', `Unsupported schemaVersion ${payload.schemaVersion}`);
  if (payload.eventType !== 'SensorReadingCreated') throw bad('EVENT_TYPE_UNSUPPORTED', `Unsupported eventType ${payload.eventType}`);

  const measuredAt = parseDate('measuredAt', payload.measuredAt);
  const publishedAt = parseDate('publishedAt', payload.publishedAt);
  const driftMinutes = Math.abs(Date.now() - measuredAt.getTime()) / 60000;
  if (driftMinutes > 60 * 24 * 7) throw bad('TIMESTAMP_DRIFT', 'measuredAt is more than seven days away from current time');
  if (publishedAt.getTime() + 60000 < measuredAt.getTime()) throw bad('TIMESTAMP_ORDER', 'publishedAt cannot be before measuredAt');

  ensureRange('temperatureC', payload.readings.temperatureC, -40, 60);
  ensureRange('humidityPct', payload.readings.humidityPct, 0, 100);
  ensureRange('co2Ppm', payload.readings.co2Ppm, 0, 100000);
  ensureRange('oxygenPct', payload.readings.oxygenPct, 0, 25);
  ensureRange('lightLux', payload.readings.lightLux, 0, 200000);
  ensureRange('batteryPct', payload.quality && payload.quality.batteryPct, 0, 100);

  return payload;
}

async function recordIngestionError(tx, payload, error, sourceQueue) {
  const { IngestionErrors } = cds.entities('freshchain');
  await tx.run(INSERT.into(IngestionErrors).entries({
    sourceQueue,
    messageId: payload && payload.messageId,
    correlationId: payload && payload.correlationId,
    errorClass: error.errorClass || 'INGESTION_FAILED',
    errorMessage: error.message,
    payloadHash: sha256(payload || {}),
    payload: JSON.stringify(payload || {}),
    retryCount: 0,
    status: 'OPEN'
  }));
}

async function ingestPayload(tx, rawPayload, options = {}) {
  const payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
  const sourceQueue = options.sourceQueue || 'local.readings';
  const entities = cds.entities('freshchain');
  const {
    Stores,
    Zones,
    Sensors,
    SensorReadings
  } = entities;

  try {
    validatePayload(payload);

    const duplicate = await tx.run(SELECT.one.from(SensorReadings).where({ sourceMessageId: payload.messageId }));
    if (duplicate) return { ok: true, duplicate: true, readingId: duplicate.ID, messageId: payload.messageId };

    const store = await tx.run(SELECT.one.from(Stores).where({ storeCode: payload.storeId }));
    if (!store) throw bad('MASTERDATA_NOT_FOUND', `Unknown storeId ${payload.storeId}`);

    const zone = await tx.run(SELECT.one.from(Zones).where({ zoneCode: payload.zoneId }));
    if (!zone) throw bad('MASTERDATA_NOT_FOUND', `Unknown zoneId ${payload.zoneId}`);
    if (zone.store_ID !== store.ID) throw bad('MASTERDATA_MISMATCH', `Zone ${payload.zoneId} does not belong to store ${payload.storeId}`);

    let sensor = await tx.run(SELECT.one.from(Sensors).where({ sensorId: payload.sensorId }));
    if (!sensor) {
      await tx.run(INSERT.into(Sensors).entries({
        sensorId: payload.sensorId,
        zone_ID: zone.ID,
        sensorType: 'SIM_TEMP_HUM_GAS',
        firmwareVersion: 'sim-1.0',
        healthStatus: 'OK'
      }));
      sensor = await tx.run(SELECT.one.from(Sensors).where({ sensorId: payload.sensorId }));
    }

    const qualityFlags = [];
    if (payload.quality && payload.quality.sensorHealth && payload.quality.sensorHealth !== 'OK') qualityFlags.push(payload.quality.sensorHealth);
    if (payload.quality && Number(payload.quality.batteryPct) < 20) qualityFlags.push('LOW_BATTERY');

    const reading = {
      store_ID: store.ID,
      zone_ID: zone.ID,
      sensor_ID: sensor.ID,
      measuredAt: payload.measuredAt,
      publishedAt: payload.publishedAt,
      temperatureC: payload.readings.temperatureC,
      humidityPct: payload.readings.humidityPct,
      co2Ppm: payload.readings.co2Ppm,
      oxygenPct: payload.readings.oxygenPct,
      lightLux: payload.readings.lightLux,
      doorOpen: payload.readings.doorOpen,
      batteryPct: payload.quality && payload.quality.batteryPct,
      signalStrength: payload.quality && payload.quality.signalStrength,
      sensorHealth: payload.quality && payload.quality.sensorHealth || 'OK',
      scenarioCode: payload.scenarioCode || 'NORMAL',
      sourceMessageId: payload.messageId,
      correlationId: payload.correlationId,
      schemaVersion: payload.schemaVersion,
      qualityFlags: qualityFlags.join(',')
    };

    await tx.run(INSERT.into(SensorReadings).entries(reading));
    await tx.run(UPDATE(Sensors).set({ lastSeenAt: payload.measuredAt, healthStatus: reading.sensorHealth }).where({ ID: sensor.ID }));

    const inserted = await tx.run(SELECT.one.from(SensorReadings).where({ sourceMessageId: payload.messageId }));
    const evaluation = await evaluateZoneRisk(tx, { store, zone, reading: inserted });

    return {
      ok: true,
      duplicate: false,
      messageId: payload.messageId,
      readingId: inserted.ID,
      alertId: evaluation.alertId,
      severity: evaluation.severity,
      riskLevel: evaluation.riskLevel
    };
  } catch (error) {
    error.payload = payload;
    error.sourceQueue = sourceQueue;
    throw error;
  }
}

module.exports = {
  ingestPayload,
  validatePayload,
  recordIngestionError
};

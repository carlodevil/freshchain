const cds = require('@sap/cds');

function toNumber(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function severityRank(value) {
  return { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[value] || 0;
}

function riskFromSeverity(severity) {
  return severity === 'CRITICAL' ? 'CRITICAL' : severity === 'HIGH' ? 'HIGH' : severity === 'MEDIUM' ? 'MEDIUM' : 'LOW';
}

function recommendationFor(type) {
  switch (type) {
    case 'TEMPERATURE_EXCURSION':
      return 'Inspect fridge airflow and door seal, then review affected batches for markdown or rotation.';
    case 'DOOR_LEFT_OPEN':
      return 'Close the door, inspect product exposure, and verify temperature recovery.';
    case 'COMPRESSOR_FAILURE':
      return 'Move affected stock to a safe zone and request maintenance immediately.';
    case 'STALE_SENSOR':
      return 'Check sensor connectivity and battery status.';
    default:
      return 'Inspect zone conditions and confirm product quality.';
  }
}

async function latestReadings(tx, zoneId, limit = 5) {
  const { SensorReadings } = cds.entities('freshchain');
  return tx.run(
    SELECT.from(SensorReadings)
      .where({ zone_ID: zoneId })
      .orderBy('measuredAt desc')
      .limit(limit)
  );
}

async function loadThreshold(tx, zone) {
  const { ThresholdConfigs } = cds.entities('freshchain');
  const specific = await tx.run(SELECT.one.from(ThresholdConfigs).where({ zoneType: zone.type, active: true }));
  return specific || {
    safeTempMinC: zone.safeTempMinC,
    safeTempMaxC: zone.safeTempMaxC,
    safeHumidityMin: zone.safeHumidityMin,
    safeHumidityMax: zone.safeHumidityMax,
    durationMinutes: 5,
    doorOpenSecondsLimit: 180,
    severity: 'HIGH'
  };
}

async function upsertAggregate(tx, context, readings) {
  const { ReadingAggregates } = cds.entities('freshchain');
  if (!readings.length) return null;

  const sorted = [...readings].sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt));
  const temps = sorted.map(r => toNumber(r.temperatureC));
  const humidities = sorted.map(r => toNumber(r.humidityPct));
  const doorOpenCount = sorted.filter(r => r.doorOpen).length;
  const co2First = toNumber(sorted[0].co2Ppm);
  const co2Last = toNumber(sorted[sorted.length - 1].co2Ppm);
  const oxygenFirst = toNumber(sorted[0].oxygenPct);
  const oxygenLast = toNumber(sorted[sorted.length - 1].oxygenPct);

  const aggregate = {
    store_ID: context.store.ID,
    zone_ID: context.zone.ID,
    windowStart: sorted[0].measuredAt,
    windowEnd: sorted[sorted.length - 1].measuredAt,
    windowSizeMinutes: Math.max(1, Math.round((new Date(sorted[sorted.length - 1].measuredAt) - new Date(sorted[0].measuredAt)) / 60000) || sorted.length),
    tempAvg: temps.reduce((a, b) => a + b, 0) / temps.length,
    tempMax: Math.max(...temps),
    humidityAvg: humidities.reduce((a, b) => a + b, 0) / humidities.length,
    co2Slope: co2Last - co2First,
    oxygenDrop: oxygenFirst - oxygenLast,
    doorOpenSeconds: doorOpenCount * 60,
    excursionMinutes: temps.filter(t => t > toNumber(context.zone.safeTempMaxC)).length,
    readingCount: sorted.length
  };

  await tx.run(INSERT.into(ReadingAggregates).entries(aggregate));
  return tx.run(SELECT.one.from(ReadingAggregates).where({ zone_ID: context.zone.ID }).orderBy('createdAt desc'));
}

async function createOrUpdateAlert(tx, context, decision) {
  const { Alerts, AlertActions } = cds.entities('freshchain');
  const activeKey = `${context.zone.zoneCode}:${decision.alertType}`;
  const existing = await tx.run(SELECT.one.from(Alerts).where({ activeKey, status: { in: ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'REOPENED'] } }));

  const values = {
    store_ID: context.store.ID,
    zone_ID: context.zone.ID,
    severity: decision.severity,
    status: existing && severityRank(existing.severity) >= severityRank(decision.severity) ? existing.status : 'OPEN',
    alertType: decision.alertType,
    title: decision.title,
    evidenceWindow: decision.evidenceWindow,
    recommendation: recommendationFor(decision.alertType),
    source: 'RULE_ENGINE',
    activeKey
  };

  if (existing) {
    await tx.run(UPDATE(Alerts).set(values).where({ ID: existing.ID }));
    return { alertId: existing.ID, updated: true };
  }

  await tx.run(INSERT.into(Alerts).entries(values));
  const alert = await tx.run(SELECT.one.from(Alerts).where({ activeKey }).orderBy('createdAt desc'));
  await tx.run(INSERT.into(AlertActions).entries({
    alert_ID: alert.ID,
    actionType: 'CREATED',
    performedBy: 'rule-engine',
    comment: decision.title,
    previousStatus: null,
    newStatus: 'OPEN',
    completedAt: new Date().toISOString()
  }));
  return { alertId: alert.ID, updated: false };
}

function decide(context, threshold, readings) {
  const temp = toNumber(context.reading.temperatureC);
  const max = toNumber(threshold.safeTempMaxC, toNumber(context.zone.safeTempMaxC));
  const min = toNumber(threshold.safeTempMinC, toNumber(context.zone.safeTempMinC));
  const doorOpenSeconds = readings.filter(r => r.doorOpen).length * 60;
  const scenario = context.reading.scenarioCode || 'NORMAL';
  const measuredAt = context.reading.measuredAt;

  if (scenario === 'COMPRESSOR_FAILURE' || temp >= max + 6) {
    return {
      alertType: 'COMPRESSOR_FAILURE',
      severity: 'CRITICAL',
      title: `${context.zone.zoneCode} compressor failure risk`,
      evidenceWindow: `${readings.length} readings ending ${measuredAt}`
    };
  }
  if (temp > max || temp < min) {
    return {
      alertType: 'TEMPERATURE_EXCURSION',
      severity: threshold.severity || 'HIGH',
      title: `${context.zone.zoneCode} temperature outside safe range`,
      evidenceWindow: `${temp}C vs safe ${min}C..${max}C at ${measuredAt}`
    };
  }
  if (doorOpenSeconds >= toNumber(threshold.doorOpenSecondsLimit, 180)) {
    return {
      alertType: 'DOOR_LEFT_OPEN',
      severity: 'HIGH',
      title: `${context.zone.zoneCode} door has been open too long`,
      evidenceWindow: `${doorOpenSeconds} seconds open in recent readings ending ${measuredAt}`
    };
  }
  return {
    alertType: 'NORMAL',
    severity: 'LOW',
    title: `${context.zone.zoneCode} normal`,
    evidenceWindow: `Latest reading ${measuredAt}`
  };
}

async function evaluateZoneRisk(tx, context) {
  const readings = await latestReadings(tx, context.zone.ID, 5);
  const threshold = await loadThreshold(tx, context.zone);
  const decision = decide(context, threshold, readings);
  await upsertAggregate(tx, context, readings);

  if (decision.alertType === 'NORMAL') {
    return { alertId: null, severity: 'LOW', riskLevel: 'LOW' };
  }

  const alert = await createOrUpdateAlert(tx, context, decision);
  return { alertId: alert.alertId, severity: decision.severity, riskLevel: riskFromSeverity(decision.severity) };
}

module.exports = {
  evaluateZoneRisk,
  riskFromSeverity
};

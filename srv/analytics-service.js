const cds = require('@sap/cds');
const { SELECT } = cds.ql;

const ACTIVE_ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'REOPENED'];
const HIGH_ALERT_SEVERITIES = ['HIGH', 'CRITICAL'];

module.exports = cds.service.impl(function AnalyticsService() {
  this.on('getDashboardSummary', getDashboardSummary);
  this.after('READ', 'ActiveAlerts', addActiveAlertCriticality);
});

function addActiveAlertCriticality(rows) {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  for (const row of list) {
    row.criticality = row.status === 'RESOLVED' ? 3 : severityCriticality(row.severity);
  }
}

function severityCriticality(severity) {
  const value = String(severity || '').toUpperCase();
  if (value === 'CRITICAL') return 1;
  if (value === 'HIGH') return 2;
  if (value === 'MEDIUM') return 2;
  return 3;
}

async function getDashboardSummary(req) {
  const { Stores, Zones, Alerts, SensorReadings, IngestionErrors } = cds.entities('freshchain');
  const tx = cds.tx(req);
  const [stores, zones, activeAlerts, highAlerts, openIngestionErrors, latestReading] = await Promise.all([
    countRows(tx, Stores),
    countRows(tx, Zones),
    countRows(tx, Alerts, { status: { in: ACTIVE_ALERT_STATUSES } }),
    countRows(tx, Alerts, {
      status: { in: ACTIVE_ALERT_STATUSES },
      severity: { in: HIGH_ALERT_SEVERITIES }
    }),
    countRows(tx, IngestionErrors, { status: 'OPEN' }),
    tx.run(SELECT.one.from(SensorReadings).columns('measuredAt').orderBy('measuredAt desc'))
  ]);

  return {
    stores,
    zones,
    activeAlerts,
    highAlerts,
    openIngestionErrors,
    lastReadingAt: latestReading && latestReading.measuredAt || null
  };
}

async function countRows(tx, entity, where) {
  const query = SELECT.one`count(*) as count`.from(entity);
  if (where) query.where(where);

  const row = await tx.run(query);
  return Number(row && row.count || 0);
}

const cds = require('@sap/cds');
const { evaluateZoneRisk } = require('./handlers/rules');

function userId(req) {
  return (req.user && req.user.id) || 'anonymous';
}

async function appendAction(tx, alert, data) {
  const { AlertActions } = cds.entities('freshchain');
  await tx.run(INSERT.into(AlertActions).entries({
    alert_ID: alert.ID,
    actionType: data.actionType,
    assignedTo: data.assignedTo,
    performedBy: data.performedBy,
    comment: data.comment,
    previousStatus: alert.status,
    newStatus: data.newStatus,
    outcome: data.outcome,
    completedAt: new Date().toISOString()
  }));
}

async function loadAlert(tx, req) {
  const { Alerts } = cds.entities('freshchain');
  const key = req.params && req.params.find(param => param !== undefined);
  const id = key && typeof key === 'object' ? key.ID : key;
  const alert = await tx.run(SELECT.one.from(Alerts).where({ ID: id }));
  if (!alert) req.reject(404, `Alert ${id} not found`);
  return alert;
}

module.exports = cds.service.impl(function () {
  const { Alerts, Zones, Stores, SensorReadings } = cds.entities('freshchain');

  this.before(['UPDATE', 'DELETE'], 'SensorReadings', req => req.reject(405, 'Sensor readings are append-only'));

  this.on('acknowledge', 'Alerts', async req => {
    const tx = cds.tx(req);
    const alert = await loadAlert(tx, req);
    await tx.run(UPDATE(Alerts).set({ status: 'ACKNOWLEDGED', acknowledgedAt: new Date().toISOString() }).where({ ID: alert.ID }));
    await appendAction(tx, alert, { actionType: 'ACKNOWLEDGED', performedBy: userId(req), comment: req.data.comment, newStatus: 'ACKNOWLEDGED' });
    return tx.run(SELECT.one.from(Alerts).where({ ID: alert.ID }));
  });

  this.on('assign', 'Alerts', async req => {
    const tx = cds.tx(req);
    const alert = await loadAlert(tx, req);
    await tx.run(UPDATE(Alerts).set({ status: 'ASSIGNED', assignedTo: req.data.userId }).where({ ID: alert.ID }));
    await appendAction(tx, alert, { actionType: 'ASSIGNED', assignedTo: req.data.userId, performedBy: userId(req), comment: req.data.comment, newStatus: 'ASSIGNED' });
    return tx.run(SELECT.one.from(Alerts).where({ ID: alert.ID }));
  });

  this.on('resolve', 'Alerts', async req => {
    const tx = cds.tx(req);
    const alert = await loadAlert(tx, req);
    await tx.run(UPDATE(Alerts).set({ status: 'RESOLVED', resolvedAt: new Date().toISOString(), outcome: req.data.outcome }).where({ ID: alert.ID }));
    await appendAction(tx, alert, { actionType: 'RESOLVED', performedBy: userId(req), comment: req.data.comment, outcome: req.data.outcome, newStatus: 'RESOLVED' });
    return tx.run(SELECT.one.from(Alerts).where({ ID: alert.ID }));
  });

  this.on('reopen', 'Alerts', async req => {
    const tx = cds.tx(req);
    const alert = await loadAlert(tx, req);
    await tx.run(UPDATE(Alerts).set({ status: 'REOPENED', resolvedAt: null, outcome: null }).where({ ID: alert.ID }));
    await appendAction(tx, alert, { actionType: 'REOPENED', performedBy: userId(req), comment: req.data.comment, newStatus: 'REOPENED' });
    return tx.run(SELECT.one.from(Alerts).where({ ID: alert.ID }));
  });

  this.on('addNote', 'Alerts', async req => {
    const tx = cds.tx(req);
    const alert = await loadAlert(tx, req);
    await appendAction(tx, alert, { actionType: 'NOTE', performedBy: userId(req), comment: req.data.comment, newStatus: alert.status });
    return tx.run(SELECT.one.from(Alerts).where({ ID: alert.ID }));
  });

  this.on('triggerManualRiskEvaluation', async req => {
    const tx = cds.tx(req);
    const zone = await tx.run(SELECT.one.from(Zones).where({ ID: req.data.zoneId }));
    if (!zone) req.reject(404, `Zone ${req.data.zoneId} not found`);
    const store = await tx.run(SELECT.one.from(Stores).where({ ID: zone.store_ID }));
    const reading = await tx.run(SELECT.one.from(SensorReadings).where({ zone_ID: zone.ID }).orderBy('measuredAt desc'));
    if (!reading) req.reject(409, `Zone ${zone.zoneCode} has no readings to evaluate`);
    const result = await evaluateZoneRisk(tx, { store, zone, reading });
    if (!result.alertId) return null;
    return tx.run(SELECT.one.from(Alerts).where({ ID: result.alertId }));
  });
});

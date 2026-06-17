const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const { evaluateZoneRisk } = require('./handlers/rules');
const {
  receiveStock,
  moveStock,
  applyMarkdown,
  writeOffStock,
  readZoneOccupancy
} = require('./handlers/stock-ledger');
const {
  acknowledgeAlert,
  addAlertNote,
  assignAlert,
  reopenAlert,
  resolveAlert
} = require('./handlers/alert-workflow');

function authenticatedUserId(req) {
  const id = req.user && req.user.id;
  if (!id) req.reject(401, 'Authenticated user is required for stock and alert audit proof');
  return id;
}

async function readZoneOccupancyForRequest(req, entities) {
  const rows = await readZoneOccupancy(cds.tx(req), entities);
  rows.$count = rows.length;
  return rows;
}

async function triggerManualRiskEvaluationForRequest(req, entities) {
  const { Alerts, Zones, Stores, SensorReadings } = entities;
  const tx = cds.tx(req);
  const zone = await tx.run(SELECT.one.from(Zones).where({ ID: req.data.zoneId }));
  if (!zone) return req.reject(404, `Zone ${req.data.zoneId} not found`);

  const store = await tx.run(SELECT.one.from(Stores).where({ ID: zone.store_ID }));
  const reading = await tx.run(SELECT.one.from(SensorReadings).where({ zone_ID: zone.ID }).orderBy('measuredAt desc'));
  if (!reading) return req.reject(409, `Zone ${zone.zoneCode} has no readings to evaluate`);

  const result = await evaluateZoneRisk(tx, { store, zone, reading });
  if (!result.alertId) return null;

  return tx.run(SELECT.one.from(Alerts).where({ ID: result.alertId }));
}

async function runStockAction(req, action, entities) {
  try {
    return await action(cds.tx(req), req.data, authenticatedUserId(req), entities);
  } catch (error) {
    return req.reject(error.statusCode || 500, error.message);
  }
}

module.exports = cds.service.impl(function CatalogService() {
  const persistenceEntities = cds.entities('freshchain');
  const { Alerts, AlertActions, Zones, Stores, SensorReadings } = persistenceEntities;
  const catalogEntities = { Alerts, Zones, Stores, SensorReadings };
  const alertActions = { Alerts, AlertActions, auditMessage: 'Authenticated user is required for stock and alert audit proof' };

  function readZoneOccupancy(req) {
    return readZoneOccupancyForRequest(req, persistenceEntities);
  }

  function acknowledgeAlertAction(req) {
    return acknowledgeAlert(req, alertActions);
  }

  function assignAlertAction(req) {
    return assignAlert(req, alertActions);
  }

  function resolveAlertAction(req) {
    return resolveAlert(req, alertActions);
  }

  function reopenAlertAction(req) {
    return reopenAlert(req, alertActions);
  }

  function addAlertNoteAction(req) {
    return addAlertNote(req, alertActions);
  }

  this.on('acknowledge', 'Alerts', acknowledgeAlertAction);
  this.on('assign', 'Alerts', assignAlertAction);
  this.on('resolve', 'Alerts', resolveAlertAction);
  this.on('reopen', 'Alerts', reopenAlertAction);
  this.on('addNote', 'Alerts', addAlertNoteAction);

  function triggerManualRiskEvaluation(req) {
    return triggerManualRiskEvaluationForRequest(req, catalogEntities);
  }

  function receiveStockAction(req) {
    return runStockAction(req, receiveStock, persistenceEntities);
  }

  function moveStockAction(req) {
    return runStockAction(req, moveStock, persistenceEntities);
  }

  function applyMarkdownAction(req) {
    return runStockAction(req, applyMarkdown, persistenceEntities);
  }

  function writeOffStockAction(req) {
    return runStockAction(req, writeOffStock, persistenceEntities);
  }

  this.on('READ', 'ZoneOccupancy', readZoneOccupancy);
  this.on('triggerManualRiskEvaluation', triggerManualRiskEvaluation);
  this.on('receiveStock', receiveStockAction);
  this.on('moveStock', moveStockAction);
  this.on('applyMarkdown', applyMarkdownAction);
  this.on('writeOffStock', writeOffStockAction);
});

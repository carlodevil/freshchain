const cds = require('@sap/cds');

const { SELECT, INSERT, UPDATE } = cds.ql;

const DEFAULT_AUDIT_MESSAGE = 'Authenticated user is required for alert audit proof';

function authenticatedUserId(req, message = DEFAULT_AUDIT_MESSAGE) {
  const id = req.user && req.user.id;
  if (!id) req.reject(401, message);
  return id;
}

function boundRequestId(req) {
  const key = req.params && req.params.find(param => param !== undefined);
  return key && typeof key === 'object' ? key.ID : key;
}

async function loadAlert(tx, Alerts, req, label = 'Alert') {
  const id = boundRequestId(req);
  const alert = await tx.run(SELECT.one.from(Alerts).where({ ID: id }));
  if (!alert) req.reject(404, `${label} ${id} not found`);
  return alert;
}

async function recordAlertAction(tx, AlertActions, alert, data, completedAt) {
  await tx.run(INSERT.into(AlertActions).entries({
    alert_ID: alert.ID,
    actionType: data.actionType,
    assignedTo: data.assignedTo,
    performedBy: data.performedBy,
    comment: data.comment,
    previousStatus: alert.status,
    newStatus: data.newStatus,
    outcome: data.outcome,
    completedAt
  }));
}

async function readUpdatedAlert(tx, Alerts, alert) {
  return tx.run(SELECT.one.from(Alerts).where({ ID: alert.ID }));
}

function timestamp(options) {
  return options.now ? options.now() : new Date().toISOString();
}

async function transitionAlert(req, options) {
  const tx = cds.tx(req);
  const now = timestamp(options);
  const alert = await loadAlert(tx, options.Alerts, req, options.notFoundLabel);
  const performedBy = authenticatedUserId(req, options.auditMessage);

  await tx.run(UPDATE(options.Alerts).set(options.update(req, now)).where({ ID: alert.ID }));
  await recordAlertAction(tx, options.AlertActions, alert, {
    actionType: options.actionType,
    assignedTo: options.assignedTo && options.assignedTo(req),
    performedBy,
    comment: req.data.comment,
    newStatus: options.newStatus,
    outcome: options.outcome && options.outcome(req)
  }, now);

  return options.readUpdated
    ? options.readUpdated(tx, alert)
    : readUpdatedAlert(tx, options.Alerts, alert);
}

function acknowledgeAlert(req, options) {
  return transitionAlert(req, {
    ...options,
    actionType: 'ACKNOWLEDGED',
    newStatus: 'ACKNOWLEDGED',
    update: (_req, now) => ({ status: 'ACKNOWLEDGED', acknowledgedAt: now })
  });
}

function assignAlert(req, options) {
  return transitionAlert(req, {
    ...options,
    actionType: 'ASSIGNED',
    newStatus: 'ASSIGNED',
    assignedTo: req => req.data.userId,
    update: req => ({ status: 'ASSIGNED', assignedTo: req.data.userId })
  });
}

function resolveAlert(req, options) {
  return transitionAlert(req, {
    ...options,
    actionType: 'RESOLVED',
    newStatus: 'RESOLVED',
    outcome: req => req.data.outcome,
    update: (req, now) => ({ status: 'RESOLVED', resolvedAt: now, outcome: req.data.outcome })
  });
}

function reopenAlert(req, options) {
  return transitionAlert(req, {
    ...options,
    actionType: 'REOPENED',
    newStatus: 'REOPENED',
    update: () => ({ status: 'REOPENED', resolvedAt: null, outcome: null })
  });
}

async function addAlertNote(req, options) {
  const tx = cds.tx(req);
  const now = timestamp(options);
  const alert = await loadAlert(tx, options.Alerts, req, options.notFoundLabel);

  await recordAlertAction(tx, options.AlertActions, alert, {
    actionType: 'NOTE',
    performedBy: authenticatedUserId(req, options.auditMessage),
    comment: req.data.comment,
    newStatus: alert.status
  }, now);

  return options.readUpdated
    ? options.readUpdated(tx, alert)
    : readUpdatedAlert(tx, options.Alerts, alert);
}

module.exports = {
  acknowledgeAlert,
  addAlertNote,
  assignAlert,
  reopenAlert,
  resolveAlert
};

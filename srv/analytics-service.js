const cds = require('@sap/cds');

module.exports = cds.service.impl(function () {
  this.on('getDashboardSummary', async req => {
    const { Stores, Zones, Alerts, SensorReadings, IngestionErrors } = cds.entities('freshchain');
    const tx = this.tx(req);
    const [stores, zones, alerts, readings, errors] = await Promise.all([
      tx.run(SELECT.from(Stores)),
      tx.run(SELECT.from(Zones)),
      tx.run(SELECT.from(Alerts).where({ status: { in: ['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'REOPENED'] } })),
      tx.run(SELECT.from(SensorReadings).orderBy('measuredAt desc').limit(1)),
      tx.run(SELECT.from(IngestionErrors).where({ status: 'OPEN' }))
    ]);

    return JSON.stringify({
      stores: stores.length,
      zones: zones.length,
      activeAlerts: alerts.length,
      highAlerts: alerts.filter(a => ['HIGH', 'CRITICAL'].includes(a.severity)).length,
      openIngestionErrors: errors.length,
      lastReadingAt: readings[0] && readings[0].measuredAt || null
    });
  });
});

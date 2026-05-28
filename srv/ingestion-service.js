const cds = require('@sap/cds');
const { ingestPayload, recordIngestionError } = require('./handlers/ingestion');

module.exports = cds.service.impl(function () {
  this.on('ingestSensorReading', async req => {
    const payload = JSON.parse(req.data.payload);
    try {
      const result = await ingestPayload(this.tx(req), payload, { sourceQueue: 'cap.action.readings' });
      return JSON.stringify(result);
    } catch (error) {
      await cds.tx(async tx => recordIngestionError(tx, payload, error, 'cap.action.readings'));
      throw error;
    }
  });
});

const cds = require('@sap/cds');
const { ingestPayload, recordIngestionError } = require('./handlers/ingestion');

const SOURCE_QUEUE = 'cap.action.readings';

module.exports = cds.service.impl(function IngestionService() {
  this.on('ingestSensorReading', ingestSensorReading);
});

async function ingestSensorReading(req) {
  const payload = parseSensorReadingPayload(req.data.payload);

  try {
    return await ingestPayload(cds.tx(req), payload, { sourceQueue: SOURCE_QUEUE });
  } catch (error) {
    await cds.tx(async tx => recordIngestionError(tx, payload, error, SOURCE_QUEUE));
    throw error;
  }
}

function parseSensorReadingPayload(rawPayload) {
  return typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
}

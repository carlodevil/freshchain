const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const { ingestPayload } = require('./handlers/ingestion');

module.exports = cds.service.impl(function AdminService() {
  const { IngestionErrors } = this.entities;

  this.on('replayIngestionError', replayIngestionError);

  async function replayIngestionError(req) {
    const tx = cds.tx(req);
    const error = await tx.run(SELECT.one.from(IngestionErrors).where({ ID: req.data.errorId }));
    if (!error) return req.reject(404, `Ingestion error ${req.data.errorId} not found`);

    const retryCount = Number(error.retryCount || 0) + 1;
    if (!error.payload) {
      await tx.run(UPDATE(IngestionErrors).set({ retryCount, status: 'REPLAY_FAILED' }).where({ ID: error.ID }));
      return {
        status: 'REPLAY_FAILED',
        reason: 'Stored ingestion error has no payload to replay.',
        messageId: error.messageId
      };
    }

    try {
      const result = await ingestPayload(tx, error.payload, { sourceQueue: 'admin.replay' });
      await tx.run(UPDATE(IngestionErrors).set({ retryCount, status: 'REPLAYED' }).where({ ID: error.ID }));
      return {
        status: result.duplicate ? 'DUPLICATE' : 'REPLAYED',
        reason: result.duplicate ? 'Payload was already ingested.' : 'Payload replayed successfully.',
        messageId: error.messageId
      };
    } catch (replayError) {
      await tx.run(UPDATE(IngestionErrors).set({ retryCount, status: 'REPLAY_FAILED' }).where({ ID: error.ID }));
      return {
        status: 'REPLAY_FAILED',
        reason: replayError.message,
        messageId: error.messageId
      };
    }
  }
});

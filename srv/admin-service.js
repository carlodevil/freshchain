const cds = require('@sap/cds');
const { SELECT } = cds.ql;

module.exports = cds.service.impl(function AdminService() {
  const { IngestionErrors } = this.entities;

  this.on('replayIngestionError', replayIngestionError);

  async function replayIngestionError(req) {
    const tx = cds.tx(req);
    const error = await tx.run(SELECT.one.from(IngestionErrors).where({ ID: req.data.errorId }));
    if (!error) return req.reject(404, `Ingestion error ${req.data.errorId} not found`);

    return {
      status: 'NOT_REPLAYED',
      reason: 'Replay requires operator correction and is intentionally manual in v1.',
      messageId: error.messageId
    };
  }
});

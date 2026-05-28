const cds = require('@sap/cds');

module.exports = cds.service.impl(function () {
  this.on('replayIngestionError', async req => {
    const { IngestionErrors } = cds.entities('freshchain');
    const tx = this.tx(req);
    const error = await tx.run(SELECT.one.from(IngestionErrors).where({ ID: req.data.errorId }));
    if (!error) req.reject(404, `Ingestion error ${req.data.errorId} not found`);
    return JSON.stringify({
      status: 'NOT_REPLAYED',
      reason: 'Replay requires operator correction and is intentionally manual in v1.',
      messageId: error.messageId
    });
  });
});

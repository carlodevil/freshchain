const cds = require('@sap/cds');
const express = require('express');
const { ingestPayload, recordIngestionError } = require('./handlers/ingestion');

cds.on('bootstrap', app => {
  app.use(express.json({ limit: '40mb' }));

  app.use((req, _res, next) => {
    const match = req.url.match(/^\/freshchain-[^/]+\/webapp\/odata\/(.*)$/);
    if (match) {
      req.url = `/odata/${match[1]}`;
    }
    next();
  });

  app.post('/ingest/sensor-readings', async (req, res) => {
    try {
      const result = await cds.tx(async tx => ingestPayload(tx, req.body, { sourceQueue: 'http.local.readings' }));
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      await cds.tx(async tx => recordIngestionError(tx, error.payload || req.body, error, error.sourceQueue || 'http.local.readings'));
      const status = error.statusCode || 400;
      res.status(status).json({
        ok: false,
        errorClass: error.errorClass || 'INGESTION_FAILED',
        message: error.message
      });
    }
  });

});

module.exports = cds.server;

const cds = require('@sap/cds');
const express = require('express');
const path = require('path');
const { ingestPayload, recordIngestionError } = require('./handlers/ingestion');

cds.on('bootstrap', app => {
  app.use(express.json({ limit: '40mb' }));

  const uiApps = [
    ['controltower', 'freshchain-controltower'],
    ['overview', 'freshchain-overview'],
    ['operations', 'freshchain-operations'],
    ['intelligence', 'freshchain-intelligence'],
    ['stores', 'freshchain-stores'],
    ['areas', 'freshchain-areas'],
    ['sensors', 'freshchain-sensors'],
    ['products', 'freshchain-products'],
    ['thresholds', 'freshchain-thresholds'],
    ['impactsettings', 'freshchain-impactsettings'],
    ['ingestionerrors', 'freshchain-ingestionerrors'],
    ['masterdata', 'freshchain-masterdata'],
    ['monitoring', 'freshchain-monitoring'],
    ['admin', 'freshchain-admin']
  ];

  app.use((req, _res, next) => {
    const match = req.url.match(/^\/freshchain-[^/]+\/webapp\/odata\/(.*)$/)
      || req.url.match(/^\/(?:controltower|overview|operations|intelligence|stores|areas|sensors|products|thresholds|impactsettings|ingestionerrors|masterdata|monitoring|admin)\/odata\/(.*)$/);
    if (match) {
      req.url = `/odata/${match[1]}`;
    }
    next();
  });

  for (const [route, folder] of uiApps) {
    const mountPath = `/${route}`;
    const staticRoots = [
      path.join(__dirname, '..', 'resources', folder),
      path.join(__dirname, '..', 'app', folder, 'webapp')
    ];
    for (const staticRoot of staticRoots) {
      app.use(mountPath, express.static(staticRoot));
    }
  }

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

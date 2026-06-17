const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fioriAnnotations = fs.readFileSync(path.join(root, 'srv/fiori-annotations.cds'), 'utf8');
const configurationService = fs.readFileSync(path.join(root, 'srv/configuration-service.cds'), 'utf8');

const manifests = [
  'app/freshchain-controltower/webapp/manifest.json',
  'app/freshchain-operations/webapp/manifest.json',
  'app/freshchain-overview/webapp/manifest.json',
  'app/freshchain-intelligence/webapp/manifest.json',
  'app/freshchain-stores/webapp/manifest.json',
  'app/freshchain-areas/webapp/manifest.json',
  'app/freshchain-sensors/webapp/manifest.json',
  'app/freshchain-products/webapp/manifest.json',
  'app/freshchain-thresholds/webapp/manifest.json',
  'app/freshchain-impactsettings/webapp/manifest.json',
  'app/freshchain-ingestionerrors/webapp/manifest.json',
  'app/freshchain-admin/webapp/manifest.json',
  'app/freshchain-masterdata/webapp/manifest.json',
  'app/freshchain-monitoring/webapp/manifest.json'
];

const xsApps = [
  'app/freshchain-controltower/webapp/xs-app.json',
  'app/freshchain-operations/webapp/xs-app.json',
  'app/freshchain-overview/webapp/xs-app.json',
  'app/freshchain-intelligence/webapp/xs-app.json',
  'app/freshchain-stores/webapp/xs-app.json',
  'app/freshchain-areas/webapp/xs-app.json',
  'app/freshchain-sensors/webapp/xs-app.json',
  'app/freshchain-products/webapp/xs-app.json',
  'app/freshchain-thresholds/webapp/xs-app.json',
  'app/freshchain-impactsettings/webapp/xs-app.json',
  'app/freshchain-ingestionerrors/webapp/xs-app.json',
  'app/freshchain-admin/webapp/xs-app.json',
  'app/freshchain-masterdata/webapp/xs-app.json',
  'app/freshchain-monitoring/webapp/xs-app.json'
];

const maintenanceEntitySets = new Set([
  'Stores',
  'Zones',
  'Sensors',
  'Products',
  'ThresholdConfigs',
  'ImpactSettings',
  'IngestionErrors'
]);

for (const file of manifests) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const dataSources = manifest['sap.app'] && manifest['sap.app'].dataSources;
  if (dataSources) {
    const defaultModel = manifest['sap.ui5'] && manifest['sap.ui5'].models && manifest['sap.ui5'].models[''];
    if (!defaultModel || !dataSources[defaultModel.dataSource]) {
      throw new Error(`${file} must expose its CAP service through the default UI5 OData model`);
    }
  }

  if (manifest['sap.ovp']) {
    if (!manifest['sap.ui5'].dependencies.libs['sap.ovp']) {
      throw new Error(`${file} must declare sap.ovp for Overview Page usage`);
    }
    const cardMap = manifest['sap.ovp'].cards || {};
    const cards = Object.values(cardMap);
    if (!cards.length) {
      throw new Error(`${file} must define at least one OVP card`);
    }
    if (file.includes('freshchain-controltower')) {
      validateControlTowerCards(file, cardMap);
    }
    for (const card of cards) {
      validateOvpCard(file, card);
    }
  } else if (file.includes('freshchain-overview')) {
    const rootView = manifest['sap.ui5'] && manifest['sap.ui5'].rootView;
    if (!rootView || rootView.viewName !== 'freshchain.overview.view.App') {
      throw new Error(`${file} must use the live demo cockpit root view`);
    }
    const dataSources = manifest['sap.app']?.dataSources || {};
    if (!dataSources.liveDemoService || dataSources.liveDemoService.uri !== 'odata/v4/live-demo/') {
      throw new Error(`${file} must stay wired to LiveDemoService`);
    }
    validateRescueCockpitInbounds(file, manifest);
  } else {
    const targets = manifest['sap.ui5'] && manifest['sap.ui5'].routing && manifest['sap.ui5'].routing.targets;
    const targetNames = Object.values(targets || {}).map(target => target.name);
    if (!targetNames.includes('sap.fe.templates.ListReport') || !targetNames.includes('sap.fe.templates.ObjectPage')) {
      throw new Error(`${file} must use Fiori elements ListReport and ObjectPage templates`);
    }
  }
  if (JSON.stringify(manifest).includes('sap.fe.core.fpm')) {
    throw new Error(`${file} must not use Flexible Programming Model pages`);
  }
  if (manifest['sap.ui5'].rootView && !file.includes('freshchain-overview')) {
    throw new Error(`${file} must not use a freestyle rootView`);
  }

  if (file.match(/freshchain-(stores|areas|sensors|products|thresholds|impactsettings|ingestionerrors)\//)) {
    validateMaintenanceApp(file, manifest);
  }

  if (file.includes('freshchain-controltower')) {
    const inbounds = manifest['sap.app']?.crossNavigation?.inbounds || {};
    for (const inboundId of [
      'FreshChainProtectedRevenue-display',
      'FreshChainStockAtRisk-display',
      'FreshChainRescueProof-display',
      'FreshChainWasteAvoided-display'
    ]) {
      const inbound = inbounds[inboundId];
      if (!inbound?.indicatorDataSource?.dataSource || !inbound.indicatorDataSource.path || !inbound.indicatorDataSource.refresh) {
        throw new Error(`${file} inbound ${inboundId} must be a real dynamic KPI tile with indicatorDataSource`);
      }
    }
  }
}

for (const file of xsApps) {
  const xsApp = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const hasSrvRoute = (xsApp.routes || []).some(route => route.destination === 'srv-api');
  if (!hasSrvRoute) {
    throw new Error(`${file} must route CAP service requests through the srv-api destination`);
  }
}

for (const file of [
  'app/freshchain-operations/webapp/Component.js',
  'app/freshchain-controltower/webapp/Component.js',
  'app/freshchain-overview/webapp/Component.js',
  'app/freshchain-intelligence/webapp/Component.js',
  'app/freshchain-stores/webapp/Component.js',
  'app/freshchain-areas/webapp/Component.js',
  'app/freshchain-sensors/webapp/Component.js',
  'app/freshchain-products/webapp/Component.js',
  'app/freshchain-thresholds/webapp/Component.js',
  'app/freshchain-impactsettings/webapp/Component.js',
  'app/freshchain-ingestionerrors/webapp/Component.js',
  'app/freshchain-admin/webapp/Component.js',
  'app/freshchain-masterdata/webapp/Component.js',
  'app/freshchain-monitoring/webapp/Component.js'
]) {
  new Function(fs.readFileSync(path.join(root, file), 'utf8'));
}

const mta = fs.readFileSync(path.join(root, 'mta.yaml'), 'utf8');
for (const appName of manifests.map(file => path.basename(path.dirname(path.dirname(file))))) {
  const zipName = appName.replace('freshchain-', 'freshchain').replace(/-/g, '') + '.zip';
  if (!mta.includes(`name: ${appName}`) || !mta.includes(zipName)) {
    throw new Error(`${appName} must be packaged as HTML5 content for the Work Zone managed approuter`);
  }
}

const srvBuildBlock = mta.match(/- name: freshchain-srv[\s\S]*?(?=\n  - name: freshchain-db-deployer)/);
if (srvBuildBlock && /resources\/freshchain-|cp -R \.\.\/\.\.\/app/.test(srvBuildBlock[0])) {
  throw new Error('freshchain-srv must not package Fiori webapps; Work Zone should launch HTML5 apps through the managed approuter');
}

const blockedHttpPatterns = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bjQuery\.ajax\s*\(/,
  /\$\.ajax\s*\(/
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

for (const file of walk(path.join(root, 'app'))) {
  if (!file.includes(`${path.sep}webapp${path.sep}`) || !/\.(js|xml|json)$/.test(file)) {
    continue;
  }
  const source = fs.readFileSync(file, 'utf8');
  if (blockedHttpPatterns.some((pattern) => pattern.test(source))) {
    throw new Error(`${path.relative(root, file)} must use UI5 models instead of raw HTTP calls`);
  }
}

console.log('UI artifact validation passed');

function validateOvpCard(file, card) {
  const settings = card.settings || {};
  if (!settings.title || !settings.subTitle || !settings.entitySet) {
    throw new Error(`${file} OVP cards must provide title, subtitle, and entitySet`);
  }
  if (card.template === 'sap.ovp.cards.v4.charts.analytical') {
    for (const property of [
      'selectionAnnotationPath',
      'chartAnnotationPath',
      'presentationAnnotationPath'
    ]) {
      if (!settings[property]) {
        throw new Error(`${file} analytical OVP card ${settings.title} must provide ${property}`);
      }
    }
    return;
  }
  if (!settings.annotationPath) {
    throw new Error(`${file} OVP card ${settings.title} must provide annotationPath`);
  }
}

function validateRescueCockpitInbounds(file, manifest) {
  const inbounds = manifest['sap.app']?.crossNavigation?.inbounds || {};
  const rescueInbound = inbounds['FreshChainRescueCockpit-display'];
  if (!rescueInbound || rescueInbound.semanticObject !== 'FreshChainRescueCockpit') {
    throw new Error(`${file} must expose a non-stale FreshChainRescueCockpit intent for Work Zone`);
  }
  const legacyInbound = inbounds['FreshChainSense-display'];
  if (!legacyInbound || legacyInbound.semanticObject !== 'FreshChainSense') {
    throw new Error(`${file} must retain the legacy FreshChainSense intent until existing Work Zone tiles are replaced`);
  }
  for (const [inboundId, inbound] of Object.entries({ rescueInbound, legacyInbound })) {
    if (inbound.title !== 'FreshChain Rescue Cockpit') {
      throw new Error(`${file} ${inboundId} must render as FreshChain Rescue Cockpit`);
    }
    if (inbound.indicatorDataSource?.path !== "DynamicTileKpis('stockAtRisk')") {
      throw new Error(`${file} ${inboundId} must use the live stock-at-risk dynamic tile`);
    }
  }
}

function validateMaintenanceApp(file, manifest) {
  const dataSources = manifest['sap.app']?.dataSources || {};
  const mainService = dataSources.mainService || {};
  if (mainService.uri !== 'odata/v4/configuration/') {
    throw new Error(`${file} must use ConfigurationService for draft-backed maintenance`);
  }

  const targets = manifest['sap.ui5']?.routing?.targets || {};
  const listTarget = Object.values(targets).find(target => target.name === 'sap.fe.templates.ListReport');
  const entitySet = listTarget?.options?.settings?.entitySet;
  if (!maintenanceEntitySets.has(entitySet)) {
    throw new Error(`${file} must target one approved maintenance entity set`);
  }

  const draftPattern = new RegExp(`@odata\\.draft\\.enabled\\s+entity\\s+${entitySet}\\b`);
  if (!draftPattern.test(configurationService)) {
    throw new Error(`${file} entity set ${entitySet} must be draft-enabled in ConfigurationService`);
  }
}

function validateControlTowerCards(file, cardMap) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  if (manifest['sap.ovp'].globalFilterModel || manifest['sap.ovp'].globalFilterEntitySet) {
    throw new Error(`${file} must open directly on the judge cockpit cards without a global filter bar`);
  }

  const cardIds = Object.keys(cardMap);
  const expectedCardIds = [
    'businessImpact',
    'riskByZone',
    'demoImpact',
    'rescueScenario',
    'processTasks',
    'integrations'
  ];
  if (cardIds.join(',') !== expectedCardIds.join(',')) {
    throw new Error(`${file} must keep the judge cockpit focused on ${expectedCardIds.join(', ')}`);
  }

  const cards = Object.values(cardMap);
  const analyticalCards = cards.filter(card => card.template === 'sap.ovp.cards.v4.charts.analytical');
  const tableCards = cards.filter(card => card.template === 'sap.ovp.cards.v4.table');
  if (analyticalCards.length < 1 || tableCards.length < 4) {
    throw new Error(`${file} must keep one analytical risk card and table cards for proof-oriented demo evidence`);
  }

  const hiddenFromCockpit = new Set([
    'ActionBriefs',
    'InterventionImpacts',
    'LiveSensorEvents',
    'NotificationEvents',
    'RiskDecisions',
    'ZoneOccupancy'
  ]);
  for (const card of cards) {
    const settings = card.settings || {};
    if (hiddenFromCockpit.has(settings.entitySet)) {
      throw new Error(`${file} must route ${settings.entitySet} through specialist apps, not the Control Tower cockpit`);
    }
    if (!settings.identificationAnnotationPath) {
      throw new Error(`${file} Control Tower card ${settings.title} must provide drill-through navigation`);
    }
    for (const property of [
      'annotationPath',
      'selectionAnnotationPath',
      'chartAnnotationPath',
      'presentationAnnotationPath',
      'dataPointAnnotationPath',
      'identificationAnnotationPath'
    ]) {
      if (settings[property]) {
        validateAnnotationQualifier(file, settings[property]);
      }
    }
  }
}

function validateAnnotationQualifier(file, annotationPath) {
  const match = annotationPath.match(/^com\.sap\.vocabularies\.UI\.v1\.([A-Za-z]+)#([A-Za-z0-9_]+)$/);
  if (!match) return;

  const [, term, qualifier] = match;
  const cdsTerm = `UI.${term} #${qualifier}`;
  if (!fioriAnnotations.includes(cdsTerm)) {
    throw new Error(`${file} references missing annotation ${cdsTerm}`);
  }
}

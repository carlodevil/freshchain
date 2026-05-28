const fs = require('fs');
const path = require('path');

const manifests = [
  'app/freshchain-operations/webapp/manifest.json',
  'app/freshchain-overview/webapp/manifest.json',
  'app/freshchain-intelligence/webapp/manifest.json',
  'app/freshchain-masterdata/webapp/manifest.json',
  'app/freshchain-admin/webapp/manifest.json',
  'app/freshchain-monitoring/webapp/manifest.json',
  'app/router/xs-app.json'
];

for (const file of manifests) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  const dataSources = manifest['sap.app'] && manifest['sap.app'].dataSources;
  if (dataSources) {
    const defaultModel = manifest['sap.ui5'] && manifest['sap.ui5'].models && manifest['sap.ui5'].models[''];
    if (!defaultModel || !dataSources[defaultModel.dataSource]) {
      throw new Error(`${file} must expose its CAP service through the default UI5 OData model`);
    }
  }
}

for (const file of [
  'app/freshchain-operations/webapp/Component.js',
  'app/freshchain-overview/webapp/Component.js',
  'app/freshchain-intelligence/webapp/Component.js',
  'app/freshchain-masterdata/webapp/Component.js',
  'app/freshchain-admin/webapp/Component.js',
  'app/freshchain-monitoring/webapp/Component.js'
]) {
  new Function(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
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

for (const file of walk(path.join(__dirname, '..', 'app'))) {
  if (!file.includes(`${path.sep}webapp${path.sep}`) || !/\.(js|xml|json)$/.test(file)) {
    continue;
  }
  const source = fs.readFileSync(file, 'utf8');
  if (blockedHttpPatterns.some((pattern) => pattern.test(source))) {
    throw new Error(`${path.relative(path.join(__dirname, '..'), file)} must use UI5 models instead of raw HTTP calls`);
  }
}

console.log('UI artifact validation passed');

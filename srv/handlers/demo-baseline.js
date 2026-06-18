const cds = require('@sap/cds');
const fs = require('fs/promises');
const path = require('path');

const { UPSERT } = cds.ql;

const SEED_FILES = [
  'freshchain-Stores.csv',
  'freshchain-Zones.csv',
  'freshchain-Products.csv',
  'freshchain-Sensors.csv',
  'freshchain-ThresholdConfigs.csv',
  'freshchain-ImpactSettings.csv',
  'freshchain-Batches.csv',
  'freshchain-InventoryPlacements.csv',
  'freshchain-StockLots.csv',
  'freshchain-StockMovements.csv',
  'freshchain-SensorReadings.csv',
  'freshchain-ReadingAggregates.csv',
  'freshchain-MLDatasets.csv',
  'freshchain-MLTrainingRuns.csv',
  'freshchain-MLDeployments.csv',
  'freshchain-ModelMetrics.csv',
  'freshchain-Predictions.csv',
  'freshchain-InferenceRequests.csv',
  'freshchain-Alerts.csv',
  'freshchain-AlertActions.csv',
  'freshchain-SalesObservations.csv',
  'freshchain-DemandForecasts.csv',
  'freshchain-ReplenishmentRecommendations.csv',
  'freshchain-RouteRecommendations.csv',
  'freshchain-InterventionImpacts.csv',
  'freshchain-IngestionErrors.csv'
];

function entityName(seedFile) {
  return seedFile.replace(/^freshchain-/, '').replace(/\.csv$/, '');
}

function seedDirectories() {
  return [
    process.env.FRESHCHAIN_DEMO_SEED_DIR,
    path.join(process.cwd(), 'db', 'data'),
    path.join(process.cwd(), 'srv', 'demo-data'),
    path.join(__dirname, '..', 'demo-data'),
    path.join(__dirname, '..', '..', 'db', 'data')
  ].filter(Boolean);
}

async function findSeedDirectory() {
  for (const candidate of seedDirectories()) {
    try {
      await fs.access(path.join(candidate, 'freshchain-Stores.csv'));
      return candidate;
    } catch {
      // Try the next known runtime/build location.
    }
  }
  throw new Error('FreshChain demo seed data directory was not found');
}

function parseCsv(content) {
  const [headerLine, ...lines] = content.trim().split(/\r?\n/);
  const headers = headerLine.split(';');
  return lines.filter(Boolean).map(line => {
    const values = line.split(';');
    return Object.fromEntries(headers.map((header, index) => [header, normalizeValue(values[index])]));
  });
}

function normalizeValue(value) {
  if (value === undefined || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

async function readSeedRows(seedDir, seedFile) {
  const content = await fs.readFile(path.join(seedDir, seedFile), 'utf8');
  return parseCsv(content);
}

async function upsertRows(tx, entityName, rows) {
  const batchSize = 50;
  let count = 0;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    if (!batch.length) continue;
    await tx.run(UPSERT.into(entityName).entries(batch));
    count += batch.length;
  }
  return count;
}

async function applyDemoBaseline(reqOrTx) {
  const tx = reqOrTx && typeof reqOrTx.run === 'function' ? reqOrTx : cds.tx(reqOrTx);
  const definitions = cds.model && cds.model.definitions;
  if (!definitions) throw new Error('FreshChain CDS model is not loaded for demo baseline seeding');
  const seedDir = await findSeedDirectory();
  const summary = {};

  for (const seedFile of SEED_FILES) {
    const name = entityName(seedFile);
    const entity = definitions[`freshchain.${name}`];
    if (!entity) throw new Error(`FreshChain entity ${name} was not found for demo baseline seeding`);
    const rows = await readSeedRows(seedDir, seedFile);
    summary[name] = await upsertRows(tx, `freshchain.${name}`, rows);
  }

  return { seedDir, summary };
}

async function main() {
  cds.model = await cds.load('*');
  await cds.connect.to('db');
  const result = await cds.tx(tx => applyDemoBaseline(tx));
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  applyDemoBaseline,
  parseCsv
};

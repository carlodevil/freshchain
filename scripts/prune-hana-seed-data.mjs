#!/usr/bin/env node

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedDataDir = path.join(rootDir, 'gen', 'db', 'src', 'gen', 'data');

const operationalSeeds = [
  'freshchain-StockLots'
];

for (const seedName of operationalSeeds) {
  for (const extension of ['.csv', '.hdbtabledata']) {
    const filePath = path.join(generatedDataDir, `${seedName}${extension}`);
    await rm(filePath, { force: true });
    console.log(`Pruned HANA seed artifact ${path.relative(rootDir, filePath)}`);
  }
}

#!/usr/bin/env node

import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedDataDir = path.join(rootDir, 'gen', 'db', 'src', 'gen', 'data');

let entries = [];
try {
  entries = await readdir(generatedDataDir);
} catch {
  process.exit(0);
}

for (const entry of entries) {
  if (!entry.startsWith('freshchain-')) continue;
  if (!entry.endsWith('.csv') && !entry.endsWith('.hdbtabledata')) continue;
  const filePath = path.join(generatedDataDir, entry);
  await rm(filePath, { force: true });
  console.log(`Pruned HANA seed artifact ${path.relative(rootDir, filePath)}`);
}

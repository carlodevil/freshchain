const crypto = require('crypto');
const zlib = require('zlib');
const cds = require('@sap/cds');
const { ingestPayload } = require('./ingestion');

const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
const REQUIRED_FILES = ['sensor_readings.csv', 'sales_observations.csv'];
const OPTIONAL_FILES = ['stores.csv', 'zones.csv', 'products.csv', 'batches.csv', 'inventory_placements.csv', 'metadata.csv'];
const SENSOR_COLUMNS = ['messageId', 'storeCode', 'zoneCode', 'sensorId', 'measuredAt', 'temperatureC', 'humidityPct', 'co2Ppm', 'oxygenPct', 'lightLux', 'doorOpen'];
const SALES_COLUMNS = ['storeCode', 'sku', 'businessDate', 'unitsSold', 'unitsWasted', 'averagePrice'];
const COLUMN_REQUIREMENTS = {
  'stores.csv': ['storeCode', 'name'],
  'zones.csv': ['zoneCode', 'storeCode', 'name', 'type', 'safeTempMinC', 'safeTempMaxC'],
  'products.csv': ['sku', 'name', 'category'],
  'batches.csv': ['batchNumber', 'sku'],
  'inventory_placements.csv': ['batchNumber', 'zoneCode', 'placedAt', 'quantity'],
  'metadata.csv': ['key', 'value'],
  'sensor_readings.csv': SENSOR_COLUMNS,
  'sales_observations.csv': SALES_COLUMNS
};

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function now() {
  return new Date().toISOString();
}

function reject(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function bool(value) {
  return ['true', '1', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
}

function number(value, field, errors, rowNumber) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    errors.push(`${field} must be numeric at row ${rowNumber}`);
    return null;
  }
  return parsed;
}

function validDate(value) {
  return value && !Number.isNaN(Date.parse(value));
}

function basename(name) {
  return String(name || '').split('/').pop().split('\\').pop().toLowerCase();
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function createZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  Object.entries(files).forEach(([name, content]) => {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content);
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuffer.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  });
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}

function parseZip(buffer) {
  const files = {};
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) reject('Dataset package must be a valid ZIP archive');

  const entries = buffer.readUInt16LE(eocd + 10);
  let centralOffset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) reject('ZIP central directory is invalid');
    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const entryName = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8');
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
    if (!entryName || entryName.endsWith('/')) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) reject(`ZIP local header is invalid for ${entryName}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) content = zlib.inflateRawSync(compressed);
    else reject(`Unsupported ZIP compression method ${method} for ${entryName}`);
    files[basename(entryName)] = content.toString('utf8').replace(/^\uFEFF/, '');
  }
  return files;
}

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(value => value.trim());
  return {
    headers,
    rows: rows.slice(1).filter(values => values.some(value => String(value).trim() !== '')).map(values => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = values[index] === undefined ? '' : values[index].trim();
      });
      return record;
    })
  };
}

function metadata(rows) {
  return rows.reduce((acc, row) => {
    if (row.key) acc[row.key] = row.value;
    return acc;
  }, {});
}

function missingColumns(headers, fileName) {
  const available = new Set(headers);
  return (COLUMN_REQUIREMENTS[fileName] || []).filter(column => !available.has(column));
}

async function referenceSets(tx, parsed) {
  const { Stores, Zones, Products, Batches } = cds.entities('freshchain');
  const [stores, zones, products, batches] = await Promise.all([
    tx.run(SELECT.from(Stores).columns('ID', 'storeCode')),
    tx.run(SELECT.from(Zones).columns('ID', 'zoneCode', 'store_ID')),
    tx.run(SELECT.from(Products).columns('ID', 'sku')),
    tx.run(SELECT.from(Batches).columns('ID', 'batchNumber'))
  ]);
  const codes = {
    stores: new Set(stores.map(row => row.storeCode)),
    zones: new Set(zones.map(row => row.zoneCode)),
    products: new Set(products.map(row => row.sku)),
    batches: new Set(batches.map(row => row.batchNumber))
  };
  (parsed['stores.csv'] || []).forEach(row => codes.stores.add(row.storeCode));
  (parsed['zones.csv'] || []).forEach(row => codes.zones.add(row.zoneCode));
  (parsed['products.csv'] || []).forEach(row => codes.products.add(row.sku));
  (parsed['batches.csv'] || []).forEach(row => codes.batches.add(row.batchNumber));
  return codes;
}

async function parsePackage(tx, contentBase64) {
  const buffer = Buffer.from(contentBase64 || '', 'base64');
  const files = parseZip(buffer);
  const errors = [];
  const warnings = [];
  const parsed = {};
  const rowCounts = {};

  for (const fileName of REQUIRED_FILES) {
    if (!files[fileName]) errors.push(`Missing required file ${fileName}`);
  }
  Object.keys(files).forEach(fileName => {
    if (!REQUIRED_FILES.includes(fileName) && !OPTIONAL_FILES.includes(fileName)) warnings.push(`Ignoring unsupported file ${fileName}`);
  });
  [...REQUIRED_FILES, ...OPTIONAL_FILES].forEach(fileName => {
    if (!files[fileName]) return;
    const csv = parseCsv(files[fileName]);
    const missing = missingColumns(csv.headers, fileName);
    missing.forEach(column => errors.push(`${fileName} is missing column ${column}`));
    parsed[fileName] = csv.rows;
    rowCounts[fileName] = csv.rows.length;
  });

  const refs = await referenceSets(tx, parsed);
  const seenMessages = new Set();
  (parsed['sensor_readings.csv'] || []).forEach((row, index) => {
    const rowNumber = index + 2;
    if (seenMessages.has(row.messageId)) errors.push(`Duplicate messageId ${row.messageId} in sensor_readings.csv`);
    seenMessages.add(row.messageId);
    if (!refs.stores.has(row.storeCode)) errors.push(`Unknown storeCode ${row.storeCode} at sensor_readings.csv row ${rowNumber}`);
    if (!refs.zones.has(row.zoneCode)) errors.push(`Unknown zoneCode ${row.zoneCode} at sensor_readings.csv row ${rowNumber}`);
    if (!validDate(row.measuredAt)) errors.push(`measuredAt must be an ISO timestamp at sensor_readings.csv row ${rowNumber}`);
    ['temperatureC', 'humidityPct', 'co2Ppm', 'oxygenPct', 'lightLux'].forEach(field => number(row[field], field, errors, rowNumber));
  });
  (parsed['sales_observations.csv'] || []).forEach((row, index) => {
    const rowNumber = index + 2;
    if (!refs.stores.has(row.storeCode)) errors.push(`Unknown storeCode ${row.storeCode} at sales_observations.csv row ${rowNumber}`);
    if (!refs.products.has(row.sku)) errors.push(`Unknown sku ${row.sku} at sales_observations.csv row ${rowNumber}`);
    if (!validDate(row.businessDate)) errors.push(`businessDate must be a date at sales_observations.csv row ${rowNumber}`);
    ['unitsSold', 'unitsWasted', 'averagePrice'].forEach(field => number(row[field], field, errors, rowNumber));
  });
  (parsed['inventory_placements.csv'] || []).forEach((row, index) => {
    const rowNumber = index + 2;
    if (!refs.batches.has(row.batchNumber)) errors.push(`Unknown batchNumber ${row.batchNumber} at inventory_placements.csv row ${rowNumber}`);
    if (!refs.zones.has(row.zoneCode)) errors.push(`Unknown zoneCode ${row.zoneCode} at inventory_placements.csv row ${rowNumber}`);
    if (!validDate(row.placedAt)) errors.push(`placedAt must be an ISO timestamp at inventory_placements.csv row ${rowNumber}`);
    number(row.quantity, 'quantity', errors, rowNumber);
  });

  return {
    files: Object.keys(files).sort(),
    parsed,
    summary: {
      requiredFiles: REQUIRED_FILES,
      optionalFiles: OPTIONAL_FILES,
      files: Object.keys(files).sort(),
      rowCounts,
      errors,
      warnings
    }
  };
}

async function selectMaps(tx) {
  const { Stores, Zones, Products, Batches } = cds.entities('freshchain');
  const [stores, zones, products, batches] = await Promise.all([
    tx.run(SELECT.from(Stores)),
    tx.run(SELECT.from(Zones)),
    tx.run(SELECT.from(Products)),
    tx.run(SELECT.from(Batches))
  ]);
  return {
    stores: new Map(stores.map(row => [row.storeCode, row])),
    zones: new Map(zones.map(row => [row.zoneCode, row])),
    products: new Map(products.map(row => [row.sku, row])),
    batches: new Map(batches.map(row => [row.batchNumber, row]))
  };
}

async function insertOptionalMasterData(tx, parsed) {
  const { Stores, Zones, Products, Batches, InventoryPlacements } = cds.entities('freshchain');
  let maps = await selectMaps(tx);
  for (const row of parsed['stores.csv'] || []) {
    if (maps.stores.has(row.storeCode)) continue;
    await tx.run(INSERT.into(Stores).entries({
      storeCode: row.storeCode,
      name: row.name,
      region: row.region || null,
      timezone: row.timezone || 'UTC',
      operatingHours: row.operatingHours || null,
      active: row.active === '' ? true : bool(row.active)
    }));
  }
  maps = await selectMaps(tx);
  for (const row of parsed['zones.csv'] || []) {
    if (maps.zones.has(row.zoneCode)) continue;
    const store = maps.stores.get(row.storeCode);
    await tx.run(INSERT.into(Zones).entries({
      zoneCode: row.zoneCode,
      name: row.name,
      type: row.type,
      store_ID: store.ID,
      safeTempMinC: row.safeTempMinC,
      safeTempMaxC: row.safeTempMaxC,
      safeHumidityMin: row.safeHumidityMin || 40,
      safeHumidityMax: row.safeHumidityMax || 80,
      active: row.active === '' ? true : bool(row.active)
    }));
  }
  maps = await selectMaps(tx);
  for (const row of parsed['products.csv'] || []) {
    if (maps.products.has(row.sku)) continue;
    await tx.run(INSERT.into(Products).entries({
      sku: row.sku,
      name: row.name,
      category: row.category,
      subcategory: row.subcategory || null,
      packagingType: row.packagingType || null,
      uom: row.uom || 'EA',
      recommendedTempMinC: row.recommendedTempMinC || null,
      recommendedTempMaxC: row.recommendedTempMaxC || null,
      standardShelfLifeDays: row.standardShelfLifeDays || null
    }));
  }
  maps = await selectMaps(tx);
  for (const row of parsed['batches.csv'] || []) {
    if (maps.batches.has(row.batchNumber)) continue;
    const product = maps.products.get(row.sku);
    await tx.run(INSERT.into(Batches).entries({
      product_ID: product.ID,
      batchNumber: row.batchNumber,
      productionDate: row.productionDate || null,
      packingDate: row.packingDate || null,
      bestBeforeDate: row.bestBeforeDate || null,
      receivedAt: row.receivedAt || null
    }));
  }
  maps = await selectMaps(tx);
  for (const row of parsed['inventory_placements.csv'] || []) {
    const batch = maps.batches.get(row.batchNumber);
    const zone = maps.zones.get(row.zoneCode);
    await tx.run(INSERT.into(InventoryPlacements).entries({
      batch_ID: batch.ID,
      zone_ID: zone.ID,
      placedAt: row.placedAt,
      removedAt: row.removedAt || null,
      quantity: row.quantity,
      unit: row.unit || 'EA',
      active: row.active === '' ? true : bool(row.active)
    }));
  }
}

async function importSales(tx, rows) {
  const { SalesObservations } = cds.entities('freshchain');
  const maps = await selectMaps(tx);
  for (const row of rows) {
    const store = maps.stores.get(row.storeCode);
    const product = maps.products.get(row.sku);
    await tx.run(INSERT.into(SalesObservations).entries({
      store_ID: store.ID,
      product_ID: product.ID,
      businessDate: row.businessDate,
      unitsSold: row.unitsSold,
      unitsWasted: row.unitsWasted,
      averagePrice: row.averagePrice,
      promotionActive: bool(row.promotionActive),
      weatherCode: row.weatherCode || null
    }));
  }
}

async function importReadings(tx, rows) {
  let imported = 0;
  for (const row of rows) {
    const measuredAt = row.measuredAt;
    const payload = {
      schemaVersion: row.schemaVersion || '1.0',
      messageId: row.messageId,
      correlationId: row.correlationId || `${row.storeCode}-${row.zoneCode}-${row.messageId}`,
      eventType: 'SensorReadingCreated',
      storeId: row.storeCode,
      zoneId: row.zoneCode,
      sensorId: row.sensorId,
      measuredAt,
      publishedAt: row.publishedAt || measuredAt,
      readings: {
        temperatureC: Number(row.temperatureC),
        humidityPct: Number(row.humidityPct),
        co2Ppm: Number(row.co2Ppm),
        oxygenPct: Number(row.oxygenPct),
        lightLux: Number(row.lightLux),
        doorOpen: bool(row.doorOpen)
      },
      quality: {
        batteryPct: row.batteryPct === '' || row.batteryPct === undefined ? null : Number(row.batteryPct),
        signalStrength: row.signalStrength === '' || row.signalStrength === undefined ? null : Number(row.signalStrength),
        sensorHealth: row.sensorHealth || 'OK'
      },
      scenarioCode: row.scenarioCode || 'NORMAL'
    };
    const result = await ingestPayload(tx, payload, { sourceQueue: 'dataset.upload' });
    if (!result.duplicate) imported += 1;
  }
  return imported;
}

function historyDays(rows) {
  const times = rows.map(row => Date.parse(row.measuredAt)).filter(Number.isFinite);
  if (!times.length) return 0;
  return Math.max(1, Math.ceil((Math.max(...times) - Math.min(...times)) / 86400000) + 1);
}

function datasetCode(meta, upload) {
  const proposed = meta.datasetCode || upload.fileName.replace(/\.[^.]+$/, '');
  return String(proposed || `upload-${Date.now()}`).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 72) + `-${Date.now().toString(36)}`;
}

async function updateAndReturn(tx, uploadId, values) {
  const { DatasetUploads } = cds.entities('freshchain');
  await tx.run(UPDATE(DatasetUploads).set(values).where({ ID: uploadId }));
  return tx.run(SELECT.one.from(DatasetUploads).where({ ID: uploadId }));
}

async function uploadDatasetPackage(tx, data) {
  const { DatasetUploads } = cds.entities('freshchain');
  const rawBase64 = String(data.contentBase64 || '').replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(rawBase64, 'base64');
  if (!data.fileName) reject('fileName is required');
  if (!rawBase64 || !buffer.length) reject('contentBase64 is required');
  if (buffer.length > MAX_PACKAGE_BYTES) reject('Dataset package exceeds the 25 MB limit', 413);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const entry = {
    fileName: data.fileName,
    mimeType: data.mimeType || 'application/zip',
    sizeBytes: buffer.length,
    checksumSha256: checksum,
    status: 'UPLOADED',
    uploadedAt: now(),
    validationSummary: JSON.stringify({ rowCounts: {}, errors: [], warnings: ['Package uploaded. Validate before import.'] }),
    contentBase64: rawBase64
  };
  await tx.run(INSERT.into(DatasetUploads).entries(entry));
  return tx.run(SELECT.one.from(DatasetUploads).where({ checksumSha256: checksum, fileName: data.fileName }).orderBy('createdAt desc'));
}

async function validateDatasetPackage(tx, uploadId) {
  const { DatasetUploads } = cds.entities('freshchain');
  const upload = await tx.run(SELECT.one.from(DatasetUploads).where({ ID: uploadId }));
  if (!upload) reject(`Dataset upload ${uploadId} not found`, 404);
  const parsed = await parsePackage(tx, upload.contentBase64);
  const status = parsed.summary.errors.length ? 'FAILED' : 'VALIDATED';
  return updateAndReturn(tx, uploadId, {
    status,
    validatedAt: now(),
    validationSummary: JSON.stringify(parsed.summary)
  });
}

async function importDatasetPackage(tx, uploadId) {
  const { MLDatasets } = cds.entities('freshchain');
  const { DatasetUploads } = cds.entities('freshchain');
  const upload = await tx.run(SELECT.one.from(DatasetUploads).where({ ID: uploadId }));
  if (!upload) reject(`Dataset upload ${uploadId} not found`, 404);
  if (upload.status !== 'VALIDATED') reject('Validate the dataset package successfully before import', 409);
  const parsedPackage = await parsePackage(tx, upload.contentBase64);
  if (parsedPackage.summary.errors.length) {
    await updateAndReturn(tx, uploadId, { status: 'FAILED', validationSummary: JSON.stringify(parsedPackage.summary) });
    reject('Dataset package has validation errors', 422);
  }
  await insertOptionalMasterData(tx, parsedPackage.parsed);
  const importedReadings = await importReadings(tx, parsedPackage.parsed['sensor_readings.csv'] || []);
  await importSales(tx, parsedPackage.parsed['sales_observations.csv'] || []);
  const meta = metadata(parsedPackage.parsed['metadata.csv'] || []);
  const sensorRows = parsedPackage.parsed['sensor_readings.csv'] || [];
  const stores = new Set(sensorRows.map(row => row.storeCode));
  const zones = new Set(sensorRows.map(row => row.zoneCode));
  const incidents = sensorRows.filter(row => row.scenarioCode && row.scenarioCode !== 'NORMAL').length;
  const dataset = {
    datasetCode: datasetCode(meta, upload),
    description: meta.description || `Uploaded ZIP dataset ${upload.fileName}`,
    source: 'DATASET_UPLOAD',
    storeCount: stores.size,
    zoneCount: zones.size,
    readingCount: importedReadings,
    salesCount: (parsedPackage.parsed['sales_observations.csv'] || []).length,
    incidentCount: incidents,
    historyDays: Number(meta.historyDays) || historyDays(sensorRows),
    anomalyRate: Number(meta.anomalyRate) || (sensorRows.length ? incidents / sensorRows.length : 0),
    generatedAt: now(),
    parameters: JSON.stringify({
      uploadId,
      checksumSha256: upload.checksumSha256,
      packageFiles: parsedPackage.summary.files,
      rowCounts: parsedPackage.summary.rowCounts
    })
  };
  await tx.run(INSERT.into(MLDatasets).entries(dataset));
  const storedDataset = await tx.run(SELECT.one.from(MLDatasets).where({ datasetCode: dataset.datasetCode }));
  const importSummary = {
    datasetCode: dataset.datasetCode,
    importedReadings,
    importedSales: dataset.salesCount,
    importedAt: now(),
    rowCounts: parsedPackage.summary.rowCounts
  };
  return updateAndReturn(tx, uploadId, {
    dataset_ID: storedDataset.ID,
    status: 'IMPORTED',
    importedAt: importSummary.importedAt,
    importSummary: JSON.stringify(importSummary)
  });
}

async function deleteDatasetUpload(tx, uploadId) {
  const { DatasetUploads } = cds.entities('freshchain');
  const upload = await tx.run(SELECT.one.from(DatasetUploads).where({ ID: uploadId }));
  if (!upload) reject(`Dataset upload ${uploadId} not found`, 404);
  if (upload.status === 'IMPORTED') reject('Imported dataset packages cannot be deleted', 409);
  await tx.run(DELETE.from(DatasetUploads).where({ ID: uploadId }));
  return true;
}

function datasetPackageTemplate() {
  const measuredAt = now();
  const businessDate = measuredAt.slice(0, 10);
  return createZip({
    'sensor_readings.csv': [
      'messageId,storeCode,zoneCode,sensorId,measuredAt,publishedAt,temperatureC,humidityPct,co2Ppm,oxygenPct,lightLux,doorOpen,batteryPct,signalStrength,sensorHealth,scenarioCode',
      `TEMPLATE-READING-001,SR001,SR001_DAIRY,DS_TEAM_SENSOR_001,${measuredAt},${measuredAt},4.2,63.5,780,20.7,95,false,98,-48,OK,NORMAL`,
      `TEMPLATE-READING-002,SR001,SR001_DAIRY,DS_TEAM_SENSOR_001,${measuredAt},${measuredAt},8.1,68.0,940,20.5,130,true,96,-50,OK,DOOR_LEFT_OPEN`
    ].join('\n'),
    'sales_observations.csv': [
      'storeCode,sku,businessDate,unitsSold,unitsWasted,averagePrice,promotionActive,weatherCode',
      `SR001,MILK-1L,${businessDate},24,1,29.99,false,CLEAR`,
      `SR001,YOG-500,${businessDate},18,2,32.99,true,CLEAR`
    ].join('\n'),
    'metadata.csv': [
      'key,value',
      'datasetCode,data-science-upload',
      'description,Template CSV ZIP for FreshChain dataset upload',
      'historyDays,1',
      'anomalyRate,0.5'
    ].join('\n')
  }).toString('base64');
}

module.exports = {
  uploadDatasetPackage,
  validateDatasetPackage,
  importDatasetPackage,
  deleteDatasetUpload,
  datasetPackageTemplate,
  parseZip,
  parseCsv,
  createZip
};

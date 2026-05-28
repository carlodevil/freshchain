namespace freshchain;

using { cuid, managed } from '@sap/cds/common';

type Severity     : String enum { LOW; MEDIUM; HIGH; CRITICAL; }
type AlertStatus  : String enum { OPEN; ACKNOWLEDGED; ASSIGNED; RESOLVED; REOPENED; }
type SensorHealth : String enum { OK; WARN; FAILED; STALE; }
type RiskLevel    : String enum { LOW; MEDIUM; HIGH; CRITICAL; }
type RunStatus    : String enum { PLANNED; RUNNING; SUCCEEDED; FAILED; CANCELLED; DEGRADED; }
type RecommendationStatus : String enum { NEW; ACCEPTED; REJECTED; APPLIED; EXPIRED; }
type DatasetUploadStatus : String enum { UPLOADED; VALIDATED; IMPORTED; FAILED; }

entity Stores : cuid, managed {
  storeCode     : String(20) @assert.unique;
  name          : String(120);
  region        : String(60);
  timezone      : String(60);
  operatingHours: String(120);
  active        : Boolean default true;
  zones         : Composition of many Zones on zones.store = $self;
}

entity Zones : cuid, managed {
  zoneCode        : String(40) @assert.unique;
  name            : String(120);
  type            : String(40);
  store           : Association to Stores;
  safeTempMinC    : Decimal(5,2);
  safeTempMaxC    : Decimal(5,2);
  safeHumidityMin : Decimal(5,2);
  safeHumidityMax : Decimal(5,2);
  active          : Boolean default true;
  sensors         : Composition of many Sensors on sensors.zone = $self;
}

entity Sensors : cuid, managed {
  sensorId       : String(80) @assert.unique;
  zone           : Association to Zones;
  sensorType     : String(60);
  firmwareVersion: String(40);
  lastSeenAt     : Timestamp;
  healthStatus   : SensorHealth default 'OK';
}

entity Products : cuid, managed {
  sku                 : String(40) @assert.unique;
  name                : String(160);
  category            : String(60);
  subcategory         : String(60);
  packagingType       : String(60);
  uom                 : String(20);
  recommendedTempMinC : Decimal(5,2);
  recommendedTempMaxC : Decimal(5,2);
  standardShelfLifeDays: Integer;
}

entity Batches : cuid, managed {
  product       : Association to Products;
  batchNumber   : String(80);
  productionDate: Date;
  packingDate   : Date;
  bestBeforeDate: Date;
  receivedAt    : Timestamp;
}

entity InventoryPlacements : cuid, managed {
  batch    : Association to Batches;
  zone     : Association to Zones;
  placedAt : Timestamp;
  removedAt: Timestamp;
  quantity : Decimal(12,3);
  unit     : String(20);
  active   : Boolean default true;
}

entity SensorReadings : cuid, managed {
  store           : Association to Stores;
  zone            : Association to Zones;
  sensor          : Association to Sensors;
  measuredAt      : Timestamp;
  publishedAt     : Timestamp;
  temperatureC    : Decimal(6,2);
  humidityPct     : Decimal(6,2);
  co2Ppm          : Decimal(9,2);
  oxygenPct       : Decimal(6,2);
  lightLux        : Decimal(9,2);
  doorOpen        : Boolean;
  batteryPct      : Decimal(5,2);
  signalStrength  : Decimal(6,2);
  sensorHealth    : SensorHealth;
  scenarioCode    : String(60);
  sourceMessageId : String(80) @assert.unique;
  correlationId   : String(160);
  schemaVersion   : String(20);
  qualityFlags    : String(500);
}

entity ReadingAggregates : cuid, managed {
  store              : Association to Stores;
  zone               : Association to Zones;
  windowStart        : Timestamp;
  windowEnd          : Timestamp;
  windowSizeMinutes  : Integer;
  tempAvg            : Decimal(6,2);
  tempMax            : Decimal(6,2);
  humidityAvg        : Decimal(6,2);
  co2Slope           : Decimal(9,2);
  oxygenDrop         : Decimal(6,2);
  doorOpenSeconds    : Integer;
  excursionMinutes   : Integer;
  readingCount       : Integer;
}

entity Predictions : cuid, managed {
  modelName                  : String(80);
  modelVersion               : String(40);
  deploymentId               : String(120);
  store                      : Association to Stores;
  zone                       : Association to Zones;
  batch                      : Association to Batches;
  predictionType             : String(60);
  riskLevel                  : RiskLevel;
  score                      : Decimal(6,3);
  confidence                 : Decimal(6,3);
  anomalyType                : String(80);
  remainingShelfLifeDays     : Decimal(8,2);
  demandUnitsForecast        : Decimal(12,3);
  replenishmentUnits         : Decimal(12,3);
  routePriority              : Integer;
  recommendedAction          : String(500);
  featureSnapshot            : LargeString;
  outputPayload              : LargeString;
  aiCoreUnavailable          : Boolean default false;
  modelUnavailableReason     : String(240);
}

entity Alerts : cuid, managed {
  store          : Association to Stores;
  zone           : Association to Zones;
  batch          : Association to Batches;
  prediction     : Association to Predictions;
  severity       : Severity;
  status         : AlertStatus default 'OPEN';
  alertType      : String(80);
  title          : String(160);
  evidenceWindow : String(240);
  recommendation : String(500);
  source         : String(40);
  acknowledgedAt : Timestamp;
  assignedTo     : String(120);
  resolvedAt     : Timestamp;
  outcome        : String(500);
  activeKey      : String(200);
  actions        : Composition of many AlertActions on actions.alert = $self;
}

entity AlertActions : cuid, managed {
  alert         : Association to Alerts;
  actionType    : String(60);
  assignedTo    : String(120);
  performedBy   : String(120);
  comment       : String(500);
  previousStatus: AlertStatus;
  newStatus     : AlertStatus;
  outcome       : String(500);
  completedAt   : Timestamp;
}

entity IngestionErrors : cuid, managed {
  sourceQueue   : String(120);
  messageId     : String(80);
  correlationId : String(160);
  errorClass    : String(80);
  errorMessage  : String(1000);
  payloadHash   : String(128);
  payload       : LargeString;
  retryCount    : Integer default 0;
  status        : String(40) default 'OPEN';
}

entity ThresholdConfigs : cuid, managed {
  zoneType              : String(40);
  productCategory       : String(60);
  safeTempMinC          : Decimal(5,2);
  safeTempMaxC          : Decimal(5,2);
  safeHumidityMin       : Decimal(5,2);
  safeHumidityMax       : Decimal(5,2);
  durationMinutes       : Integer default 5;
  doorOpenSecondsLimit  : Integer default 180;
  severity              : Severity default 'HIGH';
  active                : Boolean default true;
}

entity MLDatasets : cuid, managed {
  datasetCode       : String(80) @assert.unique;
  description       : String(240);
  source            : String(80);
  storeCount        : Integer;
  zoneCount         : Integer;
  readingCount      : Integer;
  salesCount        : Integer;
  incidentCount     : Integer;
  historyDays       : Integer;
  anomalyRate       : Decimal(6,3);
  generatedAt       : Timestamp;
  parameters        : LargeString;
}

entity DatasetUploads : cuid, managed {
  dataset           : Association to MLDatasets;
  fileName          : String(240);
  mimeType          : String(120);
  sizeBytes         : Integer;
  checksumSha256    : String(64);
  status            : DatasetUploadStatus default 'UPLOADED';
  uploadedAt        : Timestamp;
  validatedAt       : Timestamp;
  importedAt        : Timestamp;
  validationSummary : LargeString;
  importSummary     : LargeString;
  contentBase64     : LargeString;
}

entity MLTrainingRuns : cuid, managed {
  runId             : String(120) @assert.unique;
  dataset           : Association to MLDatasets;
  modelName         : String(80);
  modelVersion      : String(40);
  status            : RunStatus default 'PLANNED';
  aiCoreExecutionId : String(120);
  startedAt         : Timestamp;
  completedAt       : Timestamp;
  metrics           : LargeString;
  errorMessage      : String(1000);
}

entity MLDeployments : cuid, managed {
  deploymentId      : String(120) @assert.unique;
  trainingRun       : Association to MLTrainingRuns;
  modelName         : String(80);
  modelVersion      : String(40);
  status            : RunStatus default 'PLANNED';
  aiCoreDeploymentId: String(120);
  endpointUrl       : String(500);
  healthStatus      : String(40);
  lastScoredAt      : Timestamp;
}

entity ModelMetrics : cuid, managed {
  trainingRun       : Association to MLTrainingRuns;
  metricName        : String(80);
  metricValue       : Decimal(12,5);
  segment           : String(80);
  measuredAt        : Timestamp;
}

entity InferenceRequests : cuid, managed {
  requestId         : String(120) @assert.unique;
  deployment        : Association to MLDeployments;
  store             : Association to Stores;
  zone              : Association to Zones;
  batch             : Association to Batches;
  status            : RunStatus default 'RUNNING';
  latencyMs         : Integer;
  aiCoreUnavailable : Boolean default false;
  featurePayload    : LargeString;
  responsePayload   : LargeString;
  errorMessage      : String(1000);
}

entity SalesObservations : cuid, managed {
  store             : Association to Stores;
  product           : Association to Products;
  businessDate      : Date;
  unitsSold         : Decimal(12,3);
  unitsWasted       : Decimal(12,3);
  averagePrice      : Decimal(12,2);
  promotionActive   : Boolean default false;
  weatherCode       : String(40);
}

entity DemandForecasts : cuid, managed {
  prediction        : Association to Predictions;
  store             : Association to Stores;
  product           : Association to Products;
  forecastDate      : Date;
  horizonDays       : Integer;
  forecastUnits     : Decimal(12,3);
  lowerBoundUnits   : Decimal(12,3);
  upperBoundUnits   : Decimal(12,3);
  confidence        : Decimal(6,3);
}

entity ReplenishmentRecommendations : cuid, managed {
  prediction        : Association to Predictions;
  store             : Association to Stores;
  product           : Association to Products;
  recommendedUnits  : Decimal(12,3);
  priority          : Integer;
  reasonCode        : String(80);
  expectedWasteAvoidedUnits : Decimal(12,3);
  expectedLostSalesAvoidedUnits : Decimal(12,3);
  status            : RecommendationStatus default 'NEW';
}

entity RouteRecommendations : cuid, managed {
  prediction        : Association to Predictions;
  fromStore         : Association to Stores;
  toStore           : Association to Stores;
  product           : Association to Products;
  recommendedUnits  : Decimal(12,3);
  priority          : Integer;
  reasonCode        : String(80);
  status            : RecommendationStatus default 'NEW';
}

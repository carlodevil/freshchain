namespace freshchain;

using { cuid, managed } from '@sap/cds/common';

type Severity     : String enum { LOW; MEDIUM; HIGH; CRITICAL; }
type AlertStatus  : String enum { OPEN; ACKNOWLEDGED; ASSIGNED; RESOLVED; REOPENED; }
type SensorHealth : String enum { OK; WARN; FAILED; STALE; }
type RiskLevel    : String enum { LOW; MEDIUM; HIGH; CRITICAL; }
type RunStatus    : String enum { PLANNED; RUNNING; SUCCEEDED; FAILED; CANCELLED; DEGRADED; }
type RecommendationStatus : String enum { NEW; ACCEPTED; REJECTED; APPLIED; EXPIRED; }
type DatasetUploadStatus : String enum { UPLOADED; VALIDATED; IMPORTED; FAILED; }
type StockLotStatus : String enum { AVAILABLE; RESERVED; MOVED; MARKDOWN; WASTE; SOLD; EXPIRED; }
type StockMovementType : String enum { RECEIPT; ZONE_TRANSFER; SALE; WASTE_WRITE_OFF; MARKDOWN; ADJUSTMENT; RESCUE_MOVE; }
type InterventionImpactStatus : String enum { POTENTIAL; ACTIONED; VERIFIED; CANCELLED; }

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
  unitCostZar         : Decimal(12,2);
  sellingPriceZar     : Decimal(12,2);
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

entity StockLots : cuid, managed {
  lotNumber       : String(80) @assert.unique;
  product         : Association to Products;
  batch           : Association to Batches;
  store           : Association to Stores;
  zone            : Association to Zones;
  quantityOnHand  : Decimal(12,3);
  unit            : String(20);
  unitCostZar     : Decimal(12,2);
  sellingPriceZar : Decimal(12,2);
  bestBeforeDate  : Date;
  status          : StockLotStatus default 'AVAILABLE';
  sourceSystem    : String(40);
  lastMovementAt  : Timestamp;
  movements       : Composition of many StockMovements on movements.stockLot = $self;
}

entity StockMovements : cuid, managed {
  stockLot          : Association to StockLots;
  product           : Association to Products;
  batch             : Association to Batches;
  store             : Association to Stores;
  fromZone          : Association to Zones;
  toZone            : Association to Zones;
  movementType      : StockMovementType;
  movementSign      : Integer;
  quantity          : Decimal(12,3);
  quantityBalanceAfter : Decimal(12,3);
  unit              : String(20);
  unitCostZar       : Decimal(12,2);
  sellingPriceZar   : Decimal(12,2);
  movementValueZar  : Decimal(15,2);
  valueBasis        : String(40);
  reasonCode        : String(80);
  referenceDocument : String(120);
  performedBy       : String(120);
  businessTimestamp : Timestamp;
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

entity ImpactSettings : cuid, managed {
  settingCode                 : String(40) @assert.unique;
  description                 : String(240);
  currencyCode                : String(3) default 'ZAR';
  criticalRiskSalvageRate     : Decimal(6,3);
  highRiskSalvageRate         : Decimal(6,3);
  mediumRiskSalvageRate       : Decimal(6,3);
  lowRiskSalvageRate          : Decimal(6,3);
  criticalResponseSlaMinutes  : Integer;
  highResponseSlaMinutes      : Integer;
  mediumResponseSlaMinutes    : Integer;
  lowResponseSlaMinutes       : Integer;
  active                      : Boolean default true;
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

entity InterventionImpacts : cuid, managed {
  scenarioID                   : String(80) @assert.unique;
  prediction                   : Association to Predictions;
  store                        : Association to Stores;
  zone                         : Association to Zones;
  product                      : Association to Products;
  status                       : InterventionImpactStatus default 'POTENTIAL';
  actionType                   : String(60);
  lotCount                     : Integer;
  affectedUnits                : Decimal(12,3);
  stockValueAtRiskZar          : Decimal(15,2);
  spoilageProbability          : Decimal(6,3);
  confidence                   : Decimal(6,3);
  expectedLossZar              : Decimal(15,2);
  salvageRate                  : Decimal(6,3);
  potentialProtectedRevenueZar : Decimal(15,2);
  actualProtectedRevenueZar    : Decimal(15,2);
  wasteAvoidedUnits            : Decimal(12,3);
  lostSalesAvoidedUnits        : Decimal(12,3);
  responseSlaMinutes           : Integer;
  completedAt                  : Timestamp;
  affectedLotNumbers           : String(1000);
  movementReferences           : String(1000);
  calculationSummary           : String(1000);
}

entity RescueScenarios : managed {
  key ID                       : String(80);
  status                       : String(40);
  headline                     : String(180);
  store                        : Association to Stores;
  zone                         : Association to Zones;
  product                      : Association to Products;
  prediction                   : Association to Predictions;
  affectedLotIDs               : String(1000);
  affectedLotNumbers           : String(1000);
  storeCode                    : String(20);
  zoneCode                     : String(40);
  productName                  : String(160);
  affectedLotCount             : Integer;
  affectedUnits                : Decimal(12,3);
  riskLevel                    : RiskLevel;
  riskScore                    : Decimal(6,3);
  confidence                   : Decimal(6,3);
  spoilageProbability          : Decimal(6,3);
  shelfLifeHoursRemaining      : Decimal(8,2);
  businessValueAtRiskZar       : Decimal(15,2);
  potentialProtectedRevenueZar : Decimal(15,2);
  protectedRevenueZar          : Decimal(15,2);
  expectedLossZar              : Decimal(15,2);
  salvageRate                  : Decimal(6,3);
  wasteAvoidedUnits            : Decimal(12,3);
  lostSalesAvoidedUnits        : Decimal(12,3);
  responseSlaMinutes           : Integer;
  processStatus                : String(40);
  actionBriefStatus            : String(40);
  nextBestAction               : String(500);
  managerMessage               : String(500);
  aiCoreProof                  : String(500);
  bpaProof                     : String(500);
  calculationSummary           : String(1000);
  criticality                  : Integer;
}

entity ActionBriefs : managed {
  key ID                    : String(80);
  scenario                  : Association to RescueScenarios;
  generationMode            : String(80);
  modelProvider             : String(80);
  modelName                 : String(120);
  generationLatencyMs       : Integer;
  promptVersion             : String(40);
  unavailableReason         : String(240);
  title                     : String(160);
  actionSummary             : String(500);
  managerNotification       : String(500);
  auditSummary              : String(800);
  customerSafeExplanation   : String(500);
  criticality               : Integer;
}

entity ProcessTasks : managed {
  key ID             : String(80);
  scenario           : Association to RescueScenarios;
  processName        : String(120);
  assignee           : String(120);
  status             : String(40);
  priority           : String(20);
  dueInMinutes       : Integer;
  taskTitle          : String(180);
  taskInstruction    : String(500);
  outcome            : String(500);
  completedAt        : Timestamp;
  bpaMode            : String(80);
  bpaInstanceId      : String(120);
  bpaProcessId       : String(120);
  bpaTriggerStatus   : String(80);
  bpaStartedAt       : Timestamp;
  bpaTaskUrl         : String(500);
  unavailableReason  : String(240);
  criticality        : Integer;
}

entity NotificationEvents : managed {
  key ID       : String(80);
  scenario     : Association to RescueScenarios;
  channel      : String(40);
  recipient    : String(120);
  subject      : String(160);
  message      : String(500);
  status       : String(40);
  criticality  : Integer;
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

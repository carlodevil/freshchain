using freshchain as db from '../db/schema';

service IntelligenceService @(path: '/odata/v4/intelligence') {
  @readonly
  @cds.persistence.skip
  entity OverviewMetrics {
    key ID              : String(20);
    generatedAt        : Timestamp;
    status             : String(20);
    stores             : Integer;
    zones              : Integer;
    activeAlerts       : Integer;
    criticalAlerts     : Integer;
    highAlerts         : Integer;
    highestRisk        : String(20);
    latestReadingAt    : Timestamp;
    aiFailureRate      : Decimal(6,3);
    inferenceCount     : Integer;
    activeDeploymentId : String(120);
    modelVersion       : String(40);
    deploymentHealth   : String(40);
  }

  @readonly
  @cds.persistence.skip
  entity RiskTrend {
    key ID          : UUID;
    zoneId          : UUID;
    createdAt       : Timestamp;
    riskLevel       : String(20);
    score           : Decimal(6,3);
    anomalyType     : String(80);
    recommendedAction : String(500);
  }

  @readonly
  @cds.persistence.skip
  entity ForecastDashboard {
    key ID          : UUID;
    createdAt       : Timestamp;
    storeName       : String(120);
    productName     : String(160);
    forecastDate    : Date;
    horizonDays     : Integer;
    forecastUnits   : Decimal(12,3);
    lowerBoundUnits : Decimal(12,3);
    upperBoundUnits : Decimal(12,3);
    confidence      : Decimal(6,3);
  }

  @readonly
  @cds.persistence.skip
  entity ReplenishmentDashboard {
    key ID            : UUID;
    createdAt         : Timestamp;
    storeName         : String(120);
    productName       : String(160);
    recommendedUnits  : Decimal(12,3);
    priority          : Integer;
    reasonCode        : String(80);
    expectedWasteAvoidedUnits : Decimal(12,3);
    expectedLostSalesAvoidedUnits : Decimal(12,3);
    status            : String(20);
  }

  @readonly
  @cds.persistence.skip
  entity RouteDashboard {
    key ID            : UUID;
    createdAt         : Timestamp;
    fromStoreName     : String(120);
    toStoreName       : String(120);
    productName       : String(160);
    recommendedUnits  : Decimal(12,3);
    priority          : Integer;
    reasonCode        : String(80);
    status            : String(20);
  }

  @readonly
  @cds.persistence.skip
  entity InferenceTelemetry {
    key ID            : UUID;
    createdAt         : Timestamp;
    requestId         : String(120);
    status            : String(20);
    latencyMs         : Integer;
    aiCoreUnavailable : Boolean;
    errorMessage      : String(1000);
    deploymentId      : String(120);
  }

  @readonly
  @cds.persistence.skip
  entity ModelQualityDashboard {
    key ID            : String(80);
    metricName        : String(80);
    metricValue       : Decimal(12,5);
    targetValue       : Decimal(12,5);
    status            : String(20);
    measuredAt        : Timestamp;
    segment           : String(80);
    trainingRunId     : String(120);
  }

  @readonly
  @cds.persistence.skip
  entity ScenarioMix {
    key ID            : String(80);
    scenarioCode      : String(60);
    readingCount      : Integer;
    incidentCount     : Integer;
    incidentShare     : Decimal(6,3);
    severityHint      : String(20);
  }

  @readonly
  @cds.persistence.skip
  entity DataFreshness {
    key ID            : String(40);
    latestReadingAt   : Timestamp;
    latestInferenceAt : Timestamp;
    sensorCount       : Integer;
    staleSensors      : Integer;
    minutesSinceReading : Integer;
    minutesSinceInference : Integer;
    health            : String(20);
    message           : String(240);
  }

  entity DashboardCards as select from db.Stores {
    key ID,
    storeCode,
    name,
    region,
    active
  };
  entity Zones as select from db.Zones {
    key ID,
    zoneCode,
    name,
    type,
    store.ID as store_ID,
    active
  };

  entity Predictions as projection on db.Predictions;
  entity MLDatasets as projection on db.MLDatasets;
  entity DatasetUploads as select from db.DatasetUploads {
    key ID,
    createdAt,
    createdBy,
    modifiedAt,
    modifiedBy,
    dataset.ID as dataset_ID,
    fileName,
    mimeType,
    sizeBytes,
    checksumSha256,
    status,
    uploadedAt,
    validatedAt,
    importedAt,
    validationSummary,
    importSummary
  };
  entity MLTrainingRuns as projection on db.MLTrainingRuns;
  entity MLDeployments as projection on db.MLDeployments;
  entity ModelMetrics as projection on db.ModelMetrics;
  entity InferenceRequests as projection on db.InferenceRequests;
  entity SalesObservations as projection on db.SalesObservations;
  entity DemandForecasts as projection on db.DemandForecasts;
  entity ReplenishmentRecommendations as projection on db.ReplenishmentRecommendations;
  entity RouteRecommendations as projection on db.RouteRecommendations;

  action getOverview() returns String;
  action scoreLatest(zoneId: UUID, batchId: UUID) returns Predictions;
  action seedDemoData(days: Integer, stores: Integer, anomalyRate: Decimal(6,3)) returns String;
  action uploadDatasetPackage(fileName: String, mimeType: String, contentBase64: LargeString) returns DatasetUploads;
  action downloadDatasetPackageTemplate() returns LargeString;
  action validateDatasetPackage(uploadId: UUID) returns DatasetUploads;
  action importDatasetPackage(uploadId: UUID) returns DatasetUploads;
  action deleteDatasetUpload(uploadId: UUID) returns Boolean;
  action startTraining(datasetCode: String) returns MLTrainingRuns;
  action activateDeployment(trainingRunId: UUID) returns MLDeployments;
  action refreshTrainingRun(trainingRunId: UUID) returns MLTrainingRuns;
  action refreshDeployment(deploymentId: UUID) returns MLDeployments;
  action applyReplenishmentRecommendation(recommendationId: UUID) returns ReplenishmentRecommendations;
  action rejectReplenishmentRecommendation(recommendationId: UUID) returns ReplenishmentRecommendations;
  action applyRouteRecommendation(recommendationId: UUID) returns RouteRecommendations;
  action rejectRouteRecommendation(recommendationId: UUID) returns RouteRecommendations;
}

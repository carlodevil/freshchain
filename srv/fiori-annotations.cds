using CatalogService as catalog from './catalog-service';
using AnalyticsService as analytics from './analytics-service';
using AdminService as admin from './admin-service';
using IntelligenceService as intel from './intelligence-service';

annotate catalog.Stores with @(
  UI.HeaderInfo: {
    TypeName: 'Store',
    TypeNamePlural: 'Stores',
    Title: { Value: name },
    Description: { Value: storeCode }
  },
  UI.SelectionFields: [region, active],
  UI.LineItem: [
    { Value: storeCode, Label: 'Store' },
    { Value: name, Label: 'Name' },
    { Value: region, Label: 'Region' },
    { Value: timezone, Label: 'Timezone' },
    { Value: active, Label: 'Active' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Store Details', Target: '@UI.FieldGroup#StoreDetails' }
  ],
  UI.FieldGroup #StoreDetails: {
    Data: [
      { Value: storeCode, Label: 'Store Code' },
      { Value: name, Label: 'Name' },
      { Value: region, Label: 'Region' },
      { Value: timezone, Label: 'Timezone' },
      { Value: operatingHours, Label: 'Operating Hours' },
      { Value: active, Label: 'Active' }
    ]
  }
);

annotate catalog.Stores with {
  storeCode      @Common.Label: 'Store Code';
  name           @Common.Label: 'Store Name';
  region         @Common.Label: 'Region';
  timezone       @Common.Label: 'Timezone';
  operatingHours @Common.Label: 'Operating Hours';
  active         @Common.Label: 'Active';
};

annotate catalog.Stores with @Capabilities.DeleteRestrictions.Deletable: false;

annotate catalog.Zones with @(
  UI.HeaderInfo: {
    TypeName: 'Zone',
    TypeNamePlural: 'Zones',
    Title: { Value: zoneCode },
    Description: { Value: type }
  },
  UI.SelectionFields: [type, active],
  UI.LineItem: [
    { Value: zoneCode, Label: 'Zone' },
    { Value: name, Label: 'Name' },
    { Value: type, Label: 'Type' },
    { Value: safeTempMinC, Label: 'Min Temp C' },
    { Value: safeTempMaxC, Label: 'Max Temp C' },
    { Value: active, Label: 'Active' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Thresholds', Target: '@UI.FieldGroup#Thresholds' }
  ],
  UI.FieldGroup #Thresholds: {
    Data: [
      { Value: zoneCode, Label: 'Zone Code' },
      { Value: type, Label: 'Type' },
      { Value: safeTempMinC, Label: 'Safe Temp Min C' },
      { Value: safeTempMaxC, Label: 'Safe Temp Max C' },
      { Value: safeHumidityMin, Label: 'Safe Humidity Min' },
      { Value: safeHumidityMax, Label: 'Safe Humidity Max' }
    ]
  }
);

annotate catalog.Zones with {
  zoneCode        @Common.Label: 'Zone Code';
  name            @Common.Label: 'Zone Name';
  type            @Common.Label: 'Zone Type';
  safeTempMinC    @Common.Label: 'Min Temp C';
  safeTempMaxC    @Common.Label: 'Max Temp C';
  safeHumidityMin @Common.Label: 'Min Humidity %';
  safeHumidityMax @Common.Label: 'Max Humidity %';
  active          @Common.Label: 'Active';
};

annotate catalog.Zones with @Capabilities.DeleteRestrictions.Deletable: false;

annotate catalog.Products with @(
  UI.HeaderInfo: {
    TypeName: 'Product',
    TypeNamePlural: 'Products',
    Title: { Value: name },
    Description: { Value: sku }
  },
  UI.SelectionFields: [category, subcategory],
  UI.LineItem: [
    { Value: sku, Label: 'SKU' },
    { Value: name, Label: 'Name' },
    { Value: category, Label: 'Category' },
    { Value: subcategory, Label: 'Subcategory' },
    { Value: recommendedTempMinC, Label: 'Min Temp C' },
    { Value: recommendedTempMaxC, Label: 'Max Temp C' },
    { Value: standardShelfLifeDays, Label: 'Shelf Life Days' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Product Details', Target: '@UI.FieldGroup#ProductDetails' }
  ],
  UI.FieldGroup #ProductDetails: {
    Data: [
      { Value: sku, Label: 'SKU' },
      { Value: name, Label: 'Name' },
      { Value: category, Label: 'Category' },
      { Value: subcategory, Label: 'Subcategory' },
      { Value: packagingType, Label: 'Packaging' },
      { Value: uom, Label: 'Unit' },
      { Value: recommendedTempMinC, Label: 'Recommended Temp Min C' },
      { Value: recommendedTempMaxC, Label: 'Recommended Temp Max C' },
      { Value: standardShelfLifeDays, Label: 'Standard Shelf Life Days' }
    ]
  }
);

annotate catalog.Products with {
  sku                  @Common.Label: 'SKU';
  name                 @Common.Label: 'Product Name';
  category             @Common.Label: 'Category';
  subcategory          @Common.Label: 'Subcategory';
  packagingType        @Common.Label: 'Packaging';
  uom                  @Common.Label: 'Unit';
  recommendedTempMinC  @Common.Label: 'Recommended Min Temp C';
  recommendedTempMaxC  @Common.Label: 'Recommended Max Temp C';
  standardShelfLifeDays @Common.Label: 'Shelf Life Days';
};

annotate catalog.Products with @Capabilities.DeleteRestrictions.Deletable: false;

annotate catalog.Batches with @(
  UI.HeaderInfo: {
    TypeName: 'Batch',
    TypeNamePlural: 'Batches',
    Title: { Value: batchNumber },
    Description: { Value: bestBeforeDate }
  },
  UI.SelectionFields: [bestBeforeDate],
  UI.LineItem: [
    { Value: batchNumber, Label: 'Batch' },
    { Value: productionDate, Label: 'Production Date' },
    { Value: packingDate, Label: 'Packing Date' },
    { Value: bestBeforeDate, Label: 'Best Before' },
    { Value: receivedAt, Label: 'Received At' }
  ]
);

annotate catalog.Alerts with @(
  UI.HeaderInfo: {
    TypeName: 'Alert',
    TypeNamePlural: 'Alerts',
    Title: { Value: title },
    Description: { Value: alertType }
  },
  UI.SelectionFields: [severity, status, alertType],
  UI.LineItem: [
    { Value: severity, Label: 'Severity' },
    { Value: status, Label: 'Status' },
    { Value: title, Label: 'Alert' },
    { Value: alertType, Label: 'Type' },
    { Value: recommendation, Label: 'Recommendation' },
    { Value: assignedTo, Label: 'Assigned To' },
    { $Type: 'UI.DataFieldForAction', Action: 'CatalogService.acknowledge', Label: 'Acknowledge' },
    { $Type: 'UI.DataFieldForAction', Action: 'CatalogService.resolve', Label: 'Resolve' },
    { $Type: 'UI.DataFieldForAction', Action: 'CatalogService.reopen', Label: 'Reopen' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Alert Details', Target: '@UI.FieldGroup#AlertDetails' },
    { $Type: 'UI.ReferenceFacet', Label: 'Evidence', Target: '@UI.FieldGroup#Evidence' },
    { $Type: 'UI.ReferenceFacet', Label: 'Actions', Target: 'actions/@UI.LineItem' }
  ],
  UI.FieldGroup #AlertDetails: {
    Data: [
      { Value: severity, Label: 'Severity' },
      { Value: status, Label: 'Status' },
      { Value: alertType, Label: 'Type' },
      { Value: title, Label: 'Title' },
      { Value: recommendation, Label: 'Recommendation' },
      { Value: assignedTo, Label: 'Assigned To' },
      { Value: source, Label: 'Source' },
      { Value: createdAt, Label: 'Created At' },
      { Value: acknowledgedAt, Label: 'Acknowledged At' },
      { Value: resolvedAt, Label: 'Resolved At' },
      { Value: outcome, Label: 'Outcome' }
    ]
  },
  UI.FieldGroup #Evidence: {
    Data: [
      { Value: evidenceWindow, Label: 'Evidence Window' },
      { Value: activeKey, Label: 'Active Key' }
    ]
  }
);

annotate catalog.Alerts with {
  severity       @Common.Label: 'Severity';
  status         @Common.Label: 'Status';
  alertType      @Common.Label: 'Alert Type';
  title          @Common.Label: 'Alert';
  recommendation @Common.Label: 'Recommendation';
  assignedTo     @Common.Label: 'Assigned To';
  source         @Common.Label: 'Source';
  createdAt      @Common.Label: 'Created At';
};

annotate catalog.Alerts with @Capabilities.DeleteRestrictions.Deletable: false;

annotate catalog.AlertActions with @(
  UI.LineItem: [
    { Value: actionType, Label: 'Action' },
    { Value: performedBy, Label: 'Performed By' },
    { Value: assignedTo, Label: 'Assigned To' },
    { Value: comment, Label: 'Comment' },
    { Value: previousStatus, Label: 'Previous Status' },
    { Value: newStatus, Label: 'New Status' },
    { Value: outcome, Label: 'Outcome' },
    { Value: completedAt, Label: 'Completed At' }
  ]
);

annotate catalog.SensorReadings with @(
  UI.HeaderInfo: {
    TypeName: 'Sensor Reading',
    TypeNamePlural: 'Sensor Readings',
    Title: { Value: sourceMessageId },
    Description: { Value: measuredAt }
  },
  UI.SelectionFields: [scenarioCode, measuredAt],
  UI.LineItem: [
    { Value: measuredAt, Label: 'Measured At' },
    { Value: temperatureC, Label: 'Temp C' },
    { Value: humidityPct, Label: 'Humidity %' },
    { Value: co2Ppm, Label: 'CO2 ppm' },
    { Value: oxygenPct, Label: 'O2 %' },
    { Value: doorOpen, Label: 'Door Open' },
    { Value: scenarioCode, Label: 'Scenario' },
    { Value: sourceMessageId, Label: 'Message ID' }
  ]
);

annotate catalog.Predictions with @(
  UI.HeaderInfo: {
    TypeName: 'Prediction',
    TypeNamePlural: 'Predictions',
    Title: { Value: modelName },
    Description: { Value: modelVersion }
  },
  UI.SelectionFields: [riskLevel, predictionType],
  UI.LineItem: [
    { Value: createdAt, Label: 'Created At' },
    { Value: predictionType, Label: 'Type' },
    { Value: riskLevel, Label: 'Risk' },
    { Value: score, Label: 'Score' },
    { Value: confidence, Label: 'Confidence' },
    { Value: anomalyType, Label: 'Anomaly Type' },
    { Value: remainingShelfLifeDays, Label: 'Shelf Life Days' },
    { Value: modelUnavailableReason, Label: 'AI Core Message' }
  ]
);

annotate intel.Predictions with @(
  UI.HeaderInfo: {
    TypeName: 'ML Prediction',
    TypeNamePlural: 'ML Predictions',
    Title: { Value: predictionType },
    Description: { Value: riskLevel }
  },
  UI.SelectionFields: [riskLevel, predictionType],
  UI.LineItem: [
    { Value: createdAt, Label: 'Created At' },
    { Value: predictionType, Label: 'Type' },
    { Value: riskLevel, Label: 'Risk' },
    { Value: score, Label: 'Score' },
    { Value: confidence, Label: 'Confidence' },
    { Value: remainingShelfLifeDays, Label: 'Shelf Life Days' },
    { Value: demandUnitsForecast, Label: 'Demand Forecast' },
    { Value: replenishmentUnits, Label: 'Replenishment Units' },
    { Value: routePriority, Label: 'Route Priority' }
  ]
);

annotate intel.MLDatasets with @(
  UI.HeaderInfo: {
    TypeName: 'ML Dataset',
    TypeNamePlural: 'ML Datasets',
    Title: { Value: datasetCode },
    Description: { Value: source }
  },
  UI.SelectionFields: [source, generatedAt],
  UI.LineItem: [
    { Value: generatedAt, Label: 'Generated At' },
    { Value: datasetCode, Label: 'Dataset' },
    { Value: source, Label: 'Source' },
    { Value: storeCount, Label: 'Stores' },
    { Value: zoneCount, Label: 'Zones' },
    { Value: readingCount, Label: 'Readings' },
    { Value: salesCount, Label: 'Sales Rows' },
    { Value: incidentCount, Label: 'Incidents' },
    { Value: anomalyRate, Label: 'Anomaly Rate' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Dataset Details', Target: '@UI.FieldGroup#DatasetDetails' }
  ],
  UI.FieldGroup #DatasetDetails: {
    Data: [
      { Value: datasetCode, Label: 'Dataset' },
      { Value: description, Label: 'Description' },
      { Value: source, Label: 'Source' },
      { Value: historyDays, Label: 'History Days' },
      { Value: parameters, Label: 'Parameters' }
    ]
  }
);

annotate intel.MLDatasets with {
  generatedAt   @Common.Label: 'Generated At';
  datasetCode   @Common.Label: 'Dataset';
  description   @Common.Label: 'Description';
  source        @Common.Label: 'Source';
  storeCount    @Common.Label: 'Stores';
  zoneCount     @Common.Label: 'Zones';
  readingCount  @Common.Label: 'Readings';
  salesCount    @Common.Label: 'Sales Rows';
  incidentCount @Common.Label: 'Incidents';
  historyDays   @Common.Label: 'History Days';
  anomalyRate   @Common.Label: 'Anomaly Rate';
};

annotate intel.MLDatasets with @Capabilities.DeleteRestrictions.Deletable: false;

annotate intel.MLTrainingRuns with @(
  UI.HeaderInfo: {
    TypeName: 'Training Run',
    TypeNamePlural: 'Training Runs',
    Title: { Value: runId },
    Description: { Value: status }
  },
  UI.SelectionFields: [status, modelName],
  UI.LineItem: [
    { Value: startedAt, Label: 'Started' },
    { Value: completedAt, Label: 'Completed' },
    { Value: runId, Label: 'Run' },
    { Value: modelName, Label: 'Model' },
    { Value: modelVersion, Label: 'Version' },
    { Value: status, Label: 'Status' },
    { Value: aiCoreExecutionId, Label: 'AI Core Execution' },
    { Value: errorMessage, Label: 'Message' }
  ]
);

annotate intel.MLTrainingRuns with {
  startedAt         @Common.Label: 'Started';
  completedAt       @Common.Label: 'Completed';
  runId             @Common.Label: 'Training Run';
  modelName         @Common.Label: 'Model';
  modelVersion      @Common.Label: 'Version';
  status            @Common.Label: 'Status';
  aiCoreExecutionId @Common.Label: 'AI Core Execution';
  errorMessage      @Common.Label: 'Message';
};

annotate intel.MLTrainingRuns with @Capabilities.DeleteRestrictions.Deletable: false;

annotate intel.MLDeployments with @(
  UI.HeaderInfo: {
    TypeName: 'Deployment',
    TypeNamePlural: 'Deployments',
    Title: { Value: deploymentId },
    Description: { Value: healthStatus }
  },
  UI.SelectionFields: [status, healthStatus],
  UI.LineItem: [
    { Value: deploymentId, Label: 'Deployment' },
    { Value: modelName, Label: 'Model' },
    { Value: modelVersion, Label: 'Version' },
    { Value: status, Label: 'Status' },
    { Value: healthStatus, Label: 'Health' },
    { Value: endpointUrl, Label: 'Endpoint' },
    { Value: lastScoredAt, Label: 'Last Scored' }
  ]
);

annotate intel.MLDeployments with {
  deploymentId       @Common.Label: 'Deployment';
  modelName          @Common.Label: 'Model';
  modelVersion       @Common.Label: 'Version';
  status             @Common.Label: 'Status';
  healthStatus       @Common.Label: 'Health';
  endpointUrl        @Common.Label: 'Endpoint';
  lastScoredAt       @Common.Label: 'Last Scored';
};

annotate intel.MLDeployments with @Capabilities.DeleteRestrictions.Deletable: false;

annotate intel.InferenceRequests with @(
  UI.HeaderInfo: {
    TypeName: 'Inference Request',
    TypeNamePlural: 'Inference Requests',
    Title: { Value: requestId },
    Description: { Value: status }
  },
  UI.SelectionFields: [status],
  UI.LineItem: [
    { Value: createdAt, Label: 'Created' },
    { Value: requestId, Label: 'Request' },
    { Value: status, Label: 'Status' },
    { Value: latencyMs, Label: 'Latency ms' },
    { Value: errorMessage, Label: 'Message' }
  ]
);

annotate intel.InferenceRequests with {
  createdAt    @Common.Label: 'Created';
  requestId    @Common.Label: 'Request';
  status       @Common.Label: 'Status';
  latencyMs    @Common.Label: 'Latency ms';
  errorMessage @Common.Label: 'Message';
};

annotate intel.InferenceRequests with @Capabilities.DeleteRestrictions.Deletable: false;

annotate admin.ThresholdConfigs with @(
  UI.HeaderInfo: {
    TypeName: 'Threshold',
    TypeNamePlural: 'Thresholds',
    Title: { Value: zoneType },
    Description: { Value: severity }
  },
  UI.SelectionFields: [zoneType, productCategory, active],
  UI.LineItem: [
    { Value: zoneType, Label: 'Zone Type' },
    { Value: productCategory, Label: 'Product Category' },
    { Value: safeTempMinC, Label: 'Min Temp C' },
    { Value: safeTempMaxC, Label: 'Max Temp C' },
    { Value: durationMinutes, Label: 'Duration Minutes' },
    { Value: doorOpenSecondsLimit, Label: 'Door Open Seconds' },
    { Value: severity, Label: 'Severity' },
    { Value: active, Label: 'Active' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Threshold Details', Target: '@UI.FieldGroup#ThresholdDetails' }
  ],
  UI.FieldGroup #ThresholdDetails: {
    Data: [
      { Value: zoneType, Label: 'Zone Type' },
      { Value: productCategory, Label: 'Product Category' },
      { Value: safeTempMinC, Label: 'Safe Temp Min C' },
      { Value: safeTempMaxC, Label: 'Safe Temp Max C' },
      { Value: safeHumidityMin, Label: 'Safe Humidity Min' },
      { Value: safeHumidityMax, Label: 'Safe Humidity Max' },
      { Value: durationMinutes, Label: 'Duration Minutes' },
      { Value: doorOpenSecondsLimit, Label: 'Door Open Seconds' },
      { Value: severity, Label: 'Severity' },
      { Value: active, Label: 'Active' }
    ]
  }
);

annotate admin.ThresholdConfigs with {
  zoneType             @Common.Label: 'Zone Type';
  productCategory      @Common.Label: 'Product Category';
  safeTempMinC         @Common.Label: 'Min Temp C';
  safeTempMaxC         @Common.Label: 'Max Temp C';
  safeHumidityMin      @Common.Label: 'Min Humidity %';
  safeHumidityMax      @Common.Label: 'Max Humidity %';
  durationMinutes      @Common.Label: 'Duration Minutes';
  doorOpenSecondsLimit @Common.Label: 'Door Open Seconds';
  severity             @Common.Label: 'Severity';
  active               @Common.Label: 'Active';
};

annotate admin.ThresholdConfigs with @Capabilities.DeleteRestrictions.Deletable: false;

annotate admin.IngestionErrors with @(
  UI.HeaderInfo: {
    TypeName: 'Ingestion Error',
    TypeNamePlural: 'Ingestion Errors',
    Title: { Value: errorClass },
    Description: { Value: messageId }
  },
  UI.SelectionFields: [status, errorClass, sourceQueue],
  UI.LineItem: [
    { Value: createdAt, Label: 'Created At' },
    { Value: status, Label: 'Status' },
    { Value: sourceQueue, Label: 'Source Queue' },
    { Value: messageId, Label: 'Message ID' },
    { Value: correlationId, Label: 'Correlation ID' },
    { Value: errorClass, Label: 'Error Class' },
    { Value: errorMessage, Label: 'Message' },
    { Value: retryCount, Label: 'Retries' }
  ]
);

annotate analytics.ZoneStatus with @(
  UI.HeaderInfo: {
    TypeName: 'Zone Status',
    TypeNamePlural: 'Zone Status',
    Title: { Value: zoneCode },
    Description: { Value: type }
  },
  UI.SelectionFields: [type, active],
  UI.LineItem: [
    { Value: storeCode, Label: 'Store' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: name, Label: 'Name' },
    { Value: type, Label: 'Type' },
    { Value: safeTempMinC, Label: 'Min Temp C' },
    { Value: safeTempMaxC, Label: 'Max Temp C' },
    { Value: active, Label: 'Active' }
  ]
);

annotate analytics.ZoneStatus with {
  storeCode    @Common.Label: 'Store';
  zoneCode     @Common.Label: 'Zone';
  name         @Common.Label: 'Zone Name';
  type         @Common.Label: 'Zone Type';
  safeTempMinC @Common.Label: 'Min Temp C';
  safeTempMaxC @Common.Label: 'Max Temp C';
  active       @Common.Label: 'Active';
};

annotate analytics.ZoneStatus with @Capabilities.DeleteRestrictions.Deletable: false;

annotate analytics.ActiveAlerts with @(
  UI.HeaderInfo: {
    TypeName: 'Active Alert',
    TypeNamePlural: 'Active Alerts',
    Title: { Value: title },
    Description: { Value: severity }
  },
  UI.SelectionFields: [severity, status, alertType],
  UI.LineItem: [
    { Value: createdAt, Label: 'Created At' },
    { Value: severity, Label: 'Severity' },
    { Value: status, Label: 'Status' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: alertType, Label: 'Type' },
    { Value: title, Label: 'Title' },
    { Value: recommendation, Label: 'Recommendation' },
    { Value: assignedTo, Label: 'Assigned To' }
  ]
);

annotate analytics.ReadingAggregates with @(
  UI.HeaderInfo: {
    TypeName: 'Reading Aggregate',
    TypeNamePlural: 'Reading Aggregates',
    Title: { Value: zoneCode },
    Description: { Value: windowEnd }
  },
  UI.SelectionFields: [zoneCode, windowStart, windowEnd],
  UI.LineItem: [
    { Value: windowEnd, Label: 'Window End' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: tempAvg, Label: 'Avg Temp C' },
    { Value: tempMax, Label: 'Max Temp C' },
    { Value: humidityAvg, Label: 'Avg Humidity' },
    { Value: doorOpenSeconds, Label: 'Door Open Seconds' },
    { Value: excursionMinutes, Label: 'Excursion Minutes' },
    { Value: readingCount, Label: 'Readings' }
  ]
);

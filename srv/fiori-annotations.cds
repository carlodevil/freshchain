using CatalogService as catalog from './catalog-service';
using AnalyticsService as analytics from './analytics-service';
using AdminService as admin from './admin-service';
using ConfigurationService as config from './configuration-service';
using IntelligenceService as intel from './intelligence-service';
using LiveDemoService as live from './live-demo-service';

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

annotate intel.SpoilagePreventionDemo with @(
  UI.HeaderInfo: {
    TypeName: 'Spoilage Prevention Demo',
    TypeNamePlural: 'Spoilage Prevention Demo',
    Title: { Value: headline },
    Description: { Value: platformProof }
  },
  UI.LineItem: [
    { $Type: 'UI.DataFieldForAction', Action: 'IntelligenceService.runDemo', Label: 'Run Spoilage Prevention Demo' },
    { Value: headline, Label: 'Outcome' },
    { Value: riskLevel, Label: 'Risk' },
    { Value: score, Label: 'Risk Score' },
    { Value: remainingShelfLifeDays, Label: 'Shelf Life Days' },
    { Value: expectedWasteAvoidedUnits, Label: 'Waste Avoided' },
    { Value: recommendedAction, Label: 'Recommended Action' }
  ],
  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'IntelligenceService.runDemo', Label: 'Run Spoilage Prevention Demo' },
    { Value: headline, Label: 'Outcome' },
    { Value: recommendedAction, Label: 'Recommended Action' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Spoilage Risk', Target: '@UI.FieldGroup#Risk' },
    { $Type: 'UI.ReferenceFacet', Label: 'Business Impact', Target: '@UI.FieldGroup#Impact' },
    { $Type: 'UI.ReferenceFacet', Label: 'SAP BTP Proof', Target: '@UI.FieldGroup#Platform' }
  ],
  UI.FieldGroup #Risk: {
    Data: [
      { Value: storeName, Label: 'Store' },
      { Value: zoneName, Label: 'Zone' },
      { Value: productName, Label: 'Product' },
      { Value: riskLevel, Label: 'Risk' },
      { Value: score, Label: 'Risk Score' },
      { Value: confidence, Label: 'Confidence' },
      { Value: remainingShelfLifeDays, Label: 'Remaining Shelf Life' }
    ]
  },
  UI.FieldGroup #Impact: {
    Data: [
      { Value: demandUnitsForecast, Label: 'Demand Forecast' },
      { Value: replenishmentUnits, Label: 'Replenishment Units' },
      { Value: expectedWasteAvoidedUnits, Label: 'Waste Avoided' },
      { Value: expectedLostSalesAvoidedUnits, Label: 'Lost Sales Avoided' },
      { Value: recommendedAction, Label: 'Recommended Action' }
    ]
  },
  UI.FieldGroup #Platform: {
    Data: [
      { Value: aiCoreStatus, Label: 'AI Core' },
      { Value: inferenceLatencyMs, Label: 'Inference Latency ms' },
      { Value: aiCoreExecutionId, Label: 'AI Core Execution' },
      { Value: aiCoreDeploymentId, Label: 'AI Core Deployment' },
      { Value: platformProof, Label: 'Platform Proof' }
    ]
  }
);

annotate intel.SpoilagePreventionDemo with {
  headline                    @Common.Label: 'Outcome';
  status                      @Common.Label: 'Demo Status';
  storeName                   @Common.Label: 'Store';
  zoneName                    @Common.Label: 'Zone';
  productName                 @Common.Label: 'Product';
  riskLevel                   @Common.Label: 'Risk Level';
  score                       @Common.Label: 'Risk Score';
  confidence                  @Common.Label: 'Confidence';
  remainingShelfLifeDays      @Common.Label: 'Remaining Shelf Life Days';
  demandUnitsForecast         @Common.Label: 'Demand Forecast Units';
  replenishmentUnits          @Common.Label: 'Replenishment Units';
  expectedWasteAvoidedUnits   @Common.Label: 'Expected Waste Avoided Units';
  expectedLostSalesAvoidedUnits @Common.Label: 'Expected Lost Sales Avoided Units';
  recommendedAction           @Common.Label: 'Recommended Action';
  aiCoreStatus                @Common.Label: 'AI Core Status';
  aiCoreExecutionId           @Common.Label: 'AI Core Execution';
  aiCoreDeploymentId          @Common.Label: 'AI Core Deployment';
  inferenceLatencyMs          @Common.Label: 'Inference Latency ms';
  platformProof               @Common.Label: 'SAP BTP Proof';
};

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

annotate config.Stores with @(
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
    { Value: operatingHours, Label: 'Hours' },
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

annotate config.Stores with {
  storeCode      @Common.Label: 'Store Code';
  name           @Common.Label: 'Store Name';
  region         @Common.Label: 'Region';
  timezone       @Common.Label: 'Timezone';
  operatingHours @Common.Label: 'Operating Hours';
  active         @Common.Label: 'Active';
};

annotate config.Zones with @(
  UI.HeaderInfo: {
    TypeName: 'Area',
    TypeNamePlural: 'Areas',
    Title: { Value: zoneCode },
    Description: { Value: type }
  },
  UI.SelectionFields: [type, active],
  UI.LineItem: [
    { Value: zoneCode, Label: 'Area' },
    { Value: name, Label: 'Name' },
    { Value: type, Label: 'Type' },
    { Value: safeTempMinC, Label: 'Min Temp C' },
    { Value: safeTempMaxC, Label: 'Max Temp C' },
    { Value: safeHumidityMin, Label: 'Min Humidity %' },
    { Value: safeHumidityMax, Label: 'Max Humidity %' },
    { Value: active, Label: 'Active' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Area Details', Target: '@UI.FieldGroup#AreaDetails' },
    { $Type: 'UI.ReferenceFacet', Label: 'Cold-Chain Thresholds', Target: '@UI.FieldGroup#Thresholds' }
  ],
  UI.FieldGroup #AreaDetails: {
    Data: [
      { Value: zoneCode, Label: 'Area Code' },
      { Value: name, Label: 'Name' },
      { Value: type, Label: 'Type' },
      { Value: store, Label: 'Store' },
      { Value: active, Label: 'Active' }
    ]
  },
  UI.FieldGroup #Thresholds: {
    Data: [
      { Value: safeTempMinC, Label: 'Safe Temp Min C' },
      { Value: safeTempMaxC, Label: 'Safe Temp Max C' },
      { Value: safeHumidityMin, Label: 'Safe Humidity Min %' },
      { Value: safeHumidityMax, Label: 'Safe Humidity Max %' }
    ]
  }
);

annotate config.Zones with {
  zoneCode        @Common.Label: 'Area Code';
  name            @Common.Label: 'Area Name';
  type            @Common.Label: 'Area Type';
  store           @Common.Label: 'Store';
  safeTempMinC    @Common.Label: 'Min Temp C';
  safeTempMaxC    @Common.Label: 'Max Temp C';
  safeHumidityMin @Common.Label: 'Min Humidity %';
  safeHumidityMax @Common.Label: 'Max Humidity %';
  active          @Common.Label: 'Active';
};

annotate config.Sensors with @(
  UI.HeaderInfo: {
    TypeName: 'Sensor',
    TypeNamePlural: 'Sensors',
    Title: { Value: sensorId },
    Description: { Value: sensorType }
  },
  UI.SelectionFields: [sensorType, healthStatus],
  UI.LineItem: [
    { Value: sensorId, Label: 'Sensor' },
    { Value: sensorType, Label: 'Type' },
    { Value: firmwareVersion, Label: 'Firmware' },
    { Value: lastSeenAt, Label: 'Last Seen' },
    { Value: healthStatus, Label: 'Health' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Sensor Details', Target: '@UI.FieldGroup#SensorDetails' }
  ],
  UI.FieldGroup #SensorDetails: {
    Data: [
      { Value: sensorId, Label: 'Sensor ID' },
      { Value: zone, Label: 'Area' },
      { Value: sensorType, Label: 'Type' },
      { Value: firmwareVersion, Label: 'Firmware Version' },
      { Value: lastSeenAt, Label: 'Last Seen' },
      { Value: healthStatus, Label: 'Health' }
    ]
  }
);

annotate config.Sensors with {
  sensorId        @Common.Label: 'Sensor ID';
  zone            @Common.Label: 'Area';
  sensorType      @Common.Label: 'Sensor Type';
  firmwareVersion @Common.Label: 'Firmware Version';
  lastSeenAt      @Common.Label: 'Last Seen';
  healthStatus    @Common.Label: 'Health';
};

annotate config.Products with @(
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
    { Value: packagingType, Label: 'Packaging' },
    { Value: recommendedTempMinC, Label: 'Min Temp C' },
    { Value: recommendedTempMaxC, Label: 'Max Temp C' },
    { Value: standardShelfLifeDays, Label: 'Shelf Life Days' },
    { Value: uom, Label: 'Unit' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Product Details', Target: '@UI.FieldGroup#ProductDetails' },
    { $Type: 'UI.ReferenceFacet', Label: 'Cold-Chain Policy', Target: '@UI.FieldGroup#ColdChainPolicy' },
    { $Type: 'UI.ReferenceFacet', Label: 'Commercials', Target: '@UI.FieldGroup#Commercials' }
  ],
  UI.FieldGroup #ProductDetails: {
    Data: [
      { Value: sku, Label: 'SKU' },
      { Value: name, Label: 'Name' },
      { Value: category, Label: 'Category' },
      { Value: subcategory, Label: 'Subcategory' },
      { Value: packagingType, Label: 'Packaging' },
      { Value: uom, Label: 'Unit' }
    ]
  },
  UI.FieldGroup #ColdChainPolicy: {
    Data: [
      { Value: recommendedTempMinC, Label: 'Recommended Min Temp C' },
      { Value: recommendedTempMaxC, Label: 'Recommended Max Temp C' },
      { Value: standardShelfLifeDays, Label: 'Standard Shelf Life Days' }
    ]
  },
  UI.FieldGroup #Commercials: {
    Data: [
      { Value: unitCostZar, Label: 'Unit Cost ZAR' },
      { Value: sellingPriceZar, Label: 'Selling Price ZAR' }
    ]
  }
);

annotate config.Products with {
  sku                   @Common.Label: 'SKU';
  name                  @Common.Label: 'Product Name';
  category              @Common.Label: 'Category';
  subcategory           @Common.Label: 'Subcategory';
  packagingType         @Common.Label: 'Packaging';
  uom                   @Common.Label: 'Unit';
  recommendedTempMinC   @Common.Label: 'Recommended Min Temp C';
  recommendedTempMaxC   @Common.Label: 'Recommended Max Temp C';
  standardShelfLifeDays @Common.Label: 'Shelf Life Days';
  unitCostZar           @Common.Label: 'Unit Cost ZAR';
  sellingPriceZar       @Common.Label: 'Selling Price ZAR';
};

annotate config.ImpactSettings with @(
  UI.HeaderInfo: {
    TypeName: 'Impact Setting',
    TypeNamePlural: 'Impact Settings',
    Title: { Value: settingCode },
    Description: { Value: description }
  },
  UI.SelectionFields: [active, currencyCode],
  UI.LineItem: [
    { Value: settingCode, Label: 'Setting' },
    { Value: description, Label: 'Description' },
    { Value: currencyCode, Label: 'Currency' },
    { Value: criticalRiskSalvageRate, Label: 'Critical Salvage Rate' },
    { Value: highRiskSalvageRate, Label: 'High Salvage Rate' },
    { Value: mediumRiskSalvageRate, Label: 'Medium Salvage Rate' },
    { Value: lowRiskSalvageRate, Label: 'Low Salvage Rate' },
    { Value: criticalResponseSlaMinutes, Label: 'Critical SLA min' },
    { Value: highResponseSlaMinutes, Label: 'High SLA min' },
    { Value: mediumResponseSlaMinutes, Label: 'Medium SLA min' },
    { Value: lowResponseSlaMinutes, Label: 'Low SLA min' },
    { Value: active, Label: 'Active' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Business Impact Policy', Target: '@UI.FieldGroup#ImpactPolicy' },
    { $Type: 'UI.ReferenceFacet', Label: 'Response SLA', Target: '@UI.FieldGroup#ResponseSla' }
  ],
  UI.FieldGroup #ImpactPolicy: {
    Data: [
      { Value: settingCode, Label: 'Setting' },
      { Value: description, Label: 'Description' },
      { Value: currencyCode, Label: 'Currency' },
      { Value: criticalRiskSalvageRate, Label: 'Critical Salvage Rate' },
      { Value: highRiskSalvageRate, Label: 'High Salvage Rate' },
      { Value: mediumRiskSalvageRate, Label: 'Medium Salvage Rate' },
      { Value: lowRiskSalvageRate, Label: 'Low Salvage Rate' },
      { Value: active, Label: 'Active' }
    ]
  },
  UI.FieldGroup #ResponseSla: {
    Data: [
      { Value: criticalResponseSlaMinutes, Label: 'Critical SLA min' },
      { Value: highResponseSlaMinutes, Label: 'High SLA min' },
      { Value: mediumResponseSlaMinutes, Label: 'Medium SLA min' },
      { Value: lowResponseSlaMinutes, Label: 'Low SLA min' }
    ]
  }
);

annotate config.ImpactSettings with {
  settingCode                @Common.Label: 'Setting';
  description                @Common.Label: 'Description';
  currencyCode               @Common.Label: 'Currency';
  criticalRiskSalvageRate    @Common.Label: 'Critical Salvage Rate';
  highRiskSalvageRate        @Common.Label: 'High Salvage Rate';
  mediumRiskSalvageRate      @Common.Label: 'Medium Salvage Rate';
  lowRiskSalvageRate         @Common.Label: 'Low Salvage Rate';
  criticalResponseSlaMinutes @Common.Label: 'Critical SLA min';
  highResponseSlaMinutes     @Common.Label: 'High SLA min';
  mediumResponseSlaMinutes   @Common.Label: 'Medium SLA min';
  lowResponseSlaMinutes      @Common.Label: 'Low SLA min';
  active                     @Common.Label: 'Active';
};

annotate config.ThresholdConfigs with @(
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
    { $Type: 'UI.ReferenceFacet', Label: 'Temperature and Humidity', Target: '@UI.FieldGroup#ColdChainThresholds' },
    { $Type: 'UI.ReferenceFacet', Label: 'Alert Policy', Target: '@UI.FieldGroup#AlertPolicy' }
  ],
  UI.FieldGroup #ColdChainThresholds: {
    Data: [
      { Value: zoneType, Label: 'Area Type' },
      { Value: productCategory, Label: 'Product Category' },
      { Value: safeTempMinC, Label: 'Safe Temp Min C' },
      { Value: safeTempMaxC, Label: 'Safe Temp Max C' },
      { Value: safeHumidityMin, Label: 'Safe Humidity Min' },
      { Value: safeHumidityMax, Label: 'Safe Humidity Max' }
    ]
  },
  UI.FieldGroup #AlertPolicy: {
    Data: [
      { Value: durationMinutes, Label: 'Duration Minutes' },
      { Value: doorOpenSecondsLimit, Label: 'Door Open Seconds' },
      { Value: severity, Label: 'Severity' },
      { Value: active, Label: 'Active' }
    ]
  }
);

annotate config.ThresholdConfigs with {
  zoneType             @Common.Label: 'Area Type';
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

annotate config.IngestionErrors with @(
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
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Error Details', Target: '@UI.FieldGroup#ErrorDetails' },
    { $Type: 'UI.ReferenceFacet', Label: 'Payload', Target: '@UI.FieldGroup#Payload' }
  ],
  UI.FieldGroup #ErrorDetails: {
    Data: [
      { Value: sourceQueue, Label: 'Source Queue' },
      { Value: messageId, Label: 'Message ID' },
      { Value: correlationId, Label: 'Correlation ID' },
      { Value: errorClass, Label: 'Error Class' },
      { Value: errorMessage, Label: 'Message' },
      { Value: retryCount, Label: 'Retries' },
      { Value: status, Label: 'Status' }
    ]
  },
  UI.FieldGroup #Payload: {
    Data: [
      { Value: payloadHash, Label: 'Payload Hash' },
      { Value: payload, Label: 'Payload' }
    ]
  }
);

annotate config.IngestionErrors with {
  createdAt     @Common.Label: 'Created At';
  sourceQueue   @Common.Label: 'Source Queue';
  messageId     @Common.Label: 'Message ID';
  correlationId @Common.Label: 'Correlation ID';
  errorClass    @Common.Label: 'Error Class';
  errorMessage  @Common.Label: 'Message';
  payloadHash   @Common.Label: 'Payload Hash';
  payload       @Common.Label: 'Payload';
  retryCount    @Common.Label: 'Retries';
  status        @Common.Label: 'Status';
};

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

annotate live.LiveSensorEvents with @(
  UI.HeaderInfo: {
    TypeName: 'Live Sensor Event',
    TypeNamePlural: 'Sense: Live Sensor Events',
    Title: { Value: sourceMessageId },
    Description: { Value: scenarioCode }
  },
  UI.SelectionFields: [scenarioCode, zoneCode, measuredAt],
  UI.LineItem: [
    { Value: measuredAt, Label: 'Measured At' },
    { Value: storeCode, Label: 'Store' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: sensorId, Label: 'Sensor' },
    { Value: temperatureC, Label: 'Temp C' },
    { Value: humidityPct, Label: 'Humidity %' },
    { Value: doorOpen, Label: 'Door Open' },
    { Value: sensorHealth, Label: 'Sensor Health' },
    { Value: scenarioCode, Label: 'Scenario' }
  ],
  UI.LineItem #RecentTelemetry: [
    { Value: measuredAt, Label: 'Time' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: temperatureC, Label: 'Temp C' },
    { Value: humidityPct, Label: 'Humidity %' },
    { Value: doorOpen, Label: 'Door' },
    { Value: scenarioCode, Label: 'Scenario' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Sensor Evidence', Target: '@UI.FieldGroup#Evidence' }
  ],
  UI.FieldGroup #Evidence: {
    Data: [
      { Value: sourceMessageId, Label: 'Message ID' },
      { Value: publishedAt, Label: 'Published At' },
      { Value: storeCode, Label: 'Store' },
      { Value: zoneCode, Label: 'Zone' },
      { Value: temperatureC, Label: 'Temperature C' },
      { Value: humidityPct, Label: 'Humidity %' },
      { Value: doorOpen, Label: 'Door Open' },
      { Value: sensorHealth, Label: 'Sensor Health' },
      { Value: scenarioCode, Label: 'Spoilage Scenario' }
    ]
  }
);

annotate live.RiskDecisions with @(
  UI.HeaderInfo: {
    TypeName: 'Risk Decision',
    TypeNamePlural: 'Predict: AI Core Risk Decisions',
    Title: { Value: riskLevel },
    Description: { Value: recommendedAction }
  },
  UI.SelectionFields: [riskLevel, predictionType, zoneCode],
  UI.LineItem: [
    { Value: createdAt, Label: 'Created At' },
    { Value: storeCode, Label: 'Store' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: riskLevel, Label: 'Risk' },
    { Value: score, Label: 'Score' },
    { Value: confidence, Label: 'Confidence' },
    { Value: anomalyType, Label: 'Anomaly' },
    { Value: remainingShelfLifeDays, Label: 'Shelf Life Days' },
    { Value: recommendedAction, Label: 'Recommended Action' }
  ],
  UI.LineItem #LatestRisk: [
    { Value: createdAt, Label: 'Scored At' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: riskLevel, Label: 'Risk', Criticality: criticality },
    { Value: score, Label: 'Score' },
    { Value: confidence, Label: 'Confidence' },
    { Value: recommendedAction, Label: 'Action' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Risk Decision', Target: '@UI.FieldGroup#Decision' },
    { $Type: 'UI.ReferenceFacet', Label: 'SAP AI Core Proof', Target: '@UI.FieldGroup#AiCore' }
  ],
  UI.FieldGroup #Decision: {
    Data: [
      { Value: riskLevel, Label: 'Risk' },
      { Value: score, Label: 'Score' },
      { Value: confidence, Label: 'Confidence' },
      { Value: anomalyType, Label: 'Anomaly' },
      { Value: remainingShelfLifeDays, Label: 'Remaining Shelf Life Days' },
      { Value: demandUnitsForecast, Label: 'Demand Forecast Units' },
      { Value: replenishmentUnits, Label: 'Replenishment Units' },
      { Value: routePriority, Label: 'Route Priority' },
      { Value: recommendedAction, Label: 'Recommended Action' }
    ]
  },
  UI.FieldGroup #AiCore: {
    Data: [
      { Value: modelName, Label: 'Model' },
      { Value: modelVersion, Label: 'Model Version' },
      { Value: deploymentId, Label: 'Deployment' },
      { Value: aiCoreUnavailable, Label: 'AI Core Unavailable' },
      { Value: modelUnavailableReason, Label: 'AI Core Message' }
    ]
  }
);

annotate live.SpoilageInterventions with @(
  UI.HeaderInfo: {
    TypeName: 'Spoilage Intervention',
    TypeNamePlural: 'Act: Spoilage Interventions',
    Title: { Value: title },
    Description: { Value: status }
  },
  UI.SelectionFields: [severity, status, alertType, zoneCode],
  UI.LineItem: [
    { Value: createdAt, Label: 'Created At' },
    { Value: severity, Label: 'Severity' },
    { Value: status, Label: 'Status' },
    { Value: storeCode, Label: 'Store' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: title, Label: 'Alert' },
    { Value: recommendation, Label: 'Recommended Action' },
    { $Type: 'UI.DataFieldForAction', Action: 'LiveDemoService.acknowledge', Label: 'Acknowledge' },
    { $Type: 'UI.DataFieldForAction', Action: 'LiveDemoService.resolve', Label: 'Resolve' },
    { $Type: 'UI.DataFieldForAction', Action: 'LiveDemoService.reopen', Label: 'Reopen' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Intervention', Target: '@UI.FieldGroup#Intervention' }
  ],
  UI.FieldGroup #Intervention: {
    Data: [
      { Value: severity, Label: 'Severity' },
      { Value: status, Label: 'Status' },
      { Value: alertType, Label: 'Type' },
      { Value: title, Label: 'Alert' },
      { Value: recommendation, Label: 'Recommended Action' },
      { Value: assignedTo, Label: 'Assigned To' },
      { Value: outcome, Label: 'Outcome' }
    ]
  }
);

annotate live.DemoImpactMetrics with @(
  UI.HeaderInfo: {
    TypeName: 'Demo Proof',
    TypeNamePlural: 'Prove: Demo Proof',
    Title: { Value: latestRisk },
    Description: { Value: platformProof }
  },
  UI.LineItem: [
    { Value: generatedAt, Label: 'Generated At' },
    { Value: runStatus, Label: 'Run Status' },
    { Value: latestScenario, Label: 'Latest Scenario' },
    { Value: latestRisk, Label: 'Latest Risk' },
    { Value: activeAlerts, Label: 'Active Alerts' },
    { Value: criticalAlerts, Label: 'Critical Alerts' },
    { Value: inferenceCount, Label: 'Inferences' },
    { Value: successfulInferences, Label: 'Successful Inferences' },
    { Value: averageLatencyMs, Label: 'Avg Latency ms' },
    { Value: expectedWasteAvoidedUnits, Label: 'Waste Avoided' },
    { Value: expectedLostSalesAvoidedUnits, Label: 'Lost Sales Avoided' }
  ],
  UI.DataPoint #ActiveAlerts: {
    Title: 'Active Alerts',
    Value: activeAlerts,
    Criticality: activeAlertsCriticality
  },
  UI.DataPoint #CriticalAlerts: {
    Title: 'Critical Alerts',
    Value: criticalAlerts,
    Criticality: criticalAlertsCriticality
  },
  UI.DataPoint #WasteAvoided: {
    Title: 'Waste Avoided',
    Value: expectedWasteAvoidedUnits
  },
  UI.DataPoint #LostSalesAvoided: {
    Title: 'Lost Sales Avoided',
    Value: expectedLostSalesAvoidedUnits
  },
  UI.DataPoint #InferenceLatency: {
    Title: 'AI Latency ms',
    Value: averageLatencyMs,
    Criticality: latencyCriticality
  },
  UI.DataPoint #InferenceCount: {
    Title: 'AI Inferences',
    Value: inferenceCount
  },
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Business Impact', Target: '@UI.FieldGroup#Impact' },
    { $Type: 'UI.ReferenceFacet', Label: 'BTP Proof', Target: '@UI.FieldGroup#Platform' }
  ],
  UI.FieldGroup #Impact: {
    Data: [
      { Value: activeAlerts, Label: 'Active Alerts' },
      { Value: criticalAlerts, Label: 'Critical Alerts' },
      { Value: expectedWasteAvoidedUnits, Label: 'Expected Waste Avoided Units' },
      { Value: expectedLostSalesAvoidedUnits, Label: 'Expected Lost Sales Avoided Units' },
      { Value: acceptedInterventions, Label: 'Accepted Interventions' }
    ]
  },
  UI.FieldGroup #Platform: {
    Data: [
      { Value: runStatus, Label: 'Live Demo Run Status' },
      { Value: inferenceCount, Label: 'Inference Count' },
      { Value: successfulInferences, Label: 'Successful Inferences' },
      { Value: averageLatencyMs, Label: 'Average Latency ms' },
      { Value: platformProof, Label: 'SAP BTP Proof' }
    ]
  }
);

annotate live.DemoImpactMetrics with {
  activeAlerts              @Aggregation.default: #SUM;
  activeAlertsCriticality   @Aggregation.default: #MAX;
  criticalAlerts            @Aggregation.default: #SUM;
  criticalAlertsCriticality @Aggregation.default: #MAX;
  expectedWasteAvoidedUnits @Aggregation.default: #SUM;
  latencyCriticality        @Aggregation.default: #MAX;
};

annotate live.BusinessImpactSummary with @(
  UI.HeaderInfo: {
    TypeName: 'Business Impact',
    TypeNamePlural: 'Executive Business Impact',
    Title: { Value: executiveHeadline },
    Description: { Value: incidentStatus }
  },
  UI.LineItem: [
    { Value: executiveHeadline, Label: 'Executive Headline', Criticality: criticality },
    { Value: potentialProtectedRevenueZar, Label: 'Potential Protected ZAR' },
    { Value: actualProtectedRevenueZar, Label: 'Actual Protected ZAR' },
    { Value: stockValueAtRiskZar, Label: 'Stock at Risk ZAR' },
    { Value: affectedLotCount, Label: 'Affected Lots' },
    { Value: affectedUnits, Label: 'Affected Units' },
    { Value: expectedLossZar, Label: 'Expected Loss ZAR' },
    { Value: salvageRate, Label: 'Salvage Rate' },
    { Value: wasteAvoidedUnits, Label: 'Waste Avoided' },
    { Value: lostSalesAvoidedUnits, Label: 'Lost Sales Avoided' },
    { Value: responseSlaMinutes, Label: 'Response SLA min' },
    { Value: processCompletionPct, Label: 'Process Completion %' },
    { Value: confidencePct, Label: 'AI Confidence %' }
  ],
  UI.LineItem #ControlTowerImpact: [
    { Value: executiveHeadline, Label: 'Rescue Signal', Criticality: criticality },
    { Value: potentialProtectedRevenueZar, Label: 'Potential ZAR' },
    { Value: stockValueAtRiskZar, Label: 'Stock at Risk ZAR' }
  ],
  UI.PresentationVariant #ControlTowerImpact: {
    Visualizations: ['@UI.LineItem#ControlTowerImpact']
  },
  UI.Identification #OpenProve: [
    {
      $Type: 'UI.DataFieldForIntentBasedNavigation',
      Label: 'Open Proof',
      SemanticObject: 'FreshChainProve',
      Action: 'display',
      RequiresContext: false
    }
  ],
  UI.DataPoint #ProtectedRevenue: {
    Title: 'Potential Protected Revenue',
    Value: potentialProtectedRevenueZar,
    Criticality: criticality
  },
  UI.DataPoint #ActualProtectedRevenue: {
    Title: 'Actual Protected Revenue',
    Value: actualProtectedRevenueZar,
    Criticality: criticality
  },
  UI.DataPoint #ProcessCompletion: {
    Title: 'Process Completion',
    Value: processCompletionPct,
    Criticality: criticality
  },
  UI.DataPoint #StockAtRisk: {
    Title: 'Stock at Risk',
    Value: stockValueAtRiskZar,
    Criticality: criticality
  },
  UI.DataPoint #WasteAvoided: {
    Title: 'Waste Avoided',
    Value: wasteAvoidedUnits,
    Criticality: criticality
  }
);

annotate live.BusinessImpactSummary with {
  protectedRevenueZar @Aggregation.default: #SUM;
  potentialProtectedRevenueZar @Aggregation.default: #SUM;
  actualProtectedRevenueZar @Aggregation.default: #SUM;
  stockValueAtRiskZar @Aggregation.default: #SUM;
  affectedLotCount    @Aggregation.default: #SUM;
  affectedUnits       @Aggregation.default: #SUM;
  expectedLossZar     @Aggregation.default: #SUM;
  wasteAvoidedUnits   @Aggregation.default: #SUM;
  criticality         @Aggregation.default: #MAX;
};

annotate live.RescueScenarios with @(
  UI.HeaderInfo: {
    TypeName: 'Rescue Scenario',
    TypeNamePlural: 'Live Rescue Scenario',
    Title: { Value: headline },
    Description: { Value: nextBestAction }
  },
  UI.LineItem: [
    { $Type: 'UI.DataFieldForAction', Action: 'LiveDemoService.runRescueScenario', Label: 'Run Rescue Scenario' },
    { $Type: 'UI.DataFieldForAction', Action: 'LiveDemoService.generateActionBrief', Label: 'Generate Action Brief' },
    { $Type: 'UI.DataFieldForAction', Action: 'LiveDemoService.triggerInterventionProcess', Label: 'Trigger Store Workflow' },
    { Value: headline, Label: 'Scenario', Criticality: criticality },
    { Value: riskLevel, Label: 'Risk', Criticality: criticality },
    { Value: potentialProtectedRevenueZar, Label: 'Potential Protected ZAR' },
    { Value: protectedRevenueZar, Label: 'Actual Protected ZAR' },
    { Value: businessValueAtRiskZar, Label: 'Stock at Risk ZAR' },
    { Value: affectedLotCount, Label: 'Affected Lots' },
    { Value: affectedUnits, Label: 'Affected Units' },
    { Value: responseSlaMinutes, Label: 'Response SLA min' },
    { Value: processStatus, Label: 'Workflow Status' },
    { Value: actionBriefStatus, Label: 'AI Brief' }
  ],
  UI.LineItem #ControlTowerRescue: [
    { Value: headline, Label: 'Active Rescue', Criticality: criticality },
    { Value: riskLevel, Label: 'Risk', Criticality: criticality },
    { Value: potentialProtectedRevenueZar, Label: 'Potential ZAR' }
  ],
  UI.PresentationVariant #ControlTowerRescue: {
    MaxItems: 1,
    SortOrder: [{
      Property: generatedAt,
      Descending: true
    }],
    Visualizations: ['@UI.LineItem#ControlTowerRescue']
  },
  UI.Identification #OpenAct: [
    {
      $Type: 'UI.DataFieldForIntentBasedNavigation',
      Label: 'Open Store Action',
      SemanticObject: 'FreshChainAct',
      Action: 'display',
      RequiresContext: false
    }
  ],
  UI.DataPoint #ProtectedRevenue: {
    Title: 'Protected Revenue',
    Value: protectedRevenueZar,
    Criticality: criticality
  },
  UI.DataPoint #RiskScore: {
    Title: 'Risk Score',
    Value: riskScore,
    Criticality: criticality
  },
  UI.DataPoint #ShelfLifeHours: {
    Title: 'Shelf Life Hours',
    Value: shelfLifeHoursRemaining,
    Criticality: criticality
  },
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Business Rescue', Target: '@UI.FieldGroup#Rescue' },
    { $Type: 'UI.ReferenceFacet', Label: 'Platform Proof', Target: '@UI.FieldGroup#Proof' }
  ],
  UI.FieldGroup #Rescue: {
    Data: [
      { Value: storeCode, Label: 'Store' },
      { Value: zoneCode, Label: 'Zone' },
      { Value: productName, Label: 'Product' },
      { Value: affectedLotCount, Label: 'Affected Lots' },
      { Value: affectedUnits, Label: 'Affected Units' },
      { Value: businessValueAtRiskZar, Label: 'Stock at Risk ZAR' },
      { Value: potentialProtectedRevenueZar, Label: 'Potential Protected ZAR' },
      { Value: expectedLossZar, Label: 'Expected Loss ZAR' },
      { Value: salvageRate, Label: 'Salvage Rate' },
      { Value: responseSlaMinutes, Label: 'Response SLA min' },
      { Value: shelfLifeHoursRemaining, Label: 'Shelf Life Hours' },
      { Value: nextBestAction, Label: 'Next Best Action' },
      { Value: managerMessage, Label: 'Manager Message' }
    ]
  },
  UI.FieldGroup #Proof: {
    Data: [
      { Value: aiCoreProof, Label: 'AI Core Proof' },
      { Value: bpaProof, Label: 'BPA Proof' },
      { Value: calculationSummary, Label: 'KPI Calculation' }
    ]
  }
);

annotate live.RescueScenarios with {
  protectedRevenueZar     @Aggregation.default: #SUM;
  potentialProtectedRevenueZar @Aggregation.default: #SUM;
  affectedLotCount        @Aggregation.default: #SUM;
  affectedUnits           @Aggregation.default: #SUM;
  riskScore               @Aggregation.default: #MAX;
  shelfLifeHoursRemaining @Aggregation.default: #MIN;
  criticality             @Aggregation.default: #MAX;
};

annotate live.CurrentRescueScenarios with @(
  UI.HeaderInfo: {
    TypeName: 'Current Rescue',
    TypeNamePlural: 'Current Rescue',
    Title: { Value: headline },
    Description: { Value: nextBestAction }
  },
  UI.LineItem #ControlTowerRescue: [
    { Value: headline, Label: 'Active Rescue', Criticality: criticality },
    { Value: riskLevel, Label: 'Risk', Criticality: criticality },
    { Value: potentialProtectedRevenueZar, Label: 'Potential ZAR' }
  ],
  UI.PresentationVariant #ControlTowerRescue: {
    Visualizations: ['@UI.LineItem#ControlTowerRescue']
  },
  UI.Identification #OpenAct: [
    {
      $Type: 'UI.DataFieldForIntentBasedNavigation',
      Label: 'Open Store Action',
      SemanticObject: 'FreshChainAct',
      Action: 'display',
      RequiresContext: false
    }
  ]
);

annotate live.CurrentRescueScenarios with {
  potentialProtectedRevenueZar @Aggregation.default: #SUM;
  criticality                  @Aggregation.default: #MAX;
};

annotate live.ActionBriefs with @(
  UI.HeaderInfo: {
    TypeName: 'Action Brief',
    TypeNamePlural: 'Generative Action Briefs',
    Title: { Value: title },
    Description: { Value: generationMode }
  },
  UI.LineItem: [
    { Value: title, Label: 'Brief', Criticality: criticality },
    { Value: generationMode, Label: 'Generation Mode' },
    { Value: modelProvider, Label: 'Provider' },
    { Value: modelName, Label: 'Model' },
    { Value: generationLatencyMs, Label: 'Latency ms' },
    { Value: actionSummary, Label: 'Store Action' },
    { Value: auditSummary, Label: 'Audit Summary' },
    { Value: unavailableReason, Label: 'Unavailable Reason' }
  ],
  UI.DataPoint #GenerationLatency: {
    Title: 'Brief Latency ms',
    Value: generationLatencyMs,
    Criticality: criticality
  }
);

annotate live.ActionBriefs with {
  generationLatencyMs @Aggregation.default: #AVG;
  criticality         @Aggregation.default: #MAX;
};

annotate live.ProcessTasks with @(
  UI.HeaderInfo: {
    TypeName: 'Store Workflow Task',
    TypeNamePlural: 'BPA Store Workflow Tasks',
    Title: { Value: taskTitle },
    Description: { Value: status }
  },
  UI.LineItem: [
    { $Type: 'UI.DataFieldForAction', Action: 'LiveDemoService.completeInterventionTask', Label: 'Complete Task' },
    { Value: taskTitle, Label: 'Task', Criticality: criticality },
    { Value: status, Label: 'Status', Criticality: criticality },
    { Value: priority, Label: 'Priority' },
    { Value: assignee, Label: 'Assignee' },
    { Value: dueInMinutes, Label: 'Due In min' },
    { Value: bpaMode, Label: 'Workflow Mode' },
    { Value: bpaTriggerStatus, Label: 'BPA Status' },
    { Value: bpaInstanceId, Label: 'BPA Instance' },
    { Value: outcome, Label: 'Outcome' }
  ],
  UI.LineItem #ControlTowerTasks: [
    { Value: taskTitle, Label: 'Store Task', Criticality: criticality },
    { Value: priority, Label: 'Priority' },
    { Value: assignee, Label: 'Owner' },
    { Value: dueInMinutes, Label: 'Due In min' }
  ],
  UI.PresentationVariant #ControlTowerTasks: {
    MaxItems: 2,
    SortOrder: [{
      Property: createdAt,
      Descending: true
    }],
    Visualizations: ['@UI.LineItem#ControlTowerTasks']
  },
  UI.Identification #OpenAct: [
    {
      $Type: 'UI.DataFieldForIntentBasedNavigation',
      Label: 'Open Store Tasks',
      SemanticObject: 'FreshChainAct',
      Action: 'display',
      RequiresContext: false
    }
  ],
  UI.DataPoint #DueInMinutes: {
    Title: 'Task Due In min',
    Value: dueInMinutes,
    Criticality: criticality
  }
);

annotate live.ProcessTasks with {
  dueInMinutes @Aggregation.default: #MIN;
  criticality  @Aggregation.default: #MAX;
};

annotate live.CurrentProcessTasks with @(
  UI.HeaderInfo: {
    TypeName: 'Current Store Task',
    TypeNamePlural: 'Current Store Tasks',
    Title: { Value: taskTitle },
    Description: { Value: priority }
  },
  UI.LineItem #ControlTowerTasks: [
    { Value: taskTitle, Label: 'Store Task', Criticality: criticality },
    { Value: priority, Label: 'Priority' },
    { Value: assignee, Label: 'Owner' },
    { Value: dueInMinutes, Label: 'Due In min' }
  ],
  UI.PresentationVariant #ControlTowerTasks: {
    Visualizations: ['@UI.LineItem#ControlTowerTasks']
  },
  UI.Identification #OpenAct: [
    {
      $Type: 'UI.DataFieldForIntentBasedNavigation',
      Label: 'Open Store Tasks',
      SemanticObject: 'FreshChainAct',
      Action: 'display',
      RequiresContext: false
    }
  ]
);

annotate live.CurrentProcessTasks with {
  dueInMinutes @Aggregation.default: #MIN;
  criticality  @Aggregation.default: #MAX;
};

annotate live.NotificationEvents with @(
  UI.HeaderInfo: {
    TypeName: 'Notification',
    TypeNamePlural: 'Store Notifications',
    Title: { Value: subject },
    Description: { Value: status }
  },
  UI.LineItem: [
    { Value: createdAt, Label: 'Created At' },
    { Value: channel, Label: 'Channel' },
    { Value: recipient, Label: 'Recipient' },
    { Value: subject, Label: 'Subject', Criticality: criticality },
    { Value: message, Label: 'Message' },
    { Value: status, Label: 'Status', Criticality: criticality }
  ],
  UI.DataPoint #NotificationCriticality: {
    Title: 'Notification Criticality',
    Value: criticality,
    Criticality: criticality
  }
);

annotate live.NotificationEvents with {
  criticality @Aggregation.default: #MAX;
};

annotate catalog.StockLots with @(
  UI.HeaderInfo: {
    TypeName: 'Stock Lot',
    TypeNamePlural: 'Cold-Chain Stock Lots',
    Title: { Value: lotNumber },
    Description: { Value: status }
  },
  UI.SelectionFields: [status, storeCode, zoneCode, productName, bestBeforeDate],
  UI.LineItem: [
    { $Type: 'UI.DataFieldForAction', Action: 'CatalogService.moveStock', Label: 'Move Stock' },
    { $Type: 'UI.DataFieldForAction', Action: 'CatalogService.applyMarkdown', Label: 'Apply Markdown' },
    { $Type: 'UI.DataFieldForAction', Action: 'CatalogService.writeOffStock', Label: 'Write Off' },
    { Value: lotNumber, Label: 'Lot' },
    { Value: productName, Label: 'Product' },
    { Value: productSku, Label: 'SKU' },
    { Value: storeCode, Label: 'Store' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: zoneType, Label: 'Zone Type' },
    { Value: quantityOnHand, Label: 'Qty On Hand' },
    { Value: sellingPriceZar, Label: 'Selling Price ZAR' },
    { Value: bestBeforeDate, Label: 'Best Before' },
    { Value: status, Label: 'Status' },
    { Value: lastMovementAt, Label: 'Last Movement' }
  ],
  UI.DataPoint #StockValue: {
    Title: 'Selling Price ZAR',
    Value: sellingPriceZar
  },
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'Stock Position', Target: '@UI.FieldGroup#StockPosition' },
    { $Type: 'UI.ReferenceFacet', Label: 'Valuation', Target: '@UI.FieldGroup#Valuation' }
  ],
  UI.FieldGroup #StockPosition: {
    Data: [
      { Value: lotNumber, Label: 'Lot Number' },
      { Value: productName, Label: 'Product' },
      { Value: productSku, Label: 'SKU' },
      { Value: batch_ID, Label: 'Batch' },
      { Value: storeCode, Label: 'Store' },
      { Value: zoneCode, Label: 'Current Zone' },
      { Value: zoneType, Label: 'Zone Type' },
      { Value: quantityOnHand, Label: 'Quantity On Hand' },
      { Value: unit, Label: 'Unit' },
      { Value: status, Label: 'Status' }
    ]
  },
  UI.FieldGroup #Valuation: {
    Data: [
      { Value: unitCostZar, Label: 'Unit Cost ZAR' },
      { Value: sellingPriceZar, Label: 'Selling Price ZAR' },
      { Value: bestBeforeDate, Label: 'Best Before' },
      { Value: sourceSystem, Label: 'Source System' },
      { Value: lastMovementAt, Label: 'Last Movement' }
    ]
  }
);

annotate catalog.StockMovements with @(
  UI.HeaderInfo: {
    TypeName: 'Stock Movement',
    TypeNamePlural: 'Stock Movement Ledger',
    Title: { Value: movementType },
    Description: { Value: referenceDocument }
  },
  UI.SelectionFields: [movementType, businessTimestamp, storeCode, fromZoneCode, toZoneCode],
  UI.LineItem: [
    { Value: businessTimestamp, Label: 'Business Time' },
    { Value: movementType, Label: 'Movement' },
    { Value: lotNumber, Label: 'Stock Lot' },
    { Value: productName, Label: 'Product' },
    { Value: storeCode, Label: 'Store' },
    { Value: fromZoneCode, Label: 'From Zone' },
    { Value: toZoneCode, Label: 'To Zone' },
    { Value: quantity, Label: 'Quantity' },
    { Value: movementValueZar, Label: 'Movement Value ZAR' },
    { Value: reasonCode, Label: 'Reason' },
    { Value: performedBy, Label: 'Performed By' },
    { Value: referenceDocument, Label: 'Reference' }
  ]
);

annotate catalog.ZoneOccupancy with @(
  UI.HeaderInfo: {
    TypeName: 'Zone Occupancy',
    TypeNamePlural: 'Cold Zone Occupancy',
    Title: { Value: zoneCode },
    Description: { Value: storeCode }
  },
  UI.SelectionFields: [storeCode, zoneCode, zoneType],
  UI.LineItem: [
    { Value: storeCode, Label: 'Store' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: zoneType, Label: 'Type' },
    { Value: lotCount, Label: 'Lots' },
    { Value: unitsOnHand, Label: 'Units' },
    { Value: stockValueZar, Label: 'Stock Value ZAR', Criticality: criticality },
    { Value: oldestBestBeforeDate, Label: 'Oldest Best Before' }
  ],
  UI.DataPoint #StockValue: {
    Title: 'Stock Value ZAR',
    Value: stockValueZar,
    Criticality: criticality
  }
);

annotate live.ZoneOccupancy with @(
  UI.HeaderInfo: {
    TypeName: 'Zone Occupancy',
    TypeNamePlural: 'Cold Zone Occupancy',
    Title: { Value: zoneCode },
    Description: { Value: storeCode }
  },
  UI.SelectionFields: [storeCode, zoneCode, zoneType],
  UI.LineItem: [
    { Value: storeCode, Label: 'Store' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: zoneType, Label: 'Type' },
    { Value: lotCount, Label: 'Lots' },
    { Value: unitsOnHand, Label: 'Units' },
    { Value: stockValueZar, Label: 'Stock Value ZAR', Criticality: criticality },
    { Value: oldestBestBeforeDate, Label: 'Oldest Best Before' }
  ],
  UI.DataPoint #StockValue: {
    Title: 'Stock Value ZAR',
    Value: stockValueZar,
    Criticality: criticality
  }
);

annotate live.InterventionImpacts with @(
  UI.HeaderInfo: {
    TypeName: 'Intervention Impact',
    TypeNamePlural: 'Intervention Impact Proof',
    Title: { Value: scenarioID },
    Description: { Value: status }
  },
  UI.SelectionFields: [status, storeCode, zoneCode, actionType],
  UI.LineItem: [
    { Value: scenarioID, Label: 'Scenario' },
    { Value: status, Label: 'Status', Criticality: criticality },
    { Value: actionType, Label: 'Action' },
    { Value: storeCode, Label: 'Store' },
    { Value: zoneCode, Label: 'Zone' },
    { Value: productName, Label: 'Product' },
    { Value: lotCount, Label: 'Lots' },
    { Value: affectedUnits, Label: 'Affected Units' },
    { Value: stockValueAtRiskZar, Label: 'Stock at Risk ZAR' },
    { Value: expectedLossZar, Label: 'Expected Loss ZAR' },
    { Value: responseSlaMinutes, Label: 'Response SLA min' },
    { Value: potentialProtectedRevenueZar, Label: 'Potential Protected ZAR' },
    { Value: actualProtectedRevenueZar, Label: 'Actual Protected ZAR' },
    { Value: movementReferences, Label: 'Movement Evidence' }
  ],
  UI.DataPoint #ActualProtected: {
    Title: 'Actual Protected Revenue',
    Value: actualProtectedRevenueZar,
    Criticality: criticality
  },
  UI.DataPoint #PotentialProtected: {
    Title: 'Potential Protected Revenue',
    Value: potentialProtectedRevenueZar,
    Criticality: criticality
  },
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', Label: 'KPI Formula', Target: '@UI.FieldGroup#Formula' },
    { $Type: 'UI.ReferenceFacet', Label: 'Action Proof', Target: '@UI.FieldGroup#ActionProof' }
  ],
  UI.FieldGroup #Formula: {
    Data: [
      { Value: stockValueAtRiskZar, Label: 'Stock Value at Risk ZAR' },
      { Value: spoilageProbability, Label: 'Spoilage Probability' },
      { Value: confidence, Label: 'AI Confidence' },
      { Value: expectedLossZar, Label: 'Expected Loss ZAR' },
      { Value: salvageRate, Label: 'Salvage Rate' },
      { Value: responseSlaMinutes, Label: 'Response SLA min' },
      { Value: potentialProtectedRevenueZar, Label: 'Potential Protected ZAR' },
      { Value: affectedLotNumbers, Label: 'Affected Lots' },
      { Value: calculationSummary, Label: 'Calculation Summary' }
    ]
  },
  UI.FieldGroup #ActionProof: {
    Data: [
      { Value: actionType, Label: 'Action Type' },
      { Value: actualProtectedRevenueZar, Label: 'Actual Protected ZAR' },
      { Value: wasteAvoidedUnits, Label: 'Waste Avoided Units' },
      { Value: lostSalesAvoidedUnits, Label: 'Lost Sales Avoided Units' },
      { Value: movementReferences, Label: 'Movement Evidence' },
      { Value: completedAt, Label: 'Completed At' }
    ]
  }
);

annotate live.InterventionImpacts with {
  stockValueAtRiskZar          @Aggregation.default: #SUM;
  expectedLossZar              @Aggregation.default: #SUM;
  potentialProtectedRevenueZar @Aggregation.default: #SUM;
  actualProtectedRevenueZar    @Aggregation.default: #SUM;
  affectedUnits                @Aggregation.default: #SUM;
  lotCount                     @Aggregation.default: #SUM;
  criticality                  @Aggregation.default: #MAX;
};

annotate live.DemoRunStatus with @(
  UI.HeaderInfo: {
    TypeName: 'Live Demo Control',
    TypeNamePlural: 'Live Demo Controls',
    Title: { Value: status },
    Description: { Value: message }
  },
  UI.LineItem: [
    { $Type: 'UI.DataFieldForAction', Action: 'LiveDemoService.startLiveDemo', Label: 'Start Live Demo' },
    { $Type: 'UI.DataFieldForAction', Action: 'LiveDemoService.stopLiveDemo', Label: 'Stop Live Demo' },
    { $Type: 'UI.DataFieldForAction', Action: 'LiveDemoService.createLiveReading', Label: 'Create Reading' },
    { Value: status, Label: 'Status' },
    { Value: startedAt, Label: 'Started At' },
    { Value: stoppedAt, Label: 'Stopped At' },
    { Value: lastTickAt, Label: 'Last Tick At' },
    { Value: lastScenario, Label: 'Last Scenario' },
    { Value: message, Label: 'Message' }
  ]
);

annotate live.RiskByZone with @(
  Aggregation.CustomAggregate #riskScore: 'Edm.Decimal',
  UI.HeaderInfo: {
    TypeName: 'Zone Risk',
    TypeNamePlural: 'Zone Risk'
  },
  UI.LineItem: [
    { Value: zoneCode, Label: 'Zone' },
    { Value: storeCode, Label: 'Store' },
    { Value: riskLevel, Label: 'Risk', Criticality: criticality },
    { Value: riskScore, Label: 'Risk Score' },
    { Value: openAlerts, Label: 'Open Alerts' }
  ],
  UI.Chart #RiskScore: {
    Title: 'Risk by Zone',
    ChartType: #Bar,
    Dimensions: [zoneCode],
    Measures: [riskScore],
    MeasureAttributes: [{
      $Type: 'UI.ChartMeasureAttributeType',
      Measure: riskScore,
      Role: #Axis1
    }],
    DimensionAttributes: [{
      $Type: 'UI.ChartDimensionAttributeType',
      Dimension: zoneCode,
      Role: #Category
    }]
  },
  UI.DataPoint #RiskScore: {
    Title: 'Highest Zone Risk',
    Value: riskScore,
    Criticality: criticality
  },
  UI.SelectionVariant #RiskScore: {
    Text: 'All zone risk scores'
  },
  UI.PresentationVariant #RiskScore: {
    Visualizations: ['@UI.Chart#RiskScore']
  },
  UI.Identification #OpenPredict: [
    {
      $Type: 'UI.DataFieldForIntentBasedNavigation',
      Label: 'Open AI Decisions',
      SemanticObject: 'FreshChainPredict',
      Action: 'display',
      RequiresContext: false
    }
  ]
);

annotate live.RiskByZone with {
  zoneCode    @Common.Label: 'Zone';
  storeCode   @Common.Label: 'Store';
  riskLevel   @Common.Label: 'Risk';
  riskScore   @(
    Aggregation.default: #MAX,
    Measures.Unit: 'risk score',
    Common.Label: 'Risk Score'
  );
  openAlerts  @(
    Aggregation.default: #SUM,
    Measures.Unit: 'alerts',
    Common.Label: 'Open Alerts'
  );
  criticality @Aggregation.default: #MAX;
};

annotate live.ScenarioMix with @(
  Aggregation.CustomAggregate #readingCount: 'Edm.Int32',
  UI.HeaderInfo: {
    TypeName: 'Scenario Mix',
    TypeNamePlural: 'Scenario Mix'
  },
  UI.LineItem: [
    { Value: scenarioCode, Label: 'Scenario', Criticality: criticality },
    { Value: readingCount, Label: 'Readings' },
    { Value: sharePct, Label: 'Share %' }
  ],
  UI.Chart #ScenarioShare: {
    Title: 'Telemetry Scenario Mix',
    ChartType: #Donut,
    Dimensions: [scenarioCode],
    Measures: [readingCount],
    MeasureAttributes: [{
      $Type: 'UI.ChartMeasureAttributeType',
      Measure: readingCount,
      Role: #Axis1
    }],
    DimensionAttributes: [{
      $Type: 'UI.ChartDimensionAttributeType',
      Dimension: scenarioCode,
      Role: #Category
    }]
  },
  UI.DataPoint #ScenarioShare: {
    Title: 'Scenario Readings',
    Value: readingCount,
    Criticality: criticality
  },
  UI.SelectionVariant #ScenarioShare: {
    Text: 'Live telemetry scenarios'
  },
  UI.PresentationVariant #ScenarioShare: {
    Visualizations: ['@UI.Chart#ScenarioShare']
  },
  UI.Identification #OpenSense: [
    {
      $Type: 'UI.DataFieldForIntentBasedNavigation',
      Label: 'Open Telemetry',
      SemanticObject: 'FreshChainSense',
      Action: 'display',
      RequiresContext: false
    }
  ]
);

annotate live.ScenarioMix with {
  scenarioCode @Common.Label: 'Scenario';
  readingCount @(
    Aggregation.default: #SUM,
    Measures.Unit: 'readings',
    Common.Label: 'Readings'
  );
  sharePct     @(
    Aggregation.default: #MAX,
    Measures.Unit: '%',
    Common.Label: 'Share %'
  );
  criticality  @Aggregation.default: #MAX;
};

annotate live.InterventionStatusMix with @(
  Aggregation.CustomAggregate #alertCount: 'Edm.Int32',
  UI.HeaderInfo: {
    TypeName: 'Intervention Status',
    TypeNamePlural: 'Intervention Status'
  },
  UI.LineItem: [
    { Value: status, Label: 'Status', Criticality: criticality },
    { Value: alertCount, Label: 'Alerts' }
  ],
  UI.Chart #StatusMix: {
    Title: 'Interventions by Status',
    ChartType: #Donut,
    Dimensions: [status],
    Measures: [alertCount],
    MeasureAttributes: [{
      $Type: 'UI.ChartMeasureAttributeType',
      Measure: alertCount,
      Role: #Axis1
    }],
    DimensionAttributes: [{
      $Type: 'UI.ChartDimensionAttributeType',
      Dimension: status,
      Role: #Category
    }]
  },
  UI.DataPoint #StatusMix: {
    Title: 'Intervention Alerts',
    Value: alertCount,
    Criticality: criticality
  },
  UI.SelectionVariant #StatusMix: {
    Text: 'Open intervention status'
  },
  UI.PresentationVariant #StatusMix: {
    Visualizations: ['@UI.Chart#StatusMix']
  },
  UI.Identification #OpenAct: [
    {
      $Type: 'UI.DataFieldForIntentBasedNavigation',
      Label: 'Open Intervention Queue',
      SemanticObject: 'FreshChainAct',
      Action: 'display',
      RequiresContext: false
    }
  ]
);

annotate live.InterventionStatusMix with {
  status      @Common.Label: 'Status';
  alertCount  @(
    Aggregation.default: #SUM,
    Measures.Unit: 'alerts',
    Common.Label: 'Alerts'
  );
  criticality @Aggregation.default: #MAX;
};

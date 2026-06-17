using freshchain as db from '../db/schema';

@requires: 'authenticated-user'
service LiveDemoService @(path: '/odata/v4/live-demo') {
  @readonly
  entity LiveSensorEvents as select from db.SensorReadings {
    key ID,
    measuredAt,
    publishedAt,
    store.storeCode as storeCode,
    zone.zoneCode as zoneCode,
    sensor.sensorId as sensorId,
    temperatureC,
    humidityPct,
    doorOpen,
    sensorHealth,
    scenarioCode,
    sourceMessageId
  };

  @readonly
  entity RiskDecisions as select from db.Predictions {
    key ID,
    createdAt,
    modelName,
    modelVersion,
    deploymentId,
    store.storeCode as storeCode,
    zone.zoneCode as zoneCode,
    predictionType,
    riskLevel,
    score,
    confidence,
    anomalyType,
    remainingShelfLifeDays,
    demandUnitsForecast,
    replenishmentUnits,
    routePriority,
    recommendedAction,
    aiCoreUnavailable,
    modelUnavailableReason,
    virtual null as criticality : Integer
  };

  @readonly
  entity SpoilageInterventions as select from db.Alerts {
    key ID,
    createdAt,
    modifiedAt,
    store.storeCode as storeCode,
    zone.zoneCode as zoneCode,
    prediction.ID as prediction_ID,
    severity,
    status,
    alertType,
    title,
    recommendation,
    assignedTo,
    outcome,
    virtual null as criticality : Integer
  } actions {
    action acknowledge(comment: String) returns SpoilageInterventions;
    action assign(userId: String, comment: String) returns SpoilageInterventions;
    action resolve(outcome: String, comment: String) returns SpoilageInterventions;
    action reopen(comment: String) returns SpoilageInterventions;
  };

  @readonly
  @cds.persistence.skip
  entity DemoImpactMetrics {
    key ID                    : String(40);
    generatedAt              : Timestamp;
    runStatus                : String(20);
    latestScenario           : String(60);
    latestRisk               : String(20);
    activeAlerts             : Integer;
    activeAlertsCriticality  : Integer;
    criticalAlerts           : Integer;
    criticalAlertsCriticality: Integer;
    inferenceCount           : Integer;
    successfulInferences     : Integer;
    averageLatencyMs         : Integer;
    latencyCriticality       : Integer;
    expectedWasteAvoidedUnits: Decimal(12,3);
    expectedLostSalesAvoidedUnits: Decimal(12,3);
    acceptedInterventions    : Integer;
    latestRiskCriticality    : Integer;
    platformProof            : String(500);
  }

  @readonly
  @cds.persistence.skip
  entity DynamicTileKpis {
    key ID      : String(40);
    number      : String(20);
    numberUnit  : String(20);
    state       : String(20);
    numberState : String(20);
    info        : String(80);
    infoState   : String(20);
    title       : String(80);
    subtitle    : String(160);
    targetUrl   : String(500);
    updatedAt   : Timestamp;
  }

  @readonly
  @cds.persistence.skip
  entity BusinessImpactSummary {
    key ID                    : String(40);
    generatedAt              : Timestamp;
    incidentStatus           : String(40);
    protectedRevenueZar      : Decimal(15,2);
    potentialProtectedRevenueZar : Decimal(15,2);
    actualProtectedRevenueZar : Decimal(15,2);
    stockValueAtRiskZar      : Decimal(15,2);
    affectedLotCount         : Integer;
    affectedUnits            : Decimal(12,3);
    expectedLossZar          : Decimal(15,2);
    salvageRate              : Decimal(6,3);
    wasteAvoidedUnits        : Decimal(12,3);
    lostSalesAvoidedUnits    : Decimal(12,3);
    responseSlaMinutes       : Integer;
    processCompletionPct     : Decimal(6,2);
    confidencePct            : Decimal(6,2);
    executiveHeadline        : String(180);
    criticality              : Integer;
  }

  @readonly
  entity RescueScenarios as select from db.RescueScenarios {
    key ID,
    createdAt as generatedAt,
    status,
    headline,
    storeCode,
    zoneCode,
    productName,
    affectedLotCount,
    affectedUnits,
    riskLevel,
    riskScore,
    confidence,
    spoilageProbability,
    shelfLifeHoursRemaining,
    businessValueAtRiskZar,
    potentialProtectedRevenueZar,
    protectedRevenueZar,
    expectedLossZar,
    salvageRate,
    wasteAvoidedUnits,
    lostSalesAvoidedUnits,
    responseSlaMinutes,
    processStatus,
    actionBriefStatus,
    nextBestAction,
    managerMessage,
    aiCoreProof,
    bpaProof as workflowProof,
    calculationSummary,
    criticality
  };

  @readonly
  @cds.persistence.skip
  entity CurrentRescueScenarios {
    key ID                       : String(80);
    generatedAt                  : Timestamp;
    headline                     : String(180);
    riskLevel                    : String(20);
    potentialProtectedRevenueZar : Decimal(15,2);
    nextBestAction               : String(500);
    criticality                  : Integer;
  }

  @readonly
  entity ActionBriefs as select from db.ActionBriefs {
    key ID,
    createdAt as generatedAt,
    scenario.ID as scenarioID,
    generationMode,
    modelProvider,
    modelName,
    generationLatencyMs,
    promptVersion,
    unavailableReason,
    title,
    actionSummary,
    managerNotification,
    auditSummary,
    customerSafeExplanation,
    criticality
  };

  @readonly
  entity ProcessTasks as select from db.ProcessTasks {
    key ID,
    createdAt,
    scenario.ID as scenarioID,
    processName,
    assignee,
    status,
    priority,
    dueInMinutes,
    taskTitle,
    taskInstruction,
    outcome,
    completedAt,
    bpaMode as workflowMode,
    bpaInstanceId as workflowInstanceId,
    bpaProcessId as workflowProcessId,
    bpaTriggerStatus as workflowStatus,
    bpaStartedAt as workflowStartedAt,
    bpaTaskUrl as workflowUrl,
    unavailableReason,
    criticality
  };

  @readonly
  @cds.persistence.skip
  entity CurrentProcessTasks {
    key ID          : String(80);
    createdAt       : Timestamp;
    scenarioID      : String(80);
    taskTitle       : String(180);
    priority        : String(20);
    assignee        : String(120);
    dueInMinutes    : Integer;
    criticality     : Integer;
  }

  @readonly
  entity NotificationEvents as select from db.NotificationEvents {
    key ID,
    createdAt,
    scenario.ID as scenarioID,
    channel,
    recipient,
    subject,
    message,
    status,
    criticality
  };

  @readonly
  @cds.persistence.skip
  entity IntegrationStatuses {
    key ID        : String(40);
    checkedAt     : Timestamp;
    serviceName   : String(80);
    status        : String(40);
    proofSource   : String(120);
    message       : String(500);
    criticality   : Integer;
  }

  @readonly
  @cds.persistence.skip
  entity RiskByZone {
    key ID       : String(80);
    zoneCode     : String(40);
    storeCode    : String(20);
    riskLevel    : String(20);
    riskScore    : Decimal(6,3);
    openAlerts   : Integer;
    criticality  : Integer;
  }

  @readonly
  @cds.persistence.skip
  entity ScenarioMix {
    key scenarioCode : String(60);
    readingCount     : Integer;
    sharePct         : Decimal(6,2);
    criticality      : Integer;
  }

  @readonly
  @cds.persistence.skip
  entity InterventionStatusMix {
    key status   : String(40);
    alertCount   : Integer;
    criticality  : Integer;
  }

  @readonly
  @cds.persistence.skip
  entity ZoneOccupancy {
    key ID               : UUID;
    storeCode            : String(20);
    zoneCode             : String(40);
    zoneType             : String(40);
    lotCount             : Integer;
    unitsOnHand          : Decimal(12,3);
    stockValueZar        : Decimal(15,2);
    oldestBestBeforeDate : Date;
    criticality          : Integer;
  }

  @readonly
  entity InterventionImpacts as select from db.InterventionImpacts {
    key ID,
    createdAt,
    modifiedAt,
    scenarioID,
    store.storeCode as storeCode,
    zone.zoneCode as zoneCode,
    product.name as productName,
    status,
    actionType,
    lotCount,
    affectedUnits,
    stockValueAtRiskZar,
    spoilageProbability,
    confidence,
    expectedLossZar,
    salvageRate,
    potentialProtectedRevenueZar,
    actualProtectedRevenueZar,
    wasteAvoidedUnits,
    lostSalesAvoidedUnits,
    responseSlaMinutes,
    completedAt,
    affectedLotNumbers,
    movementReferences,
    calculationSummary,
    virtual null as criticality : Integer
  };

  @readonly
  @cds.persistence.skip
  entity DemoRunStatus {
    key ID        : String(40);
    status        : String(20);
    startedAt     : Timestamp;
    stoppedAt     : Timestamp;
    lastTickAt    : Timestamp;
    lastMessageId : String(120);
    lastScenario  : String(60);
    message       : String(240);
  }

  action startLiveDemo() returns DemoRunStatus;
  action stopLiveDemo() returns DemoRunStatus;
  action resetDemoRun() returns DemoRunStatus;
  action createLiveReading(force: Boolean) returns LiveSensorEvents;
  action scoreLatestLiveReading(force: Boolean) returns RiskDecisions;
  action runRescueScenario() returns RescueScenarios;
  action generateActionBrief(scenarioID: String) returns ActionBriefs;
  action triggerInterventionProcess(scenarioID: String) returns ProcessTasks;
  action completeInterventionTask(taskID: String, outcome: String) returns ProcessTasks;
}

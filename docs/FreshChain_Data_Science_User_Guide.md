# FreshChain Data Science User Guide

Document version: 1.0  
Date: May 28, 2026  
Audience: Data scientists, ML engineers, AI operations users, and analytics product owners

## 1. Purpose

This guide explains how the data science team uses FreshChain with SAP AI Core and SAP AI Launchpad. FreshChain is the business application suite. SAP AI Launchpad is the ML operations console. SAP AI Core is the runtime for training, deployments, and inference.

FreshChain is designed so model output comes from SAP AI Core. If AI Core is unavailable, FreshChain records failed telemetry and does not generate synthetic ML predictions.

## 2. What the Suite Gives the Data Science Team

FreshChain gives the data science team a complete operational loop:

1. Review source data and datasets.
2. Upload a curated CSV dataset package.
3. Validate package structure, references, and row counts.
4. Import the validated package into the governed CAP data model.
5. Start AI Core training.
6. Monitor execution logs and metrics in SAP AI Launchpad.
7. Activate AI Core deployments.
8. Score operational zones.
9. Review inference telemetry.
10. Review model quality gates.
11. Inspect generated forecasts, replenishment recommendations, and transfer recommendations.
12. Work with operations teams when AI output indicates risk.

## 3. Tools You Will Use

| Tool | Use it for |
| --- | --- |
| FreshChain Intelligence | Dataset list, training action, deployment action, scoring, model quality, telemetry |
| FreshChain Overview | Executive and cross-functional view of health, forecasts, recommendations, transfers |
| FreshChain Monitoring | Zone health, active alert monitoring, aggregate telemetry |
| FreshChain Operations | Alert handling and action lifecycle |
| FreshChain Administration | Thresholds, ingestion errors, replay operations |
| SAP AI Launchpad | AI Core connections, scenarios, executions, logs, deployments, runtime status |
| SAP AI Core | Runtime service for training, deployment, and inference |

## 4. Roles and Responsibilities

| Role | Responsibilities |
| --- | --- |
| Data scientist | Validate datasets, review model quality, interpret predictions, tune model package |
| ML engineer | Build/push AI image, maintain AI Core executables, monitor deployment health |
| AI operations user | Use Launchpad to monitor executions, deployments, logs, and runtime issues |
| Store operations user | Apply or reject business recommendations and handle alerts |
| Platform admin | Maintain BTP services, Launchpad connection, service keys, and role collections |

## 5. FreshChain ML Lifecycle

### Step 1: Upload or confirm source data

Open FreshChain Intelligence and review Dataset Uploads and Datasets.

To upload a data science package:

1. Choose Template in the Dataset Uploads section if you want a known-good starter ZIP.
2. Prepare or edit a ZIP file containing CSV files.
3. Choose Upload ZIP in the Dataset Uploads section.
4. FreshChain stores the package in CAP persistence with checksum, filename, status, and validation summary.
5. FreshChain validates the package automatically after upload.
6. Review row counts and validation messages.
7. Choose Import after validation succeeds.

Required CSV files:

| File | Required columns |
| --- | --- |
| `sensor_readings.csv` | `messageId`, `storeCode`, `zoneCode`, `sensorId`, `measuredAt`, `temperatureC`, `humidityPct`, `co2Ppm`, `oxygenPct`, `lightLux`, `doorOpen` |
| `sales_observations.csv` | `storeCode`, `sku`, `businessDate`, `unitsSold`, `unitsWasted`, `averagePrice` |

Optional CSV files:

| File | Purpose |
| --- | --- |
| `stores.csv` | Adds stores before import |
| `zones.csv` | Adds zones before sensor readings are imported |
| `products.csv` | Adds products before sales rows are imported |
| `batches.csv` | Adds batch master data |
| `inventory_placements.csv` | Adds batch placement context |
| `metadata.csv` | Supplies `datasetCode`, `description`, `historyDays`, and `anomalyRate` |

Reference rules:

- `storeCode`, `zoneCode`, and `sku` must already exist or be provided by the matching optional master-data CSV.
- Duplicate `messageId` values are rejected.
- Numeric and date fields are validated before import.
- Imported ZIP packages are retained for lineage and cannot be deleted from the UI.

Dataset fields include:

- Dataset code
- Source
- Generated or ingested timestamp
- Reading count
- Incident count
- Sales row count
- History days

The recommended production path is source ingestion or validated dataset upload. Seeded demo data can exist for controlled demos, but it is not a local ML shortcut.

### Step 2: Start AI Core training

In FreshChain Intelligence:

1. Select or confirm the latest dataset.
2. Choose Start AI Core Training.
3. FreshChain calls SAP AI Core and creates an execution using:
   - Scenario: `freshchain-intelligence`
   - Executable: `freshchain-train`
   - Resource group: `freshchain-demo`

FreshChain stores:

- Training run ID
- AI Core execution ID
- Status
- Started timestamp
- Completed timestamp when available
- Metrics payload when returned by AI Core

### Step 3: Monitor training in SAP AI Launchpad

Open SAP AI Launchpad:

1. Select the AI Core connection.
2. Open the FreshChain scenario.
3. Locate the execution ID shown in FreshChain.
4. Review logs, status, artifacts, and metrics.

Expected status progression:

```text
RUNNING -> SUCCEEDED
```

Failure status:

```text
FAILED
```

If failed, inspect Launchpad logs first. Common causes are image pull failure, invalid executable configuration, missing parameters, or runtime exceptions in the training container.

### Step 4: Refresh training status in FreshChain

Back in FreshChain Intelligence:

1. Choose Refresh Training Status.
2. Confirm the run status updates from AI Core.
3. Confirm model quality metrics appear in the Model Quality section if AI Core returned metrics.

Quality metrics used by the dashboard include:

| Metric | Meaning |
| --- | --- |
| `auc` | Overall classification quality |
| `maeShelfLifeDays` | Shelf-life error in days |
| `mapeDemand` | Demand forecast percentage error |
| `precisionCritical` | Precision for critical-risk predictions |

### Step 5: Activate deployment

After a successful training run:

1. Choose Activate Latest Deployment.
2. FreshChain calls SAP AI Core to create a deployment using:
   - Scenario: `freshchain-intelligence`
   - Executable: `freshchain-serve`
   - Model artifact from the training execution

FreshChain stores:

- Deployment ID
- AI Core deployment ID
- Endpoint URL
- Health status
- Model name and version
- Last scored timestamp

### Step 6: Monitor deployment in Launchpad

In SAP AI Launchpad:

1. Open Deployments.
2. Find the FreshChain deployment ID.
3. Confirm the deployment reaches an online or succeeded state.
4. Inspect logs if the deployment is pending or failed.

Common deployment issues:

- AI image cannot be pulled.
- Serving command fails.
- Port mismatch.
- Model artifact not mounted or not found.
- Resource group mismatch.

### Step 7: Refresh deployment status in FreshChain

In FreshChain Intelligence:

1. Choose Refresh Deployment Status.
2. Confirm deployment health is `ONLINE`.
3. Confirm endpoint URL is populated.

### Step 8: Score latest zone

In FreshChain Intelligence or FreshChain Overview:

1. Choose Score Latest Zone or Score Latest.
2. CAP builds the feature payload from stores, zones, readings, aggregates, batches, products, placements, and sales observations.
3. CAP calls the active SAP AI Core deployment endpoint.
4. CAP validates the AI Core response.
5. CAP persists prediction output, telemetry, forecasts, replenishment recommendations, and transfer recommendations.

## 6. Model Input Contract

FreshChain sends a JSON object with a `features` property.

The feature payload contains:

- `store`
- `zone`
- `batch`
- `product`
- `latestReading`
- `aggregate`
- `sales`

The serving API is implemented in:

```text
ml/src/serve.py
```

The model logic entry point is:

```text
ml/src/freshchain_model.py
```

Contract reference:

```text
ml/serving/ai-core-contract.json
```

## 7. Required Model Output

AI Core inference must return these fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `predictionType` | Recommended | FreshChain prediction category |
| `riskLevel` | Yes | `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL` |
| `score` | Yes | Risk score from 0 to 1 |
| `confidence` | Yes | Model confidence from 0 to 1 |
| `anomalyType` | Yes | Business reason code |
| `remainingShelfLifeDays` | Yes | Predicted remaining shelf life |
| `demandUnitsForecast` | Yes | Near-term demand estimate |
| `replenishmentUnits` | Yes | Recommended replenishment quantity |
| `routePriority` | Yes | Transfer priority |
| `recommendedAction` | Yes | Human-readable operational recommendation |
| `businessImpact` | Recommended | Expected waste and lost-sales impact |

FreshChain rejects incomplete AI Core output. Rejected output is recorded as failed inference telemetry and no synthetic prediction is generated.

## 8. How Model Output Becomes Business Output

When AI Core inference succeeds:

1. FreshChain creates a `Predictions` record.
2. FreshChain records an `InferenceRequests` telemetry record with status `SUCCEEDED`.
3. FreshChain creates demand forecast rows.
4. FreshChain creates replenishment recommendations.
5. FreshChain creates route or transfer recommendations when an alternate store is available.
6. FreshChain dashboards update from OData views.

When AI Core inference fails:

1. FreshChain creates an `InferenceRequests` record with status `FAILED`.
2. `aiCoreUnavailable` is true.
3. FreshChain returns an OData error.
4. No prediction, forecast, replenishment, or route recommendation is created.

## 9. Dashboards and How to Read Them

### FreshChain Intelligence

Use this as the data science workbench.

Sections:

- Datasets: source data available for training.
- Training Runs: AI Core executions and run status.
- Deployments: AI Core deployment health and endpoint.
- Model Quality: quality metrics and target status.
- Inference Telemetry: scoring request status, latency, AI Core availability, and errors.

### FreshChain Overview

Use this for cross-functional status.

Sections:

- Operations: risk stream and inference telemetry.
- ML Pipeline: data freshness, datasets, runs, deployments.
- Model Quality: quality gates and scenario mix.
- Forecasts: demand forecasts.
- Recommendations: replenishment actions.
- Transfers: route and transfer recommendations.

### FreshChain Monitoring

Use this to understand operational context behind model output:

- Zone health
- Active alerts
- Reading aggregates
- Sensor freshness

### FreshChain Operations

Use this with store operations teams:

- Alert status
- Alert actions
- Acknowledgement, assignment, and resolution workflow

### FreshChain Administration

Use this for data and rule governance:

- Threshold configuration
- Ingestion errors
- Quarantined messages
- Replay handling

## 10. Daily Data Science Workflow

Recommended daily workflow:

1. Open FreshChain Intelligence.
2. Check Data Freshness.
3. Review latest dataset and incident mix.
4. Check latest training status.
5. Open SAP AI Launchpad and inspect failed or running executions.
6. Check active deployment health.
7. Review inference telemetry for failed or high-latency calls.
8. Review Model Quality.
9. Review top forecasts and recommendations in Overview.
10. Coordinate with operations if model output shows critical or high risk.

## 11. Release and Retraining Workflow

Use this workflow when publishing a new model:

1. Confirm source data is current.
2. Start AI Core training.
3. Validate training metrics in Launchpad.
4. Refresh training status in FreshChain.
5. Confirm quality gates are acceptable.
6. Activate deployment.
7. Refresh deployment status until online.
8. Run a controlled scoring pass.
9. Review inference telemetry and recommendations.
10. Communicate the active model version to operations.

Do not activate a model if:

- Training failed.
- Required metrics are missing.
- Deployment is not online.
- Inference response is missing required fields.
- Business recommendations are nonsensical for known scenarios.

## 12. Acceptance Checklist

A FreshChain ML release is acceptable when:

- AI Core training execution is visible in Launchpad.
- Training execution succeeds.
- Model metrics are available in FreshChain or Launchpad.
- AI Core deployment is online.
- FreshChain deployment health is online.
- Scoring succeeds against at least one active zone.
- Inference telemetry shows AI Core reached.
- Predictions are created from AI Core output.
- Demand forecasts are created.
- Replenishment recommendations are created.
- Route recommendations are created when applicable.
- Failed AI Core calls are recorded without local fallback.

## 13. Troubleshooting for Data Science Users

| Symptom | Meaning | What to do |
| --- | --- | --- |
| No datasets | No source data has been seeded or ingested | Ask platform/admin team to seed demo data or start ingestion |
| Training action fails | FreshChain could not create AI Core execution | Check AI Core binding, resource group, scenario, executable |
| Execution failed | Training container failed | Inspect AI Launchpad logs |
| No model quality rows | Metrics were not returned or not refreshed | Refresh training run; inspect execution output |
| Deployment has no endpoint | Serving deployment is not online | Inspect deployment in Launchpad |
| Scoring returns error | AI Core inference failed or output invalid | Check inference telemetry and serving logs |
| Recommendations missing | Scoring failed or no product/store context exists | Check prediction and feature context |
| High AI Core error rate | Runtime instability | Check deployment health, logs, and resource limits |

## 14. Key IDs and Defaults

| Item | Value |
| --- | --- |
| Resource group | `freshchain-demo` |
| Scenario | `freshchain-intelligence` |
| Training executable | `freshchain-train` |
| Serving executable | `freshchain-serve` |
| CAP action for training | `startTraining` |
| CAP action for deployment | `activateDeployment` |
| CAP action for scoring | `scoreLatest` |
| CAP action for seeded demo data | `seedDemoData` |

## 15. What Not to Do

- Do not use local inference for production validation.
- Do not treat seeded demo data as production data.
- Do not activate a deployment that is not online in AI Core.
- Do not ignore failed inference telemetry.
- Do not modify FreshChain UI apps to call AI Core directly. UI apps must use CAP OData models only.
- Do not bypass SAP AI Launchpad for execution and deployment observability.

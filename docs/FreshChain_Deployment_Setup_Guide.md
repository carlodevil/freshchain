# FreshChain Deployment and Setup Guide

Document version: 1.0  
Date: May 28, 2026  
Audience: SAP BTP administrators, platform engineers, CAP developers, and solution owners

## 1. Purpose

This guide explains exactly how to deploy the FreshChain production demo suite to an SAP BTP Cloud Foundry subaccount with SAP AI Core and SAP AI Launchpad. It covers the CAP backend, HANA persistence, managed HTML5 application deployment, Destination/XSUAA setup, AI Core runtime setup, Launchpad connection, validation, and troubleshooting.

FreshChain uses SAP AI Core for training, deployment, and inference. SAP AI Launchpad is the operator console for AI Core scenarios, executions, deployments, logs, and metrics. The CAP application does not perform local inference or create synthetic predictions. If SAP AI Core inference is unavailable, FreshChain records failed telemetry and returns an operational error.

## 2. Solution Components

| Component | Purpose | Deployment source |
| --- | --- | --- |
| `freshchain-srv` | CAP Node.js service exposing OData and ingestion endpoints | `gen/srv` from `cds build` |
| `freshchain-db-deployer` | HANA HDI deployer for CDS persistence artifacts | `gen/db` |
| HTML5 apps | Overview, Intelligence, Operations, Monitoring, Master Data, Admin | `app/freshchain-*` |
| `freshchain-html5-repo-host` | Stores static HTML5 app content | MTA resource |
| `freshchain-destination` | Runtime destination and HTML5 runtime configuration | MTA resource |
| `freshchain-auth` | XSUAA application security | `xs-security.json` |
| `freshchain-ai-core` | SAP AI Core service binding consumed by CAP | MTA resource |
| SAP AI Launchpad | AI operations console connected to AI Core | Subaccount subscription |
| AI Core scenario assets | Scenario and executable definitions | `ai-core/*.yaml` |
| AI model image | Training and serving container | `ml/Dockerfile` |
| Dataset upload persistence | Stores uploaded CSV ZIP packages, checksums, validation summaries, and import lineage | CAP/HANA entity `DatasetUploads` |

## 3. Prerequisites

### 3.1 Local workstation

Install and verify:

```sh
node --version
npm --version
cf --version
mbt --version
docker --version
```

Required tools:

- Node.js compatible with the CAP dependencies in `package.json`.
- Cloud Foundry CLI with access to the target org and space.
- MultiApps build tool (`mbt`) for MTAR generation.
- Docker or another OCI-compatible image builder.
- Access to a container registry that SAP AI Core can pull from.

### 3.2 SAP BTP subaccount

The target subaccount must have:

- Cloud Foundry environment enabled.
- A Cloud Foundry org and space.
- Entitlements for:
  - SAP HANA Cloud / HDI container service plan `hdi-shared`
  - Authorization and Trust Management service `xsuaa`
  - Destination service `lite`
  - HTML5 Application Repository `app-host`
  - SAP AI Core service `aicore`, plan `standard`
  - SAP AI Launchpad subscription
- A role collection that allows administration of AI Launchpad connections. SAP documents the Launchpad AI Core connection flow as requiring the `connections_editor` role or equivalent role collection.

SAP references:

- SAP AI Core service instance setup: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/create-service-instance
- SAP AI Core service key usage: https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/use-service-key
- SAP AI Launchpad connection to AI Core: https://help.sap.com/docs/ai-launchpad/sap-ai-launchpad/add-connection-to-sap-ai-core
- HTML5 Application Repository overview: https://help.sap.com/docs/build-work-zone-advanced-edition/sap-build-work-zone-advanced-edition/what-is-html5-application-repository

## 4. Repository Verification

From the repository root:

```sh
cd /workspace/freshchain
npm install
npm run check
npm test
```

Expected result:

- `npm run check` prints `UI artifact validation passed`.
- `npm test` passes all tests.
- Tests use a local SAP AI Core contract server and verify that inference fails closed when AI Core is unavailable.

## 5. Build and Push the AI Image

FreshChain includes a model server and training entry point under `ml/`.

Build the image:

```sh
docker build -t <registry>/freshchain-ai:1.0.0 ml
```

Push it:

```sh
docker push <registry>/freshchain-ai:1.0.0
```

The same image supports:

- Training command: `python /app/train.py`
- Serving command: `uvicorn serve:app --host 0.0.0.0 --port 9000`

Confirm the image path is reachable by SAP AI Core. If your registry requires credentials, configure the registry secret in AI Core according to your organization's AI Core operations standard.

## 6. Prepare AI Core Scenario Assets

FreshChain ships these AI Core assets:

| File | Purpose |
| --- | --- |
| `ai-core/scenario.yaml` | Scenario `freshchain-intelligence` |
| `ai-core/training-executable.yaml` | Training executable `freshchain-train` |
| `ai-core/serving-executable.yaml` | Serving executable `freshchain-serve` |

Replace the placeholder image reference in both executable files:

```sh
sed -i 's#${FRESHCHAIN_AI_IMAGE}#<registry>/freshchain-ai:1.0.0#g' ai-core/training-executable.yaml
sed -i 's#${FRESHCHAIN_AI_IMAGE}#<registry>/freshchain-ai:1.0.0#g' ai-core/serving-executable.yaml
```

Use resource group:

```text
freshchain-demo
```

Use IDs:

```text
Scenario: freshchain-intelligence
Training executable: freshchain-train
Serving executable: freshchain-serve
```

Register the scenario and executables using your organization's preferred SAP AI Core workflow, such as AI Core API, AI Core toolkit, or GitOps onboarding process. After registration, verify the scenario and executable names are visible in SAP AI Launchpad after the Launchpad connection is created.

## 7. Configure BTP and Cloud Foundry

Log in:

```sh
cf login -a <cf-api-endpoint>
cf target -o <org> -s <space>
```

Confirm service marketplace entries:

```sh
cf marketplace | grep -E "hana|xsuaa|destination|html5|aicore"
```

The MTA creates these managed services:

```text
freshchain-db
freshchain-auth
freshchain-html5-repo-host
freshchain-destination
freshchain-ai-core
```

Important: SAP AI Launchpad is a subaccount subscription. It is not deployed as an MTA module. Subscribe to Launchpad in the BTP cockpit before the business team starts validating AI operations.

## 8. Build the MTAR

Run:

```sh
npm run build:mta
```

Expected output:

```text
mta_archives/freshchain_0.1.0.mtar
```

The build performs:

- `npm ci`
- `npx cds build --production`
- CAP service packaging
- HANA deployer packaging
- HTML5 app zip generation
- HTML5 content packaging

Existing CAP warnings about cross-service navigation properties in `IntelligenceService` can be reviewed, but they do not block deployment.

## 9. Deploy to Cloud Foundry

Deploy:

```sh
cf deploy mta_archives/freshchain_0.1.0.mtar
```

Validate:

```sh
cf apps
cf services
cf service freshchain-ai-core
cf service freshchain-db
cf service freshchain-destination
```

Expected:

- `freshchain-srv` is started.
- `freshchain-db-deployer` has completed successfully.
- `freshchain-ai-core` exists and is bound to `freshchain-srv`.
- HTML5 app content is uploaded to the HTML5 Application Repository.

## 10. Enable Dataset Uploads

Dataset upload is part of the CAP service and requires no separate object store for the production demo. Uploaded ZIP packages are persisted in HANA through the `DatasetUploads` entity and linked to the imported `MLDatasets` record after import.

Operational limits:

- Maximum decoded ZIP size: 25 MB.
- HTTP JSON body limit in the CAP server: 40 MB.
- Required files: `sensor_readings.csv` and `sales_observations.csv`.
- Optional master data files can create stores, zones, products, batches, and inventory placements before importing observations.

Validation and import flow:

1. Data science users upload the ZIP from FreshChain Intelligence.
2. Users can download a generated starter ZIP from the Template button if they need the expected CSV layout.
3. CAP stores the package content, SHA-256 checksum, filename, MIME type, and upload timestamp.
4. CAP validates required files, columns, date formats, numeric fields, duplicate sensor message IDs, and master-data references.
5. The UI shows row counts and validation errors.
6. Users explicitly choose Import after successful validation.
7. CAP imports master data, sensor readings, sales observations, and one `MLDatasets` lineage record.
8. Imported packages are retained and cannot be deleted, preserving training lineage.

Post-deploy validation:

```sh
curl -s "$APP_URL/odata/v4/intelligence/DatasetUploads" \
  -H "Authorization: Bearer <token>"
```

The response should return an OData collection. Use the FreshChain Intelligence app for normal upload operations because it calls the CAP OData actions and avoids direct browser HTTP code in the UI.

If the AI Core service creation fails, confirm the subaccount entitlement and plan name. The MTA uses service `aicore` and plan `standard`.

## 10. Create AI Core Service Key for Launchpad

Create a service key:

```sh
cf create-service-key freshchain-ai-core freshchain-ai-core-key
cf service-key freshchain-ai-core freshchain-ai-core-key
```

Keep the output secure. It contains credentials used by SAP AI Launchpad and API clients.

You need these values:

- `AI_API_URL`
- OAuth `url`
- `clientid`
- `clientsecret`

SAP documents that the service key provides URLs and credentials for AI Core access, and that `clientid`, `clientsecret`, and `url` are used to obtain an OAuth token.

## 11. Connect SAP AI Launchpad to AI Core

In SAP AI Launchpad:

1. Open the Workspaces app.
2. Choose Add.
3. Create an AI API connection.
4. Upload the AI Core service key JSON or enter fields manually.
5. If using client secret credentials, enter:
   - `AI_API_URL`
   - `url`
   - `clientid`
   - `clientsecret`
6. Save the connection.

Expected:

- The new connection appears in Workspaces.
- Scenario `freshchain-intelligence` is visible.
- Executables `freshchain-train` and `freshchain-serve` are visible after scenario asset registration.

## 12. Runtime Configuration

The CAP service reads SAP AI Core credentials from `VCAP_SERVICES` through the bound `freshchain-ai-core` instance.

Optional environment overrides:

```sh
cf set-env freshchain-srv AICORE_RESOURCE_GROUP freshchain-demo
cf set-env freshchain-srv AICORE_SCENARIO_ID freshchain-intelligence
cf set-env freshchain-srv AICORE_TRAINING_EXECUTABLE_ID freshchain-train
cf set-env freshchain-srv AICORE_SERVING_EXECUTABLE_ID freshchain-serve
cf restage freshchain-srv
```

Defaults already match the shipped assets:

| Variable | Default |
| --- | --- |
| `AICORE_RESOURCE_GROUP` | `freshchain-demo` |
| `AICORE_SCENARIO_ID` | `freshchain-intelligence` |
| `AICORE_TRAINING_EXECUTABLE_ID` | `freshchain-train` |
| `AICORE_SERVING_EXECUTABLE_ID` | `freshchain-serve` |

## 13. HTML5 Apps and Work Zone

FreshChain deploys HTML5 app content and destination content. The design assumes managed HTML5 runtime and Work Zone/Launchpad-style access, not a custom standalone approuter.

The apps are:

| App | Purpose |
| --- | --- |
| FreshChain Rescue Command Center | Executive rescue value, risk, active incident, store task, and BTP readiness cockpit |
| FreshChain Rescue Cockpit | Demo-first app for live reading trigger, AI Core scoring, rescue calculation, task proof, and protected revenue |
| FreshChain Act | Frontline spoilage intervention work queue |
| FreshChain Predict | SAP AI Core risk decisions, confidence, deployment, and scoring evidence |
| FreshChain Prove | Audited intervention impact, protected revenue, movement proof, and calculation summary |
| FreshChain Monitor | Cold-zone health, active alerts, and rolling temperature aggregates |
| FreshChain Stock Ledger | Stores, zones, products, batches, sensors, and stock positions |
| FreshChain Stores | Draft-enabled store maintenance |
| FreshChain Areas | Draft-enabled cold-chain area and threshold-band maintenance |
| FreshChain Sensors | Draft-enabled sensor and area assignment maintenance |
| FreshChain Products | Draft-enabled product shelf-life and cold-chain policy maintenance |
| FreshChain Thresholds | Draft-enabled alert threshold maintenance |
| FreshChain Impact Settings | Draft-enabled rescue economics and SLA maintenance |
| FreshChain Ingestion Errors | Draft-enabled ingestion error status and payload maintenance |

In Work Zone, add the HTML5 applications to the desired site/catalog/group according to your tenant's content management process. Use the app titles and semantic objects defined in each app manifest.

Set the managed Work Zone base URL on the CAP service so runtime integration checks and Work Zone dynamic tile navigation are enabled:

```sh
cf set-env freshchain-srv FRESHCHAIN_MANAGED_BASE_URL "https://<work-zone-runtime-host>/site?siteId=<site-id>"
cf restart freshchain-srv
```

For the hackathon tenant, the value is the FreshChain Work Zone site URL. Do not store this as a secret; it is a public runtime URL, but keep tenant-specific values out of reusable templates.

FreshChain's primary Work Zone launchers can expose live KPI values through dynamic tile metadata in the app `manifest.json`. The primary inbound should define `subTitle`, `info`, `icon`, and an `indicatorDataSource` that points at the managed CAP route, for example `DynamicTileKpis('protectedRevenue')`. After uploading the HTML5 app content, sync the HTML5 Apps channel in SAP Build Work Zone Channel Manager and confirm the app's Visualization tab in Content Manager reads `Dynamic Tile`.

For the hackathon site, verify this specific Work Zone composition before a judged demo:

1. Open Content Manager and confirm `FreshChain Command` is a local group with `FreshChain Rescue Cockpit`, `FreshChain Rescue Command Center`, `FreshChain Act`, `FreshChain Predict`, `FreshChain Prove`, and `FreshChain Monitor` assigned.
2. Open the HTML5 Apps item `FreshChain Rescue Command Center` and confirm its Visualization tab reads `Dynamic Tile` with service URL `DynamicTileKpis('protectedRevenue')`.
3. Open the HTML5 Apps item `FreshChain Rescue Cockpit` after the latest HTML5 content upload and provider sync. Confirm the clean `FreshChainRescueCockpit-display` intent is available while the legacy `FreshChainSense-display` intent remains as a compatibility alias for old site tiles.
4. Open the runtime site home page and confirm the first tile shows a live protected-revenue value from CAP/HANA. Do not treat a placeholder or stale value as proof.
5. Confirm the command group shows `FreshChain Rescue Cockpit`, not `FreshChain Sense`. If a local copy is used for compatibility, inspect its CDM payload and make sure the visualization title and target inbound title both say `FreshChain Rescue Cockpit`.
6. If additional KPI tiles for stock at risk, rescue proof, or waste avoided are needed in the first viewport, add them as Work Zone page content/cards only when each tile resolves against the live `DynamicTileKpis` service. Do not add static tiles that imply live proof.

Do not enable fallback business data for demos. The only mocked input should be the live-demo sensor reading payload; persistence, scoring, stock-ledger financials, workflow task proof, cards, tiles, and screenshots must come from the live deployed system. If HANA, AI Core, Work Zone, or another platform dependency fails, fix the live dependency and record the defect instead of masking it.

For UI-only repairs, do not push a single HTML5 app folder to `freshchain-html5-repo-host` unless the intention is to replace the app-host content with only that app. The `cf html5-push ...` flow redeploys the supplied HTML5 application set. To preserve Work Zone launchability, rebuild and push the complete FreshChain `dist` app set or use the MTA HTML5 content module while excluding database deployment. Do not push raw `webapp` folders for the shared app host; the `dist` build includes generated `Component-preload.js` files expected by the managed UI5 runtime.

HTML5-only redeploy check:

```sh
for app in app/freshchain-*; do
  [ -d "$app/webapp" ] || continue
  name=$(basename "$app" | sed 's/freshchain-//; s/-//g')
  rm -rf "$app/dist"
  mkdir -p "$app/dist"
  cp -R "$app/webapp/." "$app/dist/"
  node scripts/zip-html5-app.js "$app/dist" "freshchain${name}.zip"
done

cf html5-push -r \
  app/freshchain-controltower/dist \
  app/freshchain-operations/dist \
  app/freshchain-overview/dist \
  app/freshchain-intelligence/dist \
  app/freshchain-stores/dist \
  app/freshchain-areas/dist \
  app/freshchain-sensors/dist \
  app/freshchain-products/dist \
  app/freshchain-thresholds/dist \
  app/freshchain-impactsettings/dist \
  app/freshchain-ingestionerrors/dist \
  app/freshchain-admin/dist \
  app/freshchain-masterdata/dist \
  app/freshchain-monitoring/dist
```

After the push, open Channel Manager and run `Update content` for the HTML5 Apps provider. The provider sync should finish with status `Updated` before checking Content Manager or runtime target resolution.

Post-upload check:

```sh
cf html5-list
```

Expected FreshChain apps under `freshchain-html5-repo-host`:

- `freshchaincontroltower`
- `freshchainoverview`
- `freshchainoperations`
- `freshchainintelligence`
- `freshchainadmin`
- `freshchainmonitoring`
- `freshchainmasterdata`
- `freshchainstores`
- `freshchainareas`
- `freshchainsensors`
- `freshchainproducts`
- `freshchainthresholds`
- `freshchainimpactsettings`
- `freshchainingestionerrors`

## 14. Validation Checklist

### 14.1 CAP and OData

Find the service route:

```sh
cf app freshchain-srv
```

Open:

```text
https://<freshchain-srv-route>/odata/v4/catalog/$metadata
https://<freshchain-srv-route>/odata/v4/intelligence/$metadata
```

Expected:

- Metadata loads.
- Authentication behavior matches the XSUAA setup.
- `IntelligenceService` exposes `startTraining`, `activateDeployment`, `refreshTrainingRun`, `refreshDeployment`, and `scoreLatest`.

### 14.2 AI Core lifecycle

From FreshChain Intelligence:

1. Confirm at least one dataset exists.
2. Choose Start AI Core Training.
3. Open SAP AI Launchpad and verify a training execution appears.
4. Refresh training status in FreshChain.
5. Activate latest deployment.
6. Verify the deployment in SAP AI Launchpad.
7. Refresh deployment status until online.
8. Score a zone.
9. Confirm inference telemetry shows AI Core reached.

### 14.3 Fail-closed behavior

If AI Core inference is unavailable:

- `scoreLatest` returns an error.
- `InferenceTelemetry` records status `FAILED`.
- `aiCoreUnavailable` is true.
- No synthetic prediction is generated.
- No embedded model server is used.

## 15. Troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| `aicore` service cannot be created | Missing entitlement or wrong plan | Add SAP AI Core entitlement and confirm plan `standard` |
| Launchpad cannot connect to AI Core | Wrong service key values or missing role | Use AI Core service key and assign Launchpad connection role |
| Scenario missing in Launchpad | AI Core assets not registered | Register `ai-core/*.yaml` in resource group `freshchain-demo` |
| Training action fails with missing binding | `freshchain-srv` not bound to AI Core | Confirm `freshchain-ai-core` binding and restage app |
| Deployment has no endpoint | AI Core deployment not online | Check Launchpad deployment logs and image pull status |
| Image pull fails | Registry credentials missing | Configure registry access for SAP AI Core |
| HTML5 apps not visible | Work Zone content not assigned | Add apps to Work Zone site/catalog/group |
| OData route fails | Destination or auth misconfiguration | Validate Destination service and XSUAA bindings |
| HANA-backed reads time out in Work Zone apps | HANA Cloud may be stopped, or HDI/HANA connectivity, pool, binding, or query/runtime may be unhealthy | Treat this as demo-blocking. Do not enable fallback business data. Verify the HANA Cloud instance is running, test app-to-HANA connectivity, recover the live persistence path, and rerun the full Work Zone flow against persisted data. |
| Work Zone cards or dynamic tiles show placeholders, stale values, or fail batch requests | CAP route, Destination, auth, HANA, or Work Zone content sync issue | Fix the live route and recapture screenshots only after cards and tiles resolve from persisted CAP/HANA data. |

### 15.1 Known Live-Demo Defects to Track

The following defects must be recorded when observed and must not be masked with fallback business data:

- HANA/HDI-backed OData reads timing out through `freshchain-srv`. On 2026-06-17 the confirmed root cause was a stopped HANA Cloud instance; after starting `freshchain-hana-free`, app-to-HANA query succeeded and Work Zone managed OData reads returned HTTP 200.
- Work Zone OVP cards or dynamic tiles failing to resolve from live CAP/HANA data.
- AI Core scoring unavailable or returning failed telemetry.
- Workflow/task proof unavailable after a live-demo sensor reading.
- Screenshots or fixed business values captured before the full live persisted path is healthy.

For each item, fix the live dependency, rerun the action path from Work Zone, and only then update demo screenshots or numeric claims.

## 16. Production Handover Checklist

- MTAR deployed successfully.
- AI image built and pushed.
- AI Core scenario and executables registered.
- Launchpad connected to AI Core.
- FreshChain apps available in Work Zone.
- Role collections assigned to administrators, data scientists, store managers, and integration users.
- Training execution visible in Launchpad.
- Deployment online in Launchpad.
- FreshChain scoring creates predictions and recommendations from AI Core output.
- Failed inference telemetry is visible and no synthetic prediction path is active.

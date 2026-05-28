# FreshChain SAP AI Core and AI Launchpad Setup

FreshChain is packaged to run ML lifecycle calls through SAP AI Core. SAP AI Launchpad is the operator console for the same AI Core instance.

## Subaccount Prerequisites

- Cloud Foundry runtime enabled.
- Entitlements assigned for SAP AI Core and SAP AI Launchpad.
- SAP AI Launchpad subscribed in the target subaccount.
- Container image registry available for the FreshChain AI image.

## Deploy Order

1. Build and push the AI image:
   `docker build -t <registry>/freshchain-ai:1.0.0 ml`
2. Replace `${FRESHCHAIN_AI_IMAGE}` in `ai-core/*.yaml` with the pushed image reference.
3. Register the AI Core scenario and executables in the `freshchain-demo` resource group.
4. Build the CAP MTAR with `npm run build:mta`.
5. Deploy with `cf deploy mta_archives/freshchain_0.1.0.mtar`.
6. In SAP AI Launchpad, add a connection to SAP AI Core using the AI Core service key values.
7. Confirm Launchpad shows scenario `freshchain-intelligence`, executable `freshchain-train`, and executable `freshchain-serve`.

## Runtime Configuration

The CAP service reads AI Core credentials from the bound `freshchain-ai-core` service in `VCAP_SERVICES`.

Optional environment overrides:

- `AICORE_RESOURCE_GROUP`, default `freshchain-demo`
- `AICORE_SCENARIO_ID`, default `freshchain-intelligence`
- `AICORE_TRAINING_EXECUTABLE_ID`, default `freshchain-train`
- `AICORE_SERVING_EXECUTABLE_ID`, default `freshchain-serve`

## Operational Flow

1. Seed or ingest FreshChain source data.
2. Start training from the Intelligence app or OData action `startTraining`.
3. Monitor execution logs and status in SAP AI Launchpad.
4. Activate a deployment from a completed training run.
5. Refresh deployment status until it is online.
6. Score zones from FreshChain; CAP calls the active AI Core endpoint and records telemetry.

If AI Core is unavailable, FreshChain records failed telemetry and returns an error. It does not run local inference.

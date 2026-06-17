# FreshChain AI Launchpad Visibility

## Current Setup

- SAP AI Launchpad subscription: `ai-launchpad`, plan `free`
- Launchpad URL: `https://afsug-hackathon.ai-launchpad.prod-eu20.westeurope.azure.ai-prod.cloud.sap`
- AI Core service instance: `ai-core`, plan `extended`
- AI Launchpad connection: `freshchain-ai-core`
- Resource group for FreshChain demo assets: `freshchain-demo`
- Tenant/subaccount: `sandbox-internal` / `afsug-hackathon`

The AI Launchpad connection was created from the `ai-core` service key named
`freshchain-deploy-key`. The full service key file is stored only under
`.auth/freshchain-ai-core-launchpad-service-key.json`, which is gitignored.

## Verified Without Running Compute

To avoid unnecessary AI Core usage, the verification used AI Core management
metadata calls only. It did not create executions, create deployments, train
models, or invoke inference.

Verified result:

- Resource groups visible: `default`, `freshchain-demo`
- FreshChain deployments visible in `freshchain-demo`: `1`
- FreshChain executions visible in `freshchain-demo`: `5`
- Active deployment visible: `d05fb16614590375`, status `RUNNING`

The latest machine-readable check is stored in:

```text
docs/ai-core/launchpad-visibility-check.json
```

## Launchpad Navigation

1. Open SAP AI Launchpad.
2. Sign in through the custom IAS provider `anggbb39i.accounts.ondemand.com`.
3. Open `Workspaces`.
4. Select connection `freshchain-ai-core`.
5. Select resource group `freshchain-demo`.
6. Use `ML Operations` to inspect scenarios, configurations, executions, and deployments.

## Usage Guardrail

Avoid running the CAP demo action repeatedly while testing Launchpad visibility.
For visibility checks, prefer metadata reads against AI Core management APIs:

- `/v2/admin/resourceGroups`
- `/v2/lm/scenarios`
- `/v2/lm/executions`
- `/v2/lm/deployments`

These checks do not trigger model inference or training.

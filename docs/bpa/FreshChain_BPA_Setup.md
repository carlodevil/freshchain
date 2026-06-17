# FreshChain SAP Build Process Automation Setup

FreshChain uses the CAP `@cap-js/process` plugin as the preferred integration
path for SAP Build Process Automation. Tenants that expose a published API
trigger can configure that HTTP trigger explicitly with OAuth client
credentials; FreshChain does not switch integration paths after a failed
ProcessService start.

## Current Tenant State

Checked on 2026-06-15 in tenant:

`https://afsug-hackathon.eu20.process-automation.build.cloud.sap`

- Project: `BPA_NotificationFlow`
- Project id: `eu20.afsug-hackathon.bpanotificationflow`
- Project UID: `7537a6f0-ac96-4ede-9465-55a5dbbb5d3c`
- Package UID: `6b7463d0-41bf-4c9b-b398-953465fcb9a5`
- Process: `FreshChain Spoilage Intervention`
- Process UID: `132ec707-019a-42b0-bafe-c3d192d4824d`
- Process identifier: `freshchainSpoilageIntervention`
- API trigger: `fc-notification-api`
- Trigger UID: `6ab397d2-2976-43db-a8b8-5dcf9e6d5ad5`
- Active deployed package version: `1.0.1`
- Active deployed version UID: `024f6508-f0c5-4ed4-af8e-fd5fdec65ca2`
- Previous released package version: `1.0.0`
- Previous released version UID: `cd77b501-89a5-40d3-a653-eb03cc8c4b37`

The runtime version is now deployed and active. Evidence from the Build runtime
API is stored in:

`docs/demo-journey/bpa-runtime-after-deploy.json`

Additional verification on 2026-06-15 after the project was deployed:

- `freshchain-srv` is running `1/1` in CF.
- The public OData metadata route returns `401`, so real XSUAA auth is still
  enforced.
- `ProcessAutomationAdmin`, `ProcessAutomationDeveloper`,
  `ProcessAutomationExpert`, and `ProcessAutomationParticipant` were assigned
  to the configured store-manager user.
- The bounded CAP hybrid smoke still fails fast with
  `Missing UAA credentials for XSUAA token provider`, which means the deployed
  BPA project is not yet enough for CAP runtime authentication.

The current CF/BTP service catalog still does not expose a bindable
`process-automation` service offering/plan in the `afsug-hackathon` subaccount.
The visible bindable offerings relevant to this area are `build-workzone-standard`,
`one-inbox-service`, and `cias`; attempts to create `process-automation` service
instances with `free`, `standard`, `free-usage`, and `standard-user` all failed
with `service plan ... not found for service offering process-automation`.
CAP hybrid binding cannot be completed until that service-instance plan is
available or equivalent service credentials are provided.

The subaccount is subscribed to the `process-automation` SaaS application, with
subscription URL `https://afsug-hackathon.eu20.build.cloud.sap`. That proves the
Build app is available, but it is not the same as a bindable service instance.
`btp list services/plan` currently shows no `process-automation` plan; only
`build-workzone-standard`, `one-inbox-service`, and `cias` appear in this area.

## Trigger Input Contract

The deployed BPA API trigger input schema now requires exactly these fields:

```json
{
  "criticality": 1,
  "message": "FreshChain detected CRITICAL spoilage risk. Protect the stock now.",
  "user": "<store-manager-email>"
}
```

FreshChain maps those fields from the rescue scenario and also includes the
same values in the richer context payload for auditability.

## CAP Integration

Installed package:

```bash
npm add @cap-js/process
```

FreshChain starts the process through CAP in hybrid/production:

```js
const processService = await cds.connect.to('ProcessService')
await processService.emit('start', {
  definitionId: 'eu20.afsug-hackathon.bpanotificationflow.freshchainSpoilageIntervention',
  context: { criticality, message, user }
})
```

The application only attempts this CAP call when a `ProcessService` binding or
credentials are present, unless `FRESHCHAIN_BPA_USE_CAP_PROCESS=true` is set
explicitly for diagnostics. This keeps the demo from burning cycles on repeated
failed BPA calls while the tenant service binding is unavailable.

Local development should use the hybrid profile for real BTP service calls:

```bash
npx cds bind ProcessService --to <process-automation-service-instance> --for hybrid --on cf
npx cds bind --exec --profile hybrid -- node scripts/smoke-bpa-process-hybrid.js
```

The latest hybrid smoke still fails fast with:

```text
Missing UAA credentials for XSUAA token provider.
```

That means CAP resolved the deployed `ProcessService` kind, but no SAP Build
Process Automation service binding credentials were available. The CAP plugin
expects credentials with an `endpoints.api` value and nested `uaa` client
credentials; the current workspace only has user-login credentials, which should
not be embedded into application code.

Use the bounded readiness check before doing more BPA troubleshooting:

```bash
npm run check:bpa
```

This check does not call AI Core and does not execute a FreshChain rescue
scenario. It only validates deployment evidence, service catalog visibility,
hybrid binding behavior, and CF app health.

## Required Remaining Setup

1. Add/enable the SAP Build Process Automation service plan that supports
   service instances in the `afsug-hackathon` subaccount, or create/download an
   equivalent service key from the BPA service instance if one is provisioned
   outside Cloud Foundry.
2. Create a service instance for SAP Build Process Automation.
3. Bind it to CAP as `ProcessService` for the hybrid profile.
4. Re-run `scripts/smoke-bpa-process-hybrid.js`.
5. Once the smoke returns `START_REQUESTED`, bind the same service instance to
   `freshchain-srv` and redeploy/restage.

## Optional HTTP Trigger

If using the direct API trigger instead of CAP `ProcessService`, set:

```bash
cf set-env freshchain-srv FRESHCHAIN_BPA_TRIGGER_URL "<published-process-api-trigger-url>"
cf set-env freshchain-srv FRESHCHAIN_BPA_PROCESS_ID "eu20.afsug-hackathon.bpanotificationflow.freshchainSpoilageIntervention"
cf set-env freshchain-srv FRESHCHAIN_BPA_TOKEN_URL "<bpa-oauth-token-url>"
cf set-env freshchain-srv FRESHCHAIN_BPA_CLIENT_ID "<client-id>"
cf set-env freshchain-srv FRESHCHAIN_BPA_CLIENT_SECRET "<client-secret>"
cf set-env freshchain-srv FRESHCHAIN_BPA_USER "<store-manager-email>"
cf restage freshchain-srv
```

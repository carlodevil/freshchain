# FreshChain Hackathon Judge Demo Guide

_Last updated: 2026-06-17. Screenshots and demo claims must be based on live persisted system data. The only acceptable mocked input is the live-demo sensor reading payload._

**Presentation readiness rule:** Do not present fixed values from an earlier fallback or continuity run as proof. On 2026-06-17 20:52 UTC, HANA-backed reads were verified live after starting the HANA Cloud instance: `IntegrationStatuses`, `DemoImpactMetrics`, `BusinessImpactSummary`, `RiskByZone`, `CurrentRescueScenarios`, `CurrentProcessTasks`, and `DynamicTileKpis` returned HTTP 200 through the managed Work Zone route. Read every business value from the current live persisted run during rehearsal and replace screenshots only after that live run is verified.

## Prize-Winning Narrative
FreshChain is not a dashboard of ambiguous cold-chain data. The demo shows a concrete store incident progressing from telemetry to AI decision, financial impact, assigned workflow, completed store action, and audit proof.

During the verified live run, capture these values from the deployed Work Zone/CAP/HANA flow:

| Proof Point | Source during demo |
|---|---:|
| Store / zone | Live-demo sensor reading payload persisted through CAP/HANA |
| Product at risk | Rescue result calculated from persisted affected lots |
| Risk decision | SAP AI Core scoring response persisted by CAP |
| Affected lots / units | Live stock-ledger rows in the affected zone |
| Stock value at risk | Live financial calculation from persisted stock and pricing |
| Expected loss | Live financial calculation using AI risk score and confidence |
| Potential protected revenue | Live rescue calculation before proof completion |
| Actual protected revenue after task completion | Live completed workflow/proof record |
| Workflow proof | Live task/proof status for the assigned store role |
| AI action brief mode | Live generated action brief, or visible defect if GenAI is unavailable |

## 6-7 Minute Button-By-Button Flow

### 0:00-0:45 — Open SAP Build Work Zone
![Open SAP Build Work Zone](screenshots/00-workzone-home.png)

**Button/path:** Open SAP Build Work Zone.
**Say:** Start from the real BTP launchpad. Point out that judges are seeing the deployed tenant, not a local mock. If the lead tile shows a business KPI, read the current value directly from the tile and confirm it matches the latest persisted proof. If it does not load, state the live defect.
**Concrete outcome:** FreshChain has role-based entry points for command, monitoring, proof, prediction, and store action. The lead tile is valid proof only when it resolves from the live CAP route against persisted data.

### 0:45-1:20 — Open FreshChain Rescue Command Center
![Open FreshChain Rescue Command Center](screenshots/01-controltower-kpis.png)

**Button/path:** Open FreshChain Rescue Command Center.
**Say:** Show the executive view. Call out protected revenue, risk by zone, active rescue, store task, and BTP readiness as the first business signals.
**Concrete outcome:** This is the command-center view for an operations manager deciding where to intervene.

**Live validation note:** The Work Zone-hosted app must load from the managed HTML5 repository with OVP cards backed by live CAP/HANA reads. If cards fail or time out, keep the failure visible and use the defect log rather than fallback data.

### 1:20-1:45 — Open FreshChain Rescue Cockpit and press Start
![Open FreshChain Rescue Cockpit and press Start](screenshots/03-live-demo-running.png)

**Button/path:** Open FreshChain Rescue Cockpit from the Work Zone tile currently labelled FreshChain Sense, then press Start incident.

**Say:** Press Start. Explain that the demo run is now accepting live events and actions.
**Concrete outcome:** This begins a controlled cold-chain incident run.

### 1:45-2:10 — Press Create Reading
![Press Create Reading](screenshots/04-live-demo-reading.png)

**Button/path:** Press Create Reading.
**Say:** Press Live reading. Show the latest event: store ST001, zone ZN_DAIRY_01, scenario COMPRESSOR_FAILURE.
**Concrete outcome:** A concrete sensor event enters the BTP-backed CAP service.

### 2:10-2:50 — Press Score, then open AI Decision
![Press Score, then open AI Decision](screenshots/05-live-demo-ai-decision.png)

**Button/path:** Press Score, then open AI Decision.
**Say:** Press Score risk. Read the current severity, risk score, confidence, and recommended action from the live SAP AI Core-backed result.
**Concrete outcome:** SAP AI Core scoring turns telemetry into an operational decision. If AI Core cannot score, the app must fail closed and show the real defect.

### 2:50-3:45 — Press Run Rescue, then open Rescue
![Press Run Rescue, then open Rescue](screenshots/06-live-demo-rescue.png)

**Button/path:** Press Build rescue, then read the KPI row and financial calculation panel.
**Say:** Press Build rescue. Explain the business outcome using the current live values for affected lots, affected units, stock at risk, expected loss, and potential protected value. Point out that actual protected revenue is still zero until proof is completed. Then show the estate-impact panel only if it is clearly labelled as a scenario, not persisted chain-wide evidence.

**Concrete outcome:** The app converts AI risk into financial impact and a recommended rescue action.

**Financial proof to explain:** Stock at risk comes from active stock lots in the affected zone priced from the stock ledger. Expected loss is `stock at risk x AI risk score x AI confidence`. Potential protected value is the lower of expected loss and the salvage cap, where the salvage cap is `stock at risk x maintained salvage rate`. Use only the values shown in the current live run. Actual protected revenue becomes non-zero only after the store task is completed with outcome proof.

**Scale proof to explain:** The estate-impact panel is an explicit extrapolation, not hidden persisted data. It may use the proven single-incident value from the current run as an input, but it must be described as a business-case scenario unless estate-level historical incidents are actually persisted.

### 3:45-4:25 — Open Task and press Complete Task
![Open Task and press Complete Task](screenshots/08-live-demo-completed.png)

**Button/path:** Open Operational Proof and press Complete proof.
**Say:** Open Operational Proof, keep the outcome text, and press Complete proof. Show the live workflow status and actual protected revenue from the completed proof record.
**Concrete outcome:** The store action is not a passive chart: it creates a task, captures the outcome, and exposes proof through the live CAP service.

### 4:25-4:55 — Open Integrations
![Open Integrations](screenshots/09-live-demo-integrations.png)

**Button/path:** Open Integrations.
**Say:** Show SAP AI Core, GenAI, Event Mesh, Work Zone, and in-app workflow readiness. Mention anything red/yellow as a live platform dependency, not hidden demo magic.
**Concrete outcome:** Judges can see which BTP services back the flow.

### 4:55-5:35 — Open FreshChain Act
![Open FreshChain Act](screenshots/10-operations.png)

**Button/path:** Open FreshChain Act.
**Say:** Show the operational queue. Explain that this is where store/ops teams work alerts outside the scripted rescue cockpit.
**Concrete outcome:** The solution maps from executive incident to frontline action.

### 5:35-6:10 — Open FreshChain Predict
![Open FreshChain Predict](screenshots/11-intelligence.png)

**Button/path:** Open FreshChain Predict.
**Say:** Show model/deployment/scoring evidence. Explain fail-closed behavior: if AI Core cannot score, FreshChain does not invent predictions.
**Concrete outcome:** The AI story is governed and operational, not just a black-box number.

### 6:10-6:40 — Open FreshChain Prove / Monitor / Ingestion Errors
![Open FreshChain Prove / Monitor / Ingestion Errors](screenshots/12-admin-prove.png)

**Button/path:** Open FreshChain Prove / Monitor / Ingestion Errors.
**Say:** Show audit/proof surfaces, monitoring, and ingestion error handling. Mention replay only if useful error rows are present.
**Concrete outcome:** The demo includes traceability and exception management.

### 6:40-7:00 — Return to Control Tower
![Return to Control Tower](screenshots/01-controltower-kpis.png)

**Button/path:** Return to Control Tower.
**Say:** Close with the real-world result using the current live run values: telemetry became a scored risk decision, then a completed intervention with measured protected value from one store-zone incident.
**Concrete outcome:** FreshChain wins because it turns cold-chain risk into measurable action and proof.


## Presenter Script Notes
- Keep the story anchored to money and waste: “This is 3 chilled product groups in ZN_DAIRY_01, not an abstract data point.”
- Explain the formula before judges ask: stock ledger value, AI risk, AI confidence, maintained salvage rate, lower-of rule.
- Use the phrase “decision to action to proof” repeatedly: event, AI score, rescue scenario, workflow task, completion, protected value.
- When showing SAP AI Core, say that the app fails closed if AI Core cannot score. That is safer than fabricating risk numbers.
- Do not spend time on master data apps. Mention them only as configuration support for stores, products, sensors, thresholds, and impact settings.
- If judges ask whether it is real, point to Work Zone, deployed HTML5 apps, live BTP service bindings, persisted CAP/OData rows, and browser console/network proof. Do not present fallback or in-memory continuity data as a valid solution.
- If a tile label still says `FreshChain Sense`, state plainly that the content item now launches the Rescue Cockpit and the stale label is a Work Zone page metadata issue, not a broken app.

## Defect / Shortcoming Log

| Area | Observed issue | Impact on prize demo | Workaround for panel | Recommended fix |
|---|---|---|---|---|
| Work Zone secondary KPIs | Secondary KPI tiles for stock at risk, rescue proof, and waste avoided are not yet published as first-row dynamic tiles. The protected-revenue tile is valid only when its current value resolves from the live CAP dynamic tile endpoint backed by persisted data. | The first impression may not show the full operational story before opening apps. | Start with any live-resolving dynamic tile, then open Control Tower for the full KPI set. If a tile does not resolve, show it as a defect. | Rebuild the Work Zone page with additional dynamic KPI tiles or cards for stock at risk, live rescue proof, and waste avoided. |
| Work Zone app naming | Content Manager now has a local `FreshChain Rescue Cockpit` app assigned to the `FreshChain Command` group and `Everyone` role, but the runtime home page still paints the old `FreshChain Sense` label until the site page/cache is refreshed. The tile launches the correct local app ID. | Judges may not immediately know this is the main live-action demo app. | Verbally introduce the stale-labelled tile as the Rescue Cockpit; the opened app title and runtime content are correct. | Republish/refresh the Work Zone site page so the home tile metadata catches up with the local content item. |
| HANA-backed reads | Resolved on 2026-06-17 20:52 UTC. Root cause was the HANA Cloud instance being stopped; app-to-HANA client test returned `HANA Database instance is stopped`. After starting `freshchain-hana-free`, app-to-HANA query succeeded and all key live-demo OData entities returned HTTP 200 through Work Zone. | No longer blocks the demo while HANA remains running. If HANA auto-stops again, cards and actions will fail honestly instead of using fallback data. | Before the panel, confirm `IntegrationStatuses` says `SAP HANA persistence: READY` and `DynamicTileKpis` returns HTTP 200. | Keep HANA Cloud running for the demo window and monitor the dashboard/CLI status. |
| Business value scale | The cockpit can show a single-incident proof plus a labelled extrapolation. The extrapolation is directional, not persisted chain-wide evidence. | Judges can understand upside, but may ask what is real versus assumed. | State the current single-incident proof value from the live run, then label any annualized or multi-store panel as a business-case scenario. | Later, populate estate-level KPIs from multi-store historical incidents instead of a demo assumption. |
| HTML5 app-host content | On 2026-06-17, the app-host was restored by pushing the full FreshChain HTML5 app set. `cf html5-list` showed all deployable apps under `freshchain-html5-repo-host` after the repair. | A partial app-host upload can make apps 404 even though tiles still appear. | Use the current live tenant only after Control Tower, Rescue Cockpit, Act, Predict, Prove, and Monitor load from Work Zone without fallback data. | When doing UI-only deployments, push the complete HTML5 app set or use the MTA content module without redeploying the DB module. |
| Operations/Prove depth | Operations, Prove, Monitoring, and Ingestion Errors show useful Fiori surfaces, but the strongest story is still in the Live Demo cockpit. | Secondary apps can feel like supporting lists rather than dramatic action screens. | Keep these screens short and only use them as traceability proof. | Add clearer default filters, object titles, and value-focused columns for panel-ready screenshots. |
| Screenshots and fixed values | Existing screenshots and fixed numeric values may have been captured during fallback or while HANA reads were unhealthy. | They are not valid presentation proof until recaptured from a live persisted run. | Do not present stale screenshots or fixed numbers as proof. Use live browser/network evidence or mark the item as unresolved. | Rerun Start, Create Reading, Score, Build Rescue, Complete Proof, dynamic tile, and BusinessImpactSummary through Work Zone, then recapture screenshots and update this guide with the observed live values. |
| Headless Work Zone screenshots | Work Zone loads the Rescue Cockpit iframe and app resources, but headless screenshots can intermittently paint only the iframe header while the DOM and app text are present. | Presentation screenshots of detailed cockpit steps may miss Work Zone chrome. | For the panel, open the cockpit manually from Work Zone; use screenshots only after the data is verified live. | Use native browser screenshots or the direct managed HTML5 app URL for detailed cockpit captures, with clear evidence that backend actions used live persisted data. |

## Capture Notes
- Work Zone screenshot was captured from: https://afsug-hackathon.launchpad.cfapps.eu20.hana.ondemand.com/site?siteId=97d11aec-866b-4a20-8f25-695b8927576e#Shell-home after syncing the HTML5 Apps channel. Treat any displayed KPI as presentation proof only after the current value is verified against live persisted CAP/HANA data.
- Control Tower live data was revalidated on 2026-06-17 20:52 UTC after starting HANA Cloud. A fresh screenshot was captured at `test-results/fiori-live-validation/controltower-after-hana-start.png`; recapture presentation screenshots from the same live route if you need polished slide assets.
- Work Zone launch paths should be revalidated on the live tenant before the panel: FreshChain Rescue Command Center, FreshChain Rescue Cockpit, FreshChain Act, FreshChain Predict, FreshChain Prove, and FreshChain Monitor.
- Control Tower BTP Readiness may show `SAP Build Work Zone dynamic tiles` as `READY` after setting `FRESHCHAIN_MANAGED_BASE_URL` on `freshchain-srv` and restarting the app, but readiness status is not a substitute for live business-data proof.
- Content Manager showed the Control Tower visualization as `Dynamic Tile` after the HTML5 Apps provider sync. The tile preview may show a placeholder while the runtime Work Zone page resolves the live KPI value.
- Fallback mode is no longer an acceptable demo path. Validate Start, Create Reading, Score, Build Rescue, Complete Proof, dynamic tile, and BusinessImpactSummary through the managed Work Zone route only when those calls are backed by persisted live system data.
- Detailed Rescue Cockpit action screenshots must be recaptured from the managed Work Zone route or direct managed HTML5 app URL only after the backend actions are verified against live persisted data.
- Do not commit or present auth files, service keys, or the temporary local proxy. Only the screenshots and this guide are intended presentation artifacts.

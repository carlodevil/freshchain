# FreshChain Hackathon Judge Demo Guide

_Last updated: 2026-06-17. Screenshots were refreshed after deploying the redesigned Rescue Cockpit to live SAP BTP._

## Prize-Winning Narrative
FreshChain is not a dashboard of ambiguous cold-chain data. The demo shows a concrete store incident progressing from telemetry to AI decision, financial impact, assigned workflow, completed store action, and audit proof.

In the captured live run:

| Proof Point | Live Value |
|---|---:|
| Store / zone | ST001 / ZN_DAIRY_01 |
| Product at risk | 3 chilled product groups |
| Risk decision | CRITICAL risk, score 1.000, confidence 0.776 |
| Affected lots / units | 3 lots / 90.000 units |
| Stock value at risk | R 5 899 |
| Expected loss | R 4 532 |
| Potential protected revenue | R 4 532 |
| Actual protected revenue after task completion | R 4 532 |
| Workflow proof | COMPLETED task for store.manager |
| AI action brief mode | SAP AI Core Generative AI Hub |

## 6-7 Minute Button-By-Button Flow

### 0:00-0:45 — Open SAP Build Work Zone
![Open SAP Build Work Zone](screenshots/00-workzone-home.png)

**Button/path:** Open SAP Build Work Zone.  
**Say:** Start from the real BTP launchpad. Point out that judges are seeing the deployed tenant, not a local mock.  
**Concrete outcome:** FreshChain has role-based entry points for command, monitoring, proof, prediction, and store action.

### 0:45-1:20 — Open FreshChain Rescue Command Center
![Open FreshChain Rescue Command Center](screenshots/01-controltower-kpis.png)

**Button/path:** Open FreshChain Rescue Command Center.  
**Say:** Show the executive view. Call out protected revenue, risk by zone, active rescue, store task, and BTP readiness as the first business signals.  
**Concrete outcome:** This is the command-center view for an operations manager deciding where to intervene.

### 1:20-1:45 — Open FreshChain Sense / Rescue Cockpit and press Start
![Open FreshChain Sense / Live Demo and press Start](screenshots/03-live-demo-running.png)

**Button/path:** Open FreshChain Sense / Rescue Cockpit and press Start.  
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
**Say:** Press Score risk. Explain the result: CRITICAL risk, score 1.000, confidence 0.776, action "Urgent removal of 3 chilled product groups".  
**Concrete outcome:** SAP AI Core scoring turns telemetry into an operational decision.

### 2:50-3:45 — Press Run Rescue, then open Rescue
![Press Run Rescue, then open Rescue](screenshots/06-live-demo-rescue.png)

**Button/path:** Press Build rescue, then read the KPI row and financial calculation panel.  
**Say:** Press Build rescue. Explain the business outcome: 3 affected lots, 90.000 units, R 5 899 stock at risk, R 4 532 expected loss, and R 4 532 protected value if the store action is completed.  
**Concrete outcome:** The app converts AI risk into financial impact and a recommended rescue action.

**Financial proof to explain:** Stock at risk comes from active stock lots in the affected zone priced from the stock ledger. Expected loss is `stock at risk x AI risk score x AI confidence`. Protected value is the lower of expected loss and the salvage cap, where the salvage cap is `stock at risk x maintained salvage rate`. In this run: `R 5 899 x 100% x 77.6% = R 4 532`; the 82% salvage cap is higher, so protected value is R 4 532.

### 3:45-4:25 — Open Task and press Complete Task
![Open Task and press Complete Task](screenshots/08-live-demo-completed.png)

**Button/path:** Open Operational Proof and press Complete proof.  
**Say:** Open Operational Proof, keep the outcome text, and press Complete proof. Show workflow status COMPLETED and actual protected revenue R 4 532.  
**Concrete outcome:** The store action is not a passive chart: it creates a task, captures the outcome, and persists proof.

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
**Say:** Close with the real-world result: telemetry became a CRITICAL risk decision, then a completed intervention protecting about R 4 532 of stock/revenue from one store-zone incident.  
**Concrete outcome:** FreshChain wins because it turns cold-chain risk into measurable action and proof.


## Presenter Script Notes
- Keep the story anchored to money and waste: “This is 3 chilled product groups in ZN_DAIRY_01, not an abstract data point.”
- Explain the formula before judges ask: stock ledger value, AI risk, AI confidence, maintained salvage rate, lower-of rule.
- Use the phrase “decision to action to proof” repeatedly: event, AI score, rescue scenario, workflow task, completion, protected value.
- When showing SAP AI Core, say that the app fails closed if AI Core cannot score. That is safer than fabricating risk numbers.
- Do not spend time on master data apps. Mention them only as configuration support for stores, products, sensors, thresholds, and impact settings.
- If judges ask whether it is real, point to Work Zone, deployed HTML5 apps, live BTP service bindings, and the persisted CAP evidence in the screenshots.

## Defect / Shortcoming Log

| Area | Observed issue | Impact on prize demo | Workaround for panel | Recommended fix |
|---|---|---|---|---|
| Work Zone first impression | Work Zone launches and shows FreshChain apps, but tiles are mostly static/blank and do not show dynamic KPI numbers. | The first screen proves BTP deployment, but does not itself communicate business value. | Spend less than a minute on Work Zone, then open Control Tower and Live Demo for value proof. | Configure Work Zone dynamic tiles/cards for protected revenue, stock at risk, rescue proof, and waste avoided. |
| Work Zone app naming | The live demo shell still appears as `FreshChain Sense` in Work Zone even though the deployed app title is now `FreshChain Rescue Cockpit`. | Judges may not immediately know this is the main live-action demo app. | Verbally introduce it as “FreshChain Sense, our Rescue Cockpit.” | Sync/update Work Zone content so the tile and shell title read `FreshChain Rescue Cockpit`. |
| Business value scale | The captured run proves the flow with about R 4,532 protected value. This is concrete, but modest for an executive hackathon story. | Judges may see the impact as operationally valid but not transformative enough. | Frame it as one store-zone incident and extrapolate across stores, days, and categories. | Add an executive annualized/same-day rollup KPI for multi-store avoided waste and margin protection. |
| Operations/Prove depth | Operations, Prove, Monitoring, and Ingestion Errors show useful Fiori surfaces, but the strongest story is still in the Live Demo cockpit. | Secondary apps can feel like supporting lists rather than dramatic action screens. | Keep these screens short and only use them as traceability proof. | Add clearer default filters, object titles, and value-focused columns for panel-ready screenshots. |
| Headless Work Zone screenshots | Work Zone loads the Rescue Cockpit iframe and app resources, but headless screenshots intermittently paint only the iframe header while the DOM and app text are present. | Presentation screenshots of detailed cockpit steps are captured from a temporary shell instead of Work Zone chrome. | For the panel, open the cockpit manually from Work Zone; the app itself loads and actions are live. | Validate final manual browser run and, if needed, use native browser screenshots instead of headless capture. |

## Capture Notes
- Work Zone screenshot was captured from: https://afsug-hackathon.launchpad.cfapps.eu20.hana.ondemand.com/site?siteId=97d11aec-866b-4a20-8f25-695b8927576e#Shell-home
- Control Tower screenshot was captured from Work Zone.
- Detailed Rescue Cockpit action screenshots were captured through a temporary local UI shell that proxied OData/actions to the live BTP `freshchain-srv`. This avoided a headless Work Zone iframe screenshot-painting issue; the backend actions and data are live BTP outcomes.
- Do not commit or present auth files, service keys, or the temporary local proxy. Only the screenshots and this guide are intended presentation artifacts.

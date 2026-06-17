# FreshChain Lessons Learned

This file captures durable project lessons that future agents must check before changing the repo, deploying, validating SAP BTP, or preparing the hackathon demo. Keep entries concise, factual, dated, and free of secrets.

## 2026-06-17

- Always read browser console and network failures before assuming SAP BTP or Work Zone configuration is wrong. The Control Tower launch failure showed real app/service errors: UI5 component creation failed because OData metadata and service calls were returning errors.
- Work Zone shell deprecation warnings are noisy but are not automatically the root cause. Prioritize concrete app failures such as `Component.create() failed`, OData `$metadata` failures, non-2xx service responses, and CAP/backend logs.
- The major live outage was HANA Cloud being stopped even though the Cloud Foundry service instance still appeared ready. The decisive check was a live `@sap/hana-client` connection from inside `freshchain-srv`, which returned `HANA Database instance is stopped`.
- Starting HANA Cloud through `cf update-service freshchain-hana-free -c '{"data":{"serviceStopped":false}}'` creates a broker operation. A portal error saying a provision/update operation is already in progress is expected while that operation is running; poll the service instead of starting another operation.
- Validate HANA health through the deployed app binding, not only through cockpit status. A successful TCP connection to the HANA host does not prove SQL connectivity or running database state.
- Do not redeploy the database unless explicitly required. For service/runtime fixes, use `npx cds build --production` and rolling `cf push freshchain-srv -p gen/srv ...`; for schema changes, use the CAP db deployer delta behavior instead of destructive redeploys.
- Do not partial-push a single HTML5 app into the shared app-host unless intentionally replacing the full hosted set. Prior HTML5 recovery required pushing the complete app set so Work Zone routes could resolve all apps consistently.
- Job Scheduler was still calling the old live-reading action with an invalid audience token. The demo direction is app-triggered actions, so the live Job Scheduler service was deleted instead of masking the 401s.
- Demo proof must be live after the initial sensor payload: HANA persistence, scoring, financial calculation, workflow/task proof, integration status, cards, tiles, and screenshots. If any of these are unavailable, log and fix the defect instead of using fallback or fabricated proof.
- Send ntfy milestone updates to `carlodevelopmentwork` with title `FreshChain` only for major milestones such as deploy validated, root cause found, commit pushed, or goal complete/blocked. Avoid routine status notifications.

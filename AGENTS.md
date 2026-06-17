# FreshChain Agent Instructions

- Read `LESSONSLEARNED.md` before making repository, deployment, Work Zone, or demo-flow changes.
- Keep `LESSONSLEARNED.md` current as work progresses. Add concise, dated lessons when a live-system finding, root cause, validation pattern, deployment constraint, or demo-risk decision would prevent repeated mistakes.
- Treat `LESSONSLEARNED.md` as operational guidance, not a scratchpad. Do not put secrets, transient tokens, generated logs, or unrelated notes in it.
- NEVER use fallback business data, in-memory demo continuity data, or fabricated platform proof.
- Always depend on live system data from the deployed CAP services, SAP HANA persistence, configured SAP BTP services, and Work Zone runtime.
- The only acceptable mocked input is the actual live-demo sensor reading payload used to trigger the business flow.
- Everything after that reading must be produced by the live system: persistence, scoring, financial calculation, workflow/task proof, integration status, cards, tiles, and screenshots.
- If live system data or a platform dependency is unavailable, surface the real defect and fix it. Do not mask it with fallback behavior.

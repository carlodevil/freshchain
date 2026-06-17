# FreshChain Agent Instructions

- NEVER use fallback business data, in-memory demo continuity data, or fabricated platform proof.
- Always depend on live system data from the deployed CAP services, SAP HANA persistence, configured SAP BTP services, and Work Zone runtime.
- The only acceptable mocked input is the actual live-demo sensor reading payload used to trigger the business flow.
- Everything after that reading must be produced by the live system: persistence, scoring, financial calculation, workflow/task proof, integration status, cards, tiles, and screenshots.
- If live system data or a platform dependency is unavailable, surface the real defect and fix it. Do not mask it with fallback behavior.

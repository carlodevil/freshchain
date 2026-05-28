# Smart FreshChain CAP Demo Slice

This project implements the CAP part of FreshChain:

- simulator -> HTTP ingestion
- CDS persistence for stores, zones, sensors, products, batches, readings, aggregates, predictions, alerts and actions
- deterministic rule alerts with SAP AI Core model scoring for ML output
- OData V4 services for a small browser UI and Fiori Elements-ready consumption
- local SQLite profile plus Cloud Foundry/HANA/XSUAA deployment descriptors

## Local Run

```sh
npm install
npm run deploy:sqlite
npm test
npm start
```

In another shell:

```sh
npm run simulator -- --scenario door-left-open --ticks 4 --interval-ms 1000
```

Open:

- http://localhost:4004/freshchain-ui/
- http://localhost:4004/odata/v4/catalog/Alerts
- http://localhost:4004/odata/v4/analytics/ZoneStatus

## Deployment Outline

1. Refresh SAP BTP and CF CLI login.
2. Create or reuse HANA HDI and XSUAA services from `mta.yaml`.
3. Build with `npm run build:mta`.
4. Deploy with `npm run deploy:cf`.
5. Run the simulator against the deployed CAP URL:

```sh
npm run simulator -- --target https://<srv-route>/ingest/sensor-readings --scenario compressor-failure --ticks 5
```

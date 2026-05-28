using freshchain as db from '../db/schema';

service AnalyticsService @(path: '/odata/v4/analytics') {
  entity ZoneStatus as select from db.Zones {
    key ID,
    zoneCode,
    name,
    type,
    store.ID as store_ID,
    store.storeCode as storeCode,
    safeTempMinC,
    safeTempMaxC,
    active
  };
  entity ActiveAlerts as select from db.Alerts {
    key ID,
    severity,
    status,
    alertType,
    title,
    evidenceWindow,
    recommendation,
    source,
    assignedTo,
    createdAt,
    store.ID as store_ID,
    zone.ID as zone_ID,
    zone.zoneCode as zoneCode
  };
  entity ReadingAggregates as select from db.ReadingAggregates {
    key ID,
    windowStart,
    windowEnd,
    windowSizeMinutes,
    tempAvg,
    tempMax,
    humidityAvg,
    doorOpenSeconds,
    excursionMinutes,
    readingCount,
    store.ID as store_ID,
    zone.ID as zone_ID,
    zone.zoneCode as zoneCode
  };
  action getDashboardSummary() returns String;
}

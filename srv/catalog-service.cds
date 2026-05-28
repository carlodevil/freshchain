using freshchain as db from '../db/schema';

service CatalogService @(path: '/odata/v4/catalog') {
  entity Stores as projection on db.Stores;
  entity Zones as projection on db.Zones;
  entity Sensors as projection on db.Sensors;
  entity Products as projection on db.Products;
  entity Batches as projection on db.Batches;
  entity InventoryPlacements as projection on db.InventoryPlacements;
  entity SensorReadings as projection on db.SensorReadings;
  entity ReadingAggregates as projection on db.ReadingAggregates;
  entity Predictions as projection on db.Predictions;
  entity Alerts as projection on db.Alerts actions {
    action acknowledge(comment: String) returns Alerts;
    action assign(userId: String, comment: String) returns Alerts;
    action resolve(outcome: String, comment: String) returns Alerts;
    action reopen(comment: String) returns Alerts;
    action addNote(comment: String) returns Alerts;
  };
  entity AlertActions as projection on db.AlertActions;
  action triggerManualRiskEvaluation(zoneId: UUID) returns Alerts;
}

using freshchain as db from '../db/schema';

@requires: 'authenticated-user'
service CatalogService @(path: '/odata/v4/catalog') {
  entity Stores as projection on db.Stores;
  entity Zones as projection on db.Zones;
  entity Sensors as projection on db.Sensors;
  entity Products as projection on db.Products;
  entity Batches as projection on db.Batches;
  entity InventoryPlacements as projection on db.InventoryPlacements;
  @readonly
  entity StockLots as select from db.StockLots {
    *,
    product.sku as productSku,
    product.name as productName,
    store.storeCode as storeCode,
    zone.zoneCode as zoneCode,
    zone.type as zoneType
  };
  @readonly
  entity StockMovements as select from db.StockMovements {
    *,
    stockLot.lotNumber as lotNumber,
    product.sku as productSku,
    product.name as productName,
    store.storeCode as storeCode,
    fromZone.zoneCode as fromZoneCode,
    toZone.zoneCode as toZoneCode
  };
  entity InterventionImpacts as projection on db.InterventionImpacts;
  @readonly
  @cds.persistence.skip
  entity ZoneOccupancy {
    key ID               : UUID;
    storeCode            : String(20);
    zoneCode             : String(40);
    zoneType             : String(40);
    lotCount             : Integer;
    unitsOnHand          : Decimal(12,3);
    stockValueZar        : Decimal(15,2);
    oldestBestBeforeDate : Date;
    criticality          : Integer;
  }
  @restrict: [
    { grant: ['READ', 'CREATE'], to: 'authenticated-user' }
  ]
  @Capabilities.UpdateRestrictions.Updatable: false
  @Capabilities.DeleteRestrictions.Deletable: false
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
  action receiveStock(productId: UUID, batchId: UUID, zoneId: UUID, quantity: Decimal(12,3), unitCostZar: Decimal(12,2), sellingPriceZar: Decimal(12,2), bestBeforeDate: Date, lotNumber: String, referenceDocument: String) returns StockLots;
  action moveStock(stockLotId: UUID, toZoneId: UUID, quantity: Decimal(12,3), reasonCode: String) returns StockLots;
  action applyMarkdown(stockLotId: UUID, sellingPriceZar: Decimal(12,2), reasonCode: String) returns StockLots;
  action writeOffStock(stockLotId: UUID, quantity: Decimal(12,3), reasonCode: String) returns StockLots;
}

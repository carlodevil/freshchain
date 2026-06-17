using freshchain as db from '../db/schema';

@requires: 'authenticated-user'
service ConfigurationService @(path: '/odata/v4/configuration') {
  @odata.draft.enabled
  entity Stores as projection on db.Stores excluding { zones };

  @odata.draft.enabled
  entity Zones as projection on db.Zones excluding { sensors };

  @odata.draft.enabled
  entity Sensors as projection on db.Sensors;

  @odata.draft.enabled
  entity Products as projection on db.Products;

  @odata.draft.enabled
  entity ThresholdConfigs as projection on db.ThresholdConfigs;

  @odata.draft.enabled
  entity ImpactSettings as projection on db.ImpactSettings;

  @odata.draft.enabled
  entity IngestionErrors as projection on db.IngestionErrors;
}

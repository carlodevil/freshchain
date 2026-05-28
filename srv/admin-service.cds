using freshchain as db from '../db/schema';

service AdminService @(path: '/odata/v4/admin') {
  entity ThresholdConfigs as projection on db.ThresholdConfigs;
  entity IngestionErrors as projection on db.IngestionErrors;
  action replayIngestionError(errorId: UUID) returns String;
}

using freshchain as db from '../db/schema';

@requires: 'authenticated-user'
service AdminService @(path: '/odata/v4/admin') {
  type ReplayIngestionResult {
    status    : String(40);
    reason    : String(240);
    messageId : String(80);
  }

  entity ThresholdConfigs as projection on db.ThresholdConfigs;
  entity ImpactSettings as projection on db.ImpactSettings;
  entity IngestionErrors as projection on db.IngestionErrors;
  action replayIngestionError(errorId: UUID) returns ReplayIngestionResult;
}

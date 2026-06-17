using freshchain as db from '../db/schema';

@protocol: 'none'
service IngestionService {
  type IngestSensorReadingResult {
    ok          : Boolean;
    duplicate   : Boolean;
    messageId    : String(80);
    readingId    : UUID;
    alertId      : UUID;
    severity     : db.Severity;
    riskLevel    : db.RiskLevel;
  }

  action ingestSensorReading(payload: LargeString) returns IngestSensorReadingResult;
}

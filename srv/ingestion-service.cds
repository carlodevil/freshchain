using freshchain as db from '../db/schema';

@protocol: 'none'
service IngestionService {
  action ingestSensorReading(payload: LargeString) returns String;
}

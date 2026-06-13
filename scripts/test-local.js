const CAP_URL = process.env.FRESHCHAIN_CAP_URL || 'http://localhost:4004';
const MODEL_URL = process.env.FRESHCHAIN_MODEL_HEALTH_URL || 'http://localhost:9000/v2/health';

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_error) {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const health = await request(MODEL_URL);
  console.log(`Model ready: ${health.models.length} models`);

  const seeded = await request(`${CAP_URL}/odata/v4/intelligence/seedDemoData`, {
    method: 'POST',
    body: JSON.stringify({ days: 14, stores: 2, anomalyRate: 0.1 })
  });
  console.log(`Seeded: ${seeded.value}`);

  const zones = await request(`${CAP_URL}/odata/v4/catalog/Zones?$top=1`);
  const zoneId = zones.value && zones.value[0] && zones.value[0].ID;
  if (!zoneId) throw new Error('No zone was returned after seeding');
  console.log(`Zone ID: ${zoneId}`);

  const prediction = await request(`${CAP_URL}/odata/v4/intelligence/scoreLatest`, {
    method: 'POST',
    body: JSON.stringify({ zoneId })
  });
  console.log(JSON.stringify({
    deploymentId: prediction.deploymentId,
    predictionType: prediction.predictionType,
    riskLevel: prediction.riskLevel,
    score: prediction.score,
    confidence: prediction.confidence,
    anomalyType: prediction.anomalyType,
    remainingShelfLifeDays: prediction.remainingShelfLifeDays,
    demandUnitsForecast: prediction.demandUnitsForecast,
    replenishmentUnits: prediction.replenishmentUnits,
    routePriority: prediction.routePriority,
    recommendedAction: prediction.recommendedAction
  }, null, 2));

  if (prediction.deploymentId !== 'freshchain-local') {
    throw new Error(`Expected deploymentId freshchain-local, received ${prediction.deploymentId || 'none'}. Restart CAP with npm run start:local.`);
  }
}

main().catch(error => {
  console.error(`Local integration test failed: ${error.message}`);
  process.exitCode = 1;
});

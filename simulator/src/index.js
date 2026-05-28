#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const YAML = require('yaml');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function loadConfig() {
  const file = arg('config', path.join(__dirname, '..', 'config.yaml'));
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

function jitter(value, amount) {
  return Math.round((value + (Math.random() * amount * 2 - amount)) * 10) / 10;
}

function scenarioReading(zone, scenario, tick) {
  const base = {
    temperatureC: jitter(zone.baseTemperatureC, 0.4),
    humidityPct: jitter(zone.baseHumidityPct, 2),
    co2Ppm: jitter(780, 40),
    oxygenPct: jitter(20.7, 0.1),
    lightLux: jitter(95, 20),
    doorOpen: false
  };

  if (scenario === 'door-left-open' && tick >= 1) {
    base.doorOpen = true;
    base.temperatureC = jitter(zone.baseTemperatureC + tick * 1.4, 0.3);
    base.lightLux = jitter(350, 50);
  }
  if (scenario === 'repeated-door-openings') {
    base.doorOpen = tick % 2 === 0;
    base.temperatureC = jitter(zone.baseTemperatureC + (base.doorOpen ? 2.4 : 0.8), 0.3);
  }
  if (scenario === 'compressor-failure' && tick >= 1) {
    base.temperatureC = jitter(zone.baseTemperatureC + tick * 3.3, 0.4);
    base.co2Ppm = jitter(980 + tick * 60, 20);
  }
  if (scenario === 'defrost') {
    base.temperatureC = jitter(zone.baseTemperatureC + 2.0, 0.4);
    base.humidityPct = jitter(zone.baseHumidityPct + 8, 2);
  }
  if (scenario === 'sensor-drift') {
    base.temperatureC = jitter(zone.baseTemperatureC + tick * 0.7, 0.2);
  }
  if (scenario === 'noisy-sensor') {
    base.temperatureC = jitter(zone.baseTemperatureC, 3.5);
    base.humidityPct = jitter(zone.baseHumidityPct, 12);
  }

  return base;
}

function payload(config, zone, scenario, tick) {
  const now = new Date(Date.now() + tick * 60000).toISOString();
  const scenarioCode = scenario.toUpperCase().replace(/-/g, '_');
  return {
    schemaVersion: '1.0',
    messageId: randomUUID(),
    correlationId: `${config.storeId}-${zone.zoneId}-${now}`,
    eventType: 'SensorReadingCreated',
    storeId: config.storeId,
    zoneId: zone.zoneId,
    sensorId: zone.sensorId,
    measuredAt: now,
    publishedAt: now,
    readings: scenarioReading(zone, scenario, tick),
    quality: {
      batteryPct: 98,
      signalStrength: -48,
      sensorHealth: 'OK'
    },
    scenarioCode
  };
}

async function post(url, body) {
  const token = process.env.FRESHCHAIN_BEARER_TOKEN;
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return text;
}

async function main() {
  const config = loadConfig();
  const target = arg('target', config.target);
  const scenario = arg('scenario', 'normal');
  const ticks = Number(arg('ticks', '5'));
  const intervalMs = Number(arg('interval-ms', config.intervalMs || 60000));
  const zones = arg('zone') ? config.zones.filter(z => z.zoneId === arg('zone')) : config.zones;

  for (let tick = 0; tick < ticks; tick += 1) {
    for (const zone of zones) {
      if (scenario === 'missing-reading' && tick > 0) continue;
      const body = payload(config, zone, scenario, tick);
      const result = await post(target, body);
      console.log(`${body.zoneId} ${body.scenarioCode} ${body.messageId} ${result}`);
    }
    if (tick < ticks - 1) await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});

const DEFAULT_RESOURCE_GROUP = 'freshchain-demo';
const DEFAULT_SCENARIO = 'freshchain-intelligence';
const DEFAULT_TRAIN_EXECUTABLE = 'freshchain-train';
const DEFAULT_SERVE_EXECUTABLE = 'freshchain-serve';

class AiCoreError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'AiCoreError';
    this.statusCode = meta.statusCode || 502;
    this.aiCore = meta;
  }
}

function normalizeUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function findAiCoreCredentials() {
  const services = parseJson(process.env.VCAP_SERVICES || '{}', {});
  const candidates = Object.values(services).flat().filter(service => {
    const label = service.label || service.name || service.tags && service.tags.join(' ');
    return /aicore|ai-core|SAP AI Core/i.test(label || '');
  });
  const service = candidates[0];
  if (!service || !service.credentials) {
    throw new AiCoreError('SAP AI Core service binding was not found in VCAP_SERVICES', { statusCode: 503 });
  }
  return service.credentials;
}

function aiCoreConfig() {
  const credentials = findAiCoreCredentials();
  const uaa = credentials.uaa || credentials.oauth || {};
  return {
    apiUrl: normalizeUrl(firstValue(credentials.AI_API_URL, credentials.ai_api_url, credentials.apiurl, credentials.url)),
    tokenUrl: firstValue(
      credentials.tokenurl,
      credentials.tokenUrl,
      uaa.url && `${normalizeUrl(uaa.url)}/oauth/token`,
      credentials.url && /oauth/.test(credentials.url) ? credentials.url : null
    ),
    clientId: firstValue(credentials.clientid, credentials.clientId, uaa.clientid, uaa.clientId),
    clientSecret: firstValue(credentials.clientsecret, credentials.clientSecret, uaa.clientsecret, uaa.clientSecret),
    resourceGroup: process.env.AICORE_RESOURCE_GROUP || DEFAULT_RESOURCE_GROUP,
    scenarioId: process.env.AICORE_SCENARIO_ID || DEFAULT_SCENARIO,
    trainingExecutableId: process.env.AICORE_TRAINING_EXECUTABLE_ID || DEFAULT_TRAIN_EXECUTABLE,
    servingExecutableId: process.env.AICORE_SERVING_EXECUTABLE_ID || DEFAULT_SERVE_EXECUTABLE
  };
}

function statusOf(payload, fallback = 'RUNNING') {
  const value = firstValue(payload.status, payload.targetStatus, payload.executionStatus, payload.deploymentStatus);
  return String(value || fallback).toUpperCase();
}

function executionIdOf(payload) {
  return firstValue(payload.id, payload.executionId, payload.execution_id, payload.name);
}

function deploymentIdOf(payload) {
  return firstValue(payload.id, payload.deploymentId, payload.deployment_id, payload.name);
}

function deploymentUrlOf(payload) {
  return firstValue(payload.deploymentUrl, payload.deploymentURL, payload.url, payload.endpoint, payload.endpointUrl);
}

class AiCoreClient {
  constructor(config = aiCoreConfig()) {
    this.config = config;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60000) {
      return this.token;
    }
    if (!this.config.tokenUrl || !this.config.clientId || !this.config.clientSecret) {
      throw new AiCoreError('SAP AI Core OAuth credentials are incomplete', { statusCode: 503 });
    }
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    });
    const text = await response.text();
    if (!response.ok) {
      throw new AiCoreError(`SAP AI Core token request failed with HTTP ${response.status}`, {
        statusCode: 503,
        response: text.slice(0, 500)
      });
    }
    const payload = parseJson(text, {});
    this.token = payload.access_token;
    this.tokenExpiresAt = Date.now() + Number(payload.expires_in || 300) * 1000;
    if (!this.token) {
      throw new AiCoreError('SAP AI Core token response did not contain an access token', { statusCode: 503 });
    }
    return this.token;
  }

  async request(path, options = {}) {
    if (!this.config.apiUrl) {
      throw new AiCoreError('SAP AI Core API URL is not configured', { statusCode: 503 });
    }
    const token = await this.accessToken();
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'AI-Resource-Group': this.config.resourceGroup,
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    const payload = text ? parseJson(text, { raw: text }) : {};
    if (!response.ok) {
      throw new AiCoreError(`SAP AI Core API request failed with HTTP ${response.status}`, {
        statusCode: response.status,
        path,
        response: text.slice(0, 1000)
      });
    }
    return payload;
  }

  async createExecution(dataset) {
    const payload = await this.request('/v2/lm/executions', {
      method: 'POST',
      body: {
        configurationName: `${this.config.scenarioId}-training`,
        scenarioId: this.config.scenarioId,
        executableId: this.config.trainingExecutableId,
        inputArtifacts: [
          {
            name: 'freshchain-dataset',
            url: dataset.datasetCode
          }
        ],
        parameters: [
          { name: 'datasetCode', value: dataset.datasetCode },
          { name: 'historyDays', value: String(dataset.historyDays || '') }
        ]
      }
    });
    return {
      executionId: executionIdOf(payload),
      status: statusOf(payload),
      payload
    };
  }

  async getExecution(executionId) {
    const payload = await this.request(`/v2/lm/executions/${encodeURIComponent(executionId)}`);
    return {
      executionId,
      status: statusOf(payload),
      metrics: payload.metrics || payload.outputMetrics || [],
      payload
    };
  }

  async createDeployment(trainingRun) {
    const payload = await this.request('/v2/lm/deployments', {
      method: 'POST',
      body: {
        configurationName: `${this.config.scenarioId}-serving`,
        scenarioId: this.config.scenarioId,
        executableId: this.config.servingExecutableId,
        inputArtifacts: [
          {
            name: 'freshchain-model',
            executionId: trainingRun.aiCoreExecutionId
          }
        ],
        parameters: [
          { name: 'modelVersion', value: trainingRun.modelVersion }
        ]
      }
    });
    return {
      deploymentId: deploymentIdOf(payload),
      status: statusOf(payload),
      endpointUrl: deploymentUrlOf(payload),
      payload
    };
  }

  async getDeployment(deploymentId) {
    const payload = await this.request(`/v2/lm/deployments/${encodeURIComponent(deploymentId)}`);
    return {
      deploymentId,
      status: statusOf(payload),
      endpointUrl: deploymentUrlOf(payload),
      payload
    };
  }

  async invokeDeployment(deployment, features) {
    const endpoint = deployment.endpointUrl;
    if (!endpoint) {
      throw new AiCoreError(`AI Core deployment ${deployment.deploymentId} does not have an inference endpoint`, { statusCode: 503 });
    }
    const started = Date.now();
    const token = await this.accessToken();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'AI-Resource-Group': this.config.resourceGroup
      },
      body: JSON.stringify({ features })
    });
    const text = await response.text();
    const payload = text ? parseJson(text, { raw: text }) : {};
    if (!response.ok) {
      throw new AiCoreError(`AI Core inference failed with HTTP ${response.status}`, {
        statusCode: 502,
        response: text.slice(0, 1000)
      });
    }
    return {
      output: payload.prediction || payload.output || payload,
      latencyMs: Date.now() - started
    };
  }
}

module.exports = {
  AiCoreClient,
  AiCoreError,
  aiCoreConfig,
  constants: {
    DEFAULT_RESOURCE_GROUP,
    DEFAULT_SCENARIO,
    DEFAULT_TRAIN_EXECUTABLE,
    DEFAULT_SERVE_EXECUTABLE
  }
};

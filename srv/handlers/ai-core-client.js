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

function parseJson(value, defaultValue = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return defaultValue;
  }
}

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
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
  const serviceUrls = credentials.serviceurls || credentials.serviceUrls || {};
  return {
    apiUrl: normalizeUrl(firstValue(
      credentials.AI_API_URL,
      credentials.ai_api_url,
      credentials.apiurl,
      serviceUrls.AI_API_URL,
      serviceUrls.ai_api_url,
      serviceUrls.apiurl
    )),
    tokenUrl: firstValue(
      credentials.tokenurl,
      credentials.tokenUrl,
      uaa.url && `${normalizeUrl(uaa.url)}/oauth/token`,
      credentials.url && /\/oauth\/token(?:$|\?)/.test(credentials.url)
        ? credentials.url
        : credentials.url && `${normalizeUrl(credentials.url)}/oauth/token`
    ),
    clientId: firstValue(credentials.clientid, credentials.clientId, uaa.clientid, uaa.clientId),
    clientSecret: firstValue(credentials.clientsecret, credentials.clientSecret, uaa.clientsecret, uaa.clientSecret),
    resourceGroup: process.env.AICORE_RESOURCE_GROUP || DEFAULT_RESOURCE_GROUP,
    scenarioId: process.env.AICORE_SCENARIO_ID || DEFAULT_SCENARIO,
    trainingExecutableId: process.env.AICORE_TRAINING_EXECUTABLE_ID || DEFAULT_TRAIN_EXECUTABLE,
    servingExecutableId: process.env.AICORE_SERVING_EXECUTABLE_ID || DEFAULT_SERVE_EXECUTABLE
  };
}

function statusOf(payload, defaultStatus = 'RUNNING') {
  const value = firstValue(payload.status, payload.targetStatus, payload.executionStatus, payload.deploymentStatus);
  return normalizeLifecycleStatus(value || defaultStatus);
}

function normalizeLifecycleStatus(value) {
  const status = String(value || '').toUpperCase();
  if (['COMPLETED', 'COMPLETE', 'SUCCEEDED', 'SUCCESSFUL'].includes(status)) return 'SUCCEEDED';
  if (['DEAD', 'FAILED', 'FAILURE', 'ERROR'].includes(status)) return 'FAILED';
  if (['STOPPED', 'CANCELLED', 'CANCELED'].includes(status)) return 'CANCELLED';
  if (['PENDING', 'UNKNOWN', 'CREATING', 'STARTING'].includes(status)) return 'RUNNING';
  if (status === 'RUNNING') return 'RUNNING';
  return status || 'RUNNING';
}

function deploymentHealthOf(status) {
  return status === 'SUCCEEDED' || status === 'RUNNING' ? 'ONLINE'
    : status === 'FAILED' ? 'UNAVAILABLE'
      : status;
}

function deploymentStatusOf(payload) {
  const status = statusOf(payload);
  return status === 'RUNNING' ? 'SUCCEEDED' : status;
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

function safeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
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

  async findConfiguration(name) {
    const payload = await this.request('/v2/lm/configurations?$top=100');
    return (payload.resources || []).find(configuration => configuration.name === name);
  }

  async ensureTrainingConfiguration(dataset) {
    const datasetCode = safeName(dataset.datasetCode) || 'demo';
    const name = `${this.config.scenarioId}-training-${datasetCode}`;
    const existing = await this.findConfiguration(name);
    if (existing) return existing;

    const payload = await this.request('/v2/lm/configurations', {
      method: 'POST',
      body: {
        name,
        scenarioId: this.config.scenarioId,
        executableId: this.config.trainingExecutableId,
        parameterBindings: [
          { key: 'datasetCode', value: dataset.datasetCode || 'demo' },
          { key: 'historyDays', value: String(dataset.historyDays || 30) }
        ],
        inputArtifactBindings: []
      }
    });
    return {
      id: payload.id,
      name
    };
  }

  async createExecution(dataset) {
    const configuration = await this.ensureTrainingConfiguration(dataset);
    const payload = await this.request('/v2/lm/executions', {
      method: 'POST',
      body: {
        configurationId: configuration.id
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
    const existing = await this.findConfiguration(`${this.config.scenarioId}-serving-1-0-0`)
      || await this.findConfiguration(`${this.config.scenarioId}-serving`);
    const payload = await this.request('/v2/lm/deployments', {
      method: 'POST',
      body: existing
        ? { configurationId: existing.id }
        : {
            name: `${this.config.scenarioId}-serving-${safeName(trainingRun.modelVersion) || Date.now()}`,
            scenarioId: this.config.scenarioId,
            executableId: this.config.servingExecutableId,
            inputArtifactBindings: [
              {
                key: 'freshchain-model',
                artifactId: trainingRun.aiCoreExecutionId
              }
            ],
            parameterBindings: [
              { key: 'modelVersion', value: trainingRun.modelVersion }
            ]
          }
    });
    const status = deploymentStatusOf(payload);
    return {
      deploymentId: deploymentIdOf(payload),
      status,
      healthStatus: deploymentHealthOf(status),
      endpointUrl: deploymentUrlOf(payload),
      payload
    };
  }

  async getDeployment(deploymentId) {
    const payload = await this.request(`/v2/lm/deployments/${encodeURIComponent(deploymentId)}`);
    const status = deploymentStatusOf(payload);
    return {
      deploymentId,
      status,
      healthStatus: deploymentHealthOf(status),
      endpointUrl: deploymentUrlOf(payload),
      payload
    };
  }

  async findActiveDeployment() {
    const payload = await this.request('/v2/lm/deployments?$top=20');
    const deployments = payload.resources || [];
    for (const deployment of deployments) {
      const deploymentId = deploymentIdOf(deployment);
      const status = deploymentStatusOf(deployment);
      if (!deploymentId || status !== 'SUCCEEDED') continue;
      const detail = await this.getDeployment(deploymentId);
      if (detail.endpointUrl) return detail;
    }
    return null;
  }

  async invokeDeployment(deployment, features) {
    const baseEndpoint = normalizeUrl(deployment.endpointUrl);
    const endpoints = [`${baseEndpoint}/v2/predict`, baseEndpoint];
    if (!endpoints[0]) {
      throw new AiCoreError(`AI Core deployment ${deployment.deploymentId} does not have an inference endpoint`, { statusCode: 503 });
    }
    const started = Date.now();
    const token = await this.accessToken();
    let response;
    let text;
    for (const endpoint of endpoints) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(token ? { authorization: `Bearer ${token}`, 'AI-Resource-Group': this.config.resourceGroup } : {})
            },
            body: JSON.stringify({ features })
          });
          text = await response.text();
          if (![429, 502, 503, 504].includes(response.status) || attempt === 2) break;
        } catch (error) {
          if (attempt === 2) throw error;
        }
        await delay(500 * (attempt + 1));
      }
      if (response.ok || response.status !== 404) break;
    }
    if (!response.ok) {
      throw new AiCoreError(`AI Core inference failed with HTTP ${response.status}`, {
        statusCode: 502,
        response: text.slice(0, 1000)
      });
    }
    const payload = text ? parseJson(text, { raw: text }) : {};
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
  normalizeLifecycleStatus,
  deploymentHealthOf,
  deploymentStatusOf,
  constants: {
    DEFAULT_RESOURCE_GROUP,
    DEFAULT_SCENARIO,
    DEFAULT_TRAIN_EXECUTABLE,
    DEFAULT_SERVE_EXECUTABLE
  }
};

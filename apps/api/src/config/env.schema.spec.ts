import { validate } from './env.schema';

const baseConfig = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/uitfood',
};

describe('environment schema observability settings', () => {
  it('accepts the mobile payment return deep link', () => {
    const env = validate({
      ...baseConfig,
      MOBILE_PAYMENT_RETURN_URL: 'uitfood://payment/vnpay-return',
    });

    expect(env.MOBILE_PAYMENT_RETURN_URL).toBe(
      'uitfood://payment/vnpay-return',
    );
  });

  it('accepts Grafana Cloud direct OTLP settings', () => {
    const env = validate({
      ...baseConfig,
      GRAFANA_CLOUD_OTLP_ENDPOINT:
        'https://otlp-gateway-prod-us-central1.grafana.net/otlp',
      GRAFANA_CLOUD_OTLP_USERNAME_OR_INSTANCE_ID: '123456',
      GRAFANA_CLOUD_OTLP_TOKEN: 'grafana-token',
    });

    expect(env.GRAFANA_CLOUD_OTLP_ENDPOINT).toBe(
      'https://otlp-gateway-prod-us-central1.grafana.net/otlp',
    );
    expect(env.GRAFANA_CLOUD_OTLP_USERNAME_OR_INSTANCE_ID).toBe('123456');
    expect(env.GRAFANA_CLOUD_OTLP_TOKEN).toBe('grafana-token');
  });

  it('requires Grafana Cloud auth when using the Grafana Cloud endpoint shortcut', () => {
    expect(() =>
      validate({
        ...baseConfig,
        GRAFANA_CLOUD_OTLP_ENDPOINT:
          'https://otlp-gateway-prod-us-central1.grafana.net/otlp',
      }),
    ).toThrow(/Grafana Cloud direct OTLP export requires/);
  });

  it('accepts an explicit OpenTelemetry OTLP auth header', () => {
    const env = validate({
      ...baseConfig,
      OTEL_EXPORTER_OTLP_ENDPOINT:
        'https://otlp-gateway-prod-us-central1.grafana.net/otlp',
      OTEL_EXPORTER_OTLP_HEADERS:
        'Authorization=Basic%20base64-instance-id-and-token',
    });

    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
      'Authorization=Basic%20base64-instance-id-and-token',
    );
  });

  it('trims Ollama configuration values', () => {
    const env = validate({
      ...baseConfig,
      OLLAMA_BASE_URL: ' https://ollama.com ',
      OLLAMA_MODEL: ' gemma4:31b-cloud ',
      OLLAMA_API_KEY: ' test-key ',
    });

    expect(env.OLLAMA_BASE_URL).toBe('https://ollama.com');
    expect(env.OLLAMA_MODEL).toBe('gemma4:31b-cloud');
    expect(env.OLLAMA_API_KEY).toBe('test-key');
  });

  it('defaults Ollama to direct cloud settings', () => {
    const env = validate(baseConfig);

    expect(env.OLLAMA_BASE_URL).toBe('https://ollama.com');
    expect(env.OLLAMA_MODEL).toBe('gpt-oss:20b');
    expect(env.OLLAMA_API_KEY).toBe('');
  });

  it('defaults AI search embeddings to local Ollama', () => {
    const env = validate(baseConfig);

    expect(env.AI_SEARCH_EMBEDDING_BASE_URL).toBe('http://localhost:11434');
    expect(env.AI_SEARCH_EMBEDDING_MODEL).toBe('embeddinggemma');
  });

  it('rejects an embedding dimension that does not match the vector columns', () => {
    expect(() =>
      validate({ ...baseConfig, AI_SEARCH_EMBEDDING_DIMENSIONS: '1536' }),
    ).toThrow(/fixed at 768/);
  });

  it('allows an empty Ollama API key at startup', () => {
    const env = validate({
      ...baseConfig,
      OLLAMA_API_KEY: '',
    });

    expect(env.OLLAMA_API_KEY).toBe('');
  });

  it('parses AI search provider settings', () => {
    const env = validate({
      ...baseConfig,
      AI_SEARCH_ENABLED: 'true',
      AI_SEARCH_MODEL: ' gpt-oss:120b-cloud ',
      AI_SEARCH_TIMEOUT_MS: '9000',
      AI_SEARCH_DAILY_LIMIT_PER_USER: '250',
      AI_SEARCH_EMBEDDING_BASE_URL: ' http://localhost:11434 ',
      AI_SEARCH_EMBEDDING_MODEL: ' embeddinggemma ',
      AI_SEARCH_EMBEDDING_VERSION: ' 2 ',
      AI_SEARCH_EMBEDDING_DIMENSIONS: '768',
      AI_SEARCH_EMBEDDING_TIMEOUT_MS: '7000',
      AI_SEARCH_EMBEDDING_WORKER_ENABLED: 'true',
      AI_SEARCH_EMBEDDING_BATCH_SIZE: '25',
      AI_SEARCH_EMBEDDING_RATE_LIMIT_PER_MINUTE: '120',
    });

    expect(env.AI_SEARCH_ENABLED).toBe(true);
    expect(env.AI_SEARCH_MODEL).toBe('gpt-oss:120b-cloud');
    expect(env.AI_SEARCH_TIMEOUT_MS).toBe(9000);
    expect(env.AI_SEARCH_DAILY_LIMIT_PER_USER).toBe(250);
    expect(env.AI_SEARCH_EMBEDDING_BASE_URL).toBe('http://localhost:11434');
    expect(env.AI_SEARCH_EMBEDDING_MODEL).toBe('embeddinggemma');
    expect(env.AI_SEARCH_EMBEDDING_VERSION).toBe('2');
    expect(env.AI_SEARCH_EMBEDDING_DIMENSIONS).toBe(768);
    expect(env.AI_SEARCH_EMBEDDING_TIMEOUT_MS).toBe(7000);
    expect(env.AI_SEARCH_EMBEDDING_WORKER_ENABLED).toBe(true);
    expect(env.AI_SEARCH_EMBEDDING_BATCH_SIZE).toBe(25);
    expect(env.AI_SEARCH_EMBEDDING_RATE_LIMIT_PER_MINUTE).toBe(120);
  });
});

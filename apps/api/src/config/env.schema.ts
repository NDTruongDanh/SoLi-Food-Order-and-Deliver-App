import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  value === '' ? undefined : value;
const stringToBoolean = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .default(defaultValue ? 'true' : 'false')
    .transform((value) =>
      ['1', 'true', 'yes'].includes(value.trim().toLowerCase()),
    );

/**
 * Zod schema for all required environment variables.
 *
 * This schema is passed to ConfigModule.forRoot({ validate }) so that the
 * application FAILS FAST at startup — before any module is initialized —
 * when a required variable is missing or has an invalid value.
 *
 * Benefits over the previous onModuleInit() per-service checks:
 *   - One canonical location for all env validation rules.
 *   - Clear, structured error messages at startup (lists ALL missing vars,
 *     not just the first one encountered).
 *   - Type coercion handled here (e.g. REDIS_PORT string → number) so
 *     downstream consumers receive correctly-typed values.
 *   - Defaults are applied consistently before any factory function runs.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z.string().default('development'),

  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------
  DATABASE_URL: z
    .string()
    .min(
      1,
      'DATABASE_URL is required — format: postgresql://user:pass@host:port/db',
    ),

  // ---------------------------------------------------------------------------
  // Better Auth
  // ---------------------------------------------------------------------------
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters for security')
    .default('a_very_long_secret_for_test_purposes_only_32_chars'),
  BETTER_AUTH_URL: z
    .string()
    .url('BETTER_AUTH_URL must be a valid URL')
    .default('http://localhost:3000'),

  // ---------------------------------------------------------------------------
  // Redis
  // ---------------------------------------------------------------------------
  REDIS_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  // ---------------------------------------------------------------------------
  // VNPay — all four are required; no defaults (production payment credentials)
  // ---------------------------------------------------------------------------
  VNPAY_TMN_CODE: z
    .string()
    .trim()
    .min(1, 'VNPAY_TMN_CODE is required — obtain from VNPay merchant portal')
    .default('STUB_TMN'),
  VNPAY_HASH_SECRET: z
    .string()
    .trim()
    .min(
      1,
      'VNPAY_HASH_SECRET is required — HMAC signing key from VNPay portal',
    )
    .default('STUB_SECRET'),
  VNPAY_URL: z
    .string()
    .url(
      'VNPAY_URL must be a valid URL (e.g. https://sandbox.vnpayment.vn/paymentv2/vpcpay.html)',
    )
    .default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  VNPAY_RETURN_URL: z
    .string()
    .url(
      'VNPAY_RETURN_URL must be a valid URL (e.g. http://localhost:3000/api/payments/vnpay/return)',
    )
    .default('http://localhost:3000/api/payments/vnpay/return'),
  MOBILE_PAYMENT_RETURN_URL: z
    .string()
    .url(
      'MOBILE_PAYMENT_RETURN_URL must be a valid URL (e.g. uitfood://payment/vnpay-return)',
    )
    .default('uitfood://payment/vnpay-return'),

  // ---------------------------------------------------------------------------
  // Cloudinary — required for signed uploads
  // ---------------------------------------------------------------------------
  CLOUDINARY_CLOUD_NAME: z
    .string()
    .trim()
    .min(1, 'CLOUDINARY_CLOUD_NAME is required')
    .default('STUB_CLOUD'),
  CLOUDINARY_API_KEY: z
    .string()
    .trim()
    .min(1, 'CLOUDINARY_API_KEY is required')
    .default('STUB_KEY'),
  CLOUDINARY_API_SECRET: z
    .string()
    .trim()
    .min(1, 'CLOUDINARY_API_SECRET is required')
    .default('STUB_SECRET'),

  // ---------------------------------------------------------------------------
  // CORS (comma-separated origins)
  // ---------------------------------------------------------------------------
  CORS_ORIGIN: z
    .string()
    .default(
      'http://localhost:5173,http://localhost:5174,http://localhost:3000',
    ),

  // ---------------------------------------------------------------------------
  // Payment session window — optional with a safe default
  // ---------------------------------------------------------------------------
  PAYMENT_SESSION_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .positive('PAYMENT_SESSION_TIMEOUT_SECONDS must be a positive integer')
    .default(1800),

  // ---------------------------------------------------------------------------
  // SMTP email delivery — all optional (Phase N-4)
  // When SMTP_HOST is absent, NodemailerEmailProvider is swapped for
  // NoopEmailProvider which records SMTP_NOT_CONFIGURED delivery failures.
  // ---------------------------------------------------------------------------
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // z.coerce.boolean() converts the string 'false' to true (Boolean('false') === true).
  // Use a string transform instead so 'false'/'0'/undefined → false and 'true'/'1' → true.
  SMTP_SECURE: z
    .string()
    .optional()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().trim().optional(),
  SMTP_FROM: z.string().optional().default('noreply@soli.dev'),

  // ---------------------------------------------------------------------------
  // Firebase Cloud Messaging — optional (Phase N-5)
  // Path to the Firebase Admin SDK service account JSON key file.
  // May be absolute or relative to process.cwd() (the directory from which
  // `nest start` is invoked — typically `apps/api/` in local dev).
  //
  // When absent, PUSH_PROVIDER falls back to StubPushProvider which logs
  // push delivery attempts without making real FCM calls. Safe for CI/CD.
  //
  // Example (relative to apps/api/):
  //   FIREBASE_SERVICE_ACCOUNT_PATH=soli-food-delivery-FCM-key.json
  // ---------------------------------------------------------------------------
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  // ---------------------------------------------------------------------------
  // AI nutrition extraction via Ollama
  // ---------------------------------------------------------------------------
  OLLAMA_BASE_URL: z.string().trim().url().default('https://ollama.com'),
  OLLAMA_MODEL: z.string().trim().min(1).default('gpt-oss:20b'),
  OLLAMA_API_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().default(''),
  ),

  // ---------------------------------------------------------------------------
  // Hugging Face inference API
  // ---------------------------------------------------------------------------
  HUGGINGFACE_API_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().optional(),
  ),

  // ---------------------------------------------------------------------------
  // AI search query router. When disabled or unavailable, requests use classic search.
  // ---------------------------------------------------------------------------
  AI_SEARCH_ENABLED: stringToBoolean(false),
  AI_SEARCH_MODEL: z.string().trim().min(1).default('gpt-oss:20b'),
  AI_SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  AI_SEARCH_DAILY_LIMIT_PER_USER: z.coerce
    .number()
    .int()
    .positive()
    .default(100),
  AI_SEARCH_EMBEDDING_PROVIDER: z
    .enum(['ollama', 'huggingface'])
    .default('ollama'),
  AI_SEARCH_EMBEDDING_BASE_URL: z
    .string()
    .trim()
    .url()
    .default('http://localhost:11434'),
  AI_SEARCH_EMBEDDING_MODEL: z.string().trim().min(1).default('embeddinggemma'),
  AI_SEARCH_EMBEDDING_VERSION: z.string().trim().min(1).default('1'),
  AI_SEARCH_EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .refine((value) => value === 768, {
      message:
        'AI_SEARCH_EMBEDDING_DIMENSIONS is fixed at 768; reindex the pgvector columns before changing it',
    })
    .default(768),
  AI_SEARCH_EMBEDDING_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(8000),
  AI_SEARCH_EMBEDDING_WORKER_ENABLED: stringToBoolean(false),
  AI_SEARCH_EMBEDDING_BATCH_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(20),
  AI_SEARCH_EMBEDDING_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(60),

  // ---------------------------------------------------------------------------
  // Observability - optional. When absent, OpenTelemetry exporters stay disabled
  // and the app continues to run with local structured JSON logs.
  // ---------------------------------------------------------------------------
  APP_ENV: z.string().default('development'),
  APP_VERSION: z.string().default('local'),
  COMMIT_SHA: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('uitfood-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  OTEL_EXPORTER_OTLP_HEADERS: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  GRAFANA_CLOUD_OTLP_ENDPOINT: z.preprocess(
    emptyStringToUndefined,
    z.string().url().optional(),
  ),
  GRAFANA_CLOUD_OTLP_USERNAME_OR_INSTANCE_ID: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  GRAFANA_CLOUD_OTLP_TOKEN: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  OTEL_RESOURCE_ATTRIBUTES: z.preprocess(
    emptyStringToUndefined,
    z.string().optional(),
  ),
  OTEL_TRACES_EXPORTER: z.string().default('otlp'),
  OTEL_METRICS_EXPORTER: z.string().default('otlp'),
  OTEL_LOGS_EXPORTER: z.string().default('otlp'),
  OTEL_TRACES_SAMPLER: z
    .enum([
      'always_on',
      'always_off',
      'traceidratio',
      'parentbased_always_on',
      'parentbased_always_off',
      'parentbased_traceidratio',
      'parentbased_jaeger_remote',
      'jaeger_remote',
      'xray',
    ])
    .default('parentbased_traceidratio'),
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(0.1),
  LOG_LEVEL: z
    .enum([
      'fatal',
      'error',
      'warn',
      'warning',
      'info',
      'log',
      'debug',
      'verbose',
    ])
    .default('log'),
});

export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  const hasGrafanaEndpoint = Boolean(env.GRAFANA_CLOUD_OTLP_ENDPOINT);
  const hasGrafanaUsername = Boolean(
    env.GRAFANA_CLOUD_OTLP_USERNAME_OR_INSTANCE_ID,
  );
  const hasGrafanaToken = Boolean(env.GRAFANA_CLOUD_OTLP_TOKEN);
  const hasExplicitOtelHeaders = Boolean(env.OTEL_EXPORTER_OTLP_HEADERS);
  if (
    env.AI_SEARCH_EMBEDDING_PROVIDER === 'huggingface' &&
    !env.HUGGINGFACE_API_KEY
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['HUGGINGFACE_API_KEY'],
      message:
        'HUGGINGFACE_API_KEY is required when AI_SEARCH_EMBEDDING_PROVIDER is huggingface',
    });
  }

  if (
    env.AI_SEARCH_EMBEDDING_PROVIDER === 'huggingface' &&
    env.AI_SEARCH_EMBEDDING_MODEL === 'embeddinggemma'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['AI_SEARCH_EMBEDDING_MODEL'],
      message:
        'AI_SEARCH_EMBEDDING_MODEL must be explicitly set to a valid Hugging Face model (e.g. google/embeddinggemma-300m) when using the huggingface provider. The default "embeddinggemma" is for Ollama only.',
    });
  }

  if (hasGrafanaUsername && !hasGrafanaToken) {
    ctx.addIssue({
      code: 'custom',
      path: ['GRAFANA_CLOUD_OTLP_TOKEN'],
      message:
        'GRAFANA_CLOUD_OTLP_TOKEN is required when Grafana Cloud username/instance ID is set',
    });
  }

  if (hasGrafanaToken && !hasGrafanaUsername) {
    ctx.addIssue({
      code: 'custom',
      path: ['GRAFANA_CLOUD_OTLP_USERNAME_OR_INSTANCE_ID'],
      message:
        'GRAFANA_CLOUD_OTLP_USERNAME_OR_INSTANCE_ID is required when Grafana Cloud token is set',
    });
  }

  if (
    (hasGrafanaUsername || hasGrafanaToken) &&
    !env.OTEL_EXPORTER_OTLP_ENDPOINT &&
    !hasGrafanaEndpoint
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['GRAFANA_CLOUD_OTLP_ENDPOINT'],
      message:
        'Set GRAFANA_CLOUD_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT for Grafana Cloud export',
    });
  }

  if (
    hasGrafanaEndpoint &&
    !hasExplicitOtelHeaders &&
    (!hasGrafanaUsername || !hasGrafanaToken)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['GRAFANA_CLOUD_OTLP_USERNAME_OR_INSTANCE_ID'],
      message:
        'Grafana Cloud direct OTLP export requires username/instance ID and token, or an explicit OTEL_EXPORTER_OTLP_HEADERS value',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validation function passed to ConfigModule.forRoot({ validate }).
 * NestJS calls this synchronously during ConfigModule initialization.
 * Throwing here aborts the bootstrap sequence with a clear error message.
 */
export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `\n\n🚨 Environment configuration is invalid:\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the required values.\n`,
    );
  }

  return result.data;
}

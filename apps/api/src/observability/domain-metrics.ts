import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter(process.env.OTEL_SERVICE_NAME ?? 'uitfood-api');

export const ordersPlacedCount = meter.createCounter(
  'api.domain.orders.placed',
  {
    description: 'Total orders placed successfully',
  },
);

export const paymentFailuresCount = meter.createCounter(
  'api.domain.payment.failures',
  {
    description: 'Total payment failures',
  },
);

export const aiSearchCount = meter.createCounter('api.domain.ai_search.count', {
  description: 'Total AI search requests',
});

export const aiSearchLatencyMs = meter.createHistogram(
  'api.domain.ai_search.latency_ms',
  {
    description: 'AI search endpoint latency in milliseconds',
    unit: 'ms',
  },
);

export const aiSearchEmbeddingJobCount = meter.createCounter(
  'api.domain.ai_search.embedding_jobs.count',
  {
    description: 'AI search embedding job outcomes',
  },
);

export const aiSearchEmbeddingJobLatencyMs = meter.createHistogram(
  'api.domain.ai_search.embedding_job_latency_ms',
  {
    description: 'AI search embedding job latency in milliseconds',
    unit: 'ms',
  },
);

export const aiSearchStaleEmbeddingsCount = meter.createHistogram(
  'api.domain.ai_search.stale_embeddings.count',
  {
    description: 'Current count of stale AI search embeddings',
  },
);

export const aiSearchBackfillCount = meter.createCounter(
  'api.domain.ai_search.backfill.count',
  {
    description: 'AI search embedding backfill progress counters',
  },
);

export function recordOrderPlaced(
  attributes: Record<string, string | number> = {},
) {
  ordersPlacedCount.add(1, attributes);
}

export function recordPaymentFailure(
  attributes: Record<string, string | number> = {},
) {
  paymentFailuresCount.add(1, attributes);
}

export function recordAiSearch(attributes: {
  mode: string;
  fallbackReason?: string;
  itemCount: number;
  restaurantCount: number;
  latencyMs: number;
}) {
  const metricAttributes: Record<string, string | number> = {
    mode: attributes.mode,
    fallback_reason: attributes.fallbackReason ?? 'none',
    zero_results:
      attributes.itemCount === 0 && attributes.restaurantCount === 0
        ? 'true'
        : 'false',
  };

  aiSearchCount.add(1, metricAttributes);
  aiSearchLatencyMs.record(attributes.latencyMs, metricAttributes);
}

export function recordAiSearchEmbeddingJob(attributes: {
  status: string;
  targetType: string;
  latencyMs: number;
}) {
  const metricAttributes = {
    status: attributes.status,
    target_type: attributes.targetType,
  };
  aiSearchEmbeddingJobCount.add(1, metricAttributes);
  aiSearchEmbeddingJobLatencyMs.record(attributes.latencyMs, metricAttributes);
}

export function recordAiSearchStaleEmbeddings(count: number) {
  aiSearchStaleEmbeddingsCount.record(count);
}

export function recordAiSearchBackfill(attributes: {
  status: 'queued' | 'skipped' | 'failed';
  count: number;
}) {
  aiSearchBackfillCount.add(attributes.count, { status: attributes.status });
}

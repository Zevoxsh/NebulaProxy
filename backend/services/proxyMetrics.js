// @ts-check
/**
 * In-process counters for the HTTP proxy hot path.
 *
 * The existing /metrics only reflected active health-check probes (a
 * synthetic HEAD / every few seconds), never the actual proxied traffic —
 * no visibility into real response status codes, how often the
 * connect-error retry (requestProxy.js) fires, or how often an upstream
 * request fails outright.
 *
 * NOTE: per-process, like everything else on the hot path. With
 * CLUSTER_ENABLED, a scrape only sees whichever worker answered it — see
 * the same caveat on eventLoopMonitor.js.
 */
class ProxyMetrics {
  constructor() {
    this.statusClasses = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 };
    this.retries = 0;
    this.upstreamErrors = 0;
    this.circuitBreakerRejects = 0;
  }

  recordStatus(statusCode) {
    if (statusCode >= 200 && statusCode < 300) this.statusClasses['2xx']++;
    else if (statusCode >= 300 && statusCode < 400) this.statusClasses['3xx']++;
    else if (statusCode >= 400 && statusCode < 500) this.statusClasses['4xx']++;
    else if (statusCode >= 500 && statusCode < 600) this.statusClasses['5xx']++;
    else this.statusClasses.other++;
  }

  recordRetry() {
    this.retries++;
  }

  recordUpstreamError() {
    this.upstreamErrors++;
  }

  recordCircuitBreakerReject() {
    this.circuitBreakerRejects++;
  }

  snapshot() {
    return {
      statusClasses: { ...this.statusClasses },
      retries: this.retries,
      upstreamErrors: this.upstreamErrors,
      circuitBreakerRejects: this.circuitBreakerRejects,
    };
  }
}

export const proxyMetrics = new ProxyMetrics();

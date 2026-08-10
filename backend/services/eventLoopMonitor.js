// @ts-check
/**
 * Event loop lag monitor.
 *
 * The single biggest blind spot in the existing observability: every signal
 * we had (container healthcheck, autoheal, response-time metrics) detects a
 * degraded worker only *after* it's bad enough to fail a health probe or
 * visibly slow down requests. Event loop lag is the earliest, cheapest
 * signal available — it rises before request latency does, for any
 * CPU-bound stall (large sync JSON, big regex, GC pressure).
 *
 * Uses perf_hooks.monitorEventLoopDelay(), a native Node histogram with
 * effectively zero overhead. Values are nanoseconds internally; getStats()
 * converts to milliseconds.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

const NS_TO_MS = 1e6;

class EventLoopMonitor {
  constructor() {
    this._histogram = null;
  }

  start() {
    if (this._histogram) return;
    this._histogram = monitorEventLoopDelay({ resolution: 10 });
    this._histogram.enable();
  }

  /**
   * @returns {{mean:number,min:number,max:number,p50:number,p95:number,p99:number}|null}
   * NaN when no samples yet — callers should treat NaN as "no data".
   */
  getStats() {
    if (!this._histogram) return null;
    return {
      mean: this._histogram.mean / NS_TO_MS,
      min:  this._histogram.min / NS_TO_MS,
      max:  this._histogram.max / NS_TO_MS,
      p50:  this._histogram.percentile(50) / NS_TO_MS,
      p95:  this._histogram.percentile(95) / NS_TO_MS,
      p99:  this._histogram.percentile(99) / NS_TO_MS,
    };
  }
}

export const eventLoopMonitor = new EventLoopMonitor();

// @ts-check
import { Transform } from 'stream';

/**
 * Token-bucket byte-rate limiter. Refills continuously based on elapsed
 * wall-clock time; when a chunk exceeds the available tokens it pushes only
 * the affordable slice and delays the callback for the remainder, so
 * backpressure propagates through the pipe instead of buffering in memory.
 */
export class ThrottleStream extends Transform {
  constructor(bytesPerSecond) {
    super();
    // Postgres BIGINT columns (throttle_bps) come back from `pg` as strings,
    // not numbers — coerce here so the token-bucket math below never
    // silently degrades into string concatenation (`"123" + 45.6`).
    const rate = Number(bytesPerSecond);
    this.bytesPerSecond = rate > 0 ? rate : 0;
    this.tokens = this.bytesPerSecond;
    this.lastRefill = Date.now();
  }

  setRate(bytesPerSecond) {
    const rate = Number(bytesPerSecond);
    this.bytesPerSecond = rate > 0 ? rate : 0;
  }

  #refill() {
    if (!this.bytesPerSecond) return;
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    if (elapsedMs <= 0) return;
    this.lastRefill = now;
    this.tokens = Math.min(this.bytesPerSecond, this.tokens + (elapsedMs / 1000) * this.bytesPerSecond);
  }

  _transform(chunk, _encoding, callback) {
    if (!this.bytesPerSecond) {
      callback(null, chunk);
      return;
    }
    this.#sendThrottled(chunk, callback);
  }

  #sendThrottled(chunk, callback) {
    this.#refill();

    if (this.tokens >= chunk.length) {
      this.tokens -= chunk.length;
      callback(null, chunk);
      return;
    }

    const affordable = Math.floor(this.tokens);
    this.tokens -= affordable;

    if (affordable > 0) {
      this.push(chunk.subarray(0, affordable));
    }

    const remainder = chunk.subarray(affordable);
    const waitMs = Math.max(1, Math.ceil(((remainder.length - this.tokens) / this.bytesPerSecond) * 1000));

    setTimeout(() => this.#sendThrottled(remainder, callback), waitMs);
  }
}

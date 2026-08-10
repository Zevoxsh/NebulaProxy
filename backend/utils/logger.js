// @ts-check
import pino from 'pino';
import pretty from 'pino-pretty';

const level = process.env.LOG_LEVEL || 'warn';

// pino-pretty is used as an in-process stream rather than via `transport:`
// (which spawns it in a worker thread through thread-stream). On some
// Node versions that worker crashes at startup with "this should not
// happen: undefined" — a known thread-stream issue. Building the stream
// directly avoids the worker entirely at the cost of pretty-printing
// happening on the main thread (negligible for a dev-only code path).
const stream = process.env.NODE_ENV === 'development'
  ? pretty({ colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' })
  : undefined;

export const logger = pino({
  level,
  // Pino only auto-serializes Error objects under the `err` key by default.
  // 232+ call sites across this codebase log `{ error }` instead (the more
  // natural-sounding name) — without this, an Error under that key gets
  // JSON.stringify'd as `{}` (message/stack are non-enumerable own
  // properties), silently discarding the one thing you need to debug a
  // failure. Mapping `error` to the same serializer fixes every existing
  // call site retroactively with no code changes elsewhere.
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err
  }
}, stream);

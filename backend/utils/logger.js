// @ts-check
import pino from 'pino';

const level = process.env.LOG_LEVEL || 'warn';

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
  },
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
    : undefined
});

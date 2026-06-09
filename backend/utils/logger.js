// @ts-check
import pino from 'pino';

const level = process.env.LOG_LEVEL || 'warn';

export const logger = pino({
  level,
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
    : undefined
});

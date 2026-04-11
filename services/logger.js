/**
 * Vertifile structured logger (Pino).
 *
 * Production: JSON output (machine-parseable for Render/Railway log aggregation).
 * Development: pretty-printed with timestamps and colors via pino-pretty.
 *
 * Configure log level via LOG_LEVEL env var (default: 'info' in prod, 'debug' in dev).
 *
 * @module services/logger
 */

const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  ...(isProduction
    ? {} // JSON output for Render
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } })
});

module.exports = logger;

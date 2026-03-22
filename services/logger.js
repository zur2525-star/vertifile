const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  ...(isProduction
    ? {} // JSON output for Render
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } })
});

module.exports = logger;

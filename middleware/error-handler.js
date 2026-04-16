'use strict';

/**
 * Vertifile -- Standardized Error Response Middleware
 *
 * Catches all unhandled errors that bubble up through Express middleware and
 * route handlers. Returns a consistent JSON envelope regardless of the error
 * type so clients can reliably parse error responses.
 *
 * Response shape:
 *   { success: false, error: "human-readable message", code: "ERROR_CODE" }
 *
 * In production (NODE_ENV === 'production'), stack traces are never exposed.
 * In development, the stack is included for debugging convenience.
 *
 * Must be mounted LAST in server.js (after all routes).
 */

const logger = require('../services/logger');
const { trackError } = require('./error-alerter');

// ---------------------------------------------------------------------------
// Custom error classes for structured error handling
// ---------------------------------------------------------------------------

class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.code = 'VALIDATION_ERROR';
    this.details = details || null;
  }
}

class AuthenticationError extends Error {
  constructor(message) {
    super(message || 'Authentication required');
    this.name = 'AuthenticationError';
    this.statusCode = 401;
    this.code = 'AUTHENTICATION_ERROR';
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message || 'Resource not found');
    this.name = 'NotFoundError';
    this.statusCode = 404;
    this.code = 'NOT_FOUND';
  }
}

class RateLimitError extends Error {
  constructor(message, retryAfterSeconds) {
    super(message || 'Too many requests');
    this.name = 'RateLimitError';
    this.statusCode = 429;
    this.code = 'RATE_LIMIT_EXCEEDED';
    this.retryAfter = retryAfterSeconds || null;
  }
}

// ---------------------------------------------------------------------------
// Error code mapping for known error types
// ---------------------------------------------------------------------------
const ERROR_TYPE_MAP = {
  ValidationError:    { statusCode: 400, code: 'VALIDATION_ERROR' },
  AuthenticationError:{ statusCode: 401, code: 'AUTHENTICATION_ERROR' },
  NotFoundError:      { statusCode: 404, code: 'NOT_FOUND' },
  RateLimitError:     { statusCode: 429, code: 'RATE_LIMIT_EXCEEDED' },
  SyntaxError:        { statusCode: 400, code: 'INVALID_REQUEST' },
  TypeError:          { statusCode: 400, code: 'INVALID_REQUEST' },
};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function errorHandler(err, req, res, _next) {
  // Track the error for monitoring/alerting
  trackError(err, req);

  // Determine status code and error code from the error type
  const mapping = ERROR_TYPE_MAP[err.name] || null;
  const statusCode = err.statusCode || (mapping && mapping.statusCode) || 500;
  const errorCode = err.code || (mapping && mapping.code) || 'INTERNAL_ERROR';

  // Determine the user-facing message
  let message;
  if (statusCode >= 500) {
    // Never expose internal error details to clients in production
    message = process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : (err.message || 'Internal server error');
  } else {
    message = err.message || 'An error occurred';
  }

  // Handle specific known error messages
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'CORS: Origin not allowed', code: 'CORS_ERROR' });
  }
  if (err.message === 'invalid csrf token' || err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      success: false,
      error: 'CSRF token missing or invalid. Please refresh the page and try again.',
      code: 'CSRF_ERROR'
    });
  }

  // Log with full context
  if (statusCode >= 500) {
    logger.error({
      event: 'unhandled_error',
      statusCode,
      code: errorCode,
      path: req.path,
      method: req.method,
      error: err.message,
      stack: err.stack
    }, 'Server error: ' + err.message);
  } else {
    logger.warn({
      event: 'client_error',
      statusCode,
      code: errorCode,
      path: req.path,
      method: req.method,
      error: err.message
    }, 'Client error: ' + err.message);
  }

  // Build response body
  const body = {
    success: false,
    error: message,
    code: errorCode
  };

  // Include validation details when available
  if (err.details) {
    body.details = err.details;
  }

  // Include retry-after hint for rate limit errors
  if (err.retryAfter) {
    body.retryAfter = err.retryAfter;
    res.setHeader('Retry-After', String(err.retryAfter));
  }

  // Include stack trace only in development
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    body.stack = err.stack;
  }

  // Prevent caching of error responses
  res.setHeader('Cache-Control', 'no-store');

  res.status(statusCode).json(body);
}

module.exports = {
  errorHandler,
  ValidationError,
  AuthenticationError,
  NotFoundError,
  RateLimitError
};

'use strict';

/**
 * Vertifile -- Password Strength Validator
 *
 * Shared helper used by registration, password reset, and API signup routes.
 * Returns a structured result with all failing rules so the client can show
 * every issue at once rather than one-at-a-time.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ---------------------------------------------------------------------------
// Common password blacklist (same file as auth.js)
// ---------------------------------------------------------------------------
const COMMON_PASSWORDS_PATH = path.join(__dirname, '..', 'data', 'common-passwords.txt');
let commonPasswords = new Set();
try {
  commonPasswords = new Set(
    fs.readFileSync(COMMON_PASSWORDS_PATH, 'utf8')
      .split('\n').map(p => p.trim().toLowerCase()).filter(Boolean)
  );
  logger.info({ count: commonPasswords.size }, 'Password validator: common password blacklist loaded');
} catch (_) {
  // Blacklist file not found -- validation continues without it
}

/**
 * Validate password strength.
 *
 * @param {string} password - The password to validate
 * @param {string} [email]  - Optional email to check password is not identical
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePassword(password, email) {
  const errors = [];

  if (typeof password !== 'string' || password.length === 0) {
    return { valid: false, errors: ['Password is required'] };
  }

  if (password.length < 8) {
    errors.push('Must be at least 8 characters');
  }

  if (password.length > 128) {
    errors.push('Must be less than 128 characters');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Must contain at least 1 uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Must contain at least 1 lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Must contain at least 1 number');
  }

  if (email && password.toLowerCase() === email.toLowerCase()) {
    errors.push('Password cannot be your email address');
  }

  if (commonPasswords.size > 0 && commonPasswords.has(password.toLowerCase())) {
    errors.push('This password is too common -- please choose a stronger one');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validatePassword };

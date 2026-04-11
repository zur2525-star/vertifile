'use strict';

/**
 * Vertifile -- Onboarding Email Scheduler
 *
 * Schedules a 5-email drip sequence after account creation.
 * Each email is recorded in the `onboarding_emails` table so we can:
 *   - track sent/skipped state
 *   - avoid duplicate sends on server restart
 *   - let admins see funnel drop-off
 *
 * Scheduling uses simple setTimeout. In production this should be
 * replaced with a proper job queue (pg-boss, BullMQ, etc.) so
 * jobs survive process restarts. The DB table is designed to support
 * either approach.
 *
 * Called from the signup route:
 *   const { scheduleOnboardingEmails } = require('../services/onboarding-emails');
 *   await scheduleOnboardingEmails(user.id, user.email, user.name);
 */

const logger = require('./logger');
const { sendEmail } = require('./email');
const {
  welcomeEmail,
  firstDocEmail,
  stampEmail,
  shareEmail,
  upgradeEmail,
} = require('./email-templates');

// ---------------------------------------------------------------------------
// Timing constants (milliseconds)
// ---------------------------------------------------------------------------
const HOUR = 60 * 60 * 1000;

const SCHEDULE = [
  { type: 'welcome',   delayMs: 0,           conditional: false },
  { type: 'first_doc', delayMs: 24 * HOUR,   conditional: true  },  // skip if user already uploaded
  { type: 'stamp',     delayMs: 72 * HOUR,   conditional: false },
  { type: 'share',     delayMs: 120 * HOUR,  conditional: false },
  { type: 'upgrade',   delayMs: 168 * HOUR,  conditional: true  },  // skip if not on trial
];

// Keep track of active timers so they can be cleared on shutdown
const activeTimers = new Map();

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Insert a scheduled email record. Returns the row id.
 */
async function insertEmailRecord(db, userId, emailType, scheduledAt) {
  const { rows } = await db.query(
    `INSERT INTO onboarding_emails (user_id, email_type, scheduled_at)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, emailType, scheduledAt]
  );
  return rows[0].id;
}

/**
 * Mark an email as sent.
 */
async function markSent(db, recordId) {
  await db.query(
    `UPDATE onboarding_emails SET sent_at = NOW() WHERE id = $1`,
    [recordId]
  );
}

/**
 * Mark an email as skipped (condition not met).
 */
async function markSkipped(db, recordId) {
  await db.query(
    `UPDATE onboarding_emails SET skipped = TRUE WHERE id = $1`,
    [recordId]
  );
}

/**
 * Check if this email was already sent or scheduled for this user.
 */
async function alreadyScheduled(db, userId, emailType) {
  const { rows } = await db.query(
    `SELECT id FROM onboarding_emails
     WHERE user_id = $1 AND email_type = $2
     LIMIT 1`,
    [userId, emailType]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Condition checks
// ---------------------------------------------------------------------------

/**
 * Check if user has uploaded at least one document.
 */
async function hasDocuments(db, userId) {
  try {
    const count = await db.getUserDocumentCount(userId);
    return count > 0;
  } catch (e) {
    // Fallback: try direct query if getUserDocumentCount doesn't exist
    try {
      const { rows } = await db.query(
        'SELECT COUNT(*) as count FROM documents WHERE user_id = $1',
        [userId]
      );
      return Number(rows[0].count) > 0;
    } catch (_) {
      return false;
    }
  }
}

/**
 * Check if user is on a trial plan.
 */
async function isOnTrial(db, userId) {
  try {
    const { rows } = await db.query(
      `SELECT status FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) return true; // no subscription = still in trial period
    return rows[0].status === 'trial' || rows[0].status === 'pending';
  } catch (_) {
    return true; // default to sending the email
  }
}

// ---------------------------------------------------------------------------
// Email generators (type -> template function)
// ---------------------------------------------------------------------------

function getEmailContent(type, userName, plan) {
  switch (type) {
    case 'welcome':   return welcomeEmail(userName);
    case 'first_doc': return firstDocEmail(userName);
    case 'stamp':     return stampEmail(userName);
    case 'share':     return shareEmail(userName);
    case 'upgrade':   return upgradeEmail(userName, plan);
    default:
      throw new Error(`Unknown onboarding email type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Send a single onboarding email
// ---------------------------------------------------------------------------

async function sendOnboardingEmail(db, userId, email, userName, type, recordId) {
  try {
    // Check conditions before sending
    if (type === 'first_doc') {
      const hasDocs = await hasDocuments(db, userId);
      if (hasDocs) {
        logger.info({ userId, type }, 'Onboarding email skipped -- user already uploaded documents');
        await markSkipped(db, recordId);
        return;
      }
    }

    if (type === 'upgrade') {
      const trial = await isOnTrial(db, userId);
      if (!trial) {
        logger.info({ userId, type }, 'Onboarding email skipped -- user not on trial');
        await markSkipped(db, recordId);
        return;
      }
    }

    const { subject, html, text } = getEmailContent(type, userName);
    const sent = await sendEmail(email, subject, html, { text });

    if (sent) {
      await markSent(db, recordId);
      logger.info({ userId, type, email }, 'Onboarding email sent');
    } else {
      // SMTP not configured -- still mark as sent to avoid retry loops
      await markSent(db, recordId);
      logger.info({ userId, type }, 'Onboarding email logged (SMTP not configured)');
    }
  } catch (err) {
    logger.error({ err, userId, type }, 'Failed to send onboarding email');
  }
}

// ---------------------------------------------------------------------------
// Main scheduler
// ---------------------------------------------------------------------------

/**
 * Schedule the full 5-email onboarding sequence for a new user.
 *
 * @param {number} userId  - The user's database ID
 * @param {string} email   - The user's email address
 * @param {string} name    - The user's display name
 * @param {object} [db]    - Optional db instance (for testing); defaults to require('../db')
 */
async function scheduleOnboardingEmails(userId, email, name, dbInstance) {
  const db = dbInstance || require('../db');

  logger.info({ userId, email }, 'Scheduling onboarding email sequence');

  for (const step of SCHEDULE) {
    try {
      // Prevent duplicates (e.g. if signup route is called twice)
      const exists = await alreadyScheduled(db, userId, step.type);
      if (exists) {
        logger.info({ userId, type: step.type }, 'Onboarding email already scheduled -- skipping');
        continue;
      }

      const scheduledAt = new Date(Date.now() + step.delayMs);
      const recordId = await insertEmailRecord(db, userId, step.type, scheduledAt);

      if (step.delayMs === 0) {
        // Send immediately (welcome email)
        await sendOnboardingEmail(db, userId, email, name, step.type, recordId);
      } else {
        // Schedule for later
        const timer = setTimeout(async () => {
          activeTimers.delete(`${userId}-${step.type}`);
          await sendOnboardingEmail(db, userId, email, name, step.type, recordId);
        }, step.delayMs);

        // Unref so timers don't keep the process alive
        if (timer.unref) timer.unref();
        activeTimers.set(`${userId}-${step.type}`, timer);
      }
    } catch (err) {
      logger.error({ err, userId, type: step.type }, 'Failed to schedule onboarding email');
    }
  }
}

/**
 * Cancel all pending onboarding timers for a user.
 * Useful if the user deletes their account.
 */
function cancelOnboardingEmails(userId) {
  for (const step of SCHEDULE) {
    const key = `${userId}-${step.type}`;
    const timer = activeTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(key);
    }
  }
  logger.info({ userId }, 'Cancelled pending onboarding emails');
}

/**
 * Clear all active timers (for graceful shutdown).
 */
function clearAllTimers() {
  for (const [key, timer] of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
}

module.exports = {
  scheduleOnboardingEmails,
  cancelOnboardingEmails,
  clearAllTimers,
};

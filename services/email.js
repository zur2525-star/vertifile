'use strict';

// ---------------------------------------------------------------------------
// Email Setup (Resend -- free tier, 100 emails/day):
//
// 1. Sign up at resend.com
// 2. Add and verify domain vertifile.com (DNS records)
//    - For testing, use onboarding@resend.dev as the sender
// 3. Create an API key in the Resend dashboard
// 4. Set these env vars in .env (or your hosting platform):
//
//    SMTP_HOST=smtp.resend.com
//    SMTP_PORT=465
//    SMTP_USER=resend
//    SMTP_PASS=re_YOUR_API_KEY
//    SMTP_FROM=Vertifile <noreply@vertifile.com>
//
// Notes:
//   - Port 465 uses implicit SSL (nodemailer sets secure:true automatically)
//   - The SMTP_USER is always the literal string "resend"
//   - The SMTP_PASS is your Resend API key (starts with re_)
//   - Free tier: 100 emails/day, 1 custom domain
//   - If SMTP is not configured, emails are logged to console (no crash)
// ---------------------------------------------------------------------------

/**
 * Vertifile -- Email Service
 *
 * Sends transactional emails via SMTP (nodemailer).
 * Configured for Resend (smtp.resend.com:465) but works with any SMTP provider.
 * Fails gracefully if SMTP is not configured -- logs a warning instead of crashing.
 *
 * Required env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * Optional:
 *   SMTP_FROM  (defaults to "Vertifile <noreply@vertifile.com>")
 *
 * Resend-specific error handling:
 *   - 535 / auth failure  -> bad API key
 *   - 429 / rate limit    -> 100/day cap hit (free tier)
 *   - domain not verified -> DNS records missing in Resend dashboard
 */

const logger = require('./logger');

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (_) {
  // nodemailer not installed — all sends will be logged-only
  nodemailer = null;
}

// ---------------------------------------------------------------------------
// Transporter (lazy-initialized on first send)
// ---------------------------------------------------------------------------
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!nodemailer) {
    logger.warn('nodemailer is not installed — emails will be logged only');
    return null;
  }

  if (!host || !user || !pass) {
    logger.warn({ host: !!host, user: !!user, pass: !!pass },
      'SMTP not fully configured — emails will be logged only');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  logger.info({ host, port }, 'SMTP transporter created');
  return _transporter;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_FROM = process.env.SMTP_FROM || 'Vertifile <noreply@vertifile.com>';

/**
 * Send an email.
 * @param {string} to       - Recipient email address
 * @param {string} subject  - Email subject line
 * @param {string} html     - HTML body
 * @param {object} [opts]   - Extra nodemailer options (text, attachments, etc.)
 * @returns {Promise<boolean>} true if sent, false if SMTP not configured (logged)
 */
async function sendEmail(to, subject, html, opts = {}) {
  const transporter = getTransporter();

  if (!transporter) {
    logger.info({ to, subject }, 'EMAIL (not sent — SMTP not configured): would have sent email');
    return false;
  }

  try {
    const info = await transporter.sendMail({
      from: opts.from || DEFAULT_FROM,
      to,
      subject,
      html,
      text: opts.text || undefined,
      ...opts,
    });
    logger.info({ to, subject, messageId: info.messageId }, 'Email sent successfully');
    return true;
  } catch (err) {
    // Detect Resend-specific SMTP errors for clearer logging
    const msg = (err.message || '').toLowerCase();
    const code = err.responseCode || err.code;

    if (code === 535 || msg.includes('authentication') || msg.includes('invalid api key')) {
      logger.error({ err, to, subject },
        'Email auth failed -- check SMTP_PASS (Resend API key must start with re_)');
    } else if (code === 429 || msg.includes('rate limit') || msg.includes('too many')) {
      logger.warn({ err, to, subject },
        'Email rate-limited -- Resend free tier allows 100 emails/day');
    } else if (msg.includes('domain') && (msg.includes('not verified') || msg.includes('not found'))) {
      logger.error({ err, to, subject },
        'Email rejected -- sender domain not verified in Resend (add vertifile.com DNS records)');
    } else if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('timeout')) {
      logger.error({ err, to, subject },
        'Email connection failed -- check SMTP_HOST and SMTP_PORT');
    } else {
      logger.error({ err, to, subject }, 'Failed to send email');
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Password Reset Email Template
// ---------------------------------------------------------------------------

/**
 * Send a password reset email with branded Vertifile template.
 * @param {string} to        - Recipient email
 * @param {string} resetUrl  - Full URL to the reset page with token
 * @param {number} [expiryMinutes=30] - Token lifetime in minutes
 */
async function sendPasswordResetEmail(to, resetUrl, expiryMinutes = 30) {
  const subject = 'Reset your Vertifile password';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin:0;padding:0;background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3f8;padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 40px;text-align:center">
            <img src="https://vertifile.com/images/logo-horizontal.png" alt="Vertifile" height="32" style="height:32px;filter:brightness(0) invert(1)">
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 20px">
            <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#1e1b4b;letter-spacing:-.5px">Reset Your Password</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.7">We received a request to reset the
password for your Vertifile account associated with <strong
style="color:#1e1b4b">${to}</strong>.</p>
            <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.7">Click the button below to set a new
password. This link is valid for <strong
style="color:#1e1b4b">${expiryMinutes} minutes</strong>.</p>

            <!-- CTA Button -->
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px">
              <tr>
                <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:12px;padding:14px 36px">
                  <a href="${resetUrl}" style="color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;display:inline-block">Reset Password</a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 12px;font-size:13px;color:#9ca3af;line-height:1.6">
              If the button doesn't work, copy and paste this link into your browser:
            </p>
            <p style="margin:0 0 28px;font-size:12px;color:#7c3aed;word-break:break-all;line-height:1.5">
              ${resetUrl}
            </p>

            <!-- Divider -->
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px">

            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.7">
              If you did not request a password reset, you can safely ignore this email. Your password will not be changed.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px 32px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">
              &copy; 2026 Vertifile. All rights reserved.<br>
              Tamper-proof document verification.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Reset your Vertifile password

We received a request to reset the password for your Vertifile account (${to}).

Click this link to set a new password (valid for ${expiryMinutes} minutes):
${resetUrl}

If you did not request this, you can safely ignore this email.

-- Vertifile`;

  return sendEmail(to, subject, html, { text });
}

// ---------------------------------------------------------------------------
// Verification Code Email Template
// ---------------------------------------------------------------------------

/**
 * Send a verification code email for onboarding/email confirmation.
 * @param {string} to   - Recipient email
 * @param {string} code - 6-digit verification code
 * @param {number} [expiryMinutes=10] - Code lifetime in minutes
 */
async function sendVerificationCode(to, code, expiryMinutes = 10) {
  const subject = 'Your Vertifile verification code: ' + code;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Code</title>
</head>
<body style="margin:0;padding:0;background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3f8;padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 40px;text-align:center">
            <img src="https://vertifile.com/images/logo-horizontal.png" alt="Vertifile" height="32" style="height:32px;filter:brightness(0) invert(1)">
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 20px">
            <h1 style="margin:0 0 16px;font-size:22px;color:#1e1b2e;font-weight:700">Verify your email</h1>
            <p style="margin:0 0 28px;font-size:15px;color:#4b5563;line-height:1.7">
              Enter this code to continue setting up your Vertifile account. It expires in ${expiryMinutes} minutes.
            </p>
            <div style="text-align:center;margin:0 0 28px">
              <span style="display:inline-block;font-size:36px;font-weight:800;letter-spacing:8px;color:#4f46e5;background:#f4f3f8;border-radius:12px;padding:16px 32px;font-family:'Courier New',monospace">${code}</span>
            </div>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px">
            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.7">
              If you did not request this code, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 32px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">
              &copy; 2026 Vertifile. All rights reserved.<br>
              Tamper-proof document verification.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Your Vertifile verification code: ${code}

Enter this code to verify your email address. It expires in ${expiryMinutes} minutes.

If you did not request this code, you can safely ignore this email.

-- Vertifile`;

  return sendEmail(to, subject, html, { text });
}

// ---------------------------------------------------------------------------
// Welcome Email Template
// ---------------------------------------------------------------------------

/**
 * Send a branded welcome email after registration.
 * @param {string} to       - Recipient email
 * @param {string} userName - Display name of the new user
 */
async function sendWelcomeEmail(to, userName) {
  const subject = 'Welcome to Vertifile';
  const safeName = (userName || 'there').replace(/[<>&"']/g, '');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Vertifile</title>
</head>
<body style="margin:0;padding:0;background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3f8;padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 40px;text-align:center">
            <img src="https://vertifile.com/images/logo-horizontal.png" alt="Vertifile" height="32" style="height:32px;filter:brightness(0) invert(1)">
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 20px">
            <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#1e1b4b;letter-spacing:-.5px">Welcome, ${safeName}!</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.7">
              Your Vertifile account is ready. You now have access to tamper-proof document protection trusted by organizations worldwide.
            </p>
            <p style="margin:0 0 8px;font-size:15px;color:#1e1b4b;font-weight:600">Here is what you can do:</p>
            <ul style="margin:0 0 28px;padding-left:20px;font-size:15px;color:#6b7280;line-height:2">
              <li><strong style="color:#1e1b4b">Upload</strong> any document (PDF, image, or text file)</li>
              <li><strong style="color:#1e1b4b">Protect</strong> it with 7 layers of tamper-proof verification</li>
              <li><strong style="color:#1e1b4b">Share</strong> a secure verification link with anyone</li>
            </ul>

            <!-- CTA Button -->
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px">
              <tr>
                <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:12px;padding:14px 36px">
                  <a href="https://vertifile.com/app" style="color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;display:inline-block">Upload Your First Document</a>
                </td>
              </tr>
            </table>

            <!-- Divider -->
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px">

            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.7">
              If you have any questions, reply to this email or visit our help center at vertifile.com.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px 32px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">
              &copy; 2026 Vertifile. All rights reserved.<br>
              Tamper-proof document verification.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Welcome to Vertifile, ${safeName}!

Your account is ready. Here is what you can do:
- Upload any document (PDF, image, or text file)
- Protect it with 7 layers of tamper-proof verification
- Share a secure verification link with anyone

Get started: https://vertifile.com/app

-- Vertifile`;

  return sendEmail(to, subject, html, { text });
}

// ---------------------------------------------------------------------------
// Document Ready Email Template
// ---------------------------------------------------------------------------

/**
 * Send a notification when a document has been protected.
 * @param {string} to           - Recipient email
 * @param {string} documentName - Original file name
 * @param {string} shareUrl     - Full share URL for the protected document
 */
async function sendDocumentReadyEmail(to, documentName, shareUrl) {
  const safeName = (documentName || 'your document').replace(/[<>&"']/g, '');
  const subject = 'Your document is protected -- ' + safeName;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Protected</title>
</head>
<body style="margin:0;padding:0;background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3f8;padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 40px;text-align:center">
            <img src="https://vertifile.com/images/logo-horizontal.png" alt="Vertifile" height="32" style="height:32px;filter:brightness(0) invert(1)">
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 20px">
            <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#1e1b4b;letter-spacing:-.5px">Document Protected</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.7">
              <strong style="color:#1e1b4b">${safeName}</strong> is now tamper-proof, secured with 7 layers of cryptographic verification. Any modification to the document will be detected instantly.
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.7">
              Share the link below with anyone who needs to verify the authenticity of this document.
            </p>

            <!-- CTA Button -->
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px">
              <tr>
                <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:12px;padding:14px 36px">
                  <a href="${shareUrl}" style="color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;display:inline-block">View Protected Document</a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 12px;font-size:13px;color:#9ca3af;line-height:1.6">
              Or copy this link:
            </p>
            <p style="margin:0 0 28px;font-size:12px;color:#7c3aed;word-break:break-all;line-height:1.5">
              ${shareUrl}
            </p>

            <!-- Divider -->
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px">

            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.7">
              You can manage all your protected documents from your dashboard at vertifile.com/app.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px 32px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">
              &copy; 2026 Vertifile. All rights reserved.<br>
              Tamper-proof document verification.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Document Protected: ${safeName}

Your document is now tamper-proof, secured with 7 layers of cryptographic verification.

View your protected document: ${shareUrl}

You can manage all your protected documents from your dashboard at vertifile.com/app.

-- Vertifile`;

  return sendEmail(to, subject, html, { text });
}

// ---------------------------------------------------------------------------
// Contact Confirmation Email Template
// ---------------------------------------------------------------------------

/**
 * Send a confirmation email after a contact form submission.
 * @param {string} to   - Recipient email
 * @param {string} name - Name of the person who submitted the form
 */
async function sendContactConfirmationEmail(to, name) {
  const safeName = (name || 'there').replace(/[<>&"']/g, '');
  const subject = 'We received your message -- Vertifile';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Message Received</title>
</head>
<body style="margin:0;padding:0;background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3f8;padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 40px;text-align:center">
            <img src="https://vertifile.com/images/logo-horizontal.png" alt="Vertifile" height="32" style="height:32px;filter:brightness(0) invert(1)">
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 20px">
            <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#1e1b4b;letter-spacing:-.5px">Thank you, ${safeName}</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.7">
              We have received your message and appreciate you reaching out to us.
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.7">
              Our team will review your inquiry and get back to you within <strong style="color:#1e1b4b">24 hours</strong>. If your matter is urgent, please reply directly to this email.
            </p>

            <!-- Divider -->
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px">

            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.7">
              This is an automated confirmation. You do not need to reply unless you have additional information to share.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px 32px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">
              &copy; 2026 Vertifile. All rights reserved.<br>
              Tamper-proof document verification.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Thank you, ${safeName}

We have received your message and appreciate you reaching out to us.

Our team will review your inquiry and get back to you within 24 hours. If your matter is urgent, please reply directly to this email.

-- Vertifile`;

  return sendEmail(to, subject, html, { text });
}

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
  sendVerificationCode,
  sendWelcomeEmail,
  sendDocumentReadyEmail,
  sendContactConfirmationEmail,
};

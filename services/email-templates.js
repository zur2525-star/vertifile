'use strict';

/**
 * Vertifile -- Email Onboarding Templates
 *
 * Five branded HTML emails for the post-signup onboarding sequence.
 * Each function returns { subject, html, text } so the caller can
 * pass them straight to services/email.js -> sendEmail().
 *
 * Design tokens match the reset-password template in email.js:
 *   - Purple gradient header (#4f46e5 -> #7c3aed)
 *   - White card, 560px max-width, 16px border-radius
 *   - CTA button with purple gradient, 12px radius
 */

const BASE_URL = process.env.BASE_URL || 'https://vertifile.com';

// ---------------------------------------------------------------------------
// Shared layout helpers
// ---------------------------------------------------------------------------

function layout(title, bodyHtml, bodyText) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Roboto,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3f8;padding:40px 20px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 40px;text-align:center">
            <img src="${BASE_URL}/images/logo-horizontal.png" alt="Vertifile" height="32" style="height:32px;filter:brightness(0) invert(1)">
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 20px">
            ${bodyHtml}
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

  return { html, text: bodyText };
}

function ctaButton(href, label) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px">
  <tr>
    <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:12px;padding:14px 36px">
      <a href="${href}" style="color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;display:inline-block">${label}</a>
    </td>
  </tr>
</table>`;
}

function heading(text) {
  return `<h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#1e1b4b;letter-spacing:-.5px">${text}</h1>`;
}

function paragraph(text) {
  return `<p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.7">${text}</p>`;
}

function divider() {
  return '<hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px">';
}

function greeting(userName) {
  const name = userName || 'there';
  return `Hi ${name},`;
}

// ---------------------------------------------------------------------------
// Email 1 -- Welcome (sent immediately after signup)
// ---------------------------------------------------------------------------

function welcomeEmail(userName) {
  const subject = 'Welcome to Vertifile -- Your documents just got superpowers';

  const bodyHtml = `
    ${heading('Welcome to Vertifile')}
    ${paragraph(`${greeting(userName)}`)}
    ${paragraph('You just joined the future of document trust. Vertifile lets you protect, stamp, and verify any document -- so every file you send proves it\'s real.')}
    ${paragraph('<strong style="color:#1e1b4b">Here\'s what to do first:</strong> Upload your first document to see the magic. It takes about 60 seconds.')}
    ${ctaButton(`${BASE_URL}/app`, 'Go to Your Dashboard')}
    ${divider()}
    ${paragraph('Need help? Reply to this email -- we read every message.')}
  `;

  const text = `Welcome to Vertifile

${greeting(userName)}

You just joined the future of document trust. Vertifile lets you protect, stamp, and verify any document -- so every file you send proves it's real.

Here's what to do first: Upload your first document to see the magic. It takes about 60 seconds.

Go to your dashboard: ${BASE_URL}/app

Need help? Reply to this email -- we read every message.

-- Vertifile`;

  const result = layout('Welcome to Vertifile', bodyHtml, text);
  return { subject, html: result.html, text: result.text };
}

// ---------------------------------------------------------------------------
// Email 2 -- First document (sent 24h after signup if no upload yet)
// ---------------------------------------------------------------------------

function firstDocEmail(userName) {
  const subject = 'Protect your first document in 60 seconds';

  const bodyHtml = `
    ${heading('Protect Your First Document')}
    ${paragraph(`${greeting(userName)}`)}
    ${paragraph('You signed up for Vertifile but haven\'t uploaded a document yet. It only takes 60 seconds to see what tamper-proof verification looks like.')}

    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px;width:100%">
      <tr>
        <td style="padding:20px 24px;background:#f8f7ff;border-radius:12px;border-left:4px solid #7c3aed">
          <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1e1b4b">3 simple steps:</p>
          <p style="margin:0 0 4px;font-size:14px;color:#6b7280;line-height:1.7">1. Click <strong style="color:#4f46e5">Upload</strong> on your dashboard</p>
          <p style="margin:0 0 4px;font-size:14px;color:#6b7280;line-height:1.7">2. Drop any PDF, image, or document</p>
          <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.7">3. Get your verified file with a Vertifile stamp</p>
        </td>
      </tr>
    </table>

    ${ctaButton(`${BASE_URL}/app`, 'Upload Your First Document')}
    ${divider()}
    ${paragraph('Your verified document includes a cryptographic signature that anyone can check -- no account needed on their end.')}
  `;

  const text = `Protect Your First Document

${greeting(userName)}

You signed up for Vertifile but haven't uploaded a document yet. It only takes 60 seconds to see what tamper-proof verification looks like.

3 simple steps:
1. Click Upload on your dashboard
2. Drop any PDF, image, or document
3. Get your verified file with a Vertifile stamp

Upload your first document: ${BASE_URL}/app

Your verified document includes a cryptographic signature that anyone can check -- no account needed on their end.

-- Vertifile`;

  const result = layout('Protect Your First Document', bodyHtml, text);
  return { subject, html: result.html, text: result.text };
}

// ---------------------------------------------------------------------------
// Email 3 -- Stamp customization (sent 3 days after signup)
// ---------------------------------------------------------------------------

function stampEmail(userName) {
  const subject = 'Make it yours -- customize your Vertifile stamp';

  const bodyHtml = `
    ${heading('Make Your Stamp Yours')}
    ${paragraph(`${greeting(userName)}`)}
    ${paragraph('Every document you protect gets a Vertifile verification stamp. You can customize it to match your brand:')}

    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px;width:100%">
      <tr>
        <td style="padding:20px 24px;background:#f8f7ff;border-radius:12px">
          <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%">
            <tr>
              <td style="padding:0 0 12px;font-size:14px;color:#6b7280;line-height:1.7">
                <strong style="color:#4f46e5">Your logo</strong> -- Upload your company or personal logo
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 12px;font-size:14px;color:#6b7280;line-height:1.7">
                <strong style="color:#4f46e5">Accent color</strong> -- Pick a color that matches your brand
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 12px;font-size:14px;color:#6b7280;line-height:1.7">
                <strong style="color:#4f46e5">Wave pattern</strong> -- Choose the wave color on your stamp
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;color:#6b7280;line-height:1.7">
                <strong style="color:#4f46e5">Stamp size</strong> -- Small, medium, or large
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${ctaButton(`${BASE_URL}/app?tab=stamp`, 'Customize Your Stamp')}
    ${divider()}
    ${paragraph('A branded stamp makes your verified documents look professional and instantly recognizable.')}
  `;

  const text = `Make Your Stamp Yours

${greeting(userName)}

Every document you protect gets a Vertifile verification stamp. You can customize it to match your brand:

- Your logo -- Upload your company or personal logo
- Accent color -- Pick a color that matches your brand
- Wave pattern -- Choose the wave color on your stamp
- Stamp size -- Small, medium, or large

Customize your stamp: ${BASE_URL}/app?tab=stamp

A branded stamp makes your verified documents look professional and instantly recognizable.

-- Vertifile`;

  const result = layout('Customize Your Vertifile Stamp', bodyHtml, text);
  return { subject, html: result.html, text: result.text };
}

// ---------------------------------------------------------------------------
// Email 4 -- Share & verify (sent 5 days after signup)
// ---------------------------------------------------------------------------

function shareEmail(userName) {
  const subject = 'Share a document that proves itself';

  const bodyHtml = `
    ${heading('Share With Confidence')}
    ${paragraph(`${greeting(userName)}`)}
    ${paragraph('The real power of Vertifile is sharing. When you send a verified document, the recipient can instantly confirm it hasn\'t been tampered with -- no account required.')}

    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px;width:100%">
      <tr>
        <td style="padding:20px 24px;background:#f8f7ff;border-radius:12px;border-left:4px solid #7c3aed">
          <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1e1b4b">What the recipient sees:</p>
          <p style="margin:0 0 4px;font-size:14px;color:#6b7280;line-height:1.7">A clear verification badge confirming the document is authentic</p>
          <p style="margin:0 0 4px;font-size:14px;color:#6b7280;line-height:1.7">Your stamp with your branding</p>
          <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.7">Cryptographic proof -- not just a visual seal, but a verifiable signature</p>
        </td>
      </tr>
    </table>

    ${ctaButton(`${BASE_URL}/app`, 'Share Your First Document')}
    ${divider()}
    ${paragraph('Documents flow between hospitals, universities, employers, and insurers every day -- mostly unsecured. Vertifile changes that.')}
  `;

  const text = `Share With Confidence

${greeting(userName)}

The real power of Vertifile is sharing. When you send a verified document, the recipient can instantly confirm it hasn't been tampered with -- no account required.

What the recipient sees:
- A clear verification badge confirming the document is authentic
- Your stamp with your branding
- Cryptographic proof -- not just a visual seal, but a verifiable signature

Share your first document: ${BASE_URL}/app

Documents flow between hospitals, universities, employers, and insurers every day -- mostly unsecured. Vertifile changes that.

-- Vertifile`;

  const result = layout('Share a Verified Document', bodyHtml, text);
  return { subject, html: result.html, text: result.text };
}

// ---------------------------------------------------------------------------
// Email 5 -- Upgrade prompt (sent 7 days after signup, trial users only)
// ---------------------------------------------------------------------------

function upgradeEmail(userName, plan) {
  const subject = 'Your trial is ending -- keep your documents protected';
  const currentPlan = plan || 'trial';

  const bodyHtml = `
    ${heading('Your Trial Is Ending Soon')}
    ${paragraph(`${greeting(userName)}`)}
    ${paragraph('Your Vertifile trial wraps up soon. To keep protecting and verifying your documents, choose the plan that fits you best.')}

    <!-- Plan comparison -->
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px;width:100%">
      <!-- Pro -->
      <tr>
        <td style="padding:20px 24px;background:#f8f7ff;border-radius:12px 12px 0 0;border-bottom:1px solid #e5e7eb">
          <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%">
            <tr>
              <td>
                <p style="margin:0 0 4px;font-size:18px;font-weight:800;color:#1e1b4b">Pro</p>
                <p style="margin:0 0 8px;font-size:24px;font-weight:800;color:#4f46e5">$49<span style="font-size:14px;font-weight:400;color:#6b7280">/month</span></p>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#6b7280;line-height:1.7">
                Up to 500 documents/month<br>
                Custom stamp branding<br>
                Share links with verification<br>
                Email support
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <!-- Business -->
      <tr>
        <td style="padding:20px 24px;background:#f0eeff;border-radius:0 0 12px 12px;border:2px solid #7c3aed">
          <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%">
            <tr>
              <td>
                <p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:1px">Most popular</p>
                <p style="margin:0 0 4px;font-size:18px;font-weight:800;color:#1e1b4b">Business</p>
                <p style="margin:0 0 8px;font-size:24px;font-weight:800;color:#4f46e5">$79<span style="font-size:14px;font-weight:400;color:#6b7280">/month</span></p>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#6b7280;line-height:1.7">
                Unlimited documents<br>
                Custom stamp branding<br>
                Team accounts &amp; roles<br>
                API access<br>
                Priority support
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;text-align:center">Need more? <a href="${BASE_URL}/pricing#enterprise" style="color:#7c3aed;text-decoration:underline">Enterprise</a> plans with custom pricing available.</p>

    ${ctaButton(`${BASE_URL}/app?tab=billing`, 'Choose Your Plan')}
    ${divider()}
    ${paragraph('After your trial ends, you won\'t be able to upload new documents or generate share links. Your existing verified documents remain valid forever.')}
  `;

  const text = `Your Trial Is Ending Soon

${greeting(userName)}

Your Vertifile trial wraps up soon. To keep protecting and verifying your documents, choose the plan that fits you best.

Pro -- $49/month
- Up to 500 documents/month
- Custom stamp branding
- Share links with verification
- Email support

Business -- $79/month (Most popular)
- Unlimited documents
- Custom stamp branding
- Team accounts & roles
- API access
- Priority support

Need more? Enterprise plans with custom pricing available.

Choose your plan: ${BASE_URL}/app?tab=billing

After your trial ends, you won't be able to upload new documents or generate share links. Your existing verified documents remain valid forever.

-- Vertifile`;

  const result = layout('Your Trial Is Ending', bodyHtml, text);
  return { subject, html: result.html, text: result.text };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  welcomeEmail,
  firstDocEmail,
  stampEmail,
  shareEmail,
  upgradeEmail,
};

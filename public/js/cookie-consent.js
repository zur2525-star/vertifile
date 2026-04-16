/**
 * Vertifile Cookie Consent Banner
 * Informational banner for essential cookies only (GDPR compliant).
 * Self-contained: no external CSS dependencies.
 */
(function() {
  'use strict';

  var STORAGE_KEY = 'vf-cookie-consent-dismissed';
  var DISMISS_DAYS = 7;

  // Check if already dismissed
  try {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      var ts = parseInt(stored, 10);
      if (!isNaN(ts) && (Date.now() - ts) < DISMISS_DAYS * 24 * 60 * 60 * 1000) {
        return;
      }
      // Expired — remove and show again
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    // localStorage unavailable — show banner anyway
  }

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch (e) {
      // Ignore storage errors
    }
    var banner = document.getElementById('vf-cookie-banner');
    if (banner) {
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(100%)';
      setTimeout(function() {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
      }, 300);
    }
  }

  function createBanner() {
    var isRTL = document.documentElement.dir === 'rtl';

    var banner = document.createElement('div');
    banner.id = 'vf-cookie-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-label', 'Cookie notice');

    // Close icon SVG
    var closeSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;display:block"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    banner.innerHTML =
      '<div id="vf-cookie-inner">' +
        '<p id="vf-cookie-text">' +
          'This site uses essential cookies for authentication. No tracking cookies are used. ' +
          '<a href="/cookie-policy" id="vf-cookie-link">Learn more</a>' +
        '</p>' +
        '<div id="vf-cookie-actions">' +
          '<button id="vf-cookie-accept" type="button">Got it</button>' +
          '<button id="vf-cookie-close" type="button" aria-label="Close">' + closeSVG + '</button>' +
        '</div>' +
      '</div>';

    // Inject styles
    var style = document.createElement('style');
    style.textContent =
      '#vf-cookie-banner{' +
        'position:fixed;bottom:0;left:0;right:0;z-index:9999;' +
        'background:rgba(17,14,47,0.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'border-top:1px solid rgba(124,58,237,0.2);' +
        'padding:16px 24px;' +
        'font-family:Inter,Heebo,-apple-system,sans-serif;' +
        'transition:opacity 0.3s ease,transform 0.3s ease;' +
        'opacity:0;transform:translateY(100%)' +
      '}' +
      '#vf-cookie-banner.vf-cb-visible{opacity:1;transform:translateY(0)}' +
      '#vf-cookie-inner{' +
        'max-width:1200px;margin:0 auto;' +
        'display:flex;align-items:center;justify-content:space-between;gap:20px;' +
        'direction:' + (isRTL ? 'rtl' : 'ltr') +
      '}' +
      '#vf-cookie-text{' +
        'color:rgba(226,224,240,0.85);font-size:14px;line-height:1.6;margin:0;flex:1;' +
        'text-align:' + (isRTL ? 'right' : 'left') +
      '}' +
      '#vf-cookie-link{' +
        'color:#a78bfa;text-decoration:underline;text-underline-offset:2px;transition:color 0.2s' +
      '}' +
      '#vf-cookie-link:hover{color:#c4b5fd}' +
      '#vf-cookie-actions{display:flex;align-items:center;gap:12px;flex-shrink:0}' +
      '#vf-cookie-accept{' +
        'padding:8px 24px;background:linear-gradient(135deg,#4f46e5,#7c3aed);' +
        'color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;' +
        'cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;white-space:nowrap;' +
        'font-family:inherit' +
      '}' +
      '#vf-cookie-accept:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(124,58,237,0.3)}' +
      '#vf-cookie-accept:focus-visible{outline:2px solid #7c3aed;outline-offset:2px}' +
      '#vf-cookie-close{' +
        'background:none;border:none;cursor:pointer;padding:4px;color:rgba(196,181,253,0.5);' +
        'transition:color 0.2s;display:flex;align-items:center;justify-content:center' +
      '}' +
      '#vf-cookie-close:hover{color:#fff}' +
      '#vf-cookie-close:focus-visible{outline:2px solid #7c3aed;outline-offset:2px}' +
      '@media(max-width:600px){' +
        '#vf-cookie-inner{flex-direction:column;align-items:stretch;gap:12px;text-align:center}' +
        '#vf-cookie-text{text-align:center}' +
        '#vf-cookie-actions{justify-content:center}' +
      '}';

    document.head.appendChild(style);
    document.body.appendChild(banner);

    // Bind events
    document.getElementById('vf-cookie-accept').addEventListener('click', dismiss);
    document.getElementById('vf-cookie-close').addEventListener('click', dismiss);

    // Animate in after a short delay
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        banner.classList.add('vf-cb-visible');
      });
    });

    // Auto-dismiss after 7 days worth of seconds is not practical client-side.
    // Instead, auto-dismiss after 15 seconds of inactivity on the page
    // (the localStorage timestamp handles the 7-day suppression).
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createBanner);
  } else {
    createBanner();
  }
})();

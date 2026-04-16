// Vertifile CSRF token management.
// Fetches a CSRF token from the server on load and patches window.fetch
// so every state-changing request (POST, PUT, DELETE) automatically
// includes the X-CSRF-Token header. No per-page wiring needed.

(function() {
  'use strict';

  var csrfToken = null;

  function fetchCsrfToken() {
    return fetch('/api/csrf-token', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success && data.csrfToken) {
          csrfToken = data.csrfToken;
        }
      })
      .catch(function() {
        // Silent — CSRF token will be retried on 403
      });
  }

  // Patch fetch to inject the CSRF header on mutating requests
  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    init = init || {};
    var method = (init.method || 'GET').toUpperCase();

    if (csrfToken && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
      // Only inject for same-origin requests (not external APIs)
      var url = (typeof input === 'string') ? input : (input.url || '');
      var isSameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);

      if (isSameOrigin) {
        // For FormData bodies, use the header (not a hidden field).
        // For JSON bodies, also use the header.
        if (!init.headers) {
          init.headers = {};
        }
        // Handle Headers object, plain object, or array
        if (init.headers instanceof Headers) {
          if (!init.headers.has('X-CSRF-Token')) {
            init.headers.set('X-CSRF-Token', csrfToken);
          }
        } else if (Array.isArray(init.headers)) {
          var hasToken = init.headers.some(function(h) {
            return h[0] && h[0].toLowerCase() === 'x-csrf-token';
          });
          if (!hasToken) {
            init.headers.push(['X-CSRF-Token', csrfToken]);
          }
        } else {
          // Plain object
          if (!init.headers['X-CSRF-Token']) {
            init.headers['X-CSRF-Token'] = csrfToken;
          }
        }
      }
    }

    return originalFetch.call(this, input, init).then(function(response) {
      // If we get a 403 with CSRF error, re-fetch the token and retry once
      if (response.status === 403 && csrfToken) {
        return response.clone().json().then(function(data) {
          if (data.error && data.error.indexOf('CSRF') !== -1) {
            return fetchCsrfToken().then(function() {
              // Update the header with the new token
              if (init.headers instanceof Headers) {
                init.headers.set('X-CSRF-Token', csrfToken);
              } else if (Array.isArray(init.headers)) {
                var idx = -1;
                init.headers.forEach(function(h, i) {
                  if (h[0] && h[0].toLowerCase() === 'x-csrf-token') idx = i;
                });
                if (idx >= 0) init.headers[idx][1] = csrfToken;
                else init.headers.push(['X-CSRF-Token', csrfToken]);
              } else if (init.headers) {
                init.headers['X-CSRF-Token'] = csrfToken;
              }
              return originalFetch.call(window, input, init);
            });
          }
          return response;
        }).catch(function() {
          // If the body was not JSON, return the original response
          return response;
        });
      }
      return response;
    });
  };

  // Expose for manual use if needed
  window.__csrfToken = function() { return csrfToken; };
  window.__refreshCsrfToken = fetchCsrfToken;

  // Fetch token on load
  fetchCsrfToken();
})();

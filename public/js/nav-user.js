/**
 * Vertifile — Nav User Button with Dropdown
 * Shows logged-in user's avatar/initials in the navbar with a dropdown
 * menu for quick navigation (Dashboard, Documents, Upload, Logout).
 * Include on every page: <script src="/js/nav-user.js"></script>
 */
(function(){
  var btn = document.querySelector('.nav-user');
  if (!btn) return;

  // Inject dropdown styles once per page
  if (!document.getElementById('vf-nav-user-styles')) {
    var style = document.createElement('style');
    style.id = 'vf-nav-user-styles';
    style.textContent =
      '.vf-user-menu-wrap{position:relative;display:inline-block}' +
      '.vf-user-menu{position:absolute;top:calc(100% + 10px);min-width:220px;' +
        'background:#fff;border:1px solid rgba(124,58,237,.15);border-radius:12px;' +
        'box-shadow:0 8px 32px rgba(0,0,0,.12),0 2px 8px rgba(124,58,237,.08);' +
        'padding:8px;opacity:0;visibility:hidden;transform:translateY(-8px);' +
        'transition:opacity .18s ease,transform .18s ease,visibility .18s ease;z-index:9999}' +
      'html[dir="rtl"] .vf-user-menu{left:0;right:auto}' +
      'html:not([dir="rtl"]) .vf-user-menu{right:0;left:auto}' +
      '.vf-user-menu.open{opacity:1;visibility:visible;transform:translateY(0)}' +
      '.vf-user-menu-header{padding:10px 12px 12px;border-bottom:1px solid rgba(124,58,237,.08);margin-bottom:6px}' +
      '.vf-user-menu-name{font-size:14px;font-weight:700;color:#1e1b4b;margin:0;line-height:1.3;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.vf-user-menu-email{font-size:12px;color:#6b7280;margin:2px 0 0;line-height:1.3;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.vf-user-menu-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;' +
        'font-size:14px;color:#1e1b4b;text-decoration:none;cursor:pointer;border:none;background:none;' +
        'width:100%;text-align:inherit;font-family:inherit;transition:background .15s ease,color .15s ease}' +
      '.vf-user-menu-item:hover{background:rgba(124,58,237,.06);color:#7c3aed}' +
      '.vf-user-menu-item svg{width:16px;height:16px;flex-shrink:0}' +
      '.vf-user-menu-divider{height:1px;background:rgba(124,58,237,.08);margin:6px 0}' +
      '.vf-user-menu-item.vf-logout{color:#dc2626}' +
      '.vf-user-menu-item.vf-logout:hover{background:rgba(220,38,38,.06);color:#b91c1c}';
    document.head.appendChild(style);
  }

  var userData = null;

  fetch('/api/user/me', { credentials: 'same-origin' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      if (!data || !data.success || !data.user) return;
      userData = data.user;
      mountMenu();
    })
    .catch(function(){});

  function t(key, fallback) {
    // Use i18n if available, fallback to provided English string
    if (typeof window.vfGetTranslation === 'function') {
      var v = window.vfGetTranslation(key);
      if (v && v !== key) return v;
    }
    return fallback;
  }

  function mountMenu() {
    var u = userData;
    var initial = (u.name || u.email || '?').charAt(0).toUpperCase();

    // Update avatar
    if (u.avatar) {
      btn.innerHTML = '<img src="' + u.avatar + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover" alt="">';
      btn.style.border = 'none';
      btn.style.padding = '0';
    } else {
      btn.innerHTML = '<span style="font-size:14px;font-weight:700;color:#fff">' + initial + '</span>';
      btn.style.background = '#7c3aed';
      btn.style.border = '2px solid #7c3aed';
      btn.style.color = '#fff';
    }
    btn.title = u.name || u.email || 'My Account';

    // Convert anchor to a button-like element: prevent navigation, open menu
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('tabindex', '0');

    // Wrap the button in a positioned container so the menu anchors correctly
    var wrap = document.createElement('div');
    wrap.className = 'vf-user-menu-wrap';
    if (btn.parentNode) {
      btn.parentNode.insertBefore(wrap, btn);
      wrap.appendChild(btn);
    }

    // Build menu element
    var menu = document.createElement('div');
    menu.className = 'vf-user-menu';
    menu.setAttribute('role', 'menu');

    var safeName = escapeHtml(u.name || u.email || 'User');
    var safeEmail = escapeHtml(u.email || '');

    menu.innerHTML =
      '<div class="vf-user-menu-header">' +
        '<p class="vf-user-menu-name">' + safeName + '</p>' +
        (safeEmail && safeEmail !== safeName
          ? '<p class="vf-user-menu-email">' + safeEmail + '</p>'
          : '') +
      '</div>' +
      '<a href="/app" class="vf-user-menu-item" role="menuitem">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' +
        '<span>' + t('navUser.dashboard', 'Dashboard') + '</span>' +
      '</a>' +
      '<a href="/app?tab=documents" class="vf-user-menu-item" role="menuitem">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>' +
        '<span>' + t('navUser.documents', 'My Documents') + '</span>' +
      '</a>' +
      '<a href="/upload" class="vf-user-menu-item" role="menuitem">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
        '<span>' + t('navUser.upload', 'Protect a Document') + '</span>' +
      '</a>' +
      '<a href="/app?tab=settings" class="vf-user-menu-item" role="menuitem">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>' +
        '<span>' + t('navUser.settings', 'Settings') + '</span>' +
      '</a>' +
      '<div class="vf-user-menu-divider"></div>' +
      '<button type="button" class="vf-user-menu-item vf-logout" role="menuitem" id="vfUserLogoutBtn">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
        '<span>' + t('navUser.logout', 'Log Out') + '</span>' +
      '</button>';

    wrap.appendChild(menu);

    function openMenu() {
      menu.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
    function toggleMenu() {
      if (menu.classList.contains('open')) closeMenu();
      else openMenu();
    }

    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });
    btn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleMenu();
      } else if (e.key === 'Escape') {
        closeMenu();
      }
    });

    // Close on outside click
    document.addEventListener('click', function(e) {
      if (!wrap.contains(e.target)) closeMenu();
    });

    // Logout button
    var logoutBtn = menu.querySelector('#vfUserLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function() {
        closeMenu();
        try {
          await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } catch (_) { /* best effort */ }
        window.location.href = '/';
      });
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();

/**
 * Vertifile — Nav User Button
 * Shows logged-in user's avatar/initials in the navbar.
 * Include on every page: <script src="/js/nav-user.js"></script>
 */
(function(){
  var btn = document.querySelector('.nav-user');
  if (!btn) return;

  fetch('/api/user/profile', { credentials: 'same-origin' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      if (!data || !data.success || !data.user) return;
      var u = data.user;
      var initial = (u.name || u.email || '?').charAt(0).toUpperCase();

      // Replace icon with avatar or initial
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
    })
    .catch(function(){});
})();

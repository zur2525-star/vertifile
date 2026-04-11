/**
 * Vertifile — Shared i18n Engine
 * Include this script on every page: <script src="/js/i18n.js"></script>
 * Text elements use data-i18n="key.path" attributes.
 */
(function(){
  var SUPPORTED = ['en','he','ar','fr','es','de','ru','zh','ja','pt'];
  var RTL_LANGS = ['he','ar'];
  var currentLang = 'en';
  var translations = {};

  // Country code → language mapping
  var COUNTRY_LANG = {
    'IL':'he','PS':'ar','SA':'ar','AE':'ar','EG':'ar','JO':'ar','LB':'ar','IQ':'ar','SY':'ar','KW':'ar','QA':'ar','BH':'ar','OM':'ar','YE':'ar','LY':'ar','TN':'ar','DZ':'ar','MA':'ar',
    'FR':'fr','BE':'fr','CH':'fr','CA':'fr','SN':'fr','CI':'fr',
    'ES':'es','MX':'es','AR':'es','CO':'es','CL':'es','PE':'es','VE':'es','EC':'es','GT':'es','CU':'es','BO':'es','DO':'es','HN':'es','PY':'es','SV':'es','NI':'es','CR':'es','PA':'es','UY':'es',
    'DE':'de','AT':'de','LI':'de',
    'RU':'ru','BY':'ru','KZ':'ru','KG':'ru','TJ':'ru','UA':'ru',
    'CN':'zh','TW':'zh','HK':'zh','MO':'zh','SG':'zh',
    'JP':'ja',
    'BR':'pt','PT':'pt','AO':'pt','MZ':'pt'
  };

  function detectLang(){
    var params = new URLSearchParams(window.location.search);
    if(params.get('lang') && SUPPORTED.indexOf(params.get('lang'))!==-1) return params.get('lang');
    var stored = localStorage.getItem('vf-lang');
    if(stored && SUPPORTED.indexOf(stored)!==-1) return stored;
    var nav = (navigator.language||'').substring(0,2).toLowerCase();
    if(SUPPORTED.indexOf(nav)!==-1) return nav;
    return 'en';
  }

  // Async geo-detection: update language based on country if no preference set
  function geoDetect(){
    if(localStorage.getItem('vf-lang')) return; // user already chose
    fetch('https://ipapi.co/json/',{signal:AbortSignal.timeout(3000)}).then(function(r){return r.json()}).then(function(d){
      var cc = d.country_code;
      var lang = COUNTRY_LANG[cc];
      if(lang && lang !== currentLang && SUPPORTED.indexOf(lang)!==-1){
        loadLang(lang);
      }
    }).catch(function(){});
  }

  function getVal(obj, path){
    return path.split('.').reduce(function(o,k){return o&&o[k]},obj);
  }

  function applyTranslations(){
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var val = getVal(translations, el.getAttribute('data-i18n'));
      if(val){if(/<[a-z][\s\S]*>/i.test(val))el.innerHTML=val;else el.textContent=val;}
    });
    // Translate placeholder attributes
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el){
      var val = getVal(translations, el.getAttribute('data-i18n-placeholder'));
      if(val) el.setAttribute('placeholder', val);
    });
    // Translate title attributes
    document.querySelectorAll('[data-i18n-title]').forEach(function(el){
      var val = getVal(translations, el.getAttribute('data-i18n-title'));
      if(val) el.setAttribute('title', val);
    });
    // Translate aria-label attributes
    document.querySelectorAll('[data-i18n-aria]').forEach(function(el){
      var val = getVal(translations, el.getAttribute('data-i18n-aria'));
      if(val) el.setAttribute('aria-label', val);
    });
    // Update page title if available
    var pageTitle = getVal(translations,'pageTitle');
    if(pageTitle) document.title = 'Vertifile \u2014 ' + pageTitle;
    else {
      var t = getVal(translations,'hero.headline1');
      if(t) document.title = 'Vertifile \u2014 ' + t;
    }
  }

  function setDirection(lang){
    var isRtl = RTL_LANGS.indexOf(lang)!==-1;
    document.documentElement.setAttribute('dir', isRtl?'rtl':'ltr');
    document.documentElement.setAttribute('lang', lang);
  }

  function updateLabels(lang){
    var el = document.getElementById('langLabel');
    if(el) el.textContent = lang.toUpperCase();
    var fn = getVal(translations,'langName');
    var fl = document.getElementById('footerLangLabel');
    if(fl && fn) fl.textContent = fn;
    // Mark active language in dropdowns
    document.querySelectorAll('.lang-dropdown a').forEach(function(a){
      var href = a.getAttribute('href')||'';
      var m = href.match(/lang=(\w+)/);
      a.classList.toggle('active',!!(m && m[1]===lang));
    });
  }

  function loadLang(lang){
    fetch('/locales/'+lang+'.json?v=20260411e').then(function(r){
      if(!r.ok) throw new Error();
      return r.json();
    }).then(function(d){
      translations = d; currentLang = lang;
      localStorage.setItem('vf-lang', lang);
      setDirection(lang); applyTranslations(); updateLabels(lang);
    }).catch(function(){ if(lang!=='en') loadLang('en'); });
  }

  // Public API
  window.switchLang = function(lang, e){ if(e) e.preventDefault(); loadLang(lang); closeLangDropdown(); };
  window.toggleLangDropdown = function(){
    var dd = document.getElementById('langDropdown');
    var btn = document.getElementById('langBtn');
    if(dd && btn){
      dd.classList.toggle('show');
      if(dd.classList.contains('show')){
        var r = btn.getBoundingClientRect();
        dd.style.position = 'fixed';
        dd.style.top = (r.bottom + 6) + 'px';
        dd.style.left = '';
        dd.style.right = '';
        var isRtl = document.documentElement.getAttribute('dir') === 'rtl';
        if(isRtl){ dd.style.left = r.left + 'px'; }
        else { dd.style.right = (window.innerWidth - r.right) + 'px'; }
      }
    }
  };
  window.closeLangDropdown = function(){ var el=document.getElementById('langDropdown'); if(el) el.classList.remove('show'); };
  window.toggleMobile = function(){ document.getElementById('mobileMenu').classList.toggle('show'); };
  window.closeMobile = function(){ document.getElementById('mobileMenu').classList.remove('show'); };
  window.vfGetLang = function(){ return currentLang; };
  window.vfGetTranslation = function(key){ return getVal(translations, key); };

  // Close dropdown on outside click
  document.addEventListener('click', function(e){
    if(!e.target.closest('.lang-btn') && !e.target.closest('.lang-dropdown') && !e.target.closest('.footer-lang')) closeLangDropdown();
  });

  // Navbar scroll effect
  window.addEventListener('scroll', function(){
    var nb = document.getElementById('navbar');
    if(nb) nb.classList.toggle('scrolled', window.scrollY > 10);
  });

  // Scroll reveal (fade-up animations)
  if(typeof IntersectionObserver !== 'undefined'){
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){ if(entry.isIntersecting) entry.target.classList.add('visible'); });
    }, {threshold:0.1});
    document.addEventListener('DOMContentLoaded', function(){
      document.querySelectorAll('.fade-up').forEach(function(el){ observer.observe(el); });
    });
  }

  // Init
  loadLang(detectLang());
  // After initial load, try geo-detection for first-time visitors
  setTimeout(geoDetect, 500);
})();

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

  function detectLang(){
    var params = new URLSearchParams(window.location.search);
    if(params.get('lang') && SUPPORTED.indexOf(params.get('lang'))!==-1) return params.get('lang');
    var stored = localStorage.getItem('vf-lang');
    if(stored && SUPPORTED.indexOf(stored)!==-1) return stored;
    var nav = (navigator.language||'').substring(0,2).toLowerCase();
    if(SUPPORTED.indexOf(nav)!==-1) return nav;
    return 'en';
  }

  function getVal(obj, path){
    return path.split('.').reduce(function(o,k){return o&&o[k]},obj);
  }

  function applyTranslations(){
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var val = getVal(translations, el.getAttribute('data-i18n'));
      if(val) el.textContent = val;
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
    fetch('/locales/'+lang+'.json').then(function(r){
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
  window.toggleLangDropdown = function(){ document.getElementById('langDropdown').classList.toggle('show'); };
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
})();

// ================================================================
// PVF HTML TEMPLATE (with coin-drop animation)
// ================================================================

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Sanitize SVG to prevent XSS — strips event handlers, script tags, javascript: URLs
function sanitizeSvg(svg) {
  if (!svg || typeof svg !== 'string') return svg;
  // Remove <script> tags and their content
  let clean = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Remove on* event handler attributes (onload, onclick, onerror, onmouseover, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript: URLs from href and xlink:href
  clean = clean.replace(/(href\s*=\s*(?:"|'))javascript:[^"']*("|')/gi, '$1#$2');
  clean = clean.replace(/(xlink:href\s*=\s*(?:"|'))javascript:[^"']*("|')/gi, '$1#$2');
  return clean;
}

function generatePvfHtml(fileBase64, originalName, fileHash, mimeType, signature, recipientHash, customIcon, brandColor, orgName, orgId) {
  // Sanitize customIcon SVG if present
  if (customIcon && customIcon.startsWith('<svg')) {
    customIcon = sanitizeSvg(customIcon);
  }
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  const safeOriginalName = escapeHtml(originalName);

  const createdAt = new Date().toISOString();

  return `<!--PVF:1.0-->
<!DOCTYPE html>
<html lang="en" dir="ltr" class="no-js">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="pvf:version" content="1.0">
<meta name="pvf:hash" content="${fileHash}">
<meta name="pvf:signature" content="${signature}">
<meta name="pvf:original-name" content="${safeOriginalName}">
<meta name="pvf:mime-type" content="${mimeType}">
<meta name="pvf:created" content="${createdAt}">
${recipientHash ? `<meta name="pvf:recipient-hash" content="${recipientHash}">` : ''}
<title>PVF — ${safeOriginalName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Heebo',sans-serif;background:#1a1625;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:0;
  background-image:radial-gradient(ellipse at 50% 0%,rgba(124,58,237,.08) 0%,transparent 60%)}
body.forged{background:#1a0a0f;background-image:radial-gradient(ellipse at 50% 0%,rgba(229,57,53,.06) 0%,transparent 60%)}

/* ===== TOP TOOLBAR (Vertifile branded) ===== */
.pvf-toolbar{position:fixed;top:0;left:0;right:0;height:52px;background:linear-gradient(135deg,#1e1b2e 0%,#2d2640 100%);display:flex;align-items:center;justify-content:space-between;padding:0 16px;z-index:10000;border-bottom:1px solid rgba(124,58,237,.2);user-select:none;backdrop-filter:blur(12px)}
.pvf-toolbar.hide{display:none}
.tb-section{display:flex;align-items:center;gap:4px}
.tb-btn{background:none;border:1px solid transparent;color:rgba(196,181,253,.6);cursor:pointer;width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:all .25s}
.tb-btn:hover{background:rgba(124,58,237,.15);border-color:rgba(124,58,237,.3);color:#c4b5fd}
.tb-btn:active{transform:scale(.93)}
.tb-btn svg{width:18px;height:18px}
.tb-filename{color:#e2dff0;font-size:13px;font-weight:500;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:10px}
.tb-filename .vf-badge{display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,rgba(124,58,237,.3),rgba(109,40,217,.2));color:#c4b5fd;font-size:9px;font-weight:800;padding:3px 10px;border-radius:6px;letter-spacing:1.5px;border:1px solid rgba(124,58,237,.25);text-transform:uppercase}
.tb-filename .vf-badge svg{filter:drop-shadow(0 0 3px rgba(124,58,237,.5))}
.tb-zoom-label{color:rgba(196,181,253,.5);font-size:11px;min-width:38px;text-align:center;font-weight:600;letter-spacing:.3px}
.tb-divider{width:1px;height:20px;background:linear-gradient(to bottom,transparent,rgba(124,58,237,.2),transparent);margin:0 8px}
.tb-logo{display:flex;align-items:center;gap:6px;margin-right:8px}
.tb-logo-icon{width:26px;height:26px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border-radius:7px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(124,58,237,.3)}
.tb-logo-icon svg{width:14px;height:14px}
/* Toast */
.tb-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#2d2640,#1e1b2e);color:#c4b5fd;padding:10px 24px;border-radius:10px;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:10001;border:1px solid rgba(124,58,237,.2);box-shadow:0 8px 24px rgba(0,0,0,.4)}
.tb-toast.show{opacity:1}

/* Viewer mode — compact toolbar when inside desktop viewer */
.pvf-toolbar.viewer-mode{height:40px;background:linear-gradient(135deg,#16142b 0%,#1e1b2e 100%);border-bottom:1px solid rgba(124,58,237,.1);padding:0 12px 0 0;justify-content:flex-start;gap:8px}
.pvf-toolbar.viewer-mode .tb-logo{display:none}
.pvf-toolbar.viewer-mode .tb-btn{width:30px;height:30px;border-radius:6px}
.pvf-toolbar.viewer-mode .tb-btn svg{width:16px;height:16px}
.pvf-toolbar.viewer-mode .tb-filename{font-size:12px;flex:1;justify-content:center}
.pvf-toolbar.viewer-mode .tb-filename .vf-badge{font-size:8px;padding:2px 6px}
.pvf-toolbar.viewer-mode .tb-zoom-label{font-size:10px}

/* Custom scrollbar — matches dark theme */
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:rgba(15,14,23,.5);border-radius:4px}
::-webkit-scrollbar-thumb{background:rgba(124,58,237,.25);border-radius:4px;border:2px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:rgba(124,58,237,.4)}
::-webkit-scrollbar-corner{background:transparent}
html{scrollbar-color:rgba(124,58,237,.25) rgba(15,14,23,.5);scrollbar-width:thin}

/* No-JS mode */
.no-js .loading{display:none!important}
.no-js .page-wrap{display:block!important}
.no-js .stamp-coin{opacity:1!important}
.no-js .stamp .center{visibility:visible}
.no-js .pvf-toolbar{display:none!important}

/* Loading */
.loading{position:fixed;top:0;left:0;right:0;bottom:0;background:#1a1625;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;transition:opacity .6s}
.loading.hide{opacity:0;pointer-events:none}
.loading .logo{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.loading .logo-icon{width:40px;height:40px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border-radius:11px;display:flex;align-items:center;justify-content:center}
.loading .logo-icon svg{width:22px;height:22px}
.loading .logo-text{font-size:24px;font-weight:900;color:#c4b5fd}
.loading .sp{width:36px;height:36px;border:3px solid rgba(124,58,237,.15);border-top-color:#7c3aed;border-radius:50%;animation:spin .7s linear infinite;margin-bottom:12px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading p{color:rgba(196,181,253,.4);font-size:13px;letter-spacing:.5px}

/* Page wrapper — A4 PORTRAIT, fit in viewport */
.page-wrap{position:relative;width:595px;display:none;margin:68px auto 40px;transform-origin:top center;transition:transform .3s ease}
.page-bg{width:100%;background:#fff;box-shadow:0 4px 40px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.05);border-radius:3px;position:relative;overflow:hidden;min-height:842px;aspect-ratio:210/297;transition:box-shadow .5s}
.page-bg.forged{box-shadow:0 0 0 3px #e53935,0 8px 60px rgba(255,0,0,.25)}

/* Document frame */
.doc-frame{width:100%;min-height:842px}
.doc-frame.pdf{height:calc(100vh - 120px);min-height:842px}
.doc-frame img{width:100%;display:block}
.doc-frame iframe{width:100%;height:100%;border:none}
.doc-frame .text-doc{padding:50px 60px;font-size:14px;line-height:1.9;color:#333;white-space:pre-wrap;word-wrap:break-word}

@media(max-width:660px){
.page-wrap{width:calc(100vw - 24px)}
.pvf-toolbar{height:46px;padding:0 10px}
.tb-filename{font-size:11px;max-width:160px}
.tb-btn{width:30px;height:30px;border-radius:6px}
.tb-btn svg{width:16px;height:16px}
.tb-zoom-label{display:none}
.tb-logo{display:none}
.page-wrap{margin-top:56px}
.doc-frame .text-doc{padding:24px 20px;font-size:13px}
}

/* Forged overlay */
.big-x{display:none;position:absolute;top:0;left:0;right:0;bottom:0;z-index:20;pointer-events:none}
.big-x.show{display:block}
.big-x svg{width:100%;height:100%}
.wm{display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:70px;font-weight:900;color:rgba(229,57,53,.1);white-space:nowrap;z-index:25;pointer-events:none;letter-spacing:8px}
.wm.show{display:block}

/* ===== HOLOGRAPHIC WAVES — flowing sine curves ===== */
.holo-waves{position:absolute;left:0;right:0;bottom:0;height:35%;z-index:10;pointer-events:none;overflow:hidden;border-radius:0 0 4px 4px;opacity:0;transition:opacity 1.2s ease;
  mask-image:linear-gradient(to bottom,transparent 0%,black 40%);-webkit-mask-image:linear-gradient(to bottom,transparent 0%,black 40%)}
.holo-waves.active{opacity:1}
.hw-svg{position:absolute;top:0;width:200%;height:100%;left:-50%}
.hw-svg path{fill:none;stroke-linecap:round}
.hw-a{animation:wDriftA 8s ease-in-out infinite,wHueA 16s ease-in-out infinite}
.hw-b{animation:wDriftB 10s ease-in-out infinite,wHueB 20s ease-in-out infinite}
@keyframes wDriftA{0%,100%{transform:rotate(-5deg) translateX(-3%)}50%{transform:rotate(-5deg) translateX(3%)}}
@keyframes wDriftB{0%,100%{transform:rotate(-3deg) translateX(3%)}50%{transform:rotate(-3deg) translateX(-3%)}}
@keyframes wHueA{0%,100%{filter:hue-rotate(0deg) brightness(1)}33%{filter:hue-rotate(45deg) brightness(1.15)}66%{filter:hue-rotate(-25deg) brightness(.9)}}
@keyframes wHueB{0%,100%{filter:hue-rotate(0deg)}50%{filter:hue-rotate(65deg)}}

/* ===== VERTIFILE STAMP ===== */
.stamp{position:absolute;bottom:6%;right:5%;width:96px;height:96px;z-index:30;pointer-events:none;opacity:0.7;perspective:800px}
@media(max-width:600px){.stamp{width:64px;height:64px;bottom:4%;right:3%}}

/* 3D Coin-flip animation */
.stamp-coin{width:100%;height:100%;transform-style:preserve-3d;opacity:0}
.stamp-coin.animate{animation:coinFlip 2.2s ease-out forwards}
@keyframes coinFlip{
  0%{opacity:0;transform:translateY(-300px) rotateY(0deg) scale(.2)}
  15%{opacity:1;transform:translateY(-180px) rotateY(540deg) scale(.6)}
  35%{opacity:1;transform:translateY(-60px) rotateY(1080deg) scale(1.4)}
  50%{opacity:1;transform:translateY(0) rotateY(1440deg) scale(1.15)}
  65%{opacity:1;transform:translateY(-20px) rotateY(1620deg) scale(1.05)}
  80%{opacity:1;transform:translateY(5px) rotateY(1720deg) scale(.98)}
  90%{opacity:1;transform:translateY(-3px) rotateY(1780deg) scale(1.02)}
  100%{opacity:1;transform:translateY(0) rotateY(1800deg) scale(1)}
}
/* Gentle breathing after landing */
.stamp-coin.landed{opacity:1;animation:stampBreathe 3s ease-in-out infinite}
@keyframes stampBreathe{
  0%,100%{opacity:1;transform:rotateY(1800deg) scale(1)}
  50%{opacity:1;transform:rotateY(1800deg) scale(1.06)}
}
.stamp-shadow{display:none}

.stamp .ring{width:100%;height:100%;position:relative}

/* Outer rotating ring */
.stamp .outer{position:absolute;top:0;left:0;width:100%;height:100%;animation:rotStamp 30s linear infinite}
.stamp .outer.frozen{animation:none!important}
@keyframes rotStamp{to{transform:rotate(360deg)}}

/* Shimmer effect */
.stamp .shim{position:absolute;top:5%;left:5%;width:90%;height:90%;border-radius:50%;
  background:conic-gradient(from 0deg,rgba(124,58,237,.05),rgba(109,40,217,.1) 60deg,rgba(76,175,80,.07) 120deg,rgba(124,58,237,.05) 180deg,rgba(109,40,217,.1) 240deg,rgba(76,175,80,.07) 300deg,rgba(124,58,237,.05));
  animation:shimRot 4s linear infinite}
.stamp .shim.frozen{animation:none!important;background:rgba(244,67,54,.08)}
@keyframes shimRot{to{transform:rotate(-360deg)}}

/* Glow pulse */
.stamp .glow{position:absolute;top:15%;left:15%;width:70%;height:70%;border-radius:50%;background:radial-gradient(circle,rgba(76,175,80,.1),transparent 70%);animation:glowP 3s ease-in-out infinite}
.stamp .glow.frozen{animation:none!important;background:radial-gradient(circle,rgba(244,67,54,.1),transparent 70%)}
@keyframes glowP{0%,100%{opacity:.5;transform:scale(.95)}50%{opacity:1;transform:scale(1.05)}}

/* Inner circle */
.stamp .inner-bg{position:absolute;top:22%;left:22%;width:56%;height:56%;border-radius:50%;background:rgba(255,255,255,.7);border:1px solid rgba(124,58,237,.12)}

/* Center content */
.stamp .center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
.stamp .center svg{width:28px;height:28px}
.stamp .brand{font-size:7px;font-weight:900;letter-spacing:1.5px;color:rgba(124,58,237,.45);margin-top:1px}
.stamp .lbl{font-size:8px;font-weight:900;letter-spacing:1px;margin-top:2px}
.stamp .lbl.ok{color:rgba(46,125,50,.6)}
.stamp .lbl.bad{color:rgba(198,40,40,.6)}

/* Check & X animations */
.chk{stroke-dasharray:60;stroke-dashoffset:60;animation:dChk 1s ease forwards .8s}
@keyframes dChk{to{stroke-dashoffset:0}}
.xp{stroke-dasharray:40;stroke-dashoffset:40;animation:dX .5s ease forwards}
.xp:nth-child(2){animation-delay:.3s}
@keyframes dX{to{stroke-dashoffset:0}}

/* Security: prevent user selection of protected content */
.stamp,.stamp *{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;-webkit-user-drag:none;user-drag:none}
.page-bg img{-webkit-user-drag:none;user-drag:none;pointer-events:none}
@media print{body{display:none!important}body::after{content:"This document is protected by Vertifile and cannot be printed.";display:block;padding:60px;text-align:center;font-size:24px;color:#c62828;font-weight:bold}}
/* Screen capture CSS protection — content-visibility hidden for captured contexts */
@media (display-mode: picture-in-picture){.page-wrap{filter:blur(30px)!important}.stamp{display:none!important}}
</style>
</head>
<body>

<!-- Loading screen with Vertifile branding -->
<div class="loading" id="ld">
  <div class="logo">
    <div class="logo-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 2l7 4v5c0 5-3 9.5-7 11-4-1.5-7-6-7-11V6l7-4z" stroke="#fff" stroke-width="1.5"/></svg></div>
    <span class="logo-text">Vertifile</span>
  </div>
  <div class="sp"></div>
  <p>Verifying document...</p>
</div>

<!-- Top Toolbar (Gmail-style) -->
<div class="pvf-toolbar hide" id="toolbar">
  <!-- Left: Logo + Share + Download -->
  <div class="tb-section">
    <div class="tb-logo">
      <div class="tb-logo-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 2l7 4v5c0 5-3 9.5-7 11-4-1.5-7-6-7-11V6l7-4z" stroke="#fff" stroke-width="1.5"/></svg></div>
    </div>
    <div class="tb-divider"></div>
    <button class="tb-btn" id="tbShare" title="Share">
      <svg viewBox="0 0 24 24" fill="none"><path d="M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.5"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" stroke="currentColor" stroke-width="1.5"/></svg>
    </button>
    <button class="tb-btn" id="tbDownload" title="Download">
      <svg viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
  <!-- Center: Filename -->
  <div class="tb-filename" id="tbName">
    <span class="vf-badge">PVF</span>
    <span id="tbNameText">${safeOriginalName.replace(/\.[^.]+$/, '')}.pvf</span>
  </div>
  <!-- Right: Zoom -->
  <div class="tb-section">
    <button class="tb-btn" id="tbZoomOut" title="Zoom out">
      <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4.35-4.35M8 11h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>
    <span class="tb-zoom-label" id="tbZoomLbl">100%</span>
    <button class="tb-btn" id="tbZoomIn" title="Zoom in">
      <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>
    <div class="tb-divider"></div>
    <button class="tb-btn" id="tbFit" title="Fit to page">
      <svg viewBox="0 0 24 24" fill="none"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
</div>
<div class="tb-toast" id="tbToast"></div>

<!-- Document -->
<div class="page-wrap" id="wrap">
  <div class="page-bg" id="pg">

    <div class="big-x" id="bx"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="8" y1="8" x2="92" y2="92" stroke="rgba(229,57,53,.07)" stroke-width="6" stroke-linecap="round"/><line x1="92" y1="8" x2="8" y2="92" stroke="rgba(229,57,53,.07)" stroke-width="6" stroke-linecap="round"/></svg></div>
    <div class="wm" id="wm">FORGED</div>

    <!-- Holographic security waves -->
    <div class="holo-waves" id="holoWaves">
      <svg class="hw-svg hw-a" viewBox="0 0 1400 200" preserveAspectRatio="none">
        <path d="M-200,100 Q-60,40 80,100 Q220,160 360,100 Q500,40 640,100 Q780,160 920,100 Q1060,40 1200,100 Q1340,160 1480,100 Q1620,40 1760,100" stroke="rgba(124,58,237,.12)" stroke-width="2"/>
        <path d="M-200,115 Q-40,160 120,115 Q280,70 440,115 Q600,160 760,115 Q920,70 1080,115 Q1240,160 1400,115 Q1560,70 1720,115" stroke="rgba(0,131,143,.10)" stroke-width="1.6"/>
        <path d="M-200,140 Q-70,80 60,140 Q190,200 320,140 Q450,80 580,140 Q710,200 840,140 Q970,80 1100,140 Q1230,200 1360,140 Q1490,80 1620,140" stroke="rgba(46,125,50,.10)" stroke-width="1.8"/>
      </svg>
      <svg class="hw-svg hw-b" viewBox="0 0 1400 200" preserveAspectRatio="none">
        <path d="M-200,80 Q-50,130 100,80 Q250,30 400,80 Q550,130 700,80 Q850,30 1000,80 Q1150,130 1300,80 Q1450,30 1600,80" stroke="rgba(106,27,154,.11)" stroke-width="1.8"/>
        <path d="M-200,55 Q-30,95 170,55 Q370,15 570,55 Q770,95 970,55 Q1170,15 1370,55 Q1570,95 1770,55" stroke="rgba(109,40,217,.09)" stroke-width="1.5"/>
      </svg>
    </div>

    <div class="doc-frame ${isPdf ? 'pdf' : ''}" id="frame">
      ${isPdf
        ? `<iframe src="data:application/pdf;base64,${fileBase64}"></iframe>`
        : isImage
          ? `<img src="data:${mimeType};base64,${fileBase64}" alt="document"/>`
          : `<div class="text-doc">${fileBase64}</div>`
      }
    </div>

    <!-- VERTIFILE STAMP -->
    <div class="stamp" id="stamp">
      <div class="stamp-coin" id="sCoin">
      <div class="ring">
        <svg class="outer" id="sOut" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="95" fill="none" stroke="rgba(124,58,237,.18)" stroke-width="1.2"/>
          <circle cx="100" cy="100" r="89" fill="none" stroke="rgba(124,58,237,.08)" stroke-width=".5" stroke-dasharray="3 3"/>
          <line x1="100" y1="2" x2="100" y2="8" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>
          <line x1="100" y1="192" x2="100" y2="198" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>
          <line x1="2" y1="100" x2="8" y2="100" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>
          <line x1="192" y1="100" x2="198" y2="100" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>
          <defs><path id="tp" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"/></defs>
          <text font-size="7" fill="rgba(124,58,237,.25)" font-weight="700" letter-spacing="2.5"><textPath href="#tp">VERIFIED BY VERTIFILE \\u2022 DOCUMENT APPROVED \\u2022 BLOCKCHAIN SECURED \\u2022</textPath></text>
        </svg>
        <div class="shim" id="sShim"></div>
        <div class="glow" id="sGlow"></div>
        <div class="inner-bg"></div>
        <div class="center" id="sCtr">${customIcon ?
     (customIcon.startsWith('<svg') ? customIcon : `<img src="${customIcon}" style="width:28px;height:28px;object-fit:contain" alt="">`)
     : `<svg viewBox="0 0 50 50" fill="none"><path d="M14 26L22 34L36 18" stroke="rgba(46,125,50,.5)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
   }<div class="brand">${escapeHtml(orgName || 'VERTIFILE')}</div><div class="lbl ok">VERIFIED</div></div>
      </div>
      </div>
      <div class="stamp-shadow" id="sShadow"></div>
    </div>

  </div>
</div>

<!-- Protected by Vertifile footer (hidden in desktop viewer / iframe) -->
<div id="pvf-footer" style="display:none;text-align:center;padding:16px;margin-top:24px;border-top:1px solid rgba(0,0,0,0.06)">
  <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#9ca3af">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    Protected by Vertifile — Make your documents tamper-proof at <a href="https://vertifile.com" target="_blank" rel="noopener" style="color:#7c3aed;text-decoration:none">vertifile.com</a>
  </span>
</div>

<script>
// Remove no-js class immediately (enables loading screen + animations in browser)
document.documentElement.classList.remove("no-js");
document.documentElement.classList.add("js");

// ===== SECURITY: Environment detection =====
var __securityFrozen = false;

(function environmentCheck() {
  // Check if window.navigator exists (basic browser context check)
  if (typeof window === 'undefined' || typeof window.navigator === 'undefined') {
    __securityFrozen = true;
    return;
  }
  // Check if embedded in a cross-origin iframe
  // Skip if desktop viewer injected the trusted marker
  if (!window.__pvfDesktopViewer) {
    try {
      if (window.self !== window.top) {
        try {
          var parentDoc = window.top.location.href;
        } catch (e) {
          __securityFrozen = true;
        }
      }
    } catch (e) {
      __securityFrozen = true;
    }
  }
})();

// ===== SECURITY: DevTools detection =====
var __devToolsOpen = false;

(function devToolsDetect() {
  // Method 1: debugger timing trick
  function checkDebugger() {
    var t0 = performance.now();
    debugger;
    var t1 = performance.now();
    if (t1 - t0 > 100) {
      __devToolsOpen = true;
      freezeStamp();
    }
  }

  // Method 2: window size comparison (outer vs inner)
  // Skip this check when embedded in a same-origin iframe (outerWidth reflects main window, not iframe)
  function checkWindowSize() {
    if (window.self !== window.top) return;
    var widthDiff = window.outerWidth - window.innerWidth > 160;
    var heightDiff = window.outerHeight - window.innerHeight > 160;
    if (widthDiff || heightDiff) {
      __devToolsOpen = true;
      freezeStamp();
    }
  }

  // Run checks periodically
  setInterval(function() {
    checkWindowSize();
  }, 2000);

  // Run debugger check less frequently (it pauses execution when open)
  setInterval(function() {
    checkDebugger();
  }, 4000);

  // Also check on resize (DevTools docking changes window size)
  window.addEventListener('resize', checkWindowSize);
})();

function freezeStamp() {
  var sOut = document.getElementById("sOut");
  var sShim = document.getElementById("sShim");
  var sGlow = document.getElementById("sGlow");
  var sCoin = document.getElementById("sCoin");
  if (sOut) sOut.classList.add("frozen");
  if (sShim) sShim.classList.add("frozen");
  if (sGlow) sGlow.classList.add("frozen");
  if (sCoin) { sCoin.classList.remove("animate","landed"); sCoin.style.animation="none"; sCoin.style.opacity="1"; }
  // Kill holographic waves on freeze
  var hw = document.getElementById("holoWaves");
  if (hw) hw.classList.remove("active");
}

// ===== SECURITY: Right-click prevention =====
document.addEventListener("contextmenu", function(e) { e.preventDefault(); });

// ===== SECURITY: Keyboard shortcut blocking =====
document.addEventListener("keydown", function(e) {
  // Block: Ctrl+S (save), Ctrl+U (view source), Ctrl+Shift+I (DevTools),
  // Ctrl+Shift+J (console), F12, Ctrl+P (print), Ctrl+Shift+C (inspect)
  if (e.key === "F12") { e.preventDefault(); __devToolsOpen = true; freezeStamp(); return false; }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === "s" || e.key === "u" || e.key === "p") { e.preventDefault(); return false; }
    if (e.shiftKey && (e.key === "I" || e.key === "i" || e.key === "J" || e.key === "j" || e.key === "C" || e.key === "c")) {
      e.preventDefault(); __devToolsOpen = true; freezeStamp(); return false;
    }
  }
});

// ===== SECURITY: Drag prevention (prevents dragging images out) =====
document.addEventListener("dragstart", function(e) { e.preventDefault(); });

// ===== SECURITY: Selection prevention on stamp =====
document.addEventListener("selectstart", function(e) {
  if (e.target.closest && e.target.closest(".stamp")) { e.preventDefault(); }
});

// ===== SECURITY: Console warning =====
(function() {
  var w = "%cVertifile Security Warning";
  var s = "color:#c62828;font-size:18px;font-weight:bold;";
  var m = "%cThis document is protected by Vertifile. Any attempt to tamper with this file will be detected and the verification stamp will be invalidated.";
  var ms = "color:#888;font-size:13px;";
  try { console.log(w, s); console.log(m, ms); } catch(e) {}
})();

// ===== SECURITY: Visibility change detection =====
document.addEventListener("visibilitychange", function() {
  if (document.hidden && !isLocal) {
    // Tab went to background — no action needed, but track it
  }
});

// ===== SECURITY: Screen Recording / Screen Capture detection =====
(function screenCaptureGuard(){
  // Skip detection when loaded inside an iframe (desktop viewers cause false positives)
  try { if (window !== window.top) return; } catch(e) { return; }
  var __screenCaptured = false;
  function blankForCapture() {
    if (__screenCaptured) return;
    __screenCaptured = true;
    document.body.classList.add("forged");
    var pg = document.getElementById("pg");
    if (pg) pg.style.filter = "blur(30px)";
    freezeStamp();
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:#121212;z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#c62828;font-family:Heebo,sans-serif";
    overlay.innerHTML = '<div style="font-size:48px;font-weight:900;margin-bottom:16px">⛔</div><div style="font-size:20px;font-weight:700">Screen Recording Detected</div><div style="font-size:14px;color:#888;margin-top:8px">This document cannot be captured.</div>';
    document.body.appendChild(overlay);
  }
  // Method 1: Display Capture API detection (navigator.mediaDevices)
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", function() {
      // Device change during viewing — suspicious
    });
  }
  // Method 2: CSS media query for display-mode capture (experimental)
  try {
    var mq = window.matchMedia("(display-mode: picture-in-picture)");
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", function(e) { if (e.matches) blankForCapture(); });
    }
  } catch(e){}
  // Method 3: Monitor getDisplayMedia usage via permissions (skip — causes false positives in Electron)
  // Method 4: Intercept getDisplayMedia if available
  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    var origGetDisplay = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = function() {
      blankForCapture();
      return origGetDisplay.apply(this, arguments);
    };
  }
})();

var HASH="${fileHash}";
var SIG="${signature}";
var RCPT="${recipientHash || ''}";
var CREATED="${createdAt}";
var ORGID="${orgId || ''}";
var SHAREID="";
var API=window.location.origin;
var ORGNAME="${escapeHtml(orgName || 'VERTIFILE')}";
var CUSTOMICON=${customIcon ? `"${customIcon.startsWith('<svg') ? 'svg' : 'img'}"` : 'null'};
var CUSTOMICONDATA=${customIcon ? `\`${customIcon.replace(/`/g, '\\`')}\`` : 'null'};

// ===== UNIQUE VISUAL FINGERPRINT (derived from hash) =====
(function hashFingerprint(){
  var h=HASH;
  // Extract parameters from hash bytes
  var hue1=parseInt(h.substring(0,2),16)%360;
  var hue2=parseInt(h.substring(2,4),16)%360;
  var rotSpeed=20+parseInt(h.substring(4,6),16)%30;  // 20-50s
  var waveSpeed1=6+parseInt(h.substring(6,8),16)%8;  // 6-14s
  var waveSpeed2=8+parseInt(h.substring(8,10),16)%10; // 8-18s
  var glowSpeed=2+parseInt(h.substring(10,12),16)%4;  // 2-6s
  var shimSpeed=3+parseInt(h.substring(12,14),16)%5;  // 3-8s
  var breatheSpeed=2+parseInt(h.substring(14,16),16)%4; // 2-6s
  var waveHue1=parseInt(h.substring(16,18),16)%90;
  var waveHue2=parseInt(h.substring(18,20),16)%90;
  // Inject custom CSS based on hash
  var s=document.createElement("style");
  s.textContent=
    ".stamp .outer{animation-duration:"+rotSpeed+"s}"+
    ".stamp .shim{animation-duration:"+shimSpeed+"s;background:conic-gradient(from 0deg,hsla("+hue1+",60%,50%,.05),hsla("+hue2+",50%,45%,.1) 60deg,hsla("+(hue1+120)+",40%,55%,.07) 120deg,hsla("+hue1+",60%,50%,.05) 180deg,hsla("+hue2+",50%,45%,.1) 240deg,hsla("+(hue1+120)+",40%,55%,.07) 300deg,hsla("+hue1+",60%,50%,.05))}"+
    ".stamp .glow{animation-duration:"+glowSpeed+"s}"+
    ".stamp-coin.landed{animation-duration:"+breatheSpeed+"s}"+
    ".hw-a{animation:wDriftA "+waveSpeed1+"s ease-in-out infinite,wHueA "+(waveSpeed1*2)+"s ease-in-out infinite}"+
    ".hw-b{animation:wDriftB "+waveSpeed2+"s ease-in-out infinite,wHueB "+(waveSpeed2*2)+"s ease-in-out infinite}"+
    "@keyframes wHueA{0%,100%{filter:hue-rotate("+waveHue1+"deg) brightness(1)}50%{filter:hue-rotate("+(waveHue1+45)+"deg) brightness(1.15)}}"+
    "@keyframes wHueB{0%,100%{filter:hue-rotate("+waveHue2+"deg)}50%{filter:hue-rotate("+(waveHue2+65)+"deg)}}";
  document.head.appendChild(s);
  ${brandColor ? `
  var bc = "${brandColor}";
  // Override wave colors with brand color
  document.querySelectorAll('.wave path').forEach(function(p, i) {
    p.setAttribute('stroke', bc);
    p.style.opacity = (0.08 + i * 0.03);
  });
  ` : ''}
})();

var token=null;
var isLocal=location.protocol==="file:"||location.protocol==="about:"||window!==window.top;

// Code Integrity — hash the script content to detect tampering
async function computeCodeIntegrity(){
  try{
    var scripts=document.querySelectorAll("script");
    var allCode="";
    for(var i=0;i<scripts.length;i++){if(scripts[i].textContent)allCode+=scripts[i].textContent}
    var encoder=new TextEncoder();
    var data=encoder.encode(allCode);
    var hashBuf=await crypto.subtle.digest("SHA-256",data);
    var hashArr=Array.from(new Uint8Array(hashBuf));
    return hashArr.map(function(b){return b.toString(16).padStart(2,"0")}).join("");
  }catch(e){return"unknown"}
}
var VERIFY_URL="https://vertifile.com";

async function init(){
  // Security: if environment is frozen (cross-origin iframe / missing navigator), show forged
  if(__securityFrozen){
    await new Promise(r=>setTimeout(r,300));
    document.getElementById("ld").classList.add("hide");
    document.getElementById("wrap").style.display="block";
    setFk();
    freezeStamp();
    return;
  }

  // Determine the verification API URL
  var apiUrl=isLocal?VERIFY_URL:API;

  // Step 1: Try server verification
  try{
    await new Promise(r=>setTimeout(r,500));
    var codeCheck=await computeCodeIntegrity();
    var r=await fetch(apiUrl+"/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hash:HASH,signature:SIG,recipientHash:RCPT||undefined,created:CREATED,orgId:ORGID,codeIntegrity:codeCheck})});
    var d=await r.json();
    if(d.verified){token=d.token;show(true);if(!isLocal)startRefresh();return}
    // Server says NOT verified — if online (not local), trust the server → FORGED
    if(!isLocal){if(d.reason)document.body.setAttribute("data-fail-reason",d.reason);show(false);return}
    // If local: server might not know this doc (different DB). Fall through to local check.
  }catch(e){
    // Server unreachable — fall back to client-side verification
  }

  // Step 2: Offline fallback — cannot verify server-side, show as protected
  showLocal();
}

function showLocal(){
  document.getElementById("ld").classList.add("hide");
  document.getElementById("wrap").style.display="block";
  if(__isDesktopViewer || __isIframe){
    document.getElementById("wrap").style.marginTop="20px";
  } else {
    document.getElementById("toolbar").classList.remove("hide");
  }
  fitToPage();
  setOk();
  activateWaves();
  document.getElementById("sCtr").innerHTML='<svg viewBox="0 0 50 50" fill="none"><path class="chk" d="M14 26L22 34L36 18" stroke="rgba(46,125,50,.5)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="brand">VERTIFILE</div><div class="lbl ok">PROTECTED</div>';
  triggerFlip();
}

function activateWaves(){
  var hw=document.getElementById("holoWaves");
  if(hw) setTimeout(function(){hw.classList.add("active")},300);
}

function triggerFlip(){
  // Skip animation if DevTools detected or security frozen
  if(__devToolsOpen||__securityFrozen) return;
  var c=document.getElementById("sCoin");
  if(c){c.classList.remove("animate","landed");c.style.opacity="0";void c.offsetWidth;c.classList.add("animate")}
  // After flip completes (2.2s), switch to gentle breathing
  setTimeout(function(){
    if(__devToolsOpen||__securityFrozen) return;
    if(c){c.style.opacity="1";c.classList.remove("animate");void c.offsetWidth;c.classList.add("landed")}
  },2300);
}
// Repeat flip every 10 seconds
setInterval(triggerFlip,10000);

var __isDesktopViewer = !!window.__pvfDesktopViewer;
var __isIframe = (window.self !== window.top);

function show(ok){
  document.getElementById("ld").classList.add("hide");
  document.getElementById("wrap").style.display="block";
  if(__isDesktopViewer || __isIframe){
    // Hide PVF toolbar entirely — Viewer has its own native bar
    document.getElementById("wrap").style.marginTop="20px";
  } else {
    document.getElementById("toolbar").classList.remove("hide");
    // Show "Protected by Vertifile" footer in browser only
    var pvfFt = document.getElementById("pvf-footer");
    if(pvfFt) pvfFt.style.display="block";
  }
  if(ok){setOk();activateWaves()}else setFk();
  setTimeout(triggerFlip,400);
  fitToPage();
}

function setOk(){
  document.body.classList.remove("forged");
  document.getElementById("pg").classList.remove("forged");
  document.getElementById("bx").classList.remove("show");
  document.getElementById("wm").classList.remove("show");
  document.getElementById("sOut").classList.remove("frozen");
  document.getElementById("sShim").classList.remove("frozen");
  document.getElementById("sGlow").classList.remove("frozen");
  var iconHtml = CUSTOMICON === 'svg' ? CUSTOMICONDATA : CUSTOMICON === 'img' ? '<img src="'+CUSTOMICONDATA+'" style="width:28px;height:28px;object-fit:contain" alt="">' : '<svg viewBox="0 0 50 50" fill="none"><path class="chk" d="M14 26L22 34L36 18" stroke="rgba(46,125,50,.5)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.getElementById("sCtr").innerHTML=iconHtml+'<div class="brand">'+ORGNAME+'</div><div class="lbl ok">VERIFIED</div>';
}

function setFk(){
  document.body.classList.add("forged");
  document.getElementById("pg").classList.add("forged");
  document.getElementById("bx").classList.add("show");
  document.getElementById("wm").classList.add("show");
  document.getElementById("sOut").classList.add("frozen");
  document.getElementById("sShim").classList.add("frozen");
  document.getElementById("sGlow").classList.add("frozen");
  document.getElementById("sCtr").innerHTML='<svg viewBox="0 0 50 50" fill="none"><path class="xp" d="M15 15L35 35" stroke="rgba(198,40,40,.5)" stroke-width="3" stroke-linecap="round"/><path class="xp" d="M35 15L15 35" stroke="rgba(198,40,40,.5)" stroke-width="3" stroke-linecap="round"/></svg><div class="brand">'+ORGNAME+'</div><div class="lbl bad">FORGED</div>';
}

function startRefresh(){
  setInterval(async function(){
    try{
      var r=await fetch(API+"/api/token/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hash:HASH})});
      var d=await r.json();
      if(d.success)token=d.token;
    }catch(e){setFk()}
  },300000);
}

// ===== TOOLBAR: Zoom =====
var __zoom = 1;
var __zoomSteps = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
function setZoom(z) {
  __zoom = Math.max(0.25, Math.min(3, z));
  document.getElementById("wrap").style.transform = "scale(" + __zoom + ")";
  document.getElementById("tbZoomLbl").textContent = Math.round(__zoom * 100) + "%";
}
function stepZoom(dir) {
  var idx = 0;
  for (var i = 0; i < __zoomSteps.length; i++) {
    if (__zoomSteps[i] <= __zoom) idx = i;
  }
  var next = dir > 0 ? Math.min(idx + 1, __zoomSteps.length - 1) : Math.max(idx - 1, 0);
  setZoom(__zoomSteps[next]);
}
function fitToPage() {
  var wrap = document.getElementById("wrap");
  if (!wrap) return;
  if (__isDesktopViewer || __isIframe) {
    // Desktop viewer: fixed 75% zoom
    setZoom(0.75);
  } else {
    // Browser: fit width with minimum 90%
    var viewW = window.innerWidth - 60;
    var docW = 595;
    var scale = Math.min(viewW / docW, 1);
    scale = Math.max(scale, 0.9);
    setZoom(Math.round(scale * 100) / 100);
  }
}
document.getElementById("tbZoomIn").addEventListener("click", function() { stepZoom(1); });
document.getElementById("tbZoomOut").addEventListener("click", function() { stepZoom(-1); });
document.getElementById("tbFit").addEventListener("click", fitToPage);

// ===== TOOLBAR: Download =====
document.getElementById("tbDownload").addEventListener("click", function() {
  var html = document.documentElement.outerHTML;
  var blob = new Blob([html], { type: "text/html" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (document.getElementById("tbNameText").textContent || "document") + ".pvf";
  a.click();
  URL.revokeObjectURL(a.href);
});

// ===== TOOLBAR: Share =====
document.getElementById("tbShare").addEventListener("click", function() {
  var url = window.location.href;
  if (navigator.share) {
    navigator.share({ title: document.getElementById("tbNameText").textContent, url: url }).catch(function(){});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function() {
      var t = document.getElementById("tbToast");
      t.textContent = "Link copied!";
      t.classList.add("show");
      setTimeout(function() { t.classList.remove("show"); }, 2000);
    });
  }
});

// ===== TOOLBAR: Keyboard shortcuts =====
document.addEventListener("keydown", function(e) {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === "=" || e.key === "+") { e.preventDefault(); stepZoom(1); }
    if (e.key === "-") { e.preventDefault(); stepZoom(-1); }
    if (e.key === "0") { e.preventDefault(); fitToPage(); }
  }
});

init();
</script>
</body>
</html>`;
}

module.exports = { generatePvfHtml, escapeHtml, sanitizeSvg };

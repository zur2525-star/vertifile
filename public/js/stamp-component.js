/**
 * Vertifile Stamp Component — Single Source of Truth
 * Include this file on any page that shows a stamp preview.
 * When defaults are changed here, every page that uses this component updates automatically.
 */
window.VertifileStamp = {

  /* ────────────────────── DEFAULT CONFIG ────────────────────── */
  defaults: {
    size: 72,
    mobileSize: 48,
    opacity: 0.4,
    brandColor: '#7c3aed',
    orgName: 'VERTIFILE',
    stampText: 'VERIFIED',
    rotatingText: 'VERIFIED BY VERTIFILE \u2022 DOCUMENT APPROVED \u2022 BLOCKCHAIN SECURED \u2022',
    waveColors: ['#2e1065', '#4c1d95', '#6d28d9', '#7c3aed', '#a78bfa'],
    waveCount: 5,
    waveOpacity: 0.4,
    checkColor: 'rgba(46,125,50,.5)',
    ringStroke: 'rgba(124,58,237,.18)',
    ringDash: 'rgba(124,58,237,.08)',
    textFill: 'rgba(124,58,237,.25)',
    brandLabelColor: 'rgba(124,58,237,.4)',
    verifiedColor: 'rgba(46,125,50,.6)',
    shimGradient: 'conic-gradient(from 0deg,rgba(124,58,237,.05),rgba(109,40,217,.1) 60deg,rgba(76,175,80,.07) 120deg,rgba(124,58,237,.05) 180deg,rgba(109,40,217,.1) 240deg,rgba(76,175,80,.07) 300deg,rgba(124,58,237,.05))',
    glowGradient: 'radial-gradient(circle,rgba(76,175,80,.1),transparent 70%)',
    spinDuration: '30s',
    breatheDuration: '3s',
    defaultLogo: '<svg class="vfs-stamp-logo" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(124,58,237,.15)" stroke="rgba(124,58,237,.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="rgba(124,58,237,.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  },

  /* ────────────────────── UNIQUE ID COUNTER ────────────────────── */
  _idCounter: 0,
  _uid() { return 'vfs-' + (++this._idCounter); },

  /* ────────────────────── RENDER FULL STAMP ────────────────────── */
  /**
   * Returns complete stamp HTML (rotating outer ring + shim + glow + center logo/text).
   * Options override defaults. Pass { forged: true } for forged variant.
   */
  renderStamp(options) {
    var cfg = this._merge(options);
    var arcId = this._uid();
    var forged = cfg.forged || false;
    var size = cfg.size || this.defaults.size;

    var forgedX = '<svg class="vfs-stamp-logo" viewBox="0 0 50 50" fill="none"><path d="M15 15L35 35" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/><path d="M35 15L15 35" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/></svg>';

    var logo = forged ? forgedX : (cfg.customIcon || cfg.defaultLogo);
    var labelClass = forged ? 'vfs-lbl-bad' : 'vfs-lbl-ok';
    var labelText = forged ? 'FORGED' : cfg.stampText;
    var brandName = cfg.orgName;
    var rotText = forged
      ? 'TAMPERED \u2022 DOCUMENT MODIFIED \u2022 VERIFICATION FAILED \u2022'
      : cfg.rotatingText;

    return ''
      + '<div class="vfs-stamp-coin">'
      +   '<div class="vfs-ring">'
      +     '<svg class="vfs-outer" viewBox="0 0 200 200">'
      +       '<circle cx="100" cy="100" r="95" fill="none" stroke="' + cfg.ringStroke + '" stroke-width="1.2"/>'
      +       '<circle cx="100" cy="100" r="89" fill="none" stroke="' + cfg.ringDash + '" stroke-width=".5" stroke-dasharray="3 3"/>'
      +       '<line x1="100" y1="2" x2="100" y2="8" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>'
      +       '<line x1="100" y1="192" x2="100" y2="198" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>'
      +       '<line x1="2" y1="100" x2="8" y2="100" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>'
      +       '<line x1="192" y1="100" x2="198" y2="100" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>'
      +       '<defs><path id="' + arcId + '" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"/></defs>'
      +       '<text font-size="7" fill="' + cfg.textFill + '" font-weight="700" letter-spacing="2.5"><textPath href="#' + arcId + '">' + this._escHtml(rotText) + '</textPath></text>'
      +     '</svg>'
      +     '<div class="vfs-shim"></div>'
      +     '<div class="vfs-glow"></div>'
      +     '<div class="vfs-inner-bg"></div>'
      +     '<div class="vfs-center">'
      +       logo
      +       '<div class="vfs-brand">' + this._escHtml(brandName) + '</div>'
      +       '<div class="vfs-lbl ' + labelClass + '">' + this._escHtml(labelText) + '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  },

  /* ────────────────────── RENDER WAVES ────────────────────── */
  /**
   * Returns holographic wave SVG markup.
   * Uses cfg.waveColors for each line (default 5-color purple gradient).
   */
  renderWaves(options) {
    var cfg = this._merge(options);
    var colors = cfg.waveColors;
    var count = colors.length;
    var paths1 = '', paths2 = '';

    for (var i = 0; i < count; i++) {
      var y = 60 + i * (80 / count);
      var amp = 60 + Math.sin(i * 0.9) * 30;
      var phase = i * 200;
      var op = (0.06 + (i / count) * 0.08).toFixed(3);
      var d = '';
      for (var x = -200; x <= 1600; x += 200) {
        var cy = y + Math.sin((x + phase) * Math.PI / 600) * amp;
        d += (x === -200 ? 'M' : ' Q') + x + ',' + cy;
        if (x > -200) {
          var nx = x + 100;
          var ny = y - Math.sin((nx + phase) * Math.PI / 600) * amp * 0.5;
          d = d.replace(/ Q[^Q]*$/, ' Q' + (x - 100) + ',' + cy + ' ' + x + ',' + (y + Math.sin((x + phase) * Math.PI / 600) * amp));
        }
      }
      // simplified wave paths
      var baseY = 40 + i * (120 / count);
      var waveAmp = 50 + i * 10;
      var seg = 200;
      d = 'M-200,' + baseY;
      for (var wx = -200; wx < 1600; wx += seg) {
        var cy1 = baseY + (((wx / seg) % 2 === 0) ? waveAmp : -waveAmp);
        var cx1 = wx + seg / 2;
        d += ' Q' + cx1 + ',' + cy1 + ' ' + (wx + seg) + ',' + baseY;
      }

      if (i < 3) {
        paths1 += '<path d="' + d + '" stroke="' + colors[i] + '" stroke-width="' + (1.2 + i * 0.3) + '" fill="none" opacity="' + op + '"/>';
      } else {
        paths2 += '<path d="' + d + '" stroke="' + colors[i] + '" stroke-width="' + (1.2 + (i - 3) * 0.3) + '" fill="none" opacity="' + op + '"/>';
      }
    }

    return ''
      + '<svg class="vfs-wave-svg vfs-wave-a" viewBox="0 0 1400 200" preserveAspectRatio="none">'
      +   paths1
      + '</svg>'
      + '<svg class="vfs-wave-svg vfs-wave-b" viewBox="0 0 1400 200" preserveAspectRatio="none">'
      +   paths2
      + '</svg>';
  },

  /* ────────────────────── RENDER DECORATIVE (MINI) STAMP ────────────────────── */
  /**
   * Small rotating stamp used as page decoration (corner accents).
   * Size & opacity configurable, defaults to 48px / 0.3 opacity.
   */
  renderDecorative(options) {
    var opts = options || {};
    var size = opts.size || 48;
    var opacity = opts.opacity != null ? opts.opacity : 0.3;
    var cfg = this._merge(opts);
    var pathId = this._uid();
    var text = opts.text || (cfg.orgName + ' \u00b7 VERIFIED \u00b7 SECURE \u00b7');

    return ''
      + '<div class="vfs-decorative" style="width:' + size + 'px;height:' + size + 'px;opacity:' + opacity + ';position:absolute;pointer-events:none;z-index:2">'
      +   '<svg viewBox="0 0 200 200" style="animation:vfsDecorativeSpin 20s linear infinite;width:100%;height:100%">'
      +     '<circle cx="100" cy="100" r="90" fill="none" stroke="rgba(124,58,237,.3)" stroke-width="1"/>'
      +     '<circle cx="100" cy="100" r="80" fill="none" stroke="rgba(124,58,237,.2)" stroke-width=".5"/>'
      +     '<path d="M100,100 m-70,0 a70,70 0 1,1 140,0 a70,70 0 1,1 -140,0" id="' + pathId + '" fill="none"/>'
      +     '<text font-size="6" fill="rgba(124,58,237,.2)" font-weight="700" letter-spacing="2"><textPath href="#' + pathId + '">' + this._escHtml(text) + '</textPath></text>'
      +   '</svg>'
      + '</div>';
  },

  /* ────────────────────── RENDER FORGED STAMP (simple) ────────────────────── */
  /**
   * Renders a simple forged stamp with red X and border.
   */
  renderForgedStamp(options) {
    var cfg = this._merge(options);
    return ''
      + '<div class="vfs-forged-ring">'
      +   '<div class="vfs-forged-inner">'
      +     '<div class="vfs-forged-x"><svg viewBox="0 0 50 50" fill="none"><path d="M15 15L35 35" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/><path d="M35 15L15 35" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/></svg></div>'
      +     '<div class="vfs-forged-brand">' + this._escHtml(cfg.orgName) + '</div>'
      +     '<div class="vfs-forged-label">FORGED</div>'
      +   '</div>'
      + '</div>';
  },

  /* ────────────────────── RENDER MINI STAMP (demo.html style) ────────────────────── */
  /**
   * Tiny stamp for compact previews (like demo comparison cards).
   */
  renderMiniStamp(options) {
    var opts = options || {};
    var cfg = this._merge(opts);
    var forged = opts.forged || false;
    var icon = forged
      ? '<svg viewBox="0 0 50 50" fill="none" style="width:16px;height:16px"><path d="M15 15L35 35" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/><path d="M35 15L15 35" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" style="width:16px;height:16px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(5,150,105,.15)" stroke="#059669" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="#059669" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var cls = forged ? 'vfs-mini-stamp forged' : 'vfs-mini-stamp verified';
    var label = forged ? 'FORGED' : cfg.stampText;

    return ''
      + '<div class="' + cls + '">'
      +   '<div class="vfs-ms-icon">' + icon + '</div>'
      +   this._escHtml(cfg.orgName)
      +   '<div class="vfs-ms-label">' + this._escHtml(label) + '</div>'
      + '</div>';
  },

  /* ────────────────────── RENDER MINI WAVES (demo.html style) ────────────────────── */
  renderMiniWaves(options) {
    var cfg = this._merge(options);
    var c1 = cfg.waveColors[3] || cfg.brandColor;
    var c2 = cfg.waveColors[1] || '#34d399';
    return ''
      + '<svg viewBox="0 0 1200 100" preserveAspectRatio="none">'
      +   '<path d="M0 40 Q150 20 300 40 T600 40 T900 40 T1200 40" stroke="' + c1 + '" stroke-width="1.5" fill="none" opacity="0.15"/>'
      +   '<path d="M0 60 Q150 40 300 60 T600 60 T900 60 T1200 60" stroke="' + c2 + '" stroke-width="1.5" fill="none" opacity="0.12"/>'
      + '</svg>';
  },

  /* ────────────────────── INJECT INTO CONTAINER ────────────────────── */
  /**
   * Inject stamp HTML into a container element.
   * @param {string} containerId - DOM element id
   * @param {string} type - 'stamp' | 'waves' | 'decorative' | 'forged' | 'mini' | 'miniWaves'
   * @param {object} options - override defaults
   */
  inject(containerId, type, options) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var html = '';
    switch (type) {
      case 'stamp':      html = this.renderStamp(options); break;
      case 'waves':       html = this.renderWaves(options); break;
      case 'decorative':  html = this.renderDecorative(options); break;
      case 'forged':      html = this.renderForgedStamp(options); break;
      case 'mini':        html = this.renderMiniStamp(options); break;
      case 'miniWaves':   html = this.renderMiniWaves(options); break;
    }
    el.innerHTML = html;
  },

  /* ────────────────────── CSS (injected once) ────────────────────── */
  _cssInjected: false,
  injectCSS() {
    if (this._cssInjected) return;
    this._cssInjected = true;
    var d = this.defaults;
    var style = document.createElement('style');
    style.id = 'vfs-stamp-styles';
    style.textContent = ''
      /* Decorative spin */
      + '@keyframes vfsDecorativeSpin{to{transform:rotate(360deg)}}'

      /* Full stamp container */
      + '.vfs-stamp{position:absolute;bottom:6%;right:5%;width:' + d.size + 'px;height:' + d.size + 'px;z-index:30;pointer-events:none;opacity:' + d.opacity + ';perspective:800px}'
      + '@media(max-width:600px){.vfs-stamp{width:' + d.mobileSize + 'px;height:' + d.mobileSize + 'px;bottom:4%;right:3%}}'

      /* Coin flip & breathe */
      + '.vfs-stamp-coin{width:100%;height:100%;transform-style:preserve-3d}'
      + '@keyframes vfsStampBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}'
      + '.vfs-stamp-coin.breathe{animation:vfsStampBreathe ' + d.breatheDuration + ' ease-in-out infinite}'

      /* Ring */
      + '.vfs-ring{width:100%;height:100%;position:relative}'

      /* Outer rotating ring */
      + '.vfs-outer{position:absolute;top:0;left:0;width:100%;height:100%;animation:vfsRotStamp ' + d.spinDuration + ' linear infinite}'
      + '@keyframes vfsRotStamp{to{transform:rotate(360deg)}}'

      /* Shim */
      + '.vfs-shim{position:absolute;top:5%;left:5%;width:90%;height:90%;border-radius:50%;background:' + d.shimGradient + ';animation:vfsShimRot 4s linear infinite}'
      + '@keyframes vfsShimRot{to{transform:rotate(360deg)}}'

      /* Glow */
      + '.vfs-glow{position:absolute;top:15%;left:15%;width:70%;height:70%;border-radius:50%;background:' + d.glowGradient + ';animation:vfsGlowP 3s ease-in-out infinite}'
      + '@keyframes vfsGlowP{0%,100%{opacity:.7}50%{opacity:1}}'

      /* Inner BG */
      + '.vfs-inner-bg{position:absolute;top:22%;left:22%;width:56%;height:56%;border-radius:50%;background:rgba(255,255,255,.7);border:1px solid rgba(124,58,237,.12)}'

      /* Center */
      + '.vfs-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}'
      + '.vfs-center svg.vfs-stamp-logo,.vfs-center .vfs-stamp-logo{width:24px;height:24px}'
      + '.vfs-brand{font-size:7px;font-weight:900;letter-spacing:1.5px;color:' + d.brandLabelColor + ';margin-top:1px}'
      + '.vfs-lbl{font-size:7px;font-weight:900;letter-spacing:1px;margin-top:1px}'
      + '.vfs-lbl-ok{color:' + d.verifiedColor + '}'
      + '.vfs-lbl-bad{color:rgba(198,40,40,.6)}'

      /* Waves container */
      + '.vfs-waves{position:absolute;left:0;right:0;bottom:0;height:200px;z-index:10;pointer-events:none;overflow:hidden;opacity:' + d.waveOpacity + '}'
      + '.vfs-wave-svg{position:absolute;top:0;left:0;width:200%;height:100%;animation:vfsWaveFlow 8s linear infinite}'
      + '@keyframes vfsWaveFlow{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}'
      + '.vfs-wave-svg path{fill:none;stroke-linecap:round}'

      /* Forged simple stamp */
      + '.vfs-forged-ring{width:100%;height:100%;border-radius:50%;border:2px solid rgba(220,38,38,.3);display:flex;align-items:center;justify-content:center;position:relative}'
      + '.vfs-forged-inner{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center}'
      + '.vfs-forged-x svg{width:28px;height:28px}'
      + '.vfs-forged-brand{font-size:7px;font-weight:800;color:#dc2626;letter-spacing:1px;margin-top:2px}'
      + '.vfs-forged-label{font-size:6px;font-weight:700;color:#fff;background:#dc2626;padding:1px 6px;border-radius:3px;margin-top:2px;letter-spacing:.5px}'

      /* Mini stamps (for demo comparison cards) */
      + '.vfs-mini-stamp{position:absolute;bottom:12px;right:12px;width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-direction:column;font-size:5px;font-weight:800;letter-spacing:.5px}'
      + '.vfs-mini-stamp.verified{border:2px solid rgba(5,150,105,.3);color:#059669;animation:vfsMiniSpin 15s linear infinite}'
      + '.vfs-mini-stamp.forged{border:2px solid rgba(220,38,38,.3);color:#dc2626}'
      + '@keyframes vfsMiniSpin{to{transform:rotate(360deg)}}'
      + '.vfs-ms-icon{font-size:16px;margin-bottom:1px}'
      + '.vfs-ms-label{font-size:5px;background:currentColor;color:#fff;padding:1px 4px;border-radius:2px;margin-top:1px}'
      + '.vfs-mini-stamp.verified .vfs-ms-label{background:#059669}'
      + '.vfs-mini-stamp.forged .vfs-ms-label{background:#dc2626}'

      /* Mini waves */
      + '.vfs-mini-holo{position:absolute;left:0;right:0;bottom:0;height:25%;pointer-events:none;overflow:hidden;border-radius:0 0 8px 8px;opacity:.5;mask-image:linear-gradient(to bottom,transparent,black 50%);-webkit-mask-image:linear-gradient(to bottom,transparent,black 50%)}'
      + '.vfs-mini-holo svg{width:200%;height:100%;animation:vfsMiniHolo 5s ease-in-out infinite}'
      + '@keyframes vfsMiniHolo{0%,100%{transform:translateX(-3%)}50%{transform:translateX(3%)}}'
    ;
    document.head.appendChild(style);
  },

  /* ────────────────────── HELPERS ────────────────────── */
  _merge(opts) {
    var result = {};
    for (var k in this.defaults) result[k] = this.defaults[k];
    if (opts) { for (var k in opts) result[k] = opts[k]; }
    return result;
  },
  _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
};

/* Auto-inject CSS when script loads */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { VertifileStamp.injectCSS(); });
} else {
  VertifileStamp.injectCSS();
}

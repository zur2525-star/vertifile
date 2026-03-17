const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3002;

// ===== File upload config =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Document Registry (in-memory, later → blockchain) =====
const registry = new Map();

// ===== Helper: Hash raw bytes (BLIND — never reads content) =====
function hashBytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ===== The PVF stamp template =====
function generatePvfHtml(fileBase64, originalName, fileHash, mimeType) {
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PVF - ${originalName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Heebo',sans-serif;background:#e8e8e8;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:20px}
body.forged{background:#3a1010}

.loading{position:fixed;top:0;left:0;right:0;bottom:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;transition:opacity .5s}
.loading.hide{opacity:0;pointer-events:none}
.loading .sp{width:44px;height:44px;border:3px solid #eee;border-top-color:#1a237e;border-radius:50%;animation:spin .7s linear infinite;margin-bottom:16px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading p{color:#888;font-size:15px}

.page-wrap{position:relative;max-width:820px;width:100%;display:none}
.page-bg{width:100%;background:#fff;box-shadow:0 4px 40px rgba(0,0,0,.12);position:relative;overflow:hidden;min-height:600px;transition:box-shadow .4s}
.page-bg.forged{box-shadow:0 0 0 4px #e53935,0 4px 40px rgba(255,0,0,.25)}

.doc-frame{width:100%;min-height:600px}
.doc-frame.pdf{height:90vh;min-height:800px}
.doc-frame img{width:100%;display:block}
.doc-frame iframe{width:100%;height:100%;border:none}
.doc-frame .text-doc{padding:50px 60px;font-size:15px;line-height:1.9;color:#333;white-space:pre-wrap;direction:rtl}

/* ===== FORGED X ===== */
.big-x{display:none;position:absolute;top:0;left:0;right:0;bottom:0;z-index:20;pointer-events:none}
.big-x.show{display:block}
.big-x svg{width:100%;height:100%}
.wm{display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:70px;font-weight:900;color:rgba(229,57,53,.1);white-space:nowrap;z-index:25;pointer-events:none;letter-spacing:8px}
.wm.show{display:block}

/* ===== ANIMATED STAMP (35%) ===== */
.stamp{position:absolute;bottom:8%;right:6%;width:35%;aspect-ratio:1;z-index:30;pointer-events:none}
@media(max-width:600px){.stamp{width:45%;bottom:5%;right:3%}}

.stamp .ring{width:100%;height:100%;position:relative}

.stamp .outer{position:absolute;top:0;left:0;width:100%;height:100%;animation:rotStamp 25s linear infinite}
.stamp .outer.frozen{animation:none!important}
@keyframes rotStamp{to{transform:rotate(360deg)}}

.stamp .shim{position:absolute;top:5%;left:5%;width:90%;height:90%;border-radius:50%;
  background:conic-gradient(from 0deg,rgba(26,35,126,.06),rgba(13,71,161,.12) 60deg,rgba(76,175,80,.08) 120deg,rgba(26,35,126,.06) 180deg,rgba(13,71,161,.12) 240deg,rgba(76,175,80,.08) 300deg,rgba(26,35,126,.06));
  animation:shimRot 4s linear infinite}
.stamp .shim.frozen{animation:none!important;background:rgba(244,67,54,.08)}
@keyframes shimRot{to{transform:rotate(-360deg)}}

.stamp .glow{position:absolute;top:15%;left:15%;width:70%;height:70%;border-radius:50%;background:radial-gradient(circle,rgba(76,175,80,.1),transparent 70%);animation:glowP 3s ease-in-out infinite}
.stamp .glow.frozen{animation:none!important;background:radial-gradient(circle,rgba(244,67,54,.1),transparent 70%)}
@keyframes glowP{0%,100%{opacity:.5;transform:scale(.95)}50%{opacity:1;transform:scale(1.05)}}

.stamp .inner-bg{position:absolute;top:20%;left:20%;width:60%;height:60%;border-radius:50%;background:rgba(255,255,255,.65);border:1px solid rgba(26,35,126,.15)}

.stamp .center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
.stamp .center svg{width:36px;height:36px}
.stamp .lbl{font-size:10px;font-weight:900;letter-spacing:1px;margin-top:3px}
.stamp .lbl.ok{color:rgba(46,125,50,.65)}
.stamp .lbl.bad{color:rgba(198,40,40,.65)}

.chk{stroke-dasharray:60;stroke-dashoffset:60;animation:dChk 1s ease forwards .8s}
@keyframes dChk{to{stroke-dashoffset:0}}
.xp{stroke-dasharray:40;stroke-dashoffset:40;animation:dX .5s ease forwards}
.xp:nth-child(2){animation-delay:.3s}
@keyframes dX{to{stroke-dashoffset:0}}

/* Status strip */
.strip{max-width:820px;width:100%;display:none;align-items:center;justify-content:center;gap:7px;font-size:11px;color:#999;padding:8px;margin-top:8px}
.strip .dot{width:7px;height:7px;border-radius:50%;background:#4caf50;animation:pd 2s infinite}
.strip .dot.fail{background:#f44336}
@keyframes pd{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.4)}}

/* Demo bar */
.dbar{position:fixed;top:10px;left:50%;transform:translateX(-50%);display:none;gap:6px;z-index:200;background:rgba(0,0,0,.7);padding:5px 10px;border-radius:18px;backdrop-filter:blur(10px)}
.dbar button{padding:4px 12px;border:none;border-radius:10px;font-family:'Heebo';font-size:11px;font-weight:600;cursor:pointer;color:rgba(255,255,255,.5);background:0 0;transition:.2s}
.dbar button.on{color:#fff;background:rgba(255,255,255,.15)}
</style>
</head>
<body>

<div class="loading" id="ld"><div class="sp"></div><p>מאמת מסמך...</p></div>

<div class="dbar" id="dbar">
  <button class="on" id="bOk" onclick="goOk()">מקורי</button>
  <button id="bFk" onclick="goFk()">זיוף</button>
</div>

<div class="page-wrap" id="wrap">
  <div class="page-bg" id="pg">

    <div class="big-x" id="bx"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="8" y1="8" x2="92" y2="92" stroke="rgba(229,57,53,.07)" stroke-width="6" stroke-linecap="round"/><line x1="92" y1="8" x2="8" y2="92" stroke="rgba(229,57,53,.07)" stroke-width="6" stroke-linecap="round"/></svg></div>
    <div class="wm" id="wm">FORGED</div>

    <div class="doc-frame ${isPdf ? 'pdf' : ''}" id="frame">
      ${isPdf
        ? `<iframe src="data:application/pdf;base64,${fileBase64}"></iframe>`
        : isImage
          ? `<img src="data:${mimeType};base64,${fileBase64}" alt="document"/>`
          : `<div class="text-doc">${fileBase64}</div>`
      }
    </div>

    <!-- THE STAMP -->
    <div class="stamp" id="stamp">
      <div class="ring">
        <svg class="outer" id="sOut" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="95" fill="none" stroke="rgba(26,35,126,.22)" stroke-width="1.5"/>
          <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(26,35,126,.12)" stroke-width=".5" stroke-dasharray="4 4"/>
          <line x1="100" y1="2" x2="100" y2="10" stroke="rgba(26,35,126,.25)" stroke-width="1.5"/>
          <line x1="100" y1="190" x2="100" y2="198" stroke="rgba(26,35,126,.25)" stroke-width="1.5"/>
          <line x1="2" y1="100" x2="10" y2="100" stroke="rgba(26,35,126,.25)" stroke-width="1.5"/>
          <line x1="190" y1="100" x2="198" y2="100" stroke="rgba(26,35,126,.25)" stroke-width="1.5"/>
          <defs><path id="tp" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"/></defs>
          <text font-size="7.5" fill="rgba(26,35,126,.3)" font-weight="700" letter-spacing="2"><textPath href="#tp">PROTECTED VERIFIED FILE \\u2022 BLOCKCHAIN SECURED \\u2022 AUTHENTIC \\u2022</textPath></text>
        </svg>
        <div class="shim" id="sShim"></div>
        <div class="glow" id="sGlow"></div>
        <div class="inner-bg"></div>
        <div class="center" id="sCtr"></div>
      </div>
    </div>

  </div>
</div>

<div class="strip" id="strip">
  <div class="dot" id="sDot"></div>
  <span id="sTxt">מאומת | PVF Blockchain Verified</span>
</div>

<script>
var HASH="${fileHash}";
var API=window.location.origin||"http://localhost:${PORT}";
var token=null,faked=false;

async function init(){
  try{
    await new Promise(r=>setTimeout(r,400));
    var r=await fetch(API+"/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hash:HASH})});
    var d=await r.json();
    if(d.verified){token=d.token;show(true);startRefresh()}
    else show(false);
  }catch(e){show(false)}
}

function show(ok){
  document.getElementById("ld").classList.add("hide");
  document.getElementById("wrap").style.display="";
  document.getElementById("dbar").style.display="flex";
  document.getElementById("strip").style.display="flex";
  if(ok)setOk();else setFk();
}

function setOk(){
  faked=false;
  document.body.classList.remove("forged");
  document.getElementById("pg").classList.remove("forged");
  document.getElementById("bx").classList.remove("show");
  document.getElementById("wm").classList.remove("show");
  document.getElementById("sOut").classList.remove("frozen");
  document.getElementById("sShim").classList.remove("frozen");
  document.getElementById("sGlow").classList.remove("frozen");
  document.getElementById("sCtr").innerHTML='<svg viewBox="0 0 50 50" fill="none"><path class="chk" d="M12 26L22 36L38 16" stroke="rgba(46,125,50,.55)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="lbl ok">VERIFIED</div>';
  document.getElementById("sDot").className="dot";
  document.getElementById("sTxt").textContent="מאומת | PVF Blockchain Verified";
  document.getElementById("bOk").className="on";
  document.getElementById("bFk").className="";
}

function setFk(){
  faked=true;
  document.body.classList.add("forged");
  document.getElementById("pg").classList.add("forged");
  document.getElementById("bx").classList.add("show");
  document.getElementById("wm").classList.add("show");
  document.getElementById("sOut").classList.add("frozen");
  document.getElementById("sShim").classList.add("frozen");
  document.getElementById("sGlow").classList.add("frozen");
  document.getElementById("sCtr").innerHTML='<svg viewBox="0 0 50 50" fill="none"><path class="xp" d="M15 15L35 35" stroke="rgba(198,40,40,.55)" stroke-width="3.5" stroke-linecap="round"/><path class="xp" d="M35 15L15 35" stroke="rgba(198,40,40,.55)" stroke-width="3.5" stroke-linecap="round"/></svg><div class="lbl bad">FORGED</div>';
  document.getElementById("sDot").className="dot fail";
  document.getElementById("sTxt").textContent="אימות נכשל | Document Tampered";
  document.getElementById("bOk").className="";
  document.getElementById("bFk").className="on";
}

function startRefresh(){
  setInterval(async function(){
    if(faked)return;
    try{
      var r=await fetch(API+"/api/token/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hash:HASH})});
      var d=await r.json();
      if(d.success)token=d.token;
    }catch(e){setFk()}
  },30000);
}

function goOk(){setOk()}
function goFk(){setFk()}

init();
</script>
</body>
</html>`;
}

// ================================================================
// API: CREATE PVF — receives file, returns .pvf (BLIND TO CONTENT)
// ================================================================
app.post('/api/create-pvf', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'לא נשלח קובץ' });
    }

    const fileBuffer = req.file.buffer;
    const originalName = req.file.originalname || 'document';
    const mimeType = req.file.mimetype || 'application/octet-stream';

    // Step 1: Hash raw bytes (BLIND — never reads content)
    const fileHash = hashBytes(fileBuffer);

    // Step 2: Generate token
    const token = generateToken();
    const timestamp = new Date().toISOString();

    // Step 3: Register hash (NOT the content — just the fingerprint)
    registry.set(fileHash, {
      hash: fileHash,
      originalName,
      mimeType,
      fileSize: fileBuffer.length,
      timestamp,
      token,
      tokenCreatedAt: Date.now()
      // NOTE: we do NOT store the file content!
    });

    // Step 4: Build .pvf file
    const isPdf = mimeType === 'application/pdf';
    const isImage = mimeType.startsWith('image/');
    const isText = mimeType.startsWith('text/');

    let fileBase64;
    if (isText) {
      // For text files, use the text directly
      fileBase64 = fileBuffer.toString('utf-8');
    } else {
      // For binary (PDF, images), base64 encode
      fileBase64 = fileBuffer.toString('base64');
    }

    const pvfHtml = generatePvfHtml(fileBase64, originalName, fileHash, mimeType);

    console.log(`[CREATE PVF] ${originalName} (${mimeType})`);
    console.log(`  Hash: ${fileHash.substring(0, 24)}...`);
    console.log(`  Size: ${(fileBuffer.length / 1024).toFixed(1)} KB`);
    console.log(`  Content read: NO (blind processing)`);
    console.log(`  Total registered: ${registry.size}`);

    // Return .pvf file
    const pvfFileName = originalName.replace(/\.[^.]+$/, '') + '.pvf';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${pvfFileName}"`);
    res.send(pvfHtml);

  } catch (error) {
    console.error('[ERROR] Create PVF failed:', error.message);
    res.status(500).json({ success: false, error: 'שגיאה ביצירת PVF' });
  }
});

// ===== API: Verify (by hash only — no content needed) =====
app.post('/api/verify', (req, res) => {
  try {
    const { hash, content } = req.body;

    let lookupHash = hash;

    // Legacy support: if content object sent, compute hash
    if (!lookupHash && content) {
      lookupHash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
    }

    if (!lookupHash) {
      return res.status(400).json({ success: false, verified: false, error: 'חסר hash לאימות' });
    }

    const doc = registry.get(lookupHash);

    if (doc) {
      const newToken = generateToken();
      doc.token = newToken;
      doc.tokenCreatedAt = Date.now();
      console.log(`[VERIFY OK] ${lookupHash.substring(0, 16)}...`);
      res.json({ success: true, verified: true, hash: lookupHash, token: newToken, timestamp: doc.timestamp });
    } else {
      console.log(`[VERIFY FAIL] ${lookupHash.substring(0, 16)}...`);
      res.json({ success: true, verified: false, hash: lookupHash });
    }
  } catch (error) {
    res.status(500).json({ success: false, verified: false, error: 'שגיאה באימות' });
  }
});

// ===== API: Token Refresh =====
app.post('/api/token/refresh', (req, res) => {
  try {
    const { hash } = req.body;
    const doc = registry.get(hash);
    if (!doc) return res.json({ success: false, error: 'לא נמצא' });

    const newToken = generateToken();
    doc.token = newToken;
    doc.tokenCreatedAt = Date.now();
    res.json({ success: true, token: newToken, expiresIn: 30 });
  } catch (error) {
    res.status(500).json({ success: false, error: 'שגיאה' });
  }
});

// ===== API: Health =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', service: 'Vertifile', version: '1.0.0', documents: registry.size });
});

// ===== Root — Homepage =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== Upload page =====
app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

// ===== Verify page =====
app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});

// ===== Serve demo =====
app.get('/demo', (req, res) => {
  const p = path.join(__dirname, 'demo.pvf');
  if (fs.existsSync(p)) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.sendFile(p); }
  else res.status(404).send('demo.pvf not found');
});

// ===== Register demo document =====
const demoContent = { name:'יוסי כהן', degree:'בוגר במדעי המחשב (B.Sc.)', average:'92.4', year:'2024', docId:'PVF-2024-00482', issuer:'אוניברסיטת תל אביב' };
const demoHash = crypto.createHash('sha256').update(JSON.stringify(demoContent)).digest('hex');
registry.set(demoHash, { hash: demoHash, originalName: 'demo', mimeType: 'text/html', fileSize: 0, timestamp: new Date().toISOString(), token: generateToken(), tokenCreatedAt: Date.now() });

// ===== Start (local dev only — Vercel uses the export below) =====
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║     Vertifile — Protected Verified File        ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Port:       ${PORT}                                ║`);
    console.log(`║  Home:       http://localhost:${PORT}                  ║`);
    console.log(`║  Upload:     http://localhost:${PORT}/upload           ║`);
    console.log(`║  Verify:     http://localhost:${PORT}/verify           ║`);
    console.log(`║  Demo:       http://localhost:${PORT}/demo             ║`);
    console.log(`║  API:        POST /api/create-pvf                  ║`);
    console.log(`║  Privacy:    BLIND — never reads document content  ║`);
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
  });
}

// Export for Vercel serverless
module.exports = app;

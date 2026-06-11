# מפת המערכות של Vertifile (Systems Map)

מסמך אחד שמראה את **כל** המערכות שבנינו, מי משתמש בכל אחת, איפה היא יושבת בקוד, ואיך מגיעים אליה.
המטרה: שתוכל לנווט בעצמך בכל חלק של המוצר בלי להתבלבל בין "הדשבורדים שבנינו" לבין "המערכת שפותחת מסמכים".

## איך לקרוא את המפה הזו

לכל מערכת יש תווית סטטוס. ככה אתה רואה מיד מה אמיתי ומה לא:

- `[LIVE]` — רץ בפרודקשן היום (חי באוויר).
- `[DORMANT]` — בנוי לגמרי ומחובר בקוד, אבל **כבוי** ע"י דגל סביבה / לא מוגדר. עובד ברגע שמדליקים אותו.
- `[NOT BUILT]` — עדיין לא קיים.
- `[RETIRE]` — קיים אבל מת/נטוש, צריך למחוק.

איך להשתמש: סרוק את **מפת-העל** למטה (טבלה אחת, מסך אחד), מצא את המערכת שמעניינת אותך, ואז קפוץ לסעיף המפורט שלה (A עד M). הכול ממוספר.

כל מונח טכני (נתיב, פקודה, שם קובץ, שם טבלה, כתובת) כתוב באנגלית בתוך `כאלה` כדי שתוכל להעתיק אותו ישירות.

---

## מפת-על (System Overview)

| System | What it is (one line) | Where (path) | How to reach | Status |
|---|---|---|---|---|
| Express server | The backbone — serves site, API, documents | `server.js` | `node server.js` (port `3002`, prod `PORT`) | `[LIVE]` |
| Website (public pages) | Marketing + info pages (landing, pricing, verify) | `public/*.html` + `routes/pages.js` | `https://vertifile.com/` | `[LIVE]` |
| Customer App (`/app`) | The CUSTOMER's dashboard (SPA) | `public/app.html` | `https://vertifile.com/app` (login required) | `[LIVE]` |
| Admin / CRM (`/admin`) | YOUR private leads + CRM dashboard | `public/admin.html` + `routes/admin.js` | `https://vertifile.com/admin` (your password) | `[LIVE]` |
| Desktop Viewer (Electron) | The real local app that opens `.pvf` offline | `viewer/` | Install DMG, double-click a `.pvf` | `[LIVE]` |
| Tauri Viewer | Abandoned duplicate of the viewer | `viewer-tauri/` | — | `[RETIRE]` |
| AppleScript droplet | Old `.pvf` opener (just opens Chrome) | `~/Desktop/VertifileViewer.app` | — | `[RETIRE]` |
| `.pvf` + crypto core | The IP: tamper-proof self-contained HTML | `services/pvf-pipeline.js`, `templates/pvf.js` | created on upload; viewable in any browser | `[LIVE]` |
| API / Gateway / Webhooks | Programmatic access for business customers | `routes/api.js`, `routes/gateway.js`, `routes/webhooks.js` | `https://vertifile.com/api/...` | `[LIVE]` |
| SDK (CLI helper) | Local script `convertToPvf()` -> calls the API | `sdk.js` | `node sdk.js in.pdf out.pvf` | `[LIVE]` |
| Obfuscation worker | Per-PVF JS obfuscation thread | `workers/obfuscate-worker.js` | runs automatically per upload | `[LIVE]` |
| Outreach/sales cron | Sends YOUR sales emails (not the product) | `scripts/send-outreach.js` + `.sh` | cron / manual run | `[LIVE]` |
| Blockchain anchoring | On-chain proof on Polygon | `blockchain.js`, `contracts/VertifileRegistry.sol` | turns on with 2 env vars + deploy | `[DORMANT]` |
| Ed25519 dual-signing | Asymmetric signature alongside HMAC | `services/signing.js`, `services/key-manager.js` | ON in prod (env + DB key, `ED25519_REQUIRED=1` fail-closed); `[DORMANT]` by code-default | `[LIVE]` |
| Database | Neon Postgres (Frankfurt) | `db.js` + `repos/` | via `DATABASE_URL` (do not connect) | `[LIVE]` |
| Email (transactional) | Welcome / reset / verify / doc-ready | `services/email.js` | via Resend SMTP | `[LIVE]` |
| Auth & sessions | Login, passwords, lockout, OAuth | `routes/auth.js` + session in `server.js` | `https://vertifile.com/signup` | `[LIVE]` |
| Billing / payments | Charging customers, Stripe, etc. | — | — | `[NOT BUILT]` |
| i18n | 10 languages, client-side | `public/locales/*.json`, `public/js/i18n.js` | auto by geo / `?lang=xx` | `[LIVE]` |
| PWA (viewer scope) | Install-to-open `.pvf` in browser | `public/manifest.json`, `public/sw.js` | `https://vertifile.com/open` | `[LIVE]` |

---

## "מי זה מי" — לפתור את הבלבול (which is which)

זה החלק הכי חשוב. שני בלבולים נפוצים, ופה הם נפתרים סופית.

### שלושה "דשבורדים" שונים

| מה | למי | נתיב | סטטוס |
|---|---|---|---|
| `/app` | **ללקוח** — זה הדשבורד של הלקוח שלך (העלאה, מסמכים, חותמת, מיתוג) | `public/app.html` | `[LIVE]` |
| `/admin` | **רק לך** — דשבורד הלידים/CRM הפרטי שלך. הלקוחות לא רואים אותו | `public/admin.html` | `[LIVE]` |
| `dashboard.html.deprecated` | אף אחד — קובץ מת, להתעלם | `public/dashboard.html.deprecated` | `[RETIRE]` |

הכלל הפשוט: **לקוח = `/app`. אתה = `/admin`.** הם שני קבצים נפרדים לגמרי (וידאתי מול הקוד: `public/app.html` הוא ~275KB, `public/admin.html` הוא ~41KB).

### שלושה "פותחי מסמכים" שונים (+ הדפדפן)

| מה | מה הוא עושה | נתיב | סטטוס |
|---|---|---|---|
| **Electron Viewer** | האפליקציה האמיתית: פותחת `.pvf` בתוך עצמה, אופליין, בודקת אימות | `viewer/` | `[LIVE]` |
| Tauri Viewer | כפילה נטושה: רק זורקת את הקובץ לדפדפן המערכת, בלי אימות אמיתי | `viewer-tauri/` | `[RETIRE]` |
| AppleScript droplet | סקריפט ישן: רק מריץ `open -a 'Google Chrome'` | `~/Desktop/VertifileViewer.app` | `[RETIRE]` |
| הדפדפן עצמו | כי `.pvf` הוא HTML עצמאי — כל דפדפן פותח אותו ישירות | route `/d/:identifier` | `[LIVE]` |

הכלל הפשוט: **"המערכת המקומית שפותחת מסמכים" = אפליקציית `viewer/` (Electron).** היא החוויה האופליין הייעודית. בנוסף, **כל דפדפן** יכול לפתוח `.pvf` כי הקובץ נושא את כל ה‑HTML בתוכו.

הערה חשובה (gotcha): שלושת הפותחים חולקים את אותו `appId` — `com.vertifile.viewer`. לכן **מי שהותקן אחרון תופס את שיוך הקובץ `.pvf` ב‑macOS.** אם פתאום `.pvf` נפתח בכלי הלא נכון — זו הסיבה.

---

## A. האתר והאפליקציה (Website + Customer App)

**מה זה.** האתר הציבורי (דפי שיווק ומידע) + אפליקציית הלקוח `/app`.
**מי משתמש.** מבקרים אנונימיים באתר; לקוחות מחוברים ב‑`/app`.
**איפה זה.** דפים סטטיים ב‑`public/*.html`, הניתוב ב‑`routes/pages.js`. האפליקציה: `public/app.html`.
**איך מגיעים.** `https://vertifile.com/` לאתר, `https://vertifile.com/app` לאפליקציה.

נתיבי האתר (מתוך `routes/pages.js`, מאומת):
`/`, `/upload`, `/verify`, `/dashboard` (מפנה ל‑`/app`), `/enterprise`, `/integration`, `/open`, `/signup`, `/pricing`, `/support`, `/legal`, `/cookie-policy`, `/healthcare`, `/education`, `/finance`, `/reset-password`, `/blog` + `/blog/:slug`, הפניות שפה (`/he`, `/ar`, `/fr`, `/es`, `/de`, `/ru`, `/zh`, `/ja`, `/pt`) -> `/?lang=xx`, נתיבי מסמך (`/d/:identifier`, `/view-by-hash/:hash`, `/d/:id/raw`, `/d/:id/download`, `/d/:id/info`), דמו (`/demo`, `/demo-pvf`, `/demo-forged-pvf`), ו‑404 fallback.

למה `/about` עובד בלי `.html`? כי השרת מגיש סטטי עם `express.static(public, { extensions: ['html'] })` — נתיב `/x` נפתר אוטומטית ל‑`public/x.html` (מאומת ב‑`server.js`).

על האפליקציה (`/app`): היא נטענת בדפדפן וקוראת ל‑`GET /api/user/me`. ההגנה האמיתית היא **בצד השרת** — כל API של לקוח אוכף `requireAuth`. הדף לבדו לא מסתיר נתונים; ה‑API הוא ששומר.

`public/portal.html` ו‑`public/open.html` = stubs להפניה. סטטוס: `[LIVE]`.

---

## B. דשבורד הלידים / CRM שלך (Admin / CRM / Leads) — הפרטי שלך בלבד

**מה זה.** דשבורד ה‑CRM הפרטי שלך: לידים מטופס "צור קשר", משתמשים, סטטיסטיקות, audit, הכנסות/overage, ניטור.
**מי משתמש.** **רק אתה.** זה לא דשבורד לקוח.
**איפה זה.** הדף: `public/admin.html`. הניתוב: `routes/admin.js`.
**איך מגיעים.** `https://vertifile.com/admin`, התחברות עם הסיסמה שלך.

איך זה מאובטח (מאומת ב‑`routes/admin.js`):
- הדף `/admin` עצמו ציבורי, אבל מציג רק מסך התחברות. הדף מסומן `noindex`.
- התחברות: `POST /api/admin/login`, השוואת זמן-קבוע (`crypto.timingSafeEqual`) מול `ADMIN_PASSWORD` (נופל חזרה ל‑`ADMIN_SECRET` אם לא מוגדר). מוגבל ל‑5 ניסיונות/15 דק'.
- **כל** נקודת קצה של נתונים מאחורי `authenticateAdmin`. בלי סשן אדמין — אין נתונים.

לידים: מגיעים מטופס "צור קשר" באתר -> טבלת `leads`. על כל ליד חדש נשלח אימייל. נתיבים: `GET /api/admin/leads` (סינון לפי סטטוס + ספירות), `PATCH /api/admin/leads/:id` (סטטוס `new`/`contacted`/`closed`), `GET /api/admin/users` (חיפוש).

הערה (תיקון מול הקוד): הדשבורד **עשיר יותר** ממה שחשבנו. `routes/admin.js` חושף גם: `GET /api/admin/stats`, `/audit`, `/overview`, `/revenue`, `/overage`, `/usage-trends`, `/monitoring`, `/uptime`, `/alerts`, ניהול מפתחות API (`/keys`), מסמכים (`/documents`), שינוי תוכנית לארגון (`/org/:orgId/plan`), וייצוא CSV (`/export/:type`). כל אלה תחת `authenticateAdmin`. סטטוס: `[LIVE]`.

---

## C. ה‑Viewer לדסקטופ (Electron) + שתי הכפילות שצריך למחוק

### C1. Electron Viewer — האמיתי `[LIVE]`

**מה זה.** אפליקציית דסקטופ `pvf-viewer` v1.1.0, `appId` = `com.vertifile.viewer`. **זה ה‑Viewer האמיתי שנשלח.**
**מי משתמש.** כל מי שמקבל `.pvf` ורוצה לפתוח אותו במחשב.
**איפה זה.** `viewer/` (קבצים: `main.js`, `preload.js`, `viewer.html`).
**איך מגיעים.** מתקינים את ה‑DMG (mac) / ה‑Setup (win) ולוחצים פעמיים על קובץ `.pvf`.

איך זה עובד (מאומת ב‑`viewer/viewer.html`):
- מרנדר את ה‑`.pvf` בתוך האפליקציה דרך `iframe.srcdoc` (השורה `frame.srcdoc = content`).
- **אופליין מלא** — אין קריאות שרת/API לאימות. האימות מתבצע בתוך ה‑HTML של ה‑`.pvf` עצמו.
- מטפל ב‑10 מצבי שגיאת אימות (error-overlay עם אייקון/כותרת/הודעה).
- הנגיעה היחידה בשרת היא **לחיצת קישור יזומה של המשתמש** שפותחת בדפדפן את `https://vertifile.com/d/<shareId>` או `/view-by-hash/<hash>`.
- נבנה עם `electron-builder`. סקריפטים: `npm run build:mac`, `build:win`, `build:all`. לא חתום (`identity: null`). זה מתאים למתקיני ה‑DMG בדסקטופ.

### C2. Tauri Viewer — כפילה נטושה `[RETIRE]`

`viewer-tauri/` — אפליקציית Tauri `pvf-viewer-tauri` v1.1.0. מאומת ב‑`viewer-tauri/src-tauri/src/lib.rs`: היא **לא** מרנדרת בתוך עצמה — היא שומרת את ה‑`.pvf` לקובץ זמני וקוראת `open::that(...)` כדי לפתוח אותו ב**דפדפן המערכת**, עם השהיית `sleep(1500ms)`, ובלי אימות אמיתי. נטושה. למחוק.

### C3. AppleScript droplet — ישן `[RETIRE]`

`~/Desktop/VertifileViewer.app` — droplet v1.0 שרק מריץ `open -a 'Google Chrome'` על ה‑`.pvf`. (יושב על שולחן העבודה, לא ברפו.) למחוק.

**Gotcha (חוזר):** שלושתם חולקים `appId` = `com.vertifile.viewer`, אז ההתקנה האחרונה תופסת את שיוך `.pvf` ב‑macOS. כדאי למחוק את C2 ו‑C3 כדי שלא יתחרו ב‑C1.

ובנוסף: כי `.pvf` הוא HTML עצמאי, **כל דפדפן** פותח אותו ישירות — ה‑Electron הוא רק החוויה האופליין הייעודית.

---

## D. קובץ ה‑`.pvf` וליבת ההצפנה (the IP)

**מה זה.** הקסם של המוצר: הופך מסמך לקובץ HTML עצמאי וחסין-זיוף עם סיומת `.pvf` (MIME `application/vnd.vertifile.pvf`).
**מי משתמש.** המנגנון רץ אוטומטית בכל העלאה; הפלט נצרך ע"י לקוחות, מאמתים, וה‑Viewer.
**איפה זה.** `services/pvf-pipeline.js` + `services/pvf-generator.js` + `templates/pvf.js` (הפונקציה `generatePvfHtml`, מאומת בייצוא).
**איך מגיעים.** נוצר בעת העלאה (`/upload` או `/api/create-pvf`); נצפה בכל דפדפן או ב‑`viewer/`.

שתי גרסאות פורמט:
- **PVF 1.0** — HTML עצמאי בטקסט גלוי.
- **PVF 2.0 ZK** — מוצפן `AES-256-GCM` (פירוט ב‑`docs/ZERO-KNOWLEDGE-SPEC.md`).

מודל ההצפנה (מאומת בהערות הצינור):
1. `SHA-256` עיוור של המסמך.
2. `HMAC-SHA256` עם המפתח `HMAC_SECRET`.
3. חתימת Ed25519 כפולה — אופציונלית בקוד, אך **פעילה בפרודקשן** (ראה סעיף H; `[DORMANT]` בברירת-מחדל של הקוד, `[LIVE]` בפרודקשן fail-closed).
4. ערבול JS דטרמיניסטי (seed = 8 התווים ההקס הראשונים של ה‑hash).
5. "chain token" = `HMAC-SHA256(HMAC_SECRET, hash + signature + orgId + codeIntegrity)` — HMAC עם מפתח, מאומת ב‑`services/pvf-pipeline.js` (הערת הקוד הסמוכה ממפתת אותו בטעות כ‑`sha256`).

חותמת דו-שכבתית:
- **שכבה 1** — קריפטוגרפית, בלתי-משתנה, חלק מה‑hash.
- **שכבה 2** — חותמת ויזואלית שמוזרקת בזמן צפייה **בלי לשנות את ה‑hash**. זו הפונקציה `injectStampConfig` ב‑`routes/pages.js` שקוראת את `users.stamp_config` (JSONB) ומזריקה סקריפט ממש לפני ה‑`</body>` האחרון (משתמשת ב‑`lastIndexOf('</body>')` — מאומת — כדי לא לפגוע ב‑`</body>` מזויף בתוך קוד מעורבל).

Ed25519 (לסעיף H): מחרוזת ה‑payload = `hash|orgId|createdAt|recipientHash|codeIntegrity`; `keyId = sha256(spki-pem).slice(0,16)`; מפתח החתימה הסמכותי הוא השורה ב‑DB `ed25519_keys WHERE state='active'`. Fail-closed אם `ED25519_REQUIRED==='1'`. סטטוס הליבה: `[LIVE]`.

---

## E. API / SDK / אינטגרציות (Integrations)

**מה זה.** גישה תכנותית למוצר עבור לקוחות עסקיים.
**מי משתמש.** מערכות של לקוחות עם מפתח `X-API-Key`.
**איפה זה.** קבוצות ניתוב ב‑`routes/` (ממוקמות ב‑`server.js`).
**איך מגיעים.** `https://vertifile.com/api/...`. מתועד בדף `/integration`.

קבוצות ה‑API (מאומת ב‑`server.js`):

| Group | File | Auth | What |
|---|---|---|---|
| `/auth` | `routes/auth.js` | session | login/signup/OAuth/reset |
| `/api/user` | `routes/user.js` | `requireAuth` | פעולות לקוח מחובר |
| `/api` | `routes/api.js` | mixed/key | `create-pvf`, `verify`, `contact`, `signup`, `health` |
| `/api/admin` | `routes/admin.js` | `authenticateAdmin` | רק אתה (סעיף B) |
| `/api/gateway` | `routes/gateway.js` | API key | intake + batch (עד 50 קבצים) |
| `/api/webhooks` | `routes/webhooks.js` | API key | webhooks (מוקשח נגד SSRF) |
| `/api` (onboarding) | `routes/onboarding.js` | mixed | קודי אימות + מצב אשף |
| `/.well-known` | `routes/well-known.js` | public | מפתח ציבורי / jwks / security.txt |

פרטים (מאומת):
- מפתחות ב‑טבלת `api_keys`. הגבלת הקצב נאכפת **לכל מפתח** דרך `req.org.rateLimit` (לא מדרגות לפי תוכנית). ברירת המחדל למפתח חדש היא `100` (`db.js`, `server.js`). כשאדמין משייך תוכנית עם `updateOrgPlan` ה‑`rate_limit` של המפתח נקבע ל‑`pro: 500`, `business: 10000`, `enterprise: 100000` (`repos/admin-repo.js`). הדף הציבורי `/integration` לא מפרסם מספרים ("contact us").
- Gateway: `POST /api/gateway/intake` (קובץ בודד) ו‑`POST /api/gateway/batch` (`upload.array('files', 50)` — עד 50).
- Webhooks: חתומים ב‑HMAC-SHA256 עם הכותרת `X-Vertifile-Signature` (מאומת ב‑`routes/webhooks.js`).

**SDK** (`sdk.js`): עוזר CLI **מקומי** שחושף `convertToPvf(input, output, opts)` ששולח `POST` ל‑`/api/create-pvf` עם כותרת `X-API-Key` (מאומת). **לא פורסם ל‑npm.** מתועד בדף `/integration`. סטטוס: `[LIVE]`.

---

## F. עובדי רקע + קרון השיווק (Background workers + outreach)

### F1. עובד הערבול `[LIVE]`

ה‑worker היחיד בזמן ריצה הוא `workers/obfuscate-worker.js` — קובץ זעיר (חוט `worker_threads` חד-פעמי) שרק מריץ את הערבול ומחזיר את הקוד המעורבל; אין בו timeout. ה‑timeout של 30 שניות (כולל `worker.terminate()` ונפילה חזרה לקוד המקורי) נאכף ע"י **הקורא** שמייצר את ה‑worker — `obfuscate.js` (`obfuscateCode`), שאליו קורא הצינור דרך `obfuscatePvf`. מאומת: זה **לא** דמון ארוך-טווח.

### F2. קרון Outreach / מכירות `[LIVE]` (לא חלק מהמוצר)

נפרד לגמרי מזמן הריצה של המוצר: מערכת outreach/מכירות תחת `scripts/` — `scripts/send-outreach.js` + סקריפטי shell (`send-outreach-cron.sh`, `send-followup-1-cron.sh`). שולחת אימיילי מכירות דרך `info@vertifile.com` מעל Namecheap SMTP (`mail.privateemail.com`), ומתעדת ל‑`logs/outreach-sends.jsonl`. **זו מכונת המכירות שלך, לא חלק ממוצר הלקוח.**

מלאי השירותים (`services/`, מאומת): `pvf-pipeline.js`, `pvf-generator.js`, `signing.js`, `key-manager.js`, `email.js`, `email-templates.js`, `onboarding-emails.js`, `stamp-override.js`, `pdfjs-inline.js`, `password-validator.js`, `env-validator.js`, `db-config.js`, `logger.js` (pino).

---

## G. בלוקצ'יין / חוזים חכמים (Blockchain) — `[DORMANT]`

**מה זה.** עיגון on-chain של מסמכים על רשת Polygon (הוכחה ציבורית בלתי-ניתנת-לשינוי).
**מי משתמש.** אף אחד היום — כבוי. כשיודלק, יוסיף הוכחת blockchain לכל מסמך.
**איפה זה.** `blockchain.js` (ethers v6) + `contracts/VertifileRegistry.sol` (Solidity 0.8.20) + `hardhat.config.js` + `contracts/deploy.js`.
**איך מדליקים.** מגדירים את **שני** משתני הסביבה `POLYGON_PRIVATE_KEY` ו‑`POLYGON_CONTRACT`, ופורסים את החוזה.

מאומת ב‑`blockchain.js`: רשתות = `amoy` (chainId 80002, **ברירת מחדל**), `mumbai` (80001), `polygon` (137). הקוד **מחובר** ל‑`server.js` ולצינור היצירה, אבל אם `POLYGON_PRIVATE_KEY`/`POLYGON_CONTRACT` לא מוגדרים הוא מדלג (`[BLOCKCHAIN] Skipped`). אין חוזה פרוס היום. לכן Vertifile משתמש **בעיגון HMAC בלבד** כרגע.

---

## H. חתימה כפולה Ed25519 (Dual-signing) — `[LIVE]` בפרודקשן (`[DORMANT]` בברירת-מחדל של הקוד)

**מה זה.** חתימה אסימטרית (Ed25519) במקביל ל‑HMAC, להוכחה ציבורית שניתן לאמת עם מפתח ציבורי.
**מי משתמש.** הפרודקשן — פעיל ו‑fail-closed. כל PVF חדש נחתם כפול (Ed25519 לצד HMAC) או נדחה. (בברירת-מחדל של הקוד זה כבוי: `.env.example` מגיע עם הדגלים על `0`, וב‑`services/key-manager.js` אם `ED25519_PRIVATE_KEY_PEM` לא מוגדר `signEd25519()` מחזיר `null` והאפליקציה רצה HMAC בלבד.)
**איפה זה.** `services/signing.js`, `services/key-manager.js`, טבלאות `ed25519_keys` + `key_rotation_log`, ונקודת קצה jwks ב‑`/.well-known`.
**איך מדליקים.** הדגלים `ED25519_SIGNING_ENABLED`, `ED25519_VERIFY_ENABLED`, `ED25519_REQUIRED` (כולם `0` ב‑`.env.example`) + טעינת מפתח (`ED25519_PRIVATE_KEY_PEM`).

מאומת: ב‑`services/key-manager.js`, אם `ED25519_PRIVATE_KEY_PEM` לא מוגדר — אזהרה ו‑`signEd25519()` מחזיר `null`; האפליקציה מתפקדת לחלוטין בלי Ed25519. אכיפת `ED25519_REQUIRED==='1'` נמצאת בצינור (`services/pvf-pipeline.js`), ומפילה יצירת PVF אם אין חתימה. הערה: בקוד מצאתי שימוש ב‑process.env רק ב‑`ED25519_REQUIRED`; הדגלים `ED25519_SIGNING_ENABLED`/`VERIFY_ENABLED` מופיעים ב‑`.env.example` אבל ההדלקה בפועל נשלטת ע"י נוכחות מפתח + שורת `state='active'` ב‑DB.

בפרודקשן: התכונה **מוגדרת ולכן פעילה** — `ED25519_PRIVATE_KEY_PEM` מוגדר, יש שורת מפתח פעיל ב‑DB (`ed25519_keys WHERE state='active'`, keyId `0f65ad1b92590c92`), ו‑`ED25519_REQUIRED=1` הופך אותה ל‑fail-closed. לוג ה‑boot החי מאשר: `[key-manager] primary key slot loaded, keyId 0f65ad1b92590c92, type ed25519` ו‑`[key-manager] Phase 2E fail-closed enforcement ACTIVE — every new PVF will be dual-signed or rejected`. האכיפה היא ב‑`services/pvf-pipeline.js` (בדיקת `ED25519_REQUIRED==='1'` שזורקת `ED25519_REQUIRED_NO_SIGNATURE` אם אין חתימה).

---

## I. מסד הנתונים (Neon Postgres) + טבלאות

**מה זה.** מסד הנתונים של המוצר — כל המסמכים, המשתמשים, הלידים.
**מי משתמש.** השרת בלבד, דרך `db.js`.
**איפה זה.** `db.js` (חזית מעל `pg.Pool`, max 20) + `repos/` (`admin-repo.js`, `auth-repo.js`, `document-repo.js`, `gateway-repo.js`, `helpers.js`).
**איך מגיעים.** דרך `DATABASE_URL` (Neon, אזור פרנקפורט). **אל תתחבר** — זה מסד פרודקשן.

הסכימה נוצרת אוטומטית באתחול דרך `CREATE TABLE IF NOT EXISTS` (ב‑`db.js`) + ראנר `migrations/`.

טבלאות הליבה (מאומת מתוך `db.js` — 16 טבלאות):
`documents`, `api_keys`, `audit_log`, `webhooks`, `users`, `sessions`, `leads`, `ed25519_keys`, `key_rotation_log`, `health_checks`, `password_resets`, `verification_codes`, `user_profiles`, `login_attempts`, `overage_log`, `onboarding_state`.

טבלאות נוספות מ‑`migrations/` (תיקון/הוספה מול הקוד): `onboarding_emails` (מ‑`002_onboarding_emails.sql`), וכן `subscriptions` ו‑`stamp_configs` מופיעות בהגדרות סכימה. שווה לדעת שהן קיימות מעבר ל‑16 הליבה.

---

## J. מערכת האימייל (Email)

**מה זה.** אימיילים טרנזקציוניים (welcome, reset, verify, doc-ready, אישור צור-קשר).
**מי משתמש.** המוצר, אוטומטית, באירועי משתמש.
**איפה זה.** `services/email.js` (+ תבניות ב‑`services/email-templates.js`, דריפ ב‑`services/onboarding-emails.js`).
**איך מגיעים.** דרך Resend SMTP (`smtp.resend.com:465`, מאומת).

ייצואים מ‑`services/email.js`: `sendEmail`, `sendPasswordResetEmail`, `sendVerificationCode`, `sendWelcomeEmail`, `sendDocumentReadyEmail`, `sendContactConfirmationEmail`.

דריפ אונבורדינג (`services/onboarding-emails.js`, מאומת): `welcome` (0h), `first_doc` (24h, מדלג אם כבר העלה), `stamp` (72h), `share` (120h), `upgrade` (168h, מדלג אם לא בטרייל). מתוזמן עם `setTimeout`. **שבריריות ידועה:** טיימר חי לא שורד ריסטרט של התהליך. **ניואנס מול הקוד:** כל אימייל **כן** נרשם בטבלת `onboarding_emails` כדי למנוע כפילויות — אז המצב נשמר ב‑DB, אבל הטיימר שבזיכרון אובד בריסטרט (ההערה בקוד ממליצה על תור עבודות אמיתי כמו pg-boss/BullMQ).

(ה‑SMTP הנפרד דרך Namecheap הוא קרון המכירות בסעיף F2 — לא טרנזקציוני.) סטטוס: `[LIVE]`.

---

## K. הזדהות וסשנים (Auth & sessions)

**מה זה.** התחברות, סיסמאות, נעילת חשבון, OAuth, איפוס.
**מי משתמש.** כל לקוח מחובר.
**איפה זה.** `routes/auth.js` + תצורת הסשן ב‑`server.js`.
**איך מגיעים.** `https://vertifile.com/signup`, `https://vertifile.com/reset-password`.

מאומת:
- סיסמאות: `bcrypt`, `BCRYPT_ROUNDS = max(12, env)`; סיסמאות חלשות נחסמות ע"י רשימת חסימה הנטענת מ‑`data/common-passwords.txt` (קבוע `COMMON_PASSWORDS_PATH` ב‑`routes/auth.js`, גם ב‑`services/password-validator.js`). אם הקובץ חסר הטעינה מדלגת בשקט (`catch` ב‑`routes/auth.js`) והבדיקה `if (commonPasswords.size > 0 && ...)` פשוט לא חוסמת. **תיקון מול הקוד:** הקובץ נמצא תחת `data/` שמופיע ב‑`.gitignore` (שורה 8), ולכן מעולם לא נשלח ל‑Render — חסימת הסיסמאות החלשות הייתה **כבויה בשקט בפרודקשן** (לוג ה‑boot: `Common password blacklist not found at data/common-passwords.txt — skipping`). מתוקן ע"י `git add -f` של רשימת המילים הסטטית לריפו כדי להבטיח שתישלח לפרודקשן.
- סשנים: `express-session` + `connect-pg-simple` (טבלת `sessions`). מזהה הסשן מתחדש בכל מעבר הזדהות. עוגיית הדפדפן היא 7 ימים **קבועים** (אין `rolling: true` ב‑`server.js`), אם כי `connect-pg-simple` מבצע `touch` ל‑`expire` של שורת הסשן בצד השרת. מקס 5 סשנים למשתמש; כולם מבוטלים באיפוס סיסמה.
- **תיקון מול הקוד:** הבריפינג אמר נעילה אחרי 5 כשלונות. אבל ב‑`server.js` (`LocalStrategy`) הנעילה היא **אחרי 10 כשלונות**, לנעילה של **30 דקות** (`if (attempts >= 10) ... 30 * 60 * 1000`). יש בנוסף מגביל קצב נפרד (`authLimiter`) ל‑5/15 דק' על נקודות הזדהות וטבלת `login_attempts`. סומכים על הקוד: lockout = 10 כשלונות / 30 דק'.
- Google OAuth אופציונלי (passport) — נטען רק אם `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` מוגדרים.
- איפוס סיסמה: `randomBytes(32)`. אימות אימייל: קודי 6 ספרות. מחיקת חשבון: מוחקת לצמיתות את מסמכי המשתמש + שורת המשתמש.

סטטוס: `[LIVE]`.

---

## L. חיוב / תוכניות / תשלומים (Billing / payments) — `[NOT BUILT]`

**מה זה.** גביית כסף מלקוחות.
**מי משתמש.** אף אחד — לא קיים.
**איפה זה.** אין ספק תשלום מחובר. אין Stripe/PayPal SDK ואין קוד גבייה ב‑`package.json` (מאומת — אין תלות תשלום). "stripe" מופיע רק בטסטים / כעמודות DB לא בשימוש.
**איך מגיעים.** —

המצב היום (מאומת ב‑`repos/admin-repo.js`):
- תוכניות נאכפות כדגלי DB + ספר חשבונות overage בלבד. `subscription_status` נקרא אך לעולם לא נכתב.
- `PLAN_PRICES = { pro: 49, business: 79, enterprise: 0 }`
- `PLAN_LIMITS = { pro: 500, business: 1000, enterprise: Infinity }`
- `OVERAGE_RATES = { pro: 0.15, business: 0.10, enterprise: 0 }`
- `trackOverage` כותב ל‑`overage_log`. שימוש לא-משולם הוא תצוגה-בלבד; הורדה חסומה ושולחת ל‑`/pricing`. כתובות `ADMIN_EMAILS` עוקפות מגבלות.

**אי-התאמה בשמות התוכניות (חשוב):** ה‑UI משתמש ב‑`pro` / `pro_plus` / `enterprise` (מאומת: `pro_plus` ב‑`public/app.html` ו‑`public/onboarding.html`), אבל השרת + האדמין משתמשים ב‑`pro` / `business` / `enterprise`. צריך ליישר את זה.

זהו **פער טרום-השקה** ורלוונטי לכלל "לבנות ל‑100% לפני השקה".

---

## M. ריבוי-שפות + PWA (i18n + PWA)

**i18n** (`[LIVE]`): צד-לקוח, 10 שפות ב‑`public/locales/*.json` (מאומת: `ar, de, en, es, fr, he, ja, pt, ru, zh`), הדרייבר `public/js/i18n.js`, זיהוי גאוגרפי דרך `ipapi.co`. הפעלה גם ידנית עם `?lang=xx`.

**PWA** (`[LIVE]`): ממוקד לחוויית ה‑Viewer — `public/manifest.json` (`start_url` = `/open`, `file_handlers` ל‑`.pvf`, `share_target` — הכול מאומת) + `public/sw.js` (service worker מסוג cache-first). מאפשר "התקן כדי לפתוח `.pvf`" בדפדפן.

---

## איך הכל מחובר (How it all connects)

הרעיון בפשטות: **הדפדפן/האתר -> שרת Express (`server.js`) -> ניתובים -> שירותים -> מסד נתונים (Neon).** ה‑Viewer לדסקטופ עומד בנפרד, אופליין, וחוזר לשרת רק כשהמשתמש לוחץ קישור.

```
                         לקוח / מבקר
                              |
            +-----------------+------------------+
            |                                    |
       דפדפן/אתר                          Desktop Viewer (Electron)
   https://vertifile.com                     viewer/  (offline)
            |                                    |
            v                              קורא .pvf מקומי -> iframe.srcdoc
   server.js (Express, port 3002)               |   (אימות בתוך הקובץ)
   helmet -> CORS -> json(1mb) ->                |
   sanitize -> compression ->                    |  רק בלחיצת קישור יזומה:
   static(public,{ext:html}) ->                  +--> vertifile.com/d/<shareId>
   PgSession -> passport -> csrf ->                   או /view-by-hash/<hash>
   timeout(30s) -> rate-limit(200/15min /api)
            |
   +--------+----------+----------+-----------+-----------+
   |        |          |          |           |           |
 pages    /auth     /api/user   /api      /api/gateway  /api/admin
(routes) (auth)    (requireAuth)(create   (intake+      (authenticateAdmin
   |                              -pvf,    batch<=50)     -> רק אתה)
   v                              verify)
 services/pvf-pipeline.js
   -> templates/pvf.js (generatePvfHtml)
   -> obfuscate (workers/obfuscate-worker.js)
   -> services/signing.js (HMAC + Ed25519 active in prod, fail-closed)
   -> blockchain.js (dormant)
            |
            v
        db.js  ->  repos/  ->  Neon Postgres (Frankfurt)
```

נקודה למזכרת: ה‑`.pvf` עצמו עצמאי. הוא **לא** צריך את השרת כדי להיפתח או להיבדק (חוץ ממקרה אחד: PVF של PDF צריך את `vertifile.com` בשביל קובץ ה‑worker של PDF.js — ראה `server.js`, נתיב `/vendor/pdfjs`).

---

## לוח הבקרה: משתני סביבה (Control panel: environment variables)

שמות בלבד — בלי ערכים. כל שורה אומרת מה הדגל שולט.

### חובה בפרודקשן (חסר = השרת נופל)
| Var | What it controls |
|---|---|
| `DATABASE_URL` | חיבור ל‑Neon Postgres (פרודקשן) |
| `HMAC_SECRET` | המפתח לחתימת ה‑HMAC של כל מסמך (ליבת ה‑IP) |
| `SESSION_SECRET` | חתימת עוגיות הסשן; חסר = משתמשים מתנתקים בכל deploy |
| `NODE_ENV` | מצב ריצה (`production` מפעיל עוגיות מאובטחות + CORS מחמיר) |

### דגלי פיצ'ר (Feature flags)
| Var | What it controls |
|---|---|
| `PVF_PIPELINE_V2` | מפעיל את צינור ה‑PVF החדש (`=1`) |
| `ED25519_SIGNING_ENABLED` | חתימת Ed25519 (`=0` כבוי) |
| `ED25519_VERIFY_ENABLED` | אימות Ed25519 (`=0` כבוי) |
| `ED25519_REQUIRED` | אם `=1`, יצירת PVF נכשלת בלי חתימת Ed25519 (fail-closed) |

### ספקים אופציונליים (לא חובה)
| Var | What it controls |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | מפעילים התחברות Google |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | אימייל טרנזקציוני (Resend) |
| `OUTREACH_SMTP_*` | SMTP נפרד לקרון המכירות (Namecheap) — לא המוצר |
| `POLYGON_PRIVATE_KEY` / `POLYGON_CONTRACT` / `POLYGON_NETWORK` | מדליקים עיגון blockchain |
| `ED25519_PRIVATE_KEY_PEM` / `ED25519_PRIMARY_KEY_ID` | טעינת מפתח חתימה Ed25519 |
| `ADMIN_PASSWORD` / `ADMIN_SECRET` | גישה לדשבורד `/admin` שלך |
| `ADMIN_EMAILS` | אימיילים שעוקפים מגבלות תוכנית |

---

## נכסים וחשבונות חיצוניים (External assets & accounts)

| Asset | Detail |
|---|---|
| Domain | `vertifile.com` (רשם: Namecheap) |
| IANA MIME | `application/vnd.vertifile.pvf` — אושר 2026-04-15 |
| Patent | הוגש בישראל, בהמתנה (תשובת קדם-בחינה ref 327212) |
| Hosting (LIVE) | **Render** (`Procfile`: `web: node server.js`, auto-deploy מ‑`main`) |
| Database | Neon Postgres (פרנקפורט) |
| Transactional email | Resend (`smtp.resend.com:465`) |
| Sales/outreach email | Namecheap Private Email (`mail.privateemail.com`, `info@vertifile.com`) |
| Source | GitHub |
| Optional | Google OAuth, Polygon RPC (ציבורי) |

מציאות הדפלוי: ה‑**Render** הוא האמיתי. קיים `Dockerfile` (מאומת: `EXPOSE 10000`, `node:18-alpine`) ותצורות legacy (`vercel.json`, `railway.json`, `nixpacks.toml`) — אלה ישנות, לא בשימוש. **אין `render.yaml`** (מאומת). אין Sentry/analytics מחוברים.

איפה לקרוא עוד (Docs map):
- `README.md` — התחל פה. דיווח הגרסה מאוחד כעת ל‑`package.json` (`4.7.0`) על פני `README.md` + ארבע נקודות הקצה (`/api/status`, `/api/health`, `/api/health/deep`, `/api/docs`) דרך קבוע `_pkgVersion` יחיד (`routes/api.js`, commit `5e7f5a2`) — אין יותר דריפט גרסה.
- `ARCHITECTURE.md`, `SECURITY.md`, `CHANGELOG.md` (האחרון `[4.7.0]` 2026-04-16, מאומת).
- `docs/DEPLOYMENT.md` (מסמך התפעול הכי טוב), `docs/ZERO-KNOWLEDGE-SPEC.md`.
- `spec/PVF-FORMAT-SPEC-v1.0.md` + `spec/IANA-REGISTRATION.md` (מאומת).
- תיקיות עסקיות תחת `docs/`: `finance/`, `sales/`, `marketing/`, `patent-updates/`, `social-media/`, `product/`, `support/`, `blog/`, `design-assets/`, `video-scripts/`.

---

## איך מריצים ומגיעים לכל דבר (Cheat-sheet)

### כתובות (URLs)
| Goal | URL |
|---|---|
| אתר ראשי | `https://vertifile.com/` |
| העלאה | `https://vertifile.com/upload` |
| אימות מסמך | `https://vertifile.com/verify` |
| דשבורד הלקוח | `https://vertifile.com/app` |
| **דשבורד הלידים שלך** | `https://vertifile.com/admin` |
| הרשמה / איפוס | `https://vertifile.com/signup` , `/reset-password` |
| מחירון | `https://vertifile.com/pricing` |
| צפייה במסמך | `https://vertifile.com/d/<shareId-or-slug>` |
| הורדת מסמך | `https://vertifile.com/d/<id>/download` |
| דמו | `https://vertifile.com/demo` , `/demo-pvf` , `/demo-forged-pvf` |
| מפתח ציבורי / jwks | `https://vertifile.com/.well-known/vertifile-pubkey.pem` , `/.well-known/vertifile-jwks.json` |

### פקודות (run / build)
| Goal | Command | Dir |
|---|---|---|
| הרצת השרת | `node server.js` | root |
| dev / start | `npm run dev` / `npm start` | root |
| טסטים | `npm test` | root |
| מיגרציות DB | `npm run migrate` | root |
| גיבוי Neon | `npm run backup` | root |
| בניית Viewer (mac) | `npm run build:mac` | `viewer/` |
| בניית Viewer (win) | `npm run build:win` | `viewer/` |
| בניית Viewer (שניהם) | `npm run build:all` | `viewer/` |
| המרת קובץ ל‑PVF (CLI) | `node sdk.js in.pdf out.pvf` | root |
| קרון מכירות (ידני) | `node scripts/send-outreach.js` | root |

---

## פערים וחובות טכניים (Known gaps & drift)

1. **תשלומים לא נבנו** (`[NOT BUILT]`) — אין ספק תשלום, אין קוד גבייה. פער טרום-השקה לפי כלל "100% לפני השקה".
2. **כפילות Viewer למחיקה** (`[RETIRE]`) — `viewer-tauri/` ו‑`~/Desktop/VertifileViewer.app` מתים. בנוסף, ה‑`appId` המשותף `com.vertifile.viewer` יוצר התנגשות שיוך `.pvf` ב‑macOS — מחיקתם משאירה רק את ה‑Electron האמיתי.
3. **אי-התאמת שמות תוכניות** — ה‑UI אומר `pro_plus`, השרת/אדמין אומרים `business`. ליישר אוצר-מילים.
4. **דריפ אימייל על `setTimeout`** — הטיימר החי אובד בריסטרט תהליך (המצב כן נשמר ב‑`onboarding_emails`, אבל ההזמנה החיה לא). ההמלצה בקוד: לעבור לתור עבודות (pg-boss/BullMQ).
5. **Blockchain כבוי** (`[DORMANT]`) — מקודד אבל לא מופעל (לוג ה‑boot: `[BLOCKCHAIN] Skipped`). זה **לא פער**, רק לא דלוק; נדלק ע"י משתני סביבה (ראה G). Ed25519 לעומת זאת **פעיל בפרודקשן** (`[LIVE]`, fail-closed) — ראה H.

### תיקונים שבוצעו מול הקוד (corrections)
- **chain token** = `HMAC-SHA256` עם מפתח `HMAC_SECRET` על `hash + signature + orgId + codeIntegrity` — לפי `services/pvf-pipeline.js`.
- **נעילת חשבון** = 10 כשלונות / 30 דקות (לא 5) — לפי `LocalStrategy` ב‑`server.js`. בנפרד קיים `authLimiter` של 5/15 דק'.
- **דשבורד `/admin` עשיר יותר** מהרשימה המקורית — כולל stats/audit/revenue/overage/monitoring/keys/documents/export. הכול תחת `authenticateAdmin`.
- **דגלי Ed25519** — בקוד השירות נמצא רק `ED25519_REQUIRED` כדגל process.env פעיל; `ED25519_SIGNING_ENABLED`/`VERIFY_ENABLED` קיימים ב‑`.env.example`, אך ההדלקה בפועל נקבעת ע"י נוכחות מפתח + שורת `state='active'` ב‑DB.
- **טבלאות נוספות** מעבר ל‑16 הליבה: `onboarding_emails`, `subscriptions`, `stamp_configs` (מתוך `migrations/`).
- **מפתח API ברירת-מחדל** נוצר עם תוכנית `professional` (ב‑`server.js`) — שמור לתשומת לב מול אוצר-המילים `pro`/`business`.

---

נבדק מול הקוד בתאריך 2026-06-12

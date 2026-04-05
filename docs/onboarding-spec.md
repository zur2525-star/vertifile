# Onboarding Wizard — Product Spec

**Date:** 2026-04-04
**Participants:** Amit (Product), Dana (UX), Chen (Support), Moshe (Backend)
**Dispatched by:** Ori
**Status:** Draft — Pending Zur's Review

---

## The Discussion

### Round 1 — Setting the Stage

**Amit (Product):** טוב, בואו נתחיל. המטרה ברורה — wizard onboarding full-screen, בהשראת ElevenLabs. אבל לפני שנצלול למסכים, השאלה הכי חשובה: מה המטרה העסקית? אנחנו לא בונים wizard כי זה יפה. אנחנו בונים אותו כי יש לנו 0 לקוחות משלמים. הwizard צריך לעשות שלושה דברים: (1) לאסוף data שמאפשר לנו להמליץ על plan, (2) ליצור תחושת בעלות דרך customization של החותמת — זה ה-hook של זור, (3) להוריד את ה-time-to-value — שהמשתמש ירגיש ערך לפני שהוא שילם שקל. שאלה לכולם: האם 6 steps זה לא יותר מדי? מה ה-data על drop-off rates ב-wizards ארוכים?

**Dana (UX):** שאלה טובה. לפי מה שאני מכירה מ-UX research, כל שלב מעל 5 מוריד completion ב-20-30%. אבל — זה תלוי בסוג ה-steps. Steps שהמשתמש מרגיש שהם "עבורו" (כמו customize stamp) יש להם retention גבוה. Steps שמרגישים כמו "סקר" — drop-off מהר. ההבדל הקריטי: האם כל שלב נותן ערך מיידי למשתמש, או רק לנו? Step 1-2 (מי אתה, מה התחום) — זה בעיקר לנו. Step 5 (customize stamp) — זה לו. אני מציעה לדחוס את 1-2 לשלב אחד עם conditional cards. זה מוריד אותנו ל-5 steps.

**Chen (Support):** רגע, לפני שנקצר — אני רוצה להביא את זווית המשתמש. הרבה מהלקוחות שלנו, בטח ממגזר ממשלתי או בריאותי, הם אנשים שלא בהכרח tech-savvy. הם לא מכירים "onboarding wizards". הם מכירים טפסים. אם ניקח את זה לפורמט של כרטיסים יפים עם אייקונים — חלקם יתבלבלו. צריך שיהיה ברור מאוד מה לעשות בכל שלב. כמו כן — מה קורה עם RTL? הלקוחות העיקריים שלנו עכשיו הם ישראלים. ה-wizard חייב להיות RTL-first. וזה משפיע על layout של הכרטיסים.

**Moshe (Backend):** נתחיל מהטכני. Step 0 — email verification. יש כבר מנגנון auth במערכת? כרגע יש לנו signup רגיל + Google OAuth. שאלות: (1) האם נשמור את ה-wizard state בצד שרת או client? אם המשתמש סוגר אמצע wizard ומחזיר — מאיפה הוא ממשיך? (2) האם ה-wizard ירוץ לפני שיש user record ב-DB, או אחרי? כי אם אחרי — אני צריך user_profile table עם שדות שמתאימים לכל step. (3) Email verification — האם זה blocking? כלומר, המשתמש לא יכול להתחיל wizard בלי לאמת?

---

### Round 2 — Digging Deeper

**Amit (Product):** תשובות למשה: (1) Wizard state חייב להיות server-side. לא סומך על localStorage — אם המשתמש מחליף דפדפן או מנקה cache, אנחנו מאבדים הכל. (2) ה-wizard ירוץ אחרי שיש user record — כלומר signup נוצר, יש user_id, אבל ה-profile עדיין ריק. ה-wizard ממלא את ה-profile. (3) Email verification — כן, blocking. אם הם לא verified, הם לא רואים את ה-wizard. הסיבה: אנחנו מתעסקים עם אימות מסמכים — אם אנחנו לא מאמתים את ה-email שלהם, זה אירוני.

לדנה: את צודקת ש-6 steps זה הרבה. אבל אני לא בטוח שאפשר לדחוס step 1+2 יחד. ה-cards של "מי אתה" ו-"מה התחום" הם שונים מהותית. "מי אתה" קובע את הסגמנט, "מה התחום" קובע את ה-vertical. לחן: RTL-first זה מוחלט. אבל הלקוחות שלנו לא רק ישראלים — יש לנו 10 שפות. צריך שה-wizard יהיה dynamic LTR/RTL.

**Dana (UX):** אמית, אני חולקת. עם card design חכם, אפשר לעשות את שניהם בשלב אחד. ככה: המשתמש בוחר category (Individual/Business/Organization) — והכרטיסים של ה-field מופיעים מתחת, כתלות בבחירה. זה נקרא progressive disclosure. במקום מסך חדש, ה-field cards עושים slide-in מתחת. יתרון: (1) מרגיש כמו step אחד, (2) פחות clicks, (3) המשתמש רואה את ההקשר — "אני business, אז אלה התחומים שלי". חיסרון: mobile — יותר scroll. אבל עם animation חכמה זה עובד.

**Chen (Support):** דנה, אני אוהבת את הרעיון של progressive disclosure, אבל יש לי חשש. אם המשתמש בוחר "Individual" ואז רואה שהתחומים לא מתאימים לו — הוא צריך לחזור למעלה, לשנות את הבחירה, ולראות תחומים חדשים. זה disorienting. בעיקר עבור מי שלא מורגל. אני מעדיפה שני מסכים ברורים, עם "Back" button גדול ובולט. עוד דבר — "Other" option. בשלב 2, אם מישהו בוחר "Other" — מה קורה? יש text input? נפתח dropdown? כי "Other" בלי הסבר זה dead end מבחינת support. נקבל הרבה שאלות.

**Moshe (Backend):** בנושא ה-progressive disclosure — מבחינת API, זה לא משנה לי. אני שולח GET /api/onboarding/fields?type=individual ומקבל את הרשימה. אבל — יש פה שאלה של performance. אם כל שינוי בחירה מפעיל API call לשלוף fields חדשים, זה latency מיותרת. אני מציע: בטעינה ראשונה של ה-wizard, לטעון את כל ה-mapping הקבוע (type -> fields). זה JSON קטן, אין סיבה לטעון dynamically. זה גם עובד offline אם יש ניתוקים.

בנושא wizard state — אני מציע טבלה: `onboarding_state` עם user_id, current_step, selections (JSON), stamp_config (JSON), started_at, completed_at. כל step change = PUT /api/onboarding/state. אם המשתמש חוזר — load state ו-resume.

---

### Round 3 — The Email Verification Debate

**Amit (Product):** משה, מצוין על ה-preload. אני מסכים — כל ה-mapping של type-to-fields צריך להגיע בטעינה ראשונה. בנוגע לschema — אני רוצה לוודא ש-selections הוא structured, לא סתם JSON blob. אנחנו נצטרך את ה-data הזה ל-analytics, לplan recommendations, ולpersonalization. אם זה free-form JSON, queries יהיו סיוט.

עכשיו — Email verification. אני רוצה לפתוח דיון: האם blocking verification הוא באמת הצעד הנכון? כן, אמרתי קודם שכן, אבל חשבתי שוב. ב-SaaS, blocking verification מוריד signup completion ב-20-40%. אנשים נרשמים, לא מוצאים את ה-email, וזהו — איבדנו אותם. מה אם נעשה soft-blocking: הם יכולים לעשות את ה-wizard, אבל לא יכולים ליצור מסמך PVF ראשון בלי verification? זה נותן להם את ה-hook (stamp customization) בלי ה-friction של "תמצא את ה-email".

**Dana (UX):** עמית, את ההפיכה הזו אני תומכת מאוד. מנקודת UX: ה-verification email הוא momentum killer. המשתמש נרשם, הוא מלא מוטיבציה, ואז — "בדוק את ה-email שלך." 40% לא חוזרים. אם נתנו להם להיכנס ל-wizard מייד, עם banner שקט שאומר "Verify your email to start protecting documents", זה הרבה יותר effective. ה-verification הופך מ-blocker ל-background task. המשתמש מגיע לstep 5, מעצב חותמת, מתלהב — ואז בstep 6 "You're almost ready! Just verify your email." עכשיו יש להם סיבה לאמת.

**Chen (Support):** אני נגד. תשמעו למה. הלקוחות שלנו הם לא Spotify users שמנויים על 50 שירותים. אלה עורכי דין, בתי חולים, גופים ממשלתיים. אנשים כאלה נרשמים עם כוונה. הם לא "נשרים" כי לא מצאו email. הם מצפים לתהליך רציני. ו — email verification מראה רצינות. "אנחנו מאמתים מסמכים, אנחנו גם מאמתים אותך." זה brand message. מה כן אפשר לשפר: (1) resend button ברור, (2) countdown timer שמראה "בדקת? לא קיבלת? ננסה שוב בעוד 30 שניות", (3) אפשרות לשנות email אם הקלידו לא נכון. לא צריך לבטל verification — צריך לשפר את ה-experience שלו.

**Moshe (Backend):** מבחינה טכנית, שני המודלים אפשריים. אם הולכים על soft-blocking: צריך flag ב-user table — `email_verified: boolean`. ואז middleware שבודק: לכל endpoint שיוצר PVF — אם לא verified, return 403 עם הודעה. ה-wizard endpoints פתוחים גם בלי verification. אם הולכים על hard-blocking: ה-middleware יותר פשוט — לא verified = redirect to verification page. Period. אני נוטה ל-Chen על זה. Hard-blocking פשוט יותר, פחות edge cases, ופחות "מצבי ביניים" שצריך לתמוך בהם.

---

### Round 4 — Resolving Verification

**Amit (Product):** סבבה, שמעתי את כולם. בואו נסגור: email verification = blocking, אבל עם UX מעולה. חן, את צודקת שהקהל שלנו רציני. דנה — ה-improvements שחן הציעה (resend, change email, countdown) מכסים את ה-friction. אז Step 0 הוא:
1. User signs up
2. Gets to verification screen: "We sent a code to your@email.com"
3. 6-digit code input (לא link — code מהיר יותר, עובד גם ב-mobile בלי פתיחת tab חדש)
4. Resend button (cooldown 30s)
5. "Wrong email?" link to change
6. After verification -> wizard starts

משה — אני מעדיף code על פני link. הדעה שלך?

**Moshe (Backend):** Code עדיף בהחלט. מבחינה טכנית: (1) קוד 6-digit שמאוחסן ב-verification_codes table (user_id, code, created_at, expires_at, attempts). (2) Expiry: 10 דקות. (3) Max attempts: 5 per code. (4) Rate limit: max 3 code sends per hour per email. (5) Code generation: crypto.randomInt — לא Math.random. (6) קוד חדש = הישן בטל. אין שני קודים פעילים. מבחינת API: POST /api/auth/send-code, POST /api/auth/verify-code. פשוט ונקי.

**Dana (UX):** לגבי מסך ה-verification: רקע full-screen, Vertifile logo למעלה, ואז כרטיס לבן (glassmorphism כמו הdesign system שלנו) במרכז. 6 input boxes, auto-focus על הראשון, auto-advance למבחינת. כשמקלידים את הספרה האחרונה — auto-submit, בלי כפתור. Animation: fade-in של checkmark ואז smooth transition ל-wizard. Copy: "Enter the verification code we sent to [email]". פשוט, נקי, 3 שניות task.

**Chen (Support):** דנה, מצוין. רק תוספת: מה קורה כשהקוד שגוי? צריך: (1) shake animation על ה-inputs, (2) הודעה ברורה: "Code incorrect. X attempts remaining." (3) אחרי 5 attempts כושלים: "Too many attempts. Please request a new code." ולא חסימה — פשוט נדרש code חדש. עוד דבר: spam folder. הרבה emails הולכים ל-spam. צריך הודעה: "Didn't receive the code? Check your spam folder, or [resend]."

---

### Round 5 — Step 1+2 Layout

**Amit (Product):** בסדר, verification סגור. עכשיו Steps 1-2. דנה, את הצעת progressive disclosure — step 1+2 ביחד. חן, את נגד. אני שומע את שניכם. אני מציע: שניהם steps נפרדים, אבל עם transition חלק ביניהם — כמעט מרגיש כמו step אחד. כלומר: בוחרים "Business", ה-card מתרחב עם highlight, ואחרי 0.5 שניות ה-fields cards עושים slide-in מלמטה באותו מסך. אם המשתמש רוצה לחזור — click על ה-category card משנה את ה-fields. זה compromise: מבנית זה 2 steps, UX-wise זה מרגיש כמו step אחד.

**Dana (UX):** אני יכולה לחיות עם זה, אבל רגע — בואו נדבר על sizing של הכרטיסים. ב-desktop: 3 cards ב-row עבור Step 1 (Individual, Business, Organization). גודל: 280x200px כל אחד, spacing 24px. כל card: אייקון גדול (48px), כותרת (20px bold), תיאור קצר (14px, 2 שורות max). Hover: subtle lift (translateY -4px) + shadow increase. Selected state: purple border (2px) + checkmark icon top-right. ב-mobile: 1 card per row, full-width, stacked vertically. Touch target: 44px minimum.

**Chen (Support):** דנה, לגבי ה-labels — "Individual" לא מספיק ברור. בוא נחשוב על copy. מי הם ה-"individuals"? עורכי דין, רואי חשבון, פרילנסרים. אם כתוב רק "Individual" — עורך דין לא ידע אם הוא "Individual" או "Business". כי הוא business גם כן. צריך subtitle שמבהיר: "Individual — Solo practitioner, freelancer, personal use". וגם "Business — Small or medium company with a team". ו-"Organization — University, hospital, government, enterprise". ה-subtitle הוא ההבדל בין "הבנתי" ל-"אני לא יודע מה אני."

**Moshe (Backend):** מבחינת schema, אני מציע enum ל-user_type: `individual`, `business`, `organization`. ו-enum ל-industry: `legal`, `healthcare`, `education`, `finance`, `hr`, `government`, `other`. שני fields נפרדים ב-user_profiles table. ה-mapping של "איזה industries מתאימים לאיזה type" — hardcoded בclient. כי ב-V1 זה קבוע. אין סיבה לעשות את זה dynamic. שאלה: האם "Other" ב-industry דורש free-text input? אם כן — צריך שדה industry_other (varchar 100) עם sanitization.

---

### Round 6 — Step 2 Field Selection Deep Dive

**Amit (Product):** חן, ה-copy שלך מעולה. Subtitle הוא חובה. משה — כן, "Other" צריך free-text, אבל עם placeholder שמכוון: "e.g., Real Estate, Logistics, Retail". ו-validation: minimum 2 chars, maximum 100, no special characters. עכשיו שאלה: האם ה-field cards ב-Step 2 צריכים להיות שונים בין type לtype? כלומר — אם אני Individual, אני רואה את אותם 7 fields כמו Organization? כי עורך דין פרטי ועורך דין בארגון גדול — שניהם "Legal". אולי ה-fields זהים לכולם, וה-type רק משפיע על ה-plan recommendation?

**Dana (UX):** אני חושבת שה-fields צריכים להיות אותו דבר לכולם. ההבדל בין types לא בתחום — הוא בנפח ובצרכים. עורך דין פרטי צריך Legal, ארגון ממשלתי צריך Government. אבל שניהם רואים את אותם options. מה שכן משתנה: ה-recommended documents בStep 3. אם בחרת Legal — הcards של "Contracts & Agreements" ו-"Identity Documents" יהיו pre-highlighted (לא selected, highlighted). זה micro-personalization. ועוד משהו: ב-Step 2, הcard של התחום שנבחר צריך animation של ה-features שVeritifile מציעה לתחום הזה. כמו tooltip או expandable section: "For Legal: Contract verification, Notary authentication, Court-admissible proof."

**Chen (Support):** דנה, הרעיון של features per industry מצוין. זה עונה על השאלה הכי נפוצה שנקבל: "מה Vertifile עושה בתחום שלי?" במקום שיצטרכו לקרוא about page — הם רואים את זה בonboarding. אבל — אני רוצה להוסיף: מה אם מישהו לא מזהה את עצמו באף category? למשל, חברת logistics שמעבירה מסמכי משלוח. היא לא Legal, לא Finance, לא Healthcare. היא "Other". ול-"Other" אין features list. צריך generic features list עבור "Other": "Protect any document type — contracts, certificates, reports, and more."

**Moshe (Backend):** בנוגע ל-features per industry — זה content, לא logic. אני מציע שזה יהיה בconfig file (JSON) בclient, לא ב-DB. כמו:
```json
{
  "legal": {
    "features": ["Contract verification", "Notary authentication", "Court-admissible proof"],
    "recommended_doc_types": ["contracts", "identity"]
  }
}
```
ב-V1 זה static. ב-V2 אפשר להעביר ל-CMS אם צריך. אין סיבה לעשות את זה dynamic עכשיו. שאלה מבניתית: הconfig הזה — מי אחראי עליו? שירה (content)? עמית (product)? כי אם אני שם את זה ב-code, כל שינוי דורש deploy.

---

### Round 7 — Step 3: Document Types

**Amit (Product):** משה, הconfig נשאר static בV1, ואני אהיה אחראי על התוכן עם שירה. עכשיו Step 3 — document types. זה multi-select. השאלה: מה minimum ו-maximum? אני חושב minimum 1 (חייבים לבחור משהו), maximum — ללא הגבלה. אבל — אם מישהו בוחר את כל 8, האם זה אומר משהו? אולי הוא פשוט לחץ על הכל "לכל מקרה". צריך לחשוב אם אנחנו רוצים "בחר את 3 העיקריים" או "בחר כמה שרוצה."

**Dana (UX):** "בחר כמה שרוצה" הוא הגישה הנכונה. לא צריך להגביל. Layout: grid של 2x4 ב-desktop, 1x8 ב-mobile. כל card: אייקון + title + description קצר. Multi-select behavior: click = toggle. Selected = purple fill + checkmark. ה-CTA button ("Continue") disabled עד שנבחר לפחות אחד. Animation: כשבוחרים, ה-card עושה subtle pulse + checkmark fade-in. עוד דבר: ה-cards צריכים להיות בסדר שונה לפי ה-industry שנבחרה. אם בחרת Legal — "Contracts & Agreements" ראשון. אם בחרת Healthcare — "Medical Records" ראשון. כמו ש-Spotify שמה את הז'אנרים שהכי מתאימים לך ראשונים.

**Chen (Support):** נקודה חשובה — ה-description של כל document type צריך להיות ברור מאוד. "Certificates & Diplomas" — זה כולל גם ציונים? גם תעודות מקצועיות? צריך subtitle: "Degrees, transcripts, professional certifications". ו-"Financial Reports & Invoices" — מה ההבדל בין זה ל-"Receipts & Payment Records"? הלקוח לא יודע. צריך distinction ברורה: Financial = דוחות הכנסות, מאזנים, חשבוניות. Receipts = קבלות על תשלומים, הוכחות העברה. גם — "Identity Documents" — זה כולל דרכון? תעודת זהות? רישיון נהיגה? צריך להיות ספציפי.

**Moshe (Backend):** מבחינת DB — זה array field ב-user_profiles: `document_types: text[]`. ערכים: enum של הcategories. אם בוחרים 3, נשמר `['contracts','identity','financial']`. ב-API: PATCH /api/onboarding/step/3 עם body: `{ document_types: [...] }`. Validation: at least 1, values must be from allowed enum. שאלה: "Other" בdocument types — גם פה free-text? או סתם "Other" בלי פירוט? כי אם מישהו בוחר "Other" ואני לא יודע מה זה — אני לא יכול לעשות personalization.

---

### Round 8 — Step 4: Volume

**Amit (Product):** משה — "Other" בdoc types: בלי free-text. זה multi-select, לא critical data point. אם בחרו "Other" — פשוט נראה את ה-default dashboard. עכשיו Step 4 — volume. זה ה-step שקובע plan recommendation. ה-mapping:
- Up to 50 docs/mo → Free tier (אם יהיה) או Pro ($29)
- 50-500 → Pro ($29)
- 500-5,000 → Pro+ ($79)
- 5,000+ → Enterprise (custom)

שאלה: האם להציג את המחיר כבר ב-Step 4? או לחכות לStep 6 (summary)? אני נוטה לחכות — אם מראים מחיר מוקדם, אנשים נבהלים ועוזבים. יותר טוב: בStep 6, אחרי שהם כבר עיצבו חותמת ומרגישים בעלות, להגיד "Based on your needs, we recommend Pro at $29/month. Start with 14-day free trial."

**Dana (UX):** בנושא pricing — אני מסכימה, לא להראות מחיר ב-Step 4. Step 4 צריך להרגיש כמו "ספר לנו עוד" ולא "כמה כסף יש לך". Layout: 4 cards, אנכי, כל אחד עם range + כותרת עזר. לא dropdowns, לא sliders — cards. Single-select. ב-card של "5,000+" להוסיף badge: "Enterprise" כדי שהלקוח ידע שיש VIP track.

אבל הנקודה שלי האמיתית — Step 4 הוא השלב הכי boring. אחרי 3 steps של בחירות מגניבות, פתאום "כמה מסמכים?" מרגיש כמו טופס רגיל. איך עושים את זה יותר engaging? אולי אנימציה: כל card מראה mini-visualization — "50" מראה stack קטן של docs, "5,000+" מראה mountain של docs. Visual metaphor.

**Chen (Support):** דנה, ה-visualization מגניב אבל אני חושבת שהבעיה עמוקה יותר. רוב הלקוחות לא יודעים כמה מסמכים יש להם בחודש. עורך דין קטן? "אמממ... 10? 50? אני לא יודע." צריך לתת context. במקום רק "Up to 50" — להגיד: "Up to 50 — Typical for solo practitioners and freelancers." ו-"50-500 — Typical for small businesses and law firms." ו-"500-5,000 — Typical for mid-size organizations." ו-"5,000+ — Enterprise, universities, hospitals." ככה הלקוח שואל "מה אני?" ולא "כמה מסמכים יש לי?"

**Moshe (Backend):** DB field: `estimated_volume: enum('under_50', '50_500', '500_5000', 'over_5000')`. פשוט. אבל — עמית, ה-plan recommendation logic: האם זה hardcoded mapping (volume -> plan) או יש logic יותר מורכב? כי אם מחר זור משנה pricing tiers — אני רוצה שזה יהיה configurable, לא hardcoded ב-code. אני מציע plan_recommendation service עם config file:
```json
{
  "under_50": { "plan": "free_trial", "upgrade_to": "pro" },
  "50_500": { "plan": "pro" },
  "500_5000": { "plan": "pro_plus" },
  "over_5000": { "plan": "enterprise" }
}
```

---

### Round 9 — Step 5: The Stamp Hook (THE BIG ONE)

**Amit (Product):** בסדר, הגענו ל-Step 5. זה ה-heart של ה-wizard. זה מה שזור רוצה — ה-hook שיוצר בעלות. המשתמש מעצב חותמת בלי שהעלה אפילו מסמך אחד. כשהוא רואה את הצבעים שלו, הלוגו שלו, על חותמת Vertifile — הוא כבר "בפנים". שאלות קריטיות: (1) מה בדיוק customizable? Color picker לaccent, color picker לגלים, logo upload, מה עוד? (2) ה-preview — זה canvas rendering? SVG? Iframe? (3) Performance — real-time update בלי lag?

**Dana (UX):** זה ה-step שאני הכי מתלהבת ממנו. Layout concept: split-screen. צד שמאל (60%): ה-preview — מסמך דמו עם החותמת. צד ימין (40%): controls. ב-mobile: controls למעלה, preview למטה (scrollable).

ה-preview: מסמך A4 mock עם טקסט placeholder (blur effect על הטקסט — כאילו מסמך אמיתי). ובפינה הימנית-תחתונה — חותמת Vertifile בגודל מלא. ה-stamp כולל: accent color ring, holographic wave animation, logo area.

Controls:
1. **Accent Color** — color wheel (לא רק presets). Default: Vertifile purple.
2. **Holographic Wave Color** — color wheel. Default: teal/cyan.
3. **Logo Upload** — drag-and-drop area. Accept: PNG, SVG, JPG. Max 2MB. Preview inside stamp.
4. **Stamp Size** — slider: small/medium/large (affects preview).

Real-time: כל שינוי → update preview within 100ms. No debounce — instant feedback.

**Chen (Support):** דנה, שאלות מנקודת המשתמש:
1. מה אם מישהו לא רוצה logo? ה-stamp צריך להיראות טוב גם בלי. אל תעשו empty circle שם — תעשו fallback (אולי ה-company initial, או סתם ה-Vertifile V).
2. Color pickers — אני חושש שcolor wheel יהיה מסובך ל-non-designers. בתי חולים לא צריכים לבחור hue. מציע: 8-10 preset colors + "Custom" toggle שפותח color wheel. רוב האנשים יבחרו preset.
3. מה עם brand guidelines? אם Organization גדול נרשם ויש להם ירוק ספציפי #00A651 — הם רוצים להקליד hex, לא לגרור color wheel.
4. Accessibility — color contrast. אם מישהו בוחר צהוב בהיר על לבן — ה-stamp לא ייראה. צריך warning: "Low contrast — stamp may be hard to see on light documents."

**Moshe (Backend):** מבחינת טכני — ה-preview rendering:
- **Client-side** — canvas או SVG. אני ממליץ SVG כי: (1) scalable, (2) קל לshare config, (3) ה-holographic animation היא כבר CSS/SVG ב-system שלנו.
- **Logo upload** — ב-Step 5 עצמו, ה-logo נשמר temporarily (client-side preview). רק ב-submit של ה-wizard (Step 6) הוא עולה לS3/storage. אין סיבה לעלות file כל פעם שהמשתמש מנסה logo.
- **DB fields** ב-stamp_config:
```json
{
  "accent_color": "#7c3aed",
  "wave_color": "#06b6d4",
  "logo_url": "https://...",
  "stamp_size": "medium"
}
```
- **API**: PATCH /api/onboarding/step/5 עם stamp_config. Logo upload: POST /api/upload/logo (on wizard completion).
- **Warning**: logo file — need virus scan? At minimum: file type validation server-side, max size 2MB, image dimensions max 500x500.

---

### Round 10 — Step 5 Continued: Mobile & Edge Cases

**Dana (UX):** חן, אני מסכימה על preset colors + custom option. זה הגישה הנכונה. Presets: Purple (#7c3aed), Blue (#2563eb), Teal (#0d9488), Green (#16a34a), Red (#dc2626), Orange (#ea580c), Pink (#ec4899), Gold (#ca8a04), Black (#171717), Gray (#6b7280). Custom: hex input + color wheel.

בנושא mobile — ה-split-screen לא עובד. Layout חלופי: ה-controls בחלק העליון (accordion-style), וה-preview fixed בתחתית (sticky). ככה המשתמש תמיד רואה את ה-preview בזמן שהוא משנה settings. Swipe up on preview = full-screen preview mode.

שאלה חשובה שלא עלתה: animations. הstamp שלנו הוא holographic — הוא זז. ה-preview צריך להראות את ה-animation, לא static image. כלומר — ה-wave colors שהמשתמש בוחר, הם זזים ב-preview. זה מה שעושה את ה-"wow" effect. "ראיתי את החותמת שלי — והיא זזה!"

**Amit (Product):** דנה, אבסולוטלי. ה-animation חייבת להיות בpreview. זה ה-wow moment. בלי זה, זה סתם color picker. עם זה — זה "המותג שלי חי."

עכשיו edge cases שצריך לטפל בהם:
1. **משתמש לא מעלה logo ולא משנה צבעים** — default stamp (purple, teal, no logo). This is fine.
2. **משתמש מעלה logo שלא מתאים** (landscape photo, 5000x100 pixels) — crop/resize interface? Or just center-crop automatically?
3. **משתמש חוזר אחרי שעה** — ה-state נשמר? (כן, wizard state ב-server)
4. **Browser doesn't support canvas/SVG animation** — fallback to static image

**Chen (Support):** עוד edge case: שפה. ה-stamp עצמו — יש בו טקסט? אם כתוב "VERIFIED" — באיזו שפה? עברית? אנגלית? שפת המשתמש? כי אם ישראלי רואה stamp שכתוב עליו "VERIFIED" — הוא מבין. אבל אם יש לו לקוחות ישראלים, אולי הוא רוצה "מאומת". צריך לחשוב אם ה-stamp text הוא customizable או fixed.

**Moshe (Backend):** בנוגע ל-logo handling: auto-crop to square with center gravity. אם הimage הוא landscape — crop center square. Max dimension after crop: 200x200. Format: convert to PNG. Library: sharp (Node.js). Pipeline: upload → validate type/size → resize/crop → store. No virus scan in V1 (it is just an image), but strict type validation (magic bytes, not just extension).

בנוגע ל-stamp text — הstamp שלנו כרגע הוא ויזואלי בלבד (waves, rings, logo). אין טקסט "VERIFIED" על ה-stamp עצמו. ה-verification status מוצג מחוץ ל-stamp. אז שפה לא relevent ל-stamp config עכשיו.

---

### Round 11 — Step 6: Summary & Launch

**Amit (Product):** אחרון — Step 6, "You're Ready!" מה מופיע:
1. Summary של כל הבחירות: type, industry, doc types, volume
2. ה-stamp preview (animated) — "Your Vertifile stamp"
3. Recommended plan + "Start Free Trial" CTA
4. Secondary CTA: "Talk to Sales" (for Enterprise)

שאלה: האם להציג pricing details בfull? Or just plan name + price? אני חושב: plan name + price + "includes X docs/month" — מספיק. לא צריך pricing page מלא.

**Dana (UX):** Step 6 layout: full-screen, centered. למעלה: large animated stamp (ה-customized one). מתחת: summary cards (mini versions of their selections). מתחת: plan recommendation card. CTA button: large, purple, "Start Protecting Documents" — ולא "Start Free Trial." כי "Start Protecting" = action-oriented, value-first. "Start Free Trial" = price-oriented.

Animation: confetti? לא. Too gimmicky for our brand. Instead: smooth fade-in, stamp does one full "verification" animation (waves ripple out), and then settles. Professional celebration.

After click: redirect to dashboard, already personalized with their industry templates.

**Chen (Support):** דנה, אני אוהבת "Start Protecting Documents" — הרבה יותר חזק. תוספות:
1. Allow editing — "Back to Step X" links. If the user realizes they picked the wrong industry — they should be able to go back without re-doing everything.
2. Plan comparison link — "See all plans" small text link. Some people want to compare before committing.
3. "Skip for now" on the whole wizard — controversial, but what if someone just wants to explore the dashboard first? Force wizard = friction. Allow skip = more exploration.

**Moshe (Backend):** כשה-wizard מסתיים, ה-pipeline:
1. PATCH /api/onboarding/complete — marks wizard as completed
2. Upload logo to storage (if any)
3. Create stamp_config record linked to user
4. Set user_profiles with all selections
5. Generate recommended_plan suggestion
6. Redirect to /dashboard with ?onboarding=complete query param (dashboard shows welcome message)

DB tables affected:
- users: `onboarding_completed: boolean`, `onboarding_completed_at: timestamp`
- user_profiles: type, industry, industry_other, document_types, estimated_volume
- stamp_configs: user_id, accent_color, wave_color, logo_url, stamp_size
- onboarding_state: mark as completed

---

### Round 12 — Progress Indicator & Navigation

**Amit (Product):** חן, בנוגע ל-"Skip" — אני נגד. ה-wizard הוא 2 דקות מקסימום. מי שמדלג מפספס את ה-hook (stamp customization). ואנחנו מפספסים data שאנחנו צריכים ל-personalization. אם מישהו באמת רוצה לצאת — הוא יסגור את הטאב. אבל לא ניתן "skip" כoptionאפשרות.

"Back" button — כן, בכל step. אבל back שומר state. אם בחרתי Business ואני חוזר מStep 3 לStep 2 — הבחירה שלי "Business" עדיין שם. לא reset.

עוד נושא שלא דיברנו עליו: progress indicator. איך המשתמש יודע איפה הוא בflow?

**Dana (UX):** Progress indicator: אני ממליצה על step dots בחלק העליון — קלאסי אבל עובד. 5 dots (לא כולל email verification). ה-dot הנוכחי filled, completed dots מקבלים checkmark, future dots hollow. מעל ה-dots: step title ("Who are you?", "Your field", "Documents", "Volume", "Your stamp", "Ready!").

Alternative: progress bar (horizontal line that fills). Less informative but cleaner. I prefer dots for this flow because users want to know "how much more" — dots answer that immediately.

Back button: top-left, with text "Back" (not just arrow). On mobile: full-width top bar with back + step indicator.

**Chen (Support):** Dots + step title — מצוין. רק דבר אחד: ה-titles צריכים להיות descriptive אבל קצרים. לא "What documents do you need to protect?" — זה ארוך מדי ל-progress bar. "Documents" מספיק שם. ה-full question מופיעה ב-content area. Progress indicator: "You | Field | Docs | Volume | Stamp | Ready". 6 steps, 6 dots. ברור.

**Moshe (Backend):** מבחינת implementation — ה-progress indicator הוא client-side בלבד. ה-server שומר current_step (1-6), הclient מציג את ה-dots accordingly. Back button: PATCH /api/onboarding/state עם step: current-1. State נשמר. כל step data נשמר independently — אם חוזרים ל-step 2 ומשנים industry, step 3 (doc types) לא מתאפס. רק ה-recommendations משתנים.

---

### Round 13 — RTL, i18n, and Accessibility

**Dana (UX):** בואו נדבר על RTL ו-i18n. ה-wizard חייב לתמוך ב-10 שפות. שפות RTL: עברית, ערבית. שאר — LTR. נקודות קריטיות:
1. Card grid — RTL doesn't flip. Cards stay in same visual order (right-to-left reading order for RTL, left-to-right for LTR). CSS: direction: rtl on container.
2. Back button — moves from top-left to top-right in RTL.
3. Progress dots — stay left-to-right even in RTL (progress flows forward visually). Actually, no — in RTL, progress should flow right-to-left. First dot on right.
4. Text alignment — all content inside cards: text-align start.
5. Color picker — direction-independent. No RTL issues.
6. Split-screen in Step 5 — in RTL, controls on the right, preview on the left.

**Amit (Product):** דנה, שאלה: progress dots in RTL — ימין לשמאל? This might confuse users who are used to Western progress bars. Many Hebrew apps still show progress left-to-right because it's a universal metaphor (like playback controls). What's the standard?

**Chen (Support):** אני עם עמית. Progress bar should stay LTR even in RTL interfaces. This is a UX convention. Google, Facebook, and most Israeli apps keep progress bars LTR. It's a "time flows forward = right" metaphor that transcends language direction. Same for sliders. The stamp size slider should be LTR regardless. But — text should be RTL. And layout should mirror.

**Moshe (Backend):** Accessibility — חשוב שלא נשכח. דנה, מה ה-a11y requirements?

**Dana (UX):** Full WCAG 2.1 AA:
1. **Keyboard navigation**: Tab through cards, Enter/Space to select. Focus visible outline.
2. **Screen reader**: aria-label on each card, role="radiogroup" for single-select, role="group" + aria-label for multi-select.
3. **Color contrast**: 4.5:1 minimum for text. The stamp preview is decorative, not text — contrast doesn't apply.
4. **Touch targets**: 44x44px minimum.
5. **Reduced motion**: If user has prefers-reduced-motion, disable stamp animation. Show static preview.
6. **Error messages**: aria-live="polite" for verification code errors.

---

### Round 14 — Analytics & Tracking

**Amit (Product):** דבר אחרון שחייבים לדון בו: analytics. ה-wizard הוא funnel. אנחנו חייבים למדוד:
1. **Start rate**: כמה verified users מתחילים wizard
2. **Step completion**: drop-off per step
3. **Time per step**: כמה זמן כל step לוקח
4. **Selection distribution**: כמה Individual vs Business vs Organization
5. **Stamp engagement**: כמה אנשים שינו מdefault (accent color, wave color, logo)
6. **Completion rate**: כמה סיימו wizard
7. **Time to first PVF**: כמה זמן מsignup עד מסמך ראשון

משה — מה ה-approach? Client events? Server events? Both?

**Moshe (Backend):** Both. Client-side: fire events to analytics service (Mixpanel, Amplitude, or our own) for UI interactions. Server-side: log step completions with timestamps. ה-onboarding_state table כבר שומר timestamps per step, אז server-side analytics הוא כמעט חינם.

Events:
- `onboarding_started` (user_id, timestamp)
- `onboarding_step_completed` (user_id, step, selections, timestamp)
- `onboarding_step_back` (user_id, from_step, to_step)
- `stamp_customized` (user_id, changed_fields: [accent, wave, logo, size])
- `onboarding_completed` (user_id, total_time_seconds, recommended_plan)
- `onboarding_abandoned` (user_id, last_step, time_in_step)

For abandoned: detect via session timeout (30 min no activity) or page unload event.

**Chen (Support):** משה, ה-"abandoned" event חשוב מאוד בשבילי. אם אנחנו רואים שרוב האנשים נוטשים בstep 4 (volume), אני רוצה לדעת למה. אפשר: follow-up email אחרי 24 שעות: "Hey, you almost finished setting up your Vertifile account. Pick up where you left off." עם deep link חזרה ל-exact step. זה re-engagement strategy שעובד.

**Amit (Product):** חן, מצוין. Re-engagement email is a must. משה, ה-deep link — זה /onboarding?resume=true שטוען את הstate האחרון?

**Moshe (Backend):** כן. /onboarding route checks: (1) user authenticated? (2) onboarding completed? if not: load onboarding_state, redirect to current_step. The URL stays /onboarding — no step in URL. State is server-managed. The email just links to /onboarding.

---

### Round 15 — Error States & Edge Cases

**Chen (Support):** בואו נעבור על כל ה-error states שאני צופה:

1. **Email verification code expired** — "Your code has expired. Request a new one." + resend button
2. **Too many verification attempts** — "Too many attempts. Please wait 1 hour." (security measure)
3. **Logo upload fails** — "Upload failed. Please try a different image (PNG, JPG, SVG, max 2MB)."
4. **Logo file too large** — "Image too large. Maximum size: 2MB. Your file: X.Xmb."
5. **Logo format unsupported** — "Please upload a PNG, JPG, or SVG file."
6. **Network error during step save** — "Connection lost. Your progress is saved. Please check your connection."
7. **Session expired during wizard** — "Your session has expired. Please log in again." (wizard state preserved)
8. **Back button with unsaved changes** — hmm, actually since we auto-save per step, this shouldn't happen. But confirm: we auto-save on step transition, right?

**Moshe (Backend):** כן, auto-save. כל פעם שמשתמש עובר step — POST/PATCH to server. ב-Step 5 (stamp), save on every change? Or only on "Continue"? אני מציע: save stamp_config on "Continue" only. Not on every color change — that's too many API calls. But keep client-side state, so if network fails, the user doesn't lose their customization.

**Dana (UX):** Error states UX:
1. All errors appear as inline banners — not modal popups. Red border, red icon, clear text.
2. Verification errors: below the code input.
3. Upload errors: below the upload area with file info.
4. Network errors: top-of-page banner, persistent until resolved.
5. Session errors: full-page overlay with login button.
6. All errors dismiss-able (except session expired).

**Amit (Product):** חן, הרשימה שלך מצוינת. הוספה אחת: מה אם משתמש Google OAuth לא צריך verification? כי Google כבר verified את ה-email. משה — האם אנחנו מדלגים על Step 0 עבור Google OAuth users?

**Moshe (Backend):** כן. אם signup via Google OAuth — email considered verified. Skip Step 0 entirely. ב-user record: `email_verified: true`, `verification_method: 'google_oauth'`. ה-wizard מתחיל ישר מStep 1. זה חוסך friction for OAuth users.

---

### Round 16 — Google OAuth Implications

**Chen (Support):** אם Google OAuth users מדלגים על verification — הם מתחילים מStep 1. אבל ה-progress dots עדיין מראים 5 steps (1-5+Ready). הם לא "מרמים" — הם פשוט לא צריכים step 0. Progress bar מתחיל מ-Step 1. אין "missing dot" feeling.

שאלה: ומה עם Apple Sign-In? Hide My Email? Apple users שנרשמים עם hidden email — אנחנו שולחים verification ל-relay address של Apple. זה עובד אבל ה-email שנראה ל-user הוא garbled (xyz@privaterelay.appleid.com). ה-verification screen יגיד "We sent a code to xyz@privaterelay..." — הלקוח יתבלבל.

**Moshe (Backend):** Apple Sign-In — נושא מורכב. ב-V1, אני מציע שלא לתמוך. Google OAuth + email/password מספיק. Apple Sign-In נוסיף ב-V2 אם יש ביקוש. זה חוסך הרבה edge cases עכשיו.

**Amit (Product):** מסכים. V1: Email + Google OAuth בלבד. Apple Sign-In, Microsoft, GitHub — V2. עדיף לעשות שני paths מעולים מארבעה paths בינוניים.

**Dana (UX):** הסכמה. Signup page: "Sign up with Google" button (prominent), "Or sign up with email" divider + email form below. Clean, two paths only.

---

### Round 17 — Mobile Experience Deep Dive

**Dana (UX):** בואו נסגור mobile. כל Step — mobile layout:

**Step 0 (Verification):** Full-width card. 6 input boxes, 48px each. Auto-zoom disabled (font-size 16px prevents iOS zoom). Numpad keyboard (inputmode="numeric").

**Step 1 (Type Selection):** Cards stacked vertically, full-width, 80px height each. Big icon left, text right. Tap to select.

**Step 2 (Industry):** Same stacked layout. If shown on same screen as Step 1 (progressive disclosure), cards slide in below with 300ms ease-out.

**Step 3 (Document Types):** 2 columns, cards are 50% width each. Smaller text, but touch targets still 44px. Or — single column, scrollable. I think single column is safer for accessibility.

**Step 4 (Volume):** Same as Step 1 — stacked cards, full-width.

**Step 5 (Stamp):** Most complex. Controls top: accordion sections (tap "Accent Color" to expand). Preview bottom: sticky, always visible, 40% of viewport. User scrolls controls, preview stays. "See full preview" button: full-screen animated stamp modal.

**Step 6 (Ready):** Centered content. Stamp preview auto-plays animation once. CTA button full-width, sticky bottom.

**Chen (Support):** דנה, ב-Step 5 mobile — ה-accordion approach טוב. אבל המשתמש צריך לדעת מה יש בכל section לפני שהוא פותח. Header של כל accordion: שם + current value. כמו: "Accent Color: Purple" — ואז tap to change. ככה גם בלי לפתוח, הם רואים מה הstate הנוכחי.

**Moshe (Backend):** Mobile performance concern: ה-animated stamp preview — על mobile devices ישנים, SVG animation עם waves יכולה להיות כבדה. צריך: (1) throttle animation to 30fps on mobile, (2) option to disable animation (prefers-reduced-motion), (3) fallback: if device is slow (detect via performance.now() timing), show static preview with "Tap to preview animation" button.

---

### Round 18 — Transitions & Micro-interactions

**Dana (UX):** Transitions between steps:

**Step-to-step transition:** Cards fade-out (200ms), then new step cards fade-in from bottom (300ms, ease-out). Not slide — fade. Slide feels like a carousel, fade feels like a journey.

**Card selection:** Scale(1.02) + border color change (200ms ease). Checkmark fades in. Non-selected cards dim slightly (opacity 0.8).

**Continue button:** When requirements met (at least 1 selection), button transitions from disabled (gray) to enabled (purple) with a smooth color change (300ms). Subtle pulse once on first enable.

**Stamp preview updates:** Color changes: smooth CSS transition (400ms) on fill/stroke. Logo: fade-in on upload, cross-fade on replace. Waves: immediate color change — no transition, feels responsive.

**Completion animation (Step 6):** Stamp does one "verification" pulse — rings expand outward like a ripple, then settle. Duration: 1.5 seconds. Then content fades in below.

**Amit (Product):** דנה, ה-dimming של non-selected cards — I love it. It draws attention to the selection. But don't dim too much — opacity 0.7 minimum. We don't want cards to feel "disabled."

**Chen (Support):** כל ה-animations צריכות לכבד prefers-reduced-motion. אם המשתמש הגדיר reduced motion ב-OS — בלי transitions, בלי pulse, בלי ripple. Instant state changes. זה לא רק accessibility — זה respect.

**Moshe (Backend):** No backend implications for transitions. All client-side. But — one thing: ה-Continue button. Should it auto-advance after 1 second when step requirements are met? Or require explicit click? Auto-advance can be annoying if you accidentally select something.

**Amit (Product):** Explicit click always. No auto-advance. Users need to feel in control.

---

### Round 19 — Content & Copy

**Amit (Product):** Last major topic: copy. כל ה-text ב-wizard. אני רוצה שנגדיר את ה-tone: confident, clear, not corporate. We're Vertifile — we protect documents. The tone is: "You're in the right place. Let's set you up."

Headlines per step:
- Step 0: "Let's verify your email"
- Step 1: "Tell us about yourself"
- Step 2: "What's your field?"
- Step 3: "What documents do you need to protect?"
- Step 4: "How many documents per month?"
- Step 5: "Make it yours"
- Step 6: "You're all set!"

Sub-headlines:
- Step 0: "Enter the 6-digit code we sent to [email]"
- Step 1: "This helps us customize your experience"
- Step 2: "We'll show you relevant features and templates"
- Step 3: "Select all that apply — you can change this later"
- Step 4: "This helps us recommend the right plan"
- Step 5: "Customize your Vertifile stamp — this is how your protected documents will look"
- Step 6: "Your Vertifile account is ready. Start protecting your first document."

**Chen (Support):** עמית, ה-copy טוב. שינוי אחד: Step 3, "you can change this later" — critical. This reduces selection anxiety. הרבה לקוחות חוששים שבחירה לא נכונה "תנעל" אותם. לכל step שאפשר לשנות מאוחר — להגיד את זה.

Step 5: "Make it yours" — מצוין. זה ה-hook sentence. Short, emotional, possessive. "Yours" is the keyword. Stamp = their brand identity.

Step 6 CTA: "Start Protecting Documents" — confirmed. Not "Go to Dashboard", not "Start Free Trial", not "Continue." Action. Value. Confidence.

**Dana (UX):** Typography: headlines h1, 32px (24px mobile), Inter Bold. Sub-headlines: 16px (14px mobile), Inter Regular, color gray-500. Cards: title 18px (16px mobile) Semi-Bold, description 14px Regular gray-600. CTA button: 18px Semi-Bold, uppercase? No. Sentence case: "Start Protecting Documents."

**Moshe (Backend):** All copy goes to i18n JSON. No hardcoded strings. Keys: `onboarding.step0.title`, `onboarding.step0.subtitle`, etc. This plugs into our existing i18n system with 10 languages. Translation priority: Hebrew first (our main market), then English, then the rest.

---

### Round 20 — Final Disagreements & Resolutions

**Amit (Product):** בואו נסגור. יש disagreements פתוחים?

**Dana (UX):** כן. Step 1+2 — one screen or two? I still think progressive disclosure on one screen is better UX. Chen wants two screens.

**Chen (Support):** אני עדיין חושבת ששני מסכים ברורים עדיפים. Progressive disclosure מבלבל non-tech users.

**Amit (Product):** הצעה לcompromise שנגענו בה קודם: שני steps מבחינת numbering (2 dots), אבל UX של transition חלק — כשבוחרים type, ה-field cards עושים smooth slide-in על אותו מסך. ה-"Next" button לא מופיע עד שנבחר type. אחרי שנבחר type, cards של field מופיעים עם animation, ו-Next מופיע רק אחרי שנבחר גם field. מבנית — 2 steps. UX — מרגיש כמו 1. וה-Back button מstep 3 מחזיר לstep 1+2 screen עם כל הבחירות saved. דנה, חן — מקובל?

**Dana (UX):** מקובל. זה בדיוק מה שהצעתי. Two steps, one screen, progressive disclosure.

**Chen (Support):** אם ה-transition מספיק ברור ויש visual separator בין ה-type cards לfield cards — מקובל. ה-field cards צריכים להופיע מתחת עם כותרת "Now choose your field:" כדי שלא יתבלבלו.

**Moshe (Backend):** מבחינתי אין הבדל. שני API calls (step 1 + step 2) regardless. Client manages the combined screen.

**Amit (Product):** עוד disagreement? Skip wizard — Chen wanted it, I said no.

**Chen (Support):** אני מוותרת. אם ה-wizard באמת 2 דקות ואין step שמרגיש כמו friction — אין צורך ב-skip. אבל אני רוצה: אם user comes back and wizard is not completed — gentle banner on dashboard: "Complete your setup to get personalized recommendations." Not aggressive popup.

**Amit (Product):** Deal. Gentle banner, not popup.

**Dana (UX):** Agreed on all. No more disagreements.

**Moshe (Backend):** From my side — everything is clear. I can start building the API layer.

---

## Agreed Spec

### Flow Summary
| Step | Title | Type | Required |
|------|-------|------|----------|
| 0 | Email Verification | 6-digit code input | Yes (skipped for Google OAuth) |
| 1+2 | Who are you? + Your field | Combined single screen with progressive disclosure. Single-select type -> conditional field cards | Yes |
| 3 | Document types | Multi-select cards (min 1) | Yes |
| 4 | Monthly volume | Single-select cards | Yes |
| 5 | Choose Your Plan | Single-select plan cards (Pro, Pro+, Enterprise). No payment required. | Yes |
| 6 | Stamp customization | Color pickers + logo upload + live preview | Yes (defaults accepted) |
| 7 | Ready! | Summary + CTA | Yes |

### Step 0 — Email Verification
- **Trigger**: After signup (email/password only; skipped for Google OAuth)
- **UI**: Full-screen, centered glassmorphism card. 6-digit code input with auto-advance.
- **Code**: 6-digit, 10-minute expiry, max 5 attempts, max 3 sends/hour/email. Crypto-random generation.
- **Features**: Resend button (30s cooldown), "Wrong email?" link, spam folder reminder.
- **Error states**: Expired code, too many attempts, invalid code (shake animation).

### Steps 1+2 — Who Are You + Your Field (Combined Screen)
- **Layout**: 3 type cards (Individual, Business, Organization) on top. On selection, field cards slide in below with label "Now choose your field:".
- **Card content**: Icon + title + descriptive subtitle (e.g., "Individual — Solo practitioner, freelancer, personal use").
- **Field options**: Legal, Healthcare, Education, Finance, HR, Government, Other (with free-text input, placeholder "e.g., Real Estate, Logistics, Retail").
- **Industry features**: On field selection, expandable tooltip shows Vertifile features for that industry.
- **Desktop**: 3 cards/row for types, 3-4 cards/row for fields. **Mobile**: 1 card/row, stacked.

### Step 3 — Document Types
- **Layout**: Multi-select grid. Desktop: 2x4. Mobile: single column.
- **Card content**: Icon + title + subtitle (e.g., "Certificates & Diplomas — Degrees, transcripts, professional certifications").
- **Pre-highlights**: Based on selected industry, relevant doc types appear first and have subtle highlight (not selected).
- **Minimum**: 1 selected. No maximum.
- **"Other"**: No free-text. Just selectable option.
- **Reassurance copy**: "You can change this later."

### Step 4 — Monthly Volume
- **Layout**: 4 stacked cards, single-select.
- **Card content**: Range + context description (e.g., "Up to 50 — Typical for solo practitioners and freelancers").
- **"5,000+" card**: Enterprise badge.
- **No pricing shown** in this step.

### Step 5 — Choose Your Plan (No Payment Required)
- **Layout**: 3 plan cards, horizontal on desktop, stacked on mobile. Single-select.
- **Volume-based recommendation logic** (driven by Step 4 selection):
  - Up to 50 docs/month -> recommend **Pro ($29/mo)**
  - 50-500 docs/month -> recommend **Pro+ ($79/mo)**
  - 500+ docs/month -> recommend **Enterprise (Contact Sales)**
- **Cards**:
  - **Pro ($29/mo)**: "For individuals and small teams." Up to 50 docs/month, custom stamp, email support. Highlighted as "Recommended for you" if volume is under_50.
  - **Pro+ ($79/mo)**: "For growing businesses." Up to 500 docs/month, priority support, advanced analytics, team stamps. Highlighted as "Recommended for you" if volume is 50_500.
  - **Enterprise (Contact Sales)**: "For large organizations." Unlimited docs, dedicated account manager, SSO, SLA, custom integrations. Highlighted as "Recommended for you" if volume is 500_5000 or over_5000. CTA text on card: "Contact Sales" (secondary style).
- **Pre-selection**: Based on the volume chosen in Step 4, the recommended plan card is pre-highlighted (subtle glow border, "Recommended for you" badge). User can override.
- **No payment at this step**: Clear copy below the cards: "No payment needed now. You'll start your free trial after setup." This is critical for low-friction onboarding.
- **Plan details**: Each card shows a short bullet list (3-4 features). "See full comparison" small link opens a slide-up panel with full feature matrix (does not navigate away from wizard).
- **Enterprise flow**: Selecting Enterprise shows inline note: "Our team will reach out within 24 hours to set up your custom plan."
- **Reassurance copy**: "You can change your plan anytime from your dashboard."
- **Why this step is here (after volume, before stamp)**: The user already told us their volume (Step 4). Now we translate that into a concrete plan recommendation. By choosing a plan without paying, they mentally commit. The stamp customizer in the NEXT step (Step 6) is the emotional hook -- they already committed to a plan, and now they design "their" stamp. When they later hit the payment wall, they remember both the plan they chose AND the stamp they designed. Sunk cost on two fronts drives conversion.

### Step 6 — Stamp Customization (The Hook)
- **Layout**: Desktop: split-screen (60% preview left, 40% controls right). Mobile: controls top (accordion), preview bottom (sticky 40% viewport).
- **Preview**: Mock A4 document (blurred text) + animated Vertifile stamp (holographic waves moving).
- **Controls**:
  - Accent Color: 10 preset swatches + "Custom" toggle (hex input + color wheel). Default: #7c3aed (Vertifile purple).
  - Wave Color: Same format. Default: #06b6d4 (teal).
  - Logo Upload: Drag-and-drop. PNG/JPG/SVG, max 2MB, auto-crop to square 200x200. Fallback: no logo (stamp looks good without).
  - Stamp Size: small/medium/large slider. Default: medium.
- **Live preview**: Updates within 100ms. Animated waves in real-time.
- **Contrast warning**: If chosen accent color has low contrast on white, show warning.
- **Accordion headers (mobile)**: Show current value (e.g., "Accent Color: Purple").

### Step 7 — You're Ready!
- **Layout**: Centered. Large animated stamp (the one they customized in Step 6 -- one ripple animation on load, then settles). Summary cards below showing all their choices. Selected plan confirmation. CTA.
- **Plan confirmation**: Shows the plan they chose in Step 5. Format: "Your plan: [Plan] at $[Price]/month." For Enterprise: "Your plan: Enterprise — our team will be in touch."
- **Stamp showcase**: Their customized stamp is the hero visual. This is the payoff for Step 6 -- they see "their" stamp on a mock document, animated.
- **Summary cards**: Mini versions of all selections (type, industry, doc types, volume, plan).
- **CTA**: "Start Protecting Documents" (large, purple, full-width on mobile).
- **Secondary**: "Change plan" (small link back to Step 5), "See all plans" (small link).
- **No skip wizard option**. If user returns incomplete, gentle dashboard banner.

### Post-Onboarding — Payment Wall (Document Protection Blocked Until Payment)

After completing the wizard, the user lands on their personalized dashboard. They can browse freely — see their stamp preview, explore suggested templates, view their plan details. **But the moment they try to upload or protect a document, they hit a payment wall.**

- **What's accessible without payment**:
  - Dashboard overview (personalized by industry, doc types)
  - Stamp preview (the animated stamp they customized — visible but not usable yet)
  - Suggested document templates for their field
  - Plan details page ("You chose Pro — $29/month")
  - Settings (profile, stamp re-customization)
  - "See all plans" comparison page

- **What's blocked without payment**:
  - Upload a document (the Upload button is visible but triggers the payment modal)
  - Create/protect a PVF document
  - Generate a verification link
  - Any action that produces a protected artifact

- **The Upload Button Behavior**: The "Upload Document" / "Protect Document" button is visible and styled normally (not grayed out — we want them to click it). On click, instead of opening the upload flow, it opens the **Payment Activation Modal**.

- **Payment Activation Modal** (styled, not a browser popup):
  - **Header**: "Activate your [Plan Name] plan to start protecting documents"
  - **Plan summary card**: "[Plan Name] — $[Price]/month" with 3-4 feature bullets
  - **Payment form**:
    - Credit card input (Stripe Elements or equivalent — PCI compliant)
    - PayPal button (alternative)
    - "Start 14-day free trial" toggle (if applicable — to be decided)
  - **What they get**: "After activation, you can protect up to [X] documents per month"
  - **Stamp preview**: Small animated stamp in the corner of the modal — reminder of what they built
  - **Secondary actions**: "Change plan" link (goes to plan comparison), "Talk to Sales" (for Enterprise)
  - **Close button**: X in top-right. Closing returns to dashboard. No nag — they can try again anytime.

- **Backend enforcement**: This is NOT just a frontend gate. The API physically rejects document creation requests if the user has no active subscription:
  - `POST /api/documents/upload` and `POST /api/documents/protect` check `user.subscription_status`
  - If `subscription_status != 'active'` and `subscription_status != 'trial'`, return `403 { error: "subscription_required", plan: user.selected_plan, message: "Activate your plan to start protecting documents" }`
  - No workaround — even if someone bypasses the frontend modal, the API blocks them
  - After successful payment: `subscription_status = 'active'`, `subscription_started_at = NOW()`, unlock all document endpoints

- **Enterprise flow**: Users who chose Enterprise see a different modal: "Your Enterprise plan is being set up. Our team will contact you within 24 hours." + "Talk to Sales" CTA + calendar booking link. No self-serve payment for Enterprise.

- **Why this approach works**:
  1. **Low friction onboarding** — no payment during signup = more completions
  2. **Sunk cost effect** — user invested 2 minutes choosing their field, documents, customizing stamp. They're emotionally invested.
  3. **The stamp hook** — they can SEE their customized stamp on the dashboard but can't USE it yet. The desire to see it on a real document drives conversion.
  4. **No surprise** — they chose the plan in Step 5. The price isn't new. The modal just asks them to activate what they already selected.
  5. **Professional gate** — our audience (lawyers, hospitals, government) expects a paid product. Free = suspicious in their world. The payment wall signals quality.

### Navigation & Progress
- **Progress indicator**: 6 dots + step title label at top. Steps: You | Field | Docs | Volume | Plan | Stamp | Ready.
- **Back button**: Every step. Preserves all previous selections.
- **Progress direction**: Always LTR (even in RTL languages). Convention over localization.
- **Auto-save**: State saved server-side on every step transition. Resume on return.

---

## Technical Requirements

### Database Schema

```sql
-- Verification codes
CREATE TABLE verification_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  code VARCHAR(6) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL, -- +10 minutes
  attempts INTEGER DEFAULT 0, -- max 5
  used BOOLEAN DEFAULT FALSE
);

-- Onboarding state (wizard progress)
CREATE TABLE onboarding_state (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id),
  current_step INTEGER DEFAULT 1,
  selections JSONB DEFAULT '{}',
  stamp_config JSONB DEFAULT '{}',
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  last_active_at TIMESTAMP DEFAULT NOW()
);

-- User profiles (filled by wizard)
ALTER TABLE user_profiles ADD COLUMN user_type VARCHAR(20); -- individual, business, organization
ALTER TABLE user_profiles ADD COLUMN industry VARCHAR(20); -- legal, healthcare, education, finance, hr, government, other
ALTER TABLE user_profiles ADD COLUMN industry_other VARCHAR(100); -- free-text if "other"
ALTER TABLE user_profiles ADD COLUMN document_types TEXT[]; -- array of selected types
ALTER TABLE user_profiles ADD COLUMN estimated_volume VARCHAR(20); -- under_50, 50_500, 500_5000, over_5000
ALTER TABLE user_profiles ADD COLUMN onboarding_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE user_profiles ADD COLUMN onboarding_completed_at TIMESTAMP;

-- Plan selection (filled during onboarding Step 5)
ALTER TABLE user_profiles ADD COLUMN selected_plan VARCHAR(20); -- pro, pro_plus, enterprise
ALTER TABLE user_profiles ADD COLUMN plan_selected_at TIMESTAMP;

-- Subscription (activated post-onboarding via payment wall)
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id),
  plan VARCHAR(20) NOT NULL, -- pro, pro_plus, enterprise
  status VARCHAR(20) DEFAULT 'pending', -- pending (chosen, not paid), active, trial, cancelled, expired
  price_cents INTEGER, -- 2900 for pro, 7900 for pro_plus, NULL for enterprise
  billing_cycle VARCHAR(10) DEFAULT 'monthly', -- monthly, annual
  payment_provider VARCHAR(20), -- stripe, paypal
  payment_provider_id VARCHAR(100), -- Stripe subscription ID or PayPal agreement ID
  trial_ends_at TIMESTAMP, -- if 14-day trial is enabled
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  activated_at TIMESTAMP, -- when first payment succeeded
  cancelled_at TIMESTAMP
);

-- Stamp configuration
CREATE TABLE stamp_configs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id),
  accent_color VARCHAR(7) DEFAULT '#7c3aed',
  wave_color VARCHAR(7) DEFAULT '#06b6d4',
  logo_url VARCHAR(500),
  stamp_size VARCHAR(10) DEFAULT 'medium', -- small, medium, large
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/send-code | Send 6-digit verification code |
| POST | /api/auth/verify-code | Verify code, mark email verified |
| GET | /api/onboarding/state | Get current wizard state |
| PATCH | /api/onboarding/state | Update wizard state (step + selections) |
| PATCH | /api/onboarding/step/:n | Save specific step data |
| POST | /api/onboarding/complete | Mark wizard done, trigger setup |
| POST | /api/upload/logo | Upload stamp logo (on completion) |
| GET | /api/onboarding/config | Get all field mappings, presets, features |
| PATCH | /api/onboarding/step/5 | Save selected plan (Step 5: plan selection, no payment) |
| GET | /api/plans | Get available plans with pricing and feature lists |
| POST | /api/subscription/activate | Process payment and activate subscription (Stripe/PayPal) |
| GET | /api/subscription/status | Get current subscription status for payment wall logic |
| PATCH | /api/subscription/change-plan | Change selected plan (before or after activation) |
| POST | /api/subscription/webhook | Stripe/PayPal webhook for payment events (success, failure, cancellation) |

### Email Verification Flow
1. User signs up (email/password) -> creates user record (email_verified: false)
2. Server generates 6-digit code (crypto.randomInt), stores in verification_codes
3. Sends code via email (template: "Your Vertifile verification code: XXXXXX")
4. User enters code -> POST /api/auth/verify-code
5. Server validates: correct code, not expired, attempts < 5
6. Success -> email_verified: true, redirect to wizard
7. Failure -> increment attempts, show error
8. Google OAuth users -> email_verified: true automatically, skip to wizard

### Analytics Events
| Event | Data |
|-------|------|
| onboarding_started | user_id, source (email/google), timestamp |
| onboarding_step_completed | user_id, step, selections, time_in_step |
| onboarding_step_back | user_id, from_step, to_step |
| stamp_customized | user_id, changed_fields[] |
| onboarding_completed | user_id, total_time, recommended_plan |
| onboarding_abandoned | user_id, last_step, time_in_step |

### Re-engagement Email
- Trigger: onboarding_abandoned event (30 min timeout)
- Delay: 24 hours after abandonment
- Content: "You're almost there! Complete your Vertifile setup."
- Deep link: /onboarding (auto-resumes from last step)

---

## UX Requirements

### Layout Specifications
- **Full-screen wizard**: No sidebar, no header nav. Just logo (top-left) + progress dots (top-center) + step content.
- **Max content width**: 960px (centered).
- **Card dimensions**: 280x200px desktop, full-width mobile (min-height 80px).
- **Spacing**: 24px between cards, 32px section padding.
- **Typography**: Inter font. h1: 32px/24px mobile. Body: 16px/14px mobile.
- **Colors**: Cards: white bg, gray-100 border. Selected: white bg, purple-600 border (2px), purple-50 bg tint.

### Animation Specifications
- **Step transitions**: Fade-out 200ms, fade-in from bottom 300ms, ease-out.
- **Card selection**: Scale(1.02) + border color 200ms + checkmark fade-in.
- **Non-selected dim**: Opacity 0.8 (minimum 0.7).
- **Continue button enable**: Gray to purple, 300ms, one pulse on first enable.
- **Stamp preview color change**: CSS transition 400ms.
- **Stamp completion ripple**: Rings expand 1.5s, then settle.
- **All animations**: Honor prefers-reduced-motion (instant changes, no animation).

### Responsive Breakpoints
- **Desktop**: > 1024px — card grid, split-screen stamp
- **Tablet**: 768-1024px — 2 columns, adjusted split
- **Mobile**: < 768px — single column, stacked layout, accordion controls

### RTL Support
- **Layout mirroring**: Back button position, text alignment, card icon placement.
- **Progress dots**: Always LTR direction.
- **Color picker/slider**: Direction-independent.
- **Step 5 split-screen**: Controls right, preview left in RTL.

### Accessibility (WCAG 2.1 AA)
- Keyboard navigation: Tab/Enter/Space for all interactions.
- Focus outlines: Visible on all interactive elements.
- Aria roles: radiogroup (single-select), group (multi-select).
- Touch targets: 44x44px minimum.
- Contrast: 4.5:1 minimum for text.
- Reduced motion: Static preview, instant state changes.
- Screen reader: aria-labels on all cards, aria-live for errors.

---

## Open Questions

1. **Free tier**: Will there be a free plan for "Up to 50 docs"? Affects plan recommendation logic.
2. **Stamp text**: Should the stamp ever contain text like "VERIFIED"? Currently no, but worth deciding now.
3. **Apple Sign-In**: Deferred to V2. Confirm this is acceptable timeline.
4. **Video onboarding**: Should Step 1 or Step 5 include a 15-second explainer video? Could increase engagement but adds load time.
5. **A/B testing**: Should we build the wizard with A/B testing infra from day one (e.g., testing 5-step vs 6-step)?
6. **Wizard re-entry**: Can users re-do the wizard after completion? Or only change settings from dashboard?
7. **Enterprise onboarding**: Should organizations with 5,000+ docs get a different wizard flow (e.g., skip stamp — admin sets it for the org)?
8. **GDPR consent**: Do we need a consent checkbox during wizard for data processing? Yael (Legal) should weigh in.

---

## Summary of Decisions

| Topic | Decision | Who Decided |
|-------|----------|-------------|
| Email verification | Blocking (hard), with excellent UX (code, resend, change email) | Consensus (Chen won the debate) |
| Verification method | 6-digit code, not email link | Consensus |
| Steps 1+2 | Combined screen with progressive disclosure | Compromise (Amit mediated Dana+Chen) |
| Progress dots direction | Always LTR, even in RTL | Consensus (Chen + Amit) |
| Skip wizard | No skip option. Gentle banner if incomplete. | Consensus (Amit + Chen compromise) |
| Color picker | 10 presets + custom (hex + wheel) | Consensus (Chen's suggestion) |
| "Other" industry | Free-text with placeholder | Consensus |
| "Other" doc type | No free-text, just selectable | Consensus |
| Pricing in wizard | Not until Step 6 summary | Consensus |
| CTA text | "Start Protecting Documents" | Consensus (Dana proposed, Chen confirmed) |
| Auth methods V1 | Email/password + Google OAuth only | Consensus |
| Logo handling | Auto-crop square, 200x200, sharp library | Moshe |
| Stamp preview | SVG with CSS animation, client-side | Moshe |
| Analytics | Both client + server events | Moshe + Amit |
| Wizard state | Server-side (onboarding_state table) | Moshe + Amit |
| Re-engagement | Email 24h after abandonment, deep link | Chen + Amit |
| Mobile Step 5 | Accordion controls + sticky preview | Dana + Chen |

---

*Document authored by: Amit (Product), Dana (UX), Chen (Support), Moshe (Backend)*
*Dispatched by: Ori (Team Manager)*
*Date: 2026-04-04*
*Next step: Review by Zur, then Moshe begins API layer, Dana creates wireframes*

# Ping-Pong Tracker | Sprint: DB + Auth + Dashboard
### Managed by: Ori (Team Manager)
### Last updated: 2026-04-05
### Status: ACTIVE SPRINT

---

> **"אני לא מנהל שיושב בצד. כל שורת קוד, כל spec, כל merge — עובר דרכי."**
> *"I'm not a manager who sits on the side. Every line of code, every spec, every merge — goes through me."*
> -- Ori

---

## How This Works | איך זה עובד

כל משימה עוברת pipeline של ping-pong בין agents. אף אחד לא עובד לבד, אף אחד לא ממרג'ג' לבד.
Every task goes through a ping-pong pipeline between agents. Nobody works alone, nobody merges alone.

**Ping** = העברת עבודה לשלב הבא (delivery)
**Pong** = תגובה/ביקורת/אישור (review/feedback)
**Block** = משהו תקוע — Ori מטפל (something stuck — Ori handles it)

---

## Pipeline 1: Authentication System | מערכת הזדהות

**Priority: CRITICAL** | בלי auth אין מוצר
**Owner: Moshe (Backend)** | **Security: Avi**

```
Step 1: Moshe builds    -> auth code (routes, DB schema, sessions, OAuth)     [IN PROGRESS]
Step 2: Avi reviews     -> against security spec checklist                    [WAITING - Avi writing spec]
Step 3: Moshe fixes     -> security issues found by Avi                       [PENDING]
Step 4: Avi approves    -> "secure to merge" — חתימת אבטחה                    [PENDING]
Step 5: Rina tests      -> E2E tests on full auth flow                       [PENDING]
Step 6: Nir checks      -> regression — nothing broke from auth changes       [PENDING]
Step 7: MERGE           -> Ori approves final merge                          [PENDING]
```

**Ori's notes:**
- משה — אני צריך לראות DB schema + route list לפני שאבי מתחיל review. תעביר לי draft.
- אבי — ה-security spec שלך מוכן? משה לא יכול לזוז בלי הצ'קליסט שלך. תעדכן אותי היום.
- Moshe: I need to see DB schema + route list before Avi starts review. Send me a draft.
- Avi: Is your security spec ready? Moshe can't move without your checklist. Update me today.

**Dependencies:**
- Step 2 blocked until: Avi completes security spec AND Moshe delivers auth code
- Step 5 blocked until: Avi gives "secure to merge" approval
- Step 7 blocked until: BOTH Rina E2E pass AND Nir regression pass

---

## Pipeline 2: Dashboard | דשבורד

**Priority: HIGH** | זה מה שהמשתמש רואה
**Owner: Dana (Design/Frontend)** | **Product: Amit** | **Support: Chen**

```
Step 1: Dana writes spec   -> layout, tabs, components, user flows            [IN PROGRESS]
Step 2: Amit reviews        -> product perspective (features, user flow, KPIs) [PENDING]
Step 3: Chen reviews        -> support perspective (help tab, error states,    [PENDING]
                               user confusion points, FAQ integration)
Step 4: Dana revises        -> incorporates Amit + Chen feedback               [PENDING]
Step 5: Dana builds         -> HTML/CSS/JS implementation                      [PENDING]
Step 6: Moshe builds        -> API endpoints for dashboard data                [PENDING]
Step 7: Rina tests          -> E2E on full dashboard                           [PENDING]
Step 8: MERGE               -> Ori approves final merge                        [PENDING]
```

**Ori's notes:**
- דנה — ה-spec צריך לכלול: tab structure, responsive behavior, error states, empty states. אל תשלחי spec חצי.
- אמית — כשתקבל את ה-spec, תבדוק שכל user segment (private/business/org) מקבל dashboard מותאם. זה לא one-size-fits-all.
- חן — תחשוב כמו user שלא מבין כלום. איפה הוא יתקע? מה יבלבל אותו? תוסיף הערות על help text ו-error messages.
- Dana: Spec must include tab structure, responsive behavior, error states, empty states. Don't send a half-baked spec.
- Amit: When you get the spec, verify every user segment (private/business/org) gets a tailored dashboard. Not one-size-fits-all.
- Chen: Think like a user who understands nothing. Where will they get stuck? What will confuse them? Add notes on help text and error messages.

**Dependencies:**
- Step 2+3 can run in parallel (Amit and Chen review simultaneously)
- Step 5 blocked until: Dana's revised spec approved by both Amit AND Chen
- Step 6 blocked until: Dana finalizes component list (so Moshe knows what data endpoints to build)
- Step 8 blocked until: Rina E2E pass

---

## Pipeline 3: CI/CD | בנייה ובדיקות אוטומטיות

**Priority: HIGH** | בלי CI/CD אנחנו עיוורים
**Owner: Eli (DevOps)** | **QA: Rina + Nir**

```
Step 1: Eli built           -> GitHub Actions: ci.yml + security.yml           [DONE]
Step 2: Rina reviews        -> adds test scenarios to CI pipeline              [PENDING]
Step 3: Nir reviews         -> regression checks, coverage requirements        [PENDING]
Step 4: Eli adjusts         -> based on Rina + Nir feedback                    [PENDING]
Step 5: MERGE               -> Ori approves final merge                        [PENDING]
```

**Ori's notes:**
- אלי — כל הכבוד שסיימת מהר. עכשיו תחכה ל-Rina ו-Nir. אל תמרג'ג' בלעדיהם.
- רינה — תוסיפי test scenarios: auth tests, build tests, lint checks. תעבירי לאלי רשימה מסודרת.
- ניר — תבדוק: מה קורה אם test נכשל? יש rollback? יש notification? תוסיף regression rules.
- Eli: Good job finishing fast. Now wait for Rina and Nir. Do NOT merge without them.
- Rina: Add test scenarios: auth tests, build tests, lint checks. Send Eli an organized list.
- Nir: Check: what happens if a test fails? Is there rollback? Notification? Add regression rules.

**Dependencies:**
- Step 2+3 can run in parallel
- Step 4 blocked until: BOTH Rina and Nir provide feedback
- Step 5 blocked until: Eli implements ALL requested changes

---

## Pipeline 4: Email Service (NEXT SPRINT) | שירות אימייל

**Priority: MEDIUM — starts after auth is stable**
**Owner: Moshe (Backend)** | **Copy: Shira** | **Design: Dana** | **Security: Avi**

```
Step 1: Moshe builds        -> email integration (Resend/SendGrid API)         [NOT STARTED]
Step 2: Shira writes        -> email copy: welcome, verification,              [NOT STARTED]
                               re-engagement, password reset
Step 3: Chen reviews        -> support perspective: clarity, tone,             [NOT STARTED]
                               user confusion prevention
Step 4: Dana designs        -> email templates: branded, responsive, RTL       [NOT STARTED]
Step 5: Avi reviews         -> security: no sensitive data in emails,          [NOT STARTED]
                               secure links, expiration on tokens
Step 6: MERGE               -> Ori approves final merge                        [NOT STARTED]
```

**Ori's notes:**
- זה מתחיל רק אחרי ש-auth יציב ומאושר. לא מתחילים email בלי שיש login.
- שירה — תתחילי לחשוב על copy עכשיו. שהטקסטים יהיו מוכנים כשמשה יסיים.
- This starts ONLY after auth is stable and approved. No email without login.
- Shira: Start thinking about copy now. Texts should be ready when Moshe finishes.

**Dependencies:**
- Entire pipeline blocked until: Pipeline 1 (Auth) reaches Step 7 (MERGE)
- Step 2+3+4 can run in parallel once Moshe delivers email integration skeleton
- Step 5 (Avi security review) is mandatory before merge. No exceptions.

---

## Ori's Dashboard | לוח מצב

### Current Status Board | מצב נוכחי

| Task | Owner | Reviewer(s) | Status | Ping-Pong Step | Blocker | Deadline |
|------|-------|-------------|--------|---------------|---------|----------|
| Auth system (DB + routes + sessions) | Moshe | Avi (security) | IN PROGRESS | Pipeline 1, Step 1 | Waiting for Avi's security spec | -- |
| Auth security spec + checklist | Avi | Ori (review) | IN PROGRESS | Pipeline 1, Step 2 prep | None — Avi working | Today |
| CI/CD workflows | Eli | Rina, Nir | DONE (build) / PENDING (review) | Pipeline 3, Step 1 done | Waiting for Rina + Nir review | 24h from now |
| Dashboard design spec | Dana | Amit (product), Chen (support) | IN PROGRESS | Pipeline 2, Step 1 | None — Dana working | -- |
| CI test scenarios | Rina | Eli (implements) | NOT STARTED | Pipeline 3, Step 2 | Needs to start | 24h |
| CI regression checks | Nir | Eli (implements) | NOT STARTED | Pipeline 3, Step 3 | Needs to start | 24h |
| Dashboard product review | Amit | -- | WAITING | Pipeline 2, Step 2 | Blocked by Dana's spec | -- |
| Dashboard support review | Chen | -- | WAITING | Pipeline 2, Step 3 | Blocked by Dana's spec | -- |
| Email service | Moshe | Avi, Chen, Dana, Shira | NOT STARTED | Pipeline 4, Step 1 | Blocked by auth completion | Next sprint |
| Email copy | Shira | Chen | PREP PHASE | Pipeline 4, Step 2 | Can draft early | -- |

---

## Ori's Rules | חוקי אורי

> אלה לא המלצות. אלה חוקים. מי שלא עוקב — אני מחזיר לו את העבודה.
> These are not suggestions. These are rules. Anyone who doesn't follow — I send the work back.

### The 7 Laws of Ping-Pong:

1. **NOTHING merges without 2 agent reviews minimum** | שום דבר לא נכנס בלי 2 ביקורות לפחות
   - לא "אבל זה שינוי קטן". לא "אבל זה דחוף". שתי ביקורות. נקודה.
   - Not "but it's a small change." Not "but it's urgent." Two reviews. Period.

2. **Security-related code: Avi MUST approve** | קוד אבטחה: אבי חייב לאשר
   - Auth, tokens, sessions, passwords, encryption, email links — אבי רואה הכל.
   - If Avi hasn't signed off, it doesn't ship.

3. **UX code: Dana MUST approve visual** | קוד UX: דנה חייבת לאשר ויזואלית
   - אם זה מגיע למסך של המשתמש — דנה מאשרת שזה נראה נכון.
   - If it reaches the user's screen — Dana confirms it looks right.

4. **Every reviewer has 24h to respond** | לכל מבקר יש 24 שעות להגיב
   - עבר 24 שעות ולא הגיב? אורי שולח תזכורת. עבר 48? אורי מחליט בעצמו.
   - 24h passed without response? Ori sends reminder. 48h? Ori decides.

5. **If disagreement: Ori decides (but listens to both sides)** | אם יש מחלוקת: אורי מכריע
   - אני לא מכריע סתם. אני שומע את שני הצדדים, ואז מחליט.
   - I don't decide arbitrarily. I hear both sides, then decide.

6. **Quality > Speed. Always.** | איכות > מהירות. תמיד.
   - אנחנו לא שולחים קוד "בסדר". אנחנו שולחים קוד מושלם.
   - We don't ship "okay" code. We ship perfect code.

7. **If something isn't perfect: send it back. No compromises.** | אם משהו לא מושלם: מחזירים. בלי פשרות.
   - צור לימד אותנו: לא להתפשר. אף פעם.
   - Zur taught us: don't compromise. Ever.

---

## Escalation Protocol | פרוטוקול אסקלציה

```
Level 1: Agent disagrees with review     -> They discuss, try to resolve
Level 2: Can't resolve in 24h            -> Ori steps in, hears both sides
Level 3: Ori can't resolve / critical    -> Zur decides
```

---

## Next Actions | פעולות הבאות

### Immediate (Today):
- [ ] **Avi**: Deliver security spec + checklist — Moshe is waiting
- [ ] **Rina**: Start reviewing Eli's CI/CD workflows — add test scenarios
- [ ] **Nir**: Start reviewing Eli's CI/CD workflows — add regression checks
- [ ] **Dana**: Continue dashboard spec — include ALL states (empty, error, loading)

### This Week:
- [ ] **Moshe**: Deliver auth draft (DB schema + routes) for Avi's review
- [ ] **Eli**: Wait for Rina + Nir feedback, then adjust CI/CD
- [ ] **Amit**: Be ready to review Dana's dashboard spec when delivered
- [ ] **Chen**: Be ready to review Dana's dashboard spec when delivered
- [ ] **Shira**: Start drafting email copy (welcome, verification) — advance prep

### Blocked Until Auth Completes:
- [ ] Email service (Pipeline 4) — entire pipeline
- [ ] Dashboard API endpoints (Pipeline 2, Step 6) — needs auth middleware

---

## Communication Log | יומן תקשורת

| Date | From | To | Message | Status |
|------|------|----|---------|--------|
| 2026-04-05 | Ori | All | Sprint tracker created. Everyone reads it. No excuses. | SENT |
| 2026-04-05 | Ori | Avi | Security spec — מתי מוכן? Moshe waiting. | WAITING |
| 2026-04-05 | Ori | Rina, Nir | Eli finished CI/CD. Your turn. 24h clock starts now. | SENT |
| 2026-04-05 | Ori | Dana | Dashboard spec — include error states, empty states, RTL. | SENT |

---

> **אורי לצוות: אני עוקב אחרי כל שורה בטבלה הזו. אם משהו תקוע — תגידו לי עכשיו, לא מחר. אנחנו בונים מוצר שצור לא יתפשר עליו, ואני גם לא.**
>
> **Ori to team: I'm tracking every row in this table. If something is stuck — tell me now, not tomorrow. We're building a product Zur won't compromise on, and neither will I.**

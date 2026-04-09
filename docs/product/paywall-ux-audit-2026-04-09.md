# Paywall UX Audit — 2026-04-09

Author: דנה (UX)
Trigger: Liron (Head of Ops, 80-lawyer firm) called the pricing experience a "bait-and-switch dealbreaker" during evaluation. Wekselman (Yoav's first cold-email target) cannot evaluate Vertifile until this is fixed.
Scope: Document the current paywall UX and propose the post-fix flow. UX only — pricing tiers belong to Rotem (Finance), and the data-model rewire belongs to Amit (Product).

Reference notes on file:line:
- Paywall modal HTML lives at `public/app.html:1528-1541` (the brief said 1517-1522; that range is actually the upload-limit copy inside the upload modal — also relevant, see Section 2).
- Hardcoded admin email lives at `public/app.html:2946` (the brief said 2897; that line is `copyApiKeyApp`, unrelated). The real hardcode is inside `isFreePlan()`.
- Paywall CSS lives at `public/app.html:957-970`.

---

## 1. The Current Experience — Frame by Frame

A new individual user named "Liron" arrives from the homepage, where the FAQ at `public/index.html:1166` literally promises: "Yes, Vertifile is free for individuals." This is the contract she expects to be honored. Here is what actually happens.

- **Frame 1 — Sign-up.** Liron signs up. The dashboard loads. No upgrade prompt yet. So far the homepage promise feels intact.
- **Frame 2 — First upload.** She drags a contract PDF into the upload modal at `app.html:1500`. The upload zone is friendly, the progress bar fills, and her document appears in the sidebar list with the verified stamp. She smiles. This is the moment she decided to evaluate Vertifile in the first place.
- **Frame 3 — The download click.** She selects the doc, opens the preview card (`app.html:2215-2222`), and clicks Download. Instantly the screen darkens behind a glassmorphic blurred overlay, and a 480px-wide white card slides in. The headline reads "Upgrade to Download & Share". The sub-headline reads "Your document is protected, but downloading and sharing requires a Pro or Enterprise plan." A purple gradient button screams "Upgrade to Pro — $29/mo". Below it, fine print: "Includes 100 documents/month, custom branding, API access". Her smile is gone.
- **Frame 4 — The share click.** She closes the modal with the small grey × in the corner, finds the share button, and clicks it hoping share is at least free. Same modal, same headline, same $29. Two strikes.
- **Frame 5 — The Upgrade click (the dead end).** She decides to investigate. She clicks "Upgrade to Pro — $29/mo". The button is an `<a href="/pricing">` (`app.html:1537`). It opens a pricing page in the same tab — she loses her dashboard context, has to navigate back, and the upload she was about to validate is no longer the focus of the screen.
- **Frame 6 — The Cancel question.** There is no "Stay on Free" or "I'm an individual" path. The only way out is the corner ×. The modal gives her zero alternatives — no trial, no downgrade, no "see what free includes". The card asks for $29 OR nothing.
- **Frame 7 — The bounce.** Liron switches to her email, replies to Yoav's cold email with one sentence: "Your homepage says free for individuals but the dashboard charges $29 to download my own file. Bait and switch." She does not write a public bad review, but she tells two colleagues at the firm. Wekselman never gets evaluated.

The damning fact: she never used the product. The verification stamp she saw in Frame 2 was the only piece of value she experienced before the paywall. Everything after Frame 2 reads as a sales surface, not a tool.

---

## 2. What's Broken — Specific UX Failures

### Failure 1: The promise is broken at the first verb the user tries
- **File:line:** `public/app.html:2241, 2247, 2255, 2261, 2961, 2970` — six call sites of `if (isFreePlan()) { showPaywall(); return; }` blocking `downloadCurrentDoc`, `shareCurrentDoc`, `downloadDoc`, `shareDoc`, the legacy `downloadDoc()`, and `shareDoc()`.
- **Failure:** Download and share are the two PRIMARY verbs of a document tool. Blocking both for free users means the homepage promise "free for individuals" is functionally false the moment the user clicks anything. There is no "free experience" — there is only a teaser screen and a paywall.
- **Why it hurts:** The user already paid the cost of trust (signed up, uploaded a real document) before discovering the cost. This is the textbook bait-and-switch pattern. It does not just lose this user; it costs the referrals she would have made.
- **Should be instead:** Individuals get download and share at zero cost. The paywall should be wired to features individuals don't need (multi-user, custom branding, API, bulk).

### Failure 2: The modal headline is generic, not specific
- **File:line:** `public/app.html:1532` — `<h2>Upgrade to Download & Share</h2>`.
- **Failure:** The headline is about WHAT YOU CANNOT DO ("Upgrade to..."), not about WHAT VALUE THE PAID TIER DELIVERS. It is a wall, not a door.
- **Why it hurts:** The user reads it as a punishment. There is no narrative — just a price tag. Liron has no reason to consider the paid plan because the modal never explains who the paid plan is FOR.
- **Should be instead:** The modal should only fire on org-features and the headline should name the org-feature being unlocked: "Add team members", "Use a custom logo on your stamps", "Connect via API". Specific reasons convert; generic upgrade walls do not.

### Failure 3: The Cancel/Close affordance is buried
- **File:line:** `public/app.html:1531` — `<button class="paywall-close" onclick="closePaywall()">&times;</button>`. CSS at line 968: `position:absolute;top:14px;right:18px;background:none;border:none;font-size:22px;color:#9ca3af`.
- **Failure:** The only way out of the modal is a tiny grey × in the upper-right corner. There is no labelled "Stay on Free" button, no "Maybe later" button, no "Tell me what's in the free plan" link. The Upgrade button is a 14px-padded purple gradient with a glow shadow; the Close × is a 22px grey character with no border.
- **Why it hurts:** Visual hierarchy says "the only legitimate action is to pay". When the user does want to bounce, the affordance feels like a hidden escape hatch — which is exactly the feeling a dark pattern produces. It registers in the user's gut as manipulative.
- **Should be instead:** Two buttons of equal weight, side by side: a primary CTA labelled with the specific upgrade reason, and a clear secondary "Stay on Free" or "Not now" with a real button shape.

### Failure 4: Upload modal has a separate, conflicting "free document limit" screen
- **File:line:** `public/app.html:1517-1520` — `<div class="upload-limit"><p>You've reached the free document limit. Contact us for more.</p><a href="/contact">Contact Us</a></div>`.
- **Failure:** A SECOND paywall mechanism, separate from the main paywall overlay, with a different visual treatment (inline message inside the upload modal) and a different CTA (Contact Us instead of /pricing). The user gets two contradictory messages from two different walls in the same product.
- **Why it hurts:** Inconsistency makes the product feel half-finished. If a customer hits both screens, they receive two different stories about what "free" means and two different paths to escalate.
- **Should be instead:** A single, predictable upgrade trigger map (Section 7), and the upload-limit copy should disappear for individuals entirely (individuals do not have a document cap in the new model — see Section 3).

### Failure 5: The paywall fires on a button the user EXPECTS to work
- **File:line:** `public/app.html:2241` (download), `2247` (share).
- **Failure:** Both buttons render normally, with no lock icon, no "Pro" badge, no greyed-out state, no tooltip. Visual affordance promises the action will succeed; the modal then reveals the action is gated. This is a classic "false-positive affordance" UX antipattern.
- **Why it hurts:** The user feels tricked twice: once by the homepage and once by the button itself. Even if the modal copy were perfect, the surprise alone damages trust.
- **Should be instead:** Buttons gated for paid users should either (a) be hidden entirely on the free tier, or (b) carry a small lock icon and tooltip explaining the gate BEFORE the click — never silently appear normal and then trip a wall.

---

## 3. The Proposed New Flow (Post-Fix)

ASSUMPTION: Rotem will define a tier structure where individuals get free upload, verification, download, and share (with a generous personal cap), and paid tiers unlock organization features such as multi-seat, custom logo on stamps, API access, branded share pages, and bulk processing.

The new flow:

- **Individual upload + download + share is silent magic.** Liron uploads, sees the stamp, clicks Download, and the file downloads. No modal. No interruption. She clicks Share, the link is copied, a toast says "Share link copied". The product does what the homepage promised. This entire path never sees the word "Upgrade".
- **Upgrade is contextual, never generic.** The upgrade modal only fires on actions that are objectively not part of the individual use case. Triggers: clicking "Add team member" in Settings, clicking "Upload custom logo" in stamp settings, clicking "Generate API key" in Developer settings, hitting the org-tier monthly bulk threshold (e.g. 50 docs/month for personal vs unlimited for org).
- **Each upgrade modal speaks in the language of the trigger.** "Add team members — your firm-wide stamp library is part of Vertifile Teams" is different from "Use a custom logo on your stamps — branded stamps are part of Vertifile Business". The user learns WHY a specific feature costs money, instead of being asked to buy a generic "Pro".
- **Free is the default everywhere except those explicit triggers.** No `isFreePlan()` checks gate Download or Share. The function still exists for the trigger map but the four call sites at `app.html:2241, 2247, 2255, 2261` are deleted. The two legacy call sites at `2961, 2970` are deleted.
- **The upgrade modal is escapable with dignity.** A clearly labelled secondary button "Stay on Free" — same height, same padding, less visual weight but full button shape — sits next to the primary CTA. Clicking it dismisses the modal and returns the user to exactly the same page state.
- **The homepage promise becomes verifiable in 30 seconds.** A new user can sign up, upload a doc, download it, and share it without ever seeing a price. Yoav can send Wekselman a link with confidence.
- **The upload-modal upload-limit message rewrites.** The "You've reached the free document limit" copy at `app.html:1517-1520` becomes "You're at 50 documents this month. Upgrade to Vertifile Business for unlimited and team uploads" — and only fires at the actual personal cap, not on the first upload.

Result: Liron's dealbreaker is gone.

---

## 4. The Modal Itself — Redesign

The current modal asks "do you want to pay $29?". The new modal asks "do you want this specific feature?".

### Structure
- **Title:** Specific to the trigger. NOT "Upgrade to Pro". Examples: "Add team members", "Use your firm's logo on stamps", "Connect via API", "Process 50+ documents per month".
- **Body (2-3 sentences):** What the feature does, who it is for, what business problem it solves. NOT a price, NOT a bullet list of plan features. The price lives on the linked pricing page.
- **Primary CTA:** Action-oriented, named after the verb the user just clicked. "Add team members", "Upload logo", "Generate API key". NOT "Upgrade".
- **Secondary action:** A real button labelled "Stay on Free" or "Not now" of equal height, sitting beside the primary CTA. Equal touch target; visually quieter (e.g. ghost button) but unmistakably present.
- **Visual:** Drop the price-tag tone entirely. Keep the glassmorphic card style from `app.html:959` for visual continuity with the rest of the dashboard, but soften the gradient — the current `linear-gradient(135deg,#4f46e5,#7c3aed)` button (line 965) reads as a sales banner. Use the dashboard's standard button gradient instead so the modal feels like a feature switch, not an ad.
- **Remove the close-× as the only escape.** Keep it as a redundant escape, but the secondary "Stay on Free" button is the primary escape.
- **No fine-print under the CTA.** The line "Includes 100 documents/month, custom branding, API access" at `app.html:1538` belongs on the pricing page, not in the dashboard's interrupt modal.

### Sketch

```
+-----------------------------------------------+
|                                          [x]  |
|  Add team members                              |
|                                                |
|  Vertifile Teams lets your firm share a        |
|  single stamp library, see who verified each   |
|  document, and manage seats from one admin.    |
|                                                |
|  [ Add team members ]   [ Stay on Free ]       |
|                                                |
+-----------------------------------------------+
```

The two buttons are side by side, equal height. Primary on the left in LTR, on the right in RTL. The headline names the feature, not the plan. The body explains the value, not the price. The user can leave with a button, not a corner ×.

---

## 5. Hardcoded Email Removal

`public/app.html:2946`:

```js
if (currentUser.email === 'zur2525@gmail.com' || currentUser.email === 'info@vertifile.com') return false;
```

(The brief pointed at line 2897, which is actually `copyApiKeyApp`. The real hardcode is at 2946 inside `isFreePlan()`.)

- **What it does today:** Treats the two named addresses as paid users regardless of their actual `currentUser.plan` value. This was almost certainly added so Zur could test the dashboard without triggering the paywall on his own account.
- **Why it is unprofessional:** Zur's personal email is now visible to anyone who views source on `app.html`. It also leaks the implementation detail that Vertifile has a "let the founder in for free" backdoor. For a verification product, that exact pattern undermines the brand promise: "we have backdoors in our code" is the worst possible message for a tamper-proofing tool. Beyond the brand damage, the gating itself is client-side — a user could fork the page locally and edit the line.
- **How to remove (handoff to Amit):** Tier checks must be server-side. The server already returns `currentUser.plan` from `/api/user/me` (`app.html:1579`). After Rotem defines tiers, every paywall-relevant capability is computed on the server and returned as a flag set on `currentUser`, e.g. `currentUser.canUseBranding`, `currentUser.canInviteTeam`, `currentUser.maxDocsPerMonth`. The client reads the flag, not the email. Zur's account gets the right plan in the database, not in JS. This fix lives in the data layer (Amit), not in UX (me).

---

## 6. Mobile and RTL

### Current modal, mobile (390px viewport)
- The card is `max-width:480px;width:92%` (line 959). At 390px viewport, that's a 359px-wide card. Fits.
- The card has 40px padding (line 959). Combined with the 92% width that leaves a usable area of about 279px for content. The headline at 22px (line 960) takes one line on the longest English string ("Upgrade to Download & Share"). Hebrew RTL strings of similar length will also fit.
- The CTA button is `padding:14px 36px` (line 965). On a 279px content area, the gradient button is roughly 200px wide — touch target is fine (44px+ height) but the gradient looks cramped on a narrow card.
- The close × at line 968 is `font-size:22px` with `padding:4px`. On mobile that touch target is around 30px — below Apple's 44px guideline. A user with larger fingers can miss it and tap the Upgrade button by accident, which feels coercive.
- **Verdict for current modal:** Visually fits on mobile, but the close × is a sub-spec touch target and the only escape, which compounds the dark-pattern feeling on phones.

### Current modal, Hebrew RTL
- The card's text alignment is `text-align:center` (line 959), so the headline and body center safely in either direction.
- The close × at `right:18px` (line 968) flips correctly under `[dir="rtl"]` if the page sets `direction:rtl` on the body — needs verification with Amit, since the current modal doesn't include explicit RTL CSS rules.
- The CTA "Upgrade to Pro — $29/mo" is hardcoded in English in the i18n key default (line 1537). The Hebrew translation must be wired via `data-i18n="paywall.ctaBtn"` in all 10 locale files; verify locale coverage.
- **Verdict for current modal:** Works visually but RTL is unverified and the hardcoded English fallback will leak through if the locale file is missing the key.

### New modal, mobile and RTL
- **Mobile:** The two buttons side by side fit at 390px if each is around 130px wide with 8px gap. If the trigger label is long (e.g. "Process 50+ documents per month"), wrap to two lines or stack the buttons vertically below 360px viewport. Stacked order: primary on top, "Stay on Free" below — but with the same height and padding so neither feels like a trap door.
- **Touch targets:** Both buttons must be at least 44px tall. Equal heights are non-negotiable for the dignity-of-escape principle.
- **RTL:** Primary button on the right, secondary on the left. Headline still centers. Body text aligns right. The close × moves to top-left under `dir="rtl"`. All copy goes through `data-i18n` keys with full coverage in all 10 locale files (Amit owns the wiring, I'll spec the keys).

---

## 7. Coordination with Rotem and Amit

### What I need from Rotem (Finance) before I can finalize copy
- The exact tier names. Are they "Free / Teams / Business" or "Personal / Pro / Enterprise" or something else? The modal headlines depend on it.
- The exact list of features that trigger an upgrade. I need a definitive answer for: multi-user, custom logo, API, bulk processing, branded share pages, monthly cap (and the cap number for individuals), white-label, audit log, SSO. Each of these becomes one possible modal headline + body.
- The free-tier monthly document cap (if any). The current upload-limit copy at `app.html:1517-1520` is generic; the new copy will name a specific number.
- Whether there is a trial flow at all. If yes, the modal gets a third action: "Start 14-day free trial". If no (Zur's "no MVP" stance suggests not), the modal stays at two actions.

### What I need from Amit (Product / paywall code audit)
- A confirmed paywall trigger map: a list of every feature in the product that should fire the upgrade modal in the new world, as code locations. I will write the modal copy for each. Six known sites in `app.html` are deleted; new ones are added wherever an org feature is gated.
- Server-side `currentUser` flag schema after his refactor. I need to know whether the client reads `currentUser.canInviteTeam` or `currentUser.tier === 'business'` — affects how the modal decides whether to show.
- Confirmation that the hardcoded email at `app.html:2946` is removed in his refactor and Zur's account is granted access via a real database row.

### Implementation file split (anticipated)
- `public/app.html:1528-1541` — modal HTML structure rewrite — I write the copy and structure, Amit wires the i18n keys and the trigger context (so the modal can show different text per trigger).
- `public/app.html:957-970` — paywall CSS — I write the new styles for the two-button layout, equal-weight escape button, and dashboard-matching gradient.
- `public/app.html:2241, 2247, 2255, 2261, 2961, 2970` — DELETE these `if (isFreePlan()) { showPaywall(); return; }` lines — Amit owns this; it is data-layer logic, not UX.
- `public/app.html:2943-2948` — `isFreePlan()` function — Amit replaces with the server-side flag check.
- `public/app.html:1517-1520` — upload-limit copy — I rewrite, Amit wires it to the actual monthly counter.
- `public/index.html:1166` — homepage FAQ copy — minor tweak to match the new tier names once Rotem finalizes them. I'll handle this once Rotem gives me the names.
- All 10 locale files under `public/locales/` — Amit wires up the new `paywall.*` i18n keys; I draft the English source strings.

---

## Notes for the parent session

This audit is UX-only. Pricing tiers (Rotem) and the data-model rewire (Amit) are dependencies, not part of this deliverable. The paywall HTML, the paywall CSS, the modal copy, and the trigger map are the four pieces I own and can ship the moment Rotem's tier definitions land.

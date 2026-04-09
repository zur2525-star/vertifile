# Vertifile Pricing Model v1
**Author:** רותם (Finance / Business)
**Date:** 2026-04-09
**Status:** Proposal — pending Amit (Product) + Dana (UX) implementation, Zur final approval
**Replaces:** the implicit "Free = demo, Pro = $29/mo to download your own document" model that Liron flagged as a dealbreaker tonight.

---

## 1. The Decision

**Free** for individuals — unlimited document creation, download, share, and verification, with Vertifile branding on the stamp. **Pro at $19/mo** unlocks own-branding, longer audit trail, and API. **Business at $12/seat/mo (5-seat min)** unlocks team accounts, custom domain, and white-label PVF wrapper. **Enterprise** is custom-quoted for white-glove and on-prem.

The "free" tier is genuinely free — it includes the three things Liron caught the current product blocking: **download, share, and verify**. We never paywall a user from doing something with their own document. We paywall *organizational* features.

---

## 2. Tier Breakdown

| Feature | Free | Pro | Business | Enterprise |
|---|---|---|---|---|
| **Document upload** | 25 / month | 500 / month | 5,000 / seat / month | Unlimited |
| **Document download** (own docs) | Unlimited | Unlimited | Unlimited | Unlimited |
| **Document share via link** | Unlimited | Unlimited | Unlimited | Unlimited |
| **Document verification** (recipient) | Unlimited, no account | Unlimited, no account | Unlimited, no account | Unlimited, no account |
| **Stamp design** | Vertifile branded | Custom logo + colors | Custom logo + multi-template library | Fully custom + designer assist |
| **Audit log retention** | 30 days | 1 year | 7 years | Unlimited / contractual |
| **API access** | — | 1,000 calls / mo | 50,000 calls / seat / mo | Unlimited + dedicated key |
| **Webhook integrations** | — | 3 endpoints | Unlimited | Unlimited + signed payloads |
| **Multi-user / org account** | — | — | Yes (5-seat min) | Yes |
| **Centralized billing & SSO** | — | — | Yes (Google, Microsoft, SAML) | Yes + custom IdP |
| **Custom domain** (`docs.your-firm.com`) | — | — | Yes | Yes |
| **White-label PVF wrapper** | — | — | — | Yes |
| **Bulk operations** (CSV / batch) | — | 50 docs / batch | 1,000 docs / batch | Unlimited |
| **DMS integration** (iManage, NetDocs) | — | — | Yes | Yes + custom connectors |
| **Storage** | 1 GB | 25 GB | 250 GB / seat | Custom |
| **Support SLA** | Community + docs | Email, 48h | Priority email + chat, 8 business hrs | Dedicated CSM + 1h critical |
| **Legal opinion & admissibility memo** | — | — | Israeli court memo (shared) | Jurisdiction-specific opinions |
| **On-prem / private cloud** | — | — | — | Yes |

**The line in the sand:** anything a *single human* needs to do with *their own document* is free. Anything that involves *an organization, automation, branding, or scale* is paid. This is the Slack / Notion / GitHub model.

---

## 3. Pricing

| Tier | Price | Billed |
|---|---|---|
| **Free** | $0 | — |
| **Pro** | **$19 / mo** ($190 / yr — 17% off) | per user |
| **Business** | **$12 / seat / mo** ($120 / seat / yr — 17% off) — 5-seat minimum | per seat |
| **Enterprise** | **Custom** (starts ~$2,500 / mo) | annual contract |

**Justification:**

- **Pro at $19/mo** (not $29). Notion Pro is $10, Loom Business is $15, GitHub Pro is $4, Dropbox Plus is $11.99. We are pre-launch with no logos and no SOC 2. $29 was a fantasy number. $19 is a credible "I'd put it on a personal credit card" price for a freelance lawyer, accountant, or notary. It's also deliberately **below** the per-seat Business rate inflated by minimum-seat math, so a solo Pro user who hires their first team member naturally upgrades to Business.
- **Business at $12 / seat / mo with 5-seat min** = $60 / mo floor. That's the floor at which a small firm starts feeling like a "real" customer to us and we start recovering CSM cost. $12 is below Notion Business ($18), below Slack Business+ ($15), and well below DocuSign Business Pro ($40 / user / mo). We are a *complement* to DocuSign, not a replacement, so we cannot price like one. Yet.
- **Enterprise floor of $2,500/mo** ≈ $30K ARR. Below this, the sales overhead does not pay back. Triggers: white-label, on-prem, SSO with custom IdP, custom legal opinion, dedicated CSM, or any deal needing a security questionnaire response.

---

## 4. Why Someone Upgrades

**Free → Pro.** The trigger is **branding**, not artifacts or limits. A freelance lawyer or accountant uploads 5–10 docs in their first month, sees the Vertifile logo on every stamp, and realizes their clients see "Vertifile" not "Cohen & Associates." Pro upgrades the stamp to your own logo and colors — the same logic that gets people to upgrade Calendly, Loom, or Typeform. The 25-doc limit is the safety net trigger ("I just sent 30 contracts this month"), but branding is the real one. The 1-year audit trail is the auditor / compliance trigger when a client asks "show me the chain of custody for this filing."

**Pro → Business.** The trigger is **the second user**. The moment a Pro user says "I want my paralegal to also issue PVFs for me," they need a shared org account, shared audit log, and shared billing. The custom domain (`docs.cohen-law.com` instead of `vertifile.com/d/abc`) is the *partner-facing* trigger — a managing partner sees PVFs going out under their firm's domain and signs the PO. DMS integration (iManage, NetDocs) is the IT-facing trigger and the one that converts Liron's firm specifically.

**Business → Enterprise.** The trigger is **procurement**. Once a buyer asks for a custom MSA, security questionnaire, named CSM, or on-prem deployment, they are an Enterprise account whether or not they use any "advanced" feature. Vendor-management policy at firms above ~200 lawyers will not allow self-serve checkout for a tool that sits in the document chain of custody.

---

## 5. The Liron Test

Liron is Head of Operations at an 80-lawyer Tel Aviv firm. Under this pricing model:

- **Tier:** Business. 80 lawyers × $12/seat/mo = **$960/mo** = $11,520/yr (or $9,600/yr annual). She would actually pilot with 10 lawyers first = $120/mo, which is well within her "no procurement approval needed" threshold.
- **Fairness:** At $11K/yr she gets DMS integration with iManage (the single biggest blocker she named), custom domain (`docs.her-firm.co.il`), 7-year audit retention (longer than the Israeli Bar's record-retention requirement), the Israeli court admissibility memo, and SSO. Her CFO sees ~$144/lawyer/yr — less than half what they pay for DocuSign per seat — and the procurement math works.
- **Dealbreaker fixed?** YES on the bait-and-switch. The exact phrase she wrote — *"Free that doesn't let you download or share is not free, it's a demo. Say that on the homepage."* — is resolved. Free now genuinely lets you download, share, and verify. The homepage promise holds. The dashboard no longer paywalls personal-use actions.
- **Blockers that remain after this pricing fix** (NOT in scope for רותם — flagging for the team):
  1. SOC 2 — finance needs to budget the audit (~$40K) or publish "in progress with [auditor] targeting [date]"
  2. Named legal customer / case study — Yoav and the cold email to Wekselman is the path
  3. DevTools / right-click / screen-recording theater in the PVF viewer — Amit + Dana
  4. Truncated hash with no "show full" — Dana
  5. iManage / NetDocs connector — Tomer (Backend) — required for Business tier marketing claim
  6. The "bit-256 SHA-256 encryption" copy on the homepage — Liat (Marketing)

---

## 6. Migration Plan — Code Changes Required

For Amit (Product) and Dana (UX) to implement:

1. **Remove the `isFreePlan()` checks at `public/app.html:2241, 2247, 2255, 2261, 2961, 2970`.** Download and share are now free. The functions should run unconditionally for any logged-in user with a valid `selectedDoc` they own. Server-side ownership check stays — that's authorization, not paywall.
2. **Delete the hardcoded admin email check at `public/app.html:2946`** — `currentUser.email === 'zur2525@gmail.com' || currentUser.email === 'info@vertifile.com'`. Admin role lives server-side on the user record (`role: 'admin'` or a `plan: 'enterprise'` flag set by the DB), never in client JS. This is a CISO red-flag that Liron explicitly called out.
3. **Recontextualize the paywall modal at `public/app.html:1528-1541`.** It currently says "Upgrade to Download & Share." It should say "Upgrade for [the right reason]" — e.g., "Add your firm's logo to every stamp" (when a Pro user clicks Customize Stamp), "Share with your team" (when a Free user clicks Invite User), "Connect to iManage" (when a Free user clicks Integrations). One generic paywall for all features = bait-and-switch. Targeted paywalls per feature = honest upsell. Dana owns the modal copy + the per-feature trigger logic.
4. **Add `currentUser.plan` enforcement on the upload-count and audit-retention features only** (not on download/share). The server should rate-limit uploads at 25/mo for Free, 500/mo for Pro, etc., and surface a "limit reached" message that links to /pricing — not a paywall on the document the user already created.
5. **Update `public/index.html:1166`** — the FAQ answer for "Is it free?" — to honestly read: *"Yes. Individuals get unlimited download, share, and verification, with up to 25 documents per month and Vertifile-branded stamps. Paid plans add custom branding, larger limits, team accounts, and DMS integration."* The promise still holds but is now precise. Liat (Marketing) should write the final copy.

---

## 7. Revenue Model — One Honest Paragraph

This pricing is a bet, not a forecast. Vertifile is pre-launch, pre-revenue, with a filed (not granted) Israeli patent and a pending IANA MIME assignment. The math: at **300 paying customers** (200 Pro at $19 + 80 Business orgs at avg 8 seats × $12 + 20 Enterprise at avg $3K/mo) we hit roughly **$80K MRR / $960K ARR** — enough to cover a 4-person team and a SOC 2 audit, and justify a seed round at a defensible multiple. The fastest path to those 300 customers is 50 design-partner law/accounting firms (Business tier) acquired through targeted founder-led sales — Yoav's cold-email to Dr. Wekselman at Herzog Fox & Neeman is the prototype. Free-to-paid conversion in this category is realistically 2–4% over 12 months, so we need ~10,000 Free signups in year one to back into ~250 Pro conversions. That requires PLG on top of the founder sales motion — and PLG requires the homepage promise to be real, which is exactly what this pricing model fixes. Without the fix, every Free signup hits the paywall, churns, and the funnel is dead. With the fix, every Free signup is a real user who may eventually need branding, a team, or an integration — and that is what this pricing actually charges for.

— רותם

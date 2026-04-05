## Dashboard Spec Review
### Reviewers: Amit (Product) + Chen (Support)
### Date: 2026-04-06

---

## Amit's Review (Product)

### Verdict: NEEDS CHANGES

### Issues:

1. **Overview tab stats cards are missing the most important metric.** The three stats are "Documents Protected," "Verifications," and "Current Plan." Where is the sharing/reach metric? The whole point of Vertifile is that protected documents get verified by third parties. The user needs to see "Documents Verified by Others" or "Share Link Opens" -- something that shows their documents are being checked. Without this, the dashboard only tells half the story. The "Verifications" card is ambiguous -- does it mean verifications the user performed, or verifications others performed on the user's documents? This needs to be split or clarified.

2. **No conversion funnel from free trial to paid anywhere in the Overview tab.** The spec puts upgrade prompts in the sidebar Plan Badge and in a "subtle banner" for free trial users (line 677). Subtle does not convert. The Overview tab is where the user lands every time -- there should be a dedicated upgrade card here when they are on free trial, positioned after the stats cards, showing what they are missing. Not a dismissible banner. A persistent card with value proposition.

3. **The "Quick Action Section" (line 209) is too simple.** It only offers "Upload Document." For returning users who already have documents, the most useful quick actions would be: "Share Last Document," "View Recent Verification," or "Check Verification Status." A single upload button is a first-time action. Returning users need returning-user actions. This section should be context-aware: zero documents = upload CTA, 1+ documents = a row of 2-3 contextual quick actions.

4. **No activity feed or timeline.** The "Recent Documents" section (line 225) only shows files. There is no log of what happened -- who verified what, when a share link was opened, when a document was downloaded. This is critical for business and enterprise users who need audit trails. Add an "Activity" sub-section or card below Recent Documents.

5. **Documents tab is missing a "Shared With Me" concept.** The entire Documents tab (Tab 3) treats the user as only a document creator. But Vertifile is a two-sided system -- someone uploads and protects, someone else verifies. Where do received/verified documents appear? Even if this is V2, the architecture needs a placeholder or the nav will need restructuring later.

6. **Stamp tab has no connection to the conversion funnel.** The stamp is the emotional hook from onboarding. When a user customizes their stamp, this is the moment to show them the stamp ON a real document they uploaded. If they have zero documents, show a sample. If they have one, show it applied. The current spec (line 436) treats the stamp tab as a standalone customization tool. It should end with a CTA: "See your stamp on a real document -- upload now" or "Preview stamp on [last uploaded doc]."

7. **Help tab FAQ is static (line 576).** Eight hardcoded questions will not scale and will become stale. This should pull from a CMS or at minimum have a "Was this helpful?" feedback mechanism and a "Didn't find what you need?" escalation path that is more prominent than the contact form buried below.

8. **No onboarding progress or "setup completion" indicator.** After onboarding, the user lands on the dashboard. But did they upload their first document? Did they share it? Did someone verify it? There should be a "Getting Started" checklist card on the Overview tab (dismissible after completion) that tracks: (a) Upload first document, (b) Customize stamp, (c) Share a document, (d) First external verification. This is the single most important retention mechanism for week-1 users.

9. **Analytics events (line 792) are missing critical funnel events.** No event for: share link opened by recipient, verification performed by third party, upgrade banner dismissed, getting-started step completed. These are the events that tell us if the product is working.

10. **Mobile bottom nav drops Help into Settings (line 618).** This is wrong. Help is the one thing a confused mobile user needs fast access to. Dropping it into a Settings sub-section guarantees support tickets. Either keep Help visible or add a floating help button on mobile.

### Missing Features:

- **Getting Started checklist** (post-onboarding, on Overview tab) -- this is the #1 missing feature for retention
- **Activity feed / audit log** -- critical for business users
- **Contextual quick actions** for returning users on Overview
- **Upgrade card** (not banner) on Overview for free trial users
- **"Shared With Me" or "Received Documents" section** -- even as a coming-soon placeholder
- **Stamp-to-document preview connection** on the Stamp tab
- **Search across all tabs** -- the search bar says "Search documents..." but what about searching settings, help, etc.?
- **Keyboard shortcuts** -- power users (legal, finance) will want them. At minimum Cmd/Ctrl+U for upload, Cmd/Ctrl+K for search.

### What's Great:

- The onboarding-to-dashboard handoff is well thought out. The `?onboarding=complete` parameter, first-time vs. returning headings, and "Account setup complete" toast (line 855) are exactly right.
- Industry-specific tips (line 265) are a strong personalization play. The per-industry content shows the user we understand their world.
- The Plan Badge in the sidebar (line 152) with progress bar is clean and non-intrusive. Good placement.
- RTL support (line 719) being baked in from the start rather than bolted on later is the correct decision. The progress-bars-stay-LTR decision from onboarding Round 13 is referenced and carried through.
- The dark/light mode implementation via CSS custom properties (line 715) is clean and maintainable.
- Analytics events are a good foundation -- just need the funnel-critical additions noted above.
- Accessibility section (line 778) is thorough. Skip links, aria-live on toasts, prefers-reduced-motion -- all correct.
- The decision to evolve from app.html rather than rebuild (Implementation Note 1, line 851) is pragmatic and correct.

---

## Chen's Review (Support)

### Verdict: NEEDS CHANGES

### Issues:

1. **The "Pending" status (line 237, 378) is unexplained.** The document list shows "Verified" or "Pending" badges, but the spec never defines what "Pending" means from the user's perspective. Is it processing? Waiting for something? How long will it take? Users WILL contact support asking "my document says Pending, what do I do?" Every "Pending" badge needs a tooltip explaining: "Your document is being processed. This usually takes less than X minutes." And if it stays pending beyond a threshold, there needs to be an error path.

2. **No error state for failed uploads.** The Upload tab (Tab 2, line 285) describes progress stages: "Uploading...", "Processing...", "Generating PVF...", "Complete." But what happens when it fails? Network timeout, file too large (after selection but server rejects), unsupported format that slipped past client validation, server error during PVF generation. The spec has a cancel button (line 313) but no failure state. This WILL generate support tickets. Need: error message with specific reason, retry button, and "Contact Support" link for persistent failures.

3. **The Upload Limit Warning (line 323) appears after the user already tried to upload.** This is the wrong moment. If a user is at their limit, the warning should appear BEFORE they select a file -- ideally the upload zone itself should change state when they are at or near the limit. Imagine: user drags a file, waits for upload, and THEN gets told they cannot. That is a terrible experience. Show the limit status inline in the upload zone header.

4. **Delete confirmation is missing from the spec.** The Documents tab (line 353) has a "Delete" button in bulk actions and "Delete" in the three-dot menu (line 381). But there is no confirmation dialog specified. Users will accidentally delete documents. The spec needs: confirmation modal with document name(s), a warning about irreversibility, and ideally a 30-day trash/recovery period rather than hard delete.

5. **Settings > Change Password (line 527) has no guidance on requirements.** What are the password rules? Minimum length, special characters? If there are requirements, they need to be shown inline before the user types. Otherwise: support ticket for every "password not accepted" error. Also missing: password strength indicator.

6. **Settings > Delete Account (line 555) needs a multi-step confirmation.** A single confirmation modal is not enough for an action that destroys all documents. This should require: (a) type "DELETE" or account email, (b) re-enter password, (c) show count of documents that will be lost, (d) offer data export before deletion. This is an area where we will get complaints and possibly legal issues if someone accidentally deletes.

7. **Notification types (line 108) are too limited.** Four types: document verified, document shared, plan limit approaching, system update. Missing: upload failed (if async), document viewed by someone, share link expired, account security alerts (new login, password changed). Users need to know when someone opens their shared documents -- that is core to the value proposition.

8. **The Help tab contact form (line 591) has no category/subject dropdown.** Users will type vague messages like "it doesn't work." Adding a subject dropdown (Bug Report, Billing Question, Feature Request, Document Issue, Account Issue, Other) helps both the user articulate their problem and our support team triage faster.

9. **No loading failure states specified.** Implementation Note 5 (line 859) mentions skeleton loaders, and Note 6 (line 861) mentions inline banners for network errors. But what does the inline banner say? What can the user do? "Something went wrong" is not helpful. Each error state needs: (a) what happened in plain language, (b) what the user can try (refresh, check connection), (c) a support contact if it persists.

10. **Swipe gestures on mobile (line 649) will conflict with normal scrolling.** Users will accidentally swipe between tabs when they meant to scroll horizontally in the document list (which the spec says has horizontal scroll on mobile, line 646). These two behaviors will clash. Either disable horizontal swipe navigation on the Documents tab, or use a more deliberate gesture (swipe from edge only).

### User Confusion Risks:

- **"New Document" button appears in TWO places**: top bar (line 89) and sidebar (line 121). Both say "New Document" / "Upload." Users will not know the difference (there is none). This is confusing and wastes space. Recommendation: keep only the top bar button (always visible), remove the sidebar duplicate. Use the sidebar space for something else -- like the Getting Started checklist Amit requested.
- **Search bar also appears twice**: top bar (line 88) and Documents toolbar (line 341). Users will not know which to use. The top bar search should be global (searching all tabs), and the Documents toolbar search should be document-specific. If they both search only documents, remove one.
- **"Stamp" tab name is jargon.** New users who did not pay attention during onboarding will not know what "Stamp" means. Consider "Branding" or "My Stamp" with a tooltip on first visit: "Your Vertifile stamp appears on every protected document."
- **Tab 1 shows "Recent Documents" but Tab 3 is called "Documents."** Clicking "View All" in Overview (line 226) presumably goes to Tab 3. But is this obvious? The link text "View All" is generic. Make it "View All Documents" so users know where they are going.
- **Plan & Billing in Settings (line 531) vs. Plan Badge in sidebar (line 152) vs. upgrade banners** -- three separate places showing plan information. Users will not know which is the "real" one. The sidebar badge should link directly to the Settings > Plan & Billing section.
- **What happens when a user clicks the logo (line 87)?** It links to `/dashboard`. But if they are already on the dashboard, does it reset to the Overview tab? This should be specified. If it does nothing, users will feel the UI is broken.

### What's Great:

- The industry tips section (line 265) is excellent for support deflection. If users see relevant tips, they are less likely to contact us asking "what should I do first?"
- The toast notification for stamp save (line 498) is a good pattern. Users need confirmation that their action worked. I would like to see this pattern applied everywhere -- profile save, password change, document delete, settings update.
- The FAQ section (line 566) covers the right initial questions. Question 5 ("What happens if someone alters a protected document?") is the most important one -- make sure it is the first FAQ, not the fifth, because that is the core value proposition.
- Skeleton loaders (line 859) instead of blank screens are the right call. Blank screens always generate "is it broken?" support tickets.
- The `aria-live="polite"` on status messages (line 788) means screen reader users will not miss upload progress updates. Good accessibility thinking.
- RTL support being comprehensive and tested means our Israeli user base will not hit layout issues. The font switching to Heebo for Hebrew (line 739) is the correct choice.

---

## Combined Required Changes (Must-Fix Before Dana Builds):

1. **Add a "Getting Started" checklist card to the Overview tab.** Four items: upload first document, customize stamp, share a document, first external verification. Dismissible after all complete. This is the single highest-impact retention feature missing from the spec.

2. **Define error states for upload failures.** The Upload tab needs: failure message with reason, retry button, and support link. The spec currently only has the happy path.

3. **Add delete confirmation dialogs.** Both single-document delete (three-dot menu) and bulk delete need confirmation modals with document names, irreversibility warning, and document count.

4. **Add tooltips to "Pending" status badges everywhere they appear.** Explain what pending means, how long it takes, and what to do if it is stuck.

5. **Move the upload limit warning to BEFORE file selection, not after.** Show remaining quota inline in the upload zone. Disable the upload zone entirely when at limit (with upgrade CTA).

6. **Remove the duplicate "New Document" button from the sidebar.** Keep the top bar version only. Use the freed sidebar space for the Getting Started checklist or activity summary.

7. **Add an upgrade card (not dismissible banner) to the Overview tab for free trial users.** Show what features they are missing and documents remaining. This is a conversion-critical element.

8. **Strengthen the Delete Account flow.** Add: type-to-confirm, re-enter password, show document count that will be lost, offer data export.

9. **Add notification types: upload failed, document viewed by recipient, share link expired, security alerts.**

10. **Fix mobile swipe gesture conflict** with horizontal scroll in the Documents tab. Disable swipe navigation on tabs that have horizontal scrollable content, or restrict to edge swipes only.

---

## Combined Recommendations (Nice-to-Have):

1. **Activity feed / audit log card on Overview** -- "Document X was verified by someone on [date]," "Share link for Y was opened 3 times." Critical for business users, but can be V1.1.

2. **Context-aware quick actions on Overview** -- upload for new users, share/verify shortcuts for returning users.

3. **Help tab: add subject dropdown** to contact form (Bug Report, Billing, Feature Request, Document Issue, Account Issue, Other).

4. **Help tab: add "Was this helpful?" to FAQs** and move Question 5 ("What happens if someone alters...") to position 1.

5. **Loading error banners should include specific guidance** -- not just "something went wrong" but "Check your connection and try refreshing. If the problem continues, contact support@vertifile.com."

6. **Stamp tab should show stamp applied to a real/sample document** at the end of customization, with CTA to upload if no documents exist.

7. **Add password strength indicator and inline requirements** to the Change Password section.

8. **Analytics: add events for** share_link_opened, verification_by_third_party, upgrade_banner_dismissed, getting_started_step_completed, document_delete_confirmed.

9. **Mobile: keep Help accessible** -- either in bottom nav or as a floating help icon, not buried in Settings.

10. **Sidebar Plan Badge should be clickable** and link to Settings > Plan & Billing.

11. **Logo click behavior** should be specified: if already on dashboard, reset to Overview tab and scroll to top.

12. **Keyboard shortcuts** for power users: Cmd/Ctrl+U (upload), Cmd/Ctrl+K (search), Cmd/Ctrl+1-6 (tab switching).

---

### Summary for Dana:

The spec is thorough on visual design, layout, and styling -- that work is excellent and the dark/light mode system, RTL support, and accessibility section are all strong. The gaps are primarily in **user flows** (error states, edge cases, confirmation dialogs) and **product strategy** (retention mechanics, conversion funnel, contextual actions for returning users). The 10 required changes above should be addressed before build begins. Everything else can be iterated on post-launch.

-- Amit & Chen

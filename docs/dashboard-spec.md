# Dashboard — Design Spec

**Date:** 2026-04-05
**Author:** Dana (UX Design)
**Status:** Revised (R2) — Addressing Amit + Chen Review
**Revision:** R2, 2026-04-05 — see Revision History at bottom
**Prerequisite:** Onboarding wizard complete (onboarding-spec.md, Step 6 redirects here)
**Entry URL:** `/dashboard` or `/dashboard?onboarding=complete` (first-time users)

---

## Design System Reference

All dashboard components inherit the established Vertifile design system:

| Token | Value | Usage |
|---|---|---|
| Font Family (LTR) | `'Inter', sans-serif` | All text |
| Font Family (RTL) | `'Heebo', 'Inter', sans-serif` | Hebrew/Arabic |
| Primary Gradient | `linear-gradient(135deg, #4f46e5, #7c3aed)` | CTAs, active states, highlights |
| Purple Primary | `#7c3aed` | Borders, accents, active indicators |
| Purple Light | `#a78bfa` | Secondary text, subtle accents |
| Purple Faint | `rgba(124, 58, 237, .08)` | Hover backgrounds, badge fills |
| Dark Base | `#0f0e17` | App background (dark mode) |
| Dark Surface | `#1a1830` | Sidebar, cards, panels |
| Dark Elevated | `rgba(26, 24, 48, .5)` | Card backgrounds with blur |
| Text Primary (dark) | `#e2e0f0` | Headings, body text |
| Text Secondary (dark) | `#8b89a6` | Labels, hints, muted text |
| Light Base | `#ffffff` | App background (light mode) |
| Light Surface | `#f9fafb` | Content area background |
| Text Primary (light) | `#111827` | Headings, body text |
| Text Secondary (light) | `#6b7280` | Labels, hints, muted text |
| Border Dark | `rgba(124, 58, 237, .1)` | Dividers, card borders |
| Border Light | `rgba(0, 0, 0, .06)` | Dividers, card borders |
| Card Style | `backdrop-filter: blur(10px); border-radius: 14px; border: 1px solid` | Glassmorphism cards |
| Shadow (dark) | `0 2px 8px rgba(0, 0, 0, .2)` | Cards |
| Shadow (light) | `0 2px 8px rgba(0, 0, 0, .06)` | Cards |
| Radius Large | `14px` | Cards, panels |
| Radius Medium | `12px` | Buttons, inputs |
| Radius Small | `10px` | Nav items, tags |
| Success | `#16a34a` | Verified status |
| Error | `#dc2626` | Unverified, errors |
| Warning | `#f59e0b` | Starred items, alerts |
| Transition Default | `all .2s ease` | Hover, focus, state changes |

---

## Architecture Overview

```
+--------------------------------------------------------------+
|  Top Bar (60px, fixed, full-width, z-index: 100)             |
|  [hamburger] [logo] [search] [upload] [theme] [bell] [avatar]|
+----------+---------------------------------------------------+
|          |                                                    |
| Sidebar  |   Main Content Area                               |
| (240px)  |   (flex: 1, overflow-y: auto)                     |
|          |                                                    |
| [Upload] |   Content changes per active tab                  |
| -------- |                                                    |
| Overview |   Padding: 32px                                   |
| Upload   |   Max-width: 1200px (centered)                    |
| Docs     |                                                    |
| Stamp    |                                                    |
| Settings |                                                    |
| Help     |                                                    |
| -------- |                                                    |
| [Plan]   |                                                    |
|          |                                                    |
+----------+---------------------------------------------------+
```

---

## Top Bar

Height: `60px`. Position: `fixed`, top 0, full-width, `z-index: 100`.

Background (dark): `rgba(15, 14, 23, .95)` with `backdrop-filter: blur(10px)`.
Background (light): `rgba(255, 255, 255, .92)` with `backdrop-filter: blur(16px)`.
Border bottom: `1px solid rgba(124, 58, 237, .1)`.

### Layout (left to right)

| Element | Width | Description |
|---|---|---|
| Hamburger (mobile only) | 34px | Three-line icon, toggles sidebar. Hidden above 768px. |
| Logo | 200px min-width | Vertifile logo, `height: 24px`. Links to `/dashboard`. **(R2)** If already on dashboard: resets to Overview tab (Tab 1) and scrolls to top. Does NOT reload the page. This prevents the "nothing happened" feeling when clicking the logo while already on the dashboard. |
| Search Bar | flex: 1, max-width: 480px | Centered. `padding: 9px 16px 9px 40px`. Magnifying glass icon at 12px left. Placeholder: "Search Vertifile..." **(R2: changed from "Search documents..." to indicate global scope)**. This is the **global search** -- it searches across documents (name, type), help articles, and settings sections. Results appear in a dropdown below the search bar, grouped by category: "Documents", "Help", "Settings". Keyboard shortcut: `Cmd/Ctrl+K` focuses this search bar. |
| New Document Button | auto | Purple gradient button. Icon: `+`. Text: "New Document" (hidden on mobile, icon only). `padding: 8px 16px`, `border-radius: 10px`, `font-size: 13px`, `font-weight: 600`. |
| Theme Toggle | 34px | Sun/moon icon. `border: 1px solid rgba(124, 58, 237, .15)`, `border-radius: 10px`, `padding: 7px 10px`. |
| Notifications Bell | 34px | Bell icon with red dot indicator for unread. Same border style as theme toggle. Click opens dropdown (max 5 recent notifications). |
| User Menu | auto | Avatar circle (34x34px, purple gradient, white initials `font-size: 13px; font-weight: 700`) + name (13px, hidden mobile). Click opens dropdown: Profile, Settings, Log Out. |

### Notifications Dropdown

Position: absolute, below bell icon. Width: `320px`. Max-height: `400px`, overflow-y scroll.
Background: `#1a1830` (dark) / `#fff` (light). Border radius: `12px`. Shadow: `0 8px 32px rgba(0, 0, 0, .5)`.

Each notification item:
- Padding: `12px 16px`
- Icon left (16px, type-colored)
- Title: 13px, font-weight 600
- Body: 12px, secondary color
- Timestamp: 11px, secondary color, right-aligned
- Unread: left border `3px solid #7c3aed`
- Hover: `rgba(124, 58, 237, .04)` background

Notification types (R2 -- Expanded):
- Document verified (by third party)
- Document shared (share link created)
- Plan limit approaching (80% usage)
- System update
- **(R2)** Upload failed (if async processing fails after user left the page)
- **(R2)** Document viewed by recipient (share link was opened)
- **(R2)** Share link expired
- **(R2)** Security alert: new login from unrecognized device
- **(R2)** Security alert: password changed

---

## Sidebar

Width: `240px`. Background: `#1a1830` (dark) / `#f3f0ff` (light).
Border right: `1px solid rgba(124, 58, 237, .1)`.
Display: flex, column. Padding: `16px 12px`. Overflow-y: auto.
Transition: `transform .3s` (for mobile slide-in).

### ~~Upload Button (top of sidebar)~~ -- REMOVED (R2)

**(R2):** The sidebar "New Document" button has been removed. The top bar already has a "New Document" button that is always visible. Having two identical upload buttons (sidebar + top bar) confused users -- there was no functional difference between them. The freed sidebar space is now used by the Getting Started checklist summary (for new users) or the Activity Feed summary (for business users). See "Sidebar Quick Summary" below.

### Sidebar Quick Summary (R2 -- New)

Occupies the space where the sidebar Upload button used to be. Padding: `12px`. Margin-bottom: `8px`.

**For users with an active Getting Started checklist:** Shows a compact progress indicator:
- "Getting Started: {n}/4" -- `12px`, weight `600`, color `#a78bfa`
- Mini progress bar (same style as Plan Badge progress bar)
- Click navigates to Overview tab, scrolls to checklist

**For business users (checklist complete):** Shows a compact activity summary:
- "Recent: {last_event_description}" -- `12px`, weight `500`, color `#8b89a6`, truncated
- Click navigates to Overview tab Activity Feed

**For all other users (checklist complete, not business):** Space is simply removed (nav items move up).

### Navigation Items

Each nav item:
- Display: flex, align-items: center, gap: 10px
- Padding: `10px 12px`
- Border-radius: `10px`
- Font: `13px`, weight `500`
- Color default: `#8b89a6`
- Border-left: `3px solid transparent`
- Margin-bottom: `2px`
- Hover: background `rgba(124, 58, 237, .06)`, color `#e2e0f0`
- Active: background `rgba(124, 58, 237, .1)`, color `#a78bfa`, weight `600`, border-left `#7c3aed`
- Icon: 16px, width: 20px centered

| # | Tab | Icon | Badge |
|---|---|---|---|
| 1 | Overview | Home/grid icon | -- |
| 2 | Upload | Upload/cloud icon | -- |
| 3 | Documents | File/stack icon | Count of documents (e.g., "12") |
| 4 | My Stamp | Stamp/seal icon | -- | **(R2)** Renamed from "Stamp" to "My Stamp" for clarity. On first visit to this tab, show a tooltip: "Your Vertifile stamp appears on every protected document. Customize it here." Tooltip dismisses on click or after 5s. Stored in localStorage so it only shows once. |
| 5 | Settings | Gear icon | -- |
| 6 | Help | Question-circle icon | -- |

### Divider

Between main nav and bottom section: `height: 1px; background: rgba(124, 58, 237, .08); margin: 8px 12px`.

### Plan Badge (bottom of sidebar, margin-top: auto)

Container: `padding: 14px`. Background: `rgba(26, 24, 48, .5)`. Backdrop-filter blur. Border-radius: `14px`. Border: `1px solid rgba(124, 58, 237, .1)`.

- Plan label: `11px`, weight `700`, color `#a78bfa`, uppercase, letter-spacing `.8px`. E.g., "PRO PLAN"
- Usage: `12px`, color `#8b89a6`. E.g., "23 of 100 documents used"
- Progress bar: `height: 4px`, background `rgba(124, 58, 237, .15)`, fill gradient `linear-gradient(90deg, #4f46e5, #7c3aed)`, border-radius `2px`
- Upgrade link (if applicable): `12px`, color `#a78bfa`, weight `500`. "Upgrade Plan"
- **(R2)** The entire Plan Badge card is clickable (`cursor: pointer`). Clicking navigates to Settings > Plan & Billing section (Tab 5, scrolled to the Plan & Billing card). Hover: subtle background lighten `rgba(124, 58, 237, .04)`. This eliminates confusion about where the "real" plan information lives -- sidebar badge, settings, and upgrade banners all lead to the same destination.

---

## Tab 1: Overview (Default)

This is the landing tab after onboarding. Shows personalized welcome, stats, quick actions, recent activity, and stamp preview.

### First-Time vs Returning

- First-time (`?onboarding=complete`): Heading reads **"Welcome to Vertifile, [First Name]"**
- Returning: Heading reads **"Welcome back, [First Name]"**

Heading: `font-size: 28px; font-weight: 800; color: #e2e0f0`. Below heading: current date, `font-size: 13px; color: #8b89a6`.

### Stats Cards Row

Layout: CSS grid, `grid-template-columns: repeat(4, 1fr)`, gap: `20px`.
On tablet (<1024px): `repeat(2, 1fr)`. On mobile (<768px): `1fr` (stacked).

Each card:
- Background: `rgba(26, 24, 48, .5)` (dark) / `#fff` (light)
- Backdrop-filter: `blur(10px)`
- Border: `1px solid rgba(124, 58, 237, .1)`
- Border-radius: `14px`
- Padding: `24px`
- Shadow: `0 2px 8px rgba(0, 0, 0, .2)`

Card anatomy:
```
+----------------------------------+
|  [icon circle]                   |
|                                  |
|  Label (11px, #8b89a6, upper)    |
|  Value (32px, 800 weight,        |
|         gradient text clip)      |
|  Subtitle (12px, #8b89a6)        |
+----------------------------------+
```

Icon circle: `40px`, border-radius 50%, background `rgba(124, 58, 237, .08)`, icon `20px` inside.

| Card | Icon | Label | Value | Subtitle |
|---|---|---|---|---|
| Documents Protected | Shield icon | DOCUMENTS PROTECTED | `{count}` | "+{n} this week" or "Upload your first" |
| Verified by Others | Eye/check icon | VERIFIED BY OTHERS | `{count}` | "Last: {date}" or "Share a document to start" |
| Share Link Opens | Link-external icon | SHARE LINK OPENS | `{count}` | "+{n} this week" or "No shares yet" |
| Current Plan | Crown icon | YOUR PLAN | Plan name (e.g., "Pro") | "{used}/{limit} documents this month" |

**Clarification (R2):** The old "Verifications" card was ambiguous -- it was unclear whether it counted verifications the user performed or verifications others performed on the user's documents. It has been replaced by two specific cards: "Verified by Others" (third-party verifications of the user's documents) and "Share Link Opens" (how many times share links were accessed). These tell the full story of document reach and are the core value metrics of Vertifile.

Value styling: `font-size: 32px; font-weight: 800; background: linear-gradient(135deg, #4f46e5, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent`.

### Getting Started Checklist (R2 -- New)

**Visibility:** Shown on Overview tab for users who have not completed all four steps. Appears directly below Stats Cards, above Quick Actions. Dismissible only after all four items are marked complete -- then shows a "You're all set!" state with a dismiss button.

**Persistence:** Checklist completion state stored in `user_profiles.onboarding_checklist` (server-side, not localStorage) so it persists across devices.

Card style: glassmorphism card matching other Overview cards. Padding: `24px`. Border-left: `3px solid #7c3aed` (accent to draw attention).

Heading: "Getting Started" -- `16px`, weight `700`, color `#e2e0f0`. Subtitle: "Complete these steps to get the most out of Vertifile" -- `13px`, color `#8b89a6`.

```
+-------------------------------------------------------+
|  Getting Started                                       |
|  Complete these steps to get the most out of Vertifile |
|                                                        |
|  [x] Upload your first document        [Upload ->]    |
|  [ ] Customize your stamp              [Customize ->]  |
|  [ ] Share a document                  [Share ->]      |
|  [ ] First external verification       [Waiting...]   |
|                                                        |
|  Progress: 1 of 4 complete  [====------] 25%          |
+-------------------------------------------------------+
```

Each checklist item:
- Display: flex, align-items: center, gap: `12px`
- Padding: `10px 0`
- Border-bottom: `1px solid rgba(124, 58, 237, .04)` (except last)
- Checkbox: `20x20px`, `border-radius: 6px`, checked = purple fill + white checkmark. Unchecked = border `1px solid rgba(124, 58, 237, .2)`.
- Label: `14px`, weight `500`. Completed items: strikethrough, color `#8b89a6`.
- Action link: right-aligned, `13px`, color `#a78bfa`, weight `500`. Navigates to the relevant tab or triggers the relevant action.

| Step | Label | Action Link | Auto-completes when |
|---|---|---|---|
| 1 | Upload your first document | "Upload" -> Tab 2 | First `document_uploaded` event |
| 2 | Customize your stamp | "Customize" -> Tab 4 | First `stamp_customized` event |
| 3 | Share a document | "Share" -> Tab 3, opens share flow on most recent doc | First `document_shared` event |
| 4 | First external verification | "Waiting..." (no link, this happens organically) | First `verification_by_third_party` event |

Progress bar: full-width below items. Same style as Plan Badge progress bar. Fills by 25% per completed step.

**All-complete state:** Heading changes to "You're all set!" with confetti icon. Body: "You've completed the basics. Time to protect more documents." Dismiss button: "Got it" -- `13px`, secondary style. After dismiss, checklist card is hidden permanently.

### Upgrade Card -- Free Trial Users (R2 -- New)

**Visibility:** Shown on Overview tab for free-trial users only. Appears below Getting Started checklist (or below Stats Cards if checklist is dismissed). NOT dismissible -- this is a conversion-critical element.

Card style: glassmorphism card with subtle purple gradient left border (`3px solid`, purple gradient). Padding: `24px`.

```
+-------------------------------------------------------+
|  Unlock the full power of Vertifile           [crown]  |
|                                                        |
|  Your free trial has {n} days remaining.               |
|  You've used {used} of {limit} documents.              |
|                                                        |
|  What you're missing:                                  |
|  [x] Unlimited document protection                     |
|  [x] Custom branding & stamp                           |
|  [x] Priority verification processing                  |
|  [x] Bulk download & API access                        |
|                                                        |
|  [ Upgrade to Pro -- $X/mo ]  (purple gradient btn)    |
|  "or compare all plans" (text link)                    |
+-------------------------------------------------------+
```

- Heading: `18px`, weight `700`, color `#e2e0f0`. Crown icon right-aligned, `24px`, color `#f59e0b`.
- Trial remaining: `14px`, weight `600`. Days < 7: text turns `#dc2626`.
- Usage: `13px`, color `#8b89a6`. Progress bar below (same style as Plan Badge).
- Feature list: `13px`, weight `500`, color `#e2e0f0`. Checkmark icons in `#16a34a`.
- CTA button: purple gradient, `padding: 12px 24px`, `border-radius: 12px`, `font-size: 14px`, weight `700`.
- Compare link: below button, `13px`, color `#a78bfa`.

### Quick Action Section (R2 -- Revised)

Below Upgrade Card (or below Getting Started checklist for paid users). **Context-aware** -- shows different actions based on user state.

**Zero documents (new user):**
Single large "Upload Document" button (same as original spec):
- Padding: `16px 32px`
- Background: purple gradient
- Color: white
- Border-radius: `14px`
- Font: `16px`, weight `700`
- Icon: upload cloud, 20px, gap `10px`
- Hover: `box-shadow: 0 6px 24px rgba(124, 58, 237, .4); transform: translateY(-2px)`
- Width: auto (desktop), 100% (mobile)

**1+ documents (returning user):**
Row of 3 action cards. Layout: CSS grid, `grid-template-columns: repeat(3, 1fr)`, gap: `12px`. On mobile: stack to `1fr`.

Each action card:
- Glassmorphism card style, `padding: 16px`
- Icon: `24px`, color `#a78bfa`
- Label: `13px`, weight `600`, color `#e2e0f0`
- Hover: standard card hover lift

| Action | Icon | Label | Behavior |
|---|---|---|---|
| Upload New | Upload cloud icon | "Upload Document" | Navigate to Tab 2 |
| Share Last | Share/link icon | "Share Last Document" | Open share flow for most recent document |
| Check Status | Eye icon | "Check Verification Status" | Navigate to Tab 3, filtered to Pending documents |

### Recent Documents

Section heading: "Recent Documents" -- `font-size: 16px; font-weight: 700; color: #e2e0f0`. Right side: "View All Documents" link (R2: changed from generic "View All" for clarity), `13px; color: #a78bfa; font-weight: 500`. Clicking navigates to Tab 3 (Documents).

List of last 5 protected files. Each row:
- Height: `50px`
- Display: flex, align-items: center, gap: `10px`
- Padding: `10px 16px`
- Border-bottom: `1px solid rgba(124, 58, 237, .04)`
- Hover: background `rgba(124, 58, 237, .04)`

Row elements:
- File type icon: `30x30px`, border-radius `8px`, type-colored background (PDF red, image blue, text green, other gray)
- File name: `13px`, weight `600`, color `#e2e0f0`, truncate with ellipsis
- Status badge: `12px`, weight `600`. Verified = `#16a34a` + checkmark. Pending = `#f59e0b` + clock. **(R2)** Same tooltip and stuck-pending behavior as Documents tab (see Tab 3 status column spec).
- Date: `12px`, color `#8b89a6`, right-aligned, `80px` width
- Size: `12px`, color `#8b89a6`, right-aligned, `60px` width

Empty state (no documents yet):
```
+------------------------------------------+
|              [document icon, 56px, .4 opacity]
|                                          |
|     "No documents yet"                   |
|     (18px, 600, #e2e0f0)                 |
|                                          |
|     "Upload your first document to       |
|      start protecting it."               |
|     (13px, #8b89a6, max-width 300px)     |
|                                          |
|     [ Upload Document ] (purple btn)     |
+------------------------------------------+
```

### Stamp Preview Section

Card with heading "Your Vertifile Stamp" — `font-size: 16px; font-weight: 700`.

Contains a miniature animated stamp component (same SVG/CSS as onboarding Step 5 and app.html branding section) rendered at `120x120px`. Shows the user's customized accent color, wave color, and logo. The holographic wave animation plays continuously. Below stamp: "Customize" link, `13px; color: #a78bfa`.

Card dimensions: auto height, same glassmorphism style as other cards.

### Activity Feed (R2 -- New)

**Visibility:** Shown for Business and Enterprise users. For Private (free/pro) users, show a teaser card: "Activity Feed available on Business plan. Track who verified and viewed your documents. [Upgrade]"

Section heading: "Recent Activity" -- `font-size: 16px; font-weight: 700; color: #e2e0f0`. Right side: "View All Activity" link, `13px; color: #a78bfa; font-weight: 500`.

Card style: glassmorphism card matching other Overview cards. Padding: `20px`.

Shows last 10 activity events in reverse chronological order. Each event:
- Display: flex, align-items: start, gap: `12px`
- Padding: `10px 0`
- Border-bottom: `1px solid rgba(124, 58, 237, .04)` (except last)

Event anatomy:
```
[icon circle 32px]  Event description (13px, #e2e0f0)
                    Timestamp (12px, #8b89a6) -- "2 hours ago" or "Apr 5, 2026, 3:22 PM"
```

Icon circle: `32px`, border-radius 50%, background varies by event type.

| Event Type | Icon | Background | Description Example |
|---|---|---|---|
| Document verified | Check-circle | `rgba(22, 163, 74, .1)` | "Contract_v2.pdf was verified by a third party" |
| Share link opened | Eye | `rgba(124, 58, 237, .1)` | "Share link for Invoice_March.pdf was opened" |
| Document uploaded | Upload | `rgba(59, 130, 246, .1)` | "You uploaded NDA_Final.pdf" |
| Document shared | Link | `rgba(234, 88, 12, .1)` | "You shared Agreement_2026.pdf" |
| Share link expired | Clock-x | `rgba(245, 158, 11, .1)` | "Share link for Report_Q1.pdf expired" |
| Team member action | User | `rgba(124, 58, 237, .1)` | "Sarah verified Budget_2026.xlsx" (Enterprise only) |

Empty state: "No activity yet. Upload and share a document to see activity here." -- `13px`, color `#8b89a6`, centered, `padding: 24px`.

**API:** Requires new endpoint `GET /api/activity?limit=10&offset=0` (see API Endpoints section).

### Industry Tips Section

Card with heading "Tips for [Industry]" — e.g., "Tips for Legal".

Content varies based on `user_profiles.industry` from onboarding:

| Industry | Tip |
|---|---|
| Legal | "Protect contracts and agreements before sending to clients. A verified document carries more weight in court." |
| Healthcare | "Medical records require tamper-proof verification. Protect patient documents to maintain compliance." |
| Education | "Diplomas and transcripts are high-value targets for forgery. Protect them at the source." |
| Finance | "Financial reports and invoices need chain-of-custody proof. Verify every document before sharing." |
| HR | "Employment letters and offer documents should be verifiable. Protect them to prevent fraud." |
| Government | "Government-issued documents require the highest level of verification integrity." |
| Other | "Protect any document type -- contracts, certificates, reports, and more." |

Card anatomy: icon left (24px, purple tint), tip text right (`13px`, line-height `1.6`), dismissible (X button, top-right). If dismissed, save to localStorage. Show one tip at a time, rotate daily.

---

## Tab 2: Upload

Integrates the existing upload flow from `app.html` into the dashboard context. The upload zone and processing pipeline remain identical; they are now contained within the main content area rather than a modal overlay.

### Layout

Full-width content area. Centered card, max-width `560px`.

### Upload Zone

Matches existing `app.html` upload zone:
- Border: `2px dashed rgba(124, 58, 237, .2)`
- Border-radius: `14px`
- Padding: `48px 24px`
- Text-align: center
- Cursor: pointer
- Hover/dragover: border-color `#7c3aed`, background `rgba(124, 58, 237, .04)`

Icon: upload cloud, `40px`, color `#8b89a6`.
Primary text: "Drag & drop your file here" — `14px`, weight `500`, color `#e2e0f0`.
Hint: "or click to browse. PDF, images, text files accepted. Max 50MB." — `12px`, color `#8b89a6`.

### Upload Quota Status (R2 -- Revised, moved BEFORE upload zone)

**Design principle (R2):** The user must know their quota status BEFORE attempting an upload, not after. Showing a limit error after the user has already dragged a file and waited is a terrible experience.

Displayed inline at the top of the Upload tab, above the upload zone. Always visible when quota is relevant.

**State: Plenty of room (< 80% usage):**
- Subtle info row: `font-size: 12px`, color `#8b89a6`. "{used} of {limit} documents used this month."
- No special styling. Just informational.

**State: Approaching limit (80-99% usage):**
- Warning-tinted card: `background: rgba(245, 158, 11, .08); border: 1px solid rgba(245, 158, 11, .2); border-radius: 10px; padding: 12px`.
- Icon: warning triangle, `16px`, color `#f59e0b`.
- Text: "You have {remaining} documents remaining this month. Consider upgrading for unlimited uploads." -- `13px`, weight `500`.
- CTA: "Upgrade Plan" (secondary button style, not primary -- not blocking the upload).

**State: At limit (100% usage):**
- Error-tinted card: `background: rgba(220, 38, 38, .08); border: 1px solid rgba(220, 38, 38, .2); border-radius: 10px; padding: 16px`.
- Icon: x-circle, `20px`, color `#dc2626`.
- Heading: "Upload limit reached" -- `14px`, weight `700`, color `#dc2626`.
- Text: "You've used all {limit} documents for this month. Upgrade your plan to continue protecting documents." -- `13px`, color `#8b89a6`.
- CTA: "Upgrade Plan" (purple gradient button, prominent).
- **Upload zone below becomes disabled**: opacity `.5`, pointer-events `none`, dashed border turns `rgba(220, 38, 38, .15)`. Overlay text: "Upgrade to upload more documents."

### Upload Progress

Below upload zone (appears after file selected):
- Filename: `13px`, weight `500`
- Progress bar: `height: 4px`, same gradient fill as plan bar
- Status text: `12px`, color `#8b89a6`. Stages: "Uploading...", "Processing...", "Generating PVF...", "Complete"
- Cancel button during upload: `12px`, color `#dc2626`

### Upload Error States (R2 -- New)

When an upload fails at any stage, the progress section transitions to an error state. The upload zone resets and is available for retry.

Error card (replaces progress section on failure):
- Background: `rgba(220, 38, 38, .06)`
- Border: `1px solid rgba(220, 38, 38, .15)`
- Border-radius: `12px`
- Padding: `20px`

Error card anatomy:
```
+-------------------------------------------------------+
|  [x-circle icon, 32px, #dc2626]                       |
|                                                        |
|  "Upload Failed" (16px, 700, #dc2626)                  |
|  "{specific error reason}" (13px, #8b89a6)             |
|                                                        |
|  [ Retry Upload ] (primary btn)   [ Contact Support ]  |
+-------------------------------------------------------+
```

Specific error reasons by failure type:

| Failure | Error Message | Additional Guidance |
|---|---|---|
| Network timeout | "Connection lost during upload. Please check your internet connection and try again." | Show on timeout > 30s. Retry button re-attempts with same file. |
| File too large (server reject) | "This file exceeds the {limit}MB maximum. Try compressing the file or uploading a smaller version." | Client-side validation should catch most cases, but server may have stricter limits. |
| Unsupported format | "This file format is not supported. Accepted formats: PDF, PNG, JPG, TIFF, TXT, DOCX." | Show the detected file type in parentheses, e.g., "(Detected: .exe)" |
| Server error (PVF generation) | "Something went wrong while generating your PVF file. Our team has been notified." | Auto-log the error server-side. Show error ID for support reference. |
| Rate limit | "Too many uploads in a short time. Please wait a moment and try again." | Show a countdown timer if server returns retry-after header. |
| Session expired | "Your session has expired. Please log in again to continue." | Redirect to login after 3s, or show "Log In" button. |

"Contact Support" link: opens Help tab (Tab 6) contact form, pre-fills subject with "Upload Error" and includes the error ID if available.

**Persistent failure handling:** If the same upload fails 3 times consecutively, show an additional message: "Having trouble? Reach out to our support team and we'll help resolve this." with a direct link to `support@vertifile.com`.

### Upload Complete State

After PVF generation:
- Success icon: green checkmark, `48px`
- "Document Protected" heading, `20px`, weight `700`
- File details: name, size, PVF hash (truncated, monospace `11px`)
- Actions row: "Download PVF" (purple btn), "Share Link" (secondary btn), "View in Documents" (text link)

---

## Tab 3: Documents

List/table view of all protected PVF documents. This mirrors and extends the existing `doc-list-panel` from `app.html`.

### Toolbar

Top of content area. Display: flex, align-items center, gap `12px`. Padding: `12px 0`. Margin-bottom: `16px`.

- Search input: `max-width: 320px`, same style as top bar search. Placeholder: "Filter documents..." **(R2: changed from "Search documents..." to differentiate from global search in top bar. This is a local filter -- filters the visible document list only. The top bar search is global.)**
- Filter dropdown: "All Types" / "PDF" / "Image" / "Text" / "Other". Styled select, `padding: 8px 14px`, `border-radius: 10px`.
- Date range: "All Time" / "This Week" / "This Month" / "Custom". Same styled select.
- Sort: "Newest" / "Oldest" / "Name A-Z" / "Name Z-A" / "Largest". Same styled select.
- View toggle: List view / Grid view icons. `padding: 7px 10px`, border, `border-radius: 10px`.

### Bulk Actions Bar

Appears when 1+ documents selected. Sticky, top of list.
Background: `rgba(124, 58, 237, .08)`. Padding: `8px 16px`. Border-radius: `10px`. Margin-bottom: `8px`.

- "{n} selected" text, `13px`, weight `600`
- "Download All" button (secondary style)
- "Delete" button (danger style: `background: rgba(220, 38, 38, .1); color: #dc2626`) -- **(R2)** triggers Delete Confirmation Modal (see below)
- "Deselect" text link

### List View (Default)

Table header row:
- Background: `rgba(15, 14, 23, .5)` (dark) / `#f9fafb` (light)
- Font: `12px`, weight `500`, color `#8b89a6`, uppercase, letter-spacing `.5px`
- Padding: `12px 16px`
- Columns: Select (checkbox, 24px) | Star (24px) | Type Icon (30px) | Name (flex: 1) | Status (80px) | Date Protected (100px) | Size (60px) | Actions (80px)

Each document row:
- Same styling as existing `doc-row` in app.html
- Height: min `50px`
- Padding: `10px 16px`
- Border-bottom: `1px solid rgba(124, 58, 237, .04)`
- Border-left: `3px solid transparent` (selected: `#7c3aed`)
- Hover: background `rgba(124, 58, 237, .04)`
- Selected: background `rgba(124, 58, 237, .08)`

Column details:
- **Checkbox**: accent-color `#7c3aed`
- **Star**: click to favorite. Default: `#4a4862`. Starred: `#f59e0b`.
- **Type Icon**: 30x30px, border-radius 8px. PDF: `rgba(239, 68, 68, .12)` bg, `#dc2626` icon. Image: `rgba(59, 130, 246, .12)` bg, `#3b82f6` icon. Text: `rgba(34, 197, 94, .12)` bg, `#16a34a` icon. Other: `rgba(107, 114, 128, .12)` bg, `#6b7280` icon.
- **Name**: `13px`, weight `600`, color `#e2e0f0`. Truncate with ellipsis.
- **Status**: `12px`, weight `600`. "Verified" = `#16a34a` with checkmark icon. "Pending" = `#f59e0b` with clock icon. **(R2)** "Pending" badge has a tooltip on hover/tap: "Your document is being processed. This usually takes less than 2 minutes. If it stays pending longer than 10 minutes, please contact support." Tooltip styling: `max-width: 240px; padding: 8px 12px; background: #1a1830; color: #e2e0f0; font-size: 12px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, .3)`. On mobile, tap the badge to show tooltip as a bottom sheet instead. **Stuck-pending path (R2):** If a document remains "Pending" for > 10 minutes, the badge changes to "Processing Delayed" in `#dc2626` with an info icon. Tooltip updates: "Processing is taking longer than expected. Try refreshing the page. If the issue persists, contact support." with a "Contact Support" link.
- **Date**: `12px`, color `#8b89a6`. Format: "Apr 5, 2026" or relative "2h ago".
- **Size**: `12px`, color `#8b89a6`. Format: "2.4 MB".
- **Actions**: Three-dot menu icon. Dropdown: Download PVF, Copy Share Link, View Details, Delete. **(R2)** "Delete" triggers the Delete Confirmation Modal (see below).

### Delete Confirmation Modal (R2 -- New)

Triggered by: single-document delete (three-dot menu), bulk delete (bulk actions bar).

Modal overlay: `background: rgba(0, 0, 0, .6); backdrop-filter: blur(4px)`. Centered card: `max-width: 420px; padding: 24px; border-radius: 14px`. Focus-trapped (keyboard focus cannot leave modal). `aria-role="alertdialog"`.

**Single document delete:**
```
+------------------------------------------+
|  [warning-triangle icon, 40px, #dc2626]  |
|                                          |
|  "Delete Document?"                      |
|  (18px, 700, #e2e0f0)                   |
|                                          |
|  "Are you sure you want to delete        |
|   '{document_name}'? This document       |
|   and its PVF verification file will     |
|   be moved to trash."                    |
|  (13px, #8b89a6)                         |
|                                          |
|  [i] "Deleted documents are kept for     |
|       30 days and can be recovered       |
|       from Settings > Trash."            |
|  (12px, #8b89a6, info-tinted bg)         |
|                                          |
|  [ Cancel ] (secondary)  [ Delete ] (danger btn)
+------------------------------------------+
```

**Bulk delete (2+ documents):**
```
+------------------------------------------+
|  [warning-triangle icon, 40px, #dc2626]  |
|                                          |
|  "Delete {n} Documents?"                 |
|  (18px, 700, #e2e0f0)                   |
|                                          |
|  "Are you sure you want to delete        |
|   these {n} documents? All files and     |
|   their PVF verification files will      |
|   be moved to trash."                    |
|  (13px, #8b89a6)                         |
|                                          |
|  Document list (scrollable, max 3 shown):|
|  - Contract_v2.pdf                       |
|  - Invoice_March.pdf                     |
|  - NDA_Final.pdf                         |
|  + {n-3} more...                         |
|  (12px, #8b89a6)                         |
|                                          |
|  [i] "Deleted documents are kept for     |
|       30 days and can be recovered       |
|       from Settings > Trash."            |
|                                          |
|  [ Cancel ] (secondary)  [ Delete {n} Documents ] (danger btn)
+------------------------------------------+
```

Danger button styling: `background: #dc2626; color: #fff; padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 600`. Hover: `background: #b91c1c`.

Cancel button: secondary style, left side. Keyboard: Escape = cancel, Enter = do NOT default to delete (safety).

**Soft delete (R2):** Documents are not hard-deleted. They move to a "Trash" section accessible from Settings. Auto-purged after 30 days. During those 30 days, user can restore from Settings > Trash.

### Grid View (Alternative)

CSS grid: `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`, gap: `16px`.

Each card:
- Background: glassmorphism card style
- Border-radius: `14px`
- Padding: `16px`
- Hover: `transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0, 0, 0, .15)`

Card anatomy:
```
+----------------------------+
|  [File type icon, 48px]    |
|                            |
|  Filename (14px, 600)      |
|  Size (12px, muted)        |
|                            |
|  [Verified badge]          |
|  Date (11px, muted)        |
|                   [...] -->|
+----------------------------+
```

### Document Preview Panel

Clicking a document opens a slide-in panel from the right (same as existing `doc-preview` in app.html).
Width: `480px` (0 when closed, animated). Transition: `width .25s ease`.

Panel sections:
1. **Toolbar**: close button, filename, download/share buttons
2. **Preview Content**: iframe or image render of the document
3. **Info Panel**: metadata rows (Name, Type, Size, Hash, Date Protected, Status, Shared Links count)

### Empty State

Centered in content area:
- Icon: document stack, `56px`, opacity `.4`
- Heading: "No documents yet" — `18px`, weight `600`
- Body: "Upload your first document to get started." — `13px`, color `#8b89a6`, max-width `300px`
- CTA: "Upload Document" — purple gradient button, `padding: 10px 24px`, `border-radius: 12px`

### Pagination

Below document list. Display: flex, justify-content: center, gap `4px`.

Page buttons: `32x32px`, border-radius `8px`, font `13px`. Active page: purple gradient bg, white text. Others: transparent, border `1px solid rgba(124, 58, 237, .15)`, hover `rgba(124, 58, 237, .08)`.

Show: Previous, page numbers (max 5 visible + ellipsis), Next. 20 documents per page default.

---

## Tab 4: Stamp

Re-customize the Vertifile stamp. Same controls as onboarding Step 5 and the existing Branding panel in app.html. Users can return here anytime to modify their stamp.

### Layout: Split-Screen

Desktop: Two-column. Preview left (55%), Controls right (45%). Gap: `32px`.
Tablet (<1024px): Single column. Preview on top (sticky), Controls below.
Mobile (<768px): Controls as accordion sections, Preview sticky at bottom (40vh).

### Preview Section

Card, glassmorphism style. Padding: `32px 24px 20px`.
Label: "LIVE PREVIEW" — `10px`, uppercase, letter-spacing `1.5px`, color `#8b89a6`, absolute top-left.

Contains:
1. **Document mock**: A4 proportioned rectangle with blurred placeholder text lines (simulating a real document). Background: white, border: `1px solid rgba(0, 0, 0, .08)`, `border-radius: 8px`.
2. **Stamp overlay**: positioned bottom-right of document mock. Renders the full animated stamp component at `160x160px` (same component as `blp-stamp-wrap` in app.html). Shows rotating text ring, accent color border, holographic waves, logo center, verification badge.
3. **Wave strip**: below document, full-width, `48px` height, shows animated holographic waves with user's chosen colors.

All changes to controls update preview within 100ms. No debounce.

### Controls Section

#### Accent Color
Section heading: "ACCENT COLOR" — `12px`, weight `700`, color `#8b89a6`, uppercase, letter-spacing `1px`, border-bottom `1px solid rgba(124, 58, 237, .1)`, padding-bottom `8px`, margin-bottom `12px`.

Preset color circles (10 options): `32x32px`, border-radius 50%, `border: 2px solid transparent`. Selected: `border-color: #fff` + outer glow. Hover: `transform: scale(1.15)`.

Presets: Purple `#7c3aed`, Blue `#2563eb`, Teal `#0d9488`, Green `#16a34a`, Red `#dc2626`, Orange `#ea580c`, Pink `#ec4899`, Gold `#ca8a04`, Black `#171717`, Gray `#6b7280`.

"Custom" toggle: reveals hex input (`max-width: 120px`, monospace font) + color wheel picker.

#### Wave Color
Same section heading style.

Gradient presets: pill buttons, `padding: 5px 14px`, `font-size: 12px`, border-radius `8px`. Options: "Ocean", "Sunset", "Forest", "Royal", "Monochrome".

Two color inputs (Start, End) for custom gradient: label (`12px`, `#8b89a6`, `min-width: 56px`) + color input (`32x24px`, border-radius `4px`).

"Auto-generate gradient" toggle: generates complementary gradient from accent color.

Wave count slider: range input, `height: 6px`, track `rgba(124, 58, 237, .2)`, thumb `18x18px` purple circle. Range: 3-8 waves.

#### Logo Upload
Section heading style.

Current logo display: row with `40x40px` circle preview + filename + "Change" / "Remove" buttons.

Upload area (if no logo): `border: 2px dashed rgba(124, 58, 237, .2)`, padding `24px`, text-align center. "Drag logo here or click to upload. PNG, SVG, JPG. Max 2MB."

Logo crops to center-square, displays at `56x56px` inside stamp.

#### Stamp Size
Section heading style.

Three option buttons (radio-style pills): "Small", "Medium" (default), "Large".
Each: `padding: 8px 20px`, `border-radius: 10px`, `font-size: 13px`. Selected: purple gradient bg, white text. Unselected: border `1px solid rgba(124, 58, 237, .15)`.

### Stamp on Document Preview (R2 -- New)

Below the main Preview Section (or below controls on mobile). This connects the stamp to the actual document experience -- the emotional payoff.

**If user has 1+ documents:** Shows the stamp applied to their most recently uploaded document. The document renders as a thumbnail (A4 proportioned, `max-height: 280px`) with the stamp overlay in its real position (bottom-right). Caption: "Your stamp on {document_name}" -- `13px`, weight `500`, color `#8b89a6`. Link: "View document" -> Tab 3, opens that document.

**If user has 0 documents:** Shows the stamp applied to a sample document (generic "Certificate of Authenticity" template). Caption: "See your stamp on a real document" -- `13px`, weight `500`, color `#a78bfa`. CTA button: "Upload Your First Document" (purple gradient, secondary size) -> navigates to Tab 2.

Card style: same glassmorphism card as other Stamp tab sections. Padding: `24px`. Heading: "Your Stamp in Action" -- `14px`, weight `700`, color `#e2e0f0`.

### Save Action

Bottom of controls. "Save Changes" button (purple gradient, full-width on mobile). "Reset to Default" text link, `13px`, color `#8b89a6`.

After save: toast notification "Stamp updated successfully" -- `position: fixed; bottom: 24px; right: 24px`, glassmorphism card, auto-dismiss 3s. **(R2):** Toast pattern should be applied consistently across all save actions -- profile save, password change, settings update. Not just stamp save.

---

## Tab 5: Settings

Multi-section settings page. Each section is a glassmorphism card (`panel-card` style from app.html).

### Section: Profile

Card heading: "Profile" — `16px`, weight `700`.
Subtitle: "Manage your personal information" — `13px`, color `#8b89a6`.

Form fields (2-column grid on desktop, 1 column mobile):
- First Name: text input
- Last Name: text input
- Email: text input (read-only if OAuth, shows provider badge)
- Company/Organization: text input
- Industry: select dropdown (values from onboarding Step 2)
- Language: select dropdown (10 languages)

Input styling: `padding: 10px 14px`, border `1px solid rgba(124, 58, 237, .15)`, border-radius `12px`, font `13px`. Focus: `border-color: #7c3aed`.

"Save Changes" button (primary). "Cancel" button (secondary).

### Section: Security

Card heading: "Security".

- **Change Password**: Current password, New password, Confirm password fields. "Update Password" button. **(R2)** Password requirements shown inline below the "New password" field BEFORE the user types (not as a validation error after): "Password must be at least 8 characters, with one uppercase letter, one number, and one special character." -- `12px`, color `#8b89a6`. **Password strength indicator (R2):** Appears below the new password input as user types. Bar fills in 4 segments: Weak (`#dc2626`), Fair (`#f59e0b`), Good (`#16a34a`), Strong (`#16a34a` full). Label text updates accordingly: "Weak", "Fair", "Good", "Strong" -- `12px`, weight `600`. After successful password change: toast notification "Password updated successfully." Redirect to login if "Log out other sessions" is checked (checkbox below password fields, unchecked by default).
- **Two-Factor Authentication**: toggle row with description. Enable/disable 2FA.
- **Active Sessions**: list of active sessions (browser, location, last active). "Log out all other sessions" danger button.

### Section: Plan & Billing

Card heading: "Plan & Billing".

Current plan card (nested, highlighted border):
- Plan name: `20px`, weight `800`, gradient text
- Price: `16px`, weight `600`
- Usage: progress bar + "{used}/{limit} documents"
- Features list: checkmark items, `13px`
- "Change Plan" button (secondary), "Cancel Plan" text link (danger color, `12px`)

### Section: Notifications

Card heading: "Notification Preferences".

Toggle rows (same styling as app.html `toggle-row`):
- "Email when document is verified" — toggle
- "Email when shared document is opened" — toggle
- "Weekly activity digest" — toggle
- "Product updates and tips" — toggle
- "Plan limit warnings" — toggle

Each toggle: label (`13px`, weight `500`), description (`11px`, `#8b89a6`), switch (`42x24px`, purple when on).

### Section: Trash (R2 -- New)

Card heading: "Trash".
Subtitle: "Documents you deleted are kept here for 30 days before permanent removal." -- `13px`, color `#8b89a6`.

- List of trashed documents (same row style as Documents tab, but muted opacity `.7`)
- Each row shows: document name, date deleted, days remaining until permanent deletion
- Actions per row: "Restore" (secondary button), "Delete Permanently" (danger text link, triggers confirmation)
- "Empty Trash" button (danger style) -- triggers confirmation modal: "Permanently delete all {n} documents in trash? This cannot be undone."
- Empty state: "Trash is empty." -- centered, `13px`, color `#8b89a6`

### Section: Danger Zone (R2 -- Revised)

Card with red-tinted border: `border-color: rgba(220, 38, 38, .2)`.

- "Delete Account" -- danger button. Triggers **multi-step** confirmation flow (R2 -- strengthened).
- Warning text: "This action cannot be undone. All documents and data will be permanently deleted." -- `13px`, color `#dc2626`.

**Delete Account Multi-Step Flow (R2):**

Step 1 -- Initial confirmation modal:
```
+------------------------------------------+
|  [warning-triangle, 48px, #dc2626]       |
|                                          |
|  "Delete Your Account?"                  |
|  (20px, 800, #dc2626)                   |
|                                          |
|  "This will permanently delete:"         |
|  - {n} protected documents               |
|  - {n} PVF verification files            |
|  - Your stamp customization              |
|  - All shared links (they will stop      |
|    working immediately)                   |
|  (13px, #8b89a6)                         |
|                                          |
|  [ Export My Data First ] (secondary btn) |
|  [ Cancel ] [ Continue to Delete ]        |
+------------------------------------------+
```

"Export My Data First" button: triggers a data export (ZIP of all documents + PVF files + account data JSON). Download starts, user stays on the modal.

Step 2 -- Type-to-confirm:
```
+------------------------------------------+
|  To confirm, type your email address:    |
|  (13px, #8b89a6)                         |
|                                          |
|  [ _____________________________ ]       |
|  (input, placeholder: "your@email.com")  |
|                                          |
|  [ Cancel ] [ Delete My Account ]         |
+------------------------------------------+
```

"Delete My Account" button stays disabled (grayed out) until the typed email matches the user's account email exactly. Button style when enabled: `background: #dc2626; color: #fff`.

Step 3 -- Re-enter password:
```
+------------------------------------------+
|  Enter your password to confirm:         |
|                                          |
|  [ _____________________________ ]       |
|  (password input)                        |
|                                          |
|  [ Cancel ] [ Permanently Delete Account ]|
+------------------------------------------+
```

After successful password verification, account deletion proceeds. Redirect to a "Your account has been deleted" confirmation page with a link to the Vertifile homepage.

---

## Tab 6: Help

### FAQ Section

Card heading: "Frequently Asked Questions".

Accordion items. Each:
- Question: `14px`, weight `600`, color `#e2e0f0`. Click to expand.
- Chevron icon right, rotates 180 degrees on open. Transition: `transform .2s`.
- Answer: `13px`, color `#8b89a6`, line-height `1.6`. Padding: `12px 0`.
- Border-bottom: `1px solid rgba(124, 58, 237, .06)`.

Initial FAQ items (R2 -- Reordered, #5 moved to #1 per Chen's recommendation, as it is the core value proposition):
1. "What happens if someone alters a protected document?"
2. "What is a PVF file?"
3. "How does Vertifile protect my documents?"
4. "What file types are supported?"
5. "How do I share a protected document?"
6. "How do I upgrade my plan?"
7. "Can I customize my verification stamp?"
8. "Is my data stored securely?"

**(R2) FAQ feedback mechanism:** Each expanded FAQ answer ends with a "Was this helpful?" row: thumbs-up and thumbs-down icons, `16px`, color `#8b89a6`. Hover: thumbs-up turns `#16a34a`, thumbs-down turns `#dc2626`. Clicking logs a `help_faq_feedback` analytics event with `question_index` and `helpful: true/false`. After clicking, row changes to "Thanks for your feedback!" -- `12px`, color `#8b89a6`, auto-dismiss after 2s.

**(R2) Escalation path:** Below the FAQ accordion, a prominent card: "Didn't find what you need?" -- `14px`, weight `600`. "Our support team is happy to help." CTA: "Contact Support" (secondary button) -> scrolls to Contact Support section below. This should NOT be buried -- it is the safety net for users who cannot self-serve.

### Contact Support

Card heading: "Need Help?".

- Support email: link to `support@vertifile.com`
- "Send us a message" -- opens contact form:
  - Name (text input, pre-filled from profile)
  - Email (text input, pre-filled from profile)
  - **(R2)** Subject category dropdown (required): "Select a topic..." (placeholder), "Bug Report", "Billing Question", "Feature Request", "Document Issue", "Account Issue", "Other". Styled select, same as Documents tab filter dropdowns. Helps users articulate their problem and helps the support team triage.
  - **(R2)** Subject line (text input): free-text subject, `max-length: 120`
  - Message (textarea, `min-height: 120px`)
  - "Send Message" button (purple gradient). **(R2)** After send: toast "Message sent! We'll get back to you within 24 hours."
- Response time note: "We typically respond within 24 hours." -- `12px`, color `#8b89a6`

### Quick Links

Card with icon links:
- Documentation (external link icon)
- API Reference (external link icon)
- Status Page (external link icon)
- Community (external link icon)

Each: `display: flex; align-items: center; gap: 8px; padding: 10px 14px`. Hover: background `rgba(124, 58, 237, .04)`.

---

## Mobile Layout

Breakpoint: `max-width: 768px`.

### Bottom Tab Navigation

Replaces sidebar. Position: `fixed`, bottom `0`, full-width, `z-index: 100`.
Height: `56px`. Background: `#1a1830` (dark) / `#fff` (light). Border-top: `1px solid rgba(124, 58, 237, .1)`.
Safe area padding: `env(safe-area-inset-bottom)` for notched devices.

Display: flex, `justify-content: space-around`, `align-items: center`.

5 tab icons (Overview, Upload, Documents, Stamp, Settings).

**(R2 -- Revised):** Help is NOT buried inside Settings. Instead, a floating help button (question-mark circle, `44x44px`, purple gradient, `border-radius: 50%`, `box-shadow: 0 4px 16px rgba(124, 58, 237, .3)`) appears fixed at `bottom: 72px; right: 16px` (above the bottom nav). Tapping it opens the Help tab content as a bottom sheet (`border-radius: 16px 16px 0 0`, slides up from bottom, max-height `85vh`, overflow-y: scroll). This ensures confused mobile users always have one-tap access to help without navigating through Settings. The floating button has `z-index: 99` (below top bar but above content). `aria-label="Help"`.

Each tab:
- Width: `20%` (flex: 1)
- Display: flex, flex-direction column, align-items center, gap `2px`
- Icon: `22px`
- Label: `10px`, weight `500`
- Color default: `#8b89a6`
- Color active: `#a78bfa`
- Active dot: `4px` circle, purple, centered below icon

Touch target: entire tab area, minimum `44x44px`.

### Sidebar Hidden

`display: none` on mobile. Sidebar content absorbed into bottom nav + settings sub-pages.

### Top Bar Adjustments

- Search bar: hidden by default. Tap search icon in top bar to expand full-width overlay.
- User name: hidden. Avatar only.
- "New Document" button: icon only (no text), `34x34px`.
- Hamburger: hidden (no sidebar to toggle).

### Content Adjustments

- Padding: `16px` instead of `32px`
- Stats cards: single column stack
- Document list: horizontal scroll on small screens, or simplified columns (name + status + actions only)
- Stamp split-screen: single column, controls above, preview sticky below at `40vh`

### Swipe Gestures (R2 -- Revised)

Swipe left/right on main content area to navigate between adjacent tabs. Detects horizontal swipe (threshold: 50px, angle within 30 degrees of horizontal). Transition: `transform .3s ease` slide animation.

**(R2) Conflict prevention:** Swipe navigation is **disabled** on the Documents tab (Tab 3) because the document list has horizontal scroll on mobile, and users will accidentally swipe between tabs when they mean to scroll horizontally. Swipe navigation is also disabled on any tab where horizontally scrollable content is present. On these tabs, tab switching requires tapping the bottom nav icons. Alternatively, swipe navigation can be restricted to **edge swipes only** (swipe starting within 20px of the left or right screen edge) on all tabs -- this avoids the conflict entirely while preserving the gesture. Implementation choice: edge-swipe-only is preferred for consistency.

---

## Personalization (From Onboarding Data)

### Industry-Specific Content

All personalization reads from `user_profiles` table fields set during onboarding.

**Overview tab:**
- Industry tips card (see Tab 1 spec above)
- Recommended document types highlighted in Upload tab based on `document_types` selection from onboarding Step 3

**Documents tab:**
- Default sort and filter can be preset by industry (e.g., Legal defaults to "Contracts" filter)
- Template suggestions: "Based on your industry, consider protecting: [type 1], [type 2], [type 3]" — shown above document list for new users (dismissible)

**Upload tab:**
- Upload hint text varies: "Upload a {recommended_type} to get started" — using first item from `document_types` array

### Plan-Aware UI

Based on `estimated_volume` and assigned plan from onboarding Step 4/6:

**Free Trial users (R2 -- Revised):**
- **(R2)** Primary conversion element: **Upgrade Card on Overview tab** (see "Upgrade Card -- Free Trial Users" section above). This is persistent, not dismissible, and positioned prominently. This replaces the old "subtle banner" which was too easy to ignore and did not convert.
- Secondary: Slim info bar across Upload and Documents tabs only (not all tabs): "Free trial: {n} days remaining, {used}/{limit} documents. [Upgrade]" -- `background: rgba(124, 58, 237, .06)`, `padding: 6px 16px`, `font-size: 12px`. Dismissible per session.
- Feature-gated indicators: lock icon next to features not in free tier (e.g., bulk download, API access). Hover tooltip: "Available on Pro plan. [Upgrade]"

**Pro users:**
- No upgrade prompts unless approaching limit
- Limit warning at 80%: yellow-tinted banner in Overview

**Pro+ / Enterprise:**
- Full feature access, no prompts
- Enterprise badge in sidebar plan section

---

## Dark / Light Mode Toggle

Toggle button in top bar. Persisted in `localStorage` key `vertifile-theme`. Also respects `prefers-color-scheme` media query as default.

### Color Mapping

| Element | Dark Mode | Light Mode |
|---|---|---|
| Body background | `#0f0e17` | `#ffffff` |
| Content background | `#0f0e17` | `#f9fafb` |
| Sidebar background | `#1a1830` | `#f3f0ff` |
| Card background | `rgba(26, 24, 48, .5)` | `#ffffff` |
| Card border | `rgba(124, 58, 237, .1)` | `rgba(0, 0, 0, .06)` |
| Text primary | `#e2e0f0` | `#111827` |
| Text secondary | `#8b89a6` | `#6b7280` |
| Input background | `rgba(15, 14, 23, .5)` | `#ffffff` |
| Input border | `rgba(124, 58, 237, .15)` | `rgba(0, 0, 0, .12)` |
| Hover background | `rgba(124, 58, 237, .04)` | `rgba(124, 58, 237, .03)` |
| Shadow | `0 2px 8px rgba(0, 0, 0, .2)` | `0 2px 8px rgba(0, 0, 0, .06)` |
| Top bar background | `rgba(15, 14, 23, .95)` | `rgba(255, 255, 255, .92)` |
| Nav active text | `#a78bfa` | `#7c3aed` |
| Nav active bg | `rgba(124, 58, 237, .1)` | `rgba(124, 58, 237, .06)` |

Transition: `background .3s, color .3s` on `body`. All child elements inherit via CSS custom properties.

Implementation: `<body class="dark">` or `<body class="light">`. CSS variables defined per class. Toggle swaps class + saves to localStorage.

---

## RTL Support

Dashboard fully supports RTL (Hebrew, Arabic). Activated by `<html dir="rtl">`.

### RTL Adjustments

- Sidebar: switches to right side. Border-left becomes border-right.
- Nav item active border: `border-left` becomes `border-right`
- Top bar: layout mirrors. Logo right, user menu left.
- Document list: text-align flips. Date/size columns swap sides.
- Stamp split-screen: preview right, controls left.
- Bottom tab nav: stays the same (icons are direction-independent).
- All `margin-left` / `padding-left` flip to `margin-right` / `padding-right` via `[dir="rtl"]` selectors.
- Icons that imply direction (arrows, back buttons): `transform: scaleX(-1)` in RTL.
- Progress bars and sliders: remain LTR (universal convention per onboarding-spec Round 13 decision).

### Font Switching

```css
body { font-family: 'Inter', sans-serif; }
[dir="rtl"] body { font-family: 'Heebo', 'Inter', sans-serif; }
```

---

## Transitions & Animations

### Tab Switching

Content fade-in: `opacity 0 -> 1, transform: translateY(8px) -> 0` over `300ms ease`.
Outgoing tab: immediate `display: none` (no exit animation for snappiness).

### Sidebar Nav

Active indicator border-left slides with `transition: all .15s ease`.
Hover background fades in over `.15s`.

### Cards

Hover lift: `transform: translateY(-2px)` over `.2s`.
Stats cards on first load: staggered fade-in, 100ms delay between each.

### Stamp Preview

Continuous holographic wave animation (CSS keyframes `wavePreviewFlow`, `6s linear infinite`).
Rotating stamp text ring: `stampRotateText`, `20s linear infinite`.
Respects `prefers-reduced-motion`: disable animations, show static.

### Toast Notifications

Slide up: `transform: translateY(80px) -> 0`, `opacity: 0 -> 1`, `.3s ease`.
Auto-dismiss after 3s with same animation reversed.

### Document Preview Panel

Slide from right: `width: 0 -> 480px` over `.25s ease`.

---

## Accessibility (WCAG 2.1 AA)

1. **Keyboard Navigation**: Tab through all interactive elements. Sidebar nav items focusable with Enter/Space to activate. Document rows focusable. Modal focus trapping.
2. **Focus Visible**: `outline: 2px solid #7c3aed; outline-offset: 2px` on all focusable elements.
3. **Screen Readers**: `aria-label` on icon-only buttons. `role="navigation"` on sidebar. `role="main"` on content area. `aria-current="page"` on active tab. `aria-expanded` on accordions.
4. **Color Contrast**: All text meets 4.5:1 minimum. Interactive elements meet 3:1 against backgrounds.
5. **Touch Targets**: Minimum `44x44px` on all interactive elements.
6. **Reduced Motion**: `@media (prefers-reduced-motion: reduce)` disables all animations, transitions set to `0s`.
7. **Skip Links**: Hidden "Skip to main content" link, visible on focus, jumps past sidebar/top bar.
8. **Status Messages**: `aria-live="polite"` on toast notifications, upload progress, bulk action confirmations.
9. **Document Table**: `role="table"`, `role="row"`, `role="cell"` with appropriate headers.
10. **(R2) Keyboard Shortcuts**: Power users (legal, finance) benefit from keyboard shortcuts. Available shortcuts:

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + K` | Focus global search bar |
| `Cmd/Ctrl + U` | Open Upload tab (Tab 2) |
| `Cmd/Ctrl + 1` through `Cmd/Ctrl + 6` | Switch to tab 1-6 |
| `Escape` | Close any open modal, panel, or dropdown |
| `?` (when no input focused) | Show keyboard shortcuts help overlay |

Keyboard shortcuts help overlay: triggered by pressing `?` when no text input is focused. Shows a modal listing all shortcuts in a two-column grid. Dismiss with Escape or clicking outside. `aria-role="dialog"`, `aria-label="Keyboard shortcuts"`.

---

## Analytics Events (R2 -- Expanded)

| Event | Trigger | Payload |
|---|---|---|
| `dashboard_viewed` | Tab loaded | `tab_name`, `is_first_visit` |
| `document_uploaded` | Upload complete | `file_type`, `file_size`, `time_to_upload` |
| `document_downloaded` | Download clicked | `document_id`, `file_type` |
| `document_shared` | Share link created | `document_id` |
| `document_delete_confirmed` | Delete modal confirmed | `document_id`, `is_bulk`, `count` | **(R2)**
| `stamp_customized` | Stamp save clicked | `changed_fields[]` (accent, wave, logo, size) |
| `plan_upgrade_clicked` | Upgrade CTA clicked | `current_plan`, `source_tab`, `source_component` |
| `upgrade_card_viewed` | Upgrade card rendered on Overview | `current_plan`, `days_remaining` | **(R2)**
| `search_performed` | Search submitted | `query_length`, `results_count`, `tab`, `is_global` |
| `theme_toggled` | Theme switch clicked | `new_theme` (dark/light) |
| `tab_switched` | Nav item clicked | `from_tab`, `to_tab` |
| `help_faq_opened` | FAQ accordion expanded | `question_index` |
| `help_faq_feedback` | FAQ helpful thumbs clicked | `question_index`, `helpful` (bool) | **(R2)**
| `share_link_opened` | Third party opens share link | `document_id`, `referrer` | **(R2)**
| `verification_by_third_party` | Third party verifies a document | `document_id`, `verifier_info` | **(R2)**
| `getting_started_step_completed` | Checklist step auto-completed | `step_number`, `step_name` | **(R2)**
| `getting_started_dismissed` | Checklist dismissed after completion | `time_to_complete_all` | **(R2)**
| `upload_failed` | Upload error at any stage | `error_type`, `file_type`, `file_size` | **(R2)**
| `upload_retried` | Retry button clicked after failure | `error_type`, `attempt_number` | **(R2)**
| `activity_feed_viewed` | Activity feed scrolled or expanded | `user_plan`, `event_count` | **(R2)**

---

## API Endpoints (For Moshe)

The dashboard consumes these endpoints (several already exist from app.html and onboarding):

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/user/profile` | Load user profile, plan, onboarding data |
| GET | `/api/documents?page=&limit=&sort=&filter=` | Paginated document list |
| GET | `/api/documents/:id` | Single document detail |
| GET | `/api/documents/stats` | Dashboard stats (count, verifications, etc.) |
| POST | `/api/documents/upload` | Upload new document |
| DELETE | `/api/documents/:id` | Delete document |
| POST | `/api/documents/:id/share` | Generate share link |
| GET | `/api/stamp/config` | Load stamp configuration |
| PATCH | `/api/stamp/config` | Update stamp configuration |
| POST | `/api/upload/logo` | Upload stamp logo |
| PATCH | `/api/user/profile` | Update profile fields |
| PATCH | `/api/user/password` | Change password |
| GET | `/api/notifications` | Load notifications |
| PATCH | `/api/notifications/:id/read` | Mark notification read |
| GET | `/api/plan` | Current plan details and usage |
| GET | `/api/activity?limit=&offset=` | Activity feed events (R2) |
| GET | `/api/user/onboarding-checklist` | Getting Started checklist state (R2) |
| PATCH | `/api/user/onboarding-checklist` | Update checklist step completion (R2) |
| GET | `/api/documents/trash` | List trashed documents (R2) |
| POST | `/api/documents/:id/restore` | Restore document from trash (R2) |
| DELETE | `/api/documents/:id/permanent` | Permanently delete from trash (R2) |
| POST | `/api/user/export-data` | Export all user data as ZIP (R2) |
| DELETE | `/api/user/account` | Delete account (multi-step verified) (R2) |
| POST | `/api/support/message` | Submit support contact form (R2) |

---

## File Structure (Proposed)

```
public/
  dashboard.html          -- Main dashboard page (single HTML, tab switching via JS)
  css/
    dashboard.css         -- Dashboard-specific styles (extends design system)
  js/
    dashboard.js          -- Tab switching, state management, API calls
    stamp-component.js    -- Existing stamp renderer (shared with onboarding)
    upload-handler.js     -- Upload logic (extracted from app.html)
    theme-toggle.js       -- Dark/light mode persistence
```

---

## Implementation Notes

1. **Reuse from app.html**: The current app.html already contains sidebar navigation, document list, upload modal, branding editor, settings panels, and theme toggle. The dashboard can be evolved from this existing page rather than built from scratch. Key changes: add Overview tab as default landing, restructure Upload to inline (not modal), add Help tab.

2. **Stamp component**: `stamp-component.js` is the single source of truth (referenced in onboarding.html). The dashboard Stamp tab and Overview stamp preview both use this same component at different sizes.

3. **Onboarding handoff**: When redirecting from onboarding Step 6 with `?onboarding=complete`, the dashboard should: (a) show the first-time welcome heading, (b) auto-scroll to stamp preview in Overview (the payoff), (c) show a one-time confetti-free "Account setup complete" toast.

4. **State management**: Active tab stored in URL hash (`#overview`, `#upload`, `#documents`, `#stamp`, `#settings`, `#help`) for bookmarkability and back-button support.

5. **Loading states**: All API-dependent content shows skeleton loaders (gradient shimmer animation, same as existing `app.html` skeleton class) until data arrives. Never show empty content without a loading indicator first.

6. **Error states (R2 -- Expanded)**: Network errors show inline banners (not modals). Session expired shows full-page overlay with login redirect. 403 on upload shows plan limit card. **(R2) All error banners must include three elements:** (a) What happened in plain language -- not "Something went wrong" but a specific description. (b) What the user can try -- "Check your internet connection and refresh the page." (c) An escape hatch -- "If the problem continues, contact support@vertifile.com" with a clickable mailto link. Example inline error banner: `background: rgba(220, 38, 38, .06); border: 1px solid rgba(220, 38, 38, .12); border-radius: 10px; padding: 16px`. Icon: `x-circle, 20px, #dc2626`. Text: `13px`. "Retry" button (secondary) + "Contact Support" link.

---

## Revision History

### R2 -- 2026-04-05 -- Addressing Amit (Product) + Chen (Support) Review

**Review source:** `/docs/dashboard-review-amit-chen.md`

All 10 must-fix items from the combined review have been addressed:

| # | Must-Fix Item | Resolution | Spec Sections Changed |
|---|---|---|---|
| 1 | **Getting Started checklist** on Overview tab | Added 4-step checklist card (upload, customize stamp, share, first verification). Server-side persistence. Dismissible only after all complete. | Tab 1: Overview > Getting Started Checklist |
| 2 | **Upload error states** | Added full error state spec with 6 failure types, specific error messages, retry button, support link, and persistent-failure escalation. | Tab 2: Upload > Upload Error States |
| 3 | **Delete confirmation dialogs** | Added confirmation modals for single-doc and bulk delete. Includes document names, irreversibility warning, and 30-day soft-delete/trash recovery. | Tab 3: Documents > Delete Confirmation Modal, Tab 5: Settings > Trash |
| 4 | **Pending status tooltip** | Added tooltip on all Pending badges explaining processing time. Added stuck-pending path (>10 min) with escalation to support. | Tab 1: Overview > Recent Documents, Tab 3: Documents > Status column |
| 5 | **Upload limit warning timing** | Moved from after upload attempt to before. Quota status shown inline above upload zone. Upload zone disabled entirely when at limit. | Tab 2: Upload > Upload Quota Status |
| 6 | **Duplicate upload button** | Removed sidebar upload button. Top bar button is the single upload entry point. Sidebar space repurposed for Getting Started summary / activity summary. | Sidebar > Upload Button (removed), Sidebar Quick Summary (new) |
| 7 | **Upgrade card for free trial** | Replaced "subtle banner" with a persistent, non-dismissible Upgrade Card on Overview tab showing trial remaining, usage, missing features, and CTA. | Tab 1: Overview > Upgrade Card, Personalization > Free Trial users |
| 8 | **Delete Account strengthening** | Replaced single confirmation with 3-step flow: initial confirmation with data export option, type-email-to-confirm, re-enter password. Shows document count to be lost. | Tab 5: Settings > Danger Zone |
| 9 | **Notification types expanded** | Added 5 new notification types: upload failed, document viewed by recipient, share link expired, new login security alert, password changed alert. | Top Bar > Notifications Dropdown |
| 10 | **Mobile swipe gesture conflict** | Disabled swipe navigation on tabs with horizontal scroll, or restricted to edge-swipe-only globally. | Mobile Layout > Swipe Gestures |

**Additional improvements from review recommendations (nice-to-have items addressed):**

| Improvement | Resolution | Spec Section |
|---|---|---|
| Activity feed for business users | Added Activity Feed section on Overview with 6 event types, business/enterprise visibility, teaser for other plans. New API endpoint. | Tab 1: Overview > Activity Feed |
| Context-aware quick actions | Quick Actions now show different content for 0 docs vs 1+ docs. Returning users see Share Last, Check Status alongside Upload. | Tab 1: Overview > Quick Action Section |
| Stats cards -- verification clarity | Split ambiguous "Verifications" card into "Verified by Others" and "Share Link Opens". Grid now 4 columns. | Tab 1: Overview > Stats Cards Row |
| Help tab contact form subject dropdown | Added required subject category dropdown (Bug Report, Billing, Feature Request, etc.) plus free-text subject line. | Tab 6: Help > Contact Support |
| FAQ reorder + feedback | Moved "What happens if someone alters a protected document?" to position 1. Added "Was this helpful?" thumbs on every FAQ. Added escalation path card. | Tab 6: Help > FAQ Section |
| Stamp-to-document connection | Added "Stamp on Document Preview" section showing stamp applied to real/sample document with CTA. | Tab 4: My Stamp > Stamp on Document Preview |
| Password strength indicator | Added inline password requirements shown before typing, plus a 4-segment strength indicator bar. | Tab 5: Settings > Security |
| Error banners specificity | All error banners now require three elements: plain-language description, user action, and support escape hatch. | Implementation Notes > Error states |
| Mobile Help accessibility | Floating help button (bottom-right, above nav) opens Help as bottom sheet. Not buried in Settings. | Mobile Layout > Bottom Tab Navigation |
| Plan Badge clickable | Entire Plan Badge card now clickable, links to Settings > Plan & Billing. | Sidebar > Plan Badge |
| Logo click behavior | If already on dashboard, resets to Overview tab and scrolls to top. | Top Bar > Logo |
| Keyboard shortcuts | Added Cmd/Ctrl+K (search), Cmd/Ctrl+U (upload), Cmd/Ctrl+1-6 (tabs), ? (shortcuts overlay). | Accessibility > Keyboard Shortcuts |
| Search bar deduplication | Top bar search is now global ("Search Vertifile..."), Documents tab search is now a local filter ("Filter documents..."). | Top Bar > Search Bar, Tab 3: Documents > Toolbar |
| Stamp tab rename | Renamed from "Stamp" to "My Stamp" with first-visit tooltip. | Sidebar > Navigation Items |
| "View All" link clarity | Changed from "View All" to "View All Documents" in Overview Recent Documents. | Tab 1: Overview > Recent Documents |
| Toast pattern consistency | Note added that toast notifications apply to all save actions, not just stamp save. | Tab 4: My Stamp > Save Action |
| Analytics events expanded | Added 8 new funnel-critical events including share_link_opened, verification_by_third_party, getting_started_step_completed, upload_failed. | Analytics Events |
| New API endpoints | Added 10 new endpoints for activity feed, checklist, trash, data export, account deletion, support. | API Endpoints |
| Trash/soft-delete | Added Trash section in Settings with 30-day recovery, restore, and permanent delete. | Tab 5: Settings > Trash |

**What was NOT changed (preserved from R1):**

- Onboarding-to-dashboard handoff logic (praised by both reviewers)
- Industry-specific tips system (praised by both reviewers)
- Dark/light mode implementation via CSS custom properties
- RTL support and Heebo font switching
- Accessibility section (expanded, not replaced)
- Design system tokens (no changes)
- Glassmorphism card style and animation system
- File structure and stamp component reuse approach

**Items deferred to V1.1 (acknowledged but not in this revision):**

- "Shared With Me" / received documents section (Amit #5) -- requires significant architecture discussion. Placeholder will be added during build if time allows.
- CMS-backed FAQ system (Amit #7) -- static FAQ is fine for launch, CMS integration is a V1.1 infrastructure task.
- Global search indexing help articles and settings -- spec calls for it but implementation complexity is a V1.1 scope item.

-- Dana (UX Design), 2026-04-05

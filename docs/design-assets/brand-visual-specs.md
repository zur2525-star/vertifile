# Vertifile -- Visual Asset Specifications

> Maintained by Gal (Graphic Designer) | Sprint 3C
> Reference: [Brand Guidelines](brand-guidelines.md) | [Social Templates](social-templates.md)
> Content calendar: [30-Day Calendar](../marketing/content-calendar-30days.md)

---

## Color Palette Reference

All assets must use the approved brand palette exclusively.

| Name | Hex | Usage |
|------|-----|-------|
| Primary | `#4f46e5` | CTAs, links, active states |
| Secondary (Vertifile Purple) | `#7c3aed` | Accents, gradients, highlights |
| Dark | `#0f0e17` | Text, dark backgrounds |
| Light | `#f8f7ff` | Page backgrounds, light cards |
| White | `#ffffff` | Text on dark, clean backgrounds |
| Success | `#16a34a` | Verified states, confirmations |
| Error | `#dc2626` | Errors, destructive actions, FORGED state |
| Warning | `#f59e0b` | Alerts, pending states |
| Gradient | `#4f46e5` to `#7c3aed` at 135deg | Hero sections, prominent CTAs |

**No other colors.** No stock photo tints, no random accent colors, no grays outside the palette.

---

## Typography Reference

| Element | Font | Weight | Fallback |
|---------|------|--------|----------|
| Headings (EN) | Inter | 800 (Black) | system-ui |
| Body (EN) | Inter | 400 (Regular) | system-ui |
| Numbers / Stats | Inter | 800 (Black) | system-ui |
| Headings (HE) | Heebo | 700 (Bold) | sans-serif |
| Body (HE) | Heebo | 400 (Regular) | sans-serif |

Minimum sizes for social assets: 24px headings, 16px body text.

---

## Asset 1: The PVF Fortress Infographic

The hero visual for Week 2 of the content calendar and ongoing marketing use. This asset does half the sales work by making the 7 security layers immediately visual and understandable.

### Concept

A document sits at the center of a multi-layered fortress or vault structure. Seven concentric rings surround the document, each representing one security layer. The visual communicates: "this document is locked inside a fortress of protection."

### Layout

```
        +----- Ring 7: Format-Level Protection -----+
       |  +---- Ring 6: Blockchain Anchoring ----+   |
       | |  +--- Ring 5: Metadata Binding ---+   |   |
       | | |  +-- Ring 4: Holographic Stamp --+  |   |
       | | | |  +- Ring 3: BLIND Processing -+|  |   |
       | | | | |  + Ring 2: HMAC Auth +      ||  |   |
       | | | | | |  Ring 1: SHA-256  |       ||  |   |
       | | | | | |                   |       ||  |   |
       | | | | | |   [DOCUMENT]      |       ||  |   |
       | | | | | |   with glowing    |       ||  |   |
       | | | | | |   Vertifile stamp |       ||  |   |
       | | | | | +-------------------+       ||  |   |
       | | | | +-----------------------------+|  |   |
       | | | +--------------------------------+  |   |
       | | +-------------------------------------+   |
       | +-------------------------------------------+
       +---------------------------------------------+
```

### Ring Labels (Business-Friendly Language)

| Ring | Technical Name | Label on Graphic | Icon Suggestion |
|------|---------------|------------------|-----------------|
| 1 (innermost) | SHA-256 Hash | Digital Fingerprint | Fingerprint icon |
| 2 | HMAC Authentication | Identity Seal | Key icon |
| 3 | BLIND Processing | Privacy Shield | Eye-slash icon |
| 4 | Animated Holographic Stamp | Live Verification | Rotating stamp icon |
| 5 | Metadata Binding | Context Lock | Lock icon |
| 6 | Blockchain Anchoring | Permanent Record | Chain-link icon |
| 7 (outermost) | Format-Level Protection | Secure Container | Shield icon |

### Center Element

- The document should look like a clean, generic page (no specific content visible)
- A Vertifile stamp glows at the center of the document
- Subtle glow effect radiating outward from the stamp, connecting to Ring 1
- The glow uses the brand gradient (#4f46e5 to #7c3aed)

### Ring Styling

- Each ring has a distinct but complementary shade within the brand palette
- Rings 1-3: deeper shades (closer to #0f0e17 with purple tint)
- Ring 4: brighter, slightly glowing (this is the visual verification layer)
- Rings 5-7: gradient from secondary purple to primary indigo
- Space between rings: thin dark gaps to maintain visual separation
- Each ring has its label on or adjacent to the ring, reading clockwise

### Fortress Variation (Progressive Build)

For the Week 2 content calendar (Days 8-14), Gal needs 7 variations:

| Day | Variation | Description |
|-----|-----------|-------------|
| Day 8 | 1 of 7 | Only Ring 1 is highlighted/colored. Rings 2-7 are dimmed outlines |
| Day 9 | 2 of 7 | Rings 1-2 highlighted. Rings 3-7 dimmed |
| Day 10 | 3 of 7 | Rings 1-3 highlighted. Rings 4-7 dimmed |
| Day 11 | 4 of 7 | Rings 1-4 highlighted. Rings 5-7 dimmed |
| Day 12 | 5 of 7 | Rings 1-5 highlighted. Rings 6-7 dimmed |
| Day 13 | 6 of 7 | Rings 1-6 highlighted. Ring 7 dimmed |
| Day 14 | 7 of 7 | All rings highlighted. Full fortress revealed |

Dimmed rings: stroke-only in `rgba(124, 58, 237, 0.15)` with no fill.
Active rings: full color with subtle inner glow.

### Export Formats

| Format | Dimensions | Use Case |
|--------|-----------|----------|
| PNG | 1200 x 628 px | LinkedIn, Twitter/X, Facebook link previews |
| PNG | 1080 x 1080 px | Instagram square post |
| PNG | 1080 x 1350 px | Instagram portrait post |
| SVG | Scalable | Web use, presentations, print |
| PNG | 1920 x 1080 px | Presentation slides |

### Background

- Dark: `#0f0e17` with subtle grid pattern (matching website hero)
- No busy backgrounds, no stock imagery behind the fortress
- Optional: very subtle radial glow from center outward

---

## Asset 2: Before/After Comparison

Split-screen visual showing the difference between an unprotected PDF and a PVF-protected document. Used for Day 15 (PDF vs PVF) and general marketing.

### Layout

```
+---------------------------+---------------------------+
|                           |                           |
|     UNPROTECTED PDF       |     PVF PROTECTED         |
|                           |                           |
|   +-------------------+   |   +-------------------+   |
|   |                   |   |   |                   |   |
|   |   [Document]      |   |   |   [Document]      |   |
|   |                   |   |   |                   |   |
|   |   Red X overlay   |   |   |   Green checkmark |   |
|   |                   |   |   |   Spinning stamp   |   |
|   +-------------------+   |   +-------------------+   |
|                           |                           |
|   "VULNERABLE"            |   "VERIFIED"              |
|   #dc2626                 |   #16a34a                 |
|                           |                           |
+---------------------------+---------------------------+
```

### Left Side (Unprotected PDF)

- Background tint: very subtle red (`rgba(220, 38, 38, 0.05)`)
- Document preview with a large red X overlay
- Label: "VULNERABLE" in Inter 800, `#dc2626`
- Subtitle: "Static signature. No tamper detection."
- Visual crack/fracture lines radiating from the document (representing vulnerability)

### Right Side (PVF Protected)

- Background tint: very subtle green (`rgba(22, 163, 74, 0.05)`)
- Document preview with Vertifile stamp and green checkmark
- Label: "VERIFIED" in Inter 800, `#16a34a`
- Subtitle: "Live stamp. 7-layer protection. BLIND processed."
- Subtle glow/shield effect around the document (representing security)

### Tamper Variation

A second version showing what happens when tampering occurs:

- Left side: cracked document, fragments separating, red glow
- Right side: stamp frozen red, "FORGED" text overlay, red warning indicators
- Title above: "What happens when someone tampers?"

### Export Formats

| Format | Dimensions | Use Case |
|--------|-----------|----------|
| PNG | 1200 x 628 px | LinkedIn, Twitter/X, Facebook |
| PNG | 1080 x 1080 px | Instagram square |
| PNG | 1080 x 1350 px | Instagram portrait (stack vertically) |

---

## Asset 3: Three-Step Process Diagram

Clean, minimal process diagram showing Upload, Protect, Verify. Used for Day 6 and website marketing.

### Horizontal Layout (Desktop/Web)

```
+---------------+     +---------------+     +---------------+
|               |     |               |     |               |
|   UPLOAD      | --> |   PROTECT     | --> |   VERIFY      |
|               |     |               |     |               |
|  [Upload      |     |  [Shield      |     |  [Checkmark   |
|   icon]       |     |   icon]       |     |   icon]       |
|               |     |               |     |               |
|  "Upload any  |     |  "7 security  |     |  "Open the    |
|   document"   |     |   layers,     |     |   .pvf file.  |
|               |     |   zero        |     |   Stamp       |
|               |     |   content     |     |   spins if    |
|               |     |   access"     |     |   authentic." |
+---------------+     +---------------+     +---------------+
```

### Vertical Layout (Mobile/Social)

Same three steps stacked vertically with connecting arrows between them.

### Specifications

- Icons: SVG, stroke-based, 48x48px design grid
- Upload icon: document with upward arrow
- Protect icon: shield with lock
- Verify icon: checkmark in circle (or spinning stamp representation)
- Arrow connectors: brand gradient, subtle, not heavy
- Step numbers: "1", "2", "3" in circles, Inter 800
- Background: white (`#ffffff`) or light (`#f8f7ff`)
- Step cards: subtle border (`rgba(79, 70, 229, 0.1)`), rounded corners (12px)

### Export Formats

| Format | Dimensions | Use Case |
|--------|-----------|----------|
| SVG | Scalable | Website, responsive |
| PNG | 1200 x 400 px | Horizontal (web banner) |
| PNG | 1080 x 1080 px | Vertical (Instagram) |
| PNG | 600 x 1200 px | Vertical (mobile/Stories) |

---

## Asset 4: Industry Cards (Set of 4)

Consistent set of four social cards, one per target vertical. Used throughout the content calendar for industry-specific posts.

### Card Template

```
+----------------------------------+
|  [padding 60px]                  |
|                                  |
|  [INDUSTRY ICON]                 |
|  64x64, stroke, white            |
|                                  |
|  [INDUSTRY NAME]                 |
|  Inter 800, 32px, #f8f7ff        |
|                                  |
|  [ONE-LINE VALUE PROP]           |
|  Inter 400, 18px, rgba(248,      |
|  247, 255, 0.8)                  |
|                                  |
|  [Vertifile logo, small]         |
|  bottom-right, 24px height       |
|                                  |
+----------------------------------+
```

### The Four Cards

| Card | Industry | Icon | Value Prop |
|------|----------|------|-----------|
| 1 | Legal | Gavel (stroke, clean) | Contracts that prove themselves. Tamper detection built into every document. |
| 2 | Healthcare | Stethoscope (stroke, clean) | Medical records protected in transit. BLIND processing for HIPAA compliance. |
| 3 | Education | Graduation cap (stroke, clean) | Diplomas that cannot be forged. Instant verification for every credential. |
| 4 | Finance | Chart / trending-up (stroke, clean) | Financial documents with built-in audit trails. Cryptographic proof of integrity. |

### Styling

- Background: dark (`#0f0e17`) with subtle brand gradient glow behind the icon
- Icon: white stroke, 2px weight, 64x64px
- Industry name: Inter 800, 32px, `#f8f7ff`
- Value prop: Inter 400, 18px, `rgba(248, 247, 255, 0.8)`
- Vertifile logo: white version, 24px height, bottom-right corner with 40px padding
- Corners: 16px radius
- No decorative elements beyond the icon and text -- clean and professional

### Export Formats

| Format | Dimensions | Use Case |
|--------|-----------|----------|
| PNG | 1200 x 628 px | LinkedIn, Twitter/X, Facebook |
| PNG | 1080 x 1080 px | Instagram square |
| SVG | Scalable | Website use |

---

## Asset 5: Patent Pending Badge

Small, elegant badge for marketing materials, website footer, and documentation.

### Design

```
+------------------------------------+
|                                    |
|   [Shield icon]  PATENT PENDING    |
|                  Israel            |
|                                    |
+------------------------------------+
```

### Specifications

- Shape: rounded rectangle (8px radius) or pill shape
- Background: `#7c3aed` (Vertifile purple) with subtle gradient to `#4f46e5`
- Alternative: transparent background with `#7c3aed` border (2px)
- Shield icon: left-aligned, white, 16px height
- Text line 1: "PATENT PENDING" -- Inter 700, 12px, `#ffffff`, letter-spacing: 1px, uppercase
- Text line 2: "Israel" -- Inter 400, 10px, `rgba(255, 255, 255, 0.8)`
- Overall height: 32px (compact) or 40px (standard)
- Padding: 12px horizontal, 8px vertical

### Variations

| Variation | Background | Text | Border | Use Case |
|-----------|-----------|------|--------|----------|
| Primary | `#7c3aed` | White | None | Dark backgrounds |
| Outline | Transparent | `#7c3aed` | 2px `#7c3aed` | Light backgrounds |
| Dark | `#0f0e17` | White | None | Any background |
| White | `#ffffff` | `#7c3aed` | None | Colored backgrounds |

### Export Formats

| Format | Dimensions | Use Case |
|--------|-----------|----------|
| SVG | Scalable | Web (primary format) |
| PNG | 200 x 40 px (@1x) | Email signatures |
| PNG | 400 x 80 px (@2x) | Retina displays |
| PNG | 600 x 120 px (@3x) | High-resolution print |

---

## Asset 6: Open Graph Social Cards

Standardized OG images for every major page on vertifile.com. These appear when links are shared on social media.

### Template Layout

```
+----------------------------------------------------------+
|  [padding 80px]                                           |
|                                                           |
|  VERTIFILE LOGO (white, 40px height)                     |
|  top-left                                                 |
|                                                           |
|  [vertical space 40px]                                    |
|                                                           |
|  PAGE HEADLINE                                            |
|  Inter 800, 48px, #f8f7ff                                |
|  max 2 lines, left-aligned                                |
|                                                           |
|  [vertical space 16px]                                    |
|                                                           |
|  SUBHEADLINE                                              |
|  Inter 400, 24px, rgba(248, 247, 255, 0.7)              |
|  max 1 line                                               |
|                                                           |
|                                    [PAGE-SPECIFIC         |
|                                     GRAPHIC ELEMENT]      |
|                                     right side            |
|  [padding 80px]                                           |
+----------------------------------------------------------+
```

### Pages and Content

| Page | Headline | Subheadline | Graphic Element |
|------|----------|-------------|-----------------|
| Homepage | Make Document Forgery Impossible | Tamper-proof documents with a live verification stamp | PVF stamp animation frame + fortress outline |
| Pricing | Simple Pricing for Document Security | Free tier included. No credit card required. | Pricing tier icons (3 columns) |
| Legal | Document Verification for Law Firms | Contracts that prove themselves. | Gavel icon, large, subtle |
| Healthcare | Protect Medical Records in Transit | BLIND processing for HIPAA compliance. | Stethoscope icon, large, subtle |
| Education | Fraud-Proof Academic Credentials | Diplomas that verify themselves instantly. | Graduation cap icon, large, subtle |
| Finance | Financial Document Integrity | Cryptographic proof for every audit. | Chart icon, large, subtle |

### Styling

- Background: `#0f0e17` with subtle grid pattern
- Optional: gradient glow from bottom-left (`#4f46e5` at 10% opacity)
- All text: left-aligned, left 60% of canvas
- Graphic element: right 40% of canvas, large, subtle opacity (30-40%)
- Vertifile logo: white version
- No decorative borders or frames

### Export Formats

| Format | Dimensions | Use Case |
|--------|-----------|----------|
| PNG | 1200 x 630 px | Open Graph (Facebook, LinkedIn, default) |
| PNG | 1200 x 600 px | Twitter summary large image card |

Total OG cards needed: 6 (one per page listed above).

---

## Production Checklist

Before delivering any asset, Gal confirms:

- [ ] Brand colors only -- no off-palette colors anywhere
- [ ] Inter font for English, Heebo for Hebrew
- [ ] Vertifile logo in correct placement and minimum size
- [ ] Sufficient contrast (text on backgrounds)
- [ ] No stock photos, no generic imagery
- [ ] Clean white space, not visually cluttered
- [ ] SVG version exists for all web-use assets
- [ ] All PNG exports at correct dimensions
- [ ] No decorative emojis -- SVG icons only
- [ ] Tested on both dark and light backgrounds where applicable
- [ ] Mobile-safe versions exported for Instagram and Stories
- [ ] File naming convention: `vertifile-[asset-name]-[dimension].png`

---

## File Naming Convention

```
vertifile-pvf-fortress-full-1200x628.png
vertifile-pvf-fortress-full-1080x1080.png
vertifile-pvf-fortress-ring1-1080x1080.png
vertifile-pvf-fortress-ring2-1080x1080.png
...
vertifile-before-after-standard-1200x628.png
vertifile-before-after-tamper-1200x628.png
vertifile-3steps-horizontal-1200x400.png
vertifile-3steps-vertical-1080x1080.png
vertifile-industry-legal-1080x1080.png
vertifile-industry-healthcare-1080x1080.png
vertifile-industry-education-1080x1080.png
vertifile-industry-finance-1080x1080.png
vertifile-patent-badge-primary.svg
vertifile-patent-badge-outline.svg
vertifile-og-homepage-1200x630.png
vertifile-og-pricing-1200x630.png
vertifile-og-legal-1200x630.png
vertifile-og-healthcare-1200x630.png
vertifile-og-education-1200x630.png
vertifile-og-finance-1200x630.png
```

---

## Asset Delivery Timeline

| Asset | Content Calendar Days Used | Priority |
|-------|---------------------------|----------|
| PVF Fortress (7 variations) | Days 8-14 | HIGH -- needed before Week 2 |
| Before/After Comparison | Day 15 | HIGH -- needed before Week 3 |
| 3-Step Process Diagram | Day 6 | HIGH -- needed before Day 6 |
| Industry Cards (4) | Days 4, 5, 17, 18 | HIGH -- needed before Day 4 |
| Patent Pending Badge | Day 26, ongoing | MEDIUM -- website + Day 26 |
| OG Social Cards (6) | Ongoing (link shares) | MEDIUM -- website launch |

Gal should prioritize: Industry Cards and 3-Step Diagram first (needed in Week 1), then Fortress variations (needed for Week 2), then Before/After (needed for Week 3).

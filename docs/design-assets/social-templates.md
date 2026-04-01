# Vertifile Social Media Templates

> Maintained by Gal, Graphic Designer | Last updated: 2026-04-01
> Refer to [Brand Guidelines](brand-guidelines.md) for all color, typography, and spacing tokens.

---

## 1. LinkedIn Banner

### Dimensions
- **Size:** 1584 x 396 px
- **Safe zone:** 1200 x 300 px (centered) -- key content must stay within this area
- **File format:** PNG, RGB, max 8 MB

### Layout Guide
```
+------------------------------------------------------------------+
|  [margin 80px]                                                    |
|                                                                   |
|    VERTIFILE LOGO (left-aligned, 48px height)                     |
|                                                                   |
|    HEADLINE (Inter 800, 42px, #f8f7ff)                            |
|    max 2 lines, left-aligned                                      |
|                                                                   |
|    TAGLINE (Inter 400, 20px, rgba(248,247,255,0.8))               |
|    single line beneath headline                                   |
|                                                                   |
|                                              [GRAPHIC ELEMENT]    |
|                                              right 1/3 of frame   |
|  [margin 80px]                                                    |
+------------------------------------------------------------------+
```

### Specifications
- **Background:** Gradient `linear-gradient(135deg, #4f46e5, #7c3aed)` or Dark `#0f0e17`
- **Headline:** Inter 800, 42px, `#f8f7ff`
- **Tagline:** Inter 400, 20px, `rgba(248, 247, 255, 0.8)`
- **Logo:** White version, 48px height, top-left with 80px margin
- **Graphic element:** Abstract verification pattern or PVF icon, positioned in right third
- **Avoid:** Text in outer 192px on left/right edges (profile picture overlap on mobile)

---

## 2. Instagram Post

### Dimensions
- **Square post:** 1080 x 1080 px
- **Portrait post:** 1080 x 1350 px (preferred for feed visibility)
- **File format:** PNG or JPG, RGB

### Grid System
```
Square (1080 x 1080):
+----------------------------------+
|  [padding 80px all sides]        |
|                                  |
|  +--------------------------+    |
|  |                          |    |
|  |   CONTENT ZONE           |    |
|  |   920 x 920 px           |    |
|  |                          |    |
|  +--------------------------+    |
|                                  |
+----------------------------------+

Portrait (1080 x 1350):
+----------------------------------+
|  [top 80px]                      |
|                                  |
|  LOGO (32px height, centered)    |
|  [24px gap]                      |
|  HEADLINE (Inter 800, 48px)      |
|  centered, max 3 lines           |
|  [32px gap]                      |
|  BODY (Inter 400, 24px)          |
|  centered, max 4 lines           |
|  [auto space]                    |
|  CTA LINE (Inter 800, 20px)      |
|  [bottom 80px]                   |
+----------------------------------+
```

### Specifications
- **Background options:**
  - Gradient: `linear-gradient(135deg, #4f46e5, #7c3aed)`
  - Dark: `#0f0e17`
  - Light: `#f8f7ff` (with dark text)
- **Headline:** Inter 800, 48px
  - On dark/gradient backgrounds: `#f8f7ff`
  - On light backgrounds: `#0f0e17`
- **Body:** Inter 400, 24px
  - On dark/gradient backgrounds: `rgba(248, 247, 255, 0.85)`
  - On light backgrounds: `rgba(15, 14, 23, 0.7)`
- **CTA text:** Inter 800, 20px, `#4f46e5` on light or `#f8f7ff` on dark
- **Logo:** Centered at top, 32px height
- **Corners:** Keep 80px padding for Instagram's rounded crop

### Carousel Posts
- All slides share the same background treatment.
- Slide 1: Hook headline only (large, centered).
- Slides 2-9: Content with consistent header position.
- Final slide: CTA with website URL and logo.

---

## 3. Twitter / X Header

### Dimensions
- **Size:** 1500 x 500 px
- **Safe zone:** 1300 x 360 px (centered) -- profile picture overlaps bottom-left
- **File format:** PNG or JPG, RGB, max 5 MB

### Layout Guide
```
+---------------------------------------------------------------+
|  [top 70px]                                                    |
|                                                                |
|          HEADLINE (Inter 800, 48px, centered)                  |
|          max 1 line                                            |
|                                                                |
|          TAGLINE (Inter 400, 24px, centered)                   |
|          max 1 line                                            |
|                                                                |
|  [AVOID bottom-left 200x200 - profile picture area]           |
|  [bottom 70px]                                                 |
+---------------------------------------------------------------+
```

### Specifications
- **Background:** Gradient `linear-gradient(135deg, #4f46e5, #7c3aed)` or Dark `#0f0e17`
- **Headline:** Inter 800, 48px, `#f8f7ff`, horizontally centered
- **Tagline:** Inter 400, 24px, `rgba(248, 247, 255, 0.8)`, below headline with 16px gap
- **Logo:** White version, 40px height, top-right corner with 60px margin
- **Avoid:** Bottom-left 200 x 200 px area (profile picture overlap)
- **Avoid:** Outer 100px on left/right edges (mobile crop)

---

## 4. YouTube Thumbnail

### Dimensions
- **Size:** 1280 x 720 px (16:9)
- **Safe zone:** 1140 x 640 px (centered)
- **File format:** JPG or PNG, RGB, max 2 MB

### Text Placement Guide
```
+---------------------------------------------------------------+
|  [top 40px]                                                    |
|                                                                |
|  +---LEFT 60%---+  +---RIGHT 40%---+                           |
|  |               |  |               |                          |
|  |  MAIN TITLE   |  |   VISUAL /    |                          |
|  |  (Inter 800)  |  |   SCREENSHOT  |                          |
|  |  max 4 words  |  |   or ICON     |                          |
|  |  per line     |  |               |                          |
|  |               |  |               |                          |
|  +---------------+  +---------------+                          |
|                                                                |
|  [BADGE bottom-left]   [LOGO bottom-right]                     |
|  [bottom 40px]                                                 |
+---------------------------------------------------------------+

Note: Bottom-right 170x40 px reserved for YouTube timestamp overlay.
```

### Specifications
- **Background:** Dark `#0f0e17` or a branded background image with 60% dark overlay
- **Title text:** Inter 800, 64px, `#f8f7ff`
  - Text outline/shadow: `2px 2px 0 rgba(15, 14, 23, 0.6)` for readability
  - Left-aligned, positioned in left 60% of frame
  - Maximum 6-8 words total, broken into 2-3 lines
- **Accent highlight:** Key word in title colored `#4f46e5` or backed by gradient pill
- **Badge:** Bottom-left, pill shape (9999px radius), gradient background, Inter 800 12px, `#f8f7ff` -- used for episode number or category
- **Logo:** White version, 36px height, bottom-right (above timestamp zone)
- **Visual element:** Right 40% of frame, screenshot or icon at 90% opacity
- **Avoid:** Bottom-right 170 x 40 px (YouTube timestamp overlay)
- **Avoid:** Text smaller than 48px (unreadable at thumbnail scale)

---

## Quick Reference Table

| Platform          | Dimensions      | Safe Zone        | BG Options                    | Headline Font         |
|-------------------|-----------------|------------------|-------------------------------|-----------------------|
| LinkedIn Banner   | 1584 x 396      | 1200 x 300       | Gradient, Dark                | Inter 800, 42px       |
| Instagram Square  | 1080 x 1080     | 920 x 920        | Gradient, Dark, Light         | Inter 800, 48px       |
| Instagram Portrait| 1080 x 1350     | 920 x 1190       | Gradient, Dark, Light         | Inter 800, 48px       |
| Twitter Header    | 1500 x 500      | 1300 x 360       | Gradient, Dark                | Inter 800, 48px       |
| YouTube Thumbnail | 1280 x 720      | 1140 x 640       | Dark, Dark overlay on image   | Inter 800, 64px       |

### Color Quick Reference (all templates)
- **Primary gradient:** `linear-gradient(135deg, #4f46e5, #7c3aed)`
- **Dark background:** `#0f0e17`
- **Light background:** `#f8f7ff`
- **Light text:** `#f8f7ff`
- **Dark text:** `#0f0e17`
- **Muted text (on dark):** `rgba(248, 247, 255, 0.8)`
- **Muted text (on light):** `rgba(15, 14, 23, 0.7)`

# Vertifile Brand Guidelines

> Maintained by Gal, Graphic Designer | Last updated: 2026-04-01

---

## 1. Logo Usage

### Clear Space
- Minimum clear space around the logo equals the height of the "V" mark on all sides.
- No text, icons, or visual elements may enter the clear space zone.

### Minimum Size
- **Digital:** 32px height minimum
- **Print:** 12mm height minimum

### Logo Don'ts
- Do not rotate or skew the logo.
- Do not change logo colors outside the approved palette.
- Do not place the logo on busy or low-contrast backgrounds.
- Do not add drop shadows, outlines, or effects to the logo.
- Do not stretch or compress the logo disproportionately.
- Do not crop or partially hide any part of the mark.

---

## 2. Color Palette

### Primary Colors

| Name      | Hex       | RGB             | Usage                          |
|-----------|-----------|-----------------|--------------------------------|
| Primary   | `#4f46e5` | 79, 70, 229     | CTAs, links, active states     |
| Secondary | `#7c3aed` | 124, 58, 237    | Accents, gradients, highlights |

### Neutral Colors

| Name  | Hex       | RGB             | Usage                          |
|-------|-----------|-----------------|--------------------------------|
| Dark  | `#0f0e17` | 15, 14, 23      | Text, dark backgrounds         |
| Light | `#f8f7ff` | 248, 247, 255   | Page backgrounds, light cards  |

### Semantic Colors

| Name    | Hex       | RGB             | Usage                          |
|---------|-----------|-----------------|--------------------------------|
| Success | `#16a34a` | 22, 163, 74     | Verified states, confirmations |
| Error   | `#dc2626` | 220, 38, 38     | Errors, destructive actions    |
| Warning | `#f59e0b` | 245, 158, 11    | Alerts, pending states         |

### Gradient

```css
background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
```

Use the primary-to-secondary gradient for hero sections, prominent CTAs, and feature highlights.

### Contrast Rules
- Text on `#0f0e17` backgrounds must use `#f8f7ff` or white.
- Text on `#f8f7ff` backgrounds must use `#0f0e17`.
- Never place Primary text on Secondary backgrounds (insufficient contrast).

---

## 3. Typography

### Font Stack

| Font   | Weight | Usage                     |
|--------|--------|---------------------------|
| Inter  | 800    | Headings (H1-H4)          |
| Inter  | 400    | Body text, paragraphs     |
| Heebo  | 700    | Hebrew headings           |
| Heebo  | 400    | Hebrew body text          |

### Type Scale

| Element | Size   | Line Height | Weight | Letter Spacing |
|---------|--------|-------------|--------|----------------|
| H1      | 48px   | 1.1         | 800    | -0.02em        |
| H2      | 36px   | 1.2         | 800    | -0.01em        |
| H3      | 24px   | 1.3         | 800    | 0              |
| H4      | 18px   | 1.4         | 800    | 0              |
| Body    | 16px   | 1.6         | 400    | 0              |
| Small   | 14px   | 1.5         | 400    | 0              |
| Caption | 12px   | 1.4         | 400    | 0.01em         |

### Font Loading

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;800&family=Heebo:wght@400;700&display=swap" rel="stylesheet">
```

---

## 4. Spacing System

**Base unit: 4px**

| Token   | Value | Usage                            |
|---------|-------|----------------------------------|
| `xs`    | 4px   | Inline icon gaps                 |
| `sm`    | 8px   | Tight element spacing            |
| `md`    | 16px  | Standard padding, card content   |
| `lg`    | 24px  | Section padding                  |
| `xl`    | 32px  | Component separation             |
| `2xl`   | 48px  | Section separation               |
| `3xl`   | 64px  | Page-level vertical rhythm       |

All spacing values must be multiples of 4px. No arbitrary pixel values.

---

## 5. Border Radius

| Element  | Radius | CSS Variable              |
|----------|--------|---------------------------|
| Cards    | 14px   | `--radius-card: 14px`     |
| Inputs   | 12px   | `--radius-input: 12px`    |
| Buttons  | 10px   | `--radius-button: 10px`   |
| Badges   | 9999px | `--radius-badge: 9999px`  |
| Tooltips | 8px    | `--radius-tooltip: 8px`   |

---

## 6. Shadow System

```css
/* Small - cards at rest, dropdowns */
--shadow-sm: 0 1px 3px rgba(15, 14, 23, 0.08), 0 1px 2px rgba(15, 14, 23, 0.06);

/* Medium - cards on hover, popovers */
--shadow-md: 0 4px 12px rgba(15, 14, 23, 0.10), 0 2px 4px rgba(15, 14, 23, 0.06);

/* Large - modals, floating panels */
--shadow-lg: 0 12px 32px rgba(15, 14, 23, 0.14), 0 4px 8px rgba(15, 14, 23, 0.08);
```

---

## 7. Animation & Motion

### Hover Effect
```css
.interactive-element:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
```

### Transition Defaults
```css
transition: all 0.3s ease;
```

### Motion Principles
- All interactive elements use `0.3s ease` transitions.
- Hover lift is always `translateY(-2px)` -- never more, never less.
- Page transitions use `0.3s` fade or slide.
- Loading spinners rotate at `1s linear infinite`.
- Avoid bounce or spring animations -- the brand is precise, not playful.

---

## 8. Do's and Don'ts

### Do
- Use the primary-to-secondary gradient for hero areas and key CTAs.
- Keep generous whitespace -- the product communicates trust through clarity.
- Use the 4px grid for all spacing decisions.
- Pair Inter 800 headings with Inter 400 body text for clear hierarchy.
- Apply `border-radius: 14px` to all card-like containers consistently.
- Use semantic colors only for their intended purpose (Success = verified, Error = failure).
- Test all color combinations for WCAG AA contrast (4.5:1 for text, 3:1 for large text).

### Don't
- Don't use more than two brand colors in a single component.
- Don't mix border-radius values within the same visual group.
- Don't apply the gradient to body text or small UI elements.
- Don't use pure black (`#000000`) -- always use Dark (`#0f0e17`).
- Don't use pure white (`#ffffff`) for backgrounds -- use Light (`#f8f7ff`).
- Don't animate with durations shorter than `0.15s` or longer than `0.5s`.
- Don't use Inter for Hebrew content or Heebo for English content.
- Don't introduce new colors without adding them to this guide.

# Vertifile Component Library

> Maintained by Gal, Graphic Designer | Last updated: 2026-04-01
> Refer to [Brand Guidelines](brand-guidelines.md) for color, typography, and spacing tokens.

---

## 1. Buttons

### Primary Button
```css
.btn-primary {
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: #ffffff;
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 16px;
  padding: 12px 24px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s ease;
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
}
.btn-primary:active {
  transform: translateY(0);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
```

### Secondary Button
```css
.btn-secondary {
  background: transparent;
  color: #4f46e5;
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 16px;
  padding: 12px 24px;
  border: 2px solid #4f46e5;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s ease;
}
.btn-secondary:hover {
  background: #4f46e5;
  color: #ffffff;
  transform: translateY(-2px);
}
```

### Ghost Button
```css
.btn-ghost {
  background: transparent;
  color: #4f46e5;
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 16px;
  padding: 12px 24px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s ease;
}
.btn-ghost:hover {
  background: rgba(79, 70, 229, 0.08);
  transform: translateY(-2px);
}
```

### Danger Button
```css
.btn-danger {
  background: #dc2626;
  color: #ffffff;
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 16px;
  padding: 12px 24px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s ease;
}
.btn-danger:hover {
  background: #b91c1c;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.35);
}
```

### Button Sizes

| Size   | Padding       | Font Size | Min Width |
|--------|---------------|-----------|-----------|
| Small  | 8px 16px      | 14px      | 80px      |
| Medium | 12px 24px     | 16px      | 120px     |
| Large  | 16px 32px     | 18px      | 160px     |

---

## 2. Cards

### Glass Card
```css
.card-glass {
  background: rgba(248, 247, 255, 0.6);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(79, 70, 229, 0.12);
  border-radius: 14px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(15, 14, 23, 0.08);
  transition: all 0.3s ease;
}
.card-glass:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(15, 14, 23, 0.10);
}
```

### Solid Card
```css
.card-solid {
  background: #f8f7ff;
  border: none;
  border-radius: 14px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(15, 14, 23, 0.08), 0 1px 2px rgba(15, 14, 23, 0.06);
  transition: all 0.3s ease;
}
.card-solid:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(15, 14, 23, 0.10), 0 2px 4px rgba(15, 14, 23, 0.06);
}
```

### Outlined Card
```css
.card-outlined {
  background: transparent;
  border: 2px solid rgba(79, 70, 229, 0.2);
  border-radius: 14px;
  padding: 24px;
  transition: all 0.3s ease;
}
.card-outlined:hover {
  border-color: #4f46e5;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.12);
}
```

---

## 3. Inputs

### Default Input
```css
.input-default {
  font-family: 'Inter', sans-serif;
  font-size: 16px;
  color: #0f0e17;
  background: #ffffff;
  padding: 12px 16px;
  border: 2px solid rgba(15, 14, 23, 0.15);
  border-radius: 12px;
  width: 100%;
  transition: all 0.3s ease;
}
```

### Focus State
```css
.input-default:focus {
  outline: none;
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
}
```

### Error State
```css
.input-error {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12);
}
.input-error-message {
  color: #dc2626;
  font-size: 14px;
  margin-top: 4px;
}
```

### Disabled State
```css
.input-disabled {
  background: rgba(15, 14, 23, 0.04);
  color: rgba(15, 14, 23, 0.4);
  border-color: rgba(15, 14, 23, 0.08);
  cursor: not-allowed;
}
```

### Input with Label
```css
.input-label {
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 14px;
  color: #0f0e17;
  margin-bottom: 8px;
  display: block;
}
```

---

## 4. Badges

### Badge Base
```css
.badge {
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
```

### Badge Variants

| Variant | Background              | Text Color | Use Case              |
|---------|-------------------------|------------|-----------------------|
| Success | `rgba(22,163,74,0.12)`  | `#16a34a`  | Verified, active      |
| Warning | `rgba(245,158,11,0.12)` | `#f59e0b`  | Pending, attention    |
| Error   | `rgba(220,38,38,0.12)`  | `#dc2626`  | Failed, expired       |
| Info    | `rgba(79,70,229,0.12)`  | `#4f46e5`  | Neutral info, default |

```css
.badge-success { background: rgba(22, 163, 74, 0.12); color: #16a34a; }
.badge-warning { background: rgba(245, 158, 11, 0.12); color: #f59e0b; }
.badge-error   { background: rgba(220, 38, 38, 0.12); color: #dc2626; }
.badge-info    { background: rgba(79, 70, 229, 0.12); color: #4f46e5; }
```

---

## 5. Toast Notifications

### Toast Base
```css
.toast {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  padding: 16px 20px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 12px 32px rgba(15, 14, 23, 0.14), 0 4px 8px rgba(15, 14, 23, 0.08);
  max-width: 420px;
  animation: toast-in 0.3s ease;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### Toast Variants
```css
.toast-success {
  background: #ffffff;
  border-left: 4px solid #16a34a;
  color: #0f0e17;
}
.toast-error {
  background: #ffffff;
  border-left: 4px solid #dc2626;
  color: #0f0e17;
}
.toast-warning {
  background: #ffffff;
  border-left: 4px solid #f59e0b;
  color: #0f0e17;
}
.toast-info {
  background: #ffffff;
  border-left: 4px solid #4f46e5;
  color: #0f0e17;
}
```

### Toast Positioning
- Default position: bottom-right, 24px from edges.
- Stack upward with 8px gap between toasts.
- Auto-dismiss after 5 seconds with fade-out.

---

## 6. Modals / Dialogs

### Modal Overlay
```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 14, 23, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: overlay-in 0.3s ease;
}

@keyframes overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```

### Modal Container
```css
.modal {
  background: #f8f7ff;
  border-radius: 14px;
  padding: 32px;
  width: 90%;
  max-width: 520px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 12px 32px rgba(15, 14, 23, 0.14), 0 4px 8px rgba(15, 14, 23, 0.08);
  animation: modal-in 0.3s ease;
}

@keyframes modal-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
```

### Modal Header
```css
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.modal-title {
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 24px;
  color: #0f0e17;
}
```

### Modal Footer
```css
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid rgba(15, 14, 23, 0.08);
}
```

---

## 7. Tables

### Table Base
```css
.table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
}
```

### Table Header
```css
.table th {
  background: rgba(79, 70, 229, 0.06);
  color: #0f0e17;
  font-weight: 800;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 12px 16px;
  text-align: left;
  border-bottom: 2px solid rgba(79, 70, 229, 0.12);
}
.table th:first-child { border-radius: 14px 0 0 0; }
.table th:last-child  { border-radius: 0 14px 0 0; }
```

### Table Rows
```css
.table td {
  padding: 12px 16px;
  color: #0f0e17;
  border-bottom: 1px solid rgba(15, 14, 23, 0.06);
}
.table tr:hover td {
  background: rgba(79, 70, 229, 0.03);
}
.table tr:last-child td {
  border-bottom: none;
}
```

### Responsive Table Wrapper
```css
.table-wrapper {
  background: #f8f7ff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(15, 14, 23, 0.08);
  overflow-x: auto;
}
```

---

## 8. Navigation Patterns

### Top Navigation Bar
```css
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 32px;
  background: rgba(248, 247, 255, 0.8);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(79, 70, 229, 0.08);
  position: sticky;
  top: 0;
  z-index: 100;
}
```

### Nav Link
```css
.nav-link {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: 16px;
  color: #0f0e17;
  text-decoration: none;
  padding: 8px 16px;
  border-radius: 10px;
  transition: all 0.3s ease;
}
.nav-link:hover {
  background: rgba(79, 70, 229, 0.08);
  color: #4f46e5;
}
.nav-link.active {
  font-weight: 800;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.08);
}
```

### Mobile Navigation
```css
.mobile-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  padding: 12px 16px;
  background: #f8f7ff;
  border-top: 1px solid rgba(79, 70, 229, 0.08);
  box-shadow: 0 -2px 8px rgba(15, 14, 23, 0.06);
  z-index: 100;
}
```

### Sidebar Navigation
```css
.sidebar {
  width: 260px;
  background: #f8f7ff;
  border-right: 1px solid rgba(79, 70, 229, 0.08);
  padding: 24px 16px;
  height: 100vh;
  position: sticky;
  top: 0;
  overflow-y: auto;
}
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 10px;
  color: #0f0e17;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  text-decoration: none;
  transition: all 0.3s ease;
}
.sidebar-item:hover {
  background: rgba(79, 70, 229, 0.08);
  color: #4f46e5;
}
.sidebar-item.active {
  background: rgba(79, 70, 229, 0.12);
  color: #4f46e5;
  font-weight: 800;
}
```

### Breadcrumbs
```css
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  color: rgba(15, 14, 23, 0.5);
}
.breadcrumbs a {
  color: #4f46e5;
  text-decoration: none;
}
.breadcrumbs a:hover {
  text-decoration: underline;
}
.breadcrumbs .separator {
  color: rgba(15, 14, 23, 0.3);
}
```

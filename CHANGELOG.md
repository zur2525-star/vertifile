# Changelog

All notable changes to the Vertifile PVF project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [4.6.0] - 2026-04-16

### Added
- OpenAPI specification completed — 48 paths documented, fully synced with implementation
- API key management endpoints and branding customization endpoints
- 6 new test suites covering previously untested security-critical paths
- Password reset flow tests and account deletion tests
- Admin panel tests and DB lockout tests
- CSP nonces on all server-rendered pages
- Prometheus metrics endpoint at `/metrics` for operational observability
- Environment variable validation on startup — server refuses to boot with missing secrets
- Cookie consent banner and dedicated cookie policy page
- Data Processing Agreement (DPA) page

### Changed
- Session secret hardened — minimum entropy enforced, rotation supported
- Error handling standardized across all routes — no stack traces leak to clients
- Compression tuning — response sizes reduced for static and API responses
- Health check endpoint extended with detailed service metrics

### Fixed
- MIME type corrected from `application/pvf` to `application/vnd.vertifile.pvf` across all code paths
- Session fixation vulnerability patched — new session ID issued on login
- CSRF exclusion list corrected — webhook and API key routes properly exempted
- Unique email constraint enforced at signup test level to prevent false failures
- Webhook DNS test skipped in environments without external DNS access

### Security
- IANA MIME type `application/vnd.vertifile.pvf` officially registered (2026-04-15)
- HSTS header enforced on all HTTPS responses
- Rate limiting added to authentication, upload, and API routes
- Input validation hardened on all user-supplied fields
- DNS rebinding attack vector closed
- XSS sanitization added to all rendered user content
- 5 SQL injection vulnerabilities patched — all queries use parameterized statements
- 6 missing database indexes added to prevent timing-based enumeration
- Session consistency enforced — session data validated on every authenticated request
- Account lockout after repeated failed login attempts

---

## [4.5.0] - 2026-04-11 / 2026-04-12

### Added
- Phase 3C-E: API key rotation system — generate, rotate, and revoke API keys
- Chained token refresh — access tokens silently refresh without forcing re-login
- Resend email integration for transactional email delivery
- 5-email onboarding sequence — welcome through upgrade prompts
- Help center page with self-service support articles
- Password reset email flow — token-based, time-limited
- Plausible analytics integrated on all public pages
- Verification codes migrated to PostgreSQL for persistence and auditability
- GET `/api/status` endpoint for external health monitoring
- DB backup script and graceful shutdown handler
- `robots.txt`, `sitemap.xml`, and `security.txt` files
- 7 blog articles with CISO-level content — security analogies, business cases, glossaries
- Blog hero images — unique SVG illustration for each article
- 4 industry-specific landing pages: Legal, Healthcare, Education, Finance
- 30-day content calendar and visual asset specifications
- Professional SVG visual assets: fortress, process, comparison, industries, OG image
- Promo video section on homepage — autoplays when scrolled into view, pauses on exit
- Comprehensive E2E test suite covering upload, auth, stamp, overage, and verify flows
- Thumbnail sidebar in desktop PVF viewer for multi-page PDF navigation
- Auto-compression of stamp logos on client side before upload
- Unified share link — same URL used in upload card, document list, and sidebar

### Changed
- Pricing model updated: Pro $49/500 docs, Business $79/1000 docs, with overage billing
- Free plan removed from entire codebase — was never a real product tier
- Dashboard deprecated in favor of new `/app` interface
- `db.js` God Object refactored into 4 domain-specific repository modules
- i18n system fully rewritten — global `_t()` wrapper, zero hardcoded text, full re-render on language switch
- All dashboard tabs dynamically rendered with i18n — no more mixed-language UI
- Blog hero overlays redesigned — dark purple gradient for readable white text on light SVGs
- Contact page switched from dark to light/white theme
- Security section redesigned as connected card grid

### Fixed
- i18n timing fixed — translations apply after dashboard renders, not before
- Cache busting added to `i18n.js` and locale JSON fetches
- All 8 non-English locales had English placeholder values — replaced with real translations
- View toggle button order, shape, and active states corrected
- LTR direction forced on view toggle to prevent RTL layout flip
- Landing page footer grid, OG image, broken links, and em-dash consistency
- Duplicate DOM IDs removed; dead upload modal removed
- PDF thumbnail sidebar repositioned outside `page-wrap` for correct fixed positioning
- Mobile layout — 25 layout issues fixed across homepage
- Blog hero overlay brightness and z-index issues resolved
- Navbar color on scroll corrected for blog article pages
- `waveColor` parsing, download slug support, and Getting Started progress tracker fixed

### Security
- Comprehensive security sweep: XSS, CSRF, memory safety, dead dependency removal
- CSRF protection added using synchronizer token pattern

---

## [4.4.0] - 2026-04-11

### Added
- Tauri-based desktop viewer for Windows — native app wrapping the PVF renderer
- Windows build pipeline configured and tested
- Stamp preview hook shown on first document upload to drive activation
- Getting Started progress tracker in dashboard onboarding flow

### Changed
- Dashboard redesigned per user segment: private, business, organization
- Accessibility, brand consistency, and UX sweep across all pages

### Fixed
- PVF viewer toolbar restored after accidental removal during overlay refactor
- Slug usage unified across upload, list, and share flows

---

## [4.3.0] - 2026-04-11

### Added
- Self-service signup with user segmentation questionnaire (private / business / organization)
- Public demo mode — visitors can preview a stamped document without signing up
- Email verification flow on signup
- Contact form with routed contact emails
- JSON-LD structured data on public pages for SEO
- Cache headers set correctly on all static and API responses

### Changed
- CSP tightened — `mediaSrc` directive added for video assets
- Session secret hardening (initial pass)

---

## [4.2.0] - 2026-04-11

### Added
- Official PVF file format specification document
- IANA MIME type registration application filed for `application/vnd.vertifile.pvf`
- Shareable document links — verifiable URL per stamped document
- i18n foundation — language switcher, 10 supported locales, locale JSON files

### Changed
- Verification codes moved to database from in-memory store

---

## [4.0.0 - 4.1.x] - Earlier

### Added
- Core PVF document format: encrypt, stamp, and embed verification metadata
- Upload pipeline: accept PDF, encrypt, generate stamp, store in PostgreSQL
- PVF viewer: decrypt and render stamped documents in-browser
- Stamp configuration: custom logo, colors, and organization branding
- Authentication system: signup, login, JWT sessions
- Document list and grid views in dashboard
- Overage billing logic for documents beyond plan limits
- Initial pricing page
- Initial marketing landing page with How It Works section

### Changed
- Architecture established: Express backend, PostgreSQL, Node.js services

---

[4.6.0]: https://github.com/vertifile/pvf-project/compare/v4.5.0...v4.6.0
[4.5.0]: https://github.com/vertifile/pvf-project/compare/v4.4.0...v4.5.0
[4.4.0]: https://github.com/vertifile/pvf-project/compare/v4.3.0...v4.4.0
[4.3.0]: https://github.com/vertifile/pvf-project/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/vertifile/pvf-project/compare/v4.1.0...v4.2.0

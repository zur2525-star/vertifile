# Feature Roadmap — Vertifile

## Feature 1: Batch Upload

**Priority:** High
**Effort:** 8 days
**Status:** Planned

### User Story
As an enterprise administrator, I want to upload multiple documents at once so that I can protect hundreds of credentials (diplomas, certificates) in a single session without repeating the process for each file.

### Technical Approach
- Add multi-file input support to the upload endpoint (`/api/create-pvf`)
- Accept `multipart/form-data` with multiple file fields or a ZIP archive
- Process files in parallel using a worker queue (Bull/BullMQ on Redis)
- Return a batch ID with status polling endpoint (`/api/batch/:id/status`)
- Add progress tracking and per-file error reporting
- Dashboard UI: drag multiple files, show progress bar per file, download all as ZIP

### Acceptance Criteria
- Upload up to 100 files in a single request
- Each file processed independently (one failure doesn't block others)
- Batch status endpoint returns per-file hash, signature, and download URL
- Enterprise dashboard shows batch history with re-download option

---

## Feature 2: Email Delivery

**Priority:** Medium
**Effort:** 5 days
**Status:** Planned

### User Story
As a document issuer, I want to send a protected .pvf file directly to a recipient's email from the dashboard so that I don't have to download the file and manually email it myself.

### Technical Approach
- Add email delivery option to the PVF creation flow (optional `recipient_email` field)
- Integrate transactional email provider (SendGrid or Postmark)
- Email contains: download link (not attachment — .pvf files can be large), share URL, and brief explanation of how to open and verify
- Bind recipient email hash to the PVF for recipient verification
- Log delivery events (sent, opened, downloaded) in audit trail
- Dashboard UI: "Send to recipient" button with email input and optional message

### Acceptance Criteria
- Recipient receives email within 60 seconds of PVF creation
- Email includes share link and instructions for verification
- Delivery status visible in dashboard (sent/delivered/opened)
- Recipient binding optional but recommended

---

## Feature 3: Document Expiration

**Priority:** Medium
**Effort:** 6 days
**Status:** Planned

### User Story
As a certificate issuer, I want to set an expiration date on protected documents so that time-limited credentials (e.g., annual licenses, temporary permits) automatically become invalid after the specified date.

### Technical Approach
- Add optional `expires_at` timestamp to document registration (`db.createDocument`)
- Store expiration in the database alongside hash and signature
- Modify verification endpoint to check expiration before returning "verified"
- Expired documents show a distinct visual state: stamp turns amber/orange with "EXPIRED" label
- PVF file embeds expiration date and checks it client-side as well
- API: accept `expires_in` (duration) or `expires_at` (ISO timestamp) parameter
- Dashboard: date picker for expiration when creating PVF, list view shows expiring-soon indicators

### Acceptance Criteria
- Expired documents show "EXPIRED" status on verification (not "FORGED")
- Visual distinction between expired (amber) and forged (red)
- Issuer can extend or revoke expiration from dashboard
- API supports both duration and absolute timestamp
- Expiring-soon notifications sent to issuer (7 days before)

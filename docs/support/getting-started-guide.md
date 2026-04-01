# Getting Started with Vertifile

## Step 1 — Create Your Account
Go to [vertifile.com/app](https://vertifile.com/app) and sign up with Google or email.
Free plan includes 1 protected document.

## Step 2 — Upload a Document
1. Click "New Document" in your dashboard
2. Drag a PDF, image (JPG/PNG), or text file
3. Maximum file size: 50MB

## Step 3 — Wait for Processing (~10 seconds)
Vertifile will:
- Compute a SHA-256 fingerprint (without reading your content)
- Sign it with HMAC-SHA256
- Generate the animated holographic stamp
- Create your .pvf file

## Step 4 — Download & Share
- Click "Download" to save your .pvf file
- Click "Share" to copy a verification link
- Send the .pvf to anyone — opens in any browser

## Step 5 — Verify
Recipients can verify at [vertifile.com/verify](https://vertifile.com/verify):
- ✅ Stamp spins green = Document is authentic
- ❌ Stamp freezes red = Document was tampered with

---

## For Developers — API Quick Start

```bash
# Get your API key at vertifile.com/signup

# Create a protected document
curl -X POST https://vertifile.com/api/create-pvf \
  -H "X-API-Key: YOUR_API_KEY" \
  -F "file=@document.pdf"

# Verify a document
curl -X POST https://vertifile.com/api/verify \
  -H "Content-Type: application/json" \
  -d '{"hash": "DOCUMENT_HASH"}'
```

Full API docs: [vertifile.com/integration](https://vertifile.com/integration)

---

## PVF Viewer Desktop App
For the best experience, download the PVF Viewer:
- **Mac:** Download DMG from the dashboard
- **Windows:** Coming soon

The Viewer adds: File menu, Print (original document), Properties panel, keyboard shortcuts.

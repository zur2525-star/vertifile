# Vertifile — FAQ

## Getting Started

**What is Vertifile?**
Vertifile is a document anti-forgery platform. It takes any document (PDF, image, text) and creates a tamper-proof .pvf file with a live holographic stamp that freezes red if the document is altered.

**מה זה Vertifile?**
Vertifile היא פלטפורמה להגנה על מסמכים מפני זיוף. היא לוקחת כל מסמך ויוצרת קובץ .pvf מוגן עם חותמת הולוגרפית חיה שקופאת אדומה אם המסמך שונה.

---

**What is a .pvf file?**
A Protected Verified File — a self-contained HTML document that includes the original file, cryptographic signature, and animated verification stamp. Opens in any browser.

**מה זה קובץ .pvf?**
קובץ מוגן ומאומת — מסמך HTML עצמאי שמכיל את הקובץ המקורי, חתימה קריפטוגרפית, וחותמת אימות אנימטיבית. נפתח בכל דפדפן.

---

**How do I protect a document?**
1. Go to vertifile.com/upload
2. Sign in or create an account
3. Drag your file (PDF, image, or text)
4. Wait 10 seconds
5. Download your .pvf file

---

**How do I verify a document I received?**
1. Go to vertifile.com/verify
2. Drag the .pvf file to the upload zone
3. If the stamp spins green — it's authentic
4. If the stamp freezes red — it's been tampered with

---

**Do I need to install anything?**
No. .pvf files open in any modern browser (Chrome, Firefox, Safari, Edge). For a better experience, download the free PVF Viewer desktop app.

---

## Security & Privacy

**Does Vertifile read my documents?**
No. Vertifile uses BLIND Processing — the server never reads, accesses, or stores your document content. Only a cryptographic hash (fingerprint) is computed. Your document stays on your device.

**האם Vertifile קוראת את המסמכים שלי?**
לא. Vertifile משתמשת בעיבוד BLIND — השרת לעולם לא קורא, ניגש, או שומר את תוכן המסמך שלך. רק טביעת אצבע קריפטוגרפית מחושבת.

---

**What are the 9 security layers?**
1. SHA-256 Hash (document fingerprint)
2. HMAC-SHA256 Signature (server-signed)
3. 5-Minute Token Refresh
4. Code Integrity Hash
5. Chained Token (binds all parameters)
6. Anti-DevTools Detection
7. JavaScript Obfuscation
8. Holographic Animated Stamp
9. Polygon Blockchain Anchoring

---

**Where is my data stored?**
Cryptographic hashes are stored on US/EU cloud infrastructure (Render + Neon PostgreSQL). Document content is never stored on our servers. Blockchain records are on Polygon (decentralized).

---

**What happens if Vertifile shuts down?**
Your .pvf files remain functional — they're self-contained HTML documents. Blockchain records on Polygon remain permanently accessible. We commit to 90 days advance notice.

---

## Pricing

**How much does it cost?**
- Free: $0/month — 25 documents/month, Vertifile-branded stamp, unlimited download/share/verify
- Pro: $19/month — 500 documents/month, custom branding, 1-year audit trail, API access
- Business: $12/seat/month (5-seat min) — 5,000 docs/seat/month, team accounts, SSO, custom domain
- Enterprise: Custom pricing — unlimited documents, white-label, on-prem, dedicated CSM

---

**Is there a free trial?**
Yes! The Free plan lets you protect up to 25 documents per month at no cost, with unlimited download, share, and verification. Pro plan includes a 14-day free trial.

---

**Can I cancel anytime?**
Yes. No long-term contracts. Cancel anytime from your dashboard.

---

## Technical

**What file formats are supported?**
PDF, PNG, JPG/JPEG, TXT. Up to 50MB per file.

---

**How do I integrate the API?**
See our API documentation at vertifile.com/integration. Quick start:
```bash
curl -X POST https://vertifile.com/api/create-pvf \
  -H "X-API-Key: YOUR_KEY" \
  -F "file=@document.pdf"
```

---

**Can I customize the stamp?**
Yes! Pro and Enterprise users can add their organization logo, brand color, and custom stamp text through the Branding settings.

---

**Does it work offline?**
The .pvf file displays the document offline. Full verification requires an internet connection to check the server-side hash.

---

**What's the maximum file size?**
50MB per file.

---

## Legal

**Is .pvf legally recognized?**
The .pvf format has a patent pending with the Israeli Patent Office and an IANA MIME type registration pending. While no Israeli court has ruled on .pvf specifically, it provides strong cryptographic evidence of document authenticity.

---

**Are you GDPR compliant?**
Yes. We process data under GDPR Article 6 legal bases (contract performance, legitimate interest, consent). We offer DPA agreements for Enterprise customers.

---

**Do you have a Data Processing Agreement (DPA)?**
Yes. Enterprise customers can request a DPA at privacy@vertifile.com.

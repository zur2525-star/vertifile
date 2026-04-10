# Vertifile -- מפרט תרגום (i18n): Zero-Knowledge

**תאריך:** 10 באפריל 2026
**מחלקה:** בינלאומיות (טל)
**סטטוס:** מפרט תרגום לביצוע

---

## 1. סקירה כללית

מסמך זה מפרט את כל המחרוזות הנדרשות לתרגום עבור תכונת ההצפנה Zero-Knowledge. כולל מיפוי לקובץ:שורה, ומבנה JSON עבור קבצי שפה.

---

## 2. מחרוזות -- תהליך העלאה (Upload Flow)

### 2.1 שלבי ההעלאה

| מפתח (key) | עברית (he) | אנגלית (en) | קובץ:שורה |
|---|---|---|---|
| `upload.encrypting` | מצפין... | Encrypting... | `app/share/cart/page.tsx:upload-section` |
| `upload.encrypted_success` | מוצפן ומוגן! | Encrypted and protected! | `app/share/cart/page.tsx:upload-success` |
| `upload.encrypted_link` | קישור שיתוף מוצפן | Encrypted share link | `app/share/cart/page.tsx:share-link` |
| `upload.encrypting_file` | מצפין את הקובץ... | Encrypting file... | `app/share/cart/page.tsx:encrypt-progress` |
| `upload.generating_hash` | מחשב טביעת אצבע... | Computing fingerprint... | `app/share/cart/page.tsx:hash-progress` |
| `upload.signing` | חותם דיגיטלית... | Signing digitally... | `app/share/cart/page.tsx:sign-progress` |
| `upload.uploading` | מעלה לשרת... | Uploading to server... | `app/share/cart/page.tsx:upload-progress` |
| `upload.complete` | ההעלאה הושלמה בהצלחה | Upload completed successfully | `app/share/cart/page.tsx:upload-complete` |

### 2.2 אזהרות ופעולות

| מפתח (key) | עברית (he) | אנגלית (en) | קובץ:שורה |
|---|---|---|---|
| `upload.save_link_warning` | שמור את הקישור! בלי הקישור המסמך לא ניתן לצפייה | Save the link! Without it the document cannot be viewed | `app/share/cart/page.tsx:link-warning` |
| `upload.copy_link` | העתק קישור | Copy link | `app/share/cart/page.tsx:copy-btn` |
| `upload.link_copied` | הקישור הועתק | Link copied | `app/share/cart/page.tsx:copy-confirm` |
| `upload.zk_badge` | מוגן Zero-Knowledge | Zero-Knowledge protected | `app/share/cart/page.tsx:zk-badge` |
| `upload.no_server_access` | לאף אחד, כולל Vertifile, אין גישה לתוכן המסמך | No one, including Vertifile, can access the document content | `app/share/cart/page.tsx:zk-explanation` |

---

## 3. מחרוזות -- צפייה במסמך (Viewer)

### 3.1 שלבי פענוח

| מפתח (key) | עברית (he) | אנגלית (en) | קובץ:שורה |
|---|---|---|---|
| `viewer.decrypting` | מפענח מסמך... | Decrypting document... | `app/v/[id]/page.tsx:decrypt-progress` |
| `viewer.key_not_found` | מפתח פענוח לא נמצא | Decryption key not found | `app/v/[id]/page.tsx:key-missing` |
| `viewer.decrypt_failed` | הפענוח נכשל | Decryption failed | `app/v/[id]/page.tsx:decrypt-error` |
| `viewer.rendering` | טוען מסמך... | Loading document... | `app/v/[id]/page.tsx:render-progress` |
| `viewer.verified` | המסמך אומת בהצלחה | Document verified successfully | `app/v/[id]/page.tsx:verify-success` |
| `viewer.page_count` | עמוד {current} מתוך {total} | Page {current} of {total} | `app/v/[id]/page.tsx:page-indicator` |

### 3.2 פעולות צופה

| מפתח (key) | עברית (he) | אנגלית (en) | קובץ:שורה |
|---|---|---|---|
| `viewer.zoom_in` | הגדל | Zoom in | `app/v/[id]/page.tsx:zoom-in` |
| `viewer.zoom_out` | הקטן | Zoom out | `app/v/[id]/page.tsx:zoom-out` |
| `viewer.download_original` | הורד מסמך מקורי | Download original document | `app/v/[id]/page.tsx:download-btn` |
| `viewer.print` | הדפס | Print | `app/v/[id]/page.tsx:print-btn` |

---

## 4. מחרוזות -- הודעות שגיאה (Error States)

### 4.1 שגיאות הצפנה

| מפתח (key) | עברית (he) | אנגלית (en) | קובץ:שורה |
|---|---|---|---|
| `error.encrypt_failed` | ההצפנה נכשלה. נא לנסות שוב | Encryption failed. Please try again | `app/share/cart/page.tsx:encrypt-error` |
| `error.browser_not_supported` | הדפדפן לא תומך בהצפנה. נא לעדכן לגרסה האחרונה | Browser does not support encryption. Please update to the latest version | `app/share/cart/page.tsx:browser-error` |
| `error.file_too_large` | הקובץ גדול מדי להצפנה (מקסימום {maxSize}) | File too large for encryption (maximum {maxSize}) | `app/share/cart/page.tsx:size-error` |
| `error.crypto_unavailable` | שירותי הצפנה לא זמינים. נא לוודא חיבור HTTPS | Encryption services unavailable. Please ensure HTTPS connection | `app/share/cart/page.tsx:crypto-error` |

### 4.2 שגיאות פענוח

| מפתח (key) | עברית (he) | אנגלית (en) | קובץ:שורה |
|---|---|---|---|
| `error.key_missing` | הקישור חסר את מפתח הפענוח. נא לוודא שהקישור המלא הועתק | The link is missing the decryption key. Please verify the full link was copied | `app/v/[id]/page.tsx:key-error` |
| `error.key_invalid` | מפתח הפענוח אינו תקין | The decryption key is invalid | `app/v/[id]/page.tsx:key-invalid` |
| `error.decrypt_integrity` | הפענוח נכשל -- ייתכן שהמסמך פגום | Decryption failed -- the document may be corrupted | `app/v/[id]/page.tsx:integrity-error` |
| `error.signature_invalid` | החתימה הדיגיטלית אינה תקפה. המסמך עלול להיות מזויף | Digital signature is invalid. The document may be forged | `app/v/[id]/page.tsx:sig-error` |

### 4.3 שגיאות PDF.js

| מפתח (key) | עברית (he) | אנגלית (en) | קובץ:שורה |
|---|---|---|---|
| `error.pdf_load_failed` | טעינת ה-PDF נכשלה | PDF loading failed | `app/v/[id]/page.tsx:pdf-error` |
| `error.pdf_render_failed` | רנדור העמוד נכשל | Page rendering failed | `app/v/[id]/page.tsx:render-error` |
| `error.pdfjs_unavailable` | מנוע תצוגת PDF לא זמין | PDF viewer engine unavailable | `app/v/[id]/page.tsx:pdfjs-error` |

### 4.4 שגיאות רשת

| מפתח (key) | עברית (he) | אנגלית (en) | קובץ:שורה |
|---|---|---|---|
| `error.network_upload` | שגיאת רשת בהעלאה. נא לבדוק את החיבור ולנסות שוב | Network error during upload. Please check your connection and try again | `app/share/cart/page.tsx:network-error` |
| `error.network_download` | שגיאת רשת בהורדת המסמך | Network error while downloading document | `app/v/[id]/page.tsx:network-dl-error` |
| `error.document_not_found` | המסמך לא נמצא | Document not found | `app/v/[id]/page.tsx:404-error` |
| `error.document_expired` | תוקף המסמך פג | Document has expired | `app/v/[id]/page.tsx:expired-error` |

---

## 5. מבנה JSON -- קובץ שפה

### 5.1 he.json (עברית)

```json
{
  "zk": {
    "upload": {
      "encrypting": "\u05de\u05e6\u05e4\u05d9\u05df...",
      "encrypted_success": "\u05de\u05d5\u05e6\u05e4\u05df \u05d5\u05de\u05d5\u05d2\u05df!",
      "encrypted_link": "\u05e7\u05d9\u05e9\u05d5\u05e8 \u05e9\u05d9\u05ea\u05d5\u05e3 \u05de\u05d5\u05e6\u05e4\u05df",
      "encrypting_file": "\u05de\u05e6\u05e4\u05d9\u05df \u05d0\u05ea \u05d4\u05e7\u05d5\u05d1\u05e5...",
      "generating_hash": "\u05de\u05d7\u05e9\u05d1 \u05d8\u05d1\u05d9\u05e2\u05ea \u05d0\u05e6\u05d1\u05e2...",
      "signing": "\u05d7\u05d5\u05ea\u05dd \u05d3\u05d9\u05d2\u05d9\u05d8\u05dc\u05d9\u05ea...",
      "uploading": "\u05de\u05e2\u05dc\u05d4 \u05dc\u05e9\u05e8\u05ea...",
      "complete": "\u05d4\u05d4\u05e2\u05dc\u05d0\u05d4 \u05d4\u05d5\u05e9\u05dc\u05de\u05d4 \u05d1\u05d4\u05e6\u05dc\u05d7\u05d4",
      "save_link_warning": "\u05e9\u05de\u05d5\u05e8 \u05d0\u05ea \u05d4\u05e7\u05d9\u05e9\u05d5\u05e8! \u05d1\u05dc\u05d9 \u05d4\u05e7\u05d9\u05e9\u05d5\u05e8 \u05d4\u05de\u05e1\u05de\u05da \u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e6\u05e4\u05d9\u05d9\u05d4",
      "copy_link": "\u05d4\u05e2\u05ea\u05e7 \u05e7\u05d9\u05e9\u05d5\u05e8",
      "link_copied": "\u05d4\u05e7\u05d9\u05e9\u05d5\u05e8 \u05d4\u05d5\u05e2\u05ea\u05e7",
      "zk_badge": "\u05de\u05d5\u05d2\u05df Zero-Knowledge",
      "no_server_access": "\u05dc\u05d0\u05e3 \u05d0\u05d7\u05d3, \u05db\u05d5\u05dc\u05dc Vertifile, \u05d0\u05d9\u05df \u05d2\u05d9\u05e9\u05d4 \u05dc\u05ea\u05d5\u05db\u05df \u05d4\u05de\u05e1\u05de\u05da"
    },
    "viewer": {
      "decrypting": "\u05de\u05e4\u05e2\u05e0\u05d7 \u05de\u05e1\u05de\u05da...",
      "key_not_found": "\u05de\u05e4\u05ea\u05d7 \u05e4\u05e2\u05e0\u05d5\u05d7 \u05dc\u05d0 \u05e0\u05de\u05e6\u05d0",
      "decrypt_failed": "\u05d4\u05e4\u05e2\u05e0\u05d5\u05d7 \u05e0\u05db\u05e9\u05dc",
      "rendering": "\u05d8\u05d5\u05e2\u05df \u05de\u05e1\u05de\u05da...",
      "verified": "\u05d4\u05de\u05e1\u05de\u05da \u05d0\u05d5\u05de\u05ea \u05d1\u05d4\u05e6\u05dc\u05d7\u05d4",
      "page_count": "\u05e2\u05de\u05d5\u05d3 {current} \u05de\u05ea\u05d5\u05da {total}",
      "zoom_in": "\u05d4\u05d2\u05d3\u05dc",
      "zoom_out": "\u05d4\u05e7\u05d8\u05df",
      "download_original": "\u05d4\u05d5\u05e8\u05d3 \u05de\u05e1\u05de\u05da \u05de\u05e7\u05d5\u05e8\u05d9",
      "print": "\u05d4\u05d3\u05e4\u05e1"
    },
    "error": {
      "encrypt_failed": "\u05d4\u05d4\u05e6\u05e4\u05e0\u05d4 \u05e0\u05db\u05e9\u05dc\u05d4. \u05e0\u05d0 \u05dc\u05e0\u05e1\u05d5\u05ea \u05e9\u05d5\u05d1",
      "browser_not_supported": "\u05d4\u05d3\u05e4\u05d3\u05e4\u05df \u05dc\u05d0 \u05ea\u05d5\u05de\u05da \u05d1\u05d4\u05e6\u05e4\u05e0\u05d4. \u05e0\u05d0 \u05dc\u05e2\u05d3\u05db\u05df \u05dc\u05d2\u05e8\u05e1\u05d4 \u05d4\u05d0\u05d7\u05e8\u05d5\u05e0\u05d4",
      "file_too_large": "\u05d4\u05e7\u05d5\u05d1\u05e5 \u05d2\u05d3\u05d5\u05dc \u05de\u05d3\u05d9 \u05dc\u05d4\u05e6\u05e4\u05e0\u05d4 (\u05de\u05e7\u05e1\u05d9\u05de\u05d5\u05dd {maxSize})",
      "crypto_unavailable": "\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9 \u05d4\u05e6\u05e4\u05e0\u05d4 \u05dc\u05d0 \u05d6\u05de\u05d9\u05e0\u05d9\u05dd. \u05e0\u05d0 \u05dc\u05d5\u05d5\u05d3\u05d0 \u05d7\u05d9\u05d1\u05d5\u05e8 HTTPS",
      "key_missing": "\u05d4\u05e7\u05d9\u05e9\u05d5\u05e8 \u05d7\u05e1\u05e8 \u05d0\u05ea \u05de\u05e4\u05ea\u05d7 \u05d4\u05e4\u05e2\u05e0\u05d5\u05d7. \u05e0\u05d0 \u05dc\u05d5\u05d5\u05d3\u05d0 \u05e9\u05d4\u05e7\u05d9\u05e9\u05d5\u05e8 \u05d4\u05de\u05dc\u05d0 \u05d4\u05d5\u05e2\u05ea\u05e7",
      "key_invalid": "\u05de\u05e4\u05ea\u05d7 \u05d4\u05e4\u05e2\u05e0\u05d5\u05d7 \u05d0\u05d9\u05e0\u05d5 \u05ea\u05e7\u05d9\u05df",
      "decrypt_integrity": "\u05d4\u05e4\u05e2\u05e0\u05d5\u05d7 \u05e0\u05db\u05e9\u05dc -- \u05d9\u05d9\u05ea\u05db\u05df \u05e9\u05d4\u05de\u05e1\u05de\u05da \u05e4\u05d2\u05d5\u05dd",
      "signature_invalid": "\u05d4\u05d7\u05ea\u05d9\u05de\u05d4 \u05d4\u05d3\u05d9\u05d2\u05d9\u05d8\u05dc\u05d9\u05ea \u05d0\u05d9\u05e0\u05d4 \u05ea\u05e7\u05e4\u05d4. \u05d4\u05de\u05e1\u05de\u05da \u05e2\u05dc\u05d5\u05dc \u05dc\u05d4\u05d9\u05d5\u05ea \u05de\u05d6\u05d5\u05d9\u05e3",
      "pdf_load_failed": "\u05d8\u05e2\u05d9\u05e0\u05ea \u05d4-PDF \u05e0\u05db\u05e9\u05dc\u05d4",
      "pdf_render_failed": "\u05e8\u05e0\u05d3\u05d5\u05e8 \u05d4\u05e2\u05de\u05d5\u05d3 \u05e0\u05db\u05e9\u05dc",
      "pdfjs_unavailable": "\u05de\u05e0\u05d5\u05e2 \u05ea\u05e6\u05d5\u05d2\u05ea PDF \u05dc\u05d0 \u05d6\u05de\u05d9\u05df",
      "network_upload": "\u05e9\u05d2\u05d9\u05d0\u05ea \u05e8\u05e9\u05ea \u05d1\u05d4\u05e2\u05dc\u05d0\u05d4. \u05e0\u05d0 \u05dc\u05d1\u05d3\u05d5\u05e7 \u05d0\u05ea \u05d4\u05d7\u05d9\u05d1\u05d5\u05e8 \u05d5\u05dc\u05e0\u05e1\u05d5\u05ea \u05e9\u05d5\u05d1",
      "network_download": "\u05e9\u05d2\u05d9\u05d0\u05ea \u05e8\u05e9\u05ea \u05d1\u05d4\u05d5\u05e8\u05d3\u05ea \u05d4\u05de\u05e1\u05de\u05da",
      "document_not_found": "\u05d4\u05de\u05e1\u05de\u05da \u05dc\u05d0 \u05e0\u05de\u05e6\u05d0",
      "document_expired": "\u05ea\u05d5\u05e7\u05e3 \u05d4\u05de\u05e1\u05de\u05da \u05e4\u05d2"
    }
  }
}
```

### 5.2 en.json (English)

```json
{
  "zk": {
    "upload": {
      "encrypting": "Encrypting...",
      "encrypted_success": "Encrypted and protected!",
      "encrypted_link": "Encrypted share link",
      "encrypting_file": "Encrypting file...",
      "generating_hash": "Computing fingerprint...",
      "signing": "Signing digitally...",
      "uploading": "Uploading to server...",
      "complete": "Upload completed successfully",
      "save_link_warning": "Save the link! Without it the document cannot be viewed",
      "copy_link": "Copy link",
      "link_copied": "Link copied",
      "zk_badge": "Zero-Knowledge protected",
      "no_server_access": "No one, including Vertifile, can access the document content"
    },
    "viewer": {
      "decrypting": "Decrypting document...",
      "key_not_found": "Decryption key not found",
      "decrypt_failed": "Decryption failed",
      "rendering": "Loading document...",
      "verified": "Document verified successfully",
      "page_count": "Page {current} of {total}",
      "zoom_in": "Zoom in",
      "zoom_out": "Zoom out",
      "download_original": "Download original document",
      "print": "Print"
    },
    "error": {
      "encrypt_failed": "Encryption failed. Please try again",
      "browser_not_supported": "Browser does not support encryption. Please update to the latest version",
      "file_too_large": "File too large for encryption (maximum {maxSize})",
      "crypto_unavailable": "Encryption services unavailable. Please ensure HTTPS connection",
      "key_missing": "The link is missing the decryption key. Please verify the full link was copied",
      "key_invalid": "The decryption key is invalid",
      "decrypt_integrity": "Decryption failed -- the document may be corrupted",
      "signature_invalid": "Digital signature is invalid. The document may be forged",
      "pdf_load_failed": "PDF loading failed",
      "pdf_render_failed": "Page rendering failed",
      "pdfjs_unavailable": "PDF viewer engine unavailable",
      "network_upload": "Network error during upload. Please check your connection and try again",
      "network_download": "Network error while downloading document",
      "document_not_found": "Document not found",
      "document_expired": "Document has expired"
    }
  }
}
```

---

## 6. הנחיות תרגום

### 6.1 כללים

- **טון:** מקצועי אך נגיש. לא טכני מדי למשתמש הקצה
- **עקביות:** "הצפנה" תמיד "encryption", "פענוח" תמיד "decryption"
- **משתנים:** שימוש ב-`{variable}` לתוכן דינמי -- לא לתרגם את שם המשתנה
- **אורך:** מחרוזות כפתורים -- קצרות ככל האפשר

### 6.2 מונחון (Glossary)

| עברית | אנגלית | הערה |
|---|---|---|
| הצפנה | Encryption | תהליך ההצפנה |
| פענוח | Decryption | תהליך הפענוח |
| מפתח פענוח | Decryption key | המפתח ב-URL fragment |
| מוצפן | Encrypted | מצב הקובץ |
| חתימה דיגיטלית | Digital signature | Ed25519 |
| טביעת אצבע | Fingerprint | SHA-256 hash |
| קישור שיתוף | Share link | URL עם מפתח |
| blob מוצפן | Encrypted blob | אחסון בשרת |

### 6.3 שפות עתידיות

מבנה ה-JSON תוכנן לתמוך בהוספת שפות נוספות:
- **ar.json** -- ערבית (RTL כמו עברית)
- **ru.json** -- רוסית
- **fr.json** -- צרפתית
- **es.json** -- ספרדית

---

*מפרט זה הוכן על ידי טל (i18n) ונבדק על ידי אורי (Team Manager).*

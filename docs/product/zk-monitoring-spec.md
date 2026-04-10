# Vertifile -- מפרט ניטור: תכונת Zero-Knowledge

**תאריך:** 10 באפריל 2026
**מחלקה:** DevOps (אלי)
**סטטוס:** מפרט טכני לאישור

---

## 1. סקירה כללית

מפרט ניטור עבור תכונת ההצפנה Zero-Knowledge. מטרת הניטור: הבטחת זמינות, ביצועים ואמינות של תהליך ההעלאה המוצפנת, הפענוח בצד הלקוח, וה-API.

---

## 2. מדדים לניטור

### 2.1 שיעור הצלחה/כשלון העלאות מוצפנות

| מדד | תיאור | מקור |
|---|---|---|
| `zk.upload.success_count` | מספר העלאות מוצפנות שהושלמו בהצלחה | שרת API |
| `zk.upload.failure_count` | מספר העלאות מוצפנות שנכשלו | שרת API |
| `zk.upload.success_rate` | אחוז הצלחה (success / total * 100) | חישוב |
| `zk.upload.failure_rate` | אחוז כשלון | חישוב |
| `zk.upload.duration_ms` | זמן העלאה מקצה לקצה (הצפנה + שליחה) | שרת API |
| `zk.upload.file_size_bytes` | גודל ה-blob המוצפן שהתקבל | שרת API |

### 2.2 שגיאות פענוח בצד הלקוח

| מדד | תיאור | מקור |
|---|---|---|
| `zk.decrypt.success_count` | פענוחים מוצלחים בצד הלקוח | Client telemetry |
| `zk.decrypt.failure_count` | כשלונות פענוח | Client telemetry |
| `zk.decrypt.failure_rate` | אחוז כשלון פענוח | חישוב |
| `zk.decrypt.error_type` | סוג שגיאה: `missing_key`, `corrupt_data`, `browser_incompatible` | Client telemetry |
| `zk.decrypt.duration_ms` | זמן פענוח בצד הלקוח | Client telemetry |

### 2.3 זמני תגובה /api/verify

| מדד | תיאור | מקור |
|---|---|---|
| `api.verify.response_time_ms` | זמן תגובה (p50, p95, p99) | שרת API |
| `api.verify.status_codes` | התפלגות קודי תגובה (200, 400, 404, 500) | שרת API |
| `api.verify.throughput_rps` | בקשות לשנייה | שרת API |

---

## 3. סף התראות (Alert Thresholds)

### התראות קריטיות (P0 -- הודעה מיידית)

| התראה | תנאי | ערוץ |
|---|---|---|
| **שיעור כשלון העלאות גבוה** | `zk.upload.failure_rate > 5%` בחלון 5 דקות | Slack #alerts + SMS |
| **API לא זמין** | `api.verify.status_codes.5xx > 1%` בחלון 2 דקות | Slack #alerts + SMS |
| **שרת Render לא מגיב** | Health check נכשל 3 פעמים רצופות | Slack #alerts + SMS |

### התראות גבוהות (P1 -- הודעה בשעות עבודה)

| התראה | תנאי | ערוץ |
|---|---|---|
| **שיעור כשלון פענוח** | `zk.decrypt.failure_rate > 1%` בחלון 15 דקות | Slack #monitoring |
| **זמני תגובה איטיים** | `api.verify.response_time_ms.p95 > 2000ms` | Slack #monitoring |
| **גודל קבצים חריג** | `zk.upload.file_size_bytes > 100MB` | Slack #monitoring |

### התראות בינוניות (P2 -- סקירה יומית)

| התראה | תנאי | ערוץ |
|---|---|---|
| **יחס legacy גבוה** | `legacy_uploads / total_uploads > 30%` | דוח יומי |
| **שימוש אחסון** | Neon storage > 80% מהמכסה | דוח יומי |
| **PDF.js worker errors** | `pdfjsLib.not_available > 0` ביום | דוח יומי |

---

## 4. מדדי Dashboard

### 4.1 Dashboard ראשי -- סקירה יומית

```
+------------------------------------------+
|  העלאות היום       |  מוצפנות  |  legacy  |
|  [counter]         |  [counter]|  [counter|
+------------------------------------------+
|  שיעור הצלחה       |  זמן ממוצע|  שגיאות  |
|  [gauge %]         |  [ms]     |  [count] |
+------------------------------------------+
|  העלאות לפי שעה (גרף קווי -- 24h)       |
|  [line chart: encrypted vs legacy]        |
+------------------------------------------+
|  גדלי PVF (היסטוגרמה)                    |
|  [histogram: file sizes distribution]     |
+------------------------------------------+
```

### 4.2 מדדים ספציפיים

| מדד Dashboard | סוג תצוגה | תדירות עדכון |
|---|---|---|
| העלאות ליום (מוצפנות vs legacy) | גרף קווי | שעתי |
| יחס מוצפנות/כלל ההעלאות | מד אחוזים | שעתי |
| התפלגות גדלי קבצי PVF | היסטוגרמה | יומי |
| זמן תגובה p50/p95/p99 | גרף קווי | דקתי |
| שגיאות פענוח לפי סוג | גרף עוגה | שעתי |
| שימוש אחסון Neon | מד מילוי | יומי |

---

## 5. אינטגרציית Health Check -- Render

### 5.1 Endpoint בדיקת בריאות

```
GET /api/health
```

**תגובה צפויה:**

```json
{
  "status": "healthy",
  "timestamp": "2026-04-10T12:00:00Z",
  "services": {
    "database": "connected",
    "storage": "available"
  },
  "zk": {
    "encryption_available": true,
    "last_successful_upload": "2026-04-10T11:58:00Z",
    "uploads_last_hour": 42
  }
}
```

### 5.2 תצורת Render Health Check

| פרמטר | ערך |
|---|---|
| **Path** | `/api/health` |
| **Interval** | 30 שניות |
| **Timeout** | 10 שניות |
| **Failure threshold** | 3 כשלונות רצופים |
| **Success threshold** | 1 הצלחה לשחזור |

### 5.3 בדיקות נוספות

- **Database connectivity:** בדיקת חיבור Neon PostgreSQL
- **Disk/Storage:** בדיקת שטח אחסון זמין
- **Certificate validity:** בדיקת תוקף TLS
- **DNS resolution:** בדיקת רזולוציית דומיין

---

## 6. דפוסי לוג למעקב

### 6.1 שגיאות קריטיות -- חיפוש מיידי

| דפוס לוג | משמעות | פעולה |
|---|---|---|
| `"ZK decryption failed"` | כשלון פענוח בצד הלקוח | בדיקת תאימות דפדפן, בדיקת שלמות blob |
| `"pdfjsLib not available"` | ספריית PDF.js לא נטענה | בדיקת inline script, בדיקת CSP headers |
| `"AES key extraction failed"` | כשלון חילוץ מפתח מ-URL fragment | בדיקת URL format, בדיקת encoding |
| `"Ed25519 verification failed"` | כשלון אימות חתימה דיגיטלית | בדיקת שלמות מסמך, חשד לזיוף |

### 6.2 אזהרות -- סקירה יומית

| דפוס לוג | משמעות | פעולה |
|---|---|---|
| `"Legacy upload detected"` | העלאה לא מוצפנת (ישן) | מעקב אחר יחס migration |
| `"Large file encryption"` | קובץ > 10MB מוצפן | מעקב ביצועים |
| `"Slow decryption"` | פענוח > 3 שניות | בדיקת ביצועי דפדפן |
| `"Hash mismatch warning"` | חוסר התאמה ב-hash | בדיקת שלמות מסמך |

### 6.3 מבנה לוג מומלץ

```json
{
  "timestamp": "2026-04-10T12:00:00.000Z",
  "level": "error",
  "service": "vertifile-api",
  "component": "zk-encryption",
  "event": "ZK decryption failed",
  "details": {
    "pvf_id": "abc123",
    "file_size": 524288,
    "browser": "Chrome/124",
    "error_code": "DECRYPT_FAILED",
    "error_message": "GCM authentication tag mismatch"
  }
}
```

---

## 7. כלי ניטור מומלצים

| כלי | שימוש | עלות משוערת |
|---|---|---|
| **Render Metrics** | ניטור שרת, health checks | כלול ב-Render plan |
| **Neon Dashboard** | ניטור מסד נתונים | כלול ב-Neon plan |
| **Sentry** | מעקב שגיאות צד לקוח | Free tier (5K events/month) |
| **UptimeRobot** | ניטור זמינות חיצוני | Free tier |
| **Custom Dashboard** | Dashboard מותאם ב-/admin | פיתוח פנימי |

---

## 8. Runbook -- תגובה לתקלות

### תקלה: שיעור כשלון העלאות > 5%

1. בדיקת Render status page
2. בדיקת Neon database connectivity
3. בדיקת לוגים: `"upload failed"` -- מיון לפי error_code
4. אם בעיית שרת: restart service ב-Render
5. אם בעיית DB: בדיקת connection pool

### תקלה: שיעור כשלון פענוח > 1%

1. בדיקת Client telemetry: סוג הדפדפן הנפוץ בכשלונות
2. בדיקת `"pdfjsLib not available"` -- בעיית CSP?
3. בדיקת `"AES key extraction failed"` -- URL encoding issue?
4. בדיקת גרסאות דפדפן נתמכות

---

*מפרט זה הוכן על ידי אלי (DevOps) ונבדק על ידי אורי (Team Manager).*

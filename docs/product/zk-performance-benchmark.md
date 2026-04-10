# Vertifile -- תוכנית Benchmark ביצועים: Zero-Knowledge

**תאריך:** 10 באפריל 2026
**מחלקה:** ביצועים (עומר)
**סטטוס:** מפרט בדיקות ביצועים

---

## 1. מטרה

מסמך זה מגדיר תוכנית בדיקות ביצועים מקיפה לתכונת ההצפנה Zero-Knowledge. המטרה: לוודא שחוויית המשתמש נשארת מהירה וחלקה לאורך כל ה-pipeline -- מהעלאה, דרך הצפנה, ועד פענוח וצפייה.

**יעד מרכזי:** הצפנה בפחות מ-1 שנייה לקבצים עד 10MB.

---

## 2. מטריצת בדיקות: מהירות הצפנה AES-256-GCM

### 2.1 הצפנה בצד הלקוח

| גודל קובץ | יעד זמן | מקסימום מותר | סביבת בדיקה |
|---|---|---|---|
| **1 KB** | < 5ms | 20ms | Chrome, Firefox, Safari |
| **100 KB** | < 15ms | 50ms | Chrome, Firefox, Safari |
| **1 MB** | < 50ms | 150ms | Chrome, Firefox, Safari |
| **10 MB** | < 500ms | 1,000ms | Chrome, Firefox, Safari |
| **50 MB** | < 3,000ms | 5,000ms | Chrome, Firefox, Safari |

### 2.2 תנאי בדיקה

| פרמטר | ערכים |
|---|---|
| **דפדפנים** | Chrome 120+, Firefox 120+, Safari 17+, Edge 120+ |
| **מכשירים** | Desktop (i5/8GB), Laptop (M1/16GB), Mobile (iPhone 14), Mobile (Galaxy S23) |
| **רשת** | לא רלוונטי (הצפנה מקומית) |
| **חזרות** | 10 הרצות לכל שילוב, חציון |

### 2.3 מתודולוגיה

```javascript
// מדידת ביצועי הצפנה
const start = performance.now();
const iv = crypto.getRandomValues(new Uint8Array(12));
const encrypted = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  key,
  fileBuffer
);
const duration = performance.now() - start;
```

---

## 3. מטריצת בדיקות: חישוב Hash SHA-256

| גודל קובץ | יעד זמן | מקסימום מותר |
|---|---|---|
| **1 KB** | < 1ms | 5ms |
| **100 KB** | < 5ms | 15ms |
| **1 MB** | < 20ms | 50ms |
| **10 MB** | < 150ms | 400ms |
| **50 MB** | < 800ms | 2,000ms |

### מתודולוגיה

```javascript
const start = performance.now();
const hashBuffer = await crypto.subtle.digest("SHA-256", fileBuffer);
const duration = performance.now() - start;
```

---

## 4. מטריצת בדיקות: זמן יצירת PVF (Pipeline מקצה לקצה)

### 4.1 שלבי ה-Pipeline

| שלב | תיאור | מדד |
|---|---|---|
| 1. קריאת קובץ | FileReader API | `pipeline.read_ms` |
| 2. חישוב Hash | SHA-256 | `pipeline.hash_ms` |
| 3. הצפנה | AES-256-GCM | `pipeline.encrypt_ms` |
| 4. חתימה | Ed25519 (מפיק + מערכת) | `pipeline.sign_ms` |
| 5. בניית PVF | הרכבת מבנה HTML + viewer | `pipeline.build_ms` |
| 6. העלאה | שליחת blob לשרת | `pipeline.upload_ms` |
| **סה"כ** | | `pipeline.total_ms` |

### 4.2 יעדי Pipeline מקצה לקצה

| גודל קובץ | יעד סה"כ (ללא רשת) | יעד סה"כ (כולל העלאה, 10Mbps) |
|---|---|---|
| **1 KB** | < 50ms | < 200ms |
| **100 KB** | < 80ms | < 300ms |
| **1 MB** | < 200ms | < 1,200ms |
| **10 MB** | < 1,000ms | < 9,000ms |
| **50 MB** | < 5,000ms | < 45,000ms |

---

## 5. מטריצת בדיקות: פענוח בצד הלקוח

### 5.1 זמני פענוח

| גודל blob מוצפן | יעד זמן | מקסימום מותר |
|---|---|---|
| **1 KB** | < 5ms | 20ms |
| **100 KB** | < 15ms | 50ms |
| **1 MB** | < 50ms | 150ms |
| **10 MB** | < 500ms | 1,000ms |
| **50 MB** | < 3,000ms | 5,000ms |

### 5.2 Pipeline פענוח מלא

| שלב | תיאור | מדד |
|---|---|---|
| 1. חילוץ מפתח | URL fragment parsing | `decrypt.key_extract_ms` |
| 2. הורדת blob | Fetch מהשרת | `decrypt.download_ms` |
| 3. פענוח AES | AES-256-GCM decrypt | `decrypt.aes_ms` |
| 4. אימות חתימה | Ed25519 verify | `decrypt.verify_ms` |
| 5. רנדור PDF | PDF.js rendering | `decrypt.render_ms` |
| **סה"כ** | | `decrypt.total_ms` |

---

## 6. מטריצת בדיקות: שימוש בזיכרון

### 6.1 זיכרון בזמן הצפנה

| גודל קובץ | זיכרון צפוי (peak) | מקסימום מותר |
|---|---|---|
| **1 KB** | ~50 KB | 1 MB |
| **100 KB** | ~500 KB | 2 MB |
| **1 MB** | ~4 MB | 8 MB |
| **10 MB** | ~35 MB | 60 MB |
| **50 MB** | ~170 MB | 250 MB |

**הערה:** הצפנת AES-GCM דורשת בערך 3x גודל הקובץ בזיכרון (קובץ מקורי + buffer הצפנה + תוצאה).

### 6.2 זיכרון בזמן פענוח

| גודל blob | זיכרון צפוי (peak) | מקסימום מותר |
|---|---|---|
| **1 KB** | ~50 KB | 1 MB |
| **100 KB** | ~500 KB | 2 MB |
| **1 MB** | ~5 MB | 10 MB |
| **10 MB** | ~40 MB | 70 MB |
| **50 MB** | ~200 MB | 300 MB |

### 6.3 מתודולוגיה למדידת זיכרון

```javascript
// מדידת זיכרון (Chrome)
const before = performance.memory.usedJSHeapSize;
// ... פעולת הצפנה/פענוח ...
const after = performance.memory.usedJSHeapSize;
const memoryUsed = after - before;
```

---

## 7. מטריצת בדיקות: רנדור PDF.js

### 7.1 זמני רנדור לפי מספר עמודים

| עמודים | גודל קובץ משוער | יעד רנדור (עמוד ראשון) | יעד רנדור (כל העמודים) |
|---|---|---|---|
| **1** | ~100 KB | < 200ms | < 200ms |
| **5** | ~500 KB | < 300ms | < 1,000ms |
| **10** | ~1 MB | < 400ms | < 2,000ms |
| **50** | ~5 MB | < 500ms | < 8,000ms |
| **100** | ~10 MB | < 600ms | < 15,000ms |

### 7.2 אסטרטגיית רנדור

- **Lazy rendering:** רנדור עמוד ראשון מיידי, שאר העמודים בגלילה
- **Web Worker:** PDF.js worker לעיבוד ברקע
- **Canvas optimization:** שימוש ב-OffscreenCanvas כשנתמך

---

## 8. סביבת בדיקה

### 8.1 מכשירי בדיקה

| קטגוריה | מכשיר | מעבד | RAM | דפדפן |
|---|---|---|---|---|
| Desktop גבוה | MacBook Pro M3 | M3 Pro | 18 GB | Chrome 124 |
| Desktop בינוני | Dell Latitude | i5-1340P | 8 GB | Chrome 124 |
| Desktop נמוך | Lenovo ThinkPad | i3-1115G4 | 4 GB | Chrome 124 |
| Mobile גבוה | iPhone 15 Pro | A17 Pro | 8 GB | Safari 17 |
| Mobile בינוני | Galaxy S23 | Snapdragon 8 Gen 2 | 8 GB | Chrome Android |
| Mobile נמוך | Pixel 6a | Tensor | 6 GB | Chrome Android |

### 8.2 תנאי רשת (לבדיקות העלאה/הורדה בלבד)

| פרופיל | Download | Upload | Latency |
|---|---|---|---|
| Fast WiFi | 100 Mbps | 50 Mbps | 5ms |
| Slow WiFi | 10 Mbps | 5 Mbps | 20ms |
| 4G | 20 Mbps | 5 Mbps | 50ms |
| 3G | 1.5 Mbps | 750 Kbps | 300ms |

---

## 9. קריטריוני הצלחה/כשלון

### עובר (Pass)

- כל בדיקות ההצפנה עומדות ביעדי הזמן ברוב (> 90%) ההרצות
- כל בדיקות הפענוח עומדות ביעדי הזמן ברוב (> 90%) ההרצות
- שימוש בזיכרון לא חורג מהמקסימום המותר
- יעד מרכזי: **הצפנה < 1 שנייה לקבצים עד 10MB** -- מתקיים

### נכשל (Fail)

- יותר מ-10% מההרצות חורגות מהמקסימום המותר
- דליפת זיכרון (memory leak) מזוהה לאורך הרצות חוזרות
- קריסת דפדפן (tab crash) בקבצים גדולים
- יעד מרכזי לא מתקיים

---

## 10. כלי בדיקה מומלצים

| כלי | שימוש |
|---|---|
| **Chrome DevTools Performance** | מדידת זמנים וזיכרון |
| **Lighthouse** | ביצועי טעינה כלליים |
| **Web Vitals** | CLS, LCP, FID |
| **Custom harness** | סקריפט אוטומטי שמריץ את כל מטריצת הבדיקות |

---

*מפרט זה הוכן על ידי עומר (Performance) ונבדק על ידי אורי (Team Manager).*

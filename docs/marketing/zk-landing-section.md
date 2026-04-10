# Zero-Knowledge Landing Page Section
## נועה (Marketing) | Marketing Blitz - Zero-Knowledge Launch

---

## HTML Section - מוכן להדבקה ישירה ב-index.html

```html
<section id="zero-knowledge" class="zk-section" dir="rtl">
  <div class="zk-container">

    <h2 class="zk-headline">אפס ידע. מאה אחוז שליטה.</h2>
    <p class="zk-subheadline">הצפנת Zero-Knowledge חדשה של Vertifile מבטיחה דבר אחד פשוט: אנחנו לא יכולים לקרוא את המסמכים שלכם. גם אם נרצה. גם אם יכריחו אותנו.</p>

    <div class="zk-features">
      <div class="zk-feature-item">
        <h3>הצפנה מלאה לפני ההעלאה</h3>
        <p>המסמכים שלכם מוצפנים בתקן AES-256-GCM ישירות בדפדפן, עוד לפני שהם עוזבים את המחשב שלכם. מה שמגיע לשרתים שלנו הוא קוד בלתי קריא.</p>
      </div>
      <div class="zk-feature-item">
        <h3>המפתח נשאר אצלכם -- תמיד</h3>
        <p>מפתח ההצפנה מועבר אך ורק דרך URL Fragment -- חלק בכתובת שלעולם לא נשלח לשרת. אף אחד חוץ מכם ומהנמען לא יכול לפתוח את המסמך.</p>
      </div>
      <div class="zk-feature-item">
        <h3>חתימה כפולה לאימות מוחלט</h3>
        <p>כל מסמך נחתם בחתימה דיגיטלית כפולה: Ed25519 לזהות השולח ו-HMAC לשלמות התוכן. כל שינוי, ולו הקטן ביותר, מתגלה מיד.</p>
      </div>
      <div class="zk-feature-item">
        <h3>פרטיות ברמה של חוק</h3>
        <p>עומד בדרישות GDPR, HIPAA ותקני פרטיות בינלאומיים. כשהשרת לא יכול לקרוא -- אין מה לדלוף, אין מה לפרוץ, אין מה לחשוף.</p>
      </div>
    </div>

    <div class="zk-comparison">
      <div class="zk-before">
        <h3>לפני Vertifile</h3>
        <ul>
          <li>מסמכים נשלחים באימייל בלי הגנה</li>
          <li>כל שרת שמעביר את הקובץ יכול לקרוא אותו</li>
          <li>אין דרך לדעת אם מישהו שינה את התוכן</li>
          <li>פלטפורמות ענן שומרות עותק קריא</li>
          <li>דליפת מידע = אסון עסקי ומשפטי</li>
        </ul>
      </div>
      <div class="zk-after">
        <h3>עם Vertifile</h3>
        <ul>
          <li>הצפנה מלאה מקצה לקצה, לפני ההעלאה</li>
          <li>השרת מעביר -- אבל לא יכול לקרוא</li>
          <li>חתימה כפולה מזהה כל שינוי מיד</li>
          <li>מפתח ההצפנה לעולם לא עוזב את הדפדפן</li>
          <li>גם בפריצה -- אין מה לגנוב</li>
        </ul>
      </div>
    </div>

    <div class="zk-cta">
      <a href="/signup" class="zk-cta-button">הגנו על המסמכים שלכם עכשיו</a>
      <p class="zk-cta-sub">ללא עלות לתקופת ההשקה. ללא כרטיס אשראי.</p>
    </div>

  </div>
</section>
```

---

## CSS מוצע

```css
.zk-section {
  background: linear-gradient(135deg, #1E1B2E 0%, #2D1B4E 100%);
  color: #FFFFFF;
  padding: 80px 20px;
  font-family: 'Heebo', 'Arial', sans-serif;
}

.zk-container {
  max-width: 1100px;
  margin: 0 auto;
}

.zk-headline {
  font-size: 3rem;
  font-weight: 900;
  color: #FFFFFF;
  margin-bottom: 16px;
  line-height: 1.2;
}

.zk-subheadline {
  font-size: 1.25rem;
  color: #C4B5FD;
  max-width: 700px;
  margin-bottom: 48px;
  line-height: 1.7;
}

.zk-features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 32px;
  margin-bottom: 64px;
}

.zk-feature-item {
  background: rgba(124, 58, 237, 0.12);
  border: 1px solid rgba(124, 58, 237, 0.3);
  border-radius: 12px;
  padding: 28px;
}

.zk-feature-item h3 {
  font-size: 1.15rem;
  font-weight: 700;
  color: #A78BFA;
  margin-bottom: 10px;
}

.zk-feature-item p {
  font-size: 0.95rem;
  color: #D1D5DB;
  line-height: 1.7;
}

.zk-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  margin-bottom: 64px;
}

.zk-before {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 12px;
  padding: 28px;
}

.zk-before h3 {
  color: #FCA5A5;
  margin-bottom: 16px;
  font-size: 1.2rem;
}

.zk-before li {
  color: #D1D5DB;
  margin-bottom: 10px;
  padding-right: 12px;
  line-height: 1.6;
}

.zk-after {
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 12px;
  padding: 28px;
}

.zk-after h3 {
  color: #86EFAC;
  margin-bottom: 16px;
  font-size: 1.2rem;
}

.zk-after li {
  color: #D1D5DB;
  margin-bottom: 10px;
  padding-right: 12px;
  line-height: 1.6;
}

.zk-cta {
  text-align: center;
  margin-top: 32px;
}

.zk-cta-button {
  display: inline-block;
  background: #7C3AED;
  color: #FFFFFF;
  font-size: 1.2rem;
  font-weight: 700;
  padding: 16px 48px;
  border-radius: 8px;
  text-decoration: none;
  transition: background 0.2s;
}

.zk-cta-button:hover {
  background: #6D28D9;
}

.zk-cta-sub {
  margin-top: 12px;
  color: #9CA3AF;
  font-size: 0.9rem;
}
```

---

## הערות ליישום

- **כותרת ראשית**: "אפס ידע. מאה אחוז שליטה." -- קצר, חזק, משדר את ההבטחה המרכזית
- **CTA**: "הגנו על המסמכים שלכם עכשיו" -- פעולה ישירה, דחיפות בלי לחץ
- **צבעים**: רקע כהה #1E1B2E, סגול Vertifile #7C3AED, הדגשות #A78BFA
- **ללא אייקונים אימוג'י** -- יש להשתמש רק באייקוני SVG בהתאם למדיניות Vertifile
- **Section ID**: `#zero-knowledge` -- ניתן לקישור ישיר מניווט

# Vertifile — Unit Economics & Pricing Model

## עלות ליצירת PVF

| רכיב | עלות | הערה |
|------|------|------|
| Server compute (hash + sign + generate) | $0.001 | ~100ms CPU |
| Obfuscation (worker thread) | $0.003 | ~2-5s CPU |
| DB storage (hash + metadata) | $0.0005 | ~1KB per doc |
| PVF content storage (DB) | $0.005 | ~100KB-5MB |
| Blockchain gas (Polygon) | $0.01 | optional |
| **סה"כ per PVF** | **$0.002-0.02** | |

## עלות לאימות

| רכיב | עלות |
|------|------|
| DB query (hash lookup) | $0.0001 |
| Token refresh | $0.0001 |
| **סה"כ per verify** | **$0.0002** |

## Gross Margin

| תוכנית | מחיר | מסמכים | עלות ייצור | Gross Margin |
|--------|------|--------|-----------|-------------|
| Free | $0 | 1 | $0.02 | -$0.02 (loss leader) |
| Pro | $49/mo | 500 | $2.50 | **95%** |
| Enterprise | $499+/mo | unlimited | ~$50 | **90%** |

## Revenue Projections

| חודש | Free users | Pro | Enterprise | MRR |
|------|-----------|-----|-----------|-----|
| 1 | 50 | 2 | 0 | $98 |
| 3 | 200 | 10 | 1 | $990 |
| 6 | 500 | 25 | 3 | $2,722 |
| 12 | 1,000 | 50 | 5 | $4,945 |

## TAM / SAM / SOM

| מדד | ערך | הסבר |
|-----|-----|------|
| TAM | $15-20B | שוק אימות מסמכים עולמי |
| SAM | $2.5-3B | ישראל + English-speaking markets |
| SOM (שנה 1) | $48K-252K | 33-85 לקוחות paying |

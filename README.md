# Trip Expense Pro v1.0

אפליקציית PWA חינמית ל-iPhone, בנויה לפי workflow של מינימום הקלדה:

1. מצלמים קבלה.
2. בוחרים קטגוריית הוצאה.
3. בוחרים כרטיס / אמצעי תשלום.
4. הרשומה נשמרת אוטומטית.

## מה מתבצע אוטומטית
- OCR מקומי בדפדפן
- זיהוי Merchant
- זיהוי Total
- מטבע
- תאריך
- Tax / Tip / Service
- GPS
- מדינה לפי GPS
- עיר/מדינה אופציונלי באמצעות reverse geocoding של OpenStreetMap/Nominatim
- הצעת קטגוריה לפי תוכן הקבלה
- Confidence scoring
- זיהוי קבלה כפולה
- Review Queue
- Dashboard
- CSV export
- ZIP מלא: CSV + תמונות הקבלות
- Backup/Restore מלא כולל תמונות

## פרטיות
- רשומות ותמונות נשמרות ב-IndexedDB במכשיר.
- האפליקציה עצמה לא מעלה קבלות לשרת.
- OCR נעשה בדפדפן באמצעות Tesseract.js.
- אם Reverse Geocoding מופעל, קואורדינטות נשלחות לשירות הציבורי Nominatim של OpenStreetMap כדי לקבל עיר/מדינה. ניתן לכבות בהגדרות.
- Tesseract.js ו-JSZip נטענים מ-CDN בפעם הראשונה. לאחר שנשמרו בקאש, ה-PWA יכולה להשתמש במשאבים שנשמרו מקומית.

## התקנה חינמית
פרסם את התיקייה כאתר HTTPS סטטי, למשל GitHub Pages או Cloudflare Pages.
באייפון:
Safari > Share > Add to Home Screen > Open as Web App > Add

## הרצה מקומית
אין לפתוח את index.html כ-file://. השתמש בשרת:

python3 -m http.server 8000

ואז פתח:
http://localhost:8000

## הערה טכנית
OCR בדפדפן הוא הפתרון הטוב ביותר כאשר התנאי הוא 0 תשלום + ללא App Store.
לדיוק OCR ברמת מוצר מסחרי ניתן בעתיד להעביר לגרסת iOS Native עם Apple Vision, אך זו אינה נדרשת כדי להשתמש בגרסה הנוכחית.

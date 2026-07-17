# اختبار DABANKO بستة لاعبين عبر Playwright

## ما هو Playwright؟
أداة تشغّل متصفح Chromium آليًا وتتحكم فيه. هذا المشروع يفتح 6 جلسات مستقلة، وكل جلسة تتصرف كلاعب منفصل.

## المتطلبات
1. كمبيوتر عليه Node.js إصدار 18 أو أحدث.
2. اتصال بالإنترنت.
3. أن تكون اللعبة والسيرفر شغالين.

## التثبيت
افتح Terminal داخل هذا المجلد واكتب:

```bash
npm install
npx playwright install chromium
```

## التشغيل
```bash
npm run test-online
```

أو:

```bash
node six-player-test.js
```

## رابط اللعبة
الرابط الافتراضي داخل السكربت:

```text
https://dabanko.pages.dev/
```

لتجربة رابط مختلف في Windows PowerShell:

```powershell
$env:GAME_URL="https://your-game.pages.dev/"; npm run test-online
```

## التقرير
بعد انتهاء الاختبار سيظهر ملف:

```text
dabanko-online-report.json
```

ويحتوي على:
- هل فتحت الصفحات الست؟
- هل دخل الستة الروم؟
- هل ضغطوا استعداد؟
- هل بدأت المباراة؟
- هل انتهت؟
- اسم الفائز.
- مدة الاختبار.
- أخطاء Console وأخطاء الصفحة والشبكة.
- حالة كل لاعب النهائية.

## تنبيه
هذا الاختبار يستخدم السيرفر الحقيقي، لذلك سيظهر روم باسم يبدأ بـ:
`اختبار آلي`

يشغل مباراة واحدة فقط بستة لاعبين، ولذلك الحمل على السيرفر منخفض.

## التشغيل من GitHub Actions عبر الجوال

1. ارفع جميع ملفات هذا المجلد إلى مستودع GitHub، مع المحافظة على مجلد:
   `.github/workflows`
2. افتح المستودع ثم تبويب `Actions`.
3. اختر `DABANKO 6-Player Online Test`.
4. اضغط `Run workflow`.
5. تأكد من رابط اللعبة ثم اضغط `Run workflow` مرة ثانية.
6. افتح نتيجة التشغيل بعد انتهائها.
7. في أسفل الصفحة، من قسم `Artifacts`، حمّل:
   `dabanko-online-test-report`

داخل الملف المضغوط ستجد:
`dabanko-online-report.json`

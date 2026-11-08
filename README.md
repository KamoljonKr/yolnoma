# Yoʻlnoma: Oʻzbekiston boʻylab eng qulay marshrut

Boshlangʻich nuqtani va borish kerak boʻlgan manzillarni kiritasiz. Platforma ularni qaysi tartibda aylanib chiqish eng qisqa (yoki eng tez) ekanini hisoblaydi va yoʻlni xaritada chizadi. Har bir manzilni tepadan (sunʼiy yoʻldosh, Google, Yandex) koʻrish va atrofida nimalar borligini bilish mumkin.

## Imkoniyatlar

- **Boshlangʻich nuqta**: qidiruv, “Mening joylashuvim” (GPS) yoki xaritadan bosib tanlash.
- **Manzillar**: joy nomi, koordinata (`41.311, 69.279`, `41°18'40"N 69°16'44"E`), Google Maps yoki Yandex Karta havolasi. “Roʻyxat bilan qoʻshish” orqali bir nechta manzilni birdan qoʻshish mumkin.
- **Optimal tartib**:
  - 15 tagacha manzil uchun Held–Karp algoritmi barcha variantlarni tekshiradi va kafolatlangan eng yaxshi tartibni beradi.
  - Undan koʻp manzil boʻlsa, 2-opt va Or-opt usullari bilan yaqin yechim topiladi (60 tagacha).
  - Hisob haqiqiy yoʻl tarmogʻi boʻyicha olib boriladi (OSRM, OpenStreetMap). Xizmat ishlamasa, taxminiy hisobga oʻtadi.
  - Ikki rejim bor: eng qisqa masofa yoki eng tez vaqt. Oxirida boshlangʻich nuqtaga qaytishni ham yoqish mumkin.
  - **Marshrut Oʻzbekiston ichida qoladi.** OSRM davlat chegarasini bilmaydi va Tojikiston, Qirgʻiziston kabi qoʻshni yoʻllar qisqaroq boʻlsa, oʻsha yerdan chizadi. Shuning uchun marshrut chizigʻi Oʻzbekiston konturidan 20 km dan uzoqroq chiqsa, platforma Oʻzbekiston ichidagi yirik shaharlar orqali aylanma yoʻl tanlaydi (`js/border.js`). Aylanma yoʻl nuqtalari Google/Yandex havolasiga ham qoʻshiladi. Ichki yoʻl umuman yoʻq manzillar uchun (masalan, anklavlar) ogohlantirish chiqadi.
- **Natija**: jami masofa, yoʻl vaqti, yoqilgʻi sarfi va narxi (soʻmda), har manzilga yetib borish va joʻnash soati. Siz kiritgan tartibga nisbatan qancha km tejalgani ham koʻrsatiladi.
- **Eksport**: butun marshrutni Google Maps yoki Yandex Kartada navigatsiya uchun ochish, rejani matn sifatida nusxalash, safar havolasini ulashish.
- **Har manzilda necha soat boʻlish**: manzil kartasidagi “soat” maydoniga shu manzil uchun alohida vaqt yoziladi (masalan, 3 yoki 1.5). Boʻsh qoldirilsa, umumiy “Har manzilda turish” ishlatiladi. Bu marshrut tartibini oʻzgartirmaydi, faqat yetib borish/ketish soatlari va hisobotni oʻzgartiradi.
- **Hisobot** (natija ostidagi “Hisobot” tugmasi): joʻnash sanasi va vaqti, ish soatlari (masalan, 10:00–18:00), har manzilda turish vaqti va haydashni tugatish vaqtini kiritasiz; sayt kunma-kun bashorat tuzadi:
  - sana (`09.11.2026`), undan keyin `1-manzil`, `2-manzil` … bloklari: yoʻl masofasi, rulda necha daqiqa, yetib borish, ish va ketish vaqti;
  - ish kuni tugashiga ulgurmasak, manzilda tunab, ertasi kuni ish boshlanishida davom etiladi; yoʻlda kech qolsak, yoʻlda tunash koʻrsatiladi;
  - `.txt` yuklab olish, nusxalash, chop etish/PDF. Hisob tirbandlik va tushlikni hisobga olmaydi (`js/report.js`).
- **Joy haqida panel** (manzilni bosing):
  - *Tepadan koʻrinish*: sunʼiy yoʻldosh tasviri, Google va Yandex sunʼiy yoʻldosh oynalari. Google Earth 3D, Street View va Yandex panoramasiga havolalar bor.
  - *Joy haqida*: joy turi, hudud, dengiz sathidan balandlik, 3 kunlik ob-havo va Vikipediya maʼlumoti. Hudud xarakteri ham baholanadi (gavjum shahar, tuman markazi, kichik aholi punkti yoki chekka hudud). Sayohatchi uchun maslahatlar beriladi, masalan: “yoqilgʻi shoxobchasi yoʻq”, “bankomat yoʻq”.
  - *Atrofda nimalar bor*: 0,5–5 km radiusdagi ovqatlanish joylari, mehmonxonalar, yoqilgʻi shoxobchalari, tarixiy obidalar, shifoxona, dorixona, bankomat, masjid, avtoservis va boshqa obyektlar soni hamda eng yaqinlari.

## Ishga tushirish

Hech qanday oʻrnatish yoki API kalit kerak emas, bu oddiy statik sayt.

```bash
cd yolnoma
python3 -m http.server 8080
```

Keyin brauzerda `http://localhost:8080` ni oching. `index.html` ni toʻgʻridan-toʻgʻri ikki marta bosib ochsa ham ishlaydi, lekin mahalliy server ishonchliroq.

**Internetga joylash**: papkani istalgan statik hostingga yuklang (GitHub Pages, Netlify, Vercel, Cloudflare Pages).

## Sozlash (`config.js`)

- `googleMapsApiKey`: ixtiyoriy. Kiritilsa, Google oynasi rasmiy Maps Embed API orqali ishlaydi.
- `yandexDomain`: `yandex.uz` (standart), `yandex.ru` yoki `yandex.com`.

## Ishlatiladigan bepul xizmatlar

| Vazifa | Xizmat |
|---|---|
| Xarita | OpenStreetMap, Esri World Imagery (sunʼiy yoʻldosh) |
| Manzil qidirish | Nominatim, Photon (zaxira) |
| Yoʻl masofasi va marshrut | OSRM (`router.project-osrm.org`, zaxira `routing.openstreetmap.de`) |
| Atrofdagi obyektlar | Overpass API |
| Joy tavsifi | Wikipedia (uz → ru → en) |
| Ob-havo va balandlik | Open-Meteo |

Bu jamoat serverlari kichik hajmdagi foydalanish uchun moʻljallangan. Koʻp foydalanuvchili tijorat platforma uchun oʻz OSRM/Nominatim serveringizni koʻtarish yoki pullik API (Google Routes, Yandex Router) ulash tavsiya etiladi.

## Fayllar

```
index.html        sahifa tuzilishi
config.js         ixtiyoriy sozlamalar
css/style.css     dizayn (yorugʻ va qorongʻi rejim, mobil)
js/geo.js         masofa, koordinata va havolalarni oʻqish
js/tsp.js         optimal tartib algoritmi
js/api.js         tashqi xizmatlar bilan ishlash
js/border.js      marshrut chegaradan chiqmasligini tekshirish va aylanma yoʻl topish
js/uz-border.js   Oʻzbekiston chegarasi (Natural Earth, ~1 km aniqlik)
js/place.js       joy tavsifi va atrof tahlili
js/report.js      kunma-kun safar hisoboti (jadval, matn, chop etish)
js/app.js         interfeys mantigʻi
vendor/leaflet/   xarita kutubxonasi (Leaflet 1.9.4)
```

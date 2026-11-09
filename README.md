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
- **Eksport**: butun marshrutni Google Maps yoki Yandex Kartada navigatsiya uchun ochish, rejani matn sifatida nusxalash, safar havolasini ulashish. **Ulashilgan havola faqat koʻrish uchun** (`#view=…`): ochgan kishi manzillar, tartib va vaqtlarni koʻradi, lekin hech qanday kiritish maydoni yoki tahrirlash tugmasi yoʻq; uning oʻz saqlangan safari ham oʻzgarmaydi. Eski `#trip=` havolalar ham shunday ochiladi.
- **Har manzilda necha soat boʻlish**: manzil kartasidagi “soat” maydoniga shu manzil uchun alohida vaqt yoziladi (masalan, 3 yoki 1.5). Boʻsh qoldirilsa, umumiy “Har manzilda turish” ishlatiladi. Bu marshrut tartibini oʻzgartirmaydi, faqat yetib borish/ketish soatlari va hisobotni oʻzgartiradi.
- **Manzilni tahrirlash**: kartadagi qalam tugmasi oynani ochadi. Yangi manzil (nom, koordinata yoki Google/Yandex havola) tanlansa, manzil almashadi va marshrut qayta hisoblanadi. Izoh, havola, turish vaqti va qoʻlda belgilangan oʻrin saqlanadi. Faqat izoh yoki havola oʻzgarsa, marshrut qayta hisoblanmaydi.
- **Hisobot** (natija ostidagi “Hisobot” tugmasi): joʻnash sanasi va vaqti, ish soatlari (masalan, 10:00–18:00), har manzilda turish vaqti va haydashni tugatish vaqtini kiritasiz; sayt kunma-kun bashorat tuzadi:
  - sana (`09.11.2026`), undan keyin `1-manzil`, `2-manzil` … bloklari: yoʻl masofasi, rulda necha daqiqa, yetib borish, ish va ketish vaqti;
  - ish kuni tugashiga ulgurmasak, manzilda tunab, ertasi kuni ish boshlanishida davom etiladi; yoʻlda kech qolsak, yoʻlda tunash koʻrsatiladi;
  - `.txt` yuklab olish, nusxalash, chop etish/PDF. Hisob tirbandlik va tushlikni hisobga olmaydi (`js/report.js`).
- **Hisobot — qisqa koʻrinish**: Hisobot oynasida “Qisqa” tanlansa, hisobot faqat sana, manzil (izoh boʻlsa izohdagi manzil), vaqt oraligʻi, tunash belgisi va har bir manzil uchun aniq koordinatali Yandex Karta havolasidan iborat boʻladi (nusxalash, .txt, chop etishda ham).
- **Tarix** (yuqorida soat belgisi) va **+ Yangi reja**: marshrut rejalari brauzerda saqlanadi, tahrir avtomatik yangilanadi. “+ Yangi reja” yoki “Tozalash” bosilsa, joriy reja Tarixga oʻzi saqlanadi — hech narsa yoʻqolmaydi. Tarixdan rejani ochish, nomini oʻzgartirish va oʻchirish mumkin. “Koʻchirish havolasi” rejani boshqa qurilmaga (telefonga) tahrirlanadigan nusxa qilib oʻtkazadi; ulashilgan (faqat koʻrish) havolani ham oʻz Tarixingizga saqlash mumkin. Serverga ulansa (pastga qarang), Tarix va hozirgi reja barcha qurilmalarda bir xil boʻladi; ulanmagan boʻlsa, Tarix har bir qurilma/brauzerda alohida saqlanadi.
- **Safarni boshlash** (natijadagi tugma, telefon uchun): jonli rejim. Telefon GPS'i xaritada joylashuvingizni koʻrsatadi; hozirgi manzilgacha qolgan masofa, vaqt va yetib borish soati hisoblanadi, rejaga nisbatan ortda/oldinda ekaningiz koʻrinadi. Manzilga ~150 m yaqinlashsangiz “yetib keldingiz” deb belgilanadi (yoki “Yetib keldim” tugmasi), ish taymeri boshlanadi; “Ishni tugatdim” keyingi manzilga oʻtkazadi (“Ortga” bilan bekor qilinadi). Ish oynasi, tunash va haydash chegarasi hisobot bilan bir xil qoidalarda qayta hisoblanadi (`js/live.js`). Ekran oʻchmasligi uchun “wake lock” ishlatiladi; sahifa qayta ochilsa, jonli safar davom etadi. Jonli rejim toʻliq ekranli **navigatsiya** koʻrinishida ishlaydi (`js/nav.js`): yuqorida keyingi burilish (strelka, masofa, koʻcha nomi), chapda tezlik, xaritada yoʻlga yopishgan strelka va qolgan yoʻl (oʻtilgani rangsizlanadi), tezlikka qarab masshtab, pastda yetib borish vaqti va qolgan masofa. Yoʻl koʻrsatmalari OSRM `steps` ma’lumotidan olinadi. Yoʻldan chiqib ketsangiz ~10 soniyadan soʻng joriy joydan yangi marshrut hisoblanadi (Oʻzbekistondan chiqib ketadigan yoʻl rad etiladi). Ovozli koʻrsatma (tizimda oʻzbekcha yoki turkcha ovoz boʻlsa) tugma bilan yoqiladi. Xarita sukut boʻyicha “harakat tepada” rejimida (yoʻnalishga qarab buriladi; tezlik ~5 km/soatdan past boʻlsa burilmaydi). Xaritani ikki barmoq bilan istalgan tomonga aylantirish mumkin (oddiy xaritada ham; kompas tugmasi shimolga qaytaradi). Navigatsiyada kompas tugmasi: shimol tepada ⇄ harakat tepada. Chap tepadagi qizil “Chiqish” tugmasi navigatsiyadan chiqaradi. Xaritani surib qoʻysangiz kuzatish toʻxtaydi, “joylashuvim” tugmasi qaytaradi. Cheklov: brauzer fonda (ekran oʻchiq yoki boshqa ilovada) GPS'ni kuzata olmaydi. Ulashilgan (faqat koʻrish) havolada ham ishlaydi.
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
js/sync.js        Supabase bilan sinxron (kirish, rejalarni yuklash/yozish)
js/live.js        jonli safar: GPS boʻyicha qolgan yoʻl, holat mashinasi, qayta hisoblash
js/nav.js         navigatsiya: yoʻl koʻrsatmalari, yoʻlga yopishish, burilish, tezlik, yoʻnalish
js/app.js         interfeys mantigʻi
vendor/leaflet/   xarita kutubxonasi (Leaflet 1.9.4)
```

## Uchinchi tomon kodi

- `vendor/leaflet` — Leaflet 1.9.4 (BSD-2-Clause).
- `vendor/leaflet-rotate` — [leaflet-rotate](https://github.com/Raruto/leaflet-rotate) 0.5.3 (GPL-3.0, `LICENSE` shu papkada): xaritani aylantirish.

## Serverga ulash (rejalarni telefon va kompyuterda bir xil qilish)

Sayt statik boʻlgani uchun rejalar sukut boʻyicha faqat brauzerda saqlanadi. Ikkala qurilmada bir xil boʻlishi uchun [Supabase](https://supabase.com) (bepul reja) ulanadi:

1. Supabase'da yangi loyiha oching → **SQL Editor** da `supabase/schema.sql` ni ishga tushiring.
2. **Authentication → URL Configuration**: *Site URL* va *Redirect URLs* ga sayt manzilini yozing (`https://kamoljonkr.github.io/yolnoma/`).
3. **Project Settings → API** dan *Project URL* va *anon public* kalitni `config.js` dagi `supabase: { url, anonKey }` ga yozing (anon kalit ochiq boʻlishi mumkin — himoyani jadvaldagi RLS qoidalari beradi; `service_role` kalitini hech qachon yozmang).
4. Saytda **Tarix → Kirish**: emailni kiriting, kelgan havolani bosing. Ikkala qurilmada bir xil email bilan kiring.

Sinxron: har bir reja avtomatik serverga yoziladi (tahrirdan ~2 soniya keyin), sahifa ochilganda va har daqiqada yangilanadi. Hozirgi reja ham qurilmalar orasida oʻtadi (oxirgi tanlagan qurilma gʻolib). Oʻzgarishlar eng soʻnggisi gʻolib qoidasi boʻyicha birlashtiriladi, shuning uchun ikkala qurilmada soat toʻgʻri boʻlishi kerak. Internet yoʻq paytda ham ishlaydi, qaytganda yetkaziladi (`js/sync.js`).

/* Joy tavsifi: turi, hudud tavsifi, infratuzilma bahosi va sayohatchi uchun maslahatlar. */
(function (global) {
  "use strict";

  const TYPE_UZ = {
    "place:city": "Shahar", "place:town": "Shaharcha", "place:village": "Qishloq", "place:hamlet": "Kichik qishloq",
    "place:suburb": "Shahar tumani", "place:neighbourhood": "Mahalla", "place:quarter": "Mavze", "place:locality": "Joy",
    "place:isolated_dwelling": "Alohida turar joy",
    "tourism:attraction": "Diqqatga sazovor joy", "tourism:museum": "Muzey", "tourism:hotel": "Mehmonxona",
    "tourism:guest_house": "Mehmon uyi", "tourism:hostel": "Hostel", "tourism:viewpoint": "Manzaragoh",
    "tourism:camp_site": "Lager / chodir joyi", "tourism:zoo": "Hayvonot bogʻi", "tourism:theme_park": "Attraksionlar bogʻi",
    "historic:monument": "Tarixiy yodgorlik", "historic:memorial": "Yodgorlik", "historic:castle": "Qalʼa",
    "historic:fort": "Qalʼa", "historic:archaeological_site": "Arxeologik yodgorlik", "historic:ruins": "Xarobalar",
    "historic:tomb": "Maqbara", "historic:building": "Tarixiy bino", "historic:city_gate": "Shahar darvozasi",
    "historic:yes": "Tarixiy obida",
    "amenity:place_of_worship": "Ibodat joyi", "amenity:marketplace": "Bozor", "amenity:restaurant": "Restoran",
    "amenity:cafe": "Kafe", "amenity:university": "Universitet", "amenity:school": "Maktab", "amenity:hospital": "Shifoxona",
    "amenity:fuel": "Yoqilgʻi quyish shoxobchasi", "amenity:bus_station": "Avtovokzal", "amenity:theatre": "Teatr",
    "railway:station": "Temir yoʻl vokzali", "aeroway:aerodrome": "Aeroport", "aeroway:terminal": "Aeroport terminali",
    "natural:peak": "Togʻ choʻqqisi", "natural:water": "Suv havzasi", "natural:spring": "Buloq", "natural:cave_entrance": "Gʻor",
    "natural:desert": "Choʻl", "natural:wood": "Oʻrmon", "natural:beach": "Plyaj",
    "water:reservoir": "Suv ombori", "water:lake": "Koʻl", "landuse:reservoir": "Suv ombori",
    "leisure:park": "Bogʻ / park", "leisure:garden": "Bogʻ", "leisure:stadium": "Stadion", "leisure:water_park": "Akvapark",
    "boundary:administrative": "Maʼmuriy hudud", "landuse:residential": "Turar-joy hududi",
    "highway:residential": "Koʻcha", "highway:primary": "Katta yoʻl", "highway:trunk": "Magistral yoʻl",
    "highway:secondary": "Yoʻl", "highway:tertiary": "Yoʻl", "highway:unclassified": "Yoʻl",
    "building:yes": "Bino", "building:mosque": "Masjid", "shop:mall": "Savdo markazi",
  };

  const ADDRESSTYPE_UZ = {
    city: "Shahar", town: "Shaharcha", village: "Qishloq", hamlet: "Kichik qishloq", suburb: "Shahar tumani",
    neighbourhood: "Mahalla", road: "Koʻcha / yoʻl", building: "Bino", amenity: "Obyekt", county: "Tuman",
    state: "Viloyat", country: "Davlat", peak: "Togʻ choʻqqisi",
  };

  function placeType(info) {
    if (!info) return "Joy";
    const key = info.category + ":" + info.type;
    if (TYPE_UZ[key]) return TYPE_UZ[key];
    if (info.category === "historic") return "Tarixiy obida";
    if (info.category === "tourism") return "Sayyohlik obyekti";
    if (info.category === "natural") return "Tabiat obyekti";
    if (ADDRESSTYPE_UZ[info.addresstype]) return ADDRESSTYPE_UZ[info.addresstype];
    return "Joy";
  }

  const WMO = {
    0: "Ochiq osmon", 1: "Asosan ochiq", 2: "Qisman bulutli", 3: "Bulutli", 45: "Tuman", 48: "Qirovli tuman",
    51: "Yengil shivalama", 53: "Shivalama", 55: "Kuchli shivalama", 61: "Yengil yomgʻir", 63: "Yomgʻir",
    65: "Kuchli yomgʻir", 66: "Muzli yomgʻir", 67: "Kuchli muzli yomgʻir", 71: "Yengil qor", 73: "Qor",
    75: "Kuchli qor", 77: "Qor donalari", 80: "Jala", 81: "Kuchli jala", 82: "Juda kuchli jala",
    85: "Qor yogʻishi", 86: "Kuchli qor yogʻishi", 95: "Momaqaldiroq", 96: "Doʻlli momaqaldiroq", 99: "Kuchli doʻl",
  };
  const weatherText = (c) => WMO[c] || "—";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }

  /** Atrofdagi obyektlar zichligi bo'yicha hudud tavsifi. */
  function areaProfile(nearby) {
    if (!nearby) return null;
    const g = Object.fromEntries(nearby.groups.map((x) => [x.id, x.items]));
    const areaKm2 = Math.PI * (nearby.radius / 1000) ** 2;
    const services = ["food", "shop", "money", "pharmacy", "health", "hotel"].reduce((s, k) => s + g[k].length, 0);
    const density = services / areaKm2;
    let level, label, desc;
    if (density >= 40) { level = 4; label = "Gavjum shahar hududi"; desc = "Xizmat koʻrsatish obyektlari juda koʻp: ovqatlanish, doʻkon, bank va dorixonalar yaqin masofada."; }
    else if (density >= 12) { level = 3; label = "Shahar yoki tuman markazi"; desc = "Asosiy xizmatlar mavjud, kerakli narsalarni yaqin atrofdan topish mumkin."; }
    else if (density >= 2) { level = 2; label = "Kichik aholi punkti"; desc = "Xizmatlar soni cheklangan. Asosiy ehtiyojlarni oldindan rejalashtirgan maʼqul."; }
    else { level = 1; label = "Chekka yoki tabiat hududi"; desc = "Atrofda xizmat koʻrsatish obyektlari deyarli yoʻq. Suv, oziq-ovqat va yoqilgʻini oldindan gʻamlang."; }

    const sights = g.sight.length;
    let tourism = "past";
    if (sights >= 15) tourism = "juda yuqori";
    else if (sights >= 5) tourism = "yuqori";
    else if (sights >= 1) tourism = "oʻrtacha";

    const tips = [];
    const nearest = (k) => g[k][0];
    if (!g.fuel.length) tips.push({ warn: true, t: "Radius ichida yoqilgʻi quyish shoxobchasi topilmadi — yoʻlga chiqishdan oldin bakni toʻldiring." });
    else tips.push({ t: "Eng yaqin yoqilgʻi shoxobchasi " + global.Geo.fmtKm(nearest("fuel").dist) + " masofada" + fuelKinds(g.fuel) + "." });
    if (!g.hotel.length) tips.push({ warn: true, t: "Yaqin atrofda tunash joyi yoʻq. Tunab qolsangiz, mehmonxonani boshqa shaharda band qiling." });
    else tips.push({ t: g.hotel.length + " ta tunash joyi bor, eng yaqini " + global.Geo.fmtKm(nearest("hotel").dist) + "." });
    if (!g.health.length && !g.pharmacy.length) tips.push({ warn: true, t: "Tibbiyot muassasasi va dorixona topilmadi. Birinchi yordam qutisini olib yuring." });
    if (!g.money.length) tips.push({ warn: true, t: "Bankomat yoʻq — naqd pul olib oling." });
    if (g.food.length) tips.push({ t: g.food.length + " ta ovqatlanish joyi bor." });
    if (g.worship.length) tips.push({ t: "Masjid yoki ibodat joyi: " + g.worship.length + " ta, eng yaqini " + global.Geo.fmtKm(nearest("worship").dist) + "." });

    return { level, label, desc, density, tourism, sights, tips };
  }

  function fuelKinds(items) {
    const kinds = new Set();
    for (const it of items) {
      const t = it.tags || {};
      if (t["fuel:cng"] === "yes" || t["fuel:methane"] === "yes") kinds.add("metan");
      if (t["fuel:lpg"] === "yes") kinds.add("propan");
      if (/^(yes)$/.test(t["fuel:octane_91"] || t["fuel:octane_92"] || t["fuel:octane_95"] || "")) kinds.add("benzin");
    }
    return kinds.size ? " (" + Array.from(kinds).join(", ") + ")" : "";
  }

  function renderAbout(ctx) {
    const { stop, info, weather, wiki, nearby, leg } = ctx;
    const parts = [];
    const type = placeType(info || stop);
    const region = [info && info.city, info && info.district, info && info.region].filter(Boolean);
    const profile = areaProfile(nearby);

    parts.push('<div class="facts">');
    parts.push(fact("Joy turi", esc(type)));
    if (region.length) parts.push(fact("Hudud", esc(Array.from(new Set(region)).join(", "))));
    if (weather && Number.isFinite(weather.elevation)) {
      const el = Math.round(weather.elevation);
      parts.push(fact("Dengiz sathidan", el + " m" + (el > 1500 ? " · togʻli hudud" : el > 700 ? " · togʻoldi" : "")));
    }
    if (leg) parts.push(fact("Bu yerga yetib borish", esc(global.Geo.fmtKm(leg.distance) + " · " + global.Geo.fmtDuration(leg.duration))));
    if (profile) parts.push(fact("Hudud xarakteri", esc(profile.label)));
    if (profile) parts.push(fact("Sayyohlik salohiyati", esc(profile.tourism) + " <span class='muted'>(" + profile.sights + " ta obida)</span>"));
    parts.push("</div>");

    if (profile) {
      parts.push('<div class="verdict"><div class="level" aria-label="Infratuzilma darajasi ' + profile.level + ' / 4">');
      for (let i = 1; i <= 4; i++) parts.push('<span class="' + (i <= profile.level ? "on" : "") + '"></span>');
      parts.push("</div><p>" + esc(profile.desc) + "</p></div>");
      parts.push('<h4>Sayohatchi uchun</h4><ul class="tips">' +
        profile.tips.map((x) => '<li class="' + (x.warn ? "warn" : "") + '">' + esc(x.t) + "</li>").join("") + "</ul>");
    } else if (ctx.nearbyLoading) {
      parts.push('<p class="muted loading-line"><span class="spinner sm"></span>Atrofdagi obyektlar tahlil qilinmoqda…</p>');
    } else if (ctx.nearbyError) {
      parts.push('<p class="muted">Atrof tahlili hozircha mavjud emas: ' + esc(ctx.nearbyError) + "</p>");
    }

    if (weather && weather.current) {
      const c = weather.current, d = weather.daily;
      parts.push("<h4>Ob-havo</h4><div class=\"weather\">");
      parts.push('<div class="w-now"><span class="w-temp">' + Math.round(c.temperature_2m) + "°</span><span>" +
        esc(weatherText(c.weather_code)) + "<br><span class='muted'>shamol " + Math.round(c.wind_speed_10m) +
        " km/soat · namlik " + Math.round(c.relative_humidity_2m) + "%</span></span></div>");
      if (d && d.time) {
        const days = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
        parts.push('<div class="w-days">' + d.time.map((t, i) => {
          const dt = new Date(t + "T12:00:00");
          return '<div><span class="muted">' + (i === 0 ? "Bugun" : days[dt.getDay()]) + "</span><b>" +
            Math.round(d.temperature_2m_max[i]) + "° / " + Math.round(d.temperature_2m_min[i]) + "°</b><span class='muted'>" +
            esc(weatherText(d.weather_code[i])) + "</span></div>";
        }).join("") + "</div>");
      }
      parts.push("</div>");
    }

    if (wiki) {
      parts.push("<h4>Vikipediyadan</h4><div class=\"wiki\">");
      if (wiki.thumb) parts.push('<img src="' + esc(wiki.thumb) + '" alt="" loading="lazy">');
      parts.push('<div><a href="' + esc(wiki.url) + '" target="_blank" rel="noopener"><b>' + esc(wiki.title) + "</b></a>" +
        ' <span class="muted">· ' + global.Geo.fmtKm(wiki.dist) + "</span>");
      if (wiki.extract) parts.push("<p>" + esc(wiki.extract) + "</p>");
      parts.push("</div></div>");
      if (wiki.others && wiki.others.length) {
        parts.push('<p class="muted small">Yaqin atrofdagi boshqa maqolalar: ' + wiki.others.map((o) =>
          '<a href="' + esc(o.url) + '" target="_blank" rel="noopener">' + esc(o.title) + "</a>").join(", ") + "</p>");
      }
    } else if (ctx.wikiLoading) {
      parts.push('<p class="muted loading-line"><span class="spinner sm"></span>Maʼlumot qidirilmoqda…</p>');
    }
    return parts.join("");
  }

  function fact(k, v) {
    return '<div class="fact"><span>' + k + "</span><b>" + v + "</b></div>";
  }

  /* ---------- Atrofdagi obyektlar: turi, tavsifi va rasmi ---------- */

  const POI_KIND = {
    "amenity:restaurant": "Restoran", "amenity:cafe": "Kafe / choyxona", "amenity:fast_food": "Tez tayyorlanadigan taomlar",
    "amenity:food_court": "Ovqatlanish markazi", "amenity:fuel": "Yoqilgʻi quyish shoxobchasi", "amenity:hospital": "Shifoxona",
    "amenity:clinic": "Poliklinika", "amenity:doctors": "Shifokor qabulxonasi", "amenity:pharmacy": "Dorixona",
    "amenity:atm": "Bankomat", "amenity:bank": "Bank", "amenity:bureau_de_change": "Valyuta ayirboshlash shoxobchasi",
    "amenity:place_of_worship": "Ibodat joyi", "amenity:marketplace": "Bozor", "amenity:parking": "Avtoturargoh",
    "amenity:toilets": "Hojatxona", "amenity:police": "Militsiya / IIB", "amenity:bus_station": "Avtovokzal",
    "amenity:car_wash": "Avtomoyka",
    "tourism:hotel": "Mehmonxona", "tourism:guest_house": "Mehmon uyi", "tourism:hostel": "Hostel", "tourism:motel": "Motel",
    "tourism:apartment": "Ijara kvartira", "tourism:attraction": "Diqqatga sazovor joy", "tourism:museum": "Muzey",
    "tourism:viewpoint": "Manzaragoh", "tourism:gallery": "Sanʼat galereyasi", "tourism:artwork": "Sanʼat asari",
    "historic:monument": "Tarixiy yodgorlik", "historic:castle": "Qalʼa", "historic:fort": "Qalʼa",
    "historic:archaeological_site": "Arxeologik yodgorlik", "historic:ruins": "Xarobalar", "historic:tomb": "Maqbara",
    "historic:building": "Tarixiy bino", "historic:city_gate": "Shahar darvozasi", "historic:mosque": "Tarixiy masjid",
    "historic:madrasa": "Madrasa", "historic:mausoleum": "Maqbara", "historic:wayside_shrine": "Ziyoratgoh",
    "shop:supermarket": "Supermarket", "shop:convenience": "Oziq-ovqat doʻkoni", "shop:mall": "Savdo markazi",
    "shop:bakery": "Novvoyxona", "shop:general": "Doʻkon", "shop:car_repair": "Avtoservis", "shop:tyres": "Vulkanizatsiya",
    "shop:car_parts": "Avto ehtiyot qismlar",
    "leisure:park": "Park", "leisure:garden": "Bogʻ", "leisure:water_park": "Akvapark",
    "railway:station": "Temir yoʻl vokzali", "railway:halt": "Temir yoʻl bekati",
  };

  const CUISINE = {
    uzbek: "oʻzbek", russian: "rus", turkish: "turk", korean: "koreys", chinese: "xitoy", japanese: "yapon",
    italian: "italyan", european: "yevropa", international: "xalqaro", regional: "milliy", asian: "osiyo",
    pizza: "pitsa", burger: "burger", kebab: "kabob", shashlik: "shashlik", shashlyk: "shashlik", plov: "palov",
    pilaf: "palov", coffee_shop: "qahva", tea: "choy", sushi: "sushi", chicken: "tovuq", georgian: "gruzin",
    indian: "hind", arab: "arab", lagman: "lagʻmon", samsa: "somsa", fast_food: "tez taom",
  };

  const DAYS = { Mo: "Du", Tu: "Se", We: "Ch", Th: "Pa", Fr: "Ju", Sa: "Sh", Su: "Ya", PH: "bayram kunlari" };

  function poiKindKey(t) {
    for (const k of ["amenity", "tourism", "historic", "shop", "leisure", "railway"]) if (t[k]) return k + ":" + t[k];
    return "";
  }

  function poiKind(t) {
    const key = poiKindKey(t);
    if (t.amenity === "place_of_worship") {
      if (t.religion === "muslim" || /masjid|mosque|мечеть/i.test(t.name || "")) return "Masjid";
      if (t.religion === "christian") return "Cherkov";
      if (t.religion === "jewish") return "Sinagoga";
    }
    if (POI_KIND[key]) return POI_KIND[key];
    if (t.historic) return "Tarixiy obida";
    return "Obyekt";
  }

  function hours(v) {
    if (!v) return "";
    if (/^24\/7$/.test(v.trim())) return "kecha-kunduz ochiq";
    return v.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (m) => DAYS[m]).replace(/;\s*/g, "; ").replace(/\boff\b/g, "dam olish");
  }

  /** Teglardan qisqa izoh yasaydi. */
  function describePOI(it) {
    const t = it.tags || {};
    const facts = [];
    const own = t["description:uz"] || t.description || t["description:ru"] || t["description:en"] || "";
    if (t.cuisine) {
      const c = t.cuisine.split(/[;,]/).map((x) => x.trim().toLowerCase()).filter(Boolean).map((x) => CUISINE[x] || x.replace(/_/g, " "));
      facts.push("Oshxona: " + c.slice(0, 4).join(", "));
    }
    if (t.stars && /^\d/.test(t.stars)) facts.push("★".repeat(Math.min(5, parseInt(t.stars, 10))) + " (" + t.stars + " yulduz)");
    if (t.amenity === "fuel") {
      const f = [];
      if (/yes/.test([t["fuel:octane_80"], t["fuel:octane_91"], t["fuel:octane_92"], t["fuel:octane_95"]].join(" "))) f.push("benzin");
      if (t["fuel:diesel"] === "yes") f.push("dizel");
      if (t["fuel:cng"] === "yes" || t["fuel:methane"] === "yes") f.push("metan");
      if (t["fuel:lpg"] === "yes") f.push("propan");
      if (f.length) facts.push("Yoqilgʻi: " + f.join(", "));
    }
    if (t.brand || t.operator) facts.push((t.brand ? "Brend: " + t.brand : "Egasi: " + t.operator));
    if (t.start_date) facts.push("Qurilgan: " + t.start_date);
    if (t["heritage"] || t["heritage:operator"]) facts.push("Madaniy meros obyekti");
    if (t.rooms) facts.push(t.rooms + " ta xona");
    if (t.atm === "yes" && t.amenity === "bank") facts.push("bankomat bor");
    if (t.internet_access === "wlan" || t.internet_access === "yes") facts.push("Wi-Fi bor");
    if (t.opening_hours) facts.push("Ish vaqti: " + hours(t.opening_hours));
    const phone = t.phone || t["contact:phone"] || "";
    const site = t.website || t["contact:website"] || t.url || "";
    const insta = t["contact:instagram"] || "";
    const ex = it.extra || {};
    let text = own || ex.desc || "";
    if (ex.extract && ex.extract.length > text.length) text = ex.extract;
    return { kind: poiKind(t), text, facts, phone, site, insta, wikiUrl: ex.wikiUrl || "" };
  }

  function poiImage(it) {
    const t = it.tags || {};
    const ex = it.extra || {};
    const img = (t.image || "").trim();
    if (/^https?:\/\/commons\.wikimedia\.org\/wiki\/(File|Файл):/i.test(img)) return { src: window.API.commonsThumb(decodeURIComponent(img.split("/wiki/")[1])), photo: true };
    if (/^https?:\/\/.+\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(img)) return { src: img, photo: true };
    if (t.wikimedia_commons && /^(File|Файл):/i.test(t.wikimedia_commons)) return { src: window.API.commonsThumb(t.wikimedia_commons), photo: true };
    if (ex.image) return { src: ex.image, photo: true };
    return { src: window.API.satelliteThumb(it.lat, it.lon), photo: false };
  }

  const DIRS = ["shimolda", "shimoli-sharqda", "sharqda", "janubi-sharqda", "janubda", "janubi-gʻarbda", "gʻarbda", "shimoli-gʻarbda"];

  /** "Manzildan 240 m shimoli-sharqda, piyoda ~3 daqiqa" (piyoda 4,5 km/soat, yo'l egriligi ×1,3). */
  function whereText(it) {
    const dir = Number.isFinite(it.bearing) ? DIRS[Math.round(it.bearing / 45) % 8] : "";
    if (it.dist < 25) return "Manzilning shundoq yonida.";
    const walkMin = Math.max(1, Math.round(it.dist * 1.3 / 75));
    const walk = walkMin <= 40 ? "piyoda taxminan " + walkMin + " daqiqa" : "mashinada taxminan " + Math.max(1, Math.round(it.dist * 1.3 / 500)) + " daqiqa";
    return "Manzildan " + global.Geo.fmtKm(it.dist) + " " + dir + ", " + walk + ".";
  }

  function clip(text, n) {
    if (!text || text.length <= n) return text;
    const cut = text.slice(0, n);
    return cut.slice(0, Math.max(cut.lastIndexOf(". ") + 1, cut.lastIndexOf(" "))) + "…";
  }

  function poiCard(it) {
    const d = describePOI(it);
    const img = poiImage(it);
    const sat = window.API.satelliteThumb(it.lat, it.lon);
    const name = it.name ? esc(it.name) : '<i class="muted">Nomsiz ' + esc(d.kind.toLowerCase()) + "</i>";
    const links = [];
    if (d.wikiUrl) links.push('<a href="' + esc(d.wikiUrl) + '" target="_blank" rel="noopener">Vikipediya</a>');
    if (/^https?:\/\//i.test(d.site)) links.push('<a href="' + esc(d.site) + '" target="_blank" rel="noopener">Sayt</a>');
    if (d.insta) links.push('<a href="https://instagram.com/' + esc(d.insta.replace(/^.*instagram\.com\//, "").replace(/^@/, "")) + '" target="_blank" rel="noopener">Instagram</a>');
    if (d.phone) links.push('<span class="poi-phone">' + esc(d.phone.split(/[;,]/)[0]) + "</span>");
    links.push('<a href="https://yandex.uz/maps/?ll=' + it.lon + "%2C" + it.lat + "&z=18&pt=" + it.lon + "%2C" + it.lat + '" target="_blank" rel="noopener">Yandex</a>');
    links.push('<a href="https://www.google.com/maps/search/?api=1&query=' + it.lat + "%2C" + it.lon + '" target="_blank" rel="noopener">Google</a>');
    return '<li class="poi-card" data-key="' + esc(it.key) + '" data-lat="' + it.lat + '" data-lon="' + it.lon + '" data-name="' + esc(it.name || d.kind) + '">' +
      '<button type="button" class="poi-thumb' + (img.photo ? "" : " sat") + '" data-act="show" title="Xaritada koʻrsatish">' +
      '<img src="' + esc(img.src) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-sat="' + esc(sat) + '">' +
      (img.photo ? "" : '<span class="sat-tag">yoʻldosh</span>') + "</button>" +
      '<div class="poi-body">' +
      '<button type="button" class="poi-title" data-act="show"><b>' + name + "</b></button>" +
      '<span class="poi-kind">' + esc(d.kind) + "</span>" +
      (d.text ? '<p class="poi-desc">' + esc(clip(d.text, 220)) + "</p>" : "") +
      (d.facts.length ? '<p class="poi-facts">' + d.facts.map(esc).join(" · ") + "</p>" : "") +
      '<p class="poi-where">' + esc(whereText(it)) + "</p>" +
      '<div class="poi-links">' + links.join("") + "</div>" +
      "</div></li>";
  }

  const PAGE = 6;

  /**
   * @param nearby  API.nearby natijasi
   * @param ui      {open:Set<groupId>, expanded:Set<groupId>} — qaysi guruhlar ochiq / to'liq ko'rsatilgan
   */
  function renderAround(nearby, ui) {
    ui = ui || {};
    const rows = nearby.groups.filter((g) => g.items.length);
    const empty = nearby.groups.filter((g) => !g.items.length).map((g) => g.label.toLowerCase());
    const out = ['<p class="around-sum"><b>' + nearby.total + "</b> ta obyekt, " + global.Geo.fmtKm(nearby.radius) + " radiusda.</p>"];
    if (!rows.length) {
      out.push('<p class="muted">Bu radiusda xaritada belgilangan obyekt yoʻq. Radiusni kattalashtirib koʻring.</p>');
      return out.join("");
    }
    out.push('<div class="poi-groups">');
    rows.forEach((g, gi) => {
      const open = ui.open ? ui.open.has(g.id) : gi < 2;
      const all = ui.expanded && ui.expanded.has(g.id);
      const shown = all ? g.items : g.items.slice(0, PAGE);
      out.push('<details class="poi" data-group="' + g.id + '"' + (open ? " open" : "") + '><summary><span class="poi-name">' + esc(g.label) +
        '</span><span class="poi-count">' + g.items.length + '</span><span class="poi-near">eng yaqini ' +
        global.Geo.fmtKm(g.items[0].dist) + "</span></summary><ul>");
      if (open) shown.forEach((it) => out.push(poiCard(it)));
      out.push("</ul>");
      if (open && g.items.length > PAGE) {
        out.push('<button type="button" class="link-btn poi-more" data-group="' + g.id + '">' +
          (all ? "Kamroq koʻrsatish" : "Hammasini koʻrsatish (" + g.items.length + ")") + "</button>");
      }
      out.push("</details>");
    });
    out.push("</div>");
    if (empty.length) out.push('<p class="muted small">Topilmadi: ' + esc(empty.join(", ")) + ".</p>");
    out.push('<p class="muted small">Manba: OpenStreetMap' + (nearby.source === "nominatim" ? " (Nominatim orqali, asosiy toifalar boʻyicha qisqartirilgan roʻyxat)" : " (Overpass)") +
      '. Suratlar: Wikimedia Commons / Vikipediya; surat boʻlmasa — shu nuqtaning sunʼiy yoʻldosh tasviri (Esri). Ayrim obyektlar xaritaga belgilanmagan boʻlishi mumkin.</p>');
    return out.join("");
  }

  /** Ochiq guruhlarda ko'rinayotgan obyektlar (rasm/tavsif yuklash uchun). */
  function visiblePOIs(nearby, ui) {
    const rows = nearby.groups.filter((g) => g.items.length);
    const res = [];
    rows.forEach((g, gi) => {
      const open = ui.open ? ui.open.has(g.id) : gi < 2;
      if (!open) return;
      const all = ui.expanded && ui.expanded.has(g.id);
      res.push(...(all ? g.items : g.items.slice(0, PAGE)));
    });
    return res;
  }

  global.Place = { placeType, areaProfile, renderAbout, renderAround, visiblePOIs, describePOI, esc, weatherText };
})(window);

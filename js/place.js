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

  function renderAround(nearby) {
    const rows = nearby.groups.filter((g) => g.items.length);
    const empty = nearby.groups.filter((g) => !g.items.length).map((g) => g.label.toLowerCase());
    const out = ['<p class="around-sum"><b>' + nearby.total + "</b> ta obyekt, " + global.Geo.fmtKm(nearby.radius) + " radiusda.</p>"];
    if (!rows.length) {
      out.push('<p class="muted">Bu radiusda xaritada belgilangan obyekt yoʻq. Radiusni kattalashtirib koʻring.</p>');
      return out.join("");
    }
    out.push('<div class="poi-groups">');
    for (const g of rows) {
      out.push('<details class="poi"' + (rows.indexOf(g) < 3 ? " open" : "") + '><summary><span class="poi-name">' + esc(g.label) +
        '</span><span class="poi-count">' + g.items.length + '</span><span class="poi-near">eng yaqini ' +
        global.Geo.fmtKm(g.items[0].dist) + "</span></summary><ul>");
      for (const it of g.items.slice(0, 8)) {
        out.push('<li><button class="poi-item" type="button" data-lat="' + it.lat + '" data-lon="' + it.lon + '">' +
          '<span>' + (it.name ? esc(it.name) : '<i class="muted">nomsiz</i>') + "</span><span class=\"muted\">" +
          global.Geo.fmtKm(it.dist) + "</span></button></li>");
      }
      if (g.items.length > 8) out.push('<li class="muted small">yana ' + (g.items.length - 8) + " ta…</li>");
      out.push("</ul></details>");
    }
    out.push("</div>");
    if (empty.length) out.push('<p class="muted small">Topilmadi: ' + esc(empty.join(", ")) + ".</p>");
    out.push('<p class="muted small">Manba: OpenStreetMap' + (nearby.source === "photon" ? " (Photon orqali, qisqartirilgan roʻyxat)" : " (Overpass)") +
      '. Bu jamoatchilik xaritasi: ayrim obyektlar xaritaga belgilanmagan boʻlishi mumkin.</p>');
    return out.join("");
  }

  global.Place = { placeType, areaProfile, renderAbout, renderAround, esc, weatherText };
})(window);

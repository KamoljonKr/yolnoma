/*
 * Tashqi bepul xizmatlar bilan ishlash (API kalit talab qilinmaydi):
 *  - Nominatim / Photon (OpenStreetMap) — manzil qidirish va teskari geokodlash
 *  - OSRM — yo'l masofalari matritsasi va marshrut chizig'i
 *  - Overpass — atrofdagi obyektlar (kafe, mehmonxona, yoqilg'i shoxobchasi ...)
 *  - Wikipedia — joy haqida ma'lumot
 *  - Open-Meteo — ob-havo va dengiz sathidan balandlik
 */
(function (global) {
  "use strict";

  const CFG = Object.assign({
    nominatim: "https://nominatim.openstreetmap.org",
    photon: "https://photon.komoot.io",
    osrm: ["https://router.project-osrm.org", "https://routing.openstreetmap.de/routed-car"],
    overpass: [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ],
    openMeteo: "https://api.open-meteo.com/v1",
  }, global.YOLNOMA_CONFIG || {});

  const B = global.Geo.UZ_BBOX;

  async function fetchJSON(url, opts, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
    const outer = opts && opts.signal;
    if (outer) {
      if (outer.aborted) ctrl.abort();
      else outer.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    try {
      const res = await fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }));
      if (!res.ok) throw new Error("HTTP " + res.status + (res.status === 429 ? " (server band)" : res.status === 504 ? " (server yuklangan)" : ""));
      return await res.json();
    } catch (e) {
      if (e.name === "AbortError") throw new Error(outer && outer.aborted ? "bekor qilindi" : "javob kutish vaqti tugadi");
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  // Nominatim foydalanish qoidasi: soniyasiga 1 tadan ko'p so'rov yubormaslik.
  let nominatimChain = Promise.resolve();
  let lastNominatim = 0;
  function nominatimQueue(fn) {
    const run = nominatimChain.then(async () => {
      const wait = 1100 - (Date.now() - lastNominatim);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastNominatim = Date.now();
      return fn();
    });
    nominatimChain = run.catch(() => {});
    return run;
  }

  const searchCache = new Map();

  function normalizeNominatim(r) {
    const a = r.address || {};
    const name = r.name || (r.display_name || "").split(",")[0];
    return {
      name: name || "Nomaʼlum joy",
      address: r.display_name || "",
      lat: Number(r.lat),
      lon: Number(r.lon),
      category: r.category || r.class || "",
      type: r.type || "",
      addresstype: r.addresstype || "",
      region: a.state || a.region || "",
      district: a.county || a.city_district || a.district || "",
      city: a.city || a.town || a.village || a.hamlet || "",
    };
  }

  function normalizePhoton(f) {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const parts = [p.name, p.street && (p.street + (p.housenumber ? " " + p.housenumber : "")),
      p.city || p.town || p.village, p.county, p.state, p.country].filter(Boolean);
    return {
      name: p.name || parts[0] || "Nomaʼlum joy",
      address: Array.from(new Set(parts)).join(", "),
      lat, lon,
      category: p.osm_key || "", type: p.osm_value || "", addresstype: p.type || "",
      region: p.state || "", district: p.county || "", city: p.city || p.town || p.village || "",
    };
  }

  /** Manzil bo'yicha qidirish (faqat O'zbekiston hududida). */
  async function search(query) {
    const q = query.trim();
    if (q.length < 2) return [];
    if (searchCache.has(q)) return searchCache.get(q);
    let out = [];
    try {
      const url = CFG.nominatim + "/search?format=jsonv2&addressdetails=1&limit=7&countrycodes=uz" +
        "&accept-language=uz,ru,en&viewbox=" + [B.west, B.north, B.east, B.south].join(",") +
        "&q=" + encodeURIComponent(q);
      const data = await nominatimQueue(() => fetchJSON(url, { headers: { "Accept": "application/json" } }, 12000));
      out = data.map(normalizeNominatim);
    } catch (e) {
      console.warn("Nominatim xatosi, Photon ishlatiladi:", e);
    }
    if (!out.length) {
      try {
        const url = CFG.photon + "/api/?limit=7&bbox=" + [B.west, B.south, B.east, B.north].join(",") +
          "&q=" + encodeURIComponent(q);
        const data = await fetchJSON(url, null, 12000);
        out = (data.features || []).filter((f) => {
          const c = f.properties && f.properties.countrycode;
          return !c || c === "UZ";
        }).map(normalizePhoton);
      } catch (e) {
        console.warn("Photon xatosi:", e);
        if (!out.length) throw new Error("Qidiruv xizmatiga ulanib boʻlmadi. Internetni tekshiring yoki koordinata kiriting.");
      }
    }
    searchCache.set(q, out);
    return out;
  }

  /** Koordinata bo'yicha manzil (teskari geokodlash). */
  async function reverse(lat, lon) {
    try {
      const url = CFG.nominatim + "/reverse?format=jsonv2&addressdetails=1&extratags=1&namedetails=1&zoom=18" +
        "&accept-language=uz,ru,en&lat=" + lat + "&lon=" + lon;
      const r = await nominatimQueue(() => fetchJSON(url, null, 12000));
      if (r && !r.error) {
        const n = normalizeNominatim(r);
        n.lat = lat; n.lon = lon;
        n.extratags = r.extratags || {};
        return n;
      }
    } catch (e) {
      console.warn("Teskari geokodlash xatosi:", e);
    }
    try {
      const data = await fetchJSON(CFG.photon + "/reverse?lat=" + lat + "&lon=" + lon, null, 10000);
      if (data.features && data.features[0]) {
        const n = normalizePhoton(data.features[0]);
        n.lat = lat; n.lon = lon;
        return n;
      }
    } catch (_) { /* noop */ }
    return null;
  }

  function coordStr(points) {
    return points.map((p) => p.lon.toFixed(6) + "," + p.lat.toFixed(6)).join(";");
  }

  /** Taxminiy matritsa: to'g'ri chiziq × 1.3 (yo'l egriligi), o'rtacha 60 km/soat. */
  function estimateMatrix(points) {
    const distances = points.map((a) => points.map((b) => global.Geo.haversine(a, b) * 1.3));
    const durations = distances.map((row) => row.map((d) => d / (60 / 3.6)));
    return { distances, durations, source: "estimate" };
  }

  /** Haqiqiy yo'l masofalari matritsasi (OSRM). Ishlamasa taxminiy hisob. */
  async function matrix(points) {
    const est = estimateMatrix(points);
    for (const base of CFG.osrm) {
      try {
        const url = base + "/table/v1/driving/" + coordStr(points) + "?annotations=distance,duration";
        const data = await fetchJSON(url, null, 25000);
        if (data.code !== "Ok" || !data.distances) throw new Error(data.message || data.code);
        let patched = 0;
        const fix = (m, e) => m.map((row, i) => row.map((v, j) => {
          if (v === null || !Number.isFinite(v)) { patched++; return e[i][j]; }
          return v;
        }));
        return {
          distances: fix(data.distances, est.distances),
          durations: fix(data.durations, est.durations),
          source: "osrm",
          patched,
        };
      } catch (e) {
        console.warn("OSRM table xatosi (" + base + "):", e);
      }
    }
    return est;
  }

  /** Belgilangan tartibdagi marshrut chizig'i va har bir bo'lak (leg) ma'lumoti. */
  async function route(points) {
    for (const base of CFG.osrm) {
      try {
        const url = base + "/route/v1/driving/" + coordStr(points) +
          "?overview=full&geometries=geojson&steps=false";
        const data = await fetchJSON(url, null, 30000);
        if (data.code !== "Ok" || !data.routes || !data.routes[0]) throw new Error(data.message || data.code);
        const r = data.routes[0];
        return {
          geometry: r.geometry.coordinates.map((c) => [c[1], c[0]]),
          legs: r.legs.map((l) => ({ distance: l.distance, duration: l.duration })),
          distance: r.distance,
          duration: r.duration,
          source: "osrm",
        };
      } catch (e) {
        console.warn("OSRM route xatosi (" + base + "):", e);
      }
    }
    return null;
  }

  /* ---------- Atrofdagi obyektlar (Overpass) ---------- */

  const POI_GROUPS = [
    { id: "food", label: "Ovqatlanish", sub: "restoran, kafe, choyxona", match: (t) => /^(restaurant|cafe|fast_food|food_court)$/.test(t.amenity) },
    { id: "hotel", label: "Tunash joylari", sub: "mehmonxona, mehmon uyi, hostel", match: (t) => /^(hotel|guest_house|hostel|motel|apartment)$/.test(t.tourism) },
    { id: "fuel", label: "Yoqilgʻi quyish", sub: "benzin, metan, propan", match: (t) => t.amenity === "fuel" },
    { id: "sight", label: "Diqqatga sazovor", sub: "tarixiy obida, muzey, manzaragoh", match: (t) => /^(attraction|museum|viewpoint|gallery|artwork)$/.test(t.tourism) || (!!t.historic && t.historic !== "memorial") },
    { id: "health", label: "Tibbiyot", sub: "shifoxona, poliklinika", match: (t) => /^(hospital|clinic|doctors)$/.test(t.amenity) },
    { id: "pharmacy", label: "Dorixona", sub: "", match: (t) => t.amenity === "pharmacy" },
    { id: "money", label: "Bank va bankomat", sub: "", match: (t) => /^(atm|bank|bureau_de_change)$/.test(t.amenity) },
    { id: "shop", label: "Doʻkon va bozor", sub: "supermarket, bozor", match: (t) => /^(supermarket|convenience|mall|bakery|general)$/.test(t.shop) || t.amenity === "marketplace" },
    { id: "worship", label: "Masjid va ibodat joylari", sub: "", match: (t) => t.amenity === "place_of_worship" },
    { id: "car", label: "Avtoservis", sub: "ustaxona, vulkanizatsiya", match: (t) => /^(car_repair|tyres|car_parts)$/.test(t.shop) || t.amenity === "car_wash" },
    { id: "parking", label: "Avtoturargoh", sub: "", match: (t) => t.amenity === "parking" },
    { id: "transport", label: "Jamoat transporti", sub: "vokzal, avtovokzal, metro", match: (t) => t.amenity === "bus_station" || /^(station|halt)$/.test(t.railway) || t.public_transport === "station" },
    { id: "park", label: "Bogʻ va dam olish", sub: "park, xiyobon", match: (t) => /^(park|garden|water_park)$/.test(t.leisure) },
    { id: "toilet", label: "Hojatxona", sub: "", match: (t) => t.amenity === "toilets" },
    { id: "police", label: "Militsiya / IIB", sub: "", match: (t) => t.amenity === "police" },
  ];

  function overpassQuery(lat, lon, radius) {
    const a = "(around:" + radius + "," + lat.toFixed(6) + "," + lon.toFixed(6) + ")";
    return "[out:json][timeout:12];(" +
      "nw" + a + "[amenity~\"^(restaurant|cafe|fast_food|food_court|fuel|hospital|clinic|doctors|pharmacy|atm|bank|bureau_de_change|place_of_worship|marketplace|parking|toilets|police|bus_station|car_wash)$\"];" +
      "nw" + a + "[tourism~\"^(hotel|guest_house|hostel|motel|apartment|attraction|museum|viewpoint|gallery|artwork)$\"];" +
      "nw" + a + "[historic][historic!=memorial];" +
      "nw" + a + "[shop~\"^(supermarket|convenience|mall|bakery|general|car_repair|tyres|car_parts)$\"];" +
      "nw" + a + "[leisure~\"^(park|garden|water_park)$\"];" +
      "nw" + a + "[railway~\"^(station|halt)$\"];" +
      ");out tags center 600;";
  }

  const nearbyCache = new Map();

  /* 1-manba: Overpass (OpenStreetMap bazasiga to'g'ridan-to'g'ri so'rov, eng to'liq ma'lumot). */
  function overpassNearby(lat, lon, radius, signal, errors) {
    const q = overpassQuery(lat, lon, radius);
    const urls = CFG.overpass.slice();
    return new Promise((resolve, reject) => {
      let next = 0, running = 0, done = false, hedge = null;
      const finish = (ok, val) => { if (done) return; done = true; clearTimeout(hedge); ok ? resolve(val) : reject(val); };
      signal.addEventListener("abort", () => finish(false, new Error("bekor qilindi")), { once: true });
      const launch = () => {
        if (done) return;
        if (next >= urls.length) { if (running === 0) finish(false, new Error("Overpass ishlamadi")); return; }
        const url = urls[next++];
        const host = url.replace(/^https?:\/\//, "").split("/")[0];
        running++;
        clearTimeout(hedge);
        hedge = setTimeout(launch, 3000); // 3 soniyada javob bo'lmasa, keyingi server ham parallel
        fetchJSON(url + "?data=" + encodeURIComponent(q), { signal }, 15000).then((d) => {
          if (!d || !Array.isArray(d.elements)) throw new Error("notoʻgʻri javob");
          if (!d.elements.length && d.remark && /error|timed out|out of memory/i.test(d.remark)) throw new Error(d.remark);
          finish(true, { elements: d.elements, source: "overpass" });
        }).catch((e) => {
          running--;
          if (done) return;
          errors.push(host + ": " + e.message);
          launch(); // xato bo'lsa keyingi server darhol
        });
      };
      launch();
    });
  }

  /* 2-manba: Photon (komoot) — OpenStreetMap asosidagi qidiruv tizimi, toifa bo'yicha yaqin joylar. */
  const PHOTON_TAGS = {
    food: ["amenity:restaurant", "amenity:cafe", "amenity:fast_food"],
    hotel: ["tourism:hotel", "tourism:guest_house", "tourism:hostel", "tourism:motel"],
    fuel: ["amenity:fuel"],
    sight: ["tourism:attraction", "tourism:museum", "tourism:viewpoint", "historic"],
    health: ["amenity:hospital", "amenity:clinic", "amenity:doctors"],
    pharmacy: ["amenity:pharmacy"],
    money: ["amenity:atm", "amenity:bank"],
    shop: ["shop:supermarket", "shop:convenience", "shop:mall", "amenity:marketplace"],
    worship: ["amenity:place_of_worship"],
    car: ["shop:car_repair", "shop:tyres", "amenity:car_wash"],
    parking: ["amenity:parking"],
    transport: ["amenity:bus_station", "railway:station"],
    park: ["leisure:park", "leisure:garden"],
    toilet: ["amenity:toilets"],
    police: ["amenity:police"],
  };

  async function photonNearby(lat, lon, radius, signal, errors) {
    const km = Math.max(0.2, radius / 1000);
    const groups = Object.entries(PHOTON_TAGS);
    const elements = [];
    let ok = 0;
    await Promise.all(groups.map(async ([gid, tags]) => {
      const url = CFG.photon + "/reverse?lat=" + lat + "&lon=" + lon + "&radius=" + km + "&limit=40" +
        tags.map((t) => "&osm_tag=" + encodeURIComponent(t)).join("");
      try {
        const d = await fetchJSON(url, { signal }, 15000);
        ok++;
        for (const f of d.features || []) {
          const p = f.properties || {};
          const [flon, flat] = f.geometry.coordinates;
          elements.push({ type: p.osm_type || "N", id: p.osm_id || (gid + elements.length), lat: flat, lon: flon,
            tags: { [p.osm_key]: p.osm_value, name: p.name || "" } });
        }
      } catch (e) {
        errors.push("photon (" + gid + "): " + e.message);
      }
    }));
    if (!ok) throw new Error("Photon ishlamadi");
    return { elements, source: "photon" };
  }

  /**
   * Atrofdagi obyektlar. Avval Overpass ishga tushadi; 6 soniyada javob bo'lmasa, Photon ham
   * parallel ishga tushadi. Qaysi biri birinchi muvaffaqiyatli javob bersa, o'sha ko'rsatiladi.
   */
  async function nearby(lat, lon, radius) {
    const key = lat.toFixed(5) + "," + lon.toFixed(5) + "," + radius;
    if (nearbyCache.has(key)) return nearbyCache.get(key);
    const stop = new AbortController();
    const errors = [];
    const over = overpassNearby(lat, lon, radius, stop.signal, errors);
    const pho = new Promise((resolve, reject) => {
      let started = false;
      const start = () => { if (started || stop.signal.aborted) return; started = true; photonNearby(lat, lon, radius, stop.signal, errors).then(resolve, reject); };
      const t = setTimeout(start, 6000);
      over.catch(() => { clearTimeout(t); start(); }); // Overpass butunlay ishlamasa — darhol
      stop.signal.addEventListener("abort", () => { clearTimeout(t); if (!started) reject(new Error("kerak boʻlmadi")); }, { once: true });
    });
    let res;
    try {
      res = await Promise.any([over, pho]);
    } catch (_) {
      throw new Error("Xarita maʼlumotlari serverlariga ulanib boʻlmadi. (" + errors.join("; ") + ")");
    } finally {
      stop.abort();
    }
    const out = groupPOIs(res.elements, lat, lon, radius);
    out.source = res.source;
    nearbyCache.set(key, out);
    return out;
  }

  /** Diagnostika: qaysi xizmatlar sizning tarmog'ingizdan ochiladi. Konsolda: API.diagnose() */
  async function diagnose() {
    const tests = {
      "overpass-api.de": "https://overpass-api.de/api/status",
      "photon": CFG.photon + "/api/?q=Samarqand&limit=1",
      "nominatim": CFG.nominatim + "/search?q=Samarqand&format=json&limit=1",
      "osrm": CFG.osrm[0] + "/route/v1/driving/69.24,41.31;66.97,39.65?overview=false",
    };
    const out = {};
    for (const [k, u] of Object.entries(tests)) {
      const t0 = Date.now();
      try {
        const r = await fetch(u);
        out[k] = r.status + " · " + (Date.now() - t0) + " ms";
      } catch (e) { out[k] = "XATO: " + e.message + " · " + (Date.now() - t0) + " ms"; }
    }
    console.table(out);
    return out;
  }

  function groupPOIs(elements, lat, lon, radius) {
    const center = { lat, lon };
    const groups = POI_GROUPS.map((g) => ({ id: g.id, label: g.label, sub: g.sub, items: [] }));
    const seen = new Set();
    for (const el of elements) {
      const t = el.tags || {};
      const plat = el.lat != null ? el.lat : el.center && el.center.lat;
      const plon = el.lon != null ? el.lon : el.center && el.center.lon;
      if (plat == null || plon == null) continue;
      const gi = POI_GROUPS.findIndex((g) => g.match(t));
      if (gi < 0) continue;
      const key = el.type + el.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const dist = global.Geo.haversine(center, { lat: plat, lon: plon });
      if (dist > radius * 1.05) continue;
      groups[gi].items.push({
        name: t["name:uz"] || t.name || t["name:ru"] || t["name:en"] || "",
        kind: t.amenity || t.tourism || t.historic || t.shop || t.leisure || t.railway || "",
        tags: t,
        lat: plat, lon: plon, dist,
      });
    }
    for (const g of groups) g.items.sort((a, b) => a.dist - b.dist);
    return { radius, groups, total: groups.reduce((s, g) => s + g.items.length, 0) };
  }

  /* ---------- Wikipedia ---------- */

  async function wiki(lat, lon) {
    const langs = ["uz", "ru", "en"];
    for (const lang of langs) {
      try {
        const gs = await fetchJSON("https://" + lang + ".wikipedia.org/w/api.php?action=query&list=geosearch" +
          "&gscoord=" + lat + "%7C" + lon + "&gsradius=3000&gslimit=5&format=json&origin=*", null, 10000);
        const hits = (gs.query && gs.query.geosearch) || [];
        if (!hits.length) continue;
        const top = hits[0];
        let summary = null;
        try {
          summary = await fetchJSON("https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" +
            encodeURIComponent(top.title.replace(/ /g, "_")), null, 10000);
        } catch (_) { /* noop */ }
        return {
          lang,
          title: top.title,
          dist: top.dist,
          extract: summary && summary.extract ? summary.extract : "",
          thumb: summary && summary.thumbnail ? summary.thumbnail.source : "",
          url: summary && summary.content_urls ? summary.content_urls.desktop.page
            : "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(top.title.replace(/ /g, "_")),
          others: hits.slice(1).map((h) => ({ title: h.title, dist: h.dist,
            url: "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(h.title.replace(/ /g, "_")) })),
        };
      } catch (e) {
        console.warn("Wikipedia xatosi (" + lang + "):", e);
      }
    }
    return null;
  }

  /* ---------- Ob-havo va balandlik ---------- */

  async function weather(lat, lon) {
    try {
      const d = await fetchJSON(CFG.openMeteo + "/forecast?latitude=" + lat + "&longitude=" + lon +
        "&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=Asia%2FTashkent", null, 10000);
      return { elevation: d.elevation, current: d.current, daily: d.daily };
    } catch (e) {
      console.warn("Ob-havo xatosi:", e);
      return null;
    }
  }

  global.API = { search, reverse, matrix, route, nearby, diagnose, wiki, weather, estimateMatrix, POI_GROUPS, groupPOIs, CFG };
})(window);

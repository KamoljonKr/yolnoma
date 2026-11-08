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
  async function route(points, opts) {
    const overview = (opts && opts.overview) || "full"; // "simplified" — chegara tekshiruvi uchun yengilroq
    for (const base of CFG.osrm) {
      try {
        const url = base + "/route/v1/driving/" + coordStr(points) +
          "?overview=" + overview + "&geometries=geojson&steps=false";
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

  /**
   * Overpass so'rovi. "around" filtri tegli regex bilan birga juda sekin ishlaydi (server vaqt
   * tugashi / 504), shuning uchun to'rtburchak hudud (bbox) ishlatiladi — u fazoviy indeks orqali
   * tez bajariladi. Radiusdan tashqaridagi obyektlar keyin groupPOIs() da olib tashlanadi.
   */
  function overpassQuery(lat, lon, radius) {
    const dLat = radius / 111320;
    const dLon = radius / (111320 * Math.cos(lat * Math.PI / 180));
    const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(6)).join(",");
    return "[out:json][timeout:25][bbox:" + bbox + "];(" +
      "nw[amenity~\"^(restaurant|cafe|fast_food|food_court|fuel|hospital|clinic|doctors|pharmacy|atm|bank|bureau_de_change|place_of_worship|marketplace|parking|toilets|police|bus_station|car_wash)$\"];" +
      "nw[tourism~\"^(hotel|guest_house|hostel|motel|apartment|attraction|museum|viewpoint|gallery|artwork)$\"];" +
      "nw[historic][historic!=memorial];" +
      "nw[shop~\"^(supermarket|convenience|mall|bakery|general|car_repair|tyres|car_parts)$\"];" +
      "nw[leisure~\"^(park|garden|water_park)$\"];" +
      "nw[railway~\"^(station|halt)$\"];" +
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
        fetchJSON(url + "?data=" + encodeURIComponent(q), { signal }, 28000).then((d) => {
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

  /* 2-manba: Nominatim — toifa bo'yicha qidiruv hudud (viewbox) ichida. Qoida bo'yicha soniyasiga 1 ta so'rov,
     shuning uchun faqat eng muhim toifalar so'raladi. */
  const NOMINATIM_PHRASES = ["restaurant", "cafe", "hotel", "fuel", "pharmacy", "hospital", "atm",
    "supermarket", "mosque", "museum", "attraction", "marketplace"];

  async function nominatimNearby(lat, lon, radius, signal, errors) {
    const dLat = radius / 111320;
    const dLon = radius / (111320 * Math.cos(lat * Math.PI / 180));
    const viewbox = [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map((v) => v.toFixed(6)).join(",");
    const elements = [];
    let ok = 0;
    for (const phrase of NOMINATIM_PHRASES) {
      if (signal.aborted) break;
      const url = CFG.nominatim + "/search?format=jsonv2&limit=40&bounded=1&extratags=1&namedetails=1&accept-language=uz,ru,en" +
        "&viewbox=" + viewbox + "&q=" + encodeURIComponent(phrase);
      try {
        const d = await nominatimQueue(() => fetchJSON(url, { signal }, 12000));
        ok++;
        for (const r of d || []) {
          elements.push({ type: r.osm_type || "node", id: r.osm_id || r.place_id, lat: Number(r.lat), lon: Number(r.lon),
            tags: Object.assign({}, r.extratags || {}, r.namedetails || {}, { [r.category]: r.type, name: r.name || "" }) });
        }
      } catch (e) {
        errors.push("nominatim (" + phrase + "): " + e.message);
        if (!ok && errors.filter((x) => x.startsWith("nominatim")).length >= 3) break; // umuman ishlamayapti
      }
    }
    if (!ok) throw new Error("Nominatim ishlamadi");
    return { elements, source: "nominatim" };
  }

  /**
   * Atrofdagi obyektlar. Avval Overpass ishga tushadi; 10 soniyada javob bo'lmasa yoki xato bersa,
   * Nominatim ham ishga tushadi. Qaysi biri birinchi muvaffaqiyatli javob bersa, o'sha ko'rsatiladi.
   */
  async function nearby(lat, lon, radius) {
    const key = lat.toFixed(5) + "," + lon.toFixed(5) + "," + radius;
    if (nearbyCache.has(key)) return nearbyCache.get(key);
    const stop = new AbortController();
    const errors = [];
    const over = overpassNearby(lat, lon, radius, stop.signal, errors);
    const nom = new Promise((resolve, reject) => {
      let started = false;
      const start = () => { if (started || stop.signal.aborted) return; started = true; nominatimNearby(lat, lon, radius, stop.signal, errors).then(resolve, reject); };
      const t = setTimeout(start, 10000);
      over.catch(() => { clearTimeout(t); start(); }); // Overpass butunlay ishlamasa — darhol
      stop.signal.addEventListener("abort", () => { clearTimeout(t); if (!started) reject(new Error("kerak boʻlmadi")); }, { once: true });
    });
    let res;
    try {
      res = await Promise.any([over, nom]);
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
      const y = Math.sin((plon - lon) * Math.PI / 180) * Math.cos(plat * Math.PI / 180);
      const x = Math.cos(lat * Math.PI / 180) * Math.sin(plat * Math.PI / 180) -
        Math.sin(lat * Math.PI / 180) * Math.cos(plat * Math.PI / 180) * Math.cos((plon - lon) * Math.PI / 180);
      const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      if (dist > radius * 1.05) continue;
      groups[gi].items.push({
        key: el.type + "/" + el.id,
        name: t["name:uz"] || t.name || t["name:ru"] || t["name:en"] || "",
        kind: t.amenity || t.tourism || t.historic || t.shop || t.leisure || t.railway || "",
        tags: t,
        lat: plat, lon: plon, dist, bearing,
      });
    }
    for (const g of groups) g.items.sort((a, b) => a.dist - b.dist);
    return { radius, groups, total: groups.reduce((s, g) => s + g.items.length, 0) };
  }


  /* ---------- Obyektlar uchun rasm va tavsif (Wikidata / Vikipediya) ---------- */

  const wdCache = new Map();   // Q-id -> {image, desc, wiki}
  const wpCache = new Map();   // "lang:Title" -> {image, extract, url}
  const LANGS = ["uz", "ru", "en"];

  async function fetchWikidata(ids) {
    const need = ids.filter((id) => !wdCache.has(id));
    for (let i = 0; i < need.length; i += 25) {
      const batch = need.slice(i, i + 25);
      try {
        const d = await fetchJSON("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*" +
          "&props=claims%7Cdescriptions%7Csitelinks&languages=uz%7Cru%7Cen&ids=" + batch.join("%7C"), null, 15000);
        for (const id of batch) {
          const e = d.entities && d.entities[id];
          if (!e || e.missing !== undefined) { wdCache.set(id, null); continue; }
          const p18 = e.claims && e.claims.P18 && e.claims.P18[0] && e.claims.P18[0].mainsnak.datavalue;
          const desc = LANGS.map((l) => e.descriptions && e.descriptions[l] && e.descriptions[l].value).find(Boolean) || "";
          let wiki = "";
          for (const l of LANGS) {
            const sl = e.sitelinks && e.sitelinks[l + "wiki"];
            if (sl) { wiki = l + ":" + sl.title; break; }
          }
          wdCache.set(id, { image: p18 ? p18.value : "", desc, wiki });
        }
      } catch (e) {
        console.warn("Wikidata xatosi:", e);
        batch.forEach((id) => { if (!wdCache.has(id)) wdCache.set(id, null); });
      }
    }
  }

  async function fetchWikipedia(ref) {
    if (wpCache.has(ref)) return wpCache.get(ref);
    const m = ref.match(/^([a-z-]{2,12}):(.+)$/);
    if (!m) { wpCache.set(ref, null); return null; }
    const [, lang, title] = m;
    let out = null;
    try {
      const d = await fetchJSON("https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" +
        encodeURIComponent(title.replace(/ /g, "_")), null, 12000);
      out = {
        image: d.thumbnail ? d.thumbnail.source : "",
        extract: d.extract || "",
        url: d.content_urls ? d.content_urls.desktop.page : "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(title),
      };
    } catch (e) {
      console.warn("Vikipediya xatosi:", e);
    }
    wpCache.set(ref, out);
    return out;
  }

  /**
   * Ko'rsatilayotgan obyektlarga rasm va tavsif qo'shadi (it.extra).
   * Qaytaradi: hech bo'lmasa bitta obyekt o'zgardimi.
   */
  async function enrichPOIs(items) {
    const todo = items.filter((it) => !it.extra);
    if (!todo.length) return false;
    const ids = Array.from(new Set(todo.map((it) => (it.tags.wikidata || "").trim()).filter((id) => /^Q\d+$/.test(id))));
    if (ids.length) await fetchWikidata(ids);
    const wpRefs = [];
    for (const it of todo) {
      const wd = it.tags.wikidata ? wdCache.get(it.tags.wikidata.trim()) : null;
      it.extra = { image: "", desc: "", extract: "", wikiUrl: "" };
      if (wd) {
        if (wd.image) it.extra.image = commonsThumb(wd.image);
        it.extra.desc = wd.desc;
      }
      const ref = (it.tags.wikipedia || (wd && wd.wiki) || "").trim();
      if (ref) wpRefs.push([it, ref]);
    }
    // Vikipediya xulosalari (bir vaqtda ko'pi bilan 4 ta so'rov)
    let i = 0;
    const worker = async () => {
      while (i < wpRefs.length) {
        const [it, ref] = wpRefs[i++];
        const wp = await fetchWikipedia(ref);
        if (!wp) continue;
        if (!it.extra.image && wp.image) it.extra.image = wp.image;
        it.extra.extract = wp.extract;
        it.extra.wikiUrl = wp.url;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return true;
  }

  function commonsThumb(file, width) {
    const name = String(file).replace(/^(File|Fayl|Файл|Image):/i, "").trim();
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(name.replace(/ /g, "_")) + "?width=" + (width || 240);
  }

  /** Nuqtaning sun'iy yo'ldosh surati (Esri World Imagery, ~170 m × 130 m). */
  function satelliteThumb(lat, lon) {
    const dLat = 0.0006, dLon = 0.0006 / Math.cos(lat * Math.PI / 180) * 1.33;
    const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(6)).join(",");
    return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=" + bbox +
      "&bboxSR=4326&imageSR=3857&size=240,180&format=jpg&f=image";
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

  global.API = { search, reverse, matrix, route, nearby, diagnose, enrichPOIs, commonsThumb, satelliteThumb, wiki, weather, estimateMatrix, POI_GROUPS, groupPOIs, CFG };
})(window);

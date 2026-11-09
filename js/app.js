/* Yoʻlnoma — asosiy ilova mantigʻi. */
(function () {
  "use strict";

  const { Geo, TSP, API, Place, L } = window;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = Place.esc;
  const CONFIG = window.YOLNOMA_CONFIG || {};
  const STORE_KEY = "yolnoma.trip.v1";
  const HIST_KEY = "yolnoma.history.v1";   // saqlangan marshrut rejalari (Tarix)
  const PLAN_KEY = "yolnoma.plan.v1";      // hozirgi reja Tarixdagi qaysi yozuvga bogʻlangan
  const HIST_MAX = 50;
  const DEL_KEY = "yolnoma.history.del.v1";   // oʻchirilgan yozuvlar (serverga yetkazilguncha)
  const PLAN_AT_KEY = "yolnoma.plan.at.v1";    // hozirgi reja tanlangan vaqt (qurilmalar oʻrtasida eng soʻnggisi gʻolib)
  const SYNC_EMAIL_KEY = "yolnoma.sync.email";

  /* ---------------- Holat ---------------- */

  const SAMPLE = {
    start: { name: "Amir Temur xiyoboni", address: "Toshkent shahri", lat: 41.31118, lon: 69.27964, category: "leisure", type: "park", region: "Toshkent" },
    stops: [
      { name: "Registon maydoni", address: "Samarqand shahri, Samarqand viloyati", lat: 39.65486, lon: 66.97580, category: "tourism", type: "attraction", region: "Samarqand viloyati" },
      { name: "Ark qalʼasi", address: "Buxoro shahri, Buxoro viloyati", lat: 39.77799, lon: 64.41090, category: "historic", type: "castle", region: "Buxoro viloyati" },
      { name: "Ichan qalʼa", address: "Xiva shahri, Xorazm viloyati", lat: 41.37843, lon: 60.36387, category: "historic", type: "city_gate", region: "Xorazm viloyati" },
      { name: "Oqsaroy majmuasi", address: "Shahrisabz shahri, Qashqadaryo viloyati", lat: 39.05795, lon: 66.83207, category: "historic", type: "ruins", region: "Qashqadaryo viloyati" },
      { name: "Nurota chashmasi", address: "Nurota shahri, Navoiy viloyati", lat: 40.56172, lon: 65.68505, category: "natural", type: "spring", region: "Navoiy viloyati" },
    ],
  };

  let uid = 1;
  const newId = () => "p" + Date.now().toString(36) + (uid++);

  const state = {
    start: null,
    stops: [],
    metric: "distance",
    roundTrip: false,
    depart: "08:00",
    stay: 60,
    fuelRate: 8,
    fuelPrice: 10500,
    sample: false,
    work: { start: "10:00", end: "18:00", limit: "" },  // ish oynasi (hisobot va jonli rejim uchun)
  };
  let result = null;          // hisoblangan marshrut
  const syncSt = { busy: false, applying: false, again: false, timer: null, last: 0, err: "", sent: "" };
  let planId = null;          // hozirgi reja bogʻlangan Tarix yozuvi (oʻzgarishlar unga avtomatik yoziladi)
  let readonly = false;       // ulashilgan havola: faqat koʻrish (tahrirlash va saqlash yoʻq)
  let pickMode = null;        // "start" | "stop" | null
  const details = new Map();  // id -> {info, weather, wiki, nearby:{radius:data}}

  /** Havolani tozalaydi: faqat http(s). Boʻsh -> "", yaroqsiz -> null. Sxemasiz ("t.me/x") yozuvga https:// qoʻshiladi. */
  function cleanUrl(raw) {
    let t = String(raw || "").trim();
    if (!t) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = "https://" + t;
    try {
      const u = new URL(t);
      if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname.includes(".")) return null;
      return u.href.length <= 500 ? u.href : null;
    } catch (_) { return null; }
  }
  const linkHost = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return url; } };
  const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  /** Bosiladigan havola belgisi (HTML). cls — "link-chip" (kartada) yoki "it-link" (marshrut jadvalida). */
  function linkTag(url, cls) {
    return url ? '<a class="' + cls + '" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(url) + '">' + LINK_ICON + esc(linkHost(url)) + "</a>" : "";
  }

  /** Manzilning oʻz turish vaqti (daqiqa). Boʻsh/notoʻgʻri boʻlsa null. */
  function cleanStay(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 1440 ? n : null;
  }
  const stayOf = (s) => (s && s.stay !== null && s.stay !== undefined ? s.stay : state.stay);
  const hoursStr = (min) => String(Math.round(min / 60 * 100) / 100);

  function place(p) {
    return {
      id: p.id || newId(),
      name: p.name || "Nomaʼlum joy",
      address: p.address || "",
      lat: Number(p.lat), lon: Number(p.lon),
      category: p.category || "", type: p.type || "", addresstype: p.addresstype || "",
      region: p.region || "", district: p.district || "", city: p.city || "",
      note: String(p.note || "").trim().slice(0, 80), // foydalanuvchining oʻzi uchun izohi
      link: cleanUrl(p.link) || "", // manzilga biriktirilgan qoʻshimcha havola
      stay: cleanStay(p.stay), // shu manzilda necha daqiqa turish (null — umumiy "Har manzilda turish" ishlatiladi)
      pin: Number.isInteger(Number(p.pin)) && Number(p.pin) > 0 ? Number(p.pin) : 0, // qoʻlda belgilangan tashrif oʻrni (0 — avtomatik)
    };
  }

  function serialize(forShare) {
    // Ulashishda har manzilning hisoblangan tashrif oʻrni "pin" qilib yoziladi: koʻruvchida tartib aynan shunday chiqadi
    const visit = forShare && result && !result.stale ? new Map(result.order.map((id, i) => [id, i + 1])) : null;
    const slim = (p) => p && ({ name: p.name, address: p.address, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6),
      category: p.category, type: p.type, region: p.region, note: p.note || "", link: p.link || "", stay: p.stay === undefined ? null : p.stay, pin: visit && visit.has(p.id) ? visit.get(p.id) : (forShare ? 0 : p.pin || 0) });
    return {
      start: slim(state.start), stops: state.stops.map(slim), metric: state.metric, roundTrip: state.roundTrip,
      depart: state.depart, stay: state.stay, fuelRate: state.fuelRate, fuelPrice: state.fuelPrice, sample: forShare ? false : state.sample,
      work: state.work,
    };
  }

  function load(data) {
    state.start = data.start ? place(data.start) : null;
    state.stops = (data.stops || []).filter((s) => Geo.validLatLon(+s.lat, +s.lon)).map(place);
    for (const k of ["metric", "roundTrip", "depart", "stay", "fuelRate", "fuelPrice", "sample"]) {
      if (data[k] !== undefined) state[k] = data[k];
    }
    if (data.work && typeof data.work === "object") {
      const hm = (v, d) => (/^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : d);
      state.work = { start: hm(data.work.start, "10:00"), end: hm(data.work.end, "18:00"), limit: hm(data.work.limit, "") };
    }
  }

  function save() {
    if (readonly) return;   // ulashilgan safar koʻruvchining oʻz saqlangan safarini bosib ketmasligi kerak
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); } catch (_) { /* noop */ }
    ensureBound();
    histSync();
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64decode(s) {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  /* ---------------- Xarita ---------------- */

  const map = L.map("map", {
    zoomControl: false, preferCanvas: false,
    rotate: true, bearing: 0, touchRotate: true, shiftKeyRotate: true, rotateControl: { position: "topleft", closeOnZeroBearing: true },   // ikki barmoq bilan aylantirish
  }).setView([41.2, 64.6], 6);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
  });
  const esriImg = () => L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, maxNativeZoom: 18, attribution: "Tasvirlar &copy; Esri, Maxar, Earthstar Geographics",
  });
  const esriLabels = () => L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 18 });
  const esriRoads = () => L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 18 });
  const satellite = esriImg();
  const hybrid = L.layerGroup([esriImg(), esriRoads(), esriLabels()]);
  osm.addTo(map);
  L.control.layers({ "Xarita": osm, "Sunʼiy yoʻldosh": satellite, "Gibrid (yoʻldosh + yoʻllar)": hybrid }, null, { position: "topright" }).addTo(map);

  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const poiLayer = L.layerGroup().addTo(map);

  function pin(label, cls) {
    return L.divIcon({
      className: "pin-wrap",
      html: '<div class="pin ' + cls + '"><span>' + label + "</span></div>",
      iconSize: [34, 42], iconAnchor: [17, 40], popupAnchor: [0, -36],
    });
  }

  function renderMarkers() {
    markerLayer.clearLayers();
    const solved = result && !result.stale;
    if (state.start) {
      L.marker([state.start.lat, state.start.lon], { icon: pin("A", "start"), title: state.start.name, zIndexOffset: 1000 })
        .on("click", () => openDrawer(state.start.id))
        .bindTooltip("Boshlangʻich: " + esc(state.start.name), { direction: "top", offset: [0, -36] })
        .addTo(markerLayer);
    }
    state.stops.forEach((s, i) => {
      const visit = solved ? result.order.indexOf(s.id) + 1 : 0;
      const label = solved ? String(visit) : String(i + 1);
      L.marker([s.lat, s.lon], { icon: pin(label, solved ? "stop" : "stop pending"), title: s.name })
        .on("click", () => openDrawer(s.id))
        .bindTooltip((solved ? visit + "-manzil: " : "") + esc(s.name) + (s.note ? " — " + esc(s.note) : ""), { direction: "top", offset: [0, -36] })
        .addTo(markerLayer);
    });
  }

  function fitAll() {
    const pts = [];
    if (state.start) pts.push([state.start.lat, state.start.lon]);
    state.stops.forEach((s) => pts.push([s.lat, s.lon]));
    if (result && !result.stale && result.geometry) result.geometry.forEach((p, i) => { if (i % 20 === 0) pts.push(p); });
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
  }

  /* ---------------- Ro'yxatlar ---------------- */

  function renderStart() {
    const el = $("#start-card");
    if (!state.start) { el.innerHTML = ""; return; }
    const s = state.start;
    el.innerHTML = '<div class="place-card start">' +
      '<span class="badge start">A</span>' +
      '<div class="pc-text"><b>' + esc(s.name) + '</b><span>' + esc(s.address || Geo.fmtCoord(s.lat, s.lon)) + "</span></div>" +
      '<div class="pc-actions">' +
      '<button class="icon-btn" type="button" data-act="info" title="Joy haqida"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg></button>' +
      (readonly ? "" : '<button class="icon-btn" type="button" data-act="remove" title="Oʻchirish"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>') +
      "</div></div>";
    $('[data-act="info"]', el).onclick = () => openDrawer(s.id);
    if (!readonly) $('[data-act="remove"]', el).onclick = () => { state.start = null; changed(); };
  }

  /** Foydalanuvchi izohi uchun kichik belgi (HTML). */
  function noteTag(note) { return note ? '<em class="note">' + esc(note) + "</em>" : ""; }

  function renderStops() {
    const list = $("#stop-list");
    const solved = result && !result.stale;
    $("#stop-count").textContent = state.stops.length;
    $("#stops-empty").hidden = state.stops.length > 0;
    list.innerHTML = state.stops.map((s, i) => {
      const visit = solved ? result.order.indexOf(s.id) + 1 : 0;
      if (readonly) {
        return '<li class="place-card" data-id="' + s.id + '">' +
          '<span class="badge ' + (solved ? "" : "pending") + '">' + (solved ? visit : i + 1) + "</span>" +
          '<div class="pc-text">' + noteTag(s.note) + "<b>" + esc(s.name) + "</b><span>" + esc(s.address || Geo.fmtCoord(s.lat, s.lon)) + "</span>" + linkTag(s.link, "link-chip") + "</div>" +
          '<div class="pc-actions">' + (stayOf(s) ? '<span class="ro-stay">' + hoursStr(stayOf(s)) + " soat</span>" : "") +
          '<button class="icon-btn" type="button" data-act="info" title="Joy haqida"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg></button>' +
          "</div></li>";
      }
      return '<li class="place-card' + (s.pin ? " pinned" : "") + '" data-id="' + s.id + '">' +
        '<span class="badge ' + (solved ? "" : "pending") + '" title="' + (solved ? "Tashrif tartibi" : "Kiritilgan tartib") + '">' + (solved ? visit : i + 1) + "</span>" +
        '<div class="pc-text">' + noteTag(s.note) + "<b>" + esc(s.name) + "</b><span>" + esc(s.address || Geo.fmtCoord(s.lat, s.lon)) + "</span>" + linkTag(s.link, "link-chip") + "</div>" +
        '<div class="pc-actions">' +
        '<label class="stay-wrap" title="Shu manzilda necha soat boʻlasiz. Boʻsh qoldirsangiz — umumiy “Har manzilda turish” ishlatiladi (hozir ' + hoursStr(state.stay) + ' soat).">' +
        '<input class="stay-input" type="number" inputmode="decimal" min="0" max="24" step="0.5" value="' + (s.stay === null ? "" : hoursStr(s.stay)) + '" placeholder="' + hoursStr(state.stay) + '" aria-label="Shu manzilda turish, soat"><small>soat</small></label>' +
        '<input class="pos-input" type="number" inputmode="numeric" min="1" max="' + state.stops.length + '" step="1" value="' + (s.pin || "") + '" placeholder="' + (solved ? visit : i + 1) + '"' +
        ' title="Tashrif tartibidagi oʻrni. Raqam yozsangiz, manzil aynan shu oʻringa qoʻyiladi va marshrut qayta hisoblanadi. Boʻsh qoldirsangiz — avtomatik." aria-label="Tashrif tartibidagi oʻrni">' +
        '<button class="icon-btn" type="button" data-act="link" title="Havola qoʻshish / oʻzgartirish">' + LINK_ICON + "</button>" +
        '<button class="icon-btn" type="button" data-act="edit" title="Tahrirlash: manzilni almashtirish, izoh, havola" aria-label="Manzilni tahrirlash"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>' +
        '<button class="icon-btn" type="button" data-act="info" title="Joy haqida"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg></button>' +
        '<button class="icon-btn" type="button" data-act="remove" title="Oʻchirish"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        "</div></li>";
    }).join("");
  }

  /* Tashrif oʻrnini qoʻlda belgilash: raqam yozilsa, manzil shu oʻringa qotiriladi va marshrut qayta hisoblanadi */
  /* Shu manzilda necha soat turish: marshrut tartibiga taʼsir qilmaydi, faqat vaqt jadvali oʻzgaradi */
  $("#stop-list").addEventListener("change", (e) => {
    if (readonly) return;
    const si = e.target.closest(".stay-input");
    if (si) {
      const li = si.closest("li[data-id]"), s = li && stopById(li.dataset.id);
      if (!s) return;
      const raw = si.value.trim().replace(",", ".");
      if (raw === "") s.stay = null;
      else {
        const h = Number(raw);
        if (!Number.isFinite(h) || h < 0 || h > 24) { toast("Vaqt 0 dan 24 soatgacha boʻlishi kerak.", "warn"); si.value = s.stay === null ? "" : hoursStr(s.stay); return; }
        s.stay = Math.round(h * 60);
      }
      si.value = s.stay === null ? "" : hoursStr(s.stay);
      save();
      if (result && !result.stale) renderResult();
      return;
    }
    const inp = e.target.closest(".pos-input");
    const li = inp && inp.closest("li[data-id]");
    const s = li && stopById(li.dataset.id);
    if (!s) return;
    const raw = inp.value.trim(), n = state.stops.length;
    if (raw === "") s.pin = 0;
    else {
      const k = Number(raw);
      if (!Number.isInteger(k) || k < 1 || k > n) { toast("Oʻrin 1 dan " + n + " gacha boʻlishi kerak.", "warn"); inp.value = s.pin || ""; return; }
      const other = state.stops.find((x) => x !== s && x.pin === k);
      if (other) { toast(k + "-oʻrin allaqachon “" + other.name + "” uchun belgilangan. Avval uni boʻshating.", "warn"); inp.value = s.pin || ""; return; }
      s.pin = k;
    }
    const hadResult = !!result;
    changed({ keepSample: true });
    if (hadResult && state.start) solve();
  });

  $("#stop-list").addEventListener("click", (e) => {
    if (e.target.closest(".pos-input") || e.target.closest(".stay-wrap") || e.target.closest("a")) return;
    const btn = e.target.closest("button[data-act]");
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const id = li.dataset.id;
    if (readonly && btn && btn.dataset.act !== "info") return;
    if (btn && btn.dataset.act === "remove") {
      state.stops = state.stops.filter((s) => s.id !== id);
      changed();
    } else if (btn && btn.dataset.act === "link") {
      const s = state.stops.find((x) => x.id === id);
      if (!s) return;
      const v = window.prompt("Havola (http/https). Boʻsh qoldirsangiz, havola oʻchadi:", s.link || "");
      if (v === null) return;
      const l = cleanUrl(v);
      if (l === null) { toast("Havola yaroqsiz (http yoki https bilan boshlanadigan toʻliq manzil kerak).", "warn"); return; }
      s.link = l;
      save();
      renderAll();
      if (result && !result.stale) renderResult();
    } else if (btn && btn.dataset.act === "edit") {
      openEdit(id);
    } else {
      openDrawer(id);
    }
  });

  function changed(opts) {
    if (lv && lv.on) stopLive("Safar oʻzgartirildi — jonli rejim toʻxtatildi.");
    if (state.sample && !(opts && opts.keepSample)) state.sample = false;
    if (result) result.stale = true;
    save();
    renderAll();
  }

  function renderAll() {
    $("#sample-note").hidden = !state.sample;
    renderStart();
    renderStops();
    renderMarkers();
    renderResultState();
  }

  /* ---------------- Qidiruv ---------------- */

  function toast(msg, kind) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast " + (kind || "");
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 4200);
  }

  async function resolveCoords(lat, lon, fallbackName) {
    const base = place({ name: fallbackName || Geo.fmtCoord(lat, lon), address: Geo.fmtCoord(lat, lon), lat, lon });
    return base;
  }

  /** Nomini teskari geokodlash orqali keyinroq yangilaydi. */
  function enrichName(p) {
    API.reverse(p.lat, p.lon).then((info) => {
      if (!info) return;
      const target = state.start && state.start.id === p.id ? state.start : state.stops.find((s) => s.id === p.id);
      if (!target) return;
      if (/^-?\d/.test(target.name)) target.name = info.name;
      target.address = info.address;
      target.category = info.category; target.type = info.type; target.addresstype = info.addresstype;
      target.region = info.region; target.district = info.district; target.city = info.city;
      const d = details.get(p.id) || {};
      d.info = info; details.set(p.id, d);
      save(); renderStart(); renderStops(); renderMarkers();
    });
  }

  function setupSearch(root, onPick) {
    const input = $("input", root);
    const list = $(".suggest", root);
    let items = [], active = -1, timer = null, seq = 0;

    function close() { list.hidden = true; active = -1; }
    function show(msgHtml) { list.innerHTML = msgHtml; list.hidden = false; }

    function renderItems() {
      if (!items.length) { show('<li class="sg-msg">Hech narsa topilmadi. Boshqacha yozib koʻring yoki koordinata kiriting.</li>'); return; }
      show(items.map((it, i) => '<li role="option" class="sg-item' + (i === active ? " active" : "") + '" data-i="' + i + '">' +
        "<b>" + esc(it.name) + "</b><span>" + esc(it.address) + "</span></li>").join(""));
    }

    async function lookup(text, immediate) {
      const q = text.trim();
      if (!q) { close(); return; }
      const parsed = Geo.parseLocationInput(q);
      if (parsed && parsed.shortLink) {
        show('<li class="sg-msg">Qisqa havolani brauzer ochib bera olmaydi. Havolani oching va manzil satridagi toʻliq URL yoki koordinatani nusxalab qoʻying.</li>');
        return;
      }
      if (parsed) {
        items = [{ name: (parsed.source === "google" ? "Google Maps nuqtasi" : parsed.source === "yandex" ? "Yandex Karta nuqtasi" : "Koordinata"),
          address: Geo.fmtCoord(parsed.lat, parsed.lon) + (Geo.inUzbekistan(parsed.lat, parsed.lon) ? "" : " · Oʻzbekistondan tashqarida"),
          lat: parsed.lat, lon: parsed.lon, fromCoords: true }];
        active = 0; renderItems();
        if (immediate) choose(0);
        return;
      }
      if (q.length < 3 && !immediate) { close(); return; }
      const my = ++seq;
      show('<li class="sg-msg"><span class="spinner sm"></span> Qidirilmoqda…</li>');
      try {
        const res = await API.search(q);
        if (my !== seq) return;
        items = res; active = res.length ? 0 : -1; renderItems();
        if (immediate && res.length === 1) choose(0);
      } catch (e) {
        if (my !== seq) return;
        show('<li class="sg-msg">' + esc(e.message) + "</li>");
      }
    }

    async function choose(i) {
      const it = items[i];
      if (!it) return;
      close();
      input.value = "";
      items = [];
      const p = place(it);
      if (it.fromCoords) p.name = Geo.fmtCoord(it.lat, it.lon);
      onPick(p, !!it.fromCoords);
    }

    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => lookup(input.value, false), 650);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && items.length) { active = (active + 1) % items.length; renderItems(); e.preventDefault(); }
      else if (e.key === "ArrowUp" && items.length) { active = (active - 1 + items.length) % items.length; renderItems(); e.preventDefault(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(timer);
        if (!list.hidden && active >= 0 && items[active]) choose(active);
        else lookup(input.value, true);
      } else if (e.key === "Escape") close();
    });
    input.addEventListener("paste", () => setTimeout(() => { clearTimeout(timer); lookup(input.value, false); }, 0));
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest(".sg-item");
      if (li) { e.preventDefault(); choose(Number(li.dataset.i)); }
    });
    input.addEventListener("blur", () => setTimeout(close, 150));
  }

  function setStart(p, needsName) {
    state.start = p;
    changed();
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 11));
    if (needsName) enrichName(p);
    if (!Geo.inUzbekistan(p.lat, p.lon)) toast("Diqqat: bu nuqta Oʻzbekiston hududidan tashqarida.", "warn");
  }

  const noteInput = $("#stop-note");
  const linkInput = $("#stop-link");
  for (const el of [noteInput, linkInput]) {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); (el === noteInput ? linkInput : $("#stop-input")).focus(); }
    });
  }

  function addStop(p, needsName, useExtras) {
    const dup = state.stops.find((s) => Geo.haversine(s, p) < 30);
    if (dup) { toast("“" + dup.name + "” allaqachon roʻyxatda bor."); return false; }
    if (useExtras !== false) { // izoh va havola inputlaridagi qiymat shu manzilga biriktiriladi
      const note = noteInput.value.trim().slice(0, 80);
      if (note) p.note = note;
      noteInput.value = "";
      const rawLink = linkInput.value.trim();
      if (rawLink) {
        const l = cleanUrl(rawLink);
        if (l) { p.link = l; linkInput.value = ""; }
        else toast("Havola yaroqsiz (http yoki https bilan boshlanadigan toʻliq manzil kerak), saqlanmadi.", "warn");
      }
    }
    state.stops.push(p);
    changed();
    if (needsName) enrichName(p);
    if (!Geo.inUzbekistan(p.lat, p.lon)) toast("Diqqat: “" + p.name + "” Oʻzbekiston hududidan tashqarida.", "warn");
    return true;
  }

  setupSearch($('.search-field[data-role="start"]'), (p, n) => setStart(p, n));
  setupSearch($('.search-field[data-role="stop"]'), (p, n) => { if (addStop(p, n)) fitAll(); });

  /* Ro'yxat bilan qo'shish */
  $("#btn-bulk-toggle").onclick = () => {
    const box = $("#bulk-box");
    box.hidden = !box.hidden;
    $("#btn-bulk-toggle").setAttribute("aria-expanded", String(!box.hidden));
    if (!box.hidden) $("#bulk-input").focus();
  };
  $("#btn-bulk").onclick = async () => {
    const lines = $("#bulk-input").value.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { toast("Avval manzillarni yozing."); return; }
    const status = $("#bulk-status");
    const btn = $("#btn-bulk");
    btn.disabled = true;
    const failed = [];
    let added = 0;
    for (let i = 0; i < lines.length; i++) {
      status.textContent = (i + 1) + " / " + lines.length + ": " + lines[i].slice(0, 40);
      const parsed = Geo.parseLocationInput(lines[i]);
      try {
        if (parsed && parsed.shortLink) { failed.push(lines[i] + " (qisqa havola)"); continue; }
        if (parsed) {
          const p = place({ name: Geo.fmtCoord(parsed.lat, parsed.lon), address: "", lat: parsed.lat, lon: parsed.lon });
          if (addStop(p, true, false)) added++;
        } else {
          const res = await API.search(lines[i]);
          if (res.length) { if (addStop(place(res[0]), false, false)) added++; } else failed.push(lines[i]);
        }
      } catch (e) {
        failed.push(lines[i]);
      }
    }
    btn.disabled = false;
    status.textContent = added + " ta qoʻshildi" + (failed.length ? ", " + failed.length + " ta topilmadi" : "") + ".";
    $("#bulk-input").value = failed.join("\n");
    if (failed.length) toast("Topilmadi: " + failed.join("; "), "warn");
    fitAll();
  };

  /* Xaritadan tanlash */
  function setPick(mode) {
    pickMode = mode;
    $("#pick-banner").hidden = !mode;
    $("#map").classList.toggle("picking", !!mode);
    $("#pick-text").textContent = mode === "start" ? "Boshlangʻich nuqtani xaritada bosing" : "Manzilni xaritada bosing (bir nechta qoʻshish mumkin)";
    if (mode && window.matchMedia("(max-width: 900px)").matches) $(".map-wrap").scrollIntoView({ behavior: "smooth" });
  }
  $("#btn-pick-start").onclick = () => setPick("start");
  $("#btn-pick-stop").onclick = () => setPick("stop");
  $("#btn-pick-cancel").onclick = () => setPick(null);
  map.on("click", async (e) => {
    if (!pickMode) return;
    const p = await resolveCoords(e.latlng.lat, e.latlng.lng);
    if (pickMode === "start") { setStart(p, true); setPick(null); }
    else addStop(p, true);
  });

  /* Joylashuv */
  $("#btn-geo").onclick = () => {
    if (!navigator.geolocation) { toast("Brauzeringiz joylashuvni aniqlay olmaydi."); return; }
    toast("Joylashuv aniqlanmoqda…");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const p = await resolveCoords(pos.coords.latitude, pos.coords.longitude, "Mening joylashuvim");
      setStart(p, true);
      $("#toast").hidden = true;
    }, (err) => {
      toast(err.code === 1 ? "Joylashuvga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering." : "Joylashuvni aniqlab boʻlmadi.", "warn");
    }, { enableHighAccuracy: true, timeout: 15000 });
  };

  /* ---------------- Sozlamalar ---------------- */

  function bindOptions() {
    $$('input[name="metric"]').forEach((r) => {
      r.checked = r.value === state.metric;
      r.onchange = () => { state.metric = r.value; changed({ keepSample: true }); };
    });
    const rt = $("#roundtrip");
    rt.checked = !!state.roundTrip;
    rt.onchange = () => { state.roundTrip = rt.checked; changed({ keepSample: true }); };
    const nums = [["#depart", "depart", String], ["#stay", "stay", Number], ["#fuel-rate", "fuelRate", Number], ["#fuel-price", "fuelPrice", Number]];
    for (const [sel, key, cast] of nums) {
      const el = $(sel);
      el.value = state[key];
      el.onchange = () => {
        const v = cast(el.value);
        if (cast === Number && !Number.isFinite(v)) return;
        state[key] = v;
        save();
        if (key === "stay") renderStops();   // kartalardagi "umumiy" soat koʻrsatkichi yangilansin
        if (result && !result.stale) renderResult();
      };
    }
  }

  /* ---------------- Hisoblash ---------------- */

  function busy(on, text) {
    $("#map-busy").hidden = !on;
    if (text) $("#busy-text").textContent = text;
    $("#btn-solve").disabled = on;
  }

  let solveSeq = 0;
  async function solve() {
    if (!state.start) { toast("Avval boshlangʻich nuqtani kiriting.", "warn"); $("#start-input").focus(); return; }
    if (!state.stops.length) { toast("Kamida bitta manzil qoʻshing.", "warn"); $("#stop-input").focus(); return; }
    if (state.stops.length > 60) { toast("Bir safarda koʻpi bilan 60 ta manzil hisoblanadi.", "warn"); return; }
    setPick(null);
    const runId = ++solveSeq;      // hisoblash davomida reja almashtirilsa (boshqa qurilmadan yoki Tarixdan), eskisi tashlab yuboriladi
    const pins = activePins();
    busy(true, "Yoʻl masofalari olinmoqda…");
    try {
      const pts = [state.start].concat(state.stops);
      const mx0 = await API.matrix(pts);
      if (runId !== solveSeq) return;
      busy(true, "Eng qulay tartib hisoblanmoqda…");
      await new Promise((r) => setTimeout(r, 20));
      if (runId !== solveSeq) return;
      const inputOrder = state.stops.map((_, i) => i + 1);

      let mx = mx0, sol, rt, seq, legs, via = [], border = null, plan = null;
      if (mx0.source === "osrm" && window.Border) {
        // Tartib va marshrut birga hisoblanadi: yoʻl boshqa davlat hududidan oʻtsa, ichki yoʻl tanlanadi (border.js)
        try {
          plan = await Border.plan({
            pts, mx: mx0, metric: state.metric, roundTrip: state.roundTrip, pins,
            route: API.route, matrix: API.matrix, tsp: TSP, progress: (t) => busy(true, t),
          });
          if (runId !== solveSeq) return;
        } catch (e) {
          console.warn("Chegara tekshiruvi ishlamadi, oddiy hisobga oʻtildi:", e);
        }
      }
      if (plan) {
        sol = plan.sol; rt = plan.rt; seq = plan.seq; legs = plan.legs; via = plan.via;
        mx = { distances: plan.adjD, durations: plan.adjT, source: mx0.source };
        border = { detoured: plan.detoured, unresolved: plan.unresolved.map((u) => ({ from: u.from.name, to: u.to.name })) };
      } else {
        const cost0 = state.metric === "duration" ? mx0.durations : mx0.distances;
        sol = TSP.solve(cost0, { roundTrip: state.roundTrip, pins });
        seq = [0].concat(sol.order, state.roundTrip ? [0] : []);
        busy(true, "Marshrut chizilmoqda…");
        rt = await API.route(seq.map((k) => pts[k]));
        if (runId !== solveSeq) return;
        legs = rt ? rt.legs : null;
      }
      const cost = state.metric === "duration" ? mx.durations : mx.distances;
      const inputCost = TSP.pathCost(cost, inputOrder, state.roundTrip);
      const routePts = seq.map((k) => pts[k]);
      if (!(legs && legs.length === seq.length - 1)) {
        legs = seq.slice(1).map((to, i) => ({ distance: mx.distances[seq[i]][to], duration: mx.durations[seq[i]][to] }));
      }

      // Kiritilgan tartib bilan solishtirish (ikkala o'lchovda)
      const inDist = TSP.pathCost(mx.distances, inputOrder, state.roundTrip);
      const inDur = TSP.pathCost(mx.durations, inputOrder, state.roundTrip);
      const optDistM = TSP.pathCost(mx.distances, sol.order, state.roundTrip);
      const optDurM = TSP.pathCost(mx.durations, sol.order, state.roundTrip);
      // Belgilangan oʻrinlar marshrutni qanchaga uzaytirganini koʻrsatish uchun: erkin (belgilarsiz) eng yaxshi tartib
      const pinned = Object.keys(pins).length;
      let freeDist = optDistM, freeDur = optDurM;
      if (pinned && !readonly) {   // faqat koʻrishda taqqoslash kerak emas
        const freeSol = TSP.solve(cost, { roundTrip: state.roundTrip });
        freeDist = TSP.pathCost(mx.distances, freeSol.order, state.roundTrip);
        freeDur = TSP.pathCost(mx.durations, freeSol.order, state.roundTrip);
      }

      result = {
        order: sol.order.map((k) => pts[k].id),
        legs,
        geometry: rt ? rt.geometry : routePts.map((p) => [p.lat, p.lon]),
        distance: legs.reduce((s, l) => s + l.distance, 0),
        duration: legs.reduce((s, l) => s + l.duration, 0),
        compare: { inDist, inDur, optDist: optDistM, optDur: optDurM, freeDist, freeDur, inputCost, optCost: sol.cost },
        pinned,
        exact: sol.exact,
        source: mx.source,
        routeSource: rt ? "osrm" : "straight",
        via,
        border,
        roundTrip: state.roundTrip,
        metric: state.metric,
        stale: false,
      };
      renderAll();
      renderResult();
      drawRoute();
      fitAll();
      tryResumeLive();
      histSync();
      if (window.matchMedia("(max-width: 900px)").matches) $("#result").scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      console.error(e);
      toast("Hisoblashda xatolik: " + e.message, "warn");
    } finally {
      if (runId === solveSeq) busy(false);
    }
  }
  $("#btn-solve").onclick = solve;

  function drawRoute() {
    routeLayer.clearLayers();
    if (!result || result.stale) return;
    const dashed = result.routeSource !== "osrm";
    L.polyline(result.geometry, { color: "#123a7a", weight: 9, opacity: 0.9, className: "route-casing" }).addTo(routeLayer);
    L.polyline(result.geometry, { color: "#14b8a6", weight: 5, opacity: 1, dashArray: dashed ? "8 8" : null, className: "route-line" }).addTo(routeLayer);
  }

  function renderResultState() {
    const has = !!result;
    $("#result").hidden = !has;
    if (!has) { routeLayer.clearLayers(); return; }
    $("#stale-note").hidden = !result.stale;
    $("#result").classList.toggle("is-stale", !!result.stale);
    if (result.stale) routeLayer.clearLayers();
  }

  function clock(baseHHMM, addSec) {
    const [h, m] = (baseHHMM || "08:00").split(":").map(Number);
    const total = (h * 60 + m) + Math.round(addSec / 60);
    const day = Math.floor(total / 1440);
    const mm = ((total % 1440) + 1440) % 1440;
    const s = String(Math.floor(mm / 60)).padStart(2, "0") + ":" + String(mm % 60).padStart(2, "0");
    return day > 0 ? s + " <small>+" + day + " kun</small>" : s;
  }

  function stopById(id) { return state.stops.find((s) => s.id === id); }

  /** Qoʻlda belgilangan oʻrinlar: {manzilIndeksi: oʻrin}. Yaroqsizlari (oʻrin qolmagan yoki takror) olib tashlanadi. */
  function activePins() {
    const n = state.stops.length, pins = {}, used = new Set(), dropped = [];
    state.stops.forEach((s, i) => {
      if (!s.pin) return;
      if (s.pin > n || used.has(s.pin)) { dropped.push(s.name + " (" + s.pin + ")"); s.pin = 0; return; }
      used.add(s.pin);
      pins[i + 1] = s.pin;
    });
    if (dropped.length) {
      save();
      renderStops();
      toast("Oʻrin mavjud emasligi uchun belgilash olib tashlandi: " + dropped.join(", "), "warn");
    }
    return pins;
  }

  function renderResult() {
    if (!result) return;
    renderResultState();
    const r = result;
    const liters = r.distance / 1000 * state.fuelRate / 100;
    const money = liters * state.fuelPrice;
    const stayMins = r.order.map((id) => stayOf(stopById(id)));
    const stayTotal = stayMins.reduce((a, b) => a + b, 0) * 60;
    const customStay = r.order.some((id) => { const s = stopById(id); return s && s.stay !== null; });

    $("#stats").innerHTML =
      stat("Jami masofa", Geo.fmtKm(r.distance)) +
      stat("Rulda", Geo.fmtDuration(r.duration)) +
      stat("Yoqilgʻi", (liters < 10 ? liters.toFixed(1) : Math.round(liters)) + " l", Geo.fmtSum(money)) +
      stat("Turishlar bilan", Geo.fmtDuration(r.duration + stayTotal), customStay ? "manzillar boʻyicha: " + Geo.fmtDuration(stayTotal) : r.order.length + " × " + state.stay + " daq");

    const c = r.compare;
    const savedDist = c.inDist - c.optDist;
    const savedDur = c.inDur - c.optDur;
    let sv;
    if (r.order.length < 2) sv = "Bitta manzil — tartibni tanlash shart emas.";
    else if (r.pinned) {
      const extra = r.metric === "distance" ? c.optDist - c.freeDist : c.optDur - c.freeDur;
      sv = "Qoʻlda belgilangan <b>" + r.pinned + " ta</b> oʻrin saqlandi, qolgan manzillar shu shartda eng qulay tartibda joylashtirildi.";
      if (extra > 1) sv += " Belgilashsiz tartibga nisbatan <b>" + (r.metric === "distance" ? Geo.fmtKm(extra) : Geo.fmtDuration(extra)) + "</b> uzunroq.";
    } else if ((r.metric === "distance" ? savedDist : savedDur) > 1) {
      sv = "Siz kiritgan tartibga nisbatan <b>" + Geo.fmtKm(Math.max(0, savedDist)) + "</b> qisqa" +
        (savedDur > 60 ? " va <b>" + Geo.fmtDuration(savedDur) + "</b> tezroq" : "") + ".";
    } else sv = "Siz kiritgan tartib allaqachon eng qulayi ekan.";
    sv += r.exact ? (r.pinned ? " Barcha variantlar tekshirildi." : " Barcha variantlar tekshirildi — bu eng optimal tartib.") : " Koʻp manzil uchun yaqinlashtirilgan (evristik) yechim ishlatildi.";
    $("#savings").innerHTML = sv;

    const rows = [];
    let t = 0;
    rows.push(itRow({ badge: "A", cls: "start", name: state.start.name, sub: "Joʻnash · " + clock(state.depart, 0), id: state.start.id }));
    r.order.forEach((id, i) => {
      const s = stopById(id);
      const leg = r.legs[i];
      if (!s || !leg) return;
      t += leg.duration;
      rows.push(legRow(leg));
      rows.push(itRow({ badge: String(i + 1), cls: "", name: s.name, note: s.note, link: s.link,
        sub: "Yetib borish " + clock(state.depart, t) + (s.pin && !readonly ? " · oʻrni belgilangan" : "") + (s.stay !== null ? " · " + hoursStr(s.stay) + " soat" : "") + (stayOf(s) ? " · ketish " + clock(state.depart, t + stayOf(s) * 60) : ""),
        id: s.id, region: s.region }));
      t += stayOf(s) * 60;
    });
    if (r.roundTrip && r.legs[r.order.length]) {
      const leg = r.legs[r.order.length];
      t += leg.duration;
      rows.push(legRow(leg));
      rows.push(itRow({ badge: "A", cls: "start", name: state.start.name + " (qaytish)", sub: "Yetib kelish " + clock(state.depart, t), id: state.start.id }));
    }
    $("#itinerary").innerHTML = rows.join("");

    // Eksport havolalari
    // Google/Yandex marshrutni oʻzi qayta hisoblaydi va chegaradan oʻtkazib yuborishi mumkin,
    // shuning uchun aylanma yoʻl oraliq nuqtalari ham havolaga qoʻshiladi.
    const stops = [state.start].concat(r.order.map(stopById).filter(Boolean), r.roundTrip ? [state.start] : []);
    const seq = [stops[0]];
    for (let i = 1; i < stops.length; i++) {
      for (const v of (r.via && r.via[i - 1]) || []) seq.push(v);
      seq.push(stops[i]);
    }
    const ll = (p) => p.lat.toFixed(6) + "," + p.lon.toFixed(6);
    const gLink = (pts) => "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + ll(pts[0]) +
      "&destination=" + ll(pts[pts.length - 1]) +
      (pts.length > 2 ? "&waypoints=" + encodeURIComponent(pts.slice(1, -1).map(ll).join("|")) : "");
    const yDomain = CONFIG.yandexDomain || "yandex.uz";
    $("#link-yandex").href = "https://" + yDomain + "/maps/?rtt=auto&rtext=" + encodeURIComponent(seq.map(ll).join("~"));

    // Google Maps veb-havolasida oraliq nuqtalar soni cheklangan (9 ta) — kerak bo'lsa qismlarga bo'linadi
    const parts = [];
    for (let i = 0; i < seq.length - 1; i += 10) parts.push(seq.slice(i, Math.min(i + 11, seq.length)));
    $("#link-google").href = gLink(parts[0]);
    const gp = $("#google-parts");
    if (parts.length > 1) {
      gp.hidden = false;
      gp.innerHTML = "Google Maps bir havolada 10 tagacha nuqtani qabul qiladi. Marshrut qismlarga boʻlindi: " +
        parts.map((p, i) => '<a href="' + gLink(p) + '" target="_blank" rel="noopener">' + (i + 1) + "-qism</a>").join(" · ");
    } else gp.hidden = true;

    $("#source-note").innerHTML = r.source === "osrm"
      ? "Masofa va vaqt OpenStreetMap yoʻl tarmogʻi (OSRM) boʻyicha avtomobil uchun hisoblandi. Tirbandlik hisobga olinmaydi."
      : "Yoʻl xizmatiga ulanib boʻlmadi — masofa toʻgʻri chiziq × 1,3 va 60 km/soat tezlik boʻyicha <b>taxminiy</b> hisoblandi.";

    // Chegara tekshiruvi natijasi (border.js)
    if (r.border) {
      if (r.border.unresolved.length) {
        $("#source-note").innerHTML += " <b>Diqqat:</b> " +
          r.border.unresolved.map((u) => esc(u.from) + " → " + esc(u.to)).join(", ") +
          " oraligʻidagi yoʻl boshqa davlat hududidan oʻtadi — Oʻzbekiston ichida muqobil yoʻl topilmadi (masalan, anklav manzillar uchun).";
      } else if (r.border.detoured) {
        $("#source-note").innerHTML += " Marshrut Oʻzbekiston hududidan chiqmaydi: boshqa davlat orqali oʻtadigan yoʻl " +
          r.border.detoured + " ta qismda ichki yoʻl bilan almashtirildi, shu sababli masofa biroz uzunroq boʻlishi mumkin." +
          " Google va Yandex havolalariga aylanma yoʻl nuqtalari ham qoʻshildi.";
      }
    }
  }

  function stat(k, v, sub) {
    return '<div class="stat"><span>' + k + "</span><b>" + v + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>";
  }
  function itRow(o) {
    return '<li class="it-stop" data-id="' + o.id + '"><span class="badge ' + o.cls + '">' + o.badge + "</span>" +
      '<button type="button" class="it-main">' + noteTag(o.note) + "<b>" + esc(o.name) + "</b><span>" + o.sub + "</span></button>" + linkTag(o.link, "it-link") + "</li>";
  }
  function legRow(leg) {
    return '<li class="it-leg"><span class="leg-line"></span><span>' + Geo.fmtKm(leg.distance) + " · " + Geo.fmtDuration(leg.duration) + "</span></li>";
  }

  $("#itinerary").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const li = e.target.closest(".it-stop");
    if (li) openDrawer(li.dataset.id);
  });

  $("#btn-copy").onclick = () => {
    if (!result) return;
    const lines = ["Yoʻlnoma — safar rejasi", ""];
    lines.push("A. " + state.start.name + " — joʻnash " + state.depart);
    result.order.forEach((id, i) => {
      const s = stopById(id), leg = result.legs[i];
      lines.push("   ↓ " + Geo.fmtKm(leg.distance) + ", " + Geo.fmtDuration(leg.duration));
      lines.push((i + 1) + ". " + (s.note ? s.note + " — " : "") + s.name + (s.address ? " (" + s.address + ")" : "") + " — " + s.lat.toFixed(5) + ", " + s.lon.toFixed(5) + (s.link ? " — " + s.link : ""));
    });
    if (result.roundTrip) {
      const leg = result.legs[result.order.length];
      lines.push("   ↓ " + Geo.fmtKm(leg.distance) + ", " + Geo.fmtDuration(leg.duration));
      lines.push("A. " + state.start.name + " (qaytish)");
    }
    lines.push("", "Jami: " + Geo.fmtKm(result.distance) + ", " + Geo.fmtDuration(result.duration) + " yoʻlda.");
    lines.push("Google Maps: " + $("#link-google").href);
    copyText(lines.join("\n"), "Reja nusxalandi.");
  };

  function copyText(text, okMsg) {
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(okMsg); } catch (_) { toast("Nusxalab boʻlmadi."); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(okMsg), fallback);
    } else fallback();
  }

  $("#btn-share").onclick = () => {
    const url = location.href.split("#")[0] + "#view=" + b64encode(JSON.stringify(serialize(true)));
    copyText(url, "Havola nusxalandi — ochgan kishi safarni faqat koʻra oladi, oʻzgartira olmaydi.");
  };

  $("#btn-clear").onclick = () => clearAll();
  $("#btn-new").onclick = () => clearAll({ fresh: true });
  $("#btn-sample-clear").onclick = () => clearAll();
  /** Joriy rejani boʻshatadi (Tarixga saqlab qoʻyib): "Tozalash" ham, "+ Yangi reja" ham shu. */
  function clearAll(opts) {
    if (readonly) return;
    if (lv && lv.on) stopLive("Yangi reja — jonli rejim toʻxtatildi.");
    const archived = archiveCurrent();
    setPlanId(null);
    state.start = null; state.stops = []; state.sample = false; result = null;
    details.clear(); routeLayer.clearLayers(); poiLayer.clearLayers();
    closeDrawer();
    save(); renderAll();
    map.setView([41.2, 64.6], 6);
    $("#start-input").focus();
    if (archived) toast("Oldingi reja Tarixga saqlandi.");
    else if (opts && opts.fresh) toast("Yangi reja boshlandi.");
  }

  /* ---------------- Joy haqida panel ---------------- */

  let drawerId = null;
  let miniMap = null;
  let miniMarker = null;

  function findPlace(id) {
    if (state.start && state.start.id === id) return state.start;
    return stopById(id);
  }

  function openDrawer(id) {
    const p = findPlace(id);
    if (!p) return;
    drawerId = id;
    const isStart = state.start && state.start.id === id;
    const solved = result && !result.stale;
    const visit = solved && !isStart ? result.order.indexOf(id) + 1 : 0;
    $("#d-eyebrow").textContent = isStart ? "Boshlangʻich nuqta" : visit ? visit + "-manzil" : "Manzil";
    $("#d-title").textContent = p.name;
    $("#d-address").textContent = p.address || "";
    $("#d-coords").textContent = Geo.fmtCoord(p.lat, p.lon);
    $("#drawer").hidden = false;
    $("#drawer-backdrop").hidden = false;
    document.body.classList.add("drawer-open");
    poiLayer.clearLayers();
    map.panTo([p.lat, p.lon]);
    selectTab("view");
    renderView();
    loadDetails(p);
  }

  function closeDrawer() {
    $("#drawer").hidden = true;
    $("#drawer-backdrop").hidden = true;
    document.body.classList.remove("drawer-open");
    $("#view-frame").src = "about:blank";
    drawerId = null;
    poiLayer.clearLayers();
  }
  $("#btn-drawer-close").onclick = closeDrawer;
  $("#drawer-backdrop").onclick = closeDrawer;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });
  $("#btn-copy-coords").onclick = () => copyText($("#d-coords").textContent, "Koordinata nusxalandi.");

  function selectTab(name) {
    $$(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    $$(".tabpane").forEach((p) => { p.hidden = p.dataset.pane !== name; });
    if (name === "view" && miniMap) setTimeout(() => miniMap.invalidateSize(), 30);
    if (name === "around") renderAroundTab();
  }
  $$(".tab").forEach((t) => { t.onclick = () => selectTab(t.dataset.tab); });

  function renderView() {
    const p = findPlace(drawerId);
    if (!p) return;
    const src = ($('input[name="viewsrc"]:checked') || {}).value || "sat";
    const frame = $("#view-frame");
    const mini = $("#mini-map");
    const yDomain = CONFIG.yandexDomain || "yandex.uz";
    if (src === "sat") {
      frame.hidden = true; frame.src = "about:blank"; mini.hidden = false;
      if (!miniMap) {
        miniMap = L.map("mini-map", { zoomControl: true, attributionControl: true });
        L.layerGroup([esriImg(), esriLabels()]).addTo(miniMap);
        miniMarker = L.circleMarker([p.lat, p.lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#e0412b", fillOpacity: 1 }).addTo(miniMap);
      }
      miniMap.setView([p.lat, p.lon], 17);
      miniMarker.setLatLng([p.lat, p.lon]);
      setTimeout(() => miniMap.invalidateSize(), 50);
    } else {
      mini.hidden = true; frame.hidden = false;
      if (src === "google") {
        frame.src = CONFIG.googleMapsApiKey
          ? "https://www.google.com/maps/embed/v1/view?key=" + encodeURIComponent(CONFIG.googleMapsApiKey) + "&center=" + p.lat + "," + p.lon + "&zoom=18&maptype=satellite"
          : "https://maps.google.com/maps?q=" + p.lat + "," + p.lon + "&t=k&z=17&hl=uz&output=embed";
      } else {
        frame.src = "https://" + yDomain + "/map-widget/v1/?ll=" + p.lon + "%2C" + p.lat + "&z=17&l=sat%2Cskl&pt=" + p.lon + "%2C" + p.lat + "%2Cpm2rdm";
      }
    }
    const links = (p.link ? [["Saqlangan havola (" + linkHost(p.link) + ")", p.link]] : []).concat([
      ["Google Maps (yoʻldosh)", "https://www.google.com/maps/@?api=1&map_action=map&center=" + p.lat + "%2C" + p.lon + "&zoom=18&basemap=satellite"],
      ["Google Earth 3D", "https://earth.google.com/web/@" + p.lat + "," + p.lon + ",0a,700d,35y,0h,60t,0r"],
      ["Google Street View", "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=" + p.lat + "%2C" + p.lon],
      ["Yandex Karta (yoʻldosh)", "https://" + yDomain + "/maps/?ll=" + p.lon + "%2C" + p.lat + "&z=17&l=sat&pt=" + p.lon + "%2C" + p.lat],
      ["Yandex panoramasi", "https://" + yDomain + "/maps/?ll=" + p.lon + "%2C" + p.lat + "&z=17&panorama%5Bpoint%5D=" + p.lon + "%2C" + p.lat],
      ["Bu yerga yoʻl (Google)", "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + p.lat + "%2C" + p.lon],
    ]);
    $("#ext-links").innerHTML = links.map(([t, u]) => '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t) +
      ' <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg></a>').join("");
  }
  $$('input[name="viewsrc"]').forEach((r) => { r.onchange = renderView; });

  function currentLeg(id) {
    if (!result || result.stale) return null;
    const i = result.order.indexOf(id);
    return i >= 0 ? result.legs[i] : null;
  }

  function radius() { return Number($("#radius").value) || 1000; }

  function renderAboutTab() {
    const p = findPlace(drawerId);
    if (!p) return;
    const d = details.get(p.id) || {};
    const r = radius();
    const nb = d.nearby && d.nearby[r];
    $("#about-body").innerHTML = Place.renderAbout({
      stop: p, info: d.info || p, weather: d.weather, wiki: d.wiki,
      nearby: nb && nb.data, nearbyLoading: nb && nb.loading, nearbyError: nb && nb.error,
      wikiLoading: d.wikiLoading, leg: currentLeg(p.id),
    });
  }

  // "Atrofda" bo'limida qaysi guruhlar ochiq / to'liq ko'rsatilgan (har bir manzil uchun alohida)
  const aroundUI = new Map();
  function uiFor(id) {
    if (!aroundUI.has(id)) aroundUI.set(id, { open: null, expanded: new Set() });
    return aroundUI.get(id);
  }

  function renderAroundTab() {
    const p = findPlace(drawerId);
    if (!p) return;
    const d = details.get(p.id) || {};
    const r = radius();
    const nb = d.nearby && d.nearby[r];
    const body = $("#around-body");
    if (!nb || nb.loading) { body.innerHTML = '<p class="muted loading-line"><span class="spinner sm"></span>Atrofdagi obyektlar qidirilmoqda… Bu 5–30 soniya olishi mumkin.</p>'; if (!nb) loadNearby(p, r); return; }
    if (nb.error) { body.innerHTML = '<p class="muted">Maʼlumot olinmadi: ' + esc(nb.error) + ' <button class="link-btn" id="btn-retry-nb" type="button">Qayta urinish</button></p>';
      $("#btn-retry-nb").onclick = () => { delete d.nearby[r]; renderAroundTab(); }; return; }
    const ui = uiFor(p.id);
    if (!ui.open) {
      ui.open = new Set(nb.data.groups.filter((g) => g.items.length).slice(0, 2).map((g) => g.id));
    }
    const scroll = $(".drawer-body").scrollTop;
    body.innerHTML = Place.renderAround(nb.data, ui);
    $(".drawer-body").scrollTop = scroll;
    // Ko'rinayotgan obyektlar uchun surat va tavsif yuklash
    const vis = Place.visiblePOIs(nb.data, ui).filter((it) => !it.extra);
    if (vis.length) {
      const pid = p.id;
      API.enrichPOIs(vis).then((changed) => {
        if (changed && drawerId === pid && radius() === r && !$('[data-pane="around"]').hidden) renderAroundTab();
      });
    }
  }

  $("#radius").onchange = () => {
    const p = findPlace(drawerId);
    if (!p) return;
    loadNearby(p, radius());
    renderAroundTab();
    renderAboutTab();
  };

  $("#around-body").addEventListener("click", (e) => {
    const more = e.target.closest(".poi-more");
    if (more) {
      const ui = uiFor(drawerId);
      const g = more.dataset.group;
      if (ui.expanded.has(g)) ui.expanded.delete(g); else ui.expanded.add(g);
      renderAroundTab();
      return;
    }
    const b = e.target.closest('[data-act="show"]');
    if (!b) return;
    const card = b.closest(".poi-card");
    const lat = Number(card.dataset.lat), lon = Number(card.dataset.lon);
    poiLayer.clearLayers();
    L.circleMarker([lat, lon], { radius: 8, color: "#fff", weight: 2, fillColor: "#e0412b", fillOpacity: 1 })
      .bindTooltip(card.dataset.name, { permanent: true, direction: "top", offset: [0, -8] })
      .addTo(poiLayer);
    map.setView([lat, lon], Math.max(map.getZoom(), 16));
    if (miniMap && !$("#mini-map").hidden) miniMap.setView([lat, lon], 17);
    $$(".poi-card.active").forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
  });

  // Guruh ochilganda/yopilganda holatni eslab qolish va kerakli rasmlarni yuklash
  $("#around-body").addEventListener("toggle", (e) => {
    const det = e.target;
    if (!det.matches || !det.matches("details.poi")) return;
    const ui = uiFor(drawerId);
    if (!ui.open) return;
    const g = det.dataset.group;
    const was = ui.open.has(g);
    if (det.open && !was) { ui.open.add(g); renderAroundTab(); }
    else if (!det.open && was) { ui.open.delete(g); }
  }, true);

  // Surat yuklanmasa — sun'iy yo'ldosh tasviriga almashtirish
  $("#around-body").addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG") return;
    if (img.dataset.sat && img.src !== img.dataset.sat) {
      img.src = img.dataset.sat;
      const btn = img.closest(".poi-thumb");
      if (btn && !btn.classList.contains("sat")) { btn.classList.add("sat"); btn.insertAdjacentHTML("beforeend", '<span class="sat-tag">yoʻldosh</span>'); }
    } else {
      img.closest(".poi-thumb").classList.add("noimg");
      img.remove();
    }
  }, true);

  function loadNearby(p, r) {
    const d = details.get(p.id) || {};
    d.nearby = d.nearby || {};
    if (d.nearby[r] && !d.nearby[r].error) return;
    d.nearby[r] = { loading: true };
    details.set(p.id, d);
    API.nearby(p.lat, p.lon, r).then((data) => {
      d.nearby[r] = { data };
    }).catch((e) => {
      d.nearby[r] = { error: e.message || "xizmat javob bermadi" };
    }).finally(() => {
      if (drawerId === p.id && radius() === r) { renderAboutTab(); if (!$('[data-pane="around"]').hidden) renderAroundTab(); }
    });
  }

  function loadDetails(p) {
    const d = details.get(p.id) || {};
    details.set(p.id, d);
    renderAboutTab();
    if (!d.info && !d.infoLoading) {
      d.infoLoading = true;
      API.reverse(p.lat, p.lon).then((info) => { if (info) d.info = Object.assign({}, info, { category: p.category || info.category, type: p.type || info.type }); })
        .finally(() => { d.infoLoading = false; if (drawerId === p.id) renderAboutTab(); });
    }
    if (!d.weather && !d.weatherLoading) {
      d.weatherLoading = true;
      API.weather(p.lat, p.lon).then((w) => { d.weather = w; }).finally(() => { d.weatherLoading = false; if (drawerId === p.id) renderAboutTab(); });
    }
    if (d.wiki === undefined && !d.wikiLoading) {
      d.wikiLoading = true;
      API.wiki(p.lat, p.lon).then((w) => { d.wiki = w; }).catch(() => { d.wiki = null; })
        .finally(() => { d.wikiLoading = false; if (drawerId === p.id) renderAboutTab(); });
    }
    loadNearby(p, radius());
  }

  /* ---------------- Manzilni tahrirlash ---------------- */

  const ED = { id: null, pick: null };
  const edEl = (k) => $("#ed-" + k);

  function showEditPick() {
    const has = !!ED.pick;
    edEl("new").hidden = !has;
    if (has) { edEl("new-name").textContent = ED.pick.p.name; edEl("new-address").textContent = ED.pick.p.address || Geo.fmtCoord(ED.pick.p.lat, ED.pick.p.lon); }
  }

  function openEdit(id) {
    const s = stopById(id);
    if (!s || readonly) return;
    ED.id = id; ED.pick = null;
    edEl("name").textContent = s.name;
    edEl("address").textContent = s.address || "";
    edEl("coords").textContent = Geo.fmtCoord(s.lat, s.lon);
    edEl("input").value = "";
    edEl("note").value = s.note || "";
    edEl("link").value = s.link || "";
    showEditPick();
    $("#edit-backdrop").hidden = false;
    $("#edit-modal").hidden = false;
    edEl("input").focus();
  }
  function closeEdit() { $("#edit-backdrop").hidden = true; $("#edit-modal").hidden = true; ED.id = null; ED.pick = null; }

  setupSearch($('.search-field[data-role="edit"]'), (p, needsName) => { ED.pick = { p, needsName }; showEditPick(); });
  edEl("new-clear").onclick = () => { ED.pick = null; showEditPick(); edEl("input").focus(); };
  $("#edit-close").onclick = closeEdit;
  $("#ed-cancel").onclick = closeEdit;
  $("#edit-backdrop").onclick = closeEdit;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#edit-modal").hidden && $("#edit-modal .suggest").hidden) closeEdit(); });
  for (const k of ["note", "link"]) edEl(k).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveEdit(); } });
  $("#ed-save").onclick = saveEdit;

  function saveEdit() {
    const s = ED.id && stopById(ED.id);
    if (!s) { closeEdit(); return; }
    if (edEl("input").value.trim() && !ED.pick) { toast("Qidiruv natijasidan yangi manzilni tanlang yoki maydonni tozalang.", "warn"); edEl("input").focus(); return; }
    let link = "";
    const rawLink = edEl("link").value.trim();
    if (rawLink) {
      link = cleanUrl(rawLink);
      if (link === null || link === "") { toast("Havola yaroqsiz (http yoki https bilan boshlanadigan toʻliq manzil kerak).", "warn"); edEl("link").focus(); return; }
    }
    const np = ED.pick && ED.pick.p;
    if (np) {
      const dup = state.stops.find((x) => x !== s && Geo.haversine(x, np) < 30);
      if (dup) { toast("“" + dup.name + "” allaqachon roʻyxatda bor.", "warn"); return; }
    }
    s.note = edEl("note").value.trim().slice(0, 80);
    s.link = link;
    const hadResult = !!result;
    if (np) {
      // Oʻrin (pin), turish vaqti, izoh va havola saqlanadi; joylashuv va nom yangilanadi
      Object.assign(s, { name: np.name, address: np.address, lat: np.lat, lon: np.lon, category: np.category, type: np.type,
        addresstype: np.addresstype, region: np.region, district: np.district, city: np.city });
      if (ED.pick.needsName) s.name = Geo.fmtCoord(np.lat, np.lon);
      details.delete(s.id);
      const needsName = ED.pick.needsName;
      closeEdit();
      changed({ keepSample: true });
      if (needsName) enrichName(s);
      if (!Geo.inUzbekistan(s.lat, s.lon)) toast("Diqqat: “" + s.name + "” Oʻzbekiston hududidan tashqarida.", "warn");
      map.setView([s.lat, s.lon], Math.max(map.getZoom(), 11));
      if (hadResult && state.start) solve();
      toast("Manzil yangilandi" + (hadResult ? ", marshrut qayta hisoblanmoqda…" : "."));
    } else {
      closeEdit();
      save(); renderAll();
      if (result && !result.stale) renderResult();
      toast("Saqlandi.");
    }
  }

  /* ---------------- Jonli safar ("Safarni boshlash") ---------------- */

  const LIVE_KEY = "yolnoma.live.v1";
  const lv = {
    on: false, st: null, base: [], P: null, ctx: null, bounds: null,
    fix: null, rem: null, proj: null, watchId: null, wake: null, tick: null,
    follow: true, min: true, gpsMsg: "", prev: null,
  };
  const liveLayer = L.layerGroup().addTo(map);
  let meAcc = null, meMarker = null, guideLine = null, guideCasing = null;

  const pad2 = (n) => String(n).padStart(2, "0");
  const localISO = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); };
  const hm = (ms) => { const d = new Date(ms); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
  /** "14:30" + (ertaga) / (10.11) — bugungi kunga nisbatan */
  function fmtAt(ms) {
    const now = new Date(Live.now()), d = new Date(ms);
    const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((b - a) / 86400000);
    const tag = diff === 0 ? "" : diff === 1 ? " (ertaga)" : diff === -1 ? " (kecha)" : " (" + pad2(d.getDate()) + "." + pad2(d.getMonth() + 1) + ")";
    return hm(ms) + tag;
  }
  const clockSec = (sec) => { sec = Math.max(0, Math.floor(sec)); return pad2(Math.floor(sec / 3600)) + ":" + pad2(Math.floor(sec % 3600 / 60)) + ":" + pad2(sec % 60); };

  function liveSig() {
    if (!result || !state.start) return "";
    const pts = [state.start].concat(result.order.map(stopById).filter(Boolean));
    return pts.map((p) => p.lat.toFixed(4) + "," + p.lon.toFixed(4)).join("|") + (result.roundTrip ? "|R" : "");
  }

  function liveContext() {
    const stops = result.order.map(stopById).filter(Boolean);
    const pts = [state.start].concat(stops, result.roundTrip ? [state.start] : []);
    return {
      start: state.start, stops, legs: result.legs, roundTrip: result.roundTrip, geometry: result.geometry,
      cities: Border.HUBS, params: lv.P,
      bounds: result.geometry && result.geometry.length > 1 ? Live.legBounds(result.geometry, pts) : null,
    };
  }

  function liveParams(nowMs) {
    const w = state.work || {};
    return Report.normalizeParams({
      date: localISO(nowMs), depart: state.depart || "08:00", workStart: w.start || "10:00", workEnd: w.end || "18:00",
      driveLimit: w.limit || "", stayMin: state.stay,
    });
  }

  function liveSave() {
    try {
      localStorage.setItem(LIVE_KEY, JSON.stringify({ sig: liveSig(), st: lv.st, base: lv.base, P: lv.P, saved: Live.now() }));
    } catch (_) { /* noop */ }
  }
  function liveForget() { try { localStorage.removeItem(LIVE_KEY); } catch (_) { /* noop */ } }

  /** Ushbu holatdan qolgan safarni qayta hisoblaydi. */
  function liveRecompute() {
    if (!lv.on || !lv.ctx) return;
    const st = lv.st, ctx = lv.ctx, now = Live.now();
    if (st.finished) { lv.proj = null; return; }
    let frac = 1, fromName = "Hozirgi joy";
    lv.rem = null;
    if (st.phase === "drive") {
      const target = Live.targetOf(st, state.start, ctx.stops, ctx.roundTrip);
      const planned = ctx.legs[st.idx] ? ctx.legs[st.idx].distance : 0;
      if (lv.fix && target && nav.guide && nav.legIdx === st.idx && nav.onRoute) {
        const meters = Math.max(0, nav.guide.total - nav.along);
        lv.rem = { meters, frac: planned > 0 ? Math.min(3, meters / planned) : 1, offRoute: false, offM: nav.off, straightM: 0 };
        frac = lv.rem.frac;
      } else if (lv.fix && target) {
        lv.rem = Live.remaining(ctx.bounds ? result.geometry : null, ctx.bounds, st.idx, lv.fix, target, planned);
        frac = lv.rem.frac;
      } else if (st.idx > 0 || st.arrivals.length) fromName = st.idx > 0 && ctx.stops[st.idx - 1] ? ctx.stops[st.idx - 1].name : fromName;
    }
    try { lv.proj = Live.project(ctx, { state: st, nowMs: now, frac, fromName }); }
    catch (e) { console.error(e); lv.proj = null; }
  }

  function liveEsc(s) { return esc(String(s)); }

  function deltaTag(minDiff) {
    if (minDiff > 5) return '<span class="lv-late">+' + Geo.fmtDuration(minDiff * 60) + " ortda</span>";
    if (minDiff < -5) return '<span class="lv-early">' + Geo.fmtDuration(-minDiff * 60) + " oldinda</span>";
    return '<span class="lv-ok">reja boʻyicha</span>';
  }

  function renderLive() {
    if (!lv.on) return;
    const st = lv.st, ctx = lv.ctx, now = Live.now(), P = lv.P;
    const now$ = $("#lv-now"), stats = $("#lv-stats"), acts = $("#lv-actions"), next = $("#lv-next");
    $("#lv-title").textContent = st.finished ? "Safar yakunlandi" : "Safar davom etmoqda";
    $(".live").classList.toggle("min", lv.min);
    $("#lv-min").setAttribute("aria-expanded", String(!lv.min));
    let nowHtml = "", statHtml = "", actHtml = "", barHtml = "";
    const proj = lv.proj;
    const target = Live.targetOf(st, state.start, ctx.stops, ctx.roundTrip);

    if (st.finished) {
      nowHtml = "<b>Hamma manzillar tugadi.</b> Safaringiz xayrli boʻlsin!";
      actHtml = '<button class="btn" data-lv="close" type="button">Yopish</button>';
    } else if (st.phase === "drive" && target) {
      const label = target.isReturn ? "Boshlangʻich nuqtaga qaytish" : target.n + "-manzilga yoʻlda";
      nowHtml = '<span class="lv-kicker">' + label + "</span><b>" + liveEsc(target.name) + "</b>" +
        (!target.isReturn && ctx.stops[st.idx] && ctx.stops[st.idx].note ? '<em class="note">' + liveEsc(ctx.stops[st.idx].note) + "</em>" : "");
      const legM = ctx.legs[st.idx] ? ctx.legs[st.idx].distance : 0, legS = ctx.legs[st.idx] ? ctx.legs[st.idx].duration : 0;
      const meters = lv.rem ? lv.rem.meters : legM, fracUsed = lv.rem ? lv.rem.frac : 1;
      statHtml += '<div class="lv-stat"><span>Qoldi</span><b>' + Geo.fmtKm(meters) + "</b></div>";
      statHtml += '<div class="lv-stat"><span>Rulda</span><b>~' + Geo.fmtDuration(legS * fracUsed) + "</b></div>";
      let arriveMs = null;
      if (proj) arriveMs = target.isReturn ? Live.toMs(proj.summary.endTime, P) : (proj.stops[0] ? Live.toMs(proj.stops[0].arrive, P) : null);
      const em = arriveMs ? fmtAt(arriveMs).match(/^(\d\d:\d\d)(?: \((.*)\))?$/) : null;
      barHtml = (em ? '<b class="lv-eta">' + em[1] + "</b>" + (em[2] ? "<small>" + em[2] + "</small>" : "") : "") +
        "<span>" + Geo.fmtDuration(legS * fracUsed) + "</span><span>" + Geo.fmtKm(meters) + "</span>";
      if (arriveMs) {
        statHtml += '<div class="lv-stat wide"><span>Yetib borish</span><b>' + fmtAt(arriveMs) + "</b></div>";
        const base = lv.base[st.idx];
        if (base && !target.isReturn) statHtml += '<div class="lv-stat wide"><span>Rejaga nisbatan</span><b>' + deltaTag((arriveMs - base) / 60000) + "</b></div>";
      }
      if (lv.rem && lv.rem.offRoute) nowHtml += '<div class="lv-warn">Marshrut chizigʻidan ' + Geo.fmtKm(lv.rem.offM) + " chetdasiz — masofa taxminiy.</div>";
      actHtml = '<button class="btn" data-lv="arrive" type="button">Yetib keldim</button>';
    } else if (st.phase === "work" && target) {
      const sr = proj && proj.stops[0];
      nowHtml = '<span class="lv-kicker">' + target.n + "-manzildasiz</span><b>" + liveEsc(target.name) + "</b>" +
        (ctx.stops[st.idx] && ctx.stops[st.idx].note ? '<em class="note">' + liveEsc(ctx.stops[st.idx].note) + "</em>" : "");
      if (sr) {
        const ws = Live.toMs(sr.workStart, P), we = Live.toMs(sr.workEnd, P);
        barHtml = now < ws ? '<span>Ish boshlanishigacha</span><b class="lv-clock">' + clockSec((ws - now) / 1000) + "</b>"
          : now < we ? '<span>Ish tugashiga</span><b class="lv-clock">' + clockSec((we - now) / 1000) + "</b>" : '<b class="lv-late">Ish vaqti tugadi</b>';
        if (now < ws) {
          statHtml += '<div class="lv-stat wide"><span>Ish boshlanishigacha</span><b class="lv-clock">' + clockSec((ws - now) / 1000) + "</b></div>";
          statHtml += '<div class="lv-stat wide"><span>Ish vaqti</span><b>' + fmtAt(ws) + " – " + hm(we) + "</b></div>";
          if (sr.postponed) nowHtml += '<div class="lv-warn">Bugun ish ulgurilmaydi — mehmonxonada tunab, ' + fmtAt(ws) + " da boshlanadi.</div>";
        } else if (now < we) {
          statHtml += '<div class="lv-stat wide"><span>Ish tugashiga</span><b class="lv-clock">' + clockSec((we - now) / 1000) + "</b></div>";
          statHtml += '<div class="lv-stat wide"><span>Ish vaqti</span><b>' + hm(ws) + " – " + hm(we) + "</b></div>";
        } else {
          statHtml += '<div class="lv-stat wide"><span>Ish vaqti tugadi</span><b class="lv-late">' + hm(we) + " da tugashi kerak edi</b></div>";
        }
      }
      const isLast = st.idx + 1 >= ctx.stops.length && !ctx.roundTrip;
      actHtml = '<button class="btn" data-lv="finish" type="button">' + (isLast ? "Ishni tugatdim — safarni yakunlash" : "Ishni tugatdim — keyingisiga") + "</button>";
    }
    if (lv.prev) actHtml += '<button class="btn ghost" data-lv="undo" type="button">↶ Ortga</button>';
    if (st.finished) barHtml = "";
    const bar = $("#lv-bar");
    if (bar.innerHTML !== barHtml) bar.innerHTML = barHtml;
    if (now$.innerHTML !== nowHtml) now$.innerHTML = nowHtml;
    if (stats.innerHTML !== statHtml) stats.innerHTML = statHtml;
    if (acts.innerHTML !== actHtml) acts.innerHTML = actHtml;

    // Keyingi manzillar
    let rows = "";
    if (proj && !st.finished) {
      const list = proj.stops.filter((r) => r.n !== st.idx + 1);   // hozirgi manzil yuqorida koʻrsatilgan
      const shown = list.slice(0, 6);
      rows = shown.map((r) => {
        const arr = Live.toMs(r.arrive, P), ws = Live.toMs(r.workStart, P), we = Live.toMs(r.workEnd, P);
        const base = lv.base[r.n - 1];
        return "<li><span class=\"lv-n\">" + r.n + "</span><div><b>" + liveEsc(r.stop.name) + "</b><span>yetib borish " + fmtAt(arr) +
          " · ish " + hm(ws) + "–" + hm(we) + (r.postponed ? " (ertasi kuni)" : "") + "</span>" +
          (base ? "<span>" + deltaTag((arr - base) / 60000) + "</span>" : "") + "</div></li>";
      }).join("");
      if (list.length > shown.length) rows += '<li class="lv-more">… yana ' + (list.length - shown.length) + " ta manzil</li>";
      rows += '<li class="lv-end">Safar tugashi: <b>' + fmtAt(Live.toMs(proj.summary.endTime, P)) + "</b></li>";
    }
    if (next.innerHTML !== rows) next.innerHTML = rows;

    // GPS holati
    let gps = lv.gpsMsg;
    if (!gps && lv.fix) {
      const age = Math.max(0, Math.round((now - lv.fix.t) / 1000));
      gps = "GPS: aniqlik ±" + Math.round(lv.fix.acc || 0) + " m · " + (age < 5 ? "hozir" : age + " soniya oldin");
    } else if (!gps) gps = "GPS signali kutilmoqda…";
    $("#lv-gps").textContent = gps;
  }

  function liveNotify(msg) {
    toast(msg);
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (_) { /* noop */ }
  }

  function liveSnapshot() { lv.prev = JSON.stringify(lv.st); }

  function liveDoArrive(auto) {
    const st = lv.st;
    if (st.finished || st.phase !== "drive") return;
    const target = Live.targetOf(st, state.start, lv.ctx.stops, lv.ctx.roundTrip);
    liveSnapshot();
    Live.arrive(st, Live.now(), lv.ctx.stops.length, lv.ctx.roundTrip);
    liveNotify((target && target.isReturn ? "Boshlangʻich nuqtaga yetib keldingiz." : (target ? target.n + "-manzilga yetib keldingiz" : "Yetib keldingiz") + (auto ? " (GPS aniqladi)." : ".")));
    liveAfterChange();
  }

  function liveDoFinish() {
    const st = lv.st;
    if (st.finished || st.phase !== "work") return;
    liveSnapshot();
    Live.finishWork(st, Live.now(), lv.ctx.stops.length, lv.ctx.roundTrip);
    liveAfterChange();
  }

  function liveAfterChange() {
    lv.rem = null;
    if (nav.legIdx !== lv.st.idx) navReset();
    nav.lastSetZoom = null;
    liveRecompute();
    liveSave();
    renderLive();
    renderNav();
    if (lv.fix && lv.follow && !lv.st.finished) navFollow(false);
    if (lv.on && !lv.st.finished && lv.st.phase === "drive" && !nav.guide) navOnFix();
  }

  function liveCenter() { navFollow(true); }

  const ME_ICON = () => L.divIcon({
    className: "nav-me-wrap", iconSize: [46, 46], iconAnchor: [23, 23],
    html: '<div class="nav-me"><svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="21" fill="rgba(47,111,237,.16)"/><path d="M23 6 L35 36 L23 29.5 L11 36 Z" fill="#2f6fed" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg></div>',
  });

  function liveDraw() {
    if (!lv.fix) return;
    const ll = [lv.fix.lat, lv.fix.lon];
    if (!meMarker) {
      meAcc = L.circle(ll, { radius: lv.fix.acc || 20, color: "#2f6fed", weight: 1, fillColor: "#2f6fed", fillOpacity: 0.1, interactive: false }).addTo(liveLayer);
      meMarker = L.marker(ll, { icon: ME_ICON(), interactive: false, zIndexOffset: 3000, keyboard: false }).addTo(liveLayer);
    } else { meAcc.setLatLng(ll); meAcc.setRadius(lv.fix.acc || 20); meMarker.setLatLng(ll); }
    const el = meMarker.getElement && meMarker.getElement();
    const inner = el && el.querySelector(".nav-me");
    if (inner) inner.classList.toggle("nohead", nav.heading === null || nav.heading === undefined);
    meRotate();
  }

  /** Joylashuv strelkasi: harakat yoʻnalishi plyus xarita aylanishi (ekrandagi burchak). */
  function meRotate() {
    const el = meMarker && meMarker.getElement && meMarker.getElement();
    const inner = el && el.querySelector(".nav-me");
    if (!inner) return;
    const h = nav.heading === null || nav.heading === undefined ? 0 : nav.heading;
    inner.style.transform = "rotate(" + (h + map.getBearing()) + "deg)";
  }

  function liveOnPosition(pos) {
    const c = pos.coords;
    lv.fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, speed: c.speed, heading: c.heading, t: pos.timestamp || Live.now() };
    lv.gpsMsg = "";
    navOnFix();
    liveDraw();
    navDraw();
    navFollow(false);
    const target = Live.targetOf(lv.st, state.start, lv.ctx.stops, lv.ctx.roundTrip);
    if (Live.onFix(lv.st, lv.fix, target)) { liveDoArrive(true); return; }
    liveRecompute();
    renderLive();
    renderNav();
  }

  function liveOnError(err) {
    const msgs = { 1: "GPS ruxsati berilmadi. Telefon sozlamalarida joylashuvga ruxsat bering. Hozircha tugmalar bilan boshqaring.", 2: "Joylashuvni aniqlab boʻlmadi. Ochiq joyga chiqing.", 3: "GPS javob bermadi, qayta urinilmoqda…" };
    lv.gpsMsg = msgs[err && err.code] || "GPS xatosi.";
    renderLive();
  }

  /* ---- Navigatsiya (Yandex uslubida kuzatish): burilish banneri, tezlik, ovoz, qayta yoʻl solish ---- */

  const VOICE_KEY = "yolnoma.voice";
  const nav = {
    guide: null, legIdx: -1, loading: false, failedAt: 0, hint: null, stepIdx: 0, along: 0, off: 0, onRoute: false,
    offSince: 0, lastReroute: 0, lastFullScan: 0, spoken: {}, speed: 0, heading: null, prevFix: null,
    drawnAt: 0, voiceOn: false, voice: null, lastSetZoom: null, zoomLocked: false, rerouting: false,
    mode: "heading", progRot: false,   // xarita: "heading" — harakat tepada, "north" — shimol tepada, "free" — qoʻlda aylantirilgan
  };

  function navIconSvg(icon) {
    const c = "currentColor";
    if (!icon) icon = { kind: "arrow", angle: 0 };
    if (icon.kind === "flag") return '<svg viewBox="0 0 48 48"><path d="M13 42V8M13 10h24l-6 8 6 8H13" fill="none" stroke="' + c + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (icon.kind === "round") {
      return '<svg viewBox="0 0 48 48"><circle cx="24" cy="26" r="10" fill="none" stroke="' + c + '" stroke-width="5"/>' +
        '<path d="M24 46v-10" stroke="' + c + '" stroke-width="5" stroke-linecap="round"/>' +
        '<g transform="rotate(' + (icon.angle || 0) + ' 24 26)"><path d="M24 16V6" stroke="' + c + '" stroke-width="5" stroke-linecap="round"/><path d="M15 12L24 3l9 9z" fill="' + c + '"/></g></svg>';
    }
    if (Math.abs(icon.angle) >= 179) { // U-burilish
      return '<svg viewBox="0 0 48 48"><path d="M16 44V20a8 8 0 0 1 16 0v14" fill="none" stroke="' + c + '" stroke-width="5" stroke-linecap="round"/><path d="M23 32l9 11 9-11z" fill="' + c + '"/></svg>';
    }
    return '<svg viewBox="0 0 48 48"><path d="M24 44V26" stroke="' + c + '" stroke-width="5" stroke-linecap="round"/>' +
      '<g transform="rotate(' + (icon.angle || 0) + ' 24 26)"><path d="M24 26V14" stroke="' + c + '" stroke-width="5" stroke-linecap="round"/><path d="M13 17L24 4l11 13z" fill="' + c + '"/></g></svg>';
  }

  function navPickVoice() {
    try {
      const vs = (window.speechSynthesis && speechSynthesis.getVoices && speechSynthesis.getVoices()) || [];
      // Oʻzbek ovozi kam uchraydi; turk ovozi lotin yozuvidagi oʻzbekcha matnni yaxshi oʻqiydi
      nav.voice = vs.find((v) => /^uz/i.test(v.lang)) || vs.find((v) => /^tr/i.test(v.lang)) || null;
    } catch (_) { nav.voice = null; }
    const b = $("#nav-voice");
    b.hidden = !nav.voice || !lv.on;
  }
  try { if (window.speechSynthesis) speechSynthesis.addEventListener && speechSynthesis.addEventListener("voiceschanged", navPickVoice); } catch (_) { /* noop */ }

  function navSpeak(text) {
    if (!nav.voiceOn || !nav.voice) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = nav.voice; u.lang = nav.voice.lang; u.rate = 1;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (_) { /* noop */ }
  }

  function navReset() {
    nav.guide = null; nav.legIdx = -1; nav.hint = null; nav.stepIdx = 0; nav.onRoute = false; nav.offSince = 0; nav.spoken = {};
    if (guideLine) { liveLayer.removeLayer(guideLine); guideLine = null; }
    if (guideCasing) { liveLayer.removeLayer(guideCasing); guideCasing = null; }
  }

  /** Hozirgi yoʻl qismi uchun burilish koʻrsatmalarini yuklaydi (OSRM steps). */
  async function navFetchGuide(reason) {
    if (nav.loading || !lv.on || lv.st.finished || lv.st.phase !== "drive") return;
    const st = lv.st, ctx = lv.ctx, idx = st.idx;
    const target = Live.targetOf(st, state.start, ctx.stops, ctx.roundTrip);
    if (!target) return;
    const prevPt = idx === 0 ? state.start : ctx.stops[idx - 1];
    const here = lv.fix ? { lat: lv.fix.lat, lon: lv.fix.lon } : null;
    const from = here || prevPt;
    const dTo = (p) => Geo.haversine(p, target);
    // aylanma yoʻl (chegara) nuqtalari: faqat hali oʻtilmaganlari
    const via = ((result.via && result.via[idx]) || []).filter((v) => !here || dTo(v) < dTo(here));
    nav.loading = true;
    renderNav();
    try {
      const r = await API.route([from].concat(via, [target]), { steps: true, timeout: 25000 });
      if (!lv.on || lv.st.idx !== idx || lv.st.phase !== "drive") return;       // holat oʻzgarib ketgan
      const g = r ? Nav.parseGuide(r) : null;
      if (!g) throw new Error("no route");
      if (r.geometry && Border.excursions(r.geometry).list.length) throw new Error("border");   // Oʻzbekistondan chiqib ketadigan yoʻl — olmaymiz
      nav.guide = g; nav.legIdx = idx; nav.hint = null; nav.stepIdx = 0; nav.spoken = {}; nav.failedAt = 0; nav.offSince = 0;
      nav.drawnAt = 0;
      if (reason === "reroute") { toast("Yangi marshrut hisoblandi."); navSpeak("Marshrut qayta hisoblandi"); }
    } catch (e) {
      console.warn("Navigatsiya yoʻriqnomasi olinmadi:", e && e.message);
      nav.failedAt = Live.now();
    } finally {
      nav.loading = false;
      if (lv.on) { navOnFix(true); navDraw(); renderLive(); renderNav(); }
    }
  }

  /** Yangi GPS nuqtasi: yoʻlga yopishtirish, keyingi burilish, qayta yoʻl solish, ovoz. */
  function navOnFix(noGuideFetch) {
    if (!lv.on || !lv.fix) return;
    const fix = lv.fix, now = Live.now(), st = lv.st;
    nav.speed = Nav.speedKmh(fix, nav.prevFix);
    nav.heading = Nav.heading(fix, nav.prevFix, nav.heading);
    nav.prevFix = fix;
    if (st.finished || st.phase !== "drive") { nav.onRoute = false; return; }
    if (nav.guide && nav.legIdx === st.idx) {
      let sn = Nav.snap(nav.guide, fix, nav.hint, false);
      if (sn.off > 120 && now - nav.lastFullScan > 4000) { nav.lastFullScan = now; sn = Nav.snap(nav.guide, fix, null, true); }
      nav.hint = sn.idx; nav.along = sn.along; nav.off = sn.off;
      nav.onRoute = sn.off <= Math.max(90, (fix.acc || 0) * 2);
      nav.snap = sn;
      if (nav.onRoute) {
        nav.offSince = 0;
        nav.stepIdx = Nav.nextStep(nav.guide, sn.along, nav.stepIdx);
        navAnnounce();
      } else {
        if (!nav.offSince) nav.offSince = now;
        else if (now - nav.offSince > 10000 && now - nav.lastReroute > 25000 && !nav.loading && !noGuideFetch) {
          nav.lastReroute = now;
          navFetchGuide("reroute");
        }
      }
    } else if (!nav.loading && !noGuideFetch && now - nav.failedAt > 45000) {
      navFetchGuide("first");
    }
  }

  function navAnnounce() {
    const g = nav.guide, step = g.steps[nav.stepIdx];
    if (!step) return;
    const dist = step.along - nav.along, key = nav.legIdx + ":" + nav.stepIdx;
    const say = (lvl, txt) => { if (!nav.spoken[key + lvl]) { nav.spoken[key + lvl] = true; navSpeak(txt); } };
    if (step.type === "arrive") { if (dist < 250) say("n", step.title); return; }
    if (dist < 200) say("n", step.title + (step.name ? ", " + step.name : ""));
    else if (dist < 700 && dist > 350) say("f", Nav.fmtDist(dist) + "dan keyin " + step.title.charAt(0).toLowerCase() + step.title.slice(1));
  }

  function renderNav() {
    const top = $("#nav-top"), side = $("#nav-side");
    const st = lv.st;
    const show = lv.on && st && !st.finished && st.phase === "drive";
    top.hidden = !show;
    side.hidden = !lv.on;
    if (!lv.on) return;
    $("#nav-speed b").textContent = String(Math.round(nav.speed || 0));
    $("#nav-recenter").hidden = lv.follow;
    renderCompass();
    const vb = $("#nav-voice");
    vb.setAttribute("aria-pressed", String(nav.voiceOn));
    vb.classList.toggle("on", nav.voiceOn);
    if (!show) return;
    const target = Live.targetOf(st, state.start, lv.ctx.stops, lv.ctx.roundTrip);
    let icon = { kind: "arrow", angle: 0 }, distTxt = "", title = "", street = "", then = "";
    const g = nav.guide;
    if (g && nav.legIdx === st.idx && nav.onRoute && g.steps[nav.stepIdx]) {
      const step = g.steps[nav.stepIdx];
      icon = step.icon; distTxt = Nav.fmtDist(Math.max(0, step.along - nav.along)); title = step.title; street = step.name;
      if (step.type === "arrive" && target) street = target.isReturn ? target.name : target.n + "-manzil: " + target.name;
      const nx = g.steps[nav.stepIdx + 1];
      if (nx && step.type !== "arrive" && nx.along - step.along < 400) then = "Keyin: " + nx.title.charAt(0).toLowerCase() + nx.title.slice(1);
    } else if (g && nav.legIdx === st.idx && !nav.onRoute) {
      icon = { kind: "arrow", angle: 180 }; distTxt = nav.off ? Nav.fmtDist(nav.off) : ""; title = "Marshrutdan chiqdingiz"; street = nav.loading ? "Yangi yoʻl hisoblanmoqda…" : "Marshrutga qayting — yangi yoʻl hisoblanadi";
    } else {
      distTxt = lv.rem ? Nav.fmtDist(lv.rem.meters) : "";
      title = nav.loading ? "Yoʻl koʻrsatmalari yuklanmoqda…" : "Marshrut chizigʻi boʻylab yuring";
      street = target ? (target.isReturn ? target.name : target.n + "-manzil: " + target.name) : "";
    }
    $("#nav-icon").innerHTML = navIconSvg(icon);
    $("#nav-dist").textContent = distTxt;
    $("#nav-title").textContent = title;
    $("#nav-street").textContent = street;
    const th = $("#nav-then"); th.textContent = then; th.hidden = !then;
  }

  /** Xaritada qolgan yoʻlni qalin koʻk chiziq bilan koʻrsatadi (2 soniyada bir marta). */
  function navDraw() {
    const g = nav.guide, st = lv.st;
    if (!lv.on || !g || nav.legIdx !== st.idx || !nav.snap || !nav.onRoute) return;
    const now = Live.now();
    if (now - nav.drawnAt < 2000) return;
    nav.drawnAt = now;
    const path = Nav.remainingPath(g, nav.snap, 700);
    if (!guideLine) {
      guideCasing = L.polyline(path, { color: "#fff", weight: 11, opacity: 0.95, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(liveLayer);
      guideLine = L.polyline(path, { color: "#2f6fed", weight: 7, opacity: 1, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(liveLayer);
    } else { guideCasing.setLatLngs(path); guideLine.setLatLngs(path); }
    if (meMarker) meMarker.setZIndexOffset(3000);
  }

  /** "Harakat tepada" rejimi: xarita yoʻnalishga qarab buriladi (past tezlikda GPS yoʻnalishi ishonchsiz — oʻzgarmaydi). */
  function navApplyBearing(force) {
    if (nav.mode !== "heading" || nav.heading === null || nav.heading === undefined) return;
    if (!force && (nav.speed || 0) < 5) return;
    const cur = map.getBearing();
    const d = (((-nav.heading - cur) % 360) + 540) % 360 - 180;
    if (!force && Math.abs(d) < 2) return;
    navSetBearing(cur + (force ? d : d * 0.6));
  }
  function navSetBearing(b) {
    nav.progRot = true;
    try { map.setBearing(b, { animate: false }); } finally { nav.progRot = false; }
  }
  function renderCompass() {
    const b = $("#nav-compass");
    if (!b) return;
    const rose = $("#nav-compass-rose");
    if (rose) rose.style.transform = "rotate(" + map.getBearing() + "deg)";
    b.classList.toggle("heading", nav.mode === "heading");
    b.setAttribute("aria-label", nav.mode === "heading" ? "Shimol tepada" : (Math.abs(((map.getBearing() + 540) % 360) - 180) > 1 ? "Shimolga qaytarish" : "Harakat yoʻnalishi tepada"));
  }

  /** Xaritani foydalanuvchiga kuzatdiradi: koʻrinadigan oraliqning markazida, tezlikka mos masshtabda. */
  function navFollow(force) {
    if (!lv.fix || (!lv.follow && !force)) return;
    const size = map.getSize();
    const topEl = $("#nav-top"), sheet = $("#live");
    const topH = topEl && !topEl.hidden ? topEl.offsetHeight + 12 : 12;
    const botH = sheet && !sheet.hidden ? sheet.offsetHeight + 12 : 12;
    const desiredY = (topH + (size.y - botH)) / 2 + (size.y - topH - botH) * 0.12;
    let z = map.getZoom();
    const cur = map.getZoom();
    if (nav.lastSetZoom !== null && cur !== nav.lastSetZoom) nav.zoomLocked = true;   // foydalanuvchi oʻzi masshtabni oʻzgartirgan
    if (force) nav.zoomLocked = false;
    const target = nav.zoomLocked ? cur : Nav.zoomFor(nav.speed);
    // tez-tez "pichirlamasligi" uchun masshtab faqat 1 pogʻonaga oʻzgaradi
    z = target > cur ? cur + 1 : target < cur ? cur - 1 : cur;
    if (!lv.centered) z = Math.max(cur, 15);
    navApplyBearing(force);
    // Xarita aylangan boʻlsa, joylashuv "pastroqda" turishi uchun siljish ham aylantiriladi
    const th = map.getBearing() * Math.PI / 180, sy = desiredY - size.y / 2;
    const p = map.project([lv.fix.lat, lv.fix.lon], z);
    p.x -= sy * Math.sin(th); p.y -= sy * Math.cos(th);
    const c = map.unproject(p, z);
    map.setView(c, z, { animate: lv.centered, duration: 0.8 });
    nav.lastSetZoom = z;
    lv.centered = true;
  }

  async function liveWake() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        lv.wake = await navigator.wakeLock.request("screen");
        lv.wake.addEventListener && lv.wake.addEventListener("release", () => { lv.wake = null; });
      }
    } catch (_) { lv.wake = null; }
  }
  document.addEventListener("visibilitychange", () => { if (lv.on && document.visibilityState === "visible" && !lv.wake) liveWake(); });

  function liveBegin(restored) {
    lv.on = true; lv.centered = false; lv.fix = null; lv.gpsMsg = ""; lv.follow = true; lv.min = true;
    nav.prevFix = null; nav.heading = null; nav.speed = 0; nav.failedAt = 0; nav.lastSetZoom = null; nav.zoomLocked = false; nav.mode = "heading";
    navReset();
    try { nav.voiceOn = localStorage.getItem(VOICE_KEY) === "1"; } catch (_) { nav.voiceOn = false; }
    lv.ctx = liveContext();
    $("#live").hidden = false;
    document.body.classList.add("live-on");
    setTimeout(() => { map.invalidateSize(); }, 60);
    navPickVoice();
    if (navigator.geolocation) {
      lv.watchId = navigator.geolocation.watchPosition(liveOnPosition, liveOnError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    } else lv.gpsMsg = "Brauzeringiz GPS'ni qoʻllamaydi. Tugmalar bilan boshqaring.";
    liveWake();
    clearInterval(lv.tick);
    let n = 0;
    lv.tick = setInterval(() => { if (++n % 20 === 0) liveRecompute(); renderLive(); }, 1000);
    liveRecompute();
    renderLive();
    renderNav();
    if (restored === false && !lv.fix) map.setView([state.start.lat, state.start.lon], Math.max(map.getZoom(), 12));
  }

  function startLive() {
    if (!result || result.stale || !state.start) { toast("Avval marshrutni hisoblang."); return; }
    if (lv.on) return;
    const nowMs = Live.now();
    const np = liveParams(nowMs);
    if (!np.ok) { toast("Ish vaqti sozlamasi notoʻgʻri: " + np.errors[0], "warn"); return; }
    lv.P = np.P;
    lv.st = Live.create(nowMs);
    lv.prev = null;
    lv.ctx = liveContext();
    // Reja (taqqoslash uchun): hozir yoʻlga chiqsak, har manzilga qachon yetib boramiz
    try {
      const base = Live.project(lv.ctx, { state: lv.st, nowMs, frac: 1, fromName: state.start.name });
      lv.base = []; base.stops.forEach((r) => { lv.base[r.n - 1] = Live.toMs(r.arrive, lv.P); });
    } catch (e) { console.error(e); lv.base = []; }
    liveSave();
    liveBegin(false);
  }

  function stopLive(msg) {
    if (!lv.on) return;
    lv.on = false;
    if (lv.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(lv.watchId);
    lv.watchId = null;
    clearInterval(lv.tick); lv.tick = null;
    try { if (lv.wake && lv.wake.release) lv.wake.release(); } catch (_) { /* noop */ }
    lv.wake = null;
    liveLayer.clearLayers(); meMarker = null; meAcc = null; guideLine = null; guideCasing = null;
    navReset();
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (_) { /* noop */ }
    $("#live").hidden = true;
    $("#nav-top").hidden = true; $("#nav-side").hidden = true;
    document.body.classList.remove("live-on");
    navSetBearing(0);
    setTimeout(() => { map.invalidateSize(); fitAll(); }, 60);
    liveForget();
    if (msg) toast(msg);
  }

  /** Sahifa qayta ochilsa — jonli safar shu yerdan davom etadi. */
  function tryResumeLive() {
    if (lv.on || !result || result.stale) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LIVE_KEY) || "null"); } catch (_) { /* noop */ }
    if (!saved || !saved.st || saved.sig !== liveSig()) return;
    if (Live.now() - (saved.saved || 0) > 3 * 86400000) { liveForget(); return; }
    lv.st = saved.st; lv.base = saved.base || []; lv.P = saved.P; lv.prev = null;
    if (!lv.P || !lv.P.date) { liveForget(); return; }
    if (lv.st.finished) { liveForget(); return; }
    liveBegin(true);
    toast("Jonli safar davom ettirildi.");
  }

  $("#btn-live").onclick = startLive;
  const liveExit = () => { if (!lv.on) return; if (lv.st && lv.st.finished || window.confirm("Safarni toʻxtatamizmi? Joriy holat oʻchiriladi.")) stopLive(); };
  $("#lv-stop").onclick = liveExit;
  $("#nav-exit").onclick = liveExit;
  $("#lv-min").onclick = () => { lv.min = !lv.min; renderLive(); };
  $("#live").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lv]");
    if (!b || !lv.on) return;
    const a = b.dataset.lv;
    if (a === "arrive") liveDoArrive(false);
    else if (a === "finish") liveDoFinish();
    else if (a === "close") stopLive();
    else if (a === "undo" && lv.prev) { lv.st = JSON.parse(lv.prev); lv.prev = null; liveAfterChange(); }

  });
  map.on("dragstart", () => { if (lv.on && lv.follow) { lv.follow = false; renderNav(); } });
  map.on("rotate", () => {
    if (lv.on && !nav.progRot && nav.mode !== "free") nav.mode = "free";      // foydalanuvchi oʻzi aylantirdi
    if (lv.on) { meRotate(); renderCompass(); }
  });
  $("#nav-compass").onclick = () => {
    const rotated = Math.abs(((map.getBearing() + 540) % 360) - 180) > 1;
    if (nav.mode === "heading" || rotated) { nav.mode = "north"; navSetBearing(0); navFollow(true); }
    else { nav.mode = "heading"; lv.follow = true; navApplyBearing(true); renderNav(); navFollow(true); }
    renderCompass(); meRotate();
  };
  $("#nav-recenter").onclick = () => { lv.follow = true; renderNav(); navFollow(true); };
  $("#nav-voice").onclick = () => {
    nav.voiceOn = !nav.voiceOn;
    try { localStorage.setItem(VOICE_KEY, nav.voiceOn ? "1" : "0"); } catch (_) { /* noop */ }
    renderNav();
    if (nav.voiceOn) navSpeak("Ovozli koʻrsatma yoqildi");
    else try { speechSynthesis.cancel(); } catch (_) { /* noop */ }
  };

  /* ---------------- Safar hisoboti ---------------- */

  const REPORT_KEY = "yolnoma.report.v1";
  const RP = ["date", "depart", "start", "end", "stay", "limit"].reduce((o, k) => { o[k] = $("#rp-" + k); return o; }, {});
  let reportText = "", reportRep = null;

  function todayISO() { return tomorrowISO(-1); }
  function tomorrowISO(shift) {
    const d = new Date(); d.setDate(d.getDate() + (shift === undefined ? 1 : shift + 1));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function reportParams() {
    return Report.normalizeParams({
      date: RP.date.value, depart: RP.depart.value, workStart: RP.start.value, workEnd: RP.end.value,
      driveLimit: RP.limit.value, stayMin: RP.stay.value === "" ? NaN : Number(RP.stay.value),
    });
  }

  const REPORT_FMT_KEY = "yolnoma.report.fmt";
  const reportFormat = () => { const r = document.querySelector('input[name="rp-format"]:checked'); return r ? r.value : "full"; };
  document.querySelectorAll('input[name="rp-format"]').forEach((r) => r.addEventListener("change", () => {
    try { localStorage.setItem(REPORT_FMT_KEY, reportFormat()); } catch (_) { /* noop */ }
    buildReport();
  }));

  function buildReport() {
    const np = reportParams();
    const box = $("#rp-msgs");
    box.innerHTML = "";
    const addMsg = (t, cls) => { const d = document.createElement("div"); d.className = "rp-msg " + cls; d.textContent = t; box.appendChild(d); };
    np.errors.forEach((m) => addMsg(m, "err"));
    np.warnings.forEach((m) => addMsg(m, "warn"));
    reportRep = null; reportText = "";
    const dis = !np.ok || !result || result.stale;
    ["#rp-download", "#rp-copy", "#rp-print"].forEach((id) => { $(id).disabled = dis; });
    if (!np.ok) { $("#rp-preview").textContent = ""; return; }
    if (!result || result.stale) { $("#rp-preview").textContent = "Avval marshrutni hisoblang."; return; }
    try {
      const stops = result.order.map(stopById).filter(Boolean);
      reportRep = Report.schedule({
        start: state.start, stops, legs: result.legs, roundTrip: result.roundTrip,
        geometry: result.geometry, cities: Border.HUBS, params: np.P,
      });
      const now = new Date();
      reportText = reportFormat() === "short"
        ? Report.toShortText(reportRep, { yandexDomain: CONFIG.yandexDomain || "yandex.uz" })
        : Report.toText(reportRep, { title: "Safar hisoboti", generated: now.toLocaleString("uz-UZ") });
      $("#rp-preview").textContent = reportText;
    } catch (e) {
      console.error(e);
      $("#rp-preview").textContent = "";
      addMsg("Hisobotni tuzib boʻlmadi: " + e.message, "err");
      ["#rp-download", "#rp-copy", "#rp-print"].forEach((id) => { $(id).disabled = true; });
    }
  }

  function saveReportPrefs() {
    state.work = { start: RP.start.value || "10:00", end: RP.end.value || "18:00", limit: RP.limit.value || "" };
    save();
    try { localStorage.setItem(REPORT_KEY, JSON.stringify(state.work)); } catch (_) { /* noop */ }
  }

  function openReport() {
    if (readonly) return;
    if (!result || result.stale) { toast("Avval marshrutni hisoblang."); return; }
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(REPORT_KEY) || "{}") || {}; } catch (_) { /* noop */ }
    if (!RP.date.value || RP.date.value < todayISO()) RP.date.value = tomorrowISO();
    RP.depart.value = state.depart || "08:00";     // saytdagi "Joʻnash vaqti"
    RP.stay.value = state.stay;                    // saytdagi "Har manzilda turish"
    const hasWork = state.work && (state.work.start !== "10:00" || state.work.end !== "18:00" || state.work.limit);
    const src = hasWork ? state.work : prefs;
    RP.start.value = /^\d{2}:\d{2}$/.test(src.start || "") ? src.start : "10:00";
    RP.end.value = /^\d{2}:\d{2}$/.test(src.end || "") ? src.end : "18:00";
    RP.limit.value = /^\d{2}:\d{2}$/.test(src.limit || "") ? src.limit : "";
    try { const f = localStorage.getItem(REPORT_FMT_KEY); const r = document.querySelector('input[name="rp-format"][value="' + (f === "short" ? "short" : "full") + '"]'); if (r) r.checked = true; } catch (_) { /* noop */ }
    $("#report-backdrop").hidden = false;
    $("#report-modal").hidden = false;
    buildReport();
    RP.date.focus();
  }
  function closeReport() { $("#report-backdrop").hidden = true; $("#report-modal").hidden = true; $("#btn-report").focus(); }

  Object.keys(RP).forEach((k) => RP[k].addEventListener("input", () => { saveReportPrefs(); buildReport(); }));
  $("#btn-report").onclick = openReport;
  $("#report-close").onclick = closeReport;
  $("#report-backdrop").onclick = closeReport;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#report-modal").hidden) closeReport(); });

  function reportFileName(ext) { return "hisobot-" + (RP.date.value || "safar") + "." + ext; }
  function downloadFile(name, text, mime) {
    const url = URL.createObjectURL(new Blob(["\ufeff" + text], { type: mime }));
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  $("#rp-download").onclick = () => { if (reportText) { downloadFile(reportFileName("txt"), reportText, "text/plain;charset=utf-8"); toast("Hisobot yuklab olindi."); } };
  $("#rp-copy").onclick = () => { if (reportText) copyText(reportText, "Hisobot nusxalandi."); };
  $("#rp-print").onclick = () => {
    if (!reportRep) return;
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
    document.body.appendChild(f);
    f.srcdoc = reportFormat() === "short" ? Report.toHTMLShort(reportRep, { title: "Safar hisoboti", yandexDomain: CONFIG.yandexDomain || "yandex.uz" }) : Report.toHTML(reportRep, { title: "Safar hisoboti" });
    f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) { toast("Chop etib boʻlmadi."); } setTimeout(() => f.remove(), 60000); };
  };


  /* ---------------- Tarix (saqlangan marshrut rejalari) ---------------- */

  function histRead() {
    try {
      const a = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
      return Array.isArray(a) ? a.filter((e) => e && e.id && e.data && typeof e.data === "object") : [];
    } catch (_) { return []; }
  }
  function histWrite(list) {
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, HIST_MAX))); return true; }
    catch (_) { toast("Tarixni saqlab boʻlmadi (brauzer xotirasi toʻla).", "warn"); return false; }
  }
  function setPlanId(id, at) {
    planId = id || null;
    try {
      if (planId) localStorage.setItem(PLAN_KEY, planId); else localStorage.removeItem(PLAN_KEY);
      localStorage.setItem(PLAN_AT_KEY, String(at || Date.now()));
    } catch (_) { /* noop */ }
    if (!at) syncSoon();
  }
  const tombRead = () => { try { return JSON.parse(localStorage.getItem(DEL_KEY) || "{}") || {}; } catch (_) { return {}; } };
  const tombWrite = (o) => { try { localStorage.setItem(DEL_KEY, JSON.stringify(o)); } catch (_) { /* noop */ } };
  const planHasContent = () => !state.sample && !!(state.start || state.stops.length);
  const histNewId = () => "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function histAutoName(d) {
    const s = d.start && d.start.name ? d.start.name : "Reja";
    const n = (d.stops || []).length;
    const last = n === 1 ? d.stops[0].name : n > 1 ? n + " ta manzil" : "";
    return (last ? s + " → " + last : s).slice(0, 60);
  }
  function histFmtDate(ts) {
    const d = new Date(ts), z = (n) => String(n).padStart(2, "0");
    return z(d.getDate()) + "." + z(d.getMonth() + 1) + "." + d.getFullYear() + " " + z(d.getHours()) + ":" + z(d.getMinutes());
  }

  /** Joriy rejani Tarix yozuviga yozadi (yozuv yoʻq boʻlsa yaratadi). Yozuvni qaytaradi. */
  function histUpsert(id, data, extra) {
    const list = histRead();
    const now = Date.now();
    let e = list.find((x) => x.id === id);
    const dist = result && !result.stale ? Math.round(result.distance) : (e ? e.dist : 0);
    const dur = result && !result.stale ? Math.round(result.duration) : (e ? e.dur : 0);
    if (e) {
      if (JSON.stringify(e.data) === JSON.stringify(data)) {
        // reja oʻzgarmagan: faqat hisoblangan masofa yangilanadi (yangilanish vaqti va sinxron tegilmaydi)
        if (e.dist !== dist || e.dur !== dur) { e.dist = dist; e.dur = dur; histWrite(list); }
        return e;
      }
      e.data = data; e.dist = dist; e.dur = dur; e.updatedAt = now;
    } else {
      e = { id, name: (extra && extra.name) || histAutoName(data), createdAt: now, updatedAt: now, data, dist, dur };
      list.push(e);
    }
    histWrite(list);
    syncSoon();
    return e;
  }
  /** Bogʻlangan reja oʻzgarsa, Tarixdagi nusxa ham yangilanadi. */
  function histSync() {
    if (readonly || !planId || syncSt.applying) return;
    if (!planHasContent()) return;
    if (!histRead().some((x) => x.id === planId)) return;
    histUpsert(planId, serialize());
  }
  /** Joriy reja Tarixda yoʻq boʻlsa, saqlab qoʻyadi. true — yangi yozuv yaratildi. */
  function archiveCurrent() {
    if (readonly || !planHasContent()) return false;
    if (planId && histRead().some((x) => x.id === planId)) { histSync(); return false; }
    histUpsert(histNewId(), serialize());
    return true;
  }

  function histSaveCurrent() {
    if (readonly) {
      // Ulashilgan safar: koʻruvchi oʻz Tarixiga nusxa qilib saqlaydi (bir xil boʻlsa takrorlanmaydi)
      const d = serialize(), sig = JSON.stringify(d);
      if (histRead().some((x) => JSON.stringify(x.data) === sig)) { toast("Bu safar Tarixda allaqachon bor."); return; }
      histUpsert(histNewId(), d);
      toast("Safar Tarixga saqlandi. Tahrirlash uchun “Oʻz safarimni boshlash”ni bosing.");
    } else {
      if (!planHasContent()) { toast("Saqlash uchun avval reja tuzing.", "warn"); return; }
      if (planId && histRead().some((x) => x.id === planId)) { toast("Reja Tarixda saqlangan."); return; }
      const id = histNewId();
      histUpsert(id, serialize());
      setPlanId(id);
      toast("Reja Tarixga saqlandi.");
    }
    renderHist();
  }

  function histOpen(id) {
    if (readonly) return;
    const e = histRead().find((x) => x.id === id);
    if (!e) return;
    if (id === planId) { closeHist(); return; }
    if (lv && lv.on) stopLive("Reja almashtirildi — jonli rejim toʻxtatildi.");
    const archived = archiveCurrent();
    load(e.data); state.sample = false;
    setPlanId(id);
    result = null; details.clear(); routeLayer.clearLayers(); poiLayer.clearLayers();
    closeDrawer();
    save(); renderAll(); fitAll();
    closeHist();
    if (state.start && state.stops.length) solve();
    toast("«" + e.name + "» ochildi." + (archived ? " Oldingi reja Tarixga saqlandi." : ""));
  }
  function histDelete(id) {
    const e = histRead().find((x) => x.id === id);
    if (!e) return;
    if (!window.confirm("«" + e.name + "» Tarixdan oʻchirilsinmi?")) return;
    histWrite(histRead().filter((x) => x.id !== id));
    const tomb = tombRead(); tomb[id] = Date.now(); tombWrite(tomb);
    if (planId === id) setPlanId(null);
    renderHist();
    syncSoon();
  }
  function histRename(id, name) {
    const list = histRead(), e = list.find((x) => x.id === id);
    if (!e) return;
    const n = String(name || "").trim().slice(0, 60);
    if (n && n !== e.name) { e.name = n; e.updatedAt = Date.now(); histWrite(list); syncSoon(); }
  }

  function renderHist() {
    const list = histRead().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const cur = $("#hs-cur"), ul = $("#hs-list");
    const bound = !readonly && planId && list.some((x) => x.id === planId);
    if (readonly) {
      cur.innerHTML = '<span>Bu ulashilgan safar. Oʻz Tarixingizga nusxa qilib saqlab qoʻyishingiz mumkin.</span><button class="btn sm" type="button" data-hs="save">Tarixga saqlash</button>';
    } else if (!planHasContent()) cur.innerHTML = "";
    else if (bound) cur.innerHTML = "<span>Joriy reja Tarixda saqlangan — oʻzgarishlar avtomatik saqlanadi.</span>";
    else cur.innerHTML = '<span>Joriy reja hali Tarixga saqlanmagan.</span><button class="btn sm" type="button" data-hs="save">Tarixga saqlash</button>';
    $("#hs-transfer").hidden = readonly || !planHasContent() || !state.start || !state.stops.length;
    $("#hs-empty").hidden = list.length > 0;
    ul.innerHTML = list.map((e) => {
      const d = e.data, names = [d.start && d.start.name].concat((d.stops || []).map((s) => s.name)).filter(Boolean);
      const meta = [(d.stops || []).length + " ta manzil", e.dist ? Geo.fmtKm(e.dist) : "", histFmtDate(e.updatedAt || e.createdAt || Date.now())].filter(Boolean).join(" · ");
      const isCur = bound && e.id === planId;
      return '<li class="hs-item' + (isCur ? " cur" : "") + '" data-id="' + esc(e.id) + '">' +
        '<button class="hs-main" type="button" data-hs="open"' + (readonly ? " disabled" : "") + "><b>" + esc(e.name) + (isCur ? '<span class="hs-badge">Joriy</span>' : "") + "</b>" +
        '<span class="hs-route">' + esc(names.join(" → ")) + '</span><span class="hs-meta">' + esc(meta) + "</span></button>" +
        '<button class="icon-btn" type="button" data-hs="rename" aria-label="Nomini oʻzgartirish" title="Nomini oʻzgartirish"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg></button>' +
        '<button class="icon-btn" type="button" data-hs="del" aria-label="Oʻchirish" title="Oʻchirish"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button></li>';
    }).join("");
  }

  function openHist() {
    renderHist(); renderSync();
    $("#hist-backdrop").hidden = false; $("#hist-modal").hidden = false;
    $("#hist-close").focus();
  }
  function closeHist() { $("#hist-backdrop").hidden = true; $("#hist-modal").hidden = true; $("#btn-history").focus(); }
  $("#btn-history").onclick = openHist;
  $("#hist-close").onclick = closeHist;
  $("#hist-backdrop").onclick = closeHist;
  $("#hs-transfer-btn").onclick = () => {
    const url = location.href.split("#")[0] + "#import=" + b64encode(JSON.stringify(serialize()));
    copyText(url, "Koʻchirish havolasi nusxalandi — uni boshqa qurilmada oching.");
  };
  /** #import=… havolasi: reja shu qurilmaning Tarixiga qoʻshiladi va tahrirlanadigan joriy reja boʻladi. */
  function importPlan(data) {
    const archived = archiveCurrent();
    load(data); state.sample = false;
    const sig = JSON.stringify(serialize());
    const same = histRead().find((x) => JSON.stringify(x.data) === sig);
    const id = same ? same.id : histNewId();
    if (!same) histUpsert(id, serialize());
    setPlanId(id);
    result = null;
    save();
    toast("Reja shu qurilmaga koʻchirildi va Tarixga saqlandi." + (archived ? " Oldingi reja ham Tarixda." : ""));
  }
  $("#hs-new").onclick = () => { closeHist(); clearAll({ fresh: true }); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#hist-modal").hidden && !e.target.closest(".hs-edit")) closeHist(); });
  $("#hs-cur").addEventListener("click", (e) => { if (e.target.closest('[data-hs="save"]')) histSaveCurrent(); });
  $("#hs-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hs]"), li = e.target.closest(".hs-item");
    if (!b || !li) return;
    const id = li.dataset.id, act = b.dataset.hs;
    if (act === "open") histOpen(id);
    else if (act === "del") histDelete(id);
    else if (act === "rename") {
      const ent = histRead().find((x) => x.id === id);
      if (!ent) return;
      li.innerHTML = '<div class="hs-edit"><input type="text" maxlength="60" autocomplete="off" aria-label="Reja nomi" value="' + esc(ent.name) + '"><button class="btn sm" type="button" data-hs="rename-ok">Saqlash</button></div>';
      const inp = li.querySelector("input"); inp.focus(); inp.select();
    } else if (act === "rename-ok") { histRename(id, li.querySelector("input").value); renderHist(); }
  });
  $("#hs-list").addEventListener("keydown", (e) => {
    const inp = e.target.closest && e.target.closest(".hs-edit input");
    if (!inp) return;
    if (e.key === "Enter") { e.preventDefault(); histRename(inp.closest(".hs-item").dataset.id, inp.value); renderHist(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); renderHist(); }
  });


  /* ---------------- Server bilan sinxron (Supabase) ---------------- */

  /** Kirilgan boʻlsa, saqlanmagan joriy rejaga ham Tarix yozuvi ochiladi (hech narsa qurilmada qolib ketmasligi uchun). */
  function ensureBound() {
    if (readonly || planId || syncSt.applying || !Sync.signedIn() || !planHasContent()) return;
    const id = histNewId();
    histUpsert(id, serialize());
    planId = id;
    try { localStorage.setItem(PLAN_KEY, id); localStorage.setItem(PLAN_AT_KEY, String(Date.now())); } catch (_) { /* noop */ }
  }

  function syncSoon() {
    if (readonly || !Sync.signedIn()) return;
    clearTimeout(syncSt.timer);
    syncSt.timer = setTimeout(syncNow, 1500);
  }

  /** Boshqa qurilmada tanlangan/oʻzgargan rejani shu qurilmada joriy qiladi. */
  function applyEntry(e, at, msg) {
    syncSt.applying = true;
    try {
      load(e.data); state.sample = false;
      setPlanId(e.id, at || Date.now());
      result = null; details.clear(); routeLayer.clearLayers(); poiLayer.clearLayers();
      closeDrawer();
      try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); } catch (_) { /* noop */ }
      renderAll(); fitAll();
    } finally { syncSt.applying = false; }
    if (state.start && state.stops.length) solve();
    if (msg) toast(msg);
  }

  async function syncNow() {
    if (readonly || !Sync.signedIn()) return;
    if (syncSt.busy) { syncSt.again = true; return; }
    syncSt.busy = true; syncSt.err = ""; renderSync();
    try {
      ensureBound();
      const [remote, rstate] = await Promise.all([Sync.pullPlans(), Sync.pullState()]);
      const tomb = tombRead();
      let local = histRead();
      const push = [];
      let reload = null;          // joriy reja serverda yangiroq boʻlsa — qayta yuklanadi
      const rIds = new Set(remote.map((r) => r.id));
      for (const r of remote) {
        const l = local.find((x) => x.id === r.id), t = tomb[r.id];
        if (t) {
          if (!r.deleted && r.updatedAt > t) { delete tomb[r.id]; }                     // oʻchirilgandan keyin boshqa qurilmada tahrirlangan — qaytaramiz
          else {
            if (!r.deleted) push.push({ id: r.id, name: r.name, data: r.data, dist: r.dist, dur: r.dur, createdAt: r.createdAt, updatedAt: t, deleted: true });
            else delete tomb[r.id];
            continue;
          }
        }
        if (r.deleted) {
          if (l && l.updatedAt <= r.updatedAt) { local = local.filter((x) => x !== l); if (planId === r.id) { planId = null; try { localStorage.removeItem(PLAN_KEY); } catch (_) { /* noop */ } } }
          else if (l) push.push(l);
          continue;
        }
        if (!l) local.push({ id: r.id, name: r.name, data: r.data, dist: r.dist, dur: r.dur, createdAt: r.createdAt, updatedAt: r.updatedAt });
        else if (r.updatedAt > l.updatedAt) {
          const changed = JSON.stringify(l.data) !== JSON.stringify(r.data);
          Object.assign(l, { name: r.name, data: r.data, dist: r.dist, dur: r.dur, createdAt: r.createdAt, updatedAt: r.updatedAt });
          if (l.id === planId && changed) reload = l;
        } else if (l.updatedAt > r.updatedAt) push.push(l);
      }
      for (const l of local) {
        if (rIds.has(l.id)) continue;
        if (tomb[l.id]) { delete tomb[l.id]; continue; }                               // serverda hech boʻlmagan va oʻchirilgan
        push.push(l);
      }
      for (const id of Object.keys(tomb)) if (!rIds.has(id)) delete tomb[id];
      histWrite(local); tombWrite(tomb);
      if (push.length) await Sync.pushPlans(push);

      // hozirgi reja: eng soʻnggi tanlagan qurilma gʻolib
      const at = Number(localStorage.getItem(PLAN_AT_KEY)) || 0;
      const target = rstate && rstate.current && histRead().find((x) => x.id === rstate.current);
      const busyLive = lv && lv.on;
      if (target && rstate.at > at && rstate.current !== planId && !busyLive) {
        applyEntry(target, rstate.at, "Boshqa qurilmadagi reja ochildi: «" + target.name + "»");
      } else if (reload && !busyLive) {
        applyEntry(reload, at, "Reja boshqa qurilmada oʻzgargan — yangilandi.");
      } else if (planId && (!rstate || rstate.current !== planId) && at >= (rstate ? rstate.at : 0)) {
        await Sync.pushState(planId, at || Date.now());
      }
      syncSt.last = Date.now();
    } catch (e) {
      if (e && e.auth) { syncSt.err = "Kirish muddati tugadi — qayta kiring."; }
      else syncSt.err = "Sinxron boʻlmadi: " + (e && e.message ? e.message : e) + " (internet qaytgach avtomatik urinadi)";
    } finally {
      syncSt.busy = false;
      renderSync(); if (!$("#hist-modal").hidden) renderHist();
      if (syncSt.again) { syncSt.again = false; syncSoon(); }
    }
  }

  function renderSync() {
    const box = $("#hs-sync");
    if (!box) return;
    if (!Sync.enabled() || readonly) { box.hidden = true; return; }
    box.hidden = false;
    const hm = (t) => { const d = new Date(t), z = (n) => String(n).padStart(2, "0"); return z(d.getHours()) + ":" + z(d.getMinutes()); };
    if (Sync.signedIn()) {
      const u = Sync.user() || {};
      box.innerHTML = '<span><b>✓ ' + esc(u.email || "Kirilgan") + "</b><br>" + (syncSt.busy ? "Sinxronlanmoqda…" : syncSt.err ? esc(syncSt.err) : "Rejalar barcha qurilmalarda bir xil" + (syncSt.last ? " · yangilandi " + hm(syncSt.last) : "")) + '</span>' +
        '<button class="btn ghost sm" type="button" data-sy="now">Yangilash</button><button class="btn ghost sm" type="button" data-sy="out">Chiqish</button>';
    } else {
      let saved = ""; try { saved = localStorage.getItem(SYNC_EMAIL_KEY) || ""; } catch (_) { /* noop */ }
      box.innerHTML = '<span>Rejalar telefon va kompyuterda bir xil boʻlishi uchun kiring (parolsiz — emailga havola keladi).' + (syncSt.sent ? "<br><b>" + esc(syncSt.sent) + "</b>" : "") + (syncSt.err ? "<br>" + esc(syncSt.err) : "") + '</span>' +
        '<div class="sy-form"><input type="email" id="sy-email" inputmode="email" autocomplete="email" placeholder="email manzilingiz" value="' + esc(saved) + '"><button class="btn sm" type="button" data-sy="send">Havola yuborish</button></div>';
    }
  }
  $("#hs-sync").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-sy]");
    if (!b) return;
    const a = b.dataset.sy;
    if (a === "send") {
      const em = ($("#sy-email").value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { syncSt.err = "Email manzilni toʻgʻri kiriting."; syncSt.sent = ""; renderSync(); return; }
      try { localStorage.setItem(SYNC_EMAIL_KEY, em); } catch (_) { /* noop */ }
      b.disabled = true; syncSt.err = ""; syncSt.sent = "";
      try { await Sync.sendLink(em); syncSt.sent = "Havola " + em + " ga yuborildi. Emailni shu qurilmada ochib, havolani bosing."; }
      catch (err) { syncSt.err = "Yuborib boʻlmadi: " + err.message; }
      renderSync();
    } else if (a === "now") syncNow();
    else if (a === "out") {
      if (!window.confirm("Chiqilsinmi? Rejalar shu qurilmada qoladi, lekin boshqa qurilmalar bilan sinxron toʻxtaydi.")) return;
      await Sync.signOut(); syncSt.err = ""; syncSt.sent = ""; renderSync(); toast("Chiqildi.");
    }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Sync.signedIn() && Date.now() - syncSt.last > 10000) syncNow(); });
  setInterval(() => { if (document.visibilityState === "visible" && Sync.signedIn() && !(lv && lv.on) && Date.now() - syncSt.last > 55000) syncNow(); }, 30000);

  /* ---------------- Boshlash ---------------- */

  function boot() {
    let loaded = false;
    // Emaildagi kirish havolasi (#access_token=…): sessiyani saqlab, manzilni tozalaymiz
    const login = Sync.consumeHash();
    if (login) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (_) { /* noop */ }
      if (login.error) { toast("Kirib boʻlmadi: " + login.error, "warn"); } else toast("Kirdingiz. Rejalar sinxronlanmoqda…");
    }
    // Ulashilgan havola (#view=… yoki eski #trip=…) faqat koʻrish rejimida ochiladi: tahrirlash va saqlash yoʻq
    const m = location.hash.match(/(?:view|trip)=([A-Za-z0-9_-]+)/);
    if (m) {
      try {
        const data = JSON.parse(b64decode(m[1]));
        readonly = true;
        load(data); state.sample = false; loaded = true;
        document.body.classList.add("readonly");
        $("#ro-note").hidden = false;
        $("#ro-own").href = location.pathname + location.search;
      } catch (e) { readonly = false; toast("Havoladagi safar maʼlumotini oʻqib boʻlmadi."); }
    }
    if (!loaded) {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) { load(JSON.parse(raw)); loaded = true; }
      } catch (_) { /* noop */ }
      try {
        const pid = localStorage.getItem(PLAN_KEY);
        if (loaded && pid && histRead().some((x) => x.id === pid)) planId = pid;
      } catch (_) { /* noop */ }
    }
    if (!loaded) { load(SAMPLE); state.sample = true; }
    const im = !readonly && location.hash.match(/[#&]import=([A-Za-z0-9_-]+)/);
    if (im) {
      try { importPlan(JSON.parse(b64decode(im[1]))); }
      catch (e) { toast("Koʻchirish havolasini oʻqib boʻlmadi.", "warn"); }
      try { history.replaceState(null, "", location.pathname + location.search); } catch (_) { /* noop */ }
    }
    bindOptions();
    renderAll();
    fitAll();
    if (state.start && state.stops.length) solve();
    renderSync();
    if (Sync.signedIn() && !readonly) syncNow();
  }

  boot();
})();

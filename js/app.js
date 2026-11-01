/* Yoʻlnoma — asosiy ilova mantigʻi. */
(function () {
  "use strict";

  const { Geo, TSP, API, Place, L } = window;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = Place.esc;
  const CONFIG = window.YOLNOMA_CONFIG || {};
  const STORE_KEY = "yolnoma.trip.v1";

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
  };
  let result = null;          // hisoblangan marshrut
  let pickMode = null;        // "start" | "stop" | null
  const details = new Map();  // id -> {info, weather, wiki, nearby:{radius:data}}

  function place(p) {
    return {
      id: p.id || newId(),
      name: p.name || "Nomaʼlum joy",
      address: p.address || "",
      lat: Number(p.lat), lon: Number(p.lon),
      category: p.category || "", type: p.type || "", addresstype: p.addresstype || "",
      region: p.region || "", district: p.district || "", city: p.city || "",
    };
  }

  function serialize() {
    const slim = (p) => p && ({ name: p.name, address: p.address, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6),
      category: p.category, type: p.type, region: p.region });
    return {
      start: slim(state.start), stops: state.stops.map(slim), metric: state.metric, roundTrip: state.roundTrip,
      depart: state.depart, stay: state.stay, fuelRate: state.fuelRate, fuelPrice: state.fuelPrice, sample: state.sample,
    };
  }

  function load(data) {
    state.start = data.start ? place(data.start) : null;
    state.stops = (data.stops || []).filter((s) => Geo.validLatLon(+s.lat, +s.lon)).map(place);
    for (const k of ["metric", "roundTrip", "depart", "stay", "fuelRate", "fuelPrice", "sample"]) {
      if (data[k] !== undefined) state[k] = data[k];
    }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); } catch (_) { /* noop */ }
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

  const map = L.map("map", { zoomControl: false, preferCanvas: false }).setView([41.2, 64.6], 6);
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
        .bindTooltip((solved ? visit + "-manzil: " : "") + esc(s.name), { direction: "top", offset: [0, -36] })
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
      '<button class="icon-btn" type="button" data-act="remove" title="Oʻchirish"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      "</div></div>";
    $('[data-act="info"]', el).onclick = () => openDrawer(s.id);
    $('[data-act="remove"]', el).onclick = () => { state.start = null; changed(); };
  }

  function renderStops() {
    const list = $("#stop-list");
    const solved = result && !result.stale;
    $("#stop-count").textContent = state.stops.length;
    $("#stops-empty").hidden = state.stops.length > 0;
    list.innerHTML = state.stops.map((s, i) => {
      const visit = solved ? result.order.indexOf(s.id) + 1 : 0;
      return '<li class="place-card" data-id="' + s.id + '">' +
        '<span class="badge ' + (solved ? "" : "pending") + '" title="' + (solved ? "Tashrif tartibi" : "Kiritilgan tartib") + '">' + (solved ? visit : i + 1) + "</span>" +
        '<div class="pc-text"><b>' + esc(s.name) + "</b><span>" + esc(s.address || Geo.fmtCoord(s.lat, s.lon)) + "</span></div>" +
        '<div class="pc-actions">' +
        '<button class="icon-btn" type="button" data-act="info" title="Joy haqida"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg></button>' +
        '<button class="icon-btn" type="button" data-act="remove" title="Oʻchirish"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        "</div></li>";
    }).join("");
  }

  $("#stop-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const id = li.dataset.id;
    if (btn && btn.dataset.act === "remove") {
      state.stops = state.stops.filter((s) => s.id !== id);
      changed();
    } else {
      openDrawer(id);
    }
  });

  function changed(opts) {
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

  function addStop(p, needsName) {
    const dup = state.stops.find((s) => Geo.haversine(s, p) < 30);
    if (dup) { toast("“" + dup.name + "” allaqachon roʻyxatda bor."); return false; }
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
          if (addStop(p, true)) added++;
        } else {
          const res = await API.search(lines[i]);
          if (res.length) { if (addStop(place(res[0]), false)) added++; } else failed.push(lines[i]);
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

  async function solve() {
    if (!state.start) { toast("Avval boshlangʻich nuqtani kiriting.", "warn"); $("#start-input").focus(); return; }
    if (!state.stops.length) { toast("Kamida bitta manzil qoʻshing.", "warn"); $("#stop-input").focus(); return; }
    if (state.stops.length > 60) { toast("Bir safarda koʻpi bilan 60 ta manzil hisoblanadi.", "warn"); return; }
    setPick(null);
    busy(true, "Yoʻl masofalari olinmoqda…");
    try {
      const pts = [state.start].concat(state.stops);
      const mx = await API.matrix(pts);
      const cost = state.metric === "duration" ? mx.durations : mx.distances;
      busy(true, "Eng qulay tartib hisoblanmoqda…");
      await new Promise((r) => setTimeout(r, 20));
      const sol = TSP.solve(cost, { roundTrip: state.roundTrip });
      const inputOrder = state.stops.map((_, i) => i + 1);
      const inputCost = TSP.pathCost(cost, inputOrder, state.roundTrip);
      const ordered = sol.order.map((k) => pts[k]);

      busy(true, "Marshrut chizilmoqda…");
      const routePts = [state.start].concat(ordered, state.roundTrip ? [state.start] : []);
      const rt = await API.route(routePts);

      const seq = [0].concat(sol.order, state.roundTrip ? [0] : []);
      let legs;
      if (rt && rt.legs.length === seq.length - 1) legs = rt.legs;
      else legs = seq.slice(1).map((to, i) => ({ distance: mx.distances[seq[i]][to], duration: mx.durations[seq[i]][to] }));

      // Kiritilgan tartib bilan solishtirish (ikkala o'lchovda)
      const inDist = TSP.pathCost(mx.distances, inputOrder, state.roundTrip);
      const inDur = TSP.pathCost(mx.durations, inputOrder, state.roundTrip);
      const optDistM = TSP.pathCost(mx.distances, sol.order, state.roundTrip);
      const optDurM = TSP.pathCost(mx.durations, sol.order, state.roundTrip);

      result = {
        order: sol.order.map((k) => pts[k].id),
        legs,
        geometry: rt ? rt.geometry : routePts.map((p) => [p.lat, p.lon]),
        distance: legs.reduce((s, l) => s + l.distance, 0),
        duration: legs.reduce((s, l) => s + l.duration, 0),
        compare: { inDist, inDur, optDist: optDistM, optDur: optDurM, inputCost, optCost: sol.cost },
        exact: sol.exact,
        source: mx.source,
        routeSource: rt ? "osrm" : "straight",
        roundTrip: state.roundTrip,
        metric: state.metric,
        stale: false,
      };
      renderAll();
      renderResult();
      drawRoute();
      fitAll();
      if (window.matchMedia("(max-width: 900px)").matches) $("#result").scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      console.error(e);
      toast("Hisoblashda xatolik: " + e.message, "warn");
    } finally {
      busy(false);
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

  function renderResult() {
    if (!result) return;
    renderResultState();
    const r = result;
    const liters = r.distance / 1000 * state.fuelRate / 100;
    const money = liters * state.fuelPrice;
    const stayTotal = r.order.length * state.stay * 60;

    $("#stats").innerHTML =
      stat("Jami masofa", Geo.fmtKm(r.distance)) +
      stat("Rulda", Geo.fmtDuration(r.duration)) +
      stat("Yoqilgʻi", (liters < 10 ? liters.toFixed(1) : Math.round(liters)) + " l", Geo.fmtSum(money)) +
      stat("Turishlar bilan", Geo.fmtDuration(r.duration + stayTotal), r.order.length + " × " + state.stay + " daq");

    const c = r.compare;
    const savedDist = c.inDist - c.optDist;
    const savedDur = c.inDur - c.optDur;
    let sv;
    if (r.order.length < 2) sv = "Bitta manzil — tartibni tanlash shart emas.";
    else if ((r.metric === "distance" ? savedDist : savedDur) > 1) {
      sv = "Siz kiritgan tartibga nisbatan <b>" + Geo.fmtKm(Math.max(0, savedDist)) + "</b> qisqa" +
        (savedDur > 60 ? " va <b>" + Geo.fmtDuration(savedDur) + "</b> tezroq" : "") + ".";
    } else sv = "Siz kiritgan tartib allaqachon eng qulayi ekan.";
    sv += r.exact ? " Barcha variantlar tekshirildi — bu eng optimal tartib." : " Koʻp manzil uchun yaqinlashtirilgan (evristik) yechim ishlatildi.";
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
      rows.push(itRow({ badge: String(i + 1), cls: "", name: s.name,
        sub: "Yetib borish " + clock(state.depart, t) + (state.stay ? " · ketish " + clock(state.depart, t + state.stay * 60) : ""),
        id: s.id, region: s.region }));
      t += state.stay * 60;
    });
    if (r.roundTrip && r.legs[r.order.length]) {
      const leg = r.legs[r.order.length];
      t += leg.duration;
      rows.push(legRow(leg));
      rows.push(itRow({ badge: "A", cls: "start", name: state.start.name + " (qaytish)", sub: "Yetib kelish " + clock(state.depart, t), id: state.start.id }));
    }
    $("#itinerary").innerHTML = rows.join("");

    // Eksport havolalari
    const seq = [state.start].concat(r.order.map(stopById).filter(Boolean), r.roundTrip ? [state.start] : []);
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
  }

  function stat(k, v, sub) {
    return '<div class="stat"><span>' + k + "</span><b>" + v + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>";
  }
  function itRow(o) {
    return '<li class="it-stop" data-id="' + o.id + '"><span class="badge ' + o.cls + '">' + o.badge + "</span>" +
      '<button type="button" class="it-main"><b>' + esc(o.name) + "</b><span>" + o.sub + "</span></button></li>";
  }
  function legRow(leg) {
    return '<li class="it-leg"><span class="leg-line"></span><span>' + Geo.fmtKm(leg.distance) + " · " + Geo.fmtDuration(leg.duration) + "</span></li>";
  }

  $("#itinerary").addEventListener("click", (e) => {
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
      lines.push((i + 1) + ". " + s.name + (s.address ? " (" + s.address + ")" : "") + " — " + s.lat.toFixed(5) + ", " + s.lon.toFixed(5));
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
    const url = location.href.split("#")[0] + "#trip=" + b64encode(JSON.stringify(serialize()));
    copyText(url, "Safar havolasi nusxalandi — uni doʻstingizga yuboring.");
  };

  $("#btn-clear").onclick = () => clearAll();
  $("#btn-sample-clear").onclick = () => clearAll();
  function clearAll() {
    state.start = null; state.stops = []; state.sample = false; result = null;
    details.clear(); routeLayer.clearLayers(); poiLayer.clearLayers();
    closeDrawer();
    save(); renderAll();
    map.setView([41.2, 64.6], 6);
    $("#start-input").focus();
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
    const links = [
      ["Google Maps (yoʻldosh)", "https://www.google.com/maps/@?api=1&map_action=map&center=" + p.lat + "%2C" + p.lon + "&zoom=18&basemap=satellite"],
      ["Google Earth 3D", "https://earth.google.com/web/@" + p.lat + "," + p.lon + ",0a,700d,35y,0h,60t,0r"],
      ["Google Street View", "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=" + p.lat + "%2C" + p.lon],
      ["Yandex Karta (yoʻldosh)", "https://" + yDomain + "/maps/?ll=" + p.lon + "%2C" + p.lat + "&z=17&l=sat&pt=" + p.lon + "%2C" + p.lat],
      ["Yandex panoramasi", "https://" + yDomain + "/maps/?ll=" + p.lon + "%2C" + p.lat + "&z=17&panorama%5Bpoint%5D=" + p.lon + "%2C" + p.lat],
      ["Bu yerga yoʻl (Google)", "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + p.lat + "%2C" + p.lon],
    ];
    $("#ext-links").innerHTML = links.map(([t, u]) => '<a href="' + u + '" target="_blank" rel="noopener">' + t +
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

  /* ---------------- Boshlash ---------------- */

  function boot() {
    let loaded = false;
    const m = location.hash.match(/trip=([A-Za-z0-9_-]+)/);
    if (m) {
      try { load(JSON.parse(b64decode(m[1]))); state.sample = false; loaded = true; save(); history.replaceState(null, "", location.pathname + location.search); }
      catch (e) { toast("Havoladagi safar maʼlumotini oʻqib boʻlmadi."); }
    }
    if (!loaded) {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) { load(JSON.parse(raw)); loaded = true; }
      } catch (_) { /* noop */ }
    }
    if (!loaded) { load(SAMPLE); state.sample = true; }
    bindOptions();
    renderAll();
    fitAll();
    if (state.start && state.stops.length) solve();
  }

  boot();
})();

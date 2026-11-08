/*
 * Navigatsiya (Yandex Navigator uslubida kuzatish): OSRM "steps" dan burilish koʻrsatmalari,
 * GPS nuqtasini marshrutga "yopishtirish" (snap), keyingi burilishgacha masofa, yoʻnalish va tezlik.
 * Interfeyssiz — Node'da sinash mumkin.
 */
(function (global) {
  "use strict";

  function distM(lat1, lon1, lat2, lon2) {
    const R = 6371008.8, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** a dan b ga yoʻnalish, gradus (0 = shimol, soat strelkasi boʻyicha). */
  function bearing(a, b) {
    const r = Math.PI / 180;
    const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  /* ---------- Koʻrsatma matni va belgisi ---------- */

  const TURN = {
    "uturn": ["Orqaga buriling", 180],
    "sharp right": ["Keskin oʻngga buriling", 135],
    "right": ["Oʻngga buriling", 90],
    "slight right": ["Biroz oʻngga buriling", 45],
    "straight": ["Toʻgʻri davom eting", 0],
    "slight left": ["Biroz chapga buriling", -45],
    "left": ["Chapga buriling", -90],
    "sharp left": ["Keskin chapga buriling", -135],
  };
  const lower1 = (t) => t.charAt(0).toLowerCase() + t.slice(1);

  /**
   * OSRM burilish → {title, icon: {kind: "arrow"|"round"|"flag", angle}}.
   * `street` alohida (step.name) beriladi.
   */
  function describe(type, modifier, exit) {
    const mod = TURN[modifier] ? modifier : "straight";
    const t = TURN[mod];
    switch (type) {
      case "depart": return { title: "Yoʻlga chiqing", icon: { kind: "arrow", angle: 0 } };
      case "arrive": {
        const side = modifier === "left" ? " (yoʻlning chap tomonida)" : modifier === "right" ? " (yoʻlning oʻng tomonida)" : "";
        return { title: "Manzilga yetdingiz" + side, icon: { kind: "flag", angle: 0 } };
      }
      case "roundabout": case "rotary":
        return { title: exit ? "Aylanada " + exit + "-chiqishdan chiqing" : "Aylanaga kiring", icon: { kind: "round", angle: t[1], exit: exit || 0 } };
      case "exit roundabout": case "exit rotary":
        return { title: "Aylanadan chiqing", icon: { kind: "round", angle: t[1], exit: 0 } };
      case "merge":
        return { title: modifier === "left" || modifier === "slight left" ? "Chap tomondagi yoʻlga qoʻshiling" : modifier === "right" || modifier === "slight right" ? "Oʻng tomondagi yoʻlga qoʻshiling" : "Yoʻlga qoʻshiling", icon: { kind: "arrow", angle: t[1] / 2 } };
      case "on ramp":
        return { title: "Yoʻlga chiqing: " + lower1(t[0]), icon: { kind: "arrow", angle: t[1] } };
      case "off ramp":
        return { title: modifier === "left" || modifier === "slight left" ? "Chapdagi chiqishga buriling" : modifier === "right" || modifier === "slight right" ? "Oʻngdagi chiqishga buriling" : "Chiqishga buriling", icon: { kind: "arrow", angle: t[1] } };
      case "fork":
        return { title: modifier === "left" || modifier === "slight left" ? "Yoʻl ajralishida chapga yuring" : modifier === "right" || modifier === "slight right" ? "Yoʻl ajralishida oʻngga yuring" : "Yoʻl ajralishida toʻgʻri yuring", icon: { kind: "arrow", angle: t[1] } };
      case "end of road":
        return { title: "Yoʻl oxirida " + lower1(t[0]), icon: { kind: "arrow", angle: t[1] } };
      case "new name": case "continue":
        return mod === "straight" ? { title: "Toʻgʻri davom eting", icon: { kind: "arrow", angle: 0 } } : { title: t[0], icon: { kind: "arrow", angle: t[1] } };
      case "notification":
        return { title: t[0], icon: { kind: "arrow", angle: t[1] } };
      default: // turn, roundabout turn, …
        return { title: t[0], icon: { kind: "arrow", angle: t[1] } };
    }
  }

  /* ---------- Yoʻl yoʻnalishini tahlil qilish ---------- */

  /**
   * API.route(..., {steps:true}) natijasidan koʻrsatmalar roʻyxati.
   * Oraliq nuqtalardagi (via/manzil) "arrive/depart" tashlab ketiladi, oxirgi "arrive" qoladi.
   * @param route {geometry:[[lat,lon]], legs:[{distance, duration, steps:[…]}]}
   */
  function parseGuide(route) {
    const g = route && route.geometry;
    if (!g || g.length < 2) return null;
    const cum = new Float64Array(g.length);
    for (let i = 1; i < g.length; i++) cum[i] = cum[i - 1] + distM(g[i - 1][0], g[i - 1][1], g[i][0], g[i][1]);
    const total = cum[g.length - 1];
    const raw = [];
    const legs = route.legs || [];
    legs.forEach((leg, li) => {
      (leg.steps || []).forEach((st) => {
        const m = st && st.maneuver;
        if (!m || !Array.isArray(m.location)) return;
        const last = li === legs.length - 1;
        if (m.type === "arrive" && !last) return;
        if (m.type === "depart" && li > 0) return;
        raw.push({ m, name: String(st.name || "").trim(), distance: Number(st.distance) || 0 });
      });
    });
    const steps = [];
    let from = 0;
    for (const r of raw) {
      const lat = r.m.location[1], lon = r.m.location[0];
      let best = from, bd = Infinity;
      // maneuver joyi chiziq uchlaridan biriga toʻgʻri keladi; oldinga qarab izlaymiz
      for (let i = from; i < g.length; i++) {
        const d = distM(g[i][0], g[i][1], lat, lon);
        if (d < bd) { bd = d; best = i; if (d < 1) break; }
      }
      from = best;
      const d = describe(r.m.type, r.m.modifier, r.m.exit);
      steps.push({ along: cum[best], idx: best, type: r.m.type, modifier: r.m.modifier || "", name: r.name, title: d.title, icon: d.icon, lat, lon });
    }
    // "depart" ni olib tashlaymiz (boshida kerak emas), oxirgi "arrive" boʻlmasa qoʻshamiz
    const filtered = steps.filter((s, i) => !(s.type === "depart" && i === 0 && steps.length > 1));
    if (!filtered.length || filtered[filtered.length - 1].type !== "arrive") {
      const e = g[g.length - 1], d = describe("arrive", "");
      filtered.push({ along: total, idx: g.length - 1, type: "arrive", modifier: "", name: "", title: d.title, icon: d.icon, lat: e[0], lon: e[1] });
    }
    return { geometry: g, cum, total, steps: filtered };
  }

  /* ---------- GPS nuqtasini yoʻlga yopishtirish ---------- */

  /**
   * @param guide parseGuide() natijasi
   * @param pos {lat, lon}
   * @param hint oldingi eng yaqin uch indeksi (tezlashtirish uchun)
   * @param full true — butun chiziq boʻylab qidirish
   * @returns {idx, along, off, lat, lon} along — yoʻl boshidan masofa (m), off — chiziqdan chetlik (m)
   */
  function snap(guide, pos, hint, full) {
    const g = guide.geometry, cum = guide.cum;
    const n = g.length;
    const kx = Math.cos(pos.lat * Math.PI / 180) * 111320, ky = 110574;
    let a = 0, b = n - 2;
    if (!full && hint !== undefined && hint !== null) { a = Math.max(0, hint - 40); b = Math.min(n - 2, hint + 500); }
    let bestOff = Infinity, bestI = a, bestU = 0;
    for (let i = a; i <= b; i++) {
      const x1 = (g[i][1] - pos.lon) * kx, y1 = (g[i][0] - pos.lat) * ky;
      const x2 = (g[i + 1][1] - pos.lon) * kx, y2 = (g[i + 1][0] - pos.lat) * ky;
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
      let u = L2 > 0 ? -(x1 * dx + y1 * dy) / L2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const off = Math.hypot(x1 + u * dx, y1 + u * dy);
      if (off < bestOff) { bestOff = off; bestI = i; bestU = u; }
    }
    const segLen = cum[bestI + 1] - cum[bestI];
    return {
      idx: bestI, along: cum[bestI] + bestU * segLen, off: bestOff,
      lat: g[bestI][0] + (g[bestI + 1][0] - g[bestI][0]) * bestU, lon: g[bestI][1] + (g[bestI + 1][1] - g[bestI][1]) * bestU,
    };
  }

  /** Keyingi burilish: hozirgi `along` dan oldinda boʻlgan birinchi koʻrsatma. */
  function nextStep(guide, along, fromIdx) {
    const st = guide.steps;
    for (let i = Math.max(0, fromIdx || 0); i < st.length; i++) {
      if (st[i].along - along > -12 || i === st.length - 1) return i;
    }
    return st.length - 1;
  }

  /** Chiziqning `along` dan keyingi qismi (chizish uchun), nuqtalari siyraklashtirilgan. */
  function remainingPath(guide, snapPt, maxPts) {
    const g = guide.geometry, out = [[snapPt.lat, snapPt.lon]];
    const start = snapPt.idx + 1, len = g.length - start;
    if (len <= 0) { out.push(g[g.length - 1]); return out; }
    const near = Math.min(len, 150);                       // yaqin qismi aniq
    for (let i = 0; i < near; i++) out.push(g[start + i]);
    const rest = len - near, budget = Math.max(50, (maxPts || 700) - near);
    const stride = Math.max(1, Math.ceil(rest / budget));
    for (let i = near; i < len; i += stride) out.push(g[start + i]);
    out.push(g[g.length - 1]);
    return out;
  }

  /** Tezlik (km/soat): GPS tezligi boʻlsa shuni, yoʻqsa oldingi nuqtadan. */
  function speedKmh(fix, prev) {
    if (fix && Number.isFinite(fix.speed) && fix.speed >= 0) return fix.speed * 3.6;
    if (fix && prev && fix.t > prev.t) {
      const d = distM(fix.lat, fix.lon, prev.lat, prev.lon), dt = (fix.t - prev.t) / 1000;
      if (dt > 0 && dt < 30) return Math.min(d / dt * 3.6, 250);   // GPS sakrashi (teleport) tezlik sifatida koʻrsatilmasin
    }
    return 0;
  }

  /** Yoʻnalish: qurilma yoʻnalishi (harakatda), yoʻqsa oldingi nuqtadan (≥ 8 m siljigan boʻlsa). */
  function heading(fix, prev, last) {
    if (fix && Number.isFinite(fix.heading) && fix.heading >= 0 && (Number.isFinite(fix.speed) ? fix.speed > 1 : true)) return fix.heading;
    if (prev && distM(fix.lat, fix.lon, prev.lat, prev.lon) >= 8) return bearing(prev, fix);
    return last === undefined ? null : last;
  }

  /** Tezlikka qarab xarita masshtabi. */
  function zoomFor(kmh) {
    if (kmh >= 90) return 13;
    if (kmh >= 60) return 14;
    if (kmh >= 30) return 15;
    return 16;
  }

  /** Masofa matni: 1,2 km / 350 m (50 m ga yaxlitlanadi). */
  function fmtDist(m) {
    if (m >= 10000) return Math.round(m / 1000) + " km";
    if (m >= 1000) return (Math.round(m / 100) / 10).toString().replace(".", ",") + " km";
    if (m >= 100) return Math.round(m / 50) * 50 + " m";
    return Math.max(0, Math.round(m / 10) * 10) + " m";
  }

  global.Nav = { describe, parseGuide, snap, nextStep, remainingPath, speedKmh, heading, zoomFor, fmtDist, bearing, distM };
  if (typeof module !== "undefined") module.exports = global.Nav;
})(typeof window !== "undefined" ? window : globalThis);

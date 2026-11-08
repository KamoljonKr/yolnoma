/*
 * "Safarni boshlash" — jonli rejim mantigʻi (interfeyssiz, sinash oson).
 *
 *  - marshrut chizigʻi boʻylab qolgan masofani topish (legBounds, legProgress)
 *  - holat mashinasi: yoʻlda → manzilda (ish) → keyingi manzil → … → yakun
 *  - qolgan vaqtni Report.schedule(resume) bilan qayta hisoblash (project)
 *
 * Vaqt: Live.now() (sinash uchun almashtiriladi).
 */
(function (global) {
  "use strict";

  const Report = global.Report || (typeof require !== "undefined" ? require("./report.js") : null);
  const ARRIVE_RADIUS_M = 150;   // shu masofaga yaqinlashsak "yetib keldik"
  const MAX_FIX_ACC_M = 300;     // aniqligi bundan yomon GPS nuqtasi yetib kelishni aniqlamaydi
  const OFF_ROUTE_M = 1500;      // chiziqdan shuncha uzoq boʻlsak — marshrutdan chetdamiz

  function distM(lat1, lon1, lat2, lon2) {
    const R = 6371008.8, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* ---------- Marshrut chizigʻi boʻylab ---------- */

  /**
   * Har bir nuqtaga (boshlanish, manzillar…, qaytish) eng yaqin chiziq uchi indeksi; indekslar kamaymaydi.
   * @param {number[][]} geometry [[lat, lon], …]
   * @param {{lat:number, lon:number}[]} points tashrif tartibida
   */
  function legBounds(geometry, points) {
    const out = [];
    let from = 0;
    for (let k = 0; k < points.length; k++) {
      if (k === 0) { out.push(0); continue; }
      let best = from, bd = Infinity;
      for (let i = from; i < geometry.length; i++) {
        const d = distM(geometry[i][0], geometry[i][1], points[k].lat, points[k].lon);
        if (d < bd) { bd = d; best = i; }
      }
      out.push(best); from = best;
    }
    return out;
  }

  /** Yoʻl qismi (legIdx) boʻyicha: chiziqdan masofa, qolgan va jami uzunlik (metr). */
  function legProgress(geometry, bounds, legIdx, pos) {
    const a = bounds[legIdx], b = Math.max(a, bounds[legIdx + 1] === undefined ? geometry.length - 1 : bounds[legIdx + 1]);
    if (b <= a) return { offM: distM(pos.lat, pos.lon, geometry[a][0], geometry[a][1]), remainM: 0, totalM: 0 };
    const kx = Math.cos(pos.lat * Math.PI / 180) * 111320, ky = 110574;
    const xy = (p) => [(p[1] - pos.lon) * kx, (p[0] - pos.lat) * ky];
    const segLen = [];
    let total = 0;
    for (let i = a; i < b; i++) { const l = distM(geometry[i][0], geometry[i][1], geometry[i + 1][0], geometry[i + 1][1]); segLen.push(l); total += l; }
    let bestOff = Infinity, bestAlong = 0, run = 0;
    for (let i = a; i < b; i++) {
      const [x1, y1] = xy(geometry[i]), [x2, y2] = xy(geometry[i + 1]);
      const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
      let u = L2 > 0 ? -(x1 * dx + y1 * dy) / L2 : 0;
      u = Math.max(0, Math.min(1, u));
      const px = x1 + u * dx, py = y1 + u * dy, off = Math.hypot(px, py);
      if (off < bestOff) { bestOff = off; bestAlong = run + u * segLen[i - a]; }
      run += segLen[i - a];
    }
    return { offM: bestOff, remainM: Math.max(0, total - bestAlong), totalM: total };
  }

  /**
   * Qolgan yoʻl ulushi (reja boʻyicha yoʻl qismiga nisbatan) va masofa.
   * Marshrutda boʻlsak — chiziq boʻylab; chetga chiqsak — toʻgʻri chiziq × 1,3.
   */
  function remaining(geometry, bounds, legIdx, pos, target, plannedLegM) {
    const straight = distM(pos.lat, pos.lon, target.lat, target.lon);
    if (geometry && geometry.length > 1 && bounds) {
      const pr = legProgress(geometry, bounds, legIdx, pos);
      if (pr.totalM > 0 && pr.offM <= OFF_ROUTE_M) {
        const frac = Math.min(1, pr.remainM / pr.totalM);
        // Koʻrsatiladigan masofa reja boʻyicha yoʻl uzunligiga mos (OSRM'da ikkalasi deyarli bir xil)
        return { meters: plannedLegM > 0 ? frac * plannedLegM : pr.remainM, frac, offRoute: false, offM: pr.offM, straightM: straight };
      }
      const est = straight * 1.3;
      return { meters: est, frac: plannedLegM > 0 ? est / plannedLegM : 1, offRoute: pr.offM > OFF_ROUTE_M, offM: pr.offM, straightM: straight };
    }
    const est = straight * 1.3;
    return { meters: est, frac: plannedLegM > 0 ? Math.min(2, est / plannedLegM) : 1, offRoute: false, offM: 0, straightM: straight };
  }

  /* ---------- Holat mashinasi ---------- */

  /** n — manzillar soni. idx: 0..n-1 manzil, n — qaytish (agar roundTrip). */
  function create(nowMs) {
    return { idx: 0, phase: "drive", startedAt: nowMs, arrivedAt: null, workDoneAt: [], arrivals: [], near: 0, finished: false };
  }

  function targetOf(state, start, stops, roundTrip) {
    if (state.idx < stops.length) return { lat: stops[state.idx].lat, lon: stops[state.idx].lon, name: stops[state.idx].name, n: state.idx + 1, isReturn: false };
    if (roundTrip && state.idx === stops.length) return { lat: start.lat, lon: start.lon, name: start.name, n: 0, isReturn: true };
    return null;
  }

  /** GPS nuqtasi keldi. true — "yetib keldik" avtomatik aniqlandi. */
  function onFix(state, fix, target) {
    if (state.finished || state.phase !== "drive" || !target) return false;
    const acc = Number(fix.acc) || 0;
    if (acc > MAX_FIX_ACC_M) return false;
    const d = distM(fix.lat, fix.lon, target.lat, target.lon);
    if (d <= Math.max(ARRIVE_RADIUS_M, acc)) state.near++; else state.near = 0;
    return state.near >= 2;
  }

  function arrive(state, nowMs, stopsCount, roundTrip) {
    if (state.finished || state.phase !== "drive") return state;
    state.arrivals[state.idx] = nowMs;
    state.near = 0;
    if (state.idx >= stopsCount) { state.finished = true; state.phase = "done"; state.arrivedAt = nowMs; return state; }
    state.phase = "work"; state.arrivedAt = nowMs;
    return state;
  }

  function finishWork(state, nowMs, stopsCount, roundTrip) {
    if (state.finished || state.phase !== "work") return state;
    state.workDoneAt[state.idx] = nowMs;
    state.idx++; state.phase = "drive"; state.arrivedAt = null; state.near = 0;
    if (state.idx > stopsCount || (state.idx === stopsCount && !roundTrip)) { state.finished = true; state.phase = "done"; }
    return state;
  }

  /* ---------- Vaqt hisobi ---------- */

  const dateStart = (P) => new Date(P.date.y, P.date.m - 1, P.date.d).getTime();
  const toMin = (ms, P) => (ms - dateStart(P)) / 60000;
  const toMs = (min, P) => dateStart(P) + Math.round(min * 60000);

  /**
   * Qolgan safarni hozirgi holatdan qayta hisoblaydi.
   * @param ctx {start, stops, legs, roundTrip, geometry, cities, params:P}
   * @param opts {state, nowMs, frac}
   */
  function project(ctx, opts) {
    const st = opts.state, P = ctx.params;
    const nowMin = toMin(opts.nowMs, P);
    let resume;
    if (st.phase === "work") resume = { index: st.idx, t: toMin(st.arrivedAt, P), frac: 0, fromName: ctx.stops[st.idx] ? ctx.stops[st.idx].name : undefined };
    else resume = { index: st.idx, t: nowMin, frac: opts.frac === undefined ? 1 : opts.frac, fromName: opts.fromName || "Hozirgi joy" };
    // Haydash vaqti allaqachon oʻtgan boʻlsa-yu, hozir yoʻlda boʻlsak — bugun yoʻl davom etadi deb olamiz
    if (st.phase === "drive") {
      const dayMin = nowMin - Math.floor(nowMin / 1440) * 1440;
      if (dayMin >= P.driveLimit) resume.firstDayLimit = 1439;
    }
    return Report.schedule({ start: ctx.start, stops: ctx.stops, legs: ctx.legs, roundTrip: ctx.roundTrip, geometry: ctx.geometry, cities: ctx.cities, params: P, resume });
  }

  global.Live = {
    now: () => Date.now(),
    ARRIVE_RADIUS_M, MAX_FIX_ACC_M, OFF_ROUTE_M,
    distM, legBounds, legProgress, remaining, create, targetOf, onFix, arrive, finishWork, project, toMin, toMs,
  };
  if (typeof module !== "undefined") module.exports = global.Live;
})(typeof window !== "undefined" ? window : globalThis);

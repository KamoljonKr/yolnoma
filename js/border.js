/*
 * Marshrut O'zbekiston ichida qolishini taʼminlash.
 *
 * Muammo: OSRM davlat chegarasini bilmaydi. Tojikiston, Qirgʻiziston, Qozogʻiston yoki Turkmaniston
 * yoʻli qisqaroq boʻlsa, marshrutni oʻsha yerdan chizadi (masalan, Toshkentdan Surxondaryoga Dushanbe orqali).
 * Ochiq OSRM serverida "faqat bitta davlat" degan sozlama yoʻq, shuning uchun biz tekshiramiz:
 *
 *  1. Marshrut chizigʻi O'zbekiston konturidan (uz-border.js) uzoqroq chiqsa, bu uchastka "chegara buzilishi".
 *  2. Buzilgan qirra taqiqlanadi. Boshqa juftliklar ham bitta-ikkita guruhli soʻrov bilan tekshiriladi
 *     (har bir manzilga Toshkentdan toʻgʻri yoʻl odatda bir xil chegarani kesadi).
 *  3. Taqiqlangan juftlik (A → B) uchun O'zbekiston ichidagi yirik shaharlar ("hub") orqali aylanma yoʻl
 *     hublarning siyrak grafida (har bir hub faqat yaqin qoʻshnilari bilan) eng qisqa yoʻl sifatida topiladi.
 *  4. Aylanma yoʻl narxi matritsaga yoziladi, tartib (TSP) qayta hisoblanadi va marshrut yana tekshiriladi.
 *     Chegarani kesgan qirra taqiqlanadi va shu yoʻl qayta qidiriladi — buzilish qolmaguncha (yoki urinishlar tugaguncha).
 *
 * Chegara buzilishi sifatida faqat EDGE_KM dan uzoq va MIN_EXC_KM dan uzun tashqi uchastka hisoblanadi.
 * Sabab: kontur ~1 km aniqlikda, Fargʻona vodiysida chegara juda murakkab (anklavlar), shuning uchun
 * chegara yaqinidagi qisqa "kirib chiqish"lar xato deb olinmaydi.
 */
(function (global) {
  "use strict";

  const EDGE_KM = 4;          // chegara chizigʻidan shuncha km tashqarida boʻlsa nuqta "tashqarida"
  const MIN_EXC_KM = 20;      // shundan uzun tashqi uchastka — chegara buzilishi
  const FOREIGN_KM = 8;       // nuqtaning oʻzi chegaradan shuncha km tashqarida boʻlsa, uni tekshiruvdan chiqaramiz
  const STEP_M = 2000;        // chiziqni tekshirish qadami
  const MAX_ITER = 8;         // TSP + marshrut tekshiruvi takrorlari
  const SCAN_MAX = 96;        // birinchi buzilishdan keyin guruhli tekshiriladigan juftliklar soni
  const NEIGHBORS = 4;        // hublar grafida har bir tugun nechta yaqin qoʻshni bilan bogʻlanadi
  const BUDGET_MS = 150000;   // butun reja uchun vaqt chegarasi

  /** O'zbekiston ichidagi tayanch shaharlar (aylanma yoʻl uchun oraliq nuqtalar). */
  const HUBS = [
    { name: "Toshkent", lat: 41.311, lon: 69.279 },
    { name: "Chirchiq", lat: 41.469, lon: 69.582 },
    { name: "Guliston", lat: 40.489, lon: 68.784 },
    { name: "Jizzax", lat: 40.116, lon: 67.842 },
    { name: "Zomin", lat: 39.96, lon: 68.4 },
    { name: "Samarqand", lat: 39.654, lon: 66.976 },
    { name: "Kattaqoʻrgʻon", lat: 39.898, lon: 66.264 },
    { name: "Shahrisabz", lat: 39.058, lon: 66.834 },
    { name: "Qarshi", lat: 38.861, lon: 65.789 },
    { name: "Guzor", lat: 38.621, lon: 66.249 },
    { name: "Boysun", lat: 38.208, lon: 67.203 },
    { name: "Denov", lat: 38.277, lon: 67.898 },
    { name: "Sherobod", lat: 37.667, lon: 66.987 },
    { name: "Termiz", lat: 37.224, lon: 67.278 },
    { name: "Buxoro", lat: 39.768, lon: 64.421 },
    { name: "Navoiy", lat: 40.084, lon: 65.379 },
    { name: "Nurota", lat: 40.56, lon: 65.69 },
    { name: "Gʻazli", lat: 40.133, lon: 63.447 },
    { name: "Uchquduq", lat: 42.157, lon: 63.0 },
    { name: "Nukus", lat: 42.46, lon: 59.61 },
    { name: "Urganch", lat: 41.55, lon: 60.63 },
    { name: "Beruniy", lat: 41.69, lon: 60.75 },
    { name: "Angren", lat: 41.016, lon: 70.143 },
    { name: "Pop", lat: 40.873, lon: 71.109 },
    { name: "Qoʻqon", lat: 40.529, lon: 70.943 },
    { name: "Fargʻona", lat: 40.384, lon: 71.784 },
    { name: "Andijon", lat: 40.783, lon: 72.344 },
    { name: "Namangan", lat: 41.0, lon: 71.672 },
    { name: "Bekobod", lat: 40.22, lon: 69.27 },
  ];

  const RINGS = global.UZ_BORDER || [];

  /* ---------- Geometriya: nuqta O'zbekiston ichidami, chegaragacha masofa ---------- */

  function insideRing(ring, lat, lon) {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }

  function inside(lat, lon) {
    for (const ring of RINGS) if (insideRing(ring, lat, lon)) return true;
    return false;
  }

  /** Nuqtadan chegara chizigʻigacha masofa (km), planar yaqinlashuvda. */
  function borderDistKm(lat, lon) {
    const kx = Math.cos((lat * Math.PI) / 180) * 111.32, ky = 110.57;
    let best = Infinity;
    for (const ring of RINGS) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = (ring[j][0] - lon) * kx, ay = (ring[j][1] - lat) * ky;
        const bx = (ring[i][0] - lon) * kx, by = (ring[i][1] - lat) * ky;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        let t = l2 ? -(ax * dx + ay * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < best) best = d;
      }
    }
    return best;
  }

  /** O'zbekistondan tashqarida boʻlsa, chegaragacha km; ichkarida 0. */
  function outsideKm(lat, lon) {
    return inside(lat, lon) ? 0 : borderDistKm(lat, lon);
  }

  function distM(lat1, lon1, lat2, lon2) {
    const R = 6371008.8, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /**
   * Chiziq (geometriya [[lat, lon], ...]) O'zbekistondan tashqariga chiqqan uzun uchastkalarini topadi.
   * @returns {{list: {from:number,to:number,len:number}[], total:number}} masofalar metrda (chiziq boʻylab)
   */
  function excursions(geometry) {
    const list = [];
    let run = null, s = 0;
    const MIN_M = MIN_EXC_KM * 1000;
    const close = () => {
      run.len = run.to - run.from + STEP_M;
      if (run.len >= MIN_M) list.push(run);
      run = null;
    };
    const test = (lat, lon, at) => {
      if (outsideKm(lat, lon) > EDGE_KM) {
        if (!run) run = { from: at, to: at, len: 0 };
        else run.to = at;
      } else if (run) close();
    };
    for (let i = 0; i < geometry.length; i++) {
      const cur = geometry[i];
      if (i === 0) { test(cur[0], cur[1], 0); continue; }
      const prev = geometry[i - 1];
      const seg = distM(prev[0], prev[1], cur[0], cur[1]);
      const k = Math.max(1, Math.ceil(seg / STEP_M));
      for (let q = 1; q <= k; q++) {
        const f = q / k;
        test(prev[0] + (cur[0] - prev[0]) * f, prev[1] + (cur[1] - prev[1]) * f, s + seg * f);
      }
      s += seg;
    }
    if (run) close();
    return { list, total: s };
  }

  /** Marshrutning qaysi bo'laklari (leg) chegaradan chiqqanini qaytaradi (leg indekslari toʻplami). */
  function flaggedLegs(rt) {
    const bad = new Set();
    const ex = excursions(rt.geometry);
    if (!ex.list.length) return bad;
    const scale = ex.total > 0 ? rt.distance / ex.total : 1;
    const bounds = [];
    let acc = 0;
    for (const l of rt.legs) { acc += l.distance; bounds.push(acc); }
    for (const e of ex.list) {
      const from = e.from * scale, to = e.to * scale, mid = (from + to) / 2;
      let start = 0;
      for (let i = 0; i < bounds.length; i++) {
        const end = bounds[i];
        const overlap = Math.min(to, end) - Math.max(from, start);
        if ((mid >= start && mid <= end) || overlap >= 8000) bad.add(i);
        start = end;
      }
    }
    return bad;
  }

  /* ---------- Reja: tartib + chegaradan oʻtmaydigan marshrut ---------- */

  /**
   * @param {object} o
   *  pts       — [boshlanish, ...manzillar] ({lat, lon})
   *  mx        — pts uchun OSRM matritsasi {distances, durations}
   *  metric    — "distance" | "duration"
   *  roundTrip — oxirida boshlangʻich nuqtaga qaytish
   *  route     — async (points, {overview}) => {geometry, legs, distance, duration} | null
   *  matrix    — async (points) => {distances, durations, source}
   *  tsp       — {solve(cost, {roundTrip, pins})}
   *  pins      — qoʻlda belgilangan oʻrinlar {manzilIndeksi: oʻrin} (ixtiyoriy)
   *  progress  — (matn) => void
   */
  async function plan(o) {
    const pts = o.pts, n1 = pts.length, useDur = o.metric === "duration";
    const roundTrip = !!o.roundTrip, tsp = o.tsp, routeFn = o.route, matrixFn = o.matrix;
    const progress = o.progress || function () {};
    const deadline = Date.now() + (o.budgetMs || BUDGET_MS);

    const adjD = o.mx.distances.map((r) => r.slice());
    const adjT = o.mx.durations.map((r) => r.slice());
    const baseD = o.mx.distances, baseT = o.mx.durations;
    const foreign = pts.map((p) => outsideKm(p.lat, p.lon) > FOREIGN_KM);
    const nodePt = (k) => (k < n1 ? pts[k] : HUBS[k - n1]);
    const pairKey = (a, b) => a + ">" + b;

    const detours = new Map();   // "a>b" -> {nodes, dist, dur}
    const stuck = new Set();     // aylanma yoʻl topilmagan juftliklar
    const banned = new Set();    // chegarani kesadigan qirralar (tugun indekslari)
    const verified = new Set();  // chegarani kesmasligi tekshirilgan qirralar
    let hubMx;                   // pts + HUBS matritsasi (kerak boʻlganda yuklanadi)

    const ban = (x, y) => { banned.add(pairKey(x, y)); banned.add(pairKey(y, x)); };

    async function loadHubMatrix() {
      if (hubMx !== undefined) return hubMx;
      progress("Chegara yaqinidagi yoʻllar tekshirilmoqda…");
      try {
        const m = await matrixFn(pts.concat(HUBS));
        hubMx = m && m.source === "osrm" ? m : null;
      } catch (e) {
        console.warn("Hub matritsasi olinmadi:", e);
        hubMx = null;
      }
      return hubMx;
    }

    const edgeCost = (x, y) => (useDur ? hubMx.durations[x][y] : hubMx.distances[x][y]);

    /**
     * a dan b gacha hublar orqali eng qisqa yoʻl (taqiqlangan qirralarsiz).
     * Graf siyrak: har bir tugun faqat eng yaqin K ta tugun bilan bogʻlanadi. Uzoq hublar orasidagi bevosita
     * qirralar deyarli doim chegarani kesadi (OSRM eng qisqasini tanlaydi), qisqa hoplar esa odatda ichki yoʻldan boradi.
     */
    function shortest(a, b, K) {
      const nodes = [a, b];
      for (let h = 0; h < HUBS.length; h++) nodes.push(n1 + h);
      const near = new Map();
      for (const u of nodes) {
        const cand = sortedHubs(u).slice(0, K);
        for (const v of [a, b]) if (v !== u) cand.push(v);
        cand.sort((x, y) => hubMx.distances[u][x] - hubMx.distances[u][y]);
        near.set(u, new Set(cand.slice(0, K)));
      }
      const dist = new Map(nodes.map((k) => [k, Infinity]));
      const prev = new Map();
      const done = new Set();
      dist.set(a, 0);
      for (;;) {
        let u = -1, ud = Infinity;
        for (const k of nodes) if (!done.has(k) && dist.get(k) < ud) { u = k; ud = dist.get(k); }
        if (u === -1 || u === b) break;
        done.add(u);
        for (const v of nodes) {
          if (done.has(v) || v === u || v === a) continue;
          if (banned.has(pairKey(u, v))) continue;
          if (!near.get(u).has(v) && !near.get(v).has(u)) continue;
          const w = edgeCost(u, v);
          if (!Number.isFinite(w)) continue;
          if (ud + w < dist.get(v)) { dist.set(v, ud + w); prev.set(v, u); }
        }
      }
      if (!Number.isFinite(dist.get(b))) return null;
      const path = [b];
      while (path[0] !== a) path.unshift(prev.get(path[0]));
      return path;
    }

    /** Tugundan hublargacha masofa boʻyicha tartiblangan roʻyxat (keshlanadi). */
    const hubOrder = new Map();
    function sortedHubs(u) {
      let arr = hubOrder.get(u);
      if (!arr) {
        arr = [];
        for (let h = 0; h < HUBS.length; h++) if (n1 + h !== u) arr.push(n1 + h);
        arr.sort((x, y) => hubMx.distances[u][x] - hubMx.distances[u][y]);
        hubOrder.set(u, arr);
      }
      return arr;
    }

    function findPath(a, b) {
      const total = HUBS.length + 2;
      for (let K = NEIGHBORS; ; K = Math.min(total, K * 2)) {
        const p = shortest(a, b, K);
        if (p) return p;
        if (K >= total) return null;
      }
    }

    function sumPath(path) {
      let dist = 0, dur = 0;
      for (let i = 1; i < path.length; i++) {
        dist += hubMx.distances[path[i - 1]][path[i]];
        dur += hubMx.durations[path[i - 1]][path[i]];
      }
      return { nodes: path, dist, dur };
    }

    /** Taqiqlangan bevosita qirrali (yoki yoʻli taqiqlangan qirradan oʻtadigan) juftliklar uchun aylanma yoʻlni qayta hisoblaydi. */
    function refreshAll() {
      let changed = false;
      for (let a = 0; a < n1; a++) {
        for (let b = 0; b < n1; b++) {
          if (a === b || foreign[a] || foreign[b]) continue;
          const key = pairKey(a, b);
          if (!banned.has(key) || stuck.has(key)) continue;
          const d = detours.get(key);
          if (d && !d.nodes.some((x, i) => i > 0 && banned.has(pairKey(d.nodes[i - 1], x)))) continue;
          const p = findPath(a, b);
          if (p) {
            const nd = sumPath(p);
            detours.set(key, nd); adjD[a][b] = nd.dist; adjT[a][b] = nd.dur;
          } else {
            stuck.add(key); detours.delete(key); adjD[a][b] = baseD[a][b]; adjT[a][b] = baseT[a][b];
          }
          changed = true;
        }
      }
      return changed;
    }

    /**
     * Bir nechta qirrani bitta soʻrovda tekshiradi: nuqtalar zanjiri [x1, y1, x2, y2, ...] — juft indeksli leg'lar
     * qirralarning oʻzi, toq indeksli leg'lar (y → keyingi x) esa e'tiborga olinmaydi.
     * @returns {Set<number>|null} chegarani kesgan qirralar indekslari (xizmat ishlamasa null)
     */
    async function checkEdges(edges) {
      const bad = new Set();
      const CH = 20;
      for (let from = 0; from < edges.length; from += CH) {
        if (Date.now() > deadline) return null;
        const chunk = edges.slice(from, from + CH);
        const wps = [];
        chunk.forEach((e) => { wps.push(nodePt(e[0]), nodePt(e[1])); });
        const r = await routeFn(wps, { overview: "simplified" });
        if (!r || r.legs.length !== wps.length - 1) return null;
        const flagged = flaggedLegs(r);
        chunk.forEach((_, e) => { if (flagged.has(2 * e)) bad.add(from + e); });
      }
      return bad;
    }

    /** Buzilgan legga tegishli manzillar (F) bilan bogʻliq boshqa juftliklarni ham oldindan tekshiradi. */
    async function scan(F) {
      const list = [];
      for (let u = 0; u < n1; u++) {
        for (let v = u + 1; v < n1; v++) {
          if (foreign[u] || foreign[v] || (!F.has(u) && !F.has(v))) continue;
          if (verified.has(pairKey(u, v)) || banned.has(pairKey(u, v))) continue;
          list.push({ u, v, d: distM(pts[u].lat, pts[u].lon, pts[v].lat, pts[v].lon) });
        }
      }
      list.sort((p, q) => q.d - p.d); // uzoq juftliklar chegarani kesish ehtimoli yuqoriroq
      const take = list.slice(0, SCAN_MAX);
      if (!take.length) return;
      const bad = await checkEdges(take.map((e) => [e.u, e.v]));
      if (!bad) return;
      take.forEach((e, i) => {
        if (bad.has(i)) ban(e.u, e.v);
        else { verified.add(pairKey(e.u, e.v)); verified.add(pairKey(e.v, e.u)); }
      });
    }

    function expand(seq) {
      const nodes = [seq[0]], legOf = [];
      for (let s = 1; s < seq.length; s++) {
        const d = detours.get(pairKey(seq[s - 1], seq[s]));
        const inner = d ? d.nodes : [seq[s - 1], seq[s]];
        for (let k = 1; k < inner.length; k++) { nodes.push(inner[k]); legOf.push(s - 1); }
      }
      return { nodes, legOf };
    }

    let last = null, scanned = false;
    for (let it = 0; it < MAX_ITER; it++) {
      const sol = tsp.solve(useDur ? adjT : adjD, { roundTrip, pins: o.pins });
      const seq = [0].concat(sol.order, roundTrip ? [0] : []);
      const { nodes, legOf } = expand(seq);
      progress(it === 0 ? "Marshrut chizilmoqda…" : "Marshrut chegara boʻyicha tekshirilmoqda…");
      const rt = await routeFn(nodes.map(nodePt), { overview: "full" });
      if (!rt || rt.legs.length !== nodes.length - 1) {
        last = { sol, seq, rt: null, legs: null, via: [], bad: new Map() };
        break;
      }

      const legs = seq.slice(1).map(() => ({ distance: 0, duration: 0 }));
      rt.legs.forEach((l, i) => { legs[legOf[i]].distance += l.distance; legs[legOf[i]].duration += l.duration; });
      const via = seq.slice(1).map((_, s) => {
        const d = detours.get(pairKey(seq[s], seq[s + 1]));
        return d ? d.nodes.slice(1, -1).map(nodePt) : [];
      });

      const flagged = flaggedLegs(rt);
      nodes.forEach((x, i) => { if (i > 0 && !flagged.has(i - 1)) verified.add(pairKey(nodes[i - 1], x)); });
      const bad = new Map(); // stop-leg indeksi -> shu leg dagi buzilgan qirralar
      for (const i of flagged) {
        const s = legOf[i];
        if (foreign[seq[s]] || foreign[seq[s + 1]]) continue;
        if (!bad.has(s)) bad.set(s, []);
        bad.get(s).push(i);
      }
      last = { sol, seq, rt, legs, via, bad };

      const fixable = [...bad.keys()].filter((s) => !stuck.has(pairKey(seq[s], seq[s + 1])));
      if (!fixable.length || Date.now() > deadline) break;
      if (!(await loadHubMatrix())) { fixable.forEach((s) => stuck.add(pairKey(seq[s], seq[s + 1]))); break; }

      const F = new Set();
      for (const s of fixable) {
        F.add(seq[s]); F.add(seq[s + 1]);
        for (const i of bad.get(s)) ban(nodes[i], nodes[i + 1]);
      }
      if (!scanned) {
        scanned = true;
        progress("Boshqa yoʻllar chegara boʻyicha tekshirilmoqda…");
        await scan(F);
      }
      progress("Chegaradan oʻtmaydigan yoʻl qidirilmoqda…");
      refreshAll();
    }

    const seq = last.seq;
    const unresolved = [];
    for (const s of last.bad.keys()) unresolved.push({ from: pts[seq[s]], to: pts[seq[s + 1]] });
    let detoured = 0;
    for (let s = 0; s < seq.length - 1; s++) if (detours.has(pairKey(seq[s], seq[s + 1]))) detoured++;

    return {
      sol: last.sol, seq, rt: last.rt, legs: last.legs, via: last.via,
      adjD, adjT, detoured, unresolved,
    };
  }

  global.Border = {
    HUBS, EDGE_KM, MIN_EXC_KM, inside, outsideKm, excursions, flaggedLegs, plan,
  };
  if (typeof module !== "undefined") module.exports = global.Border;
})(typeof window !== "undefined" ? window : globalThis);

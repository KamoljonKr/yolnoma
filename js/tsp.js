/*
 * Marshrut tartibini optimallashtirish (Kommivoyajer masalasi, TSP).
 * 0-tugun — boshlang'ich nuqta, 1..n — manzillar.
 * cost[i][j] — i dan j ga borish narxi (masofa yoki vaqt), assimetrik bo'lishi mumkin.
 *
 *  - n <= EXACT_LIMIT: Held–Karp dinamik dasturlash — kafolatlangan eng optimal tartib.
 *  - n  > EXACT_LIMIT: ko'p startli "eng yaqin qo'shni" + 2-opt + Or-opt evristikasi.
 *
 * Qo'lda belgilangan o'rinlar (pins): { manzilIndeksi (1..n): o'rin (1..n) }. Masalan { 8: 1 } —
 * 8-manzil albatta birinchi bo'lib boriladi, qolganlari shu cheklovda eng yaxshi tartibda joylashadi.
 */
(function (global) {
  "use strict";

  const EXACT_LIMIT = 15;

  function pathCost(cost, order, roundTrip) {
    let c = 0, prev = 0;
    for (const v of order) { c += cost[prev][v]; prev = v; }
    if (roundTrip) c += cost[prev][0];
    return c;
  }

  /**
   * pins -> fixedAt: fixedAt[p] = p-o'rindagi (0-dan) manzil indeksi (0..n-1) yoki -1 (erkin o'rin).
   * Chiqish: null (pin yo'q) yoki massiv. Noto'g'ri pin (diapazondan tashqari, bir o'rinda ikkita) — xato.
   */
  function normalizePins(pins, n) {
    const fixedAt = new Array(n).fill(-1);
    let any = false;
    for (const key of Object.keys(pins || {})) {
      const stop = Number(key), pos = Number(pins[key]);
      if (!Number.isInteger(stop) || stop < 1 || stop > n) throw new Error("Pin: manzil raqami noto'g'ri (" + key + ")");
      if (!Number.isInteger(pos) || pos < 1 || pos > n) throw new Error("Pin: o'rin 1 dan " + n + " gacha bo'lishi kerak");
      if (fixedAt[pos - 1] !== -1) throw new Error("Pin: " + pos + "-o'rin ikki manzilga belgilangan");
      fixedAt[pos - 1] = stop - 1;
      any = true;
    }
    return any ? fixedAt : null;
  }

  function heldKarp(cost, n, roundTrip, fixedAt) {
    const FULL = 1 << n;
    const dp = new Float64Array(FULL * n).fill(Infinity);
    const parent = new Int8Array(FULL * n).fill(-1);
    // pos-o'rinda j manzilga borish mumkinmi? (belgilangan o'rin faqat o'z manziliga, belgilangan manzil faqat o'z o'rniga)
    const pinnedStop = new Uint8Array(n);
    const pc = new Uint8Array(FULL);
    if (fixedAt) {
      fixedAt.forEach((j) => { if (j >= 0) pinnedStop[j] = 1; });
      for (let m = 1; m < FULL; m++) pc[m] = pc[m >> 1] + (m & 1);
    }
    const allowed = (pos, j) => !fixedAt || fixedAt[pos] === j || (fixedAt[pos] === -1 && !pinnedStop[j]);
    for (let j = 0; j < n; j++) if (allowed(0, j)) dp[(1 << j) * n + j] = cost[0][j + 1];

    for (let mask = 1; mask < FULL; mask++) {
      const pos = fixedAt ? pc[mask] : 0;
      for (let j = 0; j < n; j++) {
        if (!(mask & (1 << j))) continue;
        const cur = dp[mask * n + j];
        if (cur === Infinity) continue;
        for (let k = 0; k < n; k++) {
          if (mask & (1 << k)) continue;
          if (fixedAt && !allowed(pos, k)) continue;
          const nm = mask | (1 << k);
          const v = cur + cost[j + 1][k + 1];
          if (v < dp[nm * n + k]) { dp[nm * n + k] = v; parent[nm * n + k] = j; }
        }
      }
    }

    const last = FULL - 1;
    let best = Infinity, bestJ = -1;
    for (let j = 0; j < n; j++) {
      const v = dp[last * n + j] + (roundTrip ? cost[j + 1][0] : 0);
      if (v < best) { best = v; bestJ = j; }
    }
    if (bestJ === -1) throw new Error("Belgilangan o'rinlar bilan tartib topilmadi");
    const order = [];
    let mask = last, j = bestJ;
    while (j !== -1) {
      order.push(j + 1);
      const p = parent[mask * n + j];
      mask ^= 1 << j;
      j = p;
    }
    order.reverse();
    return order;
  }

  function nearestNeighbor(cost, n, first) {
    const used = new Array(n + 1).fill(false);
    used[0] = true;
    const order = [];
    let cur = 0;
    if (first) { order.push(first); used[first] = true; cur = first; }
    while (order.length < n) {
      let best = -1, bv = Infinity;
      for (let k = 1; k <= n; k++) {
        if (!used[k] && cost[cur][k] < bv) { bv = cost[cur][k]; best = k; }
      }
      used[best] = true; order.push(best); cur = best;
    }
    return order;
  }

  function improve(cost, order, roundTrip) {
    let best = order.slice();
    let bestCost = pathCost(cost, best, roundTrip);
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 200) {
      improved = false;
      // 2-opt: segmentni teskari aylantirish
      for (let i = 0; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          const cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
          const c = pathCost(cost, cand, roundTrip);
          if (c < bestCost - 1e-9) { best = cand; bestCost = c; improved = true; }
        }
      }
      // Or-opt: 1–3 ta ketma-ket nuqtani boshqa joyga ko'chirish
      for (let len = 1; len <= 3; len++) {
        for (let i = 0; i + len <= best.length; i++) {
          const seg = best.slice(i, i + len);
          const rest = best.slice(0, i).concat(best.slice(i + len));
          for (let p = 0; p <= rest.length; p++) {
            if (p === i) continue;
            const cand = rest.slice(0, p).concat(seg, rest.slice(p));
            const c = pathCost(cost, cand, roundTrip);
            if (c < bestCost - 1e-9) { best = cand; bestCost = c; improved = true; }
          }
        }
      }
    }
    return best;
  }

  /**
   * O'rinlari belgilangan holda evristika: belgilangan manzillar joyida qoladi, erkin manzillar
   * erkin o'rinlarga joylanadi (eng yaqin qo'shni + almashtirish / teskari aylantirish / ko'chirish).
   */
  function pinnedHeuristic(cost, n, roundTrip, fixedAt) {
    const pinned = new Set(fixedAt.filter((j) => j >= 0));
    const build = (free) => {
      const out = [];
      let f = 0;
      for (let p = 0; p < n; p++) out.push(fixedAt[p] >= 0 ? fixedAt[p] + 1 : free[f++]);
      return out;
    };
    const left = new Set();
    for (let j = 0; j < n; j++) if (!pinned.has(j)) left.add(j + 1);
    let free = [];
    let prev = 0;
    for (let p = 0; p < n; p++) {
      if (fixedAt[p] >= 0) { prev = fixedAt[p] + 1; continue; }
      let best = -1, bv = Infinity;
      for (const k of left) if (cost[prev][k] < bv) { bv = cost[prev][k]; best = k; }
      left.delete(best); free.push(best); prev = best;
    }
    let bestCost = pathCost(cost, build(free), roundTrip);
    const tryCand = (cand) => {
      const c = pathCost(cost, build(cand), roundTrip);
      if (c < bestCost - 1e-9) { free = cand; bestCost = c; return true; }
      return false;
    };
    let improved = true, guard = 0;
    while (improved && guard++ < 200) {
      improved = false;
      const m = free.length;
      for (let i = 0; i < m - 1; i++) {
        for (let k = i + 1; k < m; k++) {
          if (tryCand(free.slice(0, i).concat(free.slice(i, k + 1).reverse(), free.slice(k + 1)))) improved = true;
          const sw = free.slice(); const t = sw[i]; sw[i] = sw[k]; sw[k] = t;
          if (tryCand(sw)) improved = true;
        }
      }
      for (let len = 1; len <= 3; len++) {
        for (let i = 0; i + len <= m; i++) {
          const seg = free.slice(i, i + len);
          const rest = free.slice(0, i).concat(free.slice(i + len));
          for (let p = 0; p <= rest.length; p++) {
            if (p === i) continue;
            if (tryCand(rest.slice(0, p).concat(seg, rest.slice(p)))) improved = true;
          }
        }
      }
    }
    return build(free);
  }

  /**
   * @param {number[][]} cost (n+1)x(n+1) matritsa
   * @param {{roundTrip?: boolean, pins?: Object<number, number>}} opts  pins: {manzilIndeksi: o'rin}
   * @returns {{order:number[], cost:number, exact:boolean}} order — manzil indekslari (1..n)
   */
  function solve(cost, opts) {
    const roundTrip = !!(opts && opts.roundTrip);
    const n = cost.length - 1;
    if (n <= 0) return { order: [], cost: 0, exact: true };
    const fixedAt = normalizePins(opts && opts.pins, n);
    if (n === 1) return { order: [1], cost: pathCost(cost, [1], roundTrip), exact: true };

    if (n <= EXACT_LIMIT) {
      const order = heldKarp(cost, n, roundTrip, fixedAt);
      return { order, cost: pathCost(cost, order, roundTrip), exact: true };
    }
    if (fixedAt) {
      const order = pinnedHeuristic(cost, n, roundTrip, fixedAt);
      return { order, cost: pathCost(cost, order, roundTrip), exact: false };
    }

    let best = null, bestCost = Infinity;
    const starts = [0];
    for (let k = 1; k <= n && starts.length < 12; k++) starts.push(k);
    for (const s of starts) {
      const cand = improve(cost, nearestNeighbor(cost, n, s || null), roundTrip);
      const c = pathCost(cost, cand, roundTrip);
      if (c < bestCost) { best = cand; bestCost = c; }
    }
    return { order: best, cost: bestCost, exact: false };
  }

  global.TSP = { solve, pathCost, normalizePins, EXACT_LIMIT };
  if (typeof module !== "undefined") module.exports = global.TSP;
})(typeof window !== "undefined" ? window : globalThis);

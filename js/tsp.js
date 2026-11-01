/*
 * Marshrut tartibini optimallashtirish (Kommivoyajer masalasi, TSP).
 * 0-tugun — boshlang'ich nuqta, 1..n — manzillar.
 * cost[i][j] — i dan j ga borish narxi (masofa yoki vaqt), assimetrik bo'lishi mumkin.
 *
 *  - n <= EXACT_LIMIT: Held–Karp dinamik dasturlash — kafolatlangan eng optimal tartib.
 *  - n  > EXACT_LIMIT: ko'p startli "eng yaqin qo'shni" + 2-opt + Or-opt evristikasi.
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

  function heldKarp(cost, n, roundTrip) {
    const FULL = 1 << n;
    const dp = new Float64Array(FULL * n).fill(Infinity);
    const parent = new Int8Array(FULL * n).fill(-1);
    for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = cost[0][j + 1];

    for (let mask = 1; mask < FULL; mask++) {
      for (let j = 0; j < n; j++) {
        if (!(mask & (1 << j))) continue;
        const cur = dp[mask * n + j];
        if (cur === Infinity) continue;
        for (let k = 0; k < n; k++) {
          if (mask & (1 << k)) continue;
          const nm = mask | (1 << k);
          const v = cur + cost[j + 1][k + 1];
          if (v < dp[nm * n + k]) { dp[nm * n + k] = v; parent[nm * n + k] = j; }
        }
      }
    }

    const last = FULL - 1;
    let best = Infinity, bestJ = 0;
    for (let j = 0; j < n; j++) {
      const v = dp[last * n + j] + (roundTrip ? cost[j + 1][0] : 0);
      if (v < best) { best = v; bestJ = j; }
    }
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
   * @param {number[][]} cost (n+1)x(n+1) matritsa
   * @param {{roundTrip?: boolean}} opts
   * @returns {{order:number[], cost:number, exact:boolean}} order — manzil indekslari (1..n)
   */
  function solve(cost, opts) {
    const roundTrip = !!(opts && opts.roundTrip);
    const n = cost.length - 1;
    if (n <= 0) return { order: [], cost: 0, exact: true };
    if (n === 1) return { order: [1], cost: pathCost(cost, [1], roundTrip), exact: true };

    if (n <= EXACT_LIMIT) {
      const order = heldKarp(cost, n, roundTrip);
      return { order, cost: pathCost(cost, order, roundTrip), exact: true };
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

  global.TSP = { solve, pathCost, EXACT_LIMIT };
  if (typeof module !== "undefined") module.exports = global.TSP;
})(typeof window !== "undefined" ? window : globalThis);

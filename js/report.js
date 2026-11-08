/*
 * Safar hisoboti: kunlar bo'yicha bashorat.
 *
 * Qoidalar (hammasi parametr bilan o'zgartiriladi):
 *  - Birinchi kuni "joʻnash vaqti"da yoʻlga chiqiladi.
 *  - Manzilda ish faqat ish oynasi ichida (masalan 10:00–18:00) va butunlay sigʻsa boshlanadi.
 *    Ish oynasi tugashiga ulgurmasa (masalan 17:00 da yetib kelsak, 3 soatlik ish 18:00 gacha sigʻmaydi),
 *    ish bo'linmaydi: shu manzilda tunab, ertasi kuni ish boshlanishida (10:00) boshlanadi.
 *  - Ish boshlanishidan oldin yetib kelsak, ish boshlanishigacha kutiladi.
 *  - Kechqurun "haydash chegarasi"dan keyin yoʻlda davom etilmaydi: shu yerda tunaymiz
 *    (mehmonxona), ertasi kuni joʻnash vaqtida yoʻl davom etadi.
 *
 * Vaqt: safar sanasining 00:00 dan boshlab daqiqalarda (t). kun = floor(t / 1440).
 * Hisob tirbandlik, tushlik va dam olishni hisobga olmaydi.
 */
(function (global) {
  "use strict";

  const EPS = 1e-6;
  const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
  const WEEKDAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];

  /* ---------- Vaqt va format yordamchilari ---------- */

  const pad = (n) => String(n).padStart(2, "0");
  const dayOf = (t) => Math.floor(t / 1440 + 1e-9);
  function toMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  function hhmm(t) {
    const m = ((Math.round(t) % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  }
  /** Daqiqalarni "8 soat 30 daq" ko'rinishida yozadi. */
  function fmtDur(min) {
    const total = Math.max(0, Math.round(min));
    const h = Math.floor(total / 60), m = total % 60;
    if (h === 0) return m + " daq";
    return h + " soat" + (m ? " " + m + " daq" : "");
  }
  /** Davomiylik + daqiqada: "8 soat (480 daq)". */
  function fmtDurFull(min) {
    const total = Math.round(min);
    return total < 60 ? total + " daq" : fmtDur(total) + " (" + total + " daq)";
  }
  const fmtKm = (km) => (km < 10 ? km.toFixed(1) : String(Math.round(km))).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " km";

  /** Safar sanasi + kun indeksi -> {dd.mm.yyyy, hafta kuni, ...} */
  function dateInfo(base, dayIndex) {
    const d = new Date(base.y, base.m - 1, base.d + dayIndex);
    return {
      iso: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()),
      dmy: pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear(),
      short: d.getDate() + "-" + MONTHS[d.getMonth()],
      weekday: WEEKDAYS[d.getDay()],
    };
  }

  /* ---------- Parametrlarni tekshirish ---------- */

  /**
   * @param {{date:string, depart:string, workStart:string, workEnd:string, driveLimit?:string, stayMin:number}} raw
   * @returns {{ok:boolean, errors:string[], warnings:string[], P:object|null}}
   */
  function normalizeParams(raw) {
    const errors = [], warnings = [];
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw.date || ""));
    let date = null;
    if (dm) {
      const probe = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
      if (probe.getFullYear() === Number(dm[1]) && probe.getMonth() === Number(dm[2]) - 1 && probe.getDate() === Number(dm[3])) {
        date = { y: Number(dm[1]), m: Number(dm[2]), d: Number(dm[3]) };
      }
    }
    if (!date) errors.push("Safar sanasini kiriting.");
    const depart = toMin(raw.depart), workStart = toMin(raw.workStart), workEnd = toMin(raw.workEnd);
    const driveLimit = raw.driveLimit === undefined || raw.driveLimit === "" ? workEnd : toMin(raw.driveLimit);
    const stay = Number(raw.stayMin);
    if (Number.isNaN(depart)) errors.push("Joʻnash vaqtini kiriting (soat:daqiqa).");
    if (Number.isNaN(workStart)) errors.push("Ish boshlanish vaqtini kiriting.");
    if (Number.isNaN(workEnd)) errors.push("Ish tugash vaqtini kiriting.");
    if (Number.isNaN(driveLimit)) errors.push("Haydashni tugatish vaqtini kiriting.");
    if (!Number.isFinite(stay) || stay < 0 || stay > 1440) errors.push("Har manzilda ish davomiyligi 0 dan 1440 daqiqagacha boʻlishi kerak.");
    if (!errors.length) {
      if (workEnd <= workStart) errors.push("Ish tugash vaqti boshlanishidan keyin boʻlishi kerak.");
      if (driveLimit <= depart) errors.push("Haydashni tugatish vaqti joʻnash vaqtidan keyin boʻlishi kerak.");
      if (stay > workEnd - workStart) warnings.push("Manzildagi ish davomiyligi (" + fmtDur(stay) + ") ish oynasidan (" + fmtDur(workEnd - workStart) + ") uzun: ish har kuni ish boshlanishida boshlanadi va oynadan oshib ketadi.");
    }
    if (errors.length) return { ok: false, errors, warnings, P: null };
    return { ok: true, errors, warnings, P: { date, depart, workStart, workEnd, driveLimit, stay } };
  }

  /* ---------- Geometriya (yo'lda tunash joyini taxminan aniqlash) ---------- */

  function distM(lat1, lon1, lat2, lon2) {
    const R = 6371008.8, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function prepGeometry(g) {
    if (!g || g.length < 2) return null;
    const cum = [0];
    for (let i = 1; i < g.length; i++) cum.push(cum[i - 1] + distM(g[i - 1][0], g[i - 1][1], g[i][0], g[i][1]));
    return { g, cum, total: cum[cum.length - 1] };
  }

  function pointAt(geom, fraction) {
    const target = Math.min(1, Math.max(0, fraction)) * geom.total;
    let lo = 0, hi = geom.cum.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (geom.cum[mid] <= target) lo = mid; else hi = mid; }
    const seg = geom.cum[hi] - geom.cum[lo] || 1, f = (target - geom.cum[lo]) / seg;
    return [geom.g[lo][0] + (geom.g[hi][0] - geom.g[lo][0]) * f, geom.g[lo][1] + (geom.g[hi][1] - geom.g[lo][1]) * f];
  }

  /* ---------- Asosiy hisob ---------- */

  /**
   * @param {object} input
   *  start     — {name}
   *  stops     — tashrif tartibidagi manzillar [{name, address, note, link, lat, lon}]
   *  legs      — [{distance (m), duration (s)}]; stops.length yoki (qaytish bilan) stops.length + 1 ta
   *  roundTrip — oxirida boshlangʻich nuqtaga qaytish
   *  geometry  — marshrut chizigʻi [[lat, lon], ...] (ixtiyoriy; yoʻlda tunash joyini taxminlash uchun)
   *  cities    — [{name, lat, lon}] (ixtiyoriy)
   *  params    — normalizeParams().P
   */
  function schedule(input) {
    const P = input.params, stops = input.stops, legs = input.legs;
    const start = input.start || { name: "Boshlangʻich nuqta" };
    const roundTrip = !!input.roundTrip;
    if (legs.length < stops.length) throw new Error("Yoʻl qismlari manzillardan kam");

    const events = [], warnings = [];
    const geom = prepGeometry(input.geometry);
    const totalRouteM = legs.reduce((s, l) => s + (l.distance || 0), 0);
    const cities = input.cities || [];
    let t = P.depart, routeM = 0;
    const push = (e) => { events.push(e); return e; };
    push({ type: "depart", start: t, end: t, place: start.name });

    function placeLabel() {
      if (!geom || !(totalRouteM > 0)) return "yoʻlda";
      const pt = pointAt(geom, routeM / totalRouteM);
      let best = null, bd = Infinity;
      for (const c of cities) { const d = distM(pt[0], pt[1], c.lat, c.lon); if (d < bd) { bd = d; best = c; } }
      const km = Math.round(routeM / 1000);
      return best && bd < 80000 ? best.name + " atrofida (yoʻlning ~" + km + "-km i)" : "yoʻlda (~" + km + "-km)";
    }

    /** Joriy joyda tunaymiz; ertasi kuni `resume` daqiqada (kun ichidagi vaqt) davom etamiz. */
    function sleep(kind, place, resume, heading) {
      const day = dayOf(t);
      const nextT = (day + 1) * 1440 + resume;
      const e = push({ type: "night", kind, place, start: t, end: nextT, heading });
      t = nextT;
      return e;
    }

    function drive(fromName, toName, leg, heading) {
      const total = (leg.duration || 0) / 60, km = (leg.distance || 0) / 1000;
      const kmPerMin = total > 0 ? km / total : 0;
      const info = { from: fromName, to: toName, km, minutes: total, segments: [], nights: [] };
      let remaining = total, guard = 0;
      while (remaining > EPS) {
        if (++guard > 500) throw new Error("Hisoblash tsikli chegaradan oshdi");
        const dayEnd = dayOf(t) * 1440 + P.driveLimit;
        if (t >= dayEnd - EPS) { // bugun haydash vaqti tugagan
          const road = info.segments.length > 0;
          info.nights.push(sleep(road ? "road" : "hotel", road ? placeLabel() : fromName, P.depart, heading));
          continue;
        }
        const d = Math.min(dayEnd - t, remaining);
        push({ type: "drive", start: t, end: t + d, from: fromName, to: toName, km: d * kmPerMin });
        info.segments.push({ start: t, end: t + d, minutes: d, km: d * kmPerMin });
        t += d; remaining -= d; routeM += d * kmPerMin * 1000;
      }
      return info;
    }

    const need = Math.min(P.stay, P.workEnd - P.workStart);
    let overrun = false;
    const stopRes = [];
    let prevName = start.name;
    stops.forEach((s, i) => {
      const leg = drive(prevName, s.name, legs[i], (i + 1) + "-manzil (" + s.name + ")");
      const arrive = t, day = dayOf(arrive), time = arrive - day * 1440;
      let workStart;
      if (time <= P.workStart + EPS) workStart = day * 1440 + P.workStart;       // erta keldik: ish boshlanishini kutamiz
      else if (time + need <= P.workEnd + EPS) workStart = arrive;                // ish kuni ichiga sigʻadi
      else workStart = (day + 1) * 1440 + P.workStart;                            // ulgurmaymiz: ertasi kuni

      const postponed = dayOf(workStart) > day;
      let night = null;
      if (postponed) {
        night = push({ type: "night", kind: "hotel", place: s.name, start: arrive, end: workStart });
      } else if (workStart > arrive + EPS) {
        push({ type: "wait", start: arrive, end: workStart, place: s.name });
      }
      const workEnd = workStart + P.stay;
      if (P.stay > P.workEnd - P.workStart) overrun = true;
      push({ type: "work", start: workStart, end: workEnd, stop: i + 1, place: s.name });
      t = workEnd;
      stopRes.push({ n: i + 1, stop: s, leg, arrive, workStart, workEnd, postponed, waitMin: !postponed ? workStart - arrive : 0, night });
      prevName = s.name;
    });

    let ret = null;
    if (roundTrip) {
      const leg = drive(prevName, start.name, legs[stops.length], "qaytish (" + start.name + ")");
      ret = { leg, arrive: t };
      push({ type: "return", start: t, end: t, place: start.name });
    } else {
      push({ type: "end", start: t, end: t });
    }
    if (overrun) warnings.push("Manzildagi ish davomiyligi ish oynasidan uzun: ish tugash vaqtidan oshib ketadi.");

    /* ----- Kunlar boʻyicha boʻlimlar ----- */
    const items = new Map();
    const add = (time, item) => { const d = dayOf(time + EPS); if (!items.has(d)) items.set(d, []); items.get(d).push(Object.assign({ time }, item)); };
    const PRI = { depart: 0, stop: 1, work2: 2, night: 3, return: 4, end: 4 };
    add(P.depart, { kind: "depart", place: start.name });
    for (const sr of stopRes) {
      add(sr.arrive, { kind: "stop", sr });
      if (dayOf(sr.workStart + EPS) !== dayOf(sr.arrive + EPS)) add(sr.workStart, { kind: "work2", sr });
    }
    for (const e of events) if (e.type === "night") add(e.start, { kind: "night", e });
    if (ret) add(ret.arrive, { kind: "return", ret, place: start.name });
    else add(t, { kind: "end" });

    const lastDay = Math.max(...items.keys());
    const days = [];
    for (let d = 0; d <= lastDay; d++) {
      const list = (items.get(d) || []).sort((a, b) => a.time - b.time || PRI[a.kind] - PRI[b.kind]);
      days.push(Object.assign({ index: d, items: list }, dateInfo(P.date, d)));
    }

    /* ----- Xulosa ----- */
    const driveMin = events.filter((e) => e.type === "drive").reduce((s, e) => s + (e.end - e.start), 0);
    const workMin = events.filter((e) => e.type === "work").reduce((s, e) => s + (e.end - e.start), 0);
    const nights = events.filter((e) => e.type === "night").length;
    const summary = {
      endTime: t, endDay: dayOf(t + EPS), days: lastDay + 1, nights,
      driveMin, workMin, km: legs.slice(0, stops.length + (roundTrip ? 1 : 0)).reduce((s, l) => s + (l.distance || 0), 0) / 1000,
      postponed: stopRes.filter((r) => r.postponed).length,
    };
    return { params: P, events, stops: stopRes, days, summary, warnings, roundTrip, start };
  }

  /* ---------- Matn (.txt) ---------- */

  function stopLines(rep, day, it) {
    const sr = it.sr, s = sr.stop, P = rep.params, out = [];
    const dmyOf = (t) => dateInfo(P.date, dayOf(t + EPS)).dmy;
    const when = (t) => hhmm(t) + (dayOf(t + EPS) !== day.index ? " (" + dmyOf(t) + ")" : "");
    out.push(sr.n + "-manzil: " + s.name);
    if (s.note) out.push("  Izoh: " + s.note);
    if (s.address && s.address !== s.name) out.push("  Manzil: " + s.address);
    if (s.link) out.push("  Havola: " + s.link);
    const l = sr.leg;
    out.push("  Yoʻl: " + l.from + " → " + s.name + " — " + fmtKm(l.km) + ", rulda " + fmtDurFull(l.minutes));
    if (l.segments.length > 1) {
      out.push("    Yoʻl kunlarga boʻlinadi: " + l.segments.map((g) => dateInfo(P.date, dayOf(g.start + EPS)).dmy + " " + hhmm(g.start) + "–" + hhmm(g.end) + " (" + Math.round(g.minutes) + " daq)").join("; "));
    }
    out.push("  Yetib borish: " + hhmm(sr.arrive));
    if (sr.postponed) {
      out.push("  Ish: bugun ulgurilmaydi (" + fmtDur(P.stay) + " kerak, ish kuni " + hhmm(P.workEnd) + " da tugaydi) → " + dmyOf(sr.workStart) + " " + hhmm(sr.workStart) + " – " + hhmm(sr.workEnd) + " (" + fmtDur(P.stay) + ")");
    } else {
      if (sr.waitMin > 1) out.push("  Kutish: " + hhmm(sr.arrive) + " – " + hhmm(sr.workStart) + " (" + Math.round(sr.waitMin) + " daq, ish boshlanishigacha)");
      out.push("  Ish: " + hhmm(sr.workStart) + " – " + hhmm(sr.workEnd) + " (" + fmtDur(P.stay) + ")");
      out.push("  Ketish: " + when(sr.workEnd));
    }
    return out;
  }

  function dayLines(rep, day) {
    const P = rep.params, out = [];
    for (const it of day.items) {
      if (it.kind === "depart") out.push("Joʻnash: " + hhmm(it.time) + " — " + it.place);
      else if (it.kind === "stop") { out.push(""); out.push.apply(out, stopLines(rep, day, it)); }
      else if (it.kind === "work2") {
        const sr = it.sr;
        out.push(""); out.push(sr.n + "-manzil: " + sr.stop.name + " (davomi)");
        out.push("  Ish: " + hhmm(sr.workStart) + " – " + hhmm(sr.workEnd) + " (" + fmtDur(P.stay) + ")");
        out.push("  Ketish: " + hhmm(sr.workEnd));
      } else if (it.kind === "night") {
        const e = it.e, nextDmy = dateInfo(P.date, dayOf(e.end + EPS)).dmy;
        out.push("");
        out.push((e.kind === "road" ? "Yoʻlda tunash: " : "Tunash: ") + e.place + (e.kind === "road" ? "" : " (mehmonxona)") + " — " + hhmm(e.start) + " dan " + nextDmy + " " + hhmm(e.end) + " gacha");
        if (e.kind === "road" && e.heading) out.push("  Yoʻl " + e.heading + " ga davom etadi.");
      } else if (it.kind === "return") {
        out.push(""); out.push("Boshlangʻich nuqtaga qaytish: " + it.place + " — " + hhmm(it.time) + " da yetib kelinadi");
      } else if (it.kind === "end") {
        out.push(""); out.push("Safar tugashi: " + hhmm(it.time));
      }
    }
    return out;
  }

  /** @param {{title?:string, generated?:string, notes?:string[]}} meta */
  function toText(rep, meta) {
    const P = rep.params, S = rep.summary, m = meta || {};
    const L = [];
    L.push((m.title || "Safar hisoboti") + " — Yoʻlnoma");
    L.push("Joʻnash: " + dateInfo(P.date, 0).dmy + " " + hhmm(P.depart) + ". Ish: har kuni " + hhmm(P.workStart) + "–" + hhmm(P.workEnd) + ", har manzilda " + fmtDur(P.stay) + ". Kechqurun haydash " + hhmm(P.driveLimit) + " gacha.");
    for (const day of rep.days) {
      L.push(""); L.push("");
      L.push(day.dmy + " (" + day.weekday + ")");
      L.push.apply(L, dayLines(rep, day));
    }
    L.push(""); L.push("");
    L.push("JAMI");
    L.push("  Safar davomiyligi: " + S.days + " kun, " + S.nights + " tunash; tugash: " + dateInfo(P.date, S.endDay).dmy + " " + hhmm(S.endTime));
    L.push("  Masofa: " + fmtKm(S.km) + "; yoʻlda: " + fmtDur(S.driveMin) + "; ishda: " + fmtDur(S.workMin));
    if (S.postponed) L.push("  Ish ertasi kuniga koʻchirilgan manzillar: " + S.postponed + " ta (ish oynasiga ulgurilmagani uchun)");
    for (const w of rep.warnings) L.push("  Diqqat: " + w);
    L.push("");
    L.push("Eslatma: hisob tirbandlik, tushlik va dam olishni hisobga olmaydi; yoʻl vaqti OpenStreetMap maʼlumotlari boʻyicha taxminiy.");
    if (m.generated) L.push("Tuzilgan: " + m.generated);
    return L.join("\n") + "\n";
  }

  /* ---------- HTML (chop etish / PDF) ---------- */

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

  function toHTML(rep, meta) {
    const text = toText(rep, meta).split("\n");
    const m = meta || {};
    // Bir xil mazmun: matnni boʻlimlarga ajratib, uslublangan HTML ga oʻtkazamiz
    const html = [];
    let open = false;
    for (let i = 0; i < text.length; i++) {
      const line = text[i];
      if (i === 0) { html.push("<h1>" + esc(line) + "</h1>"); continue; }
      if (i === 1) { html.push('<p class="params">' + esc(line) + "</p>"); continue; }
      if (/^\d{2}\.\d{2}\.\d{4} \(/.test(line)) { if (open) html.push("</section>"); html.push('<section class="day"><h2>' + esc(line) + "</h2>"); open = true; continue; }
      if (line === "JAMI") { if (open) html.push("</section>"); html.push('<section class="total"><h2>Jami</h2>'); open = true; continue; }
      if (!line.trim()) continue;
      const lead = /^ */.exec(line)[0].length;
      const body = line.trim();
      if (/^\d+-manzil: /.test(body)) html.push('<h3>' + esc(body) + "</h3>");
      else if (/^(Tunash|Yoʻlda tunash):/.test(body)) html.push('<p class="night">' + esc(body) + "</p>");
      else if (/^Eslatma:|^Tuzilgan:/.test(body)) { if (open) { html.push("</section>"); open = false; } html.push('<p class="note">' + esc(body) + "</p>"); }
      else html.push('<p class="l' + Math.min(2, lead / 2) + '">' + esc(body) + "</p>");
    }
    if (open) html.push("</section>");
    return '<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>" + esc(m.title || "Safar hisoboti") + "</title><style>" +
      "body{font:15px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111c33;max-width:780px;margin:24px auto;padding:0 16px}" +
      "h1{font-size:22px;margin:0 0 4px}.params{color:#5a6880;margin:0 0 8px}" +
      ".day{margin:20px 0;border-top:2px solid #1f4fa3;padding-top:4px;break-inside:avoid-page}.day h2{font-size:18px;margin:6px 0;color:#1f4fa3}" +
      "h3{font-size:15.5px;margin:14px 0 2px;padding:4px 8px;background:#e3ebf9;border-radius:6px}" +
      "p{margin:2px 0}p.l1{margin-left:14px}p.l2{margin-left:28px;color:#5a6880}.night{margin:12px 0 4px;padding:4px 8px;background:#fbeee3;border-radius:6px;color:#8a3f10}" +
      ".total{margin-top:24px;border-top:2px solid #0f8f86;padding-top:4px}.total h2{font-size:18px;color:#0f8f86;margin:6px 0}.total p{margin-left:0}" +
      ".note{color:#5a6880;font-size:13px;margin-top:14px}" +
      "@media print{body{margin:0;max-width:none}.day{break-inside:avoid}}" +
      "</style></head><body>" + html.join("\n") + "</body></html>";
  }

  global.Report = { normalizeParams, schedule, toText, toHTML, dateInfo, hhmm, fmtDur, fmtDurFull, fmtKm, toMin };
  if (typeof module !== "undefined") module.exports = global.Report;
})(typeof window !== "undefined" ? window : globalThis);

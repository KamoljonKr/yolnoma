/* Geografik yordamchi funksiyalar: masofa, koordinata/havolani tahlil qilish, formatlash. */
(function (global) {
  "use strict";

  // O'zbekiston chegaralari (taxminiy bbox): g'arb, janub, sharq, shimol
  const UZ_BBOX = { west: 55.99, south: 37.18, east: 73.15, north: 45.59 };

  function toRad(d) { return (d * Math.PI) / 180; }

  /** Ikki nuqta orasidagi to'g'ri chiziqli masofa (metr). */
  function haversine(a, b) {
    const R = 6371008.8;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function inUzbekistan(lat, lon) {
    return lat >= UZ_BBOX.south && lat <= UZ_BBOX.north && lon >= UZ_BBOX.west && lon <= UZ_BBOX.east;
  }

  function validLatLon(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  /** "41°18'40.2"N 69°16'44"E" kabi DMS yozuvni o'qiydi. */
  function parseDMS(text) {
    const re = /(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′’]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|''))?\s*([NSEWnsew])/g;
    const parts = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      let v = Number(m[1]) + Number(m[2]) / 60 + (m[3] ? Number(m[3].replace(",", ".")) / 3600 : 0);
      const h = m[4].toUpperCase();
      if (h === "S" || h === "W") v = -v;
      parts.push({ v, h });
    }
    if (parts.length < 2) return null;
    const lat = parts.find((p) => p.h === "N" || p.h === "S");
    const lon = parts.find((p) => p.h === "E" || p.h === "W");
    if (!lat || !lon) return null;
    return { lat: lat.v, lon: lon.v };
  }

  /**
   * Matndan koordinata chiqaradi. Qo'llab-quvvatlanadi:
   *  - "41.3111, 69.2797" yoki "41.3111 69.2797"
   *  - DMS: 41°18'40"N 69°16'44"E
   *  - Google Maps havolalari: /@41.31,69.27,15z  ?q=41.31,69.27  !3d41.31!4d69.27  /place/41.31,69.27  ?ll=
   *  - Yandex Maps havolalari: ?ll=69.27,41.31 (avval uzunlik), pt=, whatshere[point]=, rtext=
   * Qaytaradi: {lat, lon, source} yoki null. Qisqa havolalar uchun {shortLink:true}.
   */
  function parseLocationInput(raw) {
    if (!raw) return null;
    const text = String(raw).trim();
    let decoded = text;
    try { decoded = decodeURIComponent(text.replace(/\+/g, " ")); } catch (_) { /* noop */ }

    if (/^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(text) ||
        /yandex\.[a-z.]+\/maps\/-\//i.test(text)) {
      return { shortLink: true };
    }

    const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
    const isYandex = /yandex\.|ya\.ru/i.test(decoded);
    const isGoogle = /google\.|goo\.gl/i.test(decoded);

    if (isYandex) {
      // Yandex: uzunlik,kenglik tartibida
      const order = [
        new RegExp("whatshere\\[point\\]=" + num + "\\s*,\\s*" + num),
        new RegExp("[?&]pt=" + num + "\\s*,\\s*" + num),
        new RegExp("[?&]ll=" + num + "\\s*,\\s*" + num),
      ];
      for (const re of order) {
        const m = decoded.match(re);
        if (m) {
          const lon = Number(m[1]), lat = Number(m[2]);
          if (validLatLon(lat, lon)) return { lat, lon, source: "yandex" };
        }
      }
      const rt = decoded.match(new RegExp("rtext=" + num + "\\s*,\\s*" + num));
      if (rt) { // rtext kenglik,uzunlik tartibida
        const lat = Number(rt[1]), lon = Number(rt[2]);
        if (validLatLon(lat, lon)) return { lat, lon, source: "yandex" };
      }
    }

    if (isGoogle || /^https?:/i.test(decoded)) {
      const order = [
        new RegExp("!3d" + num + "!4d" + num),
        new RegExp("[?&](?:q|query|ll|destination|daddr|center)=(?:loc:)?" + num + "\\s*,\\s*" + num),
        new RegExp("/place/" + num + "\\s*,\\s*" + num),
        new RegExp("/search/" + num + "\\s*,\\s*" + num),
        new RegExp("@" + num + "\\s*,\\s*" + num),
      ];
      for (const re of order) {
        const m = decoded.match(re);
        if (m) {
          const lat = Number(m[1]), lon = Number(m[2]);
          if (validLatLon(lat, lon)) return { lat, lon, source: "google" };
        }
      }
    }

    const dms = parseDMS(decoded);
    if (dms && validLatLon(dms.lat, dms.lon)) return { lat: dms.lat, lon: dms.lon, source: "dms" };

    // Oddiy "lat, lon" (vergulli kasr bilan ham: "41,3111; 69,2797")
    const plain = decoded.match(/^\s*(-?\d{1,3}[.,]\d+)\s*[,;\s]\s*(-?\d{1,3}[.,]\d+)\s*$/);
    if (plain) {
      let a = Number(plain[1].replace(",", "."));
      let b = Number(plain[2].replace(",", "."));
      // Agar foydalanuvchi uzunlikni birinchi yozgan bo'lsa (O'zbekiston uchun lat < lon har doim)
      if (!inUzbekistan(a, b) && inUzbekistan(b, a)) { const t = a; a = b; b = t; }
      if (validLatLon(a, b)) return { lat: a, lon: b, source: "coords" };
    }
    return null;
  }

  function fmtKm(m) {
    if (!Number.isFinite(m)) return "—";
    if (m < 1000) return Math.round(m) + " m";
    const km = m / 1000;
    return (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("ru-RU")) + " km";
  }

  function fmtDuration(sec) {
    if (!Number.isFinite(sec)) return "—";
    const totalMin = Math.max(1, Math.round(sec / 60));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return m + " daq";
    return h + " soat" + (m ? " " + m + " daq" : "");
  }

  function fmtSum(v) {
    if (!Number.isFinite(v)) return "—";
    return Math.round(v / 100) * 100 >= 0
      ? (Math.round(v / 100) * 100).toLocaleString("ru-RU").replace(/,/g, " ") + " soʻm"
      : "—";
  }

  function fmtCoord(lat, lon) {
    return lat.toFixed(5) + ", " + lon.toFixed(5);
  }

  global.Geo = {
    UZ_BBOX, haversine, inUzbekistan, validLatLon, parseLocationInput, parseDMS,
    fmtKm, fmtDuration, fmtSum, fmtCoord,
  };
  if (typeof module !== "undefined") module.exports = global.Geo;
})(typeof window !== "undefined" ? window : globalThis);

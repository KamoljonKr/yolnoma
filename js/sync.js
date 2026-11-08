/*
 * Serverga ulanish (Supabase): rejalarni ikkala qurilmada bir xil saqlash.
 *
 *  - kirish: emailga havola yuboriladi (parolsiz), havola ochilganda #access_token=… qaytadi
 *  - maʼlumot: plans (Tarix yozuvlari) va plan_state (hozirgi reja) jadvallari, har bir foydalanuvchiga faqat oʻzi (RLS)
 *  - faqat fetch ishlatiladi (kutubxonasiz); sozlama config.js dagi YOLNOMA_CONFIG.supabase = { url, anonKey }
 *
 * Interfeyssiz: app.js dagi sinxron mantigʻi shu modul orqali tarmoqqa chiqadi.
 */
(function (global) {
  "use strict";

  const SESSION_KEY = "yolnoma.session.v1";
  const TIMEOUT_MS = 15000;

  const cfg = () => {
    const c = (global.YOLNOMA_CONFIG || {}).supabase || {};
    return c.url && c.anonKey ? { url: String(c.url).replace(/\/+$/, ""), key: String(c.anonKey) } : null;
  };
  const enabled = () => !!cfg();

  function readSession() {
    try { const s = JSON.parse(global.localStorage.getItem(SESSION_KEY) || "null"); return s && s.access_token && s.refresh_token ? s : null; } catch (_) { return null; }
  }
  function writeSession(s) {
    try { if (s) global.localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else global.localStorage.removeItem(SESSION_KEY); } catch (_) { /* noop */ }
  }
  function b64urlJson(part) {
    const s = part.replace(/-/g, "+").replace(/_/g, "/");
    const bin = global.atob(s + "=".repeat((4 - (s.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  }
  /** Token ichidan foydalanuvchi id va email. */
  function claims(token) {
    try { const p = b64urlJson(String(token).split(".")[1]); return { id: p.sub || "", email: p.email || "" }; } catch (_) { return { id: "", email: "" }; }
  }
  const signedIn = () => enabled() && !!readSession();
  const user = () => { const s = readSession(); return s ? claims(s.access_token) : null; };

  async function http(path, opts, token) {
    const c = cfg();
    if (!c) throw new Error("Server sozlanmagan");
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
    try {
      const headers = Object.assign({ apikey: c.key, "Content-Type": "application/json" }, (opts && opts.headers) || {});
      // Yangi "sb_publishable_…" kaliti JWT emas: Authorization sarlavhasiga faqat foydalanuvchi tokeni yoki eski (JWT) anon kalit qoʻyiladi
      if (token) headers.Authorization = "Bearer " + token;
      else if (/^eyJ/.test(c.key)) headers.Authorization = "Bearer " + c.key;
      const res = await global.fetch(c.url + path, { method: (opts && opts.method) || "GET", headers, body: opts && opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: ctl ? ctl.signal : undefined });
      return res;
    } finally { if (timer) clearTimeout(timer); }
  }

  let refreshing = null;
  /** Token muddati tugayotgan boʻlsa yangilaydi. Muvaffaqiyatsiz boʻlsa (token bekor qilingan) — sessiya oʻchadi. */
  async function freshToken(force) {
    const s = readSession();
    if (!s) return null;
    if (!force && s.expires_at && s.expires_at - Date.now() > 60000) return s.access_token;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const res = await http("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: s.refresh_token } });
          if (res.status === 400 || res.status === 401 || res.status === 403) { writeSession(null); return null; }   // sessiya yaroqsiz — qayta kirish kerak
          if (!res.ok) return s.access_token;                                                                      // vaqtincha xato: eski token bilan urinib koʻramiz
          const j = await res.json();
          const ns = { access_token: j.access_token, refresh_token: j.refresh_token || s.refresh_token, expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
          writeSession(ns);
          return ns.access_token;
        } catch (_) { return s.access_token; }
        finally { refreshing = null; }
      })();
    }
    return refreshing;
  }

  async function api(path, opts) {
    let token = await freshToken(false);
    if (!token) throw Object.assign(new Error("Kirish talab qilinadi"), { auth: true });
    let res = await http(path, opts, token);
    if (res.status === 401) {
      token = await freshToken(true);
      if (!token) throw Object.assign(new Error("Kirish talab qilinadi"), { auth: true });
      res = await http(path, opts, token);
    }
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); if (j && (j.message || j.error_description)) msg += ": " + (j.message || j.error_description); } catch (_) { /* noop */ }
      throw new Error(msg);
    }
    return res;
  }

  /** Emailga kirish havolasini yuboradi. */
  async function sendLink(email) {
    const back = global.location.origin + global.location.pathname;
    const res = await http("/auth/v1/otp?redirect_to=" + encodeURIComponent(back), { method: "POST", body: { email: String(email).trim(), create_user: true } });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); msg = j.msg || j.message || j.error_description || msg; } catch (_) { /* noop */ }
      throw new Error(msg);
    }
  }

  /**
   * Havola ochilganda manzilda #access_token=… boʻladi: sessiyani saqlaydi.
   * null — bunday havola emas; {ok:true} — kirildi; {error} — xato (muddati tugagan havola va h.k.).
   */
  function consumeHash(hash) {
    const h = String(hash === undefined ? global.location.hash : hash).replace(/^#/, "");
    if (!/(^|&)(access_token|error)=/.test(h)) return null;
    const p = new URLSearchParams(h);
    if (p.get("error") || p.get("error_description")) return { error: p.get("error_description") || p.get("error") };
    const at = p.get("access_token"), rt = p.get("refresh_token");
    if (!at || !rt) return { error: "Kirish havolasi toʻliq emas" };
    writeSession({ access_token: at, refresh_token: rt, expires_at: Date.now() + (Number(p.get("expires_in")) || 3600) * 1000 });
    return { ok: true };
  }

  async function signOut() {
    const s = readSession();
    writeSession(null);
    if (s && cfg()) { try { await http("/auth/v1/logout", { method: "POST" }, s.access_token); } catch (_) { /* noop */ } }
  }

  /* ---------- Maʼlumot ---------- */

  const iso = (ms) => new Date(ms).toISOString();
  const fromIso = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : 0; };

  async function pullPlans() {
    const res = await api("/rest/v1/plans?select=id,name,data,dist,dur,created_at,updated_at,deleted&order=updated_at.desc&limit=500");
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r.id, name: r.name, data: r.data, dist: r.dist || 0, dur: r.dur || 0,
      createdAt: fromIso(r.created_at), updatedAt: fromIso(r.updated_at), deleted: !!r.deleted,
    }));
  }
  async function pullState() {
    const res = await api("/rest/v1/plan_state?select=current_plan,updated_at");
    const rows = await res.json();
    const r = Array.isArray(rows) ? rows[0] : null;
    return r ? { current: r.current_plan || null, at: fromIso(r.updated_at) } : null;
  }
  /** entries: [{id,name,data,dist,dur,createdAt,updatedAt,deleted?}] */
  async function pushPlans(entries) {
    if (!entries.length) return;
    const uid = (user() || {}).id;
    const body = entries.map((e) => ({
      user_id: uid, id: e.id, name: e.name, data: e.data || {}, dist: e.dist || 0, dur: e.dur || 0,
      created_at: iso(e.createdAt || Date.now()), updated_at: iso(e.updatedAt || Date.now()), deleted: !!e.deleted,
    }));
    await api("/rest/v1/plans?on_conflict=user_id,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body });
  }
  async function pushState(current, at) {
    const uid = (user() || {}).id;
    await api("/rest/v1/plan_state?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: [{ user_id: uid, current_plan: current || null, updated_at: iso(at || Date.now()) }] });
  }

  global.Sync = { enabled, signedIn, user, sendLink, consumeHash, signOut, pullPlans, pullState, pushPlans, pushState, claims };
  if (typeof module !== "undefined") module.exports = global.Sync;
})(typeof window !== "undefined" ? window : globalThis);

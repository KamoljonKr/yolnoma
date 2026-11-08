/*
 * Ixtiyoriy sozlamalar. Platforma kalitsiz ham toʻliq ishlaydi.
 *
 * googleMapsApiKey — Google Maps Embed API kaliti. Kiritilsa, "Tepadan koʻrinish"dagi
 *   Google oynasi rasmiy Embed API orqali ochiladi (https://developers.google.com/maps/documentation/embed).
 * supabase — serverga ulanish (rejalar ikkala qurilmada bir xil boʻlishi uchun). url va anonKey (ochiq, "anon public") kalitni
 *   Supabase → Project Settings → API dan oling. Boʻsh qoldirilsa, rejalar faqat shu qurilmada saqlanadi.
 * yandexLang — Yandex vidjeti tili/domeni (yandex.uz, yandex.ru, yandex.com).
 */
window.YOLNOMA_CONFIG = {
  googleMapsApiKey: "",
  yandexDomain: "yandex.uz",
  supabase: {
    url: "https://xgdhmxbipfxkghqjcxcj.supabase.co",
    anonKey: "sb_publishable_ECts8uLZUQo2bPY1SVRD9g_D6vTJqq_",   // ochiq (publishable) kalit — maxfiy emas
  },
};

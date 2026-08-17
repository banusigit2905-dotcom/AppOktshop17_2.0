// Service Worker OKTSHOP17 — bikin app bisa di-install & tetap kebuka walau internet lemot/putus.
// PENTING: Naikkan CACHE_NAME (misal jadi v3, v4, dst) SETIAP KALI update index.html/script.js/style.css,
// supaya user otomatis dapat versi baru tanpa perlu clear cache manual.
const CACHE_NAME = "oktshop17-cache-v6-debug2";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./referral.css",
  "./script.js",
  "./referral.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Install: simpan file-file inti ke cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activate: bersihkan SEMUA cache versi lama (apapun namanya), lalu langsung ambil alih semua tab yang terbuka
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: coba jaringan dulu (biar data & kode SELALU fresh), fallback ke cache kalau offline.
// { cache: "no-store" } wajib ada supaya fetch ini benar-benar tembus ke server asli,
// tidak ke-intercept oleh cache HTTP browser/CDN yang bisa nyimpen versi lama.
// File Firebase (firestore/auth) dan EmailJS SENGAJA dilewati (tidak dicache) karena itu butuh live-data.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (url.includes("firestore.googleapis.com") || url.includes("googleapis.com") || url.includes("emailjs.com")) {
    return; // biarkan request ini jalan langsung ke jaringan, tanpa campur tangan service worker
  }

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        // Simpan salinan terbaru ke cache tiap berhasil fetch
        const resClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return response;
      })
      .catch(() => caches.match(event.request)) // offline -> ambil dari cache
  );
});

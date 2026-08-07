// Service Worker OKTSHOP17 — bikin app bisa di-install & tetap kebuka walau internet lemot/putus.
// Naikkan CACHE_NAME (misal jadi v2, v3, dst) tiap kali update file supaya user dapat versi baru.
const CACHE_NAME = "oktshop17-cache-v1";

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

// Activate: bersihkan cache versi lama
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: coba jaringan dulu (biar data selalu fresh dari Firebase), fallback ke cache kalau offline.
// File Firebase (firestore/auth) dan EmailJS SENGAJA dilewati (tidak dicache) karena itu butuh live-data.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (url.includes("firestore.googleapis.com") || url.includes("googleapis.com") || url.includes("emailjs.com")) {
    return; // biarkan request ini jalan langsung ke jaringan, tanpa campur tangan service worker
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Simpan salinan terbaru ke cache tiap berhasil fetch
        const resClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return response;
      })
      .catch(() => caches.match(event.request)) // offline -> ambil dari cache
  );
});

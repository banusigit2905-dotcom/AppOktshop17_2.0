// --- LOGIKA SUARA ADMIN ---
const notifSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
notifSound.preload = "auto";
let lastAdminCounts = { redeem: -1, activation: -1, order: -1, return: -1, complaint: -1 };
let notifSoundUnlocked = false;

// Browser (terutama Chrome) memblokir audio.play() lewat JS sebelum ada interaksi user di halaman.
// Fungsi ini "membuka kunci" izin audio dengan memutar sangat singkat lalu menghentikannya,
// dipicu otomatis pada sentuhan/klik pertama user di halaman manapun.
function unlockNotifSound() {
    if (notifSoundUnlocked) return;
    notifSoundUnlocked = true;
    notifSound.play().then(() => {
        notifSound.pause();
        notifSound.currentTime = 0;
    }).catch(() => { notifSoundUnlocked = false; });
}
document.addEventListener("click", unlockNotifSound, { once: true });
document.addEventListener("touchstart", unlockNotifSound, { once: true });

function playAdminTing() {
    notifSound.currentTime = 0;
    notifSound.play().catch(e => console.log("Suara notifikasi diblokir browser:", e.message));
}

// --- PRESENCE: LACAK AKUN YANG SEDANG ONLINE ---
// Setiap akun yang login mengirim "heartbeat" (update lastActive) tiap 25 detik ke koleksi "presence".
// Dianggap online jika heartbeat terakhir masih dalam 45 detik terakhir.
let presenceHeartbeatInterval = null;
const ONLINE_THRESHOLD_MS = 45000;

async function updatePresence() {
    if (!currentUser) return;
    try {
        await db.collection("presence").doc(currentUser.id).set({
            role: currentUser.role,
            nama: currentUser.nama,
            lastActive: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) { console.log("Gagal update presence:", e.message); }
}

function startPresenceHeartbeat() {
    updatePresence(); // kirim langsung sekali saat login
    if (presenceHeartbeatInterval) clearInterval(presenceHeartbeatInterval);
    presenceHeartbeatInterval = setInterval(updatePresence, 25000);
}

function stopPresenceHeartbeat() {
    if (presenceHeartbeatInterval) clearInterval(presenceHeartbeatInterval);
    presenceHeartbeatInterval = null;
    if (currentUser) {
        db.collection("presence").doc(currentUser.id).delete().catch(() => {});
    }
}

// Best-effort: coba hapus presence saat tab/browser ditutup (tidak selalu berhasil, tapi tidak masalah
// karena heartbeat yang berhenti otomatis membuat akun dianggap offline setelah ONLINE_THRESHOLD_MS).
window.addEventListener("beforeunload", () => {
    if (currentUser) {
        db.collection("presence").doc(currentUser.id).delete().catch(() => {});
    }
});

// Hitung & tampilkan jumlah SEMUA akun (admin + reseller) yang sedang online di dashboard admin
let allOnlineCache = [];
let pendingOrdersCache = [];
let adminOnlineAttached = false;

function recomputeAdminOnline() {
    const now = Date.now();
    const onlineList = allOnlineCache.filter(p => {
        if (!p.lastActive || !p.lastActive.toDate) return false;
        return (now - p.lastActive.toDate().getTime()) < ONLINE_THRESHOLD_MS;
    });
    const el = document.getElementById("admOnline");
    if (el) el.innerText = onlineList.length;

    // Kalau modal daftar online sedang terbuka, refresh isinya juga secara real-time
    const modal = document.getElementById("onlineListModal");
    if (modal && !modal.classList.contains("hidden")) {
        renderOnlineListBody(onlineList);
    }
}

function renderOnlineListBody(onlineList) {
    const body = document.getElementById("onlineListBody");
    if (!body) return;
    if (onlineList.length === 0) {
        body.innerHTML = `<p style="color:#999;">Tidak ada akun yang online.</p>`;
        return;
    }
    const sorted = [...onlineList].sort((a, b) => (a.role === 'admin' ? -1 : 1) - (b.role === 'admin' ? -1 : 1));
    body.innerHTML = sorted.map(p => {
        const roleLabel = p.role === 'admin' ? '👑 Admin' : '🧑‍💼 Reseller';
        return `<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eee;">
                    <span>${p.nama || 'Tanpa Nama'}</span>
                    <span style="color:#666; font-size:11px;">${roleLabel}</span>
                </div>`;
    }).join('');
}

function openOnlineListModal() {
    const now = Date.now();
    const onlineList = allOnlineCache.filter(p => {
        if (!p.lastActive || !p.lastActive.toDate) return false;
        return (now - p.lastActive.toDate().getTime()) < ONLINE_THRESHOLD_MS;
    });
    renderOnlineListBody(onlineList);
    document.getElementById("onlineListModal").classList.remove("hidden");
}

function closeOnlineListModal() {
    document.getElementById("onlineListModal").classList.add("hidden");
}

function renderPendingListBody() {
    const body = document.getElementById("pendingListBody");
    if (!body) return;
    if (pendingOrdersCache.length === 0) {
        body.innerHTML = `<p style="color:#999;">Tidak ada pesanan pending.</p>`;
        return;
    }
    body.innerHTML = pendingOrdersCache.map(o => {
        const tgl = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '-';
        return `<div style="padding:8px 0; border-bottom:1px solid #eee;">
                    <div style="display:flex; justify-content:space-between;"><b>${o.resellerName || '-'}</b><span style="font-size:10px; color:#999;">${tgl}</span></div>
                    <div style="font-size:11px; color:#666;">${o.orderId || ''} — ${o.produk || ''}</div>
                </div>`;
    }).join('');
}

function openPendingListModal() {
    renderPendingListBody();
    document.getElementById("pendingListModal").classList.remove("hidden");
}

function closePendingListModal() {
    document.getElementById("pendingListModal").classList.add("hidden");
}

function renderStockListBody(filter = 'semua') {
    const body = document.getElementById("stockListBody");
    if (!body) return;
    let list = [...catalog];
    if (filter === 'tersedia') list = list.filter(p => getStock(p) > 9);
    if (filter === 'menipis') list = list.filter(p => getStock(p) > 0 && getStock(p) <= 9);
    if (filter === 'habis') list = list.filter(p => isHabis(p));
    if (list.length === 0) {
        body.innerHTML = `<p style="color:#999;">Tidak ada produk untuk kategori ini.</p>`;
        return;
    }
    body.innerHTML = list.map(p => {
        const stock = getStock(p);
        const label = isHabis(p) ? `<span style="color:#c0392b; font-weight:bold;">Habis</span>` : (stock <= 9 ? `<span style="color:#c9772a; font-weight:bold;">Menipis</span>` : `<span style="color:#3c6b2a; font-weight:bold;">Tersedia</span>`);
        return `<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eee;">
                    <span>${p.nama}</span>
                    <span style="font-size:11px;">${stock} — ${label}</span>
                </div>`;
    }).join('');
}

function openStockListModal() {
    renderStockListBody('semua');
    document.getElementById("stockListModal").classList.remove("hidden");
}

function closeStockListModal() {
    document.getElementById("stockListModal").classList.add("hidden");
}

function initAdminOnlineListener() {
    if (adminOnlineAttached) return;
    adminOnlineAttached = true;
    db.collection("presence").onSnapshot(snap => {
        allOnlineCache = snap.docs.map(d => d.data());
        recomputeAdminOnline();
    }, err => console.error("Gagal memuat data presence:", err.message));
    // Refresh berkala supaya entry yang basi (heartbeat berhenti) ikut ke-exclude
    // walau tidak ada perubahan snapshot baru dari Firestore.
    setInterval(recomputeAdminOnline, 15000);
}
// --- UTILS ---
function generateOrderId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'ORD-';
    for (let i = 0; i < 5; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// --- FIREBASE CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyCkH8ACVHoRxYru1g9oPa9tMD4yBUYQcZM",
    authDomain: "member-reseller-boci.firebaseapp.com",
    projectId: "member-reseller-boci",
    storageBucket: "member-reseller-boci.firebasestorage.app",
    messagingSenderId: "279521008637",
    appId: "1:279521008637:web:0923c9cb51818da7945794"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ==== EMAILJS SETUP — GANTI 3 NILAI INI SESUAI AKUN EMAILJS ANDA ====
const EMAILJS_PUBLIC_KEY = "ymyyRbjGQH-VCM_EQ";   // Account > General
const EMAILJS_SERVICE_ID = "service_oktshop1";   // Email Services
const EMAILJS_TEMPLATE_ID = "template_oktshop17"; // Email Templates
if (typeof emailjs !== 'undefined') emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
// =====================================================================

let currentUser = null;
let catalog = [];

// Stock 0 ATAU belum pernah diisi (kosong) = dianggap habis / tidak bisa dipilih
function getStock(p) { return typeof p.stock === 'number' ? p.stock : 0; }
function isHabis(p) { return getStock(p) <= 0; }
let cart = [];
let currentPointsVal = 0; 
let currentRankPage = 0; 
let allRankings = [];

// --- RUNNING TEXT: NOTIFIKASI AKTIVITAS (USER DAFTAR & TUKAR POIN) ---
const defaultRunningText = "Selamat Datang di Portal Resmi OKTSHOP17! Nikmati kemudahan bertransaksi dan kumpulkan poin sebanyak-banyaknya untuk ditukarkan dengan VOUCHER PILIHAN. Hubungi admin jika butuh bantuan aktivasi atau bisa hubungi kenomor Whatsapp 0895391637844.";
let runningTextQueue = [];
let runningTextBusy = false;
let activityFeedListenerAttached = false;

// Menampilkan teks baru di running text & mengembalikan durasi animasinya (detik)
function setRunningText(text) {
    const el = document.getElementById("runningText");
    if (!el) return 15;
    const durationSec = Math.max(10, Math.min(30, text.length * 0.15));
    el.style.animation = "none";
    void el.offsetWidth; // paksa reflow supaya animasi restart dari awal
    el.innerText = text;
    el.style.animation = `marquee ${durationSec}s linear infinite`;
    return durationSec;
}

// Memproses antrian notifikasi satu per satu, lalu kembali ke teks default jika kosong
function processRunningTextQueue() {
    if (runningTextBusy) return;
    if (runningTextQueue.length === 0) {
        setRunningText(defaultRunningText);
        return;
    }
    runningTextBusy = true;
    const nextText = runningTextQueue.shift();
    const durationSec = setRunningText(nextText);
    setTimeout(() => {
        runningTextBusy = false;
        processRunningTextQueue();
    }, durationSec * 1000);
}

function pushRunningText(text) {
    runningTextQueue.push(text);
    processRunningTextQueue();
}

// Mendengarkan aktivitas baru (daftar & tukar poin) dari koleksi "activityFeed"
function initActivityFeed() {
    if (activityFeedListenerAttached) return;
    activityFeedListenerAttached = true;

    setRunningText(defaultRunningText);

    let firstLoad = true;
    db.collection("activityFeed").orderBy("createdAt", "desc").limit(5)
      .onSnapshot(snap => {
          if (firstLoad) { firstLoad = false; return; } // lewati data lama saat pertama kali load
          snap.docChanges().forEach(change => {
              if (change.type === "added") {
                  const d = change.doc.data();
                  if (d.type === "register") {
                      pushRunningText(`🎉 Selamat datang ${d.nama || "Reseller Baru"}! `);
                  } else if (d.type === "redeem") {
                      const poin = d.poin ? d.poin.toLocaleString('id-ID') : "0";
                      pushRunningText(`🎁 Selamat ${d.nama || "Reseller"} telah berhasil tukar poin ${poin}! `);
                  }
              }
          });
      }, err => console.log("Info: activityFeed belum bisa diakses -", err.message));
}

// --- 1. AUTH LISTENER ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const doc = await db.collection("users").doc(user.uid).get();
            if (doc.exists) {
                const userData = doc.data();
                if (userData.role !== 'admin' && userData.isActive !== true) {
    alert("Akun Anda ... belum aktif.");
    auth.signOut(); // <--- Ini penyebabnya
    return;
}
                currentUser = { id: user.uid, ...userData };
                initApp();
            } else {
                auth.signOut();
            }
        } catch (err) {
            console.error("Error checking user doc:", err);
        }
    } else {
        stopPresenceHeartbeat();
        document.getElementById("appWrapper").classList.add("hidden");
        document.getElementById("loginScreen").classList.remove("hidden");
    }
});

// --- 2. INITIALIZE APP ---
function initApp() {
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("appWrapper").classList.remove("hidden");
    document.getElementById("userGreetName").innerText = currentUser.nama || "User";

    // Tandai role di <body> supaya top bar & greeting bisa beda tampilan per role (CSS)
    document.body.classList.remove("theme-admin", "theme-reseller");
    document.body.classList.add(currentUser.role === 'admin' ? "theme-admin" : "theme-reseller");
        
    if(document.getElementById("customId")) document.getElementById("customId").innerText = currentUser.customId || "-";
    if(document.getElementById("profEmail")) document.getElementById("profEmail").value = currentUser.email || "";
    if(document.getElementById("profNama")) document.getElementById("profNama").value = currentUser.nama || "";
    if(document.getElementById("profHp")) document.getElementById("profHp").value = currentUser.hp || "";

    renderSidebar();
    syncCatalog();
    initActivityFeed();
    startPresenceHeartbeat();
if (currentUser.role === 'reseller' && currentUser.isActive === true && !currentUser.bonusReceived) {
        // Tambahkan bonus ke database
        db.collection("users").doc(currentUser.id).update({
            bonusReceived: true,
            bonusPoints: 2000
        }).then(() => {
            alert("🎉 Selamat! Kamu mendapatkan Poin 2.000 pertama kali login setelah akun diaktifkan. Kumpulkan poinnya untuk ditukar dengan Voucher Pilihan!");
            location.reload(); // Refresh untuk update poin
        });
}
    if (currentUser.role === 'admin') {
        // Tampilan Admin
        document.getElementById("adminNotifHeader").classList.remove("hidden");
        document.getElementById("btnTukarPoinHeader").classList.add("hidden");
        if(document.getElementById("btnInboxHeader")) document.getElementById("btnInboxHeader").classList.add("hidden");
        showSection('secAdminDashboard');
        loadAdminData();
    } else {
        // Tampilan Reseller
        document.getElementById("adminNotifHeader").classList.add("hidden");
        document.getElementById("btnTukarPoinHeader").classList.remove("hidden");
        if(document.getElementById("btnInboxHeader")) document.getElementById("btnInboxHeader").classList.remove("hidden"); 

        showSection('secResellerDashboard');
        loadResellerData();
        loadResellerHistory();
        loadResellerLeaderboard();
        loadNotifications(); // Memanggil fitur Kotak Masuk
        syncChecklist(); // Checklist harian
        if (typeof syncReferral === 'function') syncReferral(); // Sistem referral
    }
}
// --- 3. NOTIFICATION / INBOX SYSTEM ---
function loadNotifications() {
    db.collection("notifications")
      .where("userId", "==", currentUser.id)
      .orderBy("createdAt", "desc")
      .onSnapshot(snap => {
        const tableBody = document.getElementById("inboxTableBody");
        const badgeInbox = document.getElementById("badgeInbox");
        const badgeSidebar = document.getElementById("badgeSidebar");
        
        let unreadCount = 0;
        let html = "";

        if (snap.empty) {
            if(tableBody) tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Kosong</td></tr>';
            if(badgeInbox) badgeInbox.style.display = "none";
            return;
        }

        snap.forEach((doc, index) => {
            const n = doc.data();
            const id = doc.id;
            if (!n.isRead) unreadCount++;
            
            const waktu = n.createdAt ? n.createdAt.toDate().toLocaleString('id-ID') : 'Baru saja';
            const weight = n.isRead ? "normal" : "800"; 
            const color = n.isRead ? "#666" : "#000";

            html += `
                <tr onclick="openMessage('${id}', '${n.title}', '${n.text}', '${waktu}')" 
                    style="cursor:pointer; font-weight:${weight}; color:${color}; ${n.isRead ? '' : 'background:#fff9e6;'}">
                    <td>${index + 1}</td>
                    <td><small>${waktu}</small></td>
                    <td style="text-align: left;">${n.text.substring(0, 30)}...</td>
                    <td>${n.isRead ? 'Dilihat' : '<b>Baru</b>'}</td>
                </tr>
            `;
        });

        if(tableBody) tableBody.innerHTML = html;
        if(badgeInbox) {
            badgeInbox.innerText = unreadCount;
            badgeInbox.style.display = unreadCount > 0 ? "block" : "none";
        }
        if(badgeSidebar) {
            badgeSidebar.innerText = unreadCount;
            badgeSidebar.style.display = unreadCount > 0 ? "inline-block" : "none";
        }
    });
}
async function markAllAsRead() {
    const batch = db.batch();
    const snap = await db.collection("notifications")
                        .where("userId", "==", currentUser.id)
                        .where("isRead", "==", false).get();
    
    if (snap.empty) return alert("Semua pesan sudah dibaca.");
    snap.forEach(doc => batch.update(doc.ref, { isRead: true }));
    await batch.commit();
    alert("Semua pesan ditandai telah dibaca.");
}

// --- 4. AUTH FORMS ---
document.getElementById("loginForm").onsubmit = (e) => {
    e.preventDefault();

    const email = document.getElementById("loginEmail").value;
    const pass = document.getElementById("loginPassword").value;

    auth.signInWithEmailAndPassword(email, pass)
        .then((cred) => {
            // Login berhasil — onAuthStateChanged akan menangani tampilan selanjutnya
        })
        .catch((err) => {
            let pesan = "Gagal login. Silakan coba lagi.";
            switch (err.code) {
                case "auth/invalid-credential":
                case "auth/wrong-password":
                case "auth/user-not-found":
                    pesan = "Email/password kamu salah! Coba lagi!";
                    break;
                case "auth/invalid-email":
                    pesan = "Format email tidak valid.";
                    break;
                case "auth/too-many-requests":
                    pesan = "Terlalu banyak percobaan login gagal. Silakan coba lagi beberapa saat lagi.";
                    break;
                case "auth/user-disabled":
                    pesan = "Akun ini telah dinonaktifkan. Hubungi admin.";
                    break;
                case "auth/network-request-failed":
                    pesan = "Koneksi internet bermasalah. Periksa koneksi Anda dan coba lagi.";
                    break;
            }
            alert(pesan);
        });
};
async function handleResetPassword() {
    const email = document.getElementById("loginEmail").value;

    if (!email) {
        alert("Silakan masukkan email Anda di kolom input terlebih dahulu.");
        return;
    }

    let userId = null;
    let resetCount = 0;
    let monthKey = "";

    // 1. Cek data user & batas reset (2x/bulan). Jika gagal (mis. izin Firestore),
    //    tetap lanjut kirim email tanpa validasi/limit supaya user tetap terbantu.
    try {
        const now = new Date();
        monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

        const userSnapshot = await db.collection("users").where("email", "==", email).get();

        if (userSnapshot.empty) {
            alert("Email tidak terdaftar sebagai reseller.");
            return;
        }

        const userDoc = userSnapshot.docs[0];
        const userData = userDoc.data();
        userId = userDoc.id;

        resetCount = userData.pwResetCount || 0;
        const lastResetMonth = userData.pwLastResetMonth || "";
        if (lastResetMonth !== monthKey) resetCount = 0;

        if (resetCount >= 2) {
            alert("Maaf, Anda sudah mencapai batas maksimal (2x) ganti password dalam bulan ini.");
            return;
        }
    } catch (checkErr) {
        console.log("Gagal memeriksa data user untuk reset password:", checkErr.message);
    }

    // 2. Kirim email reset password (fitur utama, tidak bergantung pada Firestore)
    try {
        await auth.sendPasswordResetEmail(email);
        alert("Email reset password telah dikirim! Silakan periksa Inbox/Spam email Anda.");
    } catch (sendErr) {
        alert("Gagal mengirim email reset: " + sendErr.message);
        return;
    }

    // 3. Catat jumlah pemakaian reset (opsional, boleh gagal tanpa mengganggu proses di atas)
    if (userId) {
        try {
            await db.collection("users").doc(userId).update({
                pwResetCount: resetCount + 1,
                pwLastResetMonth: monthKey
            });
        } catch (updateErr) {
            console.log("Gagal mencatat batas reset password:", updateErr.message);
        }
    }
}
document.getElementById("registerForm").onsubmit = async (e) => {
    e.preventDefault();

    // Validasi field standar dulu (nama, email, sandi, hp)
    if (!e.target.checkValidity()) {
        e.target.reportValidity();
        return;
    }

    // Kalau belum pernah setuju Kebijakan Privasi, buka modalnya dulu.
    // Setelah user klik "SAYA SETUJU" di modal, performRegistration() akan dipanggil otomatis (lihat referral.js).
    const agreeCheckbox = document.getElementById("agreePrivacy");
    if (agreeCheckbox && !agreeCheckbox.checked) {
        window.pendingRegistrationAfterPrivacy = true;
        if (typeof openPrivacyModal === 'function') {
            openPrivacyModal();
        } else {
            alert("Gagal memuat Kebijakan Privasi. Silakan refresh halaman dan coba lagi.");
        }
        return;
    }

    await performRegistration();
};

async function performRegistration() {
    const nama = document.getElementById("regNama").value;
    const email = document.getElementById("regEmail").value;
    const pass = document.getElementById("regPassword").value;
    const hp = document.getElementById("regHp").value;
    const refCode = document.getElementById("regRefCode")?.value.trim() || "";
    
    const customId = nama.replace(/\s/g, '').substring(0, 4).toLowerCase() + Math.floor(10000 + Math.random() * 90000);

    try {
        // Bikin akun dulu, baru cari kode referral SETELAH login (supaya lolos aturan keamanan Firestore
        // yang mewajibkan login untuk membaca koleksi users)
        const cred = await auth.createUserWithEmailAndPassword(email, pass);

        let referrer = null;
        if (refCode) {
            try {
                const refSnap = await db.collection("users").where("customId", "==", refCode).limit(1).get();
                if (!refSnap.empty) referrer = { id: refSnap.docs[0].id, ...refSnap.docs[0].data() };
            } catch (refErr) {
                console.log("Gagal cari kode referral:", refErr.message); // tidak menghentikan proses daftar
            }
        }

        await db.collection("users").doc(cred.user.uid).set({
            customId, nama, email, hp, role: 'reseller', isActive: false, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            referredBy: referrer ? referrer.id : null,
            privacyPolicyAgreed: true,
            privacyPolicyAgreedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Catat ke koleksi referrals kalau memang diundang orang lain (dipakai oleh referral.js)
        if (referrer) {
            db.collection("referrals").add({
                referrerId: referrer.id, referrerName: referrer.nama,
                newUserId: cred.user.uid, newUserName: nama,
                status: "pending", pointsAwarded: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(err => console.log("Gagal catat referral:", err.message));
        }

        // Kirim ke running text (activityFeed) - tidak menghentikan proses jika gagal
        db.collection("activityFeed").add({
            type: "register",
            nama,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.log("Gagal update activityFeed:", err.message));

        alert("Berhasil! ID: " + customId);
        window.open(`https://wa.me/62895345452412?text=Halo Admin, aktivasi akun ID: ${customId}`, '_blank');
        auth.signOut(); 
    } catch (err) { alert("Gagal Daftar: " + err.message); }
}

// --- 5. RESELLER DATA LOGIC ---
function loadResellerData() {
    const startDate = document.getElementById("filterStart")?.value;
    const endDate = document.getElementById("filterEnd")?.value;

    db.collection("orders").where("resellerId", "==", currentUser.id).onSnapshot(sOrders => {
        db.collection("redemptions").where("resellerId", "==", currentUser.id).where("status", "==", "Selesai").onSnapshot(sRedeems => {
            
            let totalSpendingAllTime = 0;
            let totalTodayRupiah = 0;
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const todayEnd = todayStart + (24 * 60 * 60 * 1000) - 1;

            let allDocs = sOrders.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            allDocs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            
            allDocs.forEach(o => {
                const createdDate = o.createdAt ? o.createdAt.toDate() : new Date();
                const createdTime = createdDate.getTime();
                if(o.status === 'Selesai') { 
                    totalSpendingAllTime += (o.total || 0); 
                    if (createdTime >= todayStart && createdTime <= todayEnd) totalTodayRupiah += (o.total || 0);
                }
            });

            let usedPoints = 0;
sRedeems.docs.forEach(d => { usedPoints += (d.data().points || 0); });

// Ambil bonus dari data user
const bonus = currentUser.bonusPoints || 0;

// Update rumus: Belanja + Bonus - Poin yang sudah ditukar
currentPointsVal = Math.floor(totalSpendingAllTime / 100) - usedPoints + bonus;
            if(document.getElementById("resTotalToday")) document.getElementById("resTotalToday").innerText = "Rp " + totalTodayRupiah.toLocaleString('id-ID');
            document.getElementById("resPoin").innerText = currentPointsVal.toLocaleString('id-ID');
            document.getElementById("displayMyPoints").innerText = currentPointsVal.toLocaleString('id-ID');

            // Kotak "Order" (total semua order) dan "Status Order" (jumlah yang masih pending)
            const resOrderCountEl = document.getElementById("resOrderCount");
            if (resOrderCountEl) resOrderCountEl.innerText = allDocs.length;
            const pendingCountReseller = allDocs.filter(o => o.status === 'pending').length;
            const resOrderPendingEl = document.getElementById("resOrderPending");
            if (resOrderPendingEl) resOrderPendingEl.innerText = pendingCountReseller + " Pending";

            let filteredDocs = [];
            if (startDate && endDate) {
                const startRange = new Date(startDate).setHours(0, 0, 0, 0);
                const endRange = new Date(endDate).setHours(23, 59, 59, 999);
                filteredDocs = allDocs.filter(o => {
                    const time = o.createdAt ? o.createdAt.toDate().getTime() : Date.now();
                    return time >= startRange && time <= endRange;
                });
            } else {
                filteredDocs = allDocs.filter(o => {
                    const time = o.createdAt ? o.createdAt.toDate().getTime() : Date.now();
                    return time >= todayStart && time <= todayEnd;
                });
                if(filteredDocs.length === 0) filteredDocs = allDocs.slice(0, 10);
            }

            const tableBody = document.getElementById("resellerOrderTable");
            if (tableBody) {
                if (filteredDocs.length > 0) {
                    tableBody.innerHTML = filteredDocs.map(o => {
                        let statusColor = o.status === 'Selesai' ? "#27ae60" : (o.status === 'Dibatalkan' ? "#c0392b" : "#f39c12");
                        return `<tr>
                            <td><small style="font-weight:bold; color:#d4af37;">${o.orderId || 'PROSES'}</small></td>
                            <td>${o.produk}</td>
                            <td>Rp ${(o.total || 0).toLocaleString('id-ID')}</td>
                            <td><span style="color:${statusColor}; font-weight:800;">${o.status || 'pending'}</span></td>
                        </tr>`;
                    }).join('');
                } else {
                    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#666;">Belum ada pesanan.</td></tr>';
                }
            }

            // --- Modal "Belanja Hari Ini" (dari filteredDocs, default = order hari ini) ---
            const modalBelanja = document.getElementById("modalBelanjaBody");
            if (modalBelanja) {
                if (filteredDocs.length > 0) {
                    const totalBelanja = filteredDocs.reduce((s, o) => s + (o.total || 0), 0);
                    modalBelanja.innerHTML = filteredDocs.map(o => `
                        <div class="dtable-row">
                            <div><div class="nm">${o.produk}</div><div class="sub">${o.orderId || '-'}</div></div>
                            <div class="price">Rp ${(o.total || 0).toLocaleString('id-ID')}</div>
                        </div>
                    `).join('') + `<div class="dtable-row" style="border-top:3px solid #241A10; margin-top:6px; padding-top:12px;"><div class="nm">TOTAL</div><div class="price" style="font-size:15px;">Rp ${totalBelanja.toLocaleString('id-ID')}</div></div>`;
                } else {
                    modalBelanja.innerHTML = `<p style="text-align:center; color:#999; padding:20px 0;">Belum ada pesanan hari ini.</p>`;
                }
            }

            // --- Modal "Status Pesanan" (semua order, terbaru dulu) ---
            const modalStatus = document.getElementById("modalStatusBody");
            if (modalStatus) {
                if (allDocs.length > 0) {
                    modalStatus.innerHTML = allDocs.slice(0, 20).map(o => {
                        const isSelesai = o.status === 'Selesai';
                        return `<div class="status-pill-row">
                            <div><div class="nm" style="font-size:12.5px;font-weight:800;">${o.orderId || '-'}</div><div class="sub" style="font-size:10.5px;color:#8a7a66;">${o.produk}</div></div>
                            <span class="status-chip ${isSelesai ? 'selesai' : 'pending'}">${isSelesai ? 'Selesai' : 'Pending'}</span>
                        </div>`;
                    }).join('');
                } else {
                    modalStatus.innerHTML = `<p style="text-align:center; color:#999; padding:20px 0;">Belum ada pesanan.</p>`;
                }
            }
        });
    });
}

function resetOrderFilter() {
    document.getElementById("filterStart").value = "";
    document.getElementById("filterEnd").value = "";
    loadResellerData();
}

function scrollToCard(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openDashModal(name) {
    document.getElementById("dmodal-" + name)?.classList.add("open");
}
function closeDashModal(name) {
    document.getElementById("dmodal-" + name)?.classList.remove("open");
}

async function openRiwayatTukarPoin() {
    const body = document.getElementById("modalRiwayatPoinBody");
    if (body) body.innerHTML = `<p style="text-align:center; color:#999; padding:20px 0;">Memuat riwayat...</p>`;
    openDashModal('riwayatpoin');

    try {
        // Sengaja TIDAK pakai .orderBy() di query (biar tidak butuh composite index Firestore).
        // Urutan terbaru-dulu dikerjakan di JS setelah data didapat.
        const snap = await db.collection("redemptions")
            .where("resellerId", "==", currentUser.id)
            .get();

        if (snap.empty) {
            body.innerHTML = `<p style="text-align:center; color:#999; padding:20px 0;">Belum ada riwayat tukar poin.</p>`;
            return;
        }

        const docs = snap.docs.map(d => d.data())
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        body.innerHTML = docs.map(r => {
            const isSelesai = r.status === 'Selesai';
            const tgl = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
            return `<div class="status-pill-row">
                <div>
                    <div class="nm" style="font-size:12.5px;font-weight:800;">${r.kode || '-'}</div>
                    <div class="sub" style="font-size:10.5px;color:#8a7a66;">${tgl} · ${(r.points || 0).toLocaleString('id-ID')} Poin</div>
                </div>
                <span class="status-chip ${isSelesai ? 'selesai' : 'pending'}">${isSelesai ? 'Selesai' : 'Pending'}</span>
            </div>`;
        }).join('');
    } catch (err) {
        body.innerHTML = `<p style="text-align:center; color:#c0392b; padding:20px 0;">Gagal memuat riwayat: ${err.message}</p>`;
    }
}
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".dmodal-overlay").forEach(ov => {
        ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("open"); });
    });
});

// --- 5B. CHECKLIST HARIAN (7 hari mengikuti kalender, Senin-Minggu) ---
let checklistData = { checkedDates: {}, bonusWeeks: {} };
let checklistAttached = false;

function getMondayOf(d) {
    const date = new Date(d);
    const day = date.getDay(); // 0=Minggu ... 6=Sabtu
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
}
function fmtDateKey(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function getCurrentWeekDates() {
    const monday = getMondayOf(new Date());
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
}

function syncChecklist() {
    if (checklistAttached || !currentUser) return;
    checklistAttached = true;
    db.collection("checklists").doc(currentUser.id).onSnapshot(doc => {
        checklistData = doc.exists ? (doc.data() || {}) : {};
        if (!checklistData.checkedDates) checklistData.checkedDates = {};
        if (!checklistData.bonusWeeks) checklistData.bonusWeeks = {};
        renderChecklistUI();
        maybeShowChecklistModal();
    });
}

function buildChecklistCardHTML() {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayKey = fmtDateKey(today);
    const week = getCurrentWeekDates();
    const weekKey = fmtDateKey(week[0]);
    const dayLabels = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'];

    let checkedCount = 0, missedExists = false;
    const boxesHtml = week.map(d => {
        const key = fmtDateKey(d);
        const isChecked = !!checklistData.checkedDates[key];
        const isToday = key === todayKey;
        const isPast = d < todayStart;
        if (isChecked) checkedCount++;

        let cls = 'day-future', icon = '•', pointTag = '';
        if (isChecked) { cls = 'day-done'; icon = '✓'; pointTag = '<span class="point-tag">+5</span>'; }
        else if (isToday) { cls = 'day-today'; icon = '👆'; }
        else if (isPast) { cls = 'day-missed'; icon = '✕'; missedExists = true; }
        return `<div class="day-box ${cls}"><span class="date-num">${d.getDate()}</span><span class="status-icon">${icon}</span>${pointTag}</div>`;
    }).join('');

    const bonusClaimed = !!checklistData.bonusWeeks[weekKey];
    const alreadyCheckedToday = !!checklistData.checkedDates[todayKey];
    const progressPct = Math.round((checkedCount / 7) * 100);

    let bannerHtml;
    if (bonusClaimed) {
        bannerHtml = `<div class="bonus-banner" style="background:linear-gradient(135deg,#4a3812,#2a1e0a);">
            <div class="icon">🏆</div>
            <div class="txt"><div class="title">Bonus 100 Poin Cair!</div><div class="desc">Minggu ini lengkap 7 hari. Checklist baru dimulai minggu depan.</div></div>
        </div>`;
    } else if (missedExists) {
        bannerHtml = `<div class="warning-card">
            <div class="icon">⚠️</div>
            <div class="title">Bonus Minggu Ini Hangus</div>
            <div class="desc">Ada hari yang terlewat, jadi bonus 100 poin tidak bisa didapat minggu ini. Poin harian yang sudah kekumpul tetap aman. Checklist otomatis mulai ulang minggu depan.</div>
        </div>`;
    } else {
        bannerHtml = `<div class="bonus-banner">
            <div class="icon">🎁</div>
            <div class="txt"><div class="title">Bonus 100 Poin Menanti!</div><div class="desc">Selesaikan checklist 7 hari berturut-turut tanpa bolong untuk klaim bonusnya.</div></div>
        </div>`;
    }

    const btnHtml = alreadyCheckedToday
        ? `<button class="btn-checkin" disabled style="opacity:0.5;">✅ SUDAH CHECKLIST HARI INI</button>`
        : `<button class="btn-checkin" onclick="checkInToday()">✅ CHECKLIST HARI INI</button>`;

    return `
        <div class="week-label">${dayLabels.map(l => `<span>${l}</span>`).join('')}</div>
        <div class="week-row">${boxesHtml}</div>
        <div class="progress-row">
            <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${progressPct}%;"></div></div>
            <span class="progress-txt">${checkedCount}/7 Hari</span>
        </div>
        <div class="points-earned">Poin dari checklist minggu ini: <b>${checkedCount * 5}${bonusClaimed ? ' + 100' : ''}</b></div>
        ${bannerHtml}
        ${btnHtml}
    `;
}

function renderChecklistUI() {
    const html = buildChecklistCardHTML();
    const sec = document.getElementById("checklistSectionBody");
    if (sec) sec.innerHTML = html;
    const modalBody = document.getElementById("checklistModalBody");
    if (modalBody) modalBody.innerHTML = html;
}

async function checkInToday() {
    const todayKey = fmtDateKey(new Date());
    const weekDates = getCurrentWeekDates();
    const weekKey = fmtDateKey(weekDates[0]);
    const isLastDayOfWeek = fmtDateKey(weekDates[6]) === todayKey;

    const checklistRef = db.collection("checklists").doc(currentUser.id);
    const userRef = db.collection("users").doc(currentUser.id);

    try {
        let bonusAmount = 0;
        await db.runTransaction(async (t) => {
            // 1) SEMUA PEMBACAAN DULU
            const cSnap = await t.get(checklistRef);
            const uSnap = await t.get(userRef);

            const data = cSnap.exists ? cSnap.data() : {};
            const checkedDates = { ...(data.checkedDates || {}) };
            const bonusWeeks = { ...(data.bonusWeeks || {}) };

            if (checkedDates[todayKey]) return; // sudah checklist hari ini, jangan dobel

            checkedDates[todayKey] = true;
            bonusAmount = 5;

            if (isLastDayOfWeek) {
                const allChecked = weekDates.every(d => checkedDates[fmtDateKey(d)]);
                if (allChecked && !bonusWeeks[weekKey]) {
                    bonusWeeks[weekKey] = true;
                    bonusAmount += 100;
                }
            }

            const currentBonus = uSnap.data()?.bonusPoints || 0;

            // 2) BARU SEMUA PENULISAN
            t.set(checklistRef, { checkedDates, bonusWeeks }, { merge: true });
            t.update(userRef, { bonusPoints: currentBonus + bonusAmount });
        });

        if (bonusAmount === 0) return; // sudah checklist sebelumnya
        currentUser.bonusPoints = (currentUser.bonusPoints || 0) + bonusAmount;
        closeChecklistModal();
        if (bonusAmount > 5) alert("🎉 Checklist berhasil! +5 poin harian, dan 🏆 BONUS 100 POIN karena lengkap 7 hari berturut-turut!");
        else alert("✅ Checklist hari ini berhasil! +5 poin.");
    } catch (err) {
        alert("Gagal checklist: " + err.message);
    }
}

// Modal otomatis: muncul sekali per hari kalau reseller belum checklist hari ini dan belum pernah menutupnya hari ini
function maybeShowChecklistModal() {
    if (!currentUser || currentUser.role !== 'reseller') return;
    const todayKey = fmtDateKey(new Date());
    const alreadyChecked = !!checklistData.checkedDates[todayKey];
    const dismissKey = `checklistDismissed_${currentUser.id}_${todayKey}`;
    const alreadyDismissed = localStorage.getItem(dismissKey) === "1";
    const modal = document.getElementById("checklistModal");
    if (modal && !alreadyChecked && !alreadyDismissed) {
        modal.classList.remove("hidden");
    }
}
function closeChecklistModal() {
    document.getElementById("checklistModal").classList.add("hidden");
    const todayKey = fmtDateKey(new Date());
    localStorage.setItem(`checklistDismissed_${currentUser.id}_${todayKey}`, "1");
}

// --- 6. ADMIN DATA LOGIC ---
function loadAdminData() {
    const startDate = document.getElementById("filterAdminStart")?.value;
    const endDate = document.getElementById("filterAdminEnd")?.value;
// --- DI DALAM loadAdminData() ---

// 1. Tambahkan pengecekan suara di setiap listener (Order, Redeem, Aktivasi, dll)
// Contoh pada Order:
db.collection("orders").onSnapshot(snap => {
    const pending = snap.docs.filter(d => d.data().status === 'pending').length;
    if (lastAdminCounts.order !== -1 && pending > lastAdminCounts.order) playAdminTing();
    lastAdminCounts.order = pending;
    // ... sisa kode render tabel order
});

// 2. Listener Tabel Retur (BARU)
db.collection("returns").onSnapshot(snap => {
    const pending = snap.docs.filter(d => d.data().status === 'proses').length;
    if (lastAdminCounts.return !== -1 && pending > lastAdminCounts.return) playAdminTing();
    lastAdminCounts.return = pending;
    if(document.getElementById("badgeReturn")) document.getElementById("badgeReturn").innerText = pending;

    document.getElementById("adminReturnTable").innerHTML = snap.docs.map(d => {
        const r = d.data();
        return `<tr>
            <td><b>${d.id.substring(0,6).toUpperCase()}</b></td>
            <td>${r.produk}</td>
            <td>${r.alasan}</td>
            <td>${r.hp}</td>
            <td>${r.status === 'proses' ? `<button class="btn-adm-action" onclick="updateStat('returns','${d.id}')">Proses</button>` : '<span class="badge-selesai">Selesai</span>'}</td>
        </tr>`;
    }).join('');
});

// 3. Listener Tabel Keluhan (BARU)
db.collection("complaints").onSnapshot(snap => {
    const pending = snap.docs.filter(d => d.data().status === 'proses').length;
    if (lastAdminCounts.complaint !== -1 && pending > lastAdminCounts.complaint) playAdminTing();
    lastAdminCounts.complaint = pending;
    if(document.getElementById("badgeComplaint")) document.getElementById("badgeComplaint").innerText = pending;

    document.getElementById("adminCompTable").innerHTML = snap.docs.map(d => {
        const c = d.data();
        return `<tr>
            <td><b>${d.id.substring(0,6).toUpperCase()}</b></td>
            <td>${c.pesan}</td>
            <td>${c.hp}</td>
            <td>${c.status === 'proses' ? `<button class="btn-adm-action" onclick="updateStat('complaints','${d.id}')">Proses</button>` : '<span class="badge-selesai">Selesai</span>'}</td>
        </tr>`;
    }).join('');
});
    db.collection("users").where("role", "==", "reseller").where("isActive", "==", false).onSnapshot(snap => {
        const pending = snap.size;
        if (lastAdminCounts.activation !== -1 && pending > lastAdminCounts.activation) playAdminTing();
        lastAdminCounts.activation = pending;
        if(document.getElementById("badgeActivation")) document.getElementById("badgeActivation").innerText = pending;
    });

    db.collection("orders").onSnapshot(snap => {
        let allOrders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        allOrders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        let filtered = allOrders;
        if (startDate && endDate) {
            const startRange = new Date(startDate).setHours(0, 0, 0, 0);
            const endRange = new Date(endDate).setHours(23, 59, 59, 999);
            filtered = allOrders.filter(o => {
                const created = o.createdAt?.toDate().getTime();
                return created >= startRange && created <= endRange;
            });
        }

        let pendingCount = 0, totalUang = 0;
        document.getElementById("adminOrderTable").innerHTML = filtered.map(o => {
            if(o.status === 'pending') pendingCount++;
            if(o.status === 'Selesai') totalUang += (o.total || 0);
            const aksi = o.status === 'pending'
                ? `<button class="btn-adm-action" style="background:#eee2c9; color:#7a5a1f; margin-right:4px;" onclick="openEditOrderModal('${o.id}')">Edit</button><button class="btn-adm-action" onclick="updateStat('orders','${o.id}')">Proses</button>`
                : '<span class="badge-selesai">Selesai</span>';
            return `<tr><td>${o.resellerName}</td><td><b>${o.orderId}</b></td><td>${o.produk}</td><td>${aksi}</td></tr>`;
        }).join('');
        
        document.getElementById("badgeOrder").innerText = pendingCount;
        document.getElementById("admQty").innerText = filtered.length;
        document.getElementById("admTotal").innerText = "Rp " + totalUang.toLocaleString();

        pendingOrdersCache = filtered.filter(o => o.status === 'pending');
        const admPendingEl = document.getElementById("admPending");
        if (admPendingEl) admPendingEl.innerText = pendingOrdersCache.length;
        const pendingModal = document.getElementById("pendingListModal");
        if (pendingModal && !pendingModal.classList.contains("hidden")) renderPendingListBody();
    });

    db.collection("redemptions").onSnapshot(snap => {
        document.getElementById("adminRedeemTable").innerHTML = snap.docs.map(d => {
            const r = d.data();
            if (r.status === 'proses') {
                return `<tr>
                    <td><b>${r.resellerName}</b></td>
                    <td>${r.points.toLocaleString()}</td>
                    <td>
                        <input type="text" id="otpVerify_${d.id}" placeholder="Kode OTP" maxlength="6" style="width:75px; padding:5px; border:1px solid #ccc; border-radius:6px; text-align:center; margin-right:4px;">
                        <button class="btn-adm-action" onclick="approveRedemptionOtp('${d.id}', '${r.otpCode || ''}')">Proses</button>
                    </td>
                </tr>`;
            }
            return `<tr><td><b>${r.resellerName}</b></td><td>${r.points.toLocaleString()}</td><td><span class="badge-selesai">Selesai</span></td></tr>`;
        }).join('');
        const pending = snap.docs.filter(d => d.data().status === 'proses').length;
        if (lastAdminCounts.redeem !== -1 && pending > lastAdminCounts.redeem) playAdminTing();
        lastAdminCounts.redeem = pending;
        document.getElementById("badgeRedeem").innerText = pending;
    });

    initPoinKeluarListener();
    initAdminOnlineListener();
}

// --- POIN KELUAR (LIABILITAS POIN ADMIN) ---
// Dipasang SEKALI SAJA (bukan nested di dalam listener lain) agar tidak menumpuk banyak
// listener Firestore setiap kali loadAdminData() dipanggil ulang (mis. saat reset filter).
// Setiap poin yang didapat reseller (dari order Selesai + bonus) mengurangi Poin Keluar admin (jadi minus).
// Setiap poin yang berhasil ditukar reseller (redemption Selesai) mengembalikan Poin Keluar admin mendekati 0.
let poinKeluarAttached = false;
let pkUsersCache = [];
let pkOrdersCache = [];
let pkRedeemsCache = [];

function recomputePoinKeluar() {
    let totalEarned = 0;
    pkUsersCache.forEach(u => {
        const bonus = u.bonusPoints || 0;
        const totalSpending = pkOrdersCache
            .filter(o => o.resellerId === u.id)
            .reduce((sum, o) => sum + (o.total || 0), 0);
        totalEarned += Math.floor(totalSpending / 100) + bonus;
    });

    let totalRedeemed = 0;
    pkRedeemsCache.forEach(r => { totalRedeemed += (r.points || 0); });

    const poinKeluar = totalRedeemed - totalEarned; // negatif = masih ada kewajiban poin ke reseller
    const el = document.getElementById("admPoin");
    if (el) el.innerText = poinKeluar.toLocaleString('id-ID');
}

function initPoinKeluarListener() {
    if (poinKeluarAttached) return;
    poinKeluarAttached = true;

    db.collection("users").where("role", "==", "reseller").onSnapshot(snap => {
        pkUsersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        recomputePoinKeluar();
    }, err => console.error("Poin Keluar - gagal memuat data users:", err.message));

    db.collection("orders").where("status", "==", "Selesai").onSnapshot(snap => {
        pkOrdersCache = snap.docs.map(d => d.data());
        recomputePoinKeluar();
    }, err => console.error("Poin Keluar - gagal memuat data orders:", err.message));

    db.collection("redemptions").where("status", "==", "Selesai").onSnapshot(snap => {
        pkRedeemsCache = snap.docs.map(d => d.data());
        recomputePoinKeluar();
    }, err => console.error("Poin Keluar - gagal memuat data redemptions:", err.message));
}

function resetAdminOrderFilter() {
    document.getElementById("filterAdminStart").value = "";
    document.getElementById("filterAdminEnd").value = "";
    loadAdminData();
}

// --- 7. HISTORY & LEADERBOARD ---
function loadResellerHistory() {
    db.collection("returns").where("resellerId", "==", currentUser.id).onSnapshot(s => {
        document.getElementById("resellerReturnHistory").innerHTML = s.docs.map(doc => {
            const d = doc.data();
            return `<tr><td>${d.produk}</td><td>${d.alasan}</td><td>${d.hp}</td><td style="color:${d.status === 'Selesai' ? 'green' : 'orange'}">${d.status}</td></tr>`;
        }).join('');
    });
    db.collection("complaints").where("resellerId", "==", currentUser.id).onSnapshot(s => {
        document.getElementById("resellerCompHistory").innerHTML = s.docs.map(doc => {
            const d = doc.data();
            return `<tr><td>${d.nama}</td><td>${d.pesan}</td><td>${d.hp}</td><td style="color:${d.status === 'Selesai' ? 'green' : 'orange'}">${d.status}</td></tr>`;
        }).join('');
    });
}

function loadResellerLeaderboard() {
    db.collection("users").where("role", "==", "reseller").onSnapshot(sUsers => {
        db.collection("orders").where("status", "==", "Selesai").onSnapshot(sOrders => {
            const allOrders = sOrders.docs.map(d => d.data());
            allRankings = sUsers.docs.map(u => {
                const total = allOrders.filter(o => o.resellerId === u.id).reduce((sum, o) => sum + (o.total || 0), 0);
                return { 
                    id: u.id, 
                    nama: u.data().nama, 
                    poin: Math.floor(total / 100) + (u.data().bonusPoints || 0) // LEADERBOARD DENGAN BONUS
                };
            }).sort((a, b) => b.poin - a.poin);

            const myRankIndex = allRankings.findIndex(r => r.id === currentUser.id);
            if(document.getElementById("resMyRank")) document.getElementById("resMyRank").innerText = myRankIndex !== -1 ? "#" + (myRankIndex + 1) : "-";
            renderRankTable();
        });
    });
}

function renderRankTable() {
    const startIdx = currentRankPage * 10;
    const pageData = allRankings.slice(startIdx, startIdx + 10);
    const oldTable = document.getElementById("resellerLeaderboardTable");
    if (oldTable) {
        oldTable.innerHTML = pageData.map((res, i) => `
            <tr><td>${startIdx + i + 1}</td><td>${res.nama}</td><td style="text-align:right"><b>${res.poin.toLocaleString()} Poin</b></td></tr>
        `).join('') || '<tr><td colspan="3">Memuat...</td></tr>';
    }
    if(document.getElementById("rankPageInfo")) document.getElementById("rankPageInfo").innerText = `Rangking ${startIdx + 1} - ${Math.min(startIdx + 10, allRankings.length)}`;

    // --- Modal "Live Peringkat" (top 10, highlight posisi kita) ---
    const modalPeringkat = document.getElementById("modalPeringkatBody");
    if (modalPeringkat) {
        const top10 = allRankings.slice(0, 10);
        modalPeringkat.innerHTML = top10.map((res, i) => {
            const isMe = res.id === currentUser.id;
            return `<div class="rank-row ${isMe ? 'me' : ''}">
                <div class="rank-num">${i + 1}</div>
                <div class="rank-info"><div class="rank-nm">${res.nama}${isMe ? ' (Kamu)' : ''}</div><div class="rank-pt">${res.poin.toLocaleString('id-ID')} Poin</div></div>
            </div>`;
        }).join('') || `<p style="text-align:center; color:#999; padding:20px 0;">Belum ada data peringkat.</p>`;
    }
}

function changeRankPage(dir) {
    if (dir === 1 && (currentRankPage + 1) * 10 < allRankings.length) currentRankPage++;
    else if (dir === -1 && currentRankPage > 0) currentRankPage--;
    renderRankTable();
}

// --- 8. CATALOG MANAGEMENT ---
function syncCatalog() {
    db.collection("products").orderBy("kategori").onSnapshot(s => {
        catalog = s.docs.map(d => ({ id: d.id, ...d.data() }));
        renderCategoryChips();
        renderProductList();

        if (currentUser && currentUser.role === 'admin') {
            renderAdminCatChips();
            renderAdminCatalogList();

            const admStockEl = document.getElementById("admStockCount");
            if (admStockEl) admStockEl.innerText = catalog.filter(p => !isHabis(p)).length;
            const stockModal = document.getElementById("stockListModal");
            if (stockModal && !stockModal.classList.contains("hidden")) renderStockListBody('semua');
        }
    });
}

let ordActiveCat = "Semua";

function renderCategoryChips() {
    const chipRow = document.getElementById("ordCategoryChips");
    if (!chipRow) return;
    const cats = ["Semua", ...new Set(catalog.map(p => p.kategori || "Umum"))];
    if (!cats.includes(ordActiveCat)) ordActiveCat = "Semua";
    chipRow.innerHTML = cats.map(c => `<div class="ord-chip ${c === ordActiveCat ? 'active' : ''}" onclick="selectOrdCategory('${c}')">${c}</div>`).join('');
}

function selectOrdCategory(c) {
    ordActiveCat = c;
    renderCategoryChips();
    renderProductList();
}

// --- KATALOG ADMIN (list card) ---
let admCatActiveCat = "Semua";

function renderAdminCatChips() {
    const chipRow = document.getElementById("admCatChips");
    if (!chipRow) return;
    const cats = ["Semua", ...new Set(catalog.map(p => p.kategori || "Umum"))];
    if (!cats.includes(admCatActiveCat)) admCatActiveCat = "Semua";
    chipRow.innerHTML = cats.map(c => `<div class="ord-chip ${c === admCatActiveCat ? 'active' : ''}" onclick="selectAdminCatChip('${c}')">${c}</div>`).join('');
}

function selectAdminCatChip(c) {
    admCatActiveCat = c;
    renderAdminCatChips();
    renderAdminCatalogList();
}

function renderAdminCatalogList() {
    const listEl = document.getElementById("adminCatalogList");
    if (!listEl) return;
    const search = (document.getElementById("admCatSearchInput")?.value || "").toLowerCase();
    let list = catalog.filter(p => (admCatActiveCat === "Semua" || p.kategori === admCatActiveCat) && p.nama.toLowerCase().includes(search));

    // Ringkasan dihitung dari SELURUH katalog, bukan hasil filter, biar tetap jadi acuan global
    document.getElementById("sumTotal").innerText = catalog.length;
    document.getElementById("sumOk").innerText = catalog.filter(p => !isHabis(p) && getStock(p) > 9).length;
    document.getElementById("sumLow").innerText = catalog.filter(p => !isHabis(p) && getStock(p) <= 9).length;
    document.getElementById("sumOut").innerText = catalog.filter(p => isHabis(p)).length;

    if (list.length === 0) {
        listEl.innerHTML = `<p style="text-align:center;color:#999;font-size:12px;padding:20px 0;">Produk tidak ditemukan.</p>`;
        return;
    }

    listEl.innerHTML = list.map(p => {
        const habis = isHabis(p);
        const stock = getStock(p);
        const stockClass = habis ? 'stock-out' : (stock <= 9 ? 'stock-low' : 'stock-ok');
        const stockLabel = habis ? 'Habis' : `Stok ${stock}`;
        return `<div class="p-row ${habis ? 'out' : ''}">
                    <div class="p-info">
                        <div class="p-name">${p.nama}</div>
                        <div class="p-meta">
                            <span class="p-price">Rp ${p.harga.toLocaleString()}</span>
                            <span class="dot">•</span><span class="p-cat">${p.kategori}</span>
                            <span class="dot">•</span><span class="stock-tag ${stockClass}">${stockLabel}</span>
                        </div>
                    </div>
                    <div class="p-actions">
                        <button class="btn-edit-icon" onclick="editProduct('${p.id}')">✏️</button>
                        <button class="btn-del-icon" onclick="if(confirm('Hapus ${p.nama.replace(/'/g, "\\'")}?')) db.collection('products').doc('${p.id}').delete()">🗑️</button>
                    </div>
                </div>`;
    }).join('');
}

function deleteCurrentProduct() {
    const id = document.getElementById("adminProdId").value;
    if (!id) return;
    const nama = document.getElementById("adminProdName").value || "produk ini";
    if (confirm(`Hapus ${nama}?`)) {
        db.collection("products").doc(id).delete();
        resetProductForm();
    }
}

function updateProductPreview() {
    const nama = document.getElementById("adminProdName").value || "Nama produk...";
    const kategori = document.getElementById("adminProdCat").value || "Kategori";
    const harga = parseInt(document.getElementById("adminProdPrice").value) || 0;
    const stockRaw = document.getElementById("adminProdStock").value;
    const stock = stockRaw === "" ? 0 : parseInt(stockRaw);

    document.getElementById("pvName").innerText = nama;
    document.getElementById("pvCat").innerText = kategori;
    document.getElementById("pvPrice").innerText = "Rp " + harga.toLocaleString();

    const pvStock = document.getElementById("pvStock");
    const habis = !(stock > 0);
    pvStock.innerText = habis ? "Habis" : `Stok ${stock}`;
    pvStock.className = "stock-tag " + (habis ? "stock-out" : (stock <= 9 ? "stock-low" : "stock-ok"));
}

// --- 9. ORDERING SYSTEM ---
function getCartQty(pid) {
    const item = cart.find(i => i.pid === pid);
    return item ? item.qty : 0;
}

function renderProductList() {
    const listEl = document.getElementById("ordProductList");
    if (!listEl) return;
    const search = (document.getElementById("ordSearchInput")?.value || "").toLowerCase();
    let list = catalog.filter(p => (ordActiveCat === "Semua" || p.kategori === ordActiveCat) && p.nama.toLowerCase().includes(search));

    if (list.length === 0) {
        listEl.innerHTML = `<p style="text-align:center;color:#999;font-size:12px;padding:20px 0;">Produk tidak ditemukan.</p>`;
        return;
    }

    listEl.innerHTML = list.map(p => {
        const habis = isHabis(p);
        const stock = getStock(p);
        const stockClass = habis ? 'stock-out' : (stock <= 9 ? 'stock-low' : 'stock-ok');
        const stockLabel = habis ? 'Habis' : `Stok ${stock}`;
        const qty = getCartQty(p.id);
        return `<div class="p-row ${habis ? 'disabled' : ''}">
                    <div class="p-info">
                        <div class="p-name">${p.nama}</div>
                        <div class="p-meta">
                            <span class="p-price">Rp ${p.harga.toLocaleString()}</span>
                            <span class="p-dot">•</span><span class="stock-tag ${stockClass}">${stockLabel}</span>
                        </div>
                    </div>
                    <div class="qty-stepper">
                        <button type="button" onclick="decProduct('${p.id}')" ${qty <= 0 ? 'disabled' : ''}>−</button>
                        <span class="p-qty-val" data-pid="${p.id}">${qty}</span>
                        <button type="button" onclick="incProduct('${p.id}')" ${habis ? 'disabled' : ''}>+</button>
                    </div>
                </div>`;
    }).join('');
}

function updateProductRow(pid) {
    const span = document.querySelector(`.p-qty-val[data-pid="${pid}"]`);
    if (!span) return;
    const qty = getCartQty(pid);
    span.textContent = qty;
    const row = span.closest('.p-row');
    if (row) {
        row.querySelector('.qty-stepper button:first-child').disabled = qty <= 0;
    }
}

function incProduct(pid) {
    const p = catalog.find(x => x.id === pid);
    if (!p) return;
    if (isHabis(p)) return alert(`Maaf, ${p.nama} sedang habis.`);

    let item = cart.find(i => i.pid === pid);
    const currentQty = item ? item.qty : 0;
    const stock = getStock(p);
    if (currentQty + 1 > stock) return alert(`Stock ${p.nama} tersisa ${stock}. Tidak bisa tambah lagi.`);

    if (item) { item.qty++; item.subtotal = item.qty * p.harga; }
    else { cart.push({ pid, nama: p.nama, qty: 1, subtotal: p.harga }); }

    renderCart();
    updateProductRow(pid);
}

function decProduct(pid) {
    const item = cart.find(i => i.pid === pid);
    if (!item) return;
    item.qty--;
    if (item.qty <= 0) {
        cart = cart.filter(i => i.pid !== pid);
    } else {
        const p = catalog.find(x => x.id === pid);
        item.subtotal = item.qty * (p ? p.harga : 0);
    }
    renderCart();
    updateProductRow(pid);
}


function renderCart() {
    const tb = document.getElementById("cartTableBody"); let t = 0;
    tb.innerHTML = cart.map((item, index) => { t += item.subtotal; return `<tr><td>${item.nama} (${item.qty}x)</td><td>Rp ${item.subtotal.toLocaleString()}</td><td onclick="removeCartItem(${index})" style="color:red;cursor:pointer">X</td></tr>`; }).join('');
    document.getElementById("cartTotalText").innerText = "Total: Rp " + t.toLocaleString();
}

function removeCartItem(index) {
    const item = cart[index];
    if (!item) return;
    cart.splice(index, 1);
    renderCart();
    updateProductRow(item.pid);
}

document.getElementById("orderFormFinal").onsubmit = async (e) => {
    e.preventDefault();
    const orderNo = generateOrderId();
    const cust = document.getElementById("ordCustomer").value;
    const hp = document.getElementById("ordHp").value;
    const pay = document.getElementById("ordPayment").value;
    const total = cart.reduce((s, i) => s + i.subtotal, 0);
    const detail = cart.map(i => `${i.nama} (${i.qty}x)`).join(", ");
    const detailWA = cart.map(i => `- ${i.nama} (${i.qty}x)`).join("%0A");

    try {
        await db.runTransaction(async (t) => {
            const refs = cart.map(i => db.collection("products").doc(i.pid));
            const snaps = await Promise.all(refs.map(r => t.get(r)));

            // Cek ulang stock TERBARU (bisa saja berubah sejak list dimuat)
            // Stock 0 atau belum diisi = dianggap habis, order ditolak
            for (let idx = 0; idx < cart.length; idx++) {
                const stockNow = typeof snaps[idx].data()?.stock === 'number' ? snaps[idx].data().stock : 0;
                if (stockNow < cart[idx].qty) {
                    throw new Error(`Stock ${cart[idx].nama} tinggal ${stockNow}, tidak cukup untuk pesanan ini.`);
                }
            }
            // Potong stock
            snaps.forEach((snap, idx) => {
                const stockNow = typeof snap.data()?.stock === 'number' ? snap.data().stock : 0;
                t.update(refs[idx], { stock: stockNow - cart[idx].qty });
            });
            // Simpan order
            const orderRef = db.collection("orders").doc();
            t.set(orderRef, {
                orderId: orderNo, resellerId: currentUser.id, resellerName: currentUser.nama,
                customerName: cust, customerHp: hp, produk: detail, total,
                items: cart.map(i => ({ pid: i.pid, nama: i.nama, qty: i.qty, harga: Math.round(i.subtotal / i.qty), subtotal: i.subtotal })),
                jumlah: cart.reduce((s, i) => s + i.qty, 0), metode: pay, status: "pending",
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        const waText = `*PESANAN BARU*%0AOrder: ${orderNo}%0APenerima: ${cust}%0AMetode Pembayaran: ${pay}%0AProduk:%0A${detailWA}%0ATotal: Rp ${total.toLocaleString()}`;
        closeOrderModal();

        // Cek syarat referral: kalau akun ini didaftarkan pakai kode referral & belanja ini >= Rp 50.000, cairkan poin ke pengundang
        if (typeof processReferralQualifyingOrder === 'function') {
            processReferralQualifyingOrder(currentUser.id, total).catch(err => console.log("Referral order bonus gagal:", err.message));
        }

        window.open(`https://wa.me/62895345452412?text=${waText}`, '_blank');
    } catch(err) { alert("Gagal: " + err.message); }
};

// --- 10. REDEEM POINTS SYSTEM ---
const REDEEM_OPTIONS = [25000,50000,100000,200000,300000,400000,500000,600000,700000,800000,900000,1000000];

function renderRedeemVouchers() {
    const grid = document.getElementById("redeemVoucherGrid");
    if (!grid) return;
    grid.innerHTML = REDEEM_OPTIONS.map(amt => {
        const disabled = currentPointsVal < amt;
        return `<div class="voucher ${disabled ? 'disabled' : ''}" onclick="selectRedeemVoucher(${amt}, this)">
                    <div class="v-top"><span class="v-icon">🎟️</span><span class="v-check"></span></div>
                    <div class="v-dashed"></div>
                    <div class="v-nominal">${amt.toLocaleString('id-ID')}<small>${disabled ? 'POIN KURANG' : 'VOUCHER'}</small></div>
                </div>`;
    }).join('');
    document.getElementById("redeemAmountSelect").value = "";
}

function selectRedeemVoucher(amt, el) {
    if (el.classList.contains('disabled')) return;
    document.querySelectorAll('#redeemVoucherGrid .voucher').forEach(v => v.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById("redeemAmountSelect").value = amt;
}

function openRedeemModal() { 
    document.getElementById("redeemModal").classList.remove("hidden"); 
    document.getElementById("displayMyPoints").innerText = currentPointsVal.toLocaleString();
    renderRedeemVouchers();
    goToRedeemStep1(); 
}
function goToRedeemStep1() { document.getElementById("redeemStep1").classList.remove("hidden"); document.getElementById("redeemStep2").classList.add("hidden"); document.getElementById("redeemStep3").classList.add("hidden"); }
function goToRedeemStep2() { 
    const raw = document.getElementById("redeemAmountSelect").value;
    if (!raw) return alert("Pilih nominal voucher dulu.");
    const amt = parseInt(raw);
    if(currentPointsVal < amt) return alert("Poin tidak cukup!");
    document.getElementById("redName").value = currentUser.nama;
    document.getElementById("redWa").value = currentUser.hp;
    document.getElementById("redeemStep1").classList.add("hidden");
    document.getElementById("redeemStep3").classList.add("hidden");
    document.getElementById("redeemStep2").classList.remove("hidden");
}

let currentRedeemOTP = null;
function goToRedeemStep3() {
    const np = document.getElementById("redName").value;
    const wp = document.getElementById("redWa").value;
    if (!np || !wp) return alert("Lengkapi nama dan nomor WhatsApp dulu.");

    document.getElementById("redeemStep2").classList.add("hidden");
    document.getElementById("redeemStep3").classList.remove("hidden");
    document.getElementById("redOtpInput").value = "";
    sendOtpToEmail();
}

function sendOtpToEmail() {
    // Generate kode OTP 6 digit baru tiap kirim/kirim ulang
    currentRedeemOTP = String(Math.floor(100000 + Math.random() * 900000));

    const statusEl = document.getElementById("otpStatusText");
    const resendBtn = document.getElementById("btnResendOtp");
    const emailMasked = maskEmail(currentUser.email);

    if (typeof emailjs === 'undefined') {
        statusEl.innerHTML = `⚠️ Layanan email belum aktif (EmailJS belum terpasang). Hubungi admin.`;
        return;
    }

    statusEl.innerText = "Mengirim kode OTP ke email kamu...";
    if (resendBtn) resendBtn.disabled = true;

    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        to_email: currentUser.email,
        to_name: currentUser.nama,
        otp_code: currentRedeemOTP
    }).then(() => {
        statusEl.innerHTML = `✅ Kode OTP sudah dikirim ke <b>${emailMasked}</b>. Cek inbox (atau folder spam), lalu masukkan kodenya di bawah.`;
        if (resendBtn) resendBtn.disabled = false;
    }).catch((err) => {
        statusEl.innerHTML = `❌ Gagal mengirim email OTP. Coba "Kirim Ulang Kode" atau hubungi admin.`;
        console.log("EmailJS error:", err);
        if (resendBtn) resendBtn.disabled = false;
    });
}

function maskEmail(email) {
    if (!email || !email.includes('@')) return email || '';
    const [name, domain] = email.split('@');
    if (name.length <= 2) return name[0] + '***@' + domain;
    return name.substring(0, 2) + '***@' + domain;
}

document.getElementById("formRedeemPoints").onsubmit = async (e) => {
    e.preventDefault();
    const amt = parseInt(document.getElementById("redeemAmountSelect").value);
    const np = document.getElementById("redName").value;
    const wp = document.getElementById("redWa").value;
    const otpInput = document.getElementById("redOtpInput").value.trim();

    if (!currentRedeemOTP || otpInput !== currentRedeemOTP) {
        return alert("Kode OTP tidak cocok. Pastikan kamu memasukkan kode yang sama seperti yang ditampilkan.");
    }

    try {
        const redeemCode = "RDM-" + Math.random().toString(36).substring(2, 7).toUpperCase();
        await db.collection("redemptions").add({
            resellerId: currentUser.id, resellerName: currentUser.nama, points: amt,
            namaPenerima: np, whatsapp: wp, status: "proses", otpCode: currentRedeemOTP,
            kode: redeemCode,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert("Berhasil! Menunggu konfirmasi admin.");
        currentRedeemOTP = null;
        closeRedeemModal();
        window.open(`https://wa.me/62895345452412?text=Penukaran Poin ${amt} - ${np} (OTP: ${otpInput})`, '_blank');
    } catch (err) { alert("Error: " + err.message); }
};

// --- 11. ADMIN ACTIONS ---
async function activateUser(uid) {
    if(confirm("Aktifkan?")) {
        await db.collection("users").doc(uid).update({ isActive: true });

        // Catatan: poin referral SEKARANG dicairkan saat reseller baru belanja pertama kali
        // (minimal Rp 50.000), bukan lagi otomatis saat aktivasi. Lihat processReferralQualifyingOrder() di referral.js.
        
        // KIRIM PESAN AKTIVASI
        const skrg = new Date().toLocaleString('id-ID');
        await db.collection("notifications").add({
            userId: uid,
            title: "🎉 Akun Telah Aktif",
            text: `Akun kamu telah aktif, ${skrg}. Selamat bergabung di OKTSHOP17!`,
            isRead: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
}
// --- EDIT PESANAN (admin bisa kurangi qty karena ketidaksesuaian stock gudang) ---
let editingOrderId = null;
let editingOrderItems = [];

async function openEditOrderModal(orderId) {
    editingOrderId = orderId;
    const doc = await db.collection("orders").doc(orderId).get();
    if (!doc.exists) return alert("Pesanan tidak ditemukan.");
    const o = doc.data();

    document.getElementById("editOrderInfo").innerText = `${o.orderId} — ${o.resellerName}`;

    if (Array.isArray(o.items) && o.items.length > 0) {
        // Salin item ke working copy supaya bisa diubah tanpa langsung nulis ke Firestore
        editingOrderItems = o.items.map(i => ({ ...i, originalQty: i.qty }));
        renderEditOrderItems();
    } else {
        // Data order lama (sebelum fitur ini ada) tidak punya rincian per-produk
        editingOrderItems = [];
        document.getElementById("editOrderItemsBody").innerHTML = `<p style="font-size:12px; color:#c0392b; background:#fdf4f2; padding:10px; border-radius:8px;">Pesanan ini dibuat sebelum fitur Edit tersedia, jadi rincian per-produk tidak ada. Produk: <br><b>${o.produk}</b></p>`;
        document.getElementById("editOrderNewTotal").innerText = "Rp " + (o.total || 0).toLocaleString('id-ID');
    }

    document.getElementById("editOrderModal").classList.remove("hidden");
}

function closeEditOrderModal() {
    document.getElementById("editOrderModal").classList.add("hidden");
    editingOrderId = null;
    editingOrderItems = [];
}

function renderEditOrderItems() {
    const body = document.getElementById("editOrderItemsBody");
    body.innerHTML = editingOrderItems.map((it, idx) => `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; border-bottom:1px solid #eee;">
            <div style="flex:1;">
                <div style="font-size:12.5px; font-weight:700;">${it.nama}</div>
                <div style="font-size:10.5px; color:#8a7a66;">Rp ${it.harga.toLocaleString('id-ID')} / item (max ${it.originalQty}x)</div>
            </div>
            <input type="number" min="0" max="${it.originalQty}" value="${it.qty}" style="width:55px; padding:5px; border:1px solid #ccc; border-radius:6px; text-align:center;" onchange="updateEditOrderQty(${idx}, this.value)">
        </div>
    `).join('');
    updateEditOrderTotal();
}

function updateEditOrderQty(idx, val) {
    let qty = parseInt(val);
    const max = editingOrderItems[idx].originalQty;
    if (isNaN(qty) || qty < 0) qty = 0;
    if (qty > max) qty = max;
    editingOrderItems[idx].qty = qty;
    editingOrderItems[idx].subtotal = qty * editingOrderItems[idx].harga;
    renderEditOrderItems();
}

function updateEditOrderTotal() {
    const total = editingOrderItems.reduce((s, i) => s + i.subtotal, 0);
    document.getElementById("editOrderNewTotal").innerText = "Rp " + total.toLocaleString('id-ID');
}

async function saveOrderEdit(markSelesai) {
    if (!editingOrderId) return;

    try {
        if (editingOrderItems.length > 0) {
            // Hitung selisih qty yang dikurangi per produk, untuk dikembalikan ke stock gudang
            const orderRef = db.collection("orders").doc(editingOrderId);

            await db.runTransaction(async (t) => {
                const productRefs = editingOrderItems.map(i => i.pid ? db.collection("products").doc(i.pid) : null);
                const productSnaps = await Promise.all(productRefs.map(r => r ? t.get(r) : Promise.resolve(null)));

                editingOrderItems.forEach((item, idx) => {
                    const dikurangi = item.originalQty - item.qty;
                    if (dikurangi > 0 && productSnaps[idx] && productSnaps[idx].exists) {
                        const stockNow = typeof productSnaps[idx].data()?.stock === 'number' ? productSnaps[idx].data().stock : 0;
                        t.update(productRefs[idx], { stock: stockNow + dikurangi });
                    }
                });

                const newTotal = editingOrderItems.reduce((s, i) => s + i.subtotal, 0);
                const newProdukText = editingOrderItems.filter(i => i.qty > 0).map(i => `${i.nama} (${i.qty}x)`).join(", ") || "(Semua item dibatalkan)";
                const newJumlah = editingOrderItems.reduce((s, i) => s + i.qty, 0);

                t.update(orderRef, {
                    items: editingOrderItems.map(({ originalQty, ...rest }) => rest), // buang field bantu originalQty sebelum simpan
                    produk: newProdukText,
                    total: newTotal,
                    jumlah: newJumlah,
                    status: markSelesai ? "Selesai" : "pending",
                    editedByAdmin: true
                });
            });
        } else if (markSelesai) {
            // Order lama tanpa rincian item, tapi admin tetap mau langsung selesaikan
            await db.collection("orders").doc(editingOrderId).update({ status: "Selesai" });
        }

        alert(markSelesai ? "Pesanan disimpan & ditandai Selesai!" : "Perubahan pesanan disimpan.");

        // Kirim notifikasi ke reseller kalau langsung ditandai Selesai (sama seperti tombol Proses biasa)
        if (markSelesai) {
            const finalDoc = await db.collection("orders").doc(editingOrderId).get();
            const fd = finalDoc.data();
            if (fd && fd.resellerId) {
                await db.collection("notifications").add({
                    userId: fd.resellerId,
                    title: "📦 Pesanan Selesai",
                    text: `Pesanan No. Order ${fd.orderId || '-'} Telah Selesai dikonfirmasi oleh Admin. Terimakasih!`,
                    isRead: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        closeEditOrderModal();
    } catch (err) {
        alert("Gagal menyimpan perubahan: " + err.message);
    }
}

async function updateStat(coll, id) {
    if (!confirm("Tandai Selesai?")) return;
    try {
        const docRef = db.collection(coll).doc(id);
        const docSnap = await docRef.get();
        const data = docSnap.data();
        await docRef.update({ status: "Selesai" });

        let notifTitle = ""; let notifText = ""; let targetUser = data.resellerId;
        if (coll === 'orders') {
            notifTitle = "📦 Pesanan Selesai";
            notifText = `Pesanan No. Order ${data.orderId || '-'} Telah Selesai dikonfirmasi oleh Admin. Terimakasih!`;
        } else if (coll === 'redemptions') {
            notifTitle = "🎁 Penukaran Berhasil";
            notifText = `Berhasil tukar poin sejumlah ${data.points ? data.points.toLocaleString('id-ID') : '0'} Poin. Voucher/Saldo sedang dikirim.`;
        } else if (coll === 'returns') {
            notifTitle = "📥 Retur Selesai";
            notifText = `Laporan retur produk ${data.produk} Anda telah dinyatakan Selesai.`;
        }

        if (notifTitle !== "" && targetUser) {
            await db.collection("notifications").add({
                userId: targetUser,
                title: notifTitle,
                text: notifText,
                isRead: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        // Catat ke activityFeed khusus untuk tukar poin sukses -> tampil di running text
        if (coll === 'redemptions') {
            try {
                await db.collection("activityFeed").add({
                    type: "redeem",
                    nama: data.resellerName || data.namaPenerima || "Reseller",
                    poin: data.points || 0,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (feedErr) { console.log("Gagal update activityFeed:", feedErr.message); }
        }

        alert("Berhasil diperbarui & Notifikasi dikirim!");
    } catch (err) { alert("Gagal memperbarui status."); }
}

// Verifikasi kode OTP dari reseller (dikirim via WhatsApp) sebelum admin bisa proses penukaran poin
function approveRedemptionOtp(id, correctOtp) {
    const input = document.getElementById(`otpVerify_${id}`);
    const typed = input ? input.value.trim() : '';

    if (!correctOtp) {
        // Data lama sebelum fitur OTP ada — biarkan tetap bisa diproses tanpa OTP
        return updateStat('redemptions', id);
    }
    if (!typed) {
        alert("Masukkan dulu kode OTP yang dikirim reseller via WhatsApp.");
        return;
    }
    if (typed !== correctOtp) {
        alert("Kode OTP tidak cocok. Cek kembali kode yang dikirim reseller.");
        return;
    }
    updateStat('redemptions', id);
}

// --- 12. CATALOG FORM ---
function resetProductForm() {
    document.getElementById("adminProdId").value = "";
    document.getElementById("adminProductForm").reset();
    document.getElementById("formCatalogTitle").innerText = "📦 Tambah Produk Baru";
    document.getElementById("formCatalogSub").innerText = "Isi detail produk yang akan ditambahkan ke katalog";
    document.getElementById("btnCancelEdit").classList.add("hidden");
    document.getElementById("btnDeleteProduct").classList.add("hidden");
    updateProductPreview();
}
document.getElementById("adminProductForm").onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById("adminProdId").value;
    const data = {
        nama: document.getElementById("adminProdName").value,
        kategori: document.getElementById("adminProdCat").value,
        harga: parseInt(document.getElementById("adminProdPrice").value),
        stock: parseInt(document.getElementById("adminProdStock").value),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if(id) await db.collection("products").doc(id).update(data);
    else await db.collection("products").add({...data, createdAt: data.updatedAt});
    alert("Berhasil!"); resetProductForm();
};

function editProduct(id) {
    const p = catalog.find(x => x.id === id);
    if(p) {
        document.getElementById("adminProdId").value = p.id;
        document.getElementById("adminProdName").value = p.nama;
        document.getElementById("adminProdCat").value = p.kategori;
        document.getElementById("adminProdPrice").value = p.harga;
        document.getElementById("adminProdStock").value = (typeof p.stock === 'number') ? p.stock : '';
        document.getElementById("formCatalogTitle").innerText = "📝 Edit Produk";
        document.getElementById("formCatalogSub").innerText = `Mengubah data "${p.nama}"`;
        document.getElementById("btnCancelEdit").classList.remove("hidden");
        document.getElementById("btnDeleteProduct").classList.remove("hidden");
        updateProductPreview();
        document.getElementById("adminProductForm").scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

// --- 13. UI HELPERS ---
function renderSidebar() {
    const nav = document.getElementById("sidebarNav");
    const profileBox = document.getElementById("sidebarProfile");
    if (profileBox) {
        const nama = currentUser.nama || "User";
        const initial = nama.charAt(0).toUpperCase();
        const roleLabel = currentUser.role === 'admin' ? "👑 Admin" : "🧑‍💼 Reseller";
        profileBox.innerHTML = `
            <div class="sb-avatar">${initial}</div>
            <div><div class="sb-nm">${nama}</div><div class="sb-rl">${roleLabel}</div></div>
        `;
    }
    let menuItems = "";
    if (currentUser.role === 'admin') {
        menuItems = `
            <div class="nav-item" onclick="showSection('secAdminDashboard')">📊 Dashboard Admin</div>
            <div class="nav-item" onclick="showSection('secAdminActivation')">🔑 Aktivasi Reseller</div>
            <div class="nav-item" onclick="showSection('secAdminCatalog')">📦 Kelola Katalog</div>
            <div class="nav-item" onclick="showSection('secAdminRedeem')">🎁 Penukaran Poin</div>
            <div class="nav-item" onclick="showSection('secAdminReturn')">📥 Returan Masuk</div>
            <div class="nav-item" onclick="showSection('secAdminComplaint')">📢 Keluhan Masuk</div>
        `;
    }  else {
        menuItems = `
            <div class="nav-item" onclick="showSection('secResellerDashboard')">📊 Dashboard Reseller</div>
            <div class="nav-item" onclick="showSection('secResellerInbox')">📩 Kotak Masuk <span id="badgeSidebar" style="background:red; color:white; border-radius:50%; padding:2px 6px; font-size:9px; margin-left:5px; display:none;">0</span></div>
            <div class="nav-item" onclick="showSection('secResellerReturn')">📦 Retur Barang</div>
            <div class="nav-item" onclick="showSection('secResellerComplaint')">📢 Laporan Keluhan</div>
        `;
    }
    menuItems += `<div class="nav-item" onclick="showSection('secProfile')">👤 Profil Akun</div>`;
    nav.innerHTML = menuItems;
}

function showSection(id) {
    document.querySelectorAll('.app-section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(id);
    if(target) target.classList.remove('hidden');
    if(id === 'secAdminActivation') loadActivationList();
    if(id === 'secAdminRankings') loadRankings();
    toggleSidebar(false);
}

function loadActivationList() {
    db.collection("users").where("role", "==", "reseller").where("isActive", "==", false).onSnapshot(snap => {
        document.getElementById("adminActivationTable").innerHTML = snap.docs.map(doc => {
            const u = doc.data();
            return `<tr><td>${u.customId}</td><td>${u.nama}</td><td>${u.email}</td><td><button class="btn-adm-action" onclick="activateUser('${doc.id}')">AKTIFKAN</button></td></tr>`;
        }).join('');
    });
}
// Fungsi untuk membuka detail pesan
async function openMessage(id, title, text, time) {
    document.getElementById("msgModalTitle").innerText = title;
    document.getElementById("msgModalBody").innerText = text;
    document.getElementById("msgModalTime").innerText = time;
    document.getElementById("messageModal").classList.remove("hidden");

    // Tandai sebagai dibaca di database agar tidak tebal lagi
    await db.collection("notifications").doc(id).update({ isRead: true });
}

function closeMessageModal() {
    document.getElementById("messageModal").classList.add("hidden");
}
async function loadRankings() {
    const table = document.getElementById("adminRankTable");
    if (!table) return;
    const us = await db.collection("users").where("role", "==", "reseller").get();
    const os = await db.collection("orders").where("status", "==", "Selesai").get();
    const allOrders = os.docs.map(d => d.data());
    let ranks = us.docs.map(u => {
        const total = allOrders.filter(o => o.resellerId === u.id).reduce((s, o) => s + (o.total || 0), 0);
        return { nama: u.data().nama, total, poin: Math.floor(total / 100) };
    }).sort((a, b) => b.total - a.total);
    table.innerHTML = ranks.map((r, i) => `<tr><td>${i+1}</td><td>${r.nama}</td><td>${r.poin}</td><td>Rp ${r.total.toLocaleString()}</td></tr>`).join('');
}

document.getElementById("editProfileForm").onsubmit = async (e) => { e.preventDefault(); await db.collection("users").doc(currentUser.id).update({ nama: document.getElementById("profNama").value, hp: document.getElementById("profHp").value }); alert("Updated!"); };
document.getElementById("resellerReturnForm").onsubmit = async (e) => { e.preventDefault(); await db.collection("returns").add({ resellerId: currentUser.id, nama: currentUser.nama, produk: document.getElementById("retProd").value, alasan: document.getElementById("retReason").value, hp: document.getElementById("retHp").value, status: "proses", createdAt: firebase.firestore.FieldValue.serverTimestamp() }); alert("Dikirim!"); e.target.reset(); };
document.getElementById("resellerComplaintForm").onsubmit = async (e) => { e.preventDefault(); await db.collection("complaints").add({ resellerId: currentUser.id, nama: document.getElementById("compNama").value, hp: document.getElementById("compHp").value, pesan: document.getElementById("compText").value, status: "proses", createdAt: firebase.firestore.FieldValue.serverTimestamp() }); alert("Dikirim!"); e.target.reset(); };

function logout() { stopPresenceHeartbeat(); auth.signOut(); }
function toggleSidebar(f) { document.getElementById("sidebar").classList.toggle("active", f); document.getElementById("sidebarOverlay").classList.toggle("active", f); }
function switchAuth(mode) {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const tabLog = document.getElementById("tLog");
    const tabReg = document.getElementById("tReg");

    if (mode === 'login') {
        loginForm.classList.remove("hidden");
        registerForm.classList.add("hidden");
        tabLog.classList.add("active");
        tabReg.classList.remove("active");
    } else {
        loginForm.classList.add("hidden");
        registerForm.classList.remove("hidden");
        tabLog.classList.remove("active");
        tabReg.classList.add("active");
    }
}
function openOrderModal() { 
    document.getElementById("orderModal").classList.remove("hidden"); 
    cart = []; 
    renderCart(); 
    const searchInput = document.getElementById("ordSearchInput");
    if (searchInput) searchInput.value = "";
    ordActiveCat = "Semua";
    renderCategoryChips();
    renderProductList();
    goToStep1(); 
}
function closeOrderModal() { document.getElementById("orderModal").classList.add("hidden"); }
function closeRedeemModal() { document.getElementById("redeemModal").classList.add("hidden"); currentRedeemOTP = null; }
function goToStep2() { if(!cart.length) return alert("Pilih produk!"); document.getElementById("orderStep1").classList.add("hidden"); document.getElementById("orderStep2").classList.remove("hidden"); }
function goToStep1() { document.getElementById("orderStep1").classList.remove("hidden"); document.getElementById("orderStep2").classList.add("hidden"); }

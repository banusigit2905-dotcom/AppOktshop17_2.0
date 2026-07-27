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

let currentUser = null;
let catalog = [];
let cart = [];
let currentPointsVal = 0; 
let currentRankPage = 0; 
let allRankings = [];

// --- 1. AUTH LISTENER ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const doc = await db.collection("users").doc(user.uid).get();
            if (doc.exists) {
                const userData = doc.data();
                if (userData.role !== 'admin' && userData.isActive !== true) {
                    alert("Akun Anda (" + (userData.customId || 'User') + ") belum aktif.\nSilakan hubungi Admin via WhatsApp untuk aktivasi.");
                    auth.signOut();
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
        document.getElementById("appWrapper").classList.add("hidden");
        document.getElementById("loginScreen").classList.remove("hidden");
    }
});

// --- 2. INITIALIZE APP ---
function initApp() {
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("appWrapper").classList.remove("hidden");
    document.getElementById("userGreetName").innerText = currentUser.nama || "User";
    
    if(document.getElementById("customId")) document.getElementById("customId").innerText = currentUser.customId || "-";
    if(document.getElementById("profEmail")) document.getElementById("profEmail").value = currentUser.email || "";
    if(document.getElementById("profNama")) document.getElementById("profNama").value = currentUser.nama || "";
    if(document.getElementById("profHp")) document.getElementById("profHp").value = currentUser.hp || "";

    renderSidebar();
    syncCatalog();

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
    }
}

// --- 3. NOTIFICATION / INBOX SYSTEM ---
function loadNotifications() {
    db.collection("notifications")
      .where("userId", "==", currentUser.id)
      .orderBy("createdAt", "desc")
      .onSnapshot(snap => {
        const inboxList = document.getElementById("inboxList");
        const badgeInbox = document.getElementById("badgeInbox");
        const badgeSidebar = document.getElementById("badgeSidebar");
        
        let unreadCount = 0;
        let html = "";

        snap.forEach(doc => {
            const n = doc.data();
            if (!n.isRead) unreadCount++;
            
            html += `
                <div class="inbox-item ${n.isRead ? '' : 'unread'}">
                    <strong>${n.title}</strong>
                    <p class="msg-text">${n.text}</p>
                    <span class="time">${n.createdAt ? n.createdAt.toDate().toLocaleString('id-ID') : 'Baru saja'}</span>
                </div>
            `;
        });

        if(inboxList) inboxList.innerHTML = html || '<p style="text-align:center; color:#999; padding:20px;">Tidak ada pesan.</p>';
        
        // Update Badge
        if(unreadCount > 0) {
            if(badgeInbox) { badgeInbox.innerText = unreadCount; badgeInbox.style.display = "block"; }
            if(badgeSidebar) { badgeSidebar.innerText = unreadCount; badgeSidebar.style.display = "inline-block"; }
        } else {
            if(badgeInbox) badgeInbox.style.display = "none";
            if(badgeSidebar) badgeSidebar.style.display = "none";
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
    auth.signInWithEmailAndPassword(email, pass).catch(err => alert("Gagal: Email/Pass salah!"));
};

document.getElementById("registerForm").onsubmit = async (e) => {
    e.preventDefault();
    const nama = document.getElementById("regNama").value;
    const email = document.getElementById("regEmail").value;
    const pass = document.getElementById("regPassword").value;
    const hp = document.getElementById("regHp").value;
    
    const customId = nama.replace(/\s/g, '').substring(0, 4).toLowerCase() + Math.floor(10000 + Math.random() * 90000);

    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await db.collection("users").doc(cred.user.uid).set({
            customId, nama, email, hp, role: 'reseller', isActive: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert("Berhasil! ID: " + customId);
        window.open(`https://wa.me/62895345452412?text=Halo Admin, aktivasi akun ID: ${customId}`, '_blank');
        auth.signOut(); 
    } catch (err) { alert("Gagal Daftar: " + err.message); }
};

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
            currentPointsVal = Math.floor(totalSpendingAllTime / 100) - usedPoints;

            if(document.getElementById("resTotalToday")) document.getElementById("resTotalToday").innerText = "Rp " + totalTodayRupiah.toLocaleString('id-ID');
            document.getElementById("resPoin").innerText = currentPointsVal.toLocaleString('id-ID');
            document.getElementById("displayMyPoints").innerText = currentPointsVal.toLocaleString('id-ID');

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
        });
    });
}

function resetOrderFilter() {
    document.getElementById("filterStart").value = "";
    document.getElementById("filterEnd").value = "";
    loadResellerData();
}

// --- 6. ADMIN DATA LOGIC ---
function loadAdminData() {
    const startDate = document.getElementById("filterAdminStart")?.value;
    const endDate = document.getElementById("filterAdminEnd")?.value;

    db.collection("users").where("role", "==", "reseller").where("isActive", "==", false).onSnapshot(snap => {
        if(document.getElementById("badgeActivation")) document.getElementById("badgeActivation").innerText = snap.size;
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
            return `<tr><td>${o.resellerName}</td><td><b>${o.orderId}</b></td><td>${o.produk}</td><td>${o.status === 'pending' ? `<button onclick="updateStat('orders','${o.id}')">Selesai</button>` : '✅'}</td></tr>`;
        }).join('');
        
        document.getElementById("badgeOrder").innerText = pendingCount;
        document.getElementById("admQty").innerText = filtered.length;
        document.getElementById("admTotal").innerText = "Rp " + totalUang.toLocaleString();
    });

    db.collection("returns").onSnapshot(snap => {
        if(document.getElementById("badgeReturn")) document.getElementById("badgeReturn").innerText = snap.docs.filter(d => d.data().status === 'proses').length;
        document.getElementById("adminReturnTable").innerHTML = snap.docs.map(d => {
            const r = d.data();
            return `<tr><td><b>${r.nama}</b></td><td>${r.produk}</td><td>${r.alasan}</td><td>${r.hp}</td><td>${r.status === 'proses' ? `<button onclick="updateStat('returns','${d.id}')">Selesai</button>` : '✅'}</td></tr>`;
        }).join('');
    });

    db.collection("complaints").onSnapshot(snap => {
        if(document.getElementById("badgeComplaint")) document.getElementById("badgeComplaint").innerText = snap.docs.filter(d => d.data().status === 'proses').length;
        document.getElementById("adminCompTable").innerHTML = snap.docs.map(d => {
            const c = d.data();
            return `<tr><td><b>${c.nama}</b></td><td>${c.hp}</td><td>${c.pesan}</td><td>${c.status === 'proses' ? `<button onclick="updateStat('complaints','${d.id}')">Selesai</button>` : '✅'}</td></tr>`;
        }).join('');
    });

    db.collection("redemptions").onSnapshot(snap => {
        let totalOut = 0;
        document.getElementById("adminRedeemTable").innerHTML = snap.docs.map(d => {
            const r = d.data();
            if (r.status === 'Selesai') totalOut += (r.points || 0);
            return `<tr><td><b>${r.resellerName}</b></td><td>${r.points.toLocaleString()}</td><td>${r.status === 'proses' ? `<button onclick="updateStat('redemptions','${d.id}')">Selesai</button>` : '✅'}</td></tr>`;
        }).join('');
        document.getElementById("badgeRedeem").innerText = snap.docs.filter(d => d.data().status === 'proses').length;
        document.getElementById("admPoin").innerText = totalOut.toLocaleString();
    });
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
                return { id: u.id, nama: u.data().nama, poin: Math.floor(total / 100) };
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
    document.getElementById("resellerLeaderboardTable").innerHTML = pageData.map((res, i) => `
        <tr><td>${startIdx + i + 1}</td><td>${res.nama}</td><td style="text-align:right"><b>${res.poin.toLocaleString()} Poin</b></td></tr>
    `).join('') || '<tr><td colspan="3">Memuat...</td></tr>';
    if(document.getElementById("rankPageInfo")) document.getElementById("rankPageInfo").innerText = `Rangking ${startIdx + 1} - ${Math.min(startIdx + 10, allRankings.length)}`;
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
        const cs = document.getElementById("ordCatSelect");
        if(cs) {
            const cats = [...new Set(catalog.map(p => p.kategori || "Umum"))];
            cs.innerHTML = '<option value="Semua">Semua</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
        }
        filterProductsByCategory();

        if (currentUser && currentUser.role === 'admin') {
            document.getElementById("adminCatalogTable").innerHTML = catalog.map(p => `
                <tr><td><b>${p.nama}</b></td><td>${p.kategori}</td><td>Rp ${p.harga.toLocaleString()}</td>
                <td><button onclick="editProduct('${p.id}')">Edit</button> <button onclick="if(confirm('Hapus?')) db.collection('products').doc('${p.id}').delete()">Hapus</button></td></tr>
            `).join('');
        }
    });
}

function filterProductsByCategory() {
    const cat = document.getElementById("ordCatSelect")?.value || "Semua";
    const ps = document.getElementById("ordProdSelect");
    if(!ps) return;
    let f = (cat === "Semua") ? catalog : catalog.filter(p => p.kategori === cat);
    ps.innerHTML = f.map(p => `<option value="${p.id}">${p.nama} - Rp${p.harga.toLocaleString()}</option>`).join('');
}

// --- 9. ORDERING SYSTEM ---
function addToCart() {
    const pid = document.getElementById("ordProdSelect").value;
    const qty = parseInt(document.getElementById("ordQtyInput").value);
    const p = catalog.find(item => item.id === pid);
    if (p && qty > 0) { cart.push({ nama: p.nama, qty, subtotal: p.harga * qty }); renderCart(); }
}

function renderCart() {
    const tb = document.getElementById("cartTableBody"); let t = 0;
    tb.innerHTML = cart.map((item, index) => { t += item.subtotal; return `<tr><td>${item.nama} (${item.qty}x)</td><td>Rp ${item.subtotal.toLocaleString()}</td><td onclick="cart.splice(${index},1);renderCart()" style="color:red;cursor:pointer">X</td></tr>`; }).join('');
    document.getElementById("cartTotalText").innerText = "Total: Rp " + t.toLocaleString();
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
        await db.collection("orders").add({ 
            orderId: orderNo, resellerId: currentUser.id, resellerName: currentUser.nama, 
            customerName: cust, customerHp: hp, produk: detail, total, 
            jumlah: cart.reduce((s, i) => s + i.qty, 0), metode: pay, status: "pending", 
            createdAt: firebase.firestore.FieldValue.serverTimestamp() 
        });
        const waText = `*PESANAN BARU*%0AOrder: ${orderNo}%0APenerima: ${cust}%0AProduk:%0A${detailWA}%0ATotal: Rp ${total.toLocaleString()}`;
        closeOrderModal(); 
        window.open(`https://wa.me/62895345452412?text=${waText}`, '_blank');
    } catch(err) { alert("Gagal: " + err.message); }
};

// --- 10. REDEEM POINTS SYSTEM ---
function openRedeemModal() { 
    document.getElementById("redeemModal").classList.remove("hidden"); 
    document.getElementById("displayMyPoints").innerText = currentPointsVal.toLocaleString();
    goToRedeemStep1(); 
}
function goToRedeemStep1() { document.getElementById("redeemStep1").classList.remove("hidden"); document.getElementById("redeemStep2").classList.add("hidden"); }
function goToRedeemStep2() { 
    const amt = parseInt(document.getElementById("redeemAmountSelect").value);
    if(currentPointsVal < amt) return alert("Poin tidak cukup!");
    document.getElementById("redName").value = currentUser.nama;
    document.getElementById("redWa").value = currentUser.hp;
    document.getElementById("redeemStep1").classList.add("hidden");
    document.getElementById("redeemStep2").classList.remove("hidden");
}

document.getElementById("formRedeemPoints").onsubmit = async (e) => {
    e.preventDefault();
    const amt = parseInt(document.getElementById("redeemAmountSelect").value);
    const np = document.getElementById("redName").value;
    const wp = document.getElementById("redWa").value;

    try {
        await db.collection("redemptions").add({
            resellerId: currentUser.id, resellerName: currentUser.nama, points: amt,
            namaPenerima: np, whatsapp: wp, status: "proses", 
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert("Berhasil! Menunggu konfirmasi admin.");
        closeRedeemModal();
        window.open(`https://wa.me/62895345452412?text=Penukaran Poin ${amt} - ${np}`, '_blank');
    } catch (err) { alert("Error: " + err.message); }
};

// --- 11. ADMIN ACTIONS ---
async function activateUser(uid) { if(confirm("Aktifkan?")) await db.collection("users").doc(uid).update({ isActive: true }); }

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
                userId: targetUser, title: notifTitle, text: notifText, isRead: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        alert("Berhasil diperbarui & Notifikasi dikirim!");
    } catch (err) { alert("Gagal memperbarui status."); }
}

// --- 12. CATALOG FORM ---
function resetProductForm() {
    document.getElementById("adminProdId").value = "";
    document.getElementById("adminProductForm").reset();
    document.getElementById("formCatalogTitle").innerText = "📦 Tambah Produk";
}
document.getElementById("adminProductForm").onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById("adminProdId").value;
    const data = {
        nama: document.getElementById("adminProdName").value,
        kategori: document.getElementById("adminProdCat").value,
        harga: parseInt(document.getElementById("adminProdPrice").value),
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
        document.getElementById("formCatalogTitle").innerText = "📝 Edit Produk";
    }
}

// --- 13. UI HELPERS ---
function renderSidebar() {
    const nav = document.getElementById("sidebarNav");
    let menuItems = "";
    if (currentUser.role === 'admin') {
        menuItems = `
            <div class="nav-item" onclick="showSection('secAdminDashboard')">📊 Dashboard Admin</div>
            <div class="nav-item" onclick="showSection('secAdminActivation')">🔑 Aktivasi Reseller</div>
            <div class="nav-item" onclick="showSection('secAdminCatalog')">📦 Kelola Katalog</div>
            <div class="nav-item" onclick="showSection('secAdminRedeem')">🎁 Penukaran Poin</div>
        `;
    } else {
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
            return `<tr><td>${u.customId}</td><td>${u.nama}</td><td>${u.email}</td><td><button onclick="activateUser('${doc.id}')">AKTIFKAN</button></td></tr>`;
        }).join('');
    });
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

function logout() { auth.signOut(); }
function toggleSidebar(f) { document.getElementById("sidebar").classList.toggle("active", f); document.getElementById("sidebarOverlay").classList.toggle("active", f); }
function switchAuth(m) {
    document.getElementById("loginForm").classList.toggle("hidden", m==='register'); 
    document.getElementById("registerForm").classList.toggle("hidden", m==='login');
}
function openOrderModal() { document.getElementById("orderModal").classList.remove("hidden"); cart = []; renderCart(); goToStep1(); }
function closeOrderModal() { document.getElementById("orderModal").classList.add("hidden"); }
function closeRedeemModal() { document.getElementById("redeemModal").classList.add("hidden"); }
function goToStep2() { if(!cart.length) return alert("Pilih produk!"); document.getElementById("orderStep1").classList.add("hidden"); document.getElementById("orderStep2").classList.remove("hidden"); }
function goToStep1() { document.getElementById("orderStep1").classList.remove("hidden"); document.getElementById("orderStep2").classList.add("hidden"); }

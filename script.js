function generateOrderId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'ORD-';
    for (let i = 0; i < 5; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result; // Contoh hasil: ORD-X7Y2Z
}
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

const ping = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
let loadRedeems = true; // Untuk flag notif suara

// --- 1. PERBAIKAN: SATU LISTENER AUTH SAJA ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const doc = await db.collection("users").doc(user.uid).get();
            if (doc.exists) {
                const userData = doc.data();
                
                // JIKA RESELLER BELUM AKTIF, KELUARKAN OTOMATIS
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
        document.getElementById("adminNotifHeader").classList.remove("hidden");
        document.getElementById("btnTukarPoinHeader").classList.add("hidden");
        showSection('secAdminDashboard');
        loadAdminData();
    } else {
        document.getElementById("adminNotifHeader").classList.add("hidden");
        document.getElementById("btnTukarPoinHeader").classList.remove("hidden");
        showSection('secResellerDashboard');
        loadResellerData();
        loadResellerHistory();
        loadResellerLeaderboard();
    }
}

// --- LOGIKA DAFTAR ---
document.getElementById("registerForm").onsubmit = async (e) => {
    e.preventDefault();
    const nama = document.getElementById("regNama").value;
    const email = document.getElementById("regEmail").value;
    const pass = document.getElementById("regPassword").value;
    const hp = document.getElementById("regHp").value;
    
    const cleanNama = nama.replace(/\s/g, '').substring(0, 4).toLowerCase();
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    const customId = cleanNama + randomNum;

    try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await db.collection("users").doc(cred.user.uid).set({
            customId, nama, email, hp, role: 'reseller', isActive: false, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const waMsg = `Halo Admin, saya ingin aktivasi akun OKTSHOP17.%0ANama: ${nama}%0AID User: ${customId}`;
        alert("Pendaftaran Berhasil! ID USER: " + customId);
        window.open(`https://wa.me/62895345452412?text=${waMsg}`, '_blank');
        auth.signOut(); 
    } catch (err) { alert("Gagal Daftar: " + err.message); }
};

// --- LOGIKA LOGIN ---
document.getElementById("loginForm").onsubmit = (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const pass = document.getElementById("loginPassword").value;
    
    auth.signInWithEmailAndPassword(email, pass)
    .catch(err => {
        alert("Gagal Masuk: Email atau Password salah!");
    });
};

// --- LOGIKA RESELLER DATA ---
function resetOrderFilter() {
    document.getElementById("filterStart").value = "";
    document.getElementById("filterEnd").value = "";
    loadResellerData();
}

function loadResellerData() {
    const startDate = document.getElementById("filterStart") ? document.getElementById("filterStart").value : null;
    const endDate = document.getElementById("filterEnd") ? document.getElementById("filterEnd").value : null;

    db.collection("orders").where("resellerId", "==", currentUser.id).onSnapshot(sOrders => {
        db.collection("redemptions").where("resellerId", "==", currentUser.id).where("status", "==", "Selesai").onSnapshot(sRedeems => {
            let q = 0, t = 0;
            let allDocs = sOrders.docs.sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0));
            
            allDocs.forEach(d => {
                const o = d.data();
                if(o.status === 'Selesai') { q += (o.jumlah || 0); t += (o.total || 0); }
            });

            let usedPoints = 0;
            sRedeems.docs.forEach(d => { usedPoints += (d.data().points || 0); });
            currentPointsVal = Math.floor(t / 100) - usedPoints;

            document.getElementById("resQty").innerText = q.toLocaleString('id-ID');
            document.getElementById("resTotal").innerText = "Rp " + t.toLocaleString('id-ID');
            document.getElementById("resPoin").innerText = currentPointsVal.toLocaleString('id-ID');
            document.getElementById("displayMyPoints").innerText = currentPointsVal.toLocaleString('id-ID');

            let filteredDocs = [];
            let emptyMsg = "Tidak ada order hari ini";

            if (startDate && endDate) {
                const startRange = new Date(startDate).setHours(0, 0, 0, 0);
                const endRange = new Date(endDate).setHours(23, 59, 59, 999);
                filteredDocs = allDocs.filter(d => {
                    const created = d.data().createdAt?.toDate().getTime();
                    return created >= startRange && created <= endRange;
                });
                emptyMsg = "Tidak ada pesanan pada periode ini";
            } else {
                const todayStart = new Date().setHours(0, 0, 0, 0);
                const todayEnd = new Date().setHours(23, 59, 59, 999);
                filteredDocs = allDocs.filter(d => {
                    const created = d.data().createdAt?.toDate().getTime();
                    return created >= todayStart && created <= todayEnd;
                });
            }

            const tableBody = document.getElementById("resellerOrderTable");
            if (filteredDocs.length > 0) {
                tableBody.innerHTML = filteredDocs.map(d => {
    const o = d.data();
    return `<tr>
        <td><small style="font-weight:bold; color:#d4af37;">${o.orderId || '-'}</small><br>${o.customerName}</td>
        <td>${o.produk}</td>
        <td>Rp ${o.total.toLocaleString('id-ID')}</td>
        <td><span style="color:${o.status==='Selesai'?'green':'orange'}; font-weight:800;">${o.status}</span></td>
    </tr>`;
}).join('');
            } else {
                tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:#666;">${emptyMsg}</td></tr>`;
            }
        });
    });
}

// --- 2. PERBAIKAN: SYNTAX ERROR DI LOADADMIN DATA ---
function loadAdminData() {
    // Ambil nilai filter
    const startDate = document.getElementById("filterAdminStart") ? document.getElementById("filterAdminStart").value : null;
    const endDate = document.getElementById("filterAdminEnd") ? document.getElementById("filterAdminEnd").value : null;

    // 1. Badge Aktivasi (Tetap sama)
    db.collection("users").where("role", "==", "reseller").where("isActive", "==", false).onSnapshot(snap => {
        if(document.getElementById("badgeActivation")) document.getElementById("badgeActivation").innerText = snap.size;
    });

    // 2. Tabel Order Admin dengan FILTER TANGGAL
    db.collection("orders").onSnapshot(snap => {
        let allOrders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Urutkan berdasarkan tanggal terbaru
        allOrders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        let filteredOrders = allOrders;

        // Logika Filter Tanggal
        if (startDate && endDate) {
            const startRange = new Date(startDate).setHours(0, 0, 0, 0);
            const endRange = new Date(endDate).setHours(23, 59, 59, 999);
            
            filteredOrders = allOrders.filter(o => {
                const created = o.createdAt?.toDate().getTime();
                return created >= startRange && created <= endRange;
            });
        }

        let pendingCount = 0;
        let totalUangMasuk = 0;

        document.getElementById("adminOrderTable").innerHTML = filteredOrders.map(o => {
            if(o.status === 'pending') pendingCount++;
            if(o.status === 'Selesai') totalUangMasuk += (o.total || 0);

            // Format Tanggal untuk tampilan tabel
            const tgl = o.createdAt ? o.createdAt.toDate().toLocaleDateString('id-ID') : '-';

            const btnAction = o.status === 'pending' 
                ? `<button onclick="updateStat('orders','${o.id}')" class="btn-adm-action">Selesai</button>` 
                : `<button class="btn-adm-done" disabled>✅ Selesai</button>`;

            return `<tr>
                <td>${o.resellerName || 'User'}</td>
                <td>
                    <b style="color:#C62828;">${o.orderId || '-'}</b><br>
                    <small style="font-size:9px; color:#666;">${tgl}</small>
                </td>
                <td>${o.produk || '-'}</td>
                <td>${btnAction}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="4" style="text-align:center">Tidak ada data untuk periode ini</td></tr>';

        // Update Stat Card di Dashboard
        document.getElementById("badgeOrder").innerText = pendingCount;
        if(document.getElementById("admQty")) document.getElementById("admQty").innerText = filteredOrders.length;
        if(document.getElementById("admTotal")) document.getElementById("admTotal").innerText = "Rp " + totalUangMasuk.toLocaleString('id-ID');
    });
    
    // Tabel Retur Admin
    db.collection("returns").onSnapshot(snap => {
        if(document.getElementById("badgeReturn")) document.getElementById("badgeReturn").innerText = snap.docs.filter(d => d.data().status === 'proses').length;
        document.getElementById("adminReturnTable").innerHTML = snap.docs.map(d => {
            const r = d.data();
            return `<tr>
                <td><b>${r.nama || 'Reseller'}</b></td>
                <td>${r.produk || '-'}</td>
                <td><small>${r.alasan || '-'}</small></td>
                <td>${r.hp || '-'}</td>
                <td>${r.status === 'proses' ? `<button onclick="updateStat('returns','${d.id}')" style="background:#F2A93B; color:white; border:none; padding:5px; border-radius:4px;">Selesai</button>` : '✅'}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" style="text-align:center">Kosong</td></tr>';
    });

    // Tabel Keluhan Admin
    db.collection("complaints").onSnapshot(snap => {
        if(document.getElementById("badgeComplaint")) document.getElementById("badgeComplaint").innerText = snap.docs.filter(d => d.data().status === 'proses').length;
        document.getElementById("adminCompTable").innerHTML = snap.docs.map(d => {
            const c = d.data();
            return `<tr>
                <td><b>${c.nama || 'User'}</b></td>
                <td>${c.hp || '-'}</td>
                <td><small>${c.pesan || '-'}</small></td>
                <td>${c.status === 'proses' ? `<button onclick="updateStat('complaints','${d.id}')" style="background:#F2A93B; color:white; border:none; padding:5px; border-radius:4px;">Selesai</button>` : '✅'}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="4" style="text-align:center">Kosong</td></tr>';
    });
    
// --- BAGIAN PENUKARAN POIN ADMIN (PERBAIKAN) ---
db.collection("redemptions").onSnapshot(snap => {
    let totalPoinKeluar = 0; // Tambahkan variabel penampung

    document.getElementById("adminRedeemTable").innerHTML = snap.docs.map(d => {
        const r = d.data();
        
        // LOGIKA: Jika status penukaran sudah "Selesai", tambahkan ke total poin keluar
        if (r.status === 'Selesai') {
            totalPoinKeluar += (r.points || 0);
        }

        const btnAction = r.status === 'proses' 
            ? `<button onclick="updateStat('redemptions','${d.id}')" style="background:#F2A93B; color:white; border:none; padding:5px; border-radius:4px;">Selesai</button>` 
            : '✅';

        return `<tr>
            <td><b>${r.resellerName}</b><br><small>${r.namaPenerima || '-'}</small></td>
            <td>${(r.points || 0).toLocaleString()}</td>
            <td>${btnAction}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="3" style="text-align:center">Belum ada penukaran</td></tr>';

    // UPDATE ANGKA DI DASHBOARD ADMIN (Ini yang tadi hilang)
    const admPoinElem = document.getElementById("admPoin");
    if (admPoinElem) {
        admPoinElem.innerText = totalPoinKeluar.toLocaleString('id-ID');
    }
});
} // <--- PASTIKAN ADA TANDA INI UNTUK MENUTUP FUNGSI loadAdminData
// --- FUNGSI-FUNGSI LAINNYA (TETAP SAMA NAMUN DIRAPIKAN) ---
function loadResellerHistory() {
    db.collection("returns").where("resellerId", "==", currentUser.id).onSnapshot(s => {
        document.getElementById("resellerReturnHistory").innerHTML = s.docs.map(doc => {
            const d = doc.data();
            return `<tr><td>${d.produk || '-'}</td><td><small>${d.alasan || '-'}</small></td><td>${d.hp || '-'}</td><td style="color:${d.status === 'Selesai' ? 'green' : 'orange'}">${d.status || 'proses'}</td></tr>`;
        }).join('') || '<tr><td colspan="4" style="text-align:center">Belum ada retur</td></tr>';
    });

    db.collection("complaints").where("resellerId", "==", currentUser.id).onSnapshot(s => {
        document.getElementById("resellerCompHistory").innerHTML = s.docs.map(doc => {
            const d = doc.data();
            return `<tr><td>${d.nama || '-'}</td><td><small>${d.pesan || '-'}</small></td><td>${d.hp || '-'}</td><td style="color:${d.status === 'Selesai' ? 'green' : 'orange'}">${d.status || 'proses'}</td></tr>`;
        }).join('') || '<tr><td colspan="4" style="text-align:center">Belum ada keluhan</td></tr>';
    });
}

function loadResellerLeaderboard() {
    db.collection("users").where("role", "==", "reseller").onSnapshot(sUsers => {
        db.collection("orders").where("status", "==", "Selesai").onSnapshot(sOrders => {
            const allOrders = sOrders.docs.map(d => d.data());
            allRankings = sUsers.docs.map(u => {
                const total = allOrders.filter(o => o.resellerId === u.id).reduce((sum, o) => sum + (o.total || 0), 0);
                return { nama: u.data().nama, poin: Math.floor(total / 100) };
            }).sort((a, b) => b.poin - a.poin);
            renderRankTable();
        });
    });
}

function renderRankTable() {
    const startIdx = currentRankPage * 10;
    const pageData = allRankings.slice(startIdx, startIdx + 10);
    const table = document.getElementById("resellerLeaderboardTable");
    if(!table) return;

    table.innerHTML = pageData.map((res, i) => `
        <tr>
            <td style="text-align: center;">${startIdx + i + 1}</td>
            <td style="text-align: left;">${res.nama}</td>
            <td style="text-align: right; padding-right: 20px; font-weight: bold;">${res.poin.toLocaleString('id-ID')} Poin</td>
        </tr>
    `).join('') || '<tr><td colspan="3" style="text-align:center">Memuat...</td></tr>';
    
    if(document.getElementById("rankPageInfo")) document.getElementById("rankPageInfo").innerText = `Rangking ${startIdx + 1} - ${Math.min(startIdx + 10, allRankings.length)}`;
}

function changeRankPage(dir) {
    if (dir === 1 && (currentRankPage + 1) * 10 < allRankings.length) currentRankPage++;
    else if (dir === -1 && currentRankPage > 0) currentRankPage--;
    renderRankTable();
}

async function activateUser(uid) { if(confirm("Aktifkan user ini?")) await db.collection("users").doc(uid).update({ isActive: true }); }
async function updateStat(coll, id) { if(confirm("Tandai Selesai?")) await db.collection(coll).doc(id).update({ status: "Selesai" }); }

function resetProductForm() {
    document.getElementById("adminProdId").value = "";
    document.getElementById("adminProdName").value = "";
    document.getElementById("adminProdCat").value = "";
    document.getElementById("adminProdPrice").value = "";
    document.getElementById("formCatalogTitle").innerText = "📦 Tambah Produk Baru";
    document.getElementById("btnSaveProduct").innerText = "SIMPAN PRODUK";
    document.getElementById("btnCancelEdit").classList.add("hidden");
}

document.getElementById("adminProductForm").onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById("adminProdId").value;
    const nama = document.getElementById("adminProdName").value;
    const kategori = document.getElementById("adminProdCat").value;
    const harga = parseInt(document.getElementById("adminProdPrice").value);
    const productData = { nama, kategori, harga, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    try {
        if (id) await db.collection("products").doc(id).update(productData);
        else await db.collection("products").add({ ...productData, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        alert("Berhasil!"); resetProductForm();
    } catch (err) { alert("Error: " + err.message); }
};

function editProduct(id) {
    const p = catalog.find(item => item.id === id);
    if (p) {
        document.getElementById("adminProdId").value = p.id;
        document.getElementById("adminProdName").value = p.nama;
        document.getElementById("adminProdCat").value = p.kategori;
        document.getElementById("adminProdPrice").value = p.harga;
        document.getElementById("formCatalogTitle").innerText = "📝 Edit Produk";
        document.getElementById("btnSaveProduct").innerText = "UPDATE PRODUK";
        document.getElementById("btnCancelEdit").classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

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
                <tr>
                    <td><b>${p.nama}</b></td>
                    <td>${p.kategori}</td>
                    <td>Rp ${p.harga.toLocaleString('id-ID')}</td>
                    <td>
                        <button onclick="editProduct('${p.id}')" style="background:#2196F3; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:10px;">Edit</button>
                        <button onclick="if(confirm('Hapus?')) db.collection('products').doc('${p.id}').delete()" style="background:#f44336; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:10px;">Hapus</button>
                    </td>
                </tr>
            `).join('');
        }
    });
}

function filterProductsByCategory() {
    const cat = document.getElementById("ordCatSelect")?.value || "Semua";
    const ps = document.getElementById("ordProdSelect");
    if(!ps) return;
    let f = (cat === "Semua") ? catalog : catalog.filter(p => p.kategori === cat);
    ps.innerHTML = f.map(p => `<option value="${p.id}">${p.nama} - Rp${p.harga.toLocaleString('id-ID')}</option>`).join('');
}

function addToCart() {
    const pid = document.getElementById("ordProdSelect").value;
    const qty = parseInt(document.getElementById("ordQtyInput").value);
    const p = catalog.find(item => item.id === pid);
    if (p && qty > 0) { cart.push({ nama: p.nama, qty, subtotal: p.harga * qty }); renderCart(); }
}

function renderCart() {
    const tb = document.getElementById("cartTableBody"); let t = 0;
    tb.innerHTML = cart.map((item, index) => { t += item.subtotal; return `<tr><td>${item.nama} (${item.qty}x)</td><td>Rp ${item.subtotal.toLocaleString('id-ID')}</td><td onclick="cart.splice(${index},1);renderCart()" style="color:red; cursor:pointer; font-weight:800;">X</td></tr>`; }).join('');
    document.getElementById("cartTotalText").innerText = "Total: Rp " + t.toLocaleString('id-ID');
}

document.getElementById("orderFormFinal").onsubmit = async (e) => {
    e.preventDefault();
    const orderNo = generateOrderId(); // Buat nomor order di sini
    const cust = document.getElementById("ordCustomer").value;
    const hp = document.getElementById("ordHp").value;
    const pay = document.getElementById("ordPayment").value;
    const total = cart.reduce((s, i) => s + i.subtotal, 0);
    const detail = cart.map(i => `${i.nama} (${i.qty}x)`).join(", ");
    const detailWA = cart.map(i => `- ${i.nama} (${i.qty}x)`).join("%0A");

    try {
        await db.collection("orders").add({ 
            orderId: orderNo, // Simpan No Order ke DB
            resellerId: currentUser.id, 
            resellerName: currentUser.nama, 
            customerName: cust, 
            customerHp: hp, 
            produk: detail, 
            total, 
            jumlah: cart.reduce((s, i) => s + i.qty, 0), 
            metode: pay, 
            status: "pending", 
            createdAt: firebase.firestore.FieldValue.serverTimestamp() 
        });

        const waText = `*--- PESANAN BARU OKTSHOP17 ---*%0A%0A*No. Order:* ${orderNo}%0A*Data Penerima:*%0ANama: ${cust}%0ANo. HP: ${hp}%0APembayaran: ${pay}%0A%0A*Detail Produk:*%0A${detailWA}%0A%0A*Total:* Rp ${total.toLocaleString('id-ID')}%0A%0A*Reseller:* ${currentUser.nama}`;
        
        closeOrderModal(); 
        window.open(`https://wa.me/62895345452412?text=${waText}`, '_blank');
    } catch(err) { alert("Gagal: " + err.message); }
};

function renderSidebar() {
    const nav = document.getElementById("sidebarNav");
    let menuItems = "";
    if (currentUser.role === 'admin') {
        menuItems = `
            <div class="nav-item" onclick="showSection('secAdminDashboard')">📊 Dashboard Admin</div>
            <div class="nav-item" onclick="showSection('secAdminActivation')">🔑 Aktivasi Akun</div>
            <div class="nav-item" onclick="showSection('secAdminRedeem')">🎁 Penukaran Poin</div>
            <div class="nav-item" onclick="showSection('secAdminCatalog')">📦 Update Katalog</div>
            <div class="nav-item" onclick="showSection('secAdminRankings')">🏆 Peringkat Reseller</div>
            <div class="nav-item" onclick="showSection('secAdminReturn')">📥 Returan Masuk</div>
            <div class="nav-item" onclick="showSection('secAdminComplaint')">📢 Keluhan Masuk</div>
        `;
    } else {
        menuItems = `
            <div class="nav-item" onclick="showSection('secResellerDashboard')">📊 Dashboard Reseller</div>
            <div class="nav-item" onclick="showSection('secResellerReturn')">📦 Retur Barang</div>
            <div class="nav-item" onclick="showSection('secResellerComplaint')">📢 Laporan Keluhan</div>
        `;
    }
    menuItems += `<div class="nav-item" onclick="showSection('secProfile')">👤 Profil Akun</div>`;
    nav.innerHTML = menuItems;
}
    
function showSection(id) {
    // Sembunyikan semua section
    document.querySelectorAll('.app-section').forEach(s => s.classList.add('hidden'));
    
    // Tampilkan section yang dipilih
    const targetSection = document.getElementById(id);
    if (targetSection) {
        targetSection.classList.remove('hidden');
    }

    // Pemicu Load Data berdasarkan menu yang dibuka
    if(id === 'secAdminActivation') loadActivationList();
    if(id === 'secAdminRankings') loadRankings(); // <-- INI YANG TADI KURANG
    
    toggleSidebar(false);
}

function loadActivationList() {
    db.collection("users").where("role", "==", "reseller").where("isActive", "==", false).onSnapshot(snap => {
        document.getElementById("adminActivationTable").innerHTML = snap.docs.map(doc => {
            const u = doc.data();
            return `<tr><td><b>${u.customId}</b></td><td>${u.nama}</td><td>${u.email}</td><td><button onclick="activateUser('${doc.id}')">AKTIFKAN</button></td></tr>`;
        }).join('');
    });
}

function openRedeemModal() {
    document.getElementById("redeemModal").classList.remove("hidden");
    document.getElementById("displayMyPoints").innerText = currentPointsVal.toLocaleString('id-ID');
    goToRedeemStep1();
}

function closeRedeemModal() {
    document.getElementById("redeemModal").classList.add("hidden");
}

function goToRedeemStep1() {
    document.getElementById("redeemStep1").classList.remove("hidden");
    document.getElementById("redeemStep2").classList.add("hidden");
}
// Pindahkan ke Step 2 (Konfirmasi Data)
function goToRedeemStep2() { 
    const nominal = parseInt(document.getElementById("redeemAmountSelect").value);
    
    if(currentPointsVal < nominal) {
        alert("Maaf, poin Anda tidak cukup untuk menukar nominal ini!");
        return;
    }
    
    // Isi data otomatis dari profil
    document.getElementById("redName").value = currentUser.nama || "";
    document.getElementById("redWa").value = currentUser.hp || "";
    
    document.getElementById("redeemStep1").classList.add("hidden"); 
    document.getElementById("redeemStep2").classList.remove("hidden"); 
}

// Handler Tunggal Penukaran Poin (Gantikan semua duplikasi formRedeemPoints.onsubmit)
document.getElementById("formRedeemPoints").onsubmit = async (e) => {
    e.preventDefault(); // Mencegah Force Close/Refresh

    const amount = parseInt(document.getElementById("redeemAmountSelect").value);
    const namaPenerima = document.getElementById("redName").value;
    const waPenerima = document.getElementById("redWa").value;
    const adminWA = "62895345452412"; 

    try {
        await db.collection("redemptions").add({
            resellerId: currentUser.id,
            resellerName: currentUser.nama,
            points: amount,
            namaPenerima: namaPenerima,
            whatsapp: waPenerima,
            status: "proses",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const pesanWA = `*PENUKARAN POIN OKTSHOP17*%0A%0ANama: ${namaPenerima}%0ANominal: ${amount.toLocaleString('id-ID')} Poin%0AWA: ${waPenerima}%0A%0AMohon diproses admin.`;

        alert("Berhasil! Permintaan Anda telah disimpan.");
        closeRedeemModal();
        window.open(`https://wa.me/${adminWA}?text=${pesanWA}`, '_blank');
    } catch (err) {
        alert("Gagal: " + err.message);
    }
};

// Handler Submit Form (Memperbaiki Tombol Tukar yang Tidak Berfungsi)
document.getElementById("formRedeemPoints").onsubmit = async (e) => {
    e.preventDefault();

    // 1. Ambil data dari input
    const amount = parseInt(document.getElementById("redeemAmountSelect").value);
    const namaPenerima = document.getElementById("redName").value;
    const waPenerima = document.getElementById("redWa").value;
    const adminWA = "62895345452412"; // Sesuaikan dengan nomor admin Anda

    // 2. Validasi Poin Sekali Lagi (Keamanan)
    if (currentPointsVal < amount) {
        alert("Poin Anda tidak cukup!");
        return;
    }

    try {
        // 3. Simpan data ke Firestore agar masuk ke Tabel Admin
        await db.collection("redemptions").add({
            resellerId: currentUser.id,
            resellerName: currentUser.nama, // Nama akun reseller
            points: amount,
            namaPenerima: namaPenerima,   // Nama di form konfirmasi
            whatsapp: waPenerima,         // WA di form konfirmasi
            status: "proses",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 4. Siapkan format pesan WhatsApp
        const pesanWA = `*--- PENUKARAN POIN OKTSHOP17 ---*%0A%0A` +
                        `*Data Reseller:*%0A` +
                        `Nama Akun: ${currentUser.nama}%0A` +
                        `ID User: ${currentUser.customId || '-'}%0A%0A` +
                        `*Detail Penukaran:*%0A` +
                        `Nominal: ${amount.toLocaleString('id-ID')} Poin%0A` +
                        `Nama Penerima: ${namaPenerima}%0A` +
                        `No. WA: ${waPenerima}%0A%0A` +
                        `----------------------------------%0A` +
                        ` Mohon segera diproses ya Admin!`;

        // 5. Beri notifikasi berhasil
        alert("Permintaan penukaran berhasil disimpan!");

        // 6. Tutup Modal
        closeRedeemModal();

        // 7. Redirect ke WhatsApp Admin
        window.open(`https://wa.me/${adminWA}?text=${pesanWA}`, '_blank');

    } catch (err) {
        console.error("Gagal menukar poin:", err);
        alert("Terjadi kesalahan: " + err.message);
    }
};
    
function logout() { auth.signOut(); }
function toggleSidebar(f) { document.getElementById("sidebar").classList.toggle("active", f); document.getElementById("sidebarOverlay").classList.toggle("active", f); }
function switchAuth(m) {
    document.getElementById("loginForm").classList.toggle("hidden", m==='register'); 
    document.getElementById("registerForm").classList.toggle("hidden", m==='login');
    document.getElementById("tLog").classList.toggle("active", m==='login'); 
    document.getElementById("tReg").classList.toggle("active", m==='register');
}
function openOrderModal() { document.getElementById("orderModal").classList.remove("hidden"); cart = []; renderCart(); goToStep1(); }
function closeOrderModal() { document.getElementById("orderModal").classList.add("hidden"); }
function goToStep2() { if(!cart.length) return alert("Pilih produk!"); document.getElementById("orderStep1").classList.add("hidden"); document.getElementById("orderStep2").classList.remove("hidden"); }
function goToStep1() { document.getElementById("orderStep1").classList.remove("hidden"); document.getElementById("orderStep2").classList.add("hidden"); }

document.getElementById("editProfileForm").onsubmit = async (e) => { e.preventDefault(); await db.collection("users").doc(currentUser.id).update({ nama: document.getElementById("profNama").value, hp: document.getElementById("profHp").value }); alert("Updated!"); };
document.getElementById("resellerReturnForm").onsubmit = async (e) => { e.preventDefault(); await db.collection("returns").add({ resellerId: currentUser.id, nama: currentUser.nama, produk: document.getElementById("retProd").value, alasan: document.getElementById("retReason").value, hp: document.getElementById("retHp").value, status: "proses", createdAt: firebase.firestore.FieldValue.serverTimestamp() }); alert("Dikirim!"); e.target.reset(); };
document.getElementById("resellerComplaintForm").onsubmit = async (e) => { e.preventDefault(); await db.collection("complaints").add({ resellerId: currentUser.id, nama: document.getElementById("compNama").value, hp: document.getElementById("compHp").value, pesan: document.getElementById("compText").value, status: "proses", createdAt: firebase.firestore.FieldValue.serverTimestamp() }); alert("Dikirim!"); e.target.reset(); };

async function loadRankings() {
    try {
        const tableBody = document.getElementById("adminRankTable");
        if (!tableBody) return;

        // Tampilkan loading sementara
        tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center">Memuat data...</td></tr>';

        // Ambil semua reseller
        const us = await db.collection("users").where("role", "==", "reseller").get();
        // Ambil semua order yang sudah selesai
        const os = await db.collection("orders").where("status", "==", "Selesai").get();
        
        const allOrders = os.docs.map(d => d.data());
        
        let ranks = us.docs.map(u => {
            const userData = u.data();
            const userId = u.id;
            
            // Filter order berdasarkan reseller ini
            const userOrders = allOrders.filter(o => o.resellerId === userId);
            
            // Hitung total belanja
            const total = userOrders.reduce((s, o) => s + (o.total || 0), 0);
            
            return { 
                nama: userData.nama || 'Tanpa Nama', 
                total: total, 
                poin: Math.floor(total / 100) 
            };
        });

        // Urutkan dari total terbesar ke terkecil
        ranks.sort((a, b) => b.total - a.total);

        // Masukkan ke tabel
        if (ranks.length > 0) {
            tableBody.innerHTML = ranks.map((r, i) => `
                <tr>
                    <td style="text-align:center">${i + 1}</td>
                    <td><b>${r.nama}</b></td>
                    <td>${r.poin.toLocaleString('id-ID')}</td>
                    <td>Rp ${r.total.toLocaleString('id-ID')}</td>
                </tr>
            `).join('');
        } else {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center">Belum ada data reseller atau penjualan.</td></tr>';
        }
    } catch (err) {
        console.error("Gagal memuat peringkat:", err);
        document.getElementById("adminRankTable").innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Gagal mengambil data.</td></tr>';
    }
}

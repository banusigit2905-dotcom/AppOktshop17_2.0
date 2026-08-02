// =====================================================================
// REFERRAL.JS — Sistem Referral & Tangga Klaim Poin
// File terpisah dari script.js. Dimuat SETELAH script.js di index.html,
// jadi berbagi scope global yang sama (bukan ES module) supaya semua
// onclick="..." di index.html tetap bisa memanggil fungsi di sini.
// =====================================================================

const REFERRAL_BASE_POINTS = 5000; // Poin otomatis per referral yang berhasil AKTIVASI
const REFERRAL_LADDER = [
    { count: 10, bonus: 10000 },
    { count: 20, bonus: 20000 },
    { count: 30, bonus: 30000 },
    { count: 40, bonus: 40000 },
    { count: 50, bonus: 50000 }
];

let referralList = [];        // semua dokumen referrals milik currentUser (sebagai pengundang)
let referralAttached = false;

// ---------------------------------------------------------------
// 1) PEMBAYARAN POIN DASAR — dipanggil dari script.js->activateUser()
// ---------------------------------------------------------------
async function processReferralActivation(newUserId) {
    const userSnap = await db.collection("users").doc(newUserId).get();
    const userData = userSnap.data();
    if (!userData || !userData.referredBy) return; // akun ini tidak didaftarkan pakai referral

    const referrerId = userData.referredBy;

    // Cari dokumen referral yang masih 'pending' untuk pasangan (referrer, newUserId) ini
    const refQuery = await db.collection("referrals")
        .where("referrerId", "==", referrerId)
        .where("newUserId", "==", newUserId)
        .where("status", "==", "pending")
        .limit(1).get();
    if (refQuery.empty) return; // sudah pernah diproses / tidak ditemukan
    const referralDocRef = refQuery.docs[0].ref;

    const referrerRef = db.collection("users").doc(referrerId);

    await db.runTransaction(async (t) => {
        // 1) SEMUA PEMBACAAN DULU
        const rSnap = await t.get(referralDocRef);
        const uSnap = await t.get(referrerRef);
        if (!rSnap.exists || rSnap.data().status !== "pending") return; // sudah diproses transaksi lain

        const currentBonus = uSnap.data()?.bonusPoints || 0;

        // 2) BARU SEMUA PENULISAN
        t.update(referralDocRef, {
            status: "active",
            pointsAwarded: REFERRAL_BASE_POINTS,
            activatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        t.update(referrerRef, { bonusPoints: currentBonus + REFERRAL_BASE_POINTS });
    });
}

// ---------------------------------------------------------------
// 2) SINKRONISASI DATA REFERRAL UNTUK RESELLER YANG SEDANG LOGIN
// ---------------------------------------------------------------
function syncReferral() {
    if (referralAttached || !currentUser) return;
    referralAttached = true;
    db.collection("referrals").where("referrerId", "==", currentUser.id).onSnapshot(snap => {
        referralList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderReferralUI();
    });
}

// ---------------------------------------------------------------
// 3) RENDER TAMPILAN HALAMAN REFERRAL
// ---------------------------------------------------------------
function getActiveReferralCount() {
    return referralList.filter(r => r.status === "active").length;
}

function getClaimedLadderMap() {
    return (currentUser && currentUser.referralClaims) ? currentUser.referralClaims : {};
}

function buildReferralLadderHTML(activeCount, claimed) {
    // Cari milestone berikutnya yang belum tercapai, untuk kartu "progress"
    const nextMilestone = REFERRAL_LADDER.find(m => activeCount < m.count);

    let progressHtml = "";
    if (nextMilestone) {
        const pct = Math.min(100, Math.round((activeCount / nextMilestone.count) * 100));
        const sisa = nextMilestone.count - activeCount;
        progressHtml = `
            <div class="next-milestone">
                <div class="top-row">
                    <span class="txt">🎯 Menuju Bonus ${nextMilestone.bonus.toLocaleString('id-ID')} Poin</span>
                    <span class="count">${activeCount} / ${nextMilestone.count}</span>
                </div>
                <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
                <div class="hint">Ajak <b>${sisa} reseller</b> lagi buat cairkan bonus tangga berikutnya!</div>
            </div>`;
    } else {
        progressHtml = `
            <div class="next-milestone">
                <div class="top-row"><span class="txt">🏆 Semua Tangga Tercapai!</span></div>
                <div class="hint">Kamu sudah melewati semua tangga bonus referral (${REFERRAL_LADDER[REFERRAL_LADDER.length - 1].count} reseller). Tetap dapat <b>${REFERRAL_BASE_POINTS.toLocaleString('id-ID')} poin</b> setiap referral baru yang aktivasi.</div>
            </div>`;
    }

    const rungsHtml = REFERRAL_LADDER.map(m => {
        const isClaimed = !!claimed[m.count];
        const isEligible = activeCount >= m.count;
        let stateClass, dotContent, badgeHtml, descText;

        if (isClaimed) {
            stateClass = "done"; dotContent = "✓"; descText = "Bonus sudah diklaim";
            badgeHtml = `<span class="rung-badge">+${m.bonus.toLocaleString('id-ID')} ✓</span>`;
        } else if (isEligible) {
            stateClass = "current"; dotContent = "🎁"; descText = "Siap diklaim sekarang!";
            badgeHtml = `<button class="btn-claim" onclick="claimMilestone(${m.count}, ${m.bonus})">KLAIM</button>`;
        } else if (m.count === (REFERRAL_LADDER.find(x => activeCount < x.count)?.count)) {
            stateClass = "current"; dotContent = String(activeCount); descText = "Sedang berjalan";
            badgeHtml = `<span class="rung-badge">+${m.bonus.toLocaleString('id-ID')}</span>`;
        } else {
            stateClass = "locked"; dotContent = "🔒"; descText = "Belum terbuka";
            badgeHtml = `<span class="rung-badge">+${m.bonus.toLocaleString('id-ID')}</span>`;
        }

        return `<div class="rung ${stateClass}">
                    <div class="rung-dot">${dotContent}</div>
                    <div class="rung-info">
                        <div class="title">${m.count} Reseller Baru</div>
                        <div class="desc">${descText}</div>
                    </div>
                    ${badgeHtml}
                </div>`;
    }).join('');

    return progressHtml + `<div class="ladder-title">🪜 Tangga Bonus Referral</div><div class="ladder">${rungsHtml}</div>`;
}

function buildReferralTableHTML() {
    if (referralList.length === 0) {
        return `<div class="empty-state">Belum ada reseller yang daftar pakai kode kamu.<br>Yuk mulai bagikan kodenya! 🚀</div>`;
    }
    const sorted = [...referralList].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return sorted.map(r => {
        const tgl = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
        const isActive = r.status === 'active';
        const initial = (r.newUserName || '?').charAt(0).toUpperCase();
        return `<div class="ref-row">
                    <div class="ref-avatar">${initial}</div>
                    <div class="ref-info">
                        <div class="ref-name">${r.newUserName || '-'}</div>
                        <div class="ref-date">Daftar: ${tgl}</div>
                    </div>
                    <span class="status-tag ${isActive ? 'status-active' : 'status-pending'}">${isActive ? 'Aktif' : 'Belum Aktif'}</span>
                </div>`;
    }).join('');
}

function renderReferralUI() {
    const container = document.getElementById("referralSectionBody");
    if (!container || !currentUser) return;

    const activeCount = getActiveReferralCount();
    const totalCount = referralList.length;
    const claimed = getClaimedLadderMap();
    const claimedBonusTotal = REFERRAL_LADDER.filter(m => claimed[m.count]).reduce((s, m) => s + m.bonus, 0);
    const totalPoinDidapat = (activeCount * REFERRAL_BASE_POINTS) + claimedBonusTotal;
    const code = currentUser.customId || '-';

    container.innerHTML = `
        <div class="ref-box">
            <div class="label">KODE REFERRAL KAMU</div>
            <div class="ref-code-row">
                <span class="code">${code}</span>
                <button class="btn-copy" onclick="copyReferralCode()">SALIN</button>
            </div>
            <button class="btn-share" onclick="shareReferralWA()">📤 Bagikan via WhatsApp</button>
        </div>

        <div class="summary-row">
            <div class="summary-pill sp-total"><b>${totalCount}</b>Total Diundang</div>
            <div class="summary-pill sp-active"><b>${activeCount}</b>Sudah Aktif</div>
            <div class="summary-pill sp-points"><b>${totalPoinDidapat.toLocaleString('id-ID')}</b>Poin Didapat</div>
        </div>

        ${buildReferralLadderHTML(activeCount, claimed)}

        <div class="ref-table-header" style="margin-top:18px;">
            <h4>📋 Daftar Reseller Diundang</h4>
            <span class="count">${totalCount} orang</span>
        </div>
        <div class="ref-list">${buildReferralTableHTML()}</div>
    `;
}

// ---------------------------------------------------------------
// 4) AKSI: SALIN KODE, BAGIKAN, KLAIM TANGGA
// ---------------------------------------------------------------
function copyReferralCode() {
    const code = currentUser?.customId || '';
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => {
        alert("Kode referral disalin: " + code);
    }).catch(() => {
        alert("Kode referral kamu: " + code);
    });
}

function shareReferralWA() {
    const code = currentUser?.customId || '';
    const link = `${window.location.origin}${window.location.pathname}?ref=${code}`;
    const text = `Yuk gabung jadi reseller OKTSHOP17! 🛍️\n\nDaftar lewat link ini dan pakai kode referral saya: *${code}*\n${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

async function claimMilestone(count, bonus) {
    if (!confirm(`Klaim bonus ${bonus.toLocaleString('id-ID')} poin untuk pencapaian ${count} reseller aktif?`)) return;

    const userRef = db.collection("users").doc(currentUser.id);
    try {
        await db.runTransaction(async (t) => {
            // 1) BACA DULU
            const uSnap = await t.get(userRef);
            const uData = uSnap.data() || {};
            const claims = { ...(uData.referralClaims || {}) };

            if (claims[count]) return; // sudah pernah diklaim, jangan dobel

            // Verifikasi ulang syaratnya (pakai data referralList yang sudah live-sync di client)
            if (getActiveReferralCount() < count) {
                throw new Error("Jumlah reseller aktif belum mencukupi.");
            }

            claims[count] = true;
            const currentBonus = uData.bonusPoints || 0;

            // 2) BARU TULIS
            t.update(userRef, {
                referralClaims: claims,
                bonusPoints: currentBonus + bonus
            });
        });

        currentUser.referralClaims = { ...(currentUser.referralClaims || {}), [count]: true };
        currentUser.bonusPoints = (currentUser.bonusPoints || 0) + bonus;
        renderReferralUI();
        alert(`🎉 Selamat! Bonus ${bonus.toLocaleString('id-ID')} poin berhasil dicairkan!`);
    } catch (err) {
        alert("Gagal klaim: " + err.message);
    }
}

// ---------------------------------------------------------------
// 6) KEBIJAKAN PRIVASI — dibuka lewat tombol, wajib di-scroll sampai bawah DI DALAM MODAL
// ---------------------------------------------------------------
function openPrivacyModal() {
    const modal = document.getElementById("privacyModal");
    const box = document.getElementById("privacyPolicyBox");
    const btn = document.getElementById("btnAgreePrivacy");
    alert("DEBUG 4B: modal=" + (modal ? "ADA" : "TIDAK ADA") + " | box=" + (box ? "ADA" : "TIDAK ADA") + " | btn=" + (btn ? "ADA" : "TIDAK ADA"));
    if (!modal || !box || !btn) { alert("DEBUG 4C: BERHENTI DI SINI - salah satu elemen di atas tidak ditemukan."); return; }

    modal.classList.remove("hidden");
    alert("DEBUG 4D: class modal sekarang = " + modal.className);
    box.scrollTop = 0; // selalu mulai dari atas tiap dibuka

    // Kalau checkbox sudah pernah disetujui sebelumnya, tombol langsung aktif juga
    const alreadyAgreed = document.getElementById("agreePrivacy")?.checked;
    setAgreeButtonState(alreadyAgreed);
    alert("DEBUG 4E: selesai openPrivacyModal, seharusnya modal sudah tampil.");
}

function closePrivacyModal() {
    document.getElementById("privacyModal")?.classList.add("hidden");
}

function setAgreeButtonState(enabled) {
    const btn = document.getElementById("btnAgreePrivacy");
    if (!btn) return;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? "1" : "0.5";
    btn.textContent = enabled ? "✅ SAYA SETUJU" : "Baca sampai bawah dulu ⬇️";
}

function confirmAgreePrivacy() {
    const checkbox = document.getElementById("agreePrivacy");
    const label = document.getElementById("privacyCheckboxLabel");
    const text = document.getElementById("privacyCheckboxText");
    if (checkbox) checkbox.checked = true;
    if (label) { label.classList.remove("hidden"); label.classList.add("ready"); }
    if (text) text.textContent = "✅ Kebijakan Privasi sudah disetujui";
    closePrivacyModal();

    // Kalau modal ini dibuka otomatis karena user tadi klik "Daftar & Aktivasi",
    // lanjutkan proses pendaftaran sekarang tanpa perlu klik Daftar lagi
    if (window.pendingRegistrationAfterPrivacy) {
        window.pendingRegistrationAfterPrivacy = false;
        if (typeof performRegistration === 'function') performRegistration();
    }
}

(function setupPrivacyModalScrollListener() {
    function init() {
        const box = document.getElementById("privacyPolicyBox");
        if (!box) return;

        // Kalau isinya pendek dan langsung muat semua tanpa perlu scroll
        function checkInitialFit() {
            if (box.scrollHeight <= box.clientHeight + 4) setAgreeButtonState(true);
        }

        box.addEventListener("scroll", () => {
            const scrolledToBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
            if (scrolledToBottom) setAgreeButtonState(true);
        });

        // Cek ulang tiap modal dibuka (ukuran box baru kelihatan setelah modal tampil)
        const modal = document.getElementById("privacyModal");
        if (modal) {
            const observer = new MutationObserver(() => {
                if (!modal.classList.contains("hidden")) setTimeout(checkInitialFit, 50);
            });
            observer.observe(modal, { attributes: true, attributeFilter: ["class"] });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();

// ---------------------------------------------------------------
// 5) AUTO-ISI KODE REFERRAL DI FORM DAFTAR DARI URL (?ref=KODE)
// ---------------------------------------------------------------
(function prefillReferralCodeFromURL() {
    try {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get("ref");
        if (!ref) return;
        const tryFill = () => {
            const input = document.getElementById("regRefCode");
            if (input) { input.value = ref; return true; }
            return false;
        };
        if (!tryFill()) {
            // Elemen mungkin belum ter-render saat script ini jalan; coba lagi setelah DOM siap
            document.addEventListener("DOMContentLoaded", tryFill);
        }
    } catch (e) { /* abaikan kalau URLSearchParams tidak didukung */ }
})();

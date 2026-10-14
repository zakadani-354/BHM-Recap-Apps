"use strict";

const GROUPS = [
  "Baitu Taqwa",
  "Almansurin",
  "Al Huda",
  "Al Malik",
  "Miftahul Jannah",
  "Baitul Makmur"
];
const STORAGE_KEYS = {
  attendance: "bhm-recap-attendance",
  members: "bhm-recap-members",
  accounts: "bhm-recap-accounts"
};
const SESSION_KEY = "bhm-recap-active-session";
const DEFAULT_ACCOUNTS = {
  admin: { password: "admin123", role: "admin" },
  pengurus: { password: "pengurus123", role: "pengurus" }
};

let presensiData = readArray(STORAGE_KEYS.attendance);
const savedMembers = readArray(STORAGE_KEYS.members);
const memberIds = new Set();
let jamaahData = savedMembers.map((member) => {
  const id = member.id && !memberIds.has(member.id) ? member.id : createMemberId();
  memberIds.add(id);
  return {
    ...member,
    id,
    jenisKelamin: normalizeGender(member.jenisKelamin || member.gender)
  };
});
let barcodeScanner = null;
let attendanceBatchFileData = null;
window.currentRole = null;
if (JSON.stringify(jamaahData) !== JSON.stringify(savedMembers)) {
  saveMembers();
}

function createMemberId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `bhm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeGender(value) {
  const gender = String(value || "").trim().toLowerCase();
  if (["pria", "laki-laki", "laki laki", "l", "male"].includes(gender)) return "Pria";
  if (["wanita", "perempuan", "p", "female"].includes(gender)) return "Wanita";
  return "Tidak diatur";
}

function normalizeNameForMatch(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("id-ID");
}

function normalizeGroupForMatch(value) {
  return String(value || "").trim().toLocaleLowerCase("id-ID");
}

function isDuplicateMember(member, existingMembers = jamaahData) {
  const normalizedName = normalizeNameForMatch(member.nama);
  if (!normalizedName) return false;
  return existingMembers.some((existing) =>
    normalizeNameForMatch(existing.nama) === normalizedName
      && normalizeGroupForMatch(existing.kelompok) === normalizeGroupForMatch(member.kelompok));
}

function attendanceBelongsToMember(record, member) {
  if (record.memberId && member.id && record.memberId === member.id) return true;
  return normalizeNameForMatch(record.nama) === normalizeNameForMatch(member.nama)
    && normalizeGroupForMatch(record.kelompok) === normalizeGroupForMatch(member.kelompok);
}

function readArray(key) {
  const stored = localStorage.getItem(key);
  if (!stored) return [];
  const value = JSON.parse(stored);
  if (!Array.isArray(value)) {
    throw new Error(`Data tersimpan untuk ${key} bukan daftar yang valid.`);
  }
  return value;
}

function getAccounts() {
  const stored = localStorage.getItem(STORAGE_KEYS.accounts);
  if (!stored) {
    localStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(DEFAULT_ACCOUNTS));
    return structuredClone(DEFAULT_ACCOUNTS);
  }
  const accounts = JSON.parse(stored);
  if (!accounts || typeof accounts !== "object") {
    throw new Error("Data akun tersimpan tidak valid.");
  }
  return accounts;
}

function saveAttendance() {
  localStorage.setItem(STORAGE_KEYS.attendance, JSON.stringify(presensiData));
}

function saveMembers() {
  localStorage.setItem(STORAGE_KEYS.members, JSON.stringify(jamaahData));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  const statuses = {
    h: "Hadir",
    hadir: "Hadir",
    i: "Izin",
    izin: "Izin",
    s: "Sakit",
    sakit: "Sakit",
    a: "Alpa",
    alpa: "Alpa",
    alpha: "Alpa"
  };
  return statuses[status] || "";
}

function currentMonth() {
  return localDateString().slice(0, 7);
}

function localDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function showPage(id) {
  const target = document.getElementById(`page-${id}`);
  if (!target) throw new Error(`Halaman "${id}" tidak ditemukan.`);
  if (id === "admin" && window.currentRole !== "admin") {
    showPage("dashboard");
    return;
  }
  document.querySelectorAll(".page").forEach((page) => page.classList.add("hidden"));
  target.classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
  });
  updateActiveSession({ page: id });
  window.scrollTo(0, 0);
  if (id === "dashboard") renderDashboard();
  if (id === "presensi") renderRiwayat();
  if (id === "jamaah") renderJamaah();
}

function switchTab(tab) {
  document.getElementById("tab-input").classList.toggle("hidden", tab !== "input");
  document.getElementById("tab-riwayat").classList.toggle("hidden", tab !== "riwayat");
  document.querySelectorAll("#page-presensi .tabs .tab").forEach((button, index) => {
    button.classList.toggle("active", (index === 0) === (tab === "input"));
  });
  if (tab === "riwayat") renderRiwayat();
  updateActiveSession({ presensiTab: tab });
}

function setAttendanceMode(mode) {
  const isSingle = mode === "satuan";
  const singleSection = document.getElementById("attendance-single");
  const massSection = document.getElementById("attendance-mass");
  singleSection.classList.toggle("hidden", !isSingle);
  massSection.classList.toggle("hidden", isSingle);
  singleSection.querySelectorAll("input,select,textarea").forEach((control) => {
    control.disabled = !isSingle;
  });
  massSection.querySelectorAll("input,select,textarea").forEach((control) => {
    control.disabled = isSingle;
  });
  document.getElementById("attendance-mode-single").classList.toggle("active", isSingle);
  document.getElementById("attendance-mode-mass").classList.toggle("active", !isSingle);
  document.getElementById("p-metode").value = "Satuan";
  const session = sessionStorage.getItem(SESSION_KEY);
  if (session) updateActiveSession({ attendanceMode: mode });
  if (!isSingle && barcodeScanner) {
    stopBarcodeScanner().catch((error) => {
      const message = document.getElementById("scanner-message");
      message.textContent = `Kamera gagal ditutup saat beralih ke input massal: ${error.message}`;
      message.className = "form-message error-message";
    });
  }
}

function switchJamaahTab(tab) {
  document.getElementById("jamaah-satuan").classList.toggle("hidden", tab !== "satuan");
  document.getElementById("jamaah-file").classList.toggle("hidden", tab !== "file");
  document.querySelectorAll("#page-jamaah .tabs .tab").forEach((button, index) => {
    button.classList.toggle("active", (index === 0) === (tab === "satuan"));
  });
  updateActiveSession({ jamaahTab: tab });
}

function updateActiveSession(updates) {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (!stored) return;
  const activeSession = JSON.parse(stored);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...activeSession, ...updates }));
}

function openApp(username, role, page = "dashboard", presensiTab = "input", jamaahTab = "satuan", attendanceMode = "satuan") {
  window.currentRole = role;
  document.getElementById("view-login").classList.add("hidden");
  document.getElementById("main-header").style.display = "";
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("current-user").textContent =
    `${username} · ${role === "admin" ? "Admin" : "Pengurus"}`;
  document.getElementById("nav-admin").classList.toggle("hidden", role !== "admin");

  const isAdmin = role === "admin";
  document.querySelector("#page-jamaah .tabs").classList.toggle("hidden", !isAdmin);
  document.querySelector("#jamaah-satuan form").classList.toggle("hidden", !isAdmin);
  if (!isAdmin) {
    document.getElementById("jamaah-file").classList.add("hidden");
    document.getElementById("jamaah-satuan").classList.remove("hidden");
  } else {
    document.getElementById("jamaah-satuan").classList.remove("hidden");
  }
  switchTab(presensiTab === "riwayat" ? "riwayat" : "input");
  setAttendanceMode(attendanceMode === "massal" ? "massal" : "satuan");
  switchJamaahTab(jamaahTab === "file" ? "file" : "satuan");
  showPage(page === "admin" && !isAdmin ? "dashboard" : page);
}

function restoreActiveSession() {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (!stored) return;
  let activeSession;
  try {
    activeSession = JSON.parse(stored);
  } catch (error) {
    sessionStorage.removeItem(SESSION_KEY);
    console.warn("Sesi login lokal tidak valid dan telah dihapus.", error);
    return;
  }
  if (!activeSession || typeof activeSession !== "object" || Array.isArray(activeSession)) {
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }
  const username = String(activeSession.username || "").toLowerCase();
  const account = getAccounts()[username];
  const validPages = ["dashboard", "presensi", "jamaah", "asisten", "admin"];
  if (!account || account.role !== activeSession.role
      || !validPages.includes(activeSession.page || "dashboard")) {
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }
  openApp(
    username,
    account.role,
    activeSession.page || "dashboard",
    activeSession.presensiTab || "input",
    activeSession.jamaahTab || "satuan",
    activeSession.attendanceMode || "satuan"
  );
}

function doLogin() {
  const username = document.getElementById("name").value.trim().toLowerCase();
  const password = document.getElementById("pass").value;
  const account = getAccounts()[username];
  const error = document.getElementById("login-error");
  if (!account || account.password !== password) {
    error.textContent = "Username atau password salah.";
    error.classList.remove("hidden");
    return;
  }

  error.textContent = "";
  error.classList.add("hidden");
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    username,
    role: account.role,
    page: "dashboard",
    presensiTab: "input",
    jamaahTab: "satuan",
    attendanceMode: "satuan"
  }));
  openApp(username, account.role);
}

function logoutApp() {
  sessionStorage.removeItem(SESSION_KEY);
  window.currentRole = null;
  document.getElementById("pass").value = "";
  document.getElementById("app").classList.add("hidden");
  document.getElementById("main-header").style.display = "none";
  document.getElementById("view-login").classList.remove("hidden");
  document.querySelectorAll(".page").forEach((page) => page.classList.add("hidden"));
  document.getElementById("page-dashboard").classList.remove("hidden");
}

function memberForRecord(record) {
  return jamaahData.find((member) => member.id === record.memberId)
    || jamaahData.find((member) => member.nama.toLowerCase() === record.nama.toLowerCase()
      && member.kelompok === record.kelompok);
}

function isInGenderFilter(member, selectedGender) {
  return !selectedGender || member?.jenisKelamin === selectedGender;
}

function dashboardRecordsForMonth(month, selectedGroup) {
  const records = presensiData.filter((record) => record.tanggal.startsWith(month)
    && (!selectedGroup || record.kelompok === selectedGroup));
  const sessionMembers = new Map();
  records.forEach((record) => {
    const sessionKey = `${record.kelompok}\u0000${record.tanggal}`;
    if (!sessionMembers.has(sessionKey)) sessionMembers.set(sessionKey, new Set());
    const member = memberForRecord(record);
    if (member) sessionMembers.get(sessionKey).add(member.id);
  });

  const automaticAlpa = [];
  sessionMembers.forEach((attendedMemberIds, sessionKey) => {
    const [group, date] = sessionKey.split("\u0000");
    jamaahData
      .filter((member) => member.peran.toLowerCase() === "jamaah" && member.kelompok === group)
      .forEach((member) => {
        if (!attendedMemberIds.has(member.id)) {
          automaticAlpa.push({
            memberId: member.id,
            nama: member.nama,
            kelompok: member.kelompok,
            tanggal: date,
            status: "Alpa",
            metode: "Otomatis"
          });
        }
      });
  });
  return [...records, ...automaticAlpa];
}

function selectedMonthRecords() {
  const month = document.getElementById("f-bulan").value || currentMonth();
  const selectedGender = document.getElementById("f-gender").value;
  const selectedGroup = document.getElementById("f-group").value;
  const allMonthRecords = dashboardRecordsForMonth(month, selectedGroup);
  const monthRecords = allMonthRecords.filter((record) =>
    isInGenderFilter(memberForRecord(record), selectedGender));
  const groups = (selectedGroup ? [selectedGroup] : GROUPS).map((group) => {
    const records = monthRecords.filter((record) => record.kelompok === group);
    const rate = records.length
      ? records.filter((record) => record.status === "Hadir").length / records.length
      : 0;
    return { group, records, rate, percentage: Math.round(rate * 100) };
  });
  const filter = document.getElementById("f-tingkat");
  const previousThreshold = Number(filter.value) || 0;
  const maxPercentage = Math.max(0, ...groups
    .filter((item) => item.records.length)
    .map((item) => item.percentage));
  filter.innerHTML = Array.from({ length: maxPercentage + 1 }, (_, percentage) =>
    `<option value="${percentage}">${percentage}%</option>`
  ).join("");
  filter.value = String(Math.min(previousThreshold, maxPercentage));
  const minimumPercentage = Number(filter.value);
  return {
    groups,
    visibleGroups: groups.filter((item) => item.percentage >= minimumPercentage),
    monthRecords,
    allMonthRecords,
    month,
    selectedGender,
    selectedGroup
  };
}

function renderStatusDonut(records) {
  const statuses = [
    { label: "Hadir", color: "#059669" },
    { label: "Izin", color: "#3b82f6" },
    { label: "Sakit", color: "#f59e0b" },
    { label: "Alpa", display: "Alpha", color: "#ef4444" }
  ].map((item) => ({
    ...item,
    count: records.filter((record) => record.status === item.label).length
  }));
  const total = statuses.reduce((sum, item) => sum + item.count, 0);
  let stop = 0;
  const segments = statuses.map((item) => {
    const start = stop;
    stop += total ? item.count / total * 100 : 0;
    return `${item.color} ${start}% ${stop}%`;
  });
  if (!total) segments.push("#e2e8f0 0% 100%");
  const gradient = `conic-gradient(${segments.join(", ")})`;
  document.getElementById("status-donut").innerHTML = `
    <div class="donut-chart" role="img" aria-label="Diagram donat rincian status presensi"
      style="background:${gradient}">
      <div class="donut-hole"><strong>${total}</strong><span>Presensi</span></div>
    </div>
    <ul class="donut-legend">${statuses.map((item) => `
      <li><span class="legend-swatch" style="background:${item.color}"></span>
          <span>${item.display || item.label}</span><strong>${item.count}</strong></li>`).join("")}
    </ul>`;
}

function renderDashboard() {
  const { groups, visibleGroups, monthRecords, allMonthRecords, month } = selectedMonthRecords();
  const visibleGroupNames = new Set(visibleGroups.map((item) => item.group));
  const filteredRecords = monthRecords.filter((record) => visibleGroupNames.has(record.kelompok));
  const hadir = filteredRecords.filter((record) => record.status === "Hadir").length;
  const genderCount = (gender) => allMonthRecords
    .filter((record) => record.status === "Hadir"
      && memberForRecord(record)?.jenisKelamin === gender).length;
  const memberStats = jamaahData
    .filter((member) => member.peran.toLowerCase() === "jamaah"
      && isInGenderFilter(member, document.getElementById("f-gender").value)
      && (!document.getElementById("f-group").value || member.kelompok === document.getElementById("f-group").value))
    .map((member) => {
      const records = monthRecords.filter((record) => memberForRecord(record)?.id === member.id);
      const attendanceRate = records.length
        ? records.filter((record) => record.status === "Hadir").length / records.length
        : 0;
      return { member, rate: attendanceRate };
    });
  const rowsByAttendance = (rate) => groups
    .map(({ group }) => {
      const count = memberStats.filter((item) => item.member.kelompok === group && item.rate === rate).length;
      return `<tr><td>${escapeHtml(group)}</td><td>${count}</td></tr>`;
    }).join("") || '<tr><td colspan="2">Tidak ada kelompok pada filter ini.</td></tr>';

  document.getElementById("dashboard-cards").innerHTML = [
    ["Total Presensi", filteredRecords.length, `Bulan ${month}`],
    ["Hadir", hadir, `${filteredRecords.length ? Math.round(hadir / filteredRecords.length * 100) : 0}% dari presensi`],
    ["Jamaah Terdaftar", memberStats.length, "Sesuai filter"],
    ["Pria Hadir", genderCount("Pria"), "Data presensi"],
    ["Wanita Hadir", genderCount("Wanita"), "Data presensi"]
  ].map(([title, value, meta]) => `
    <article class="card">
      <h3>${escapeHtml(title)}</h3>
      <p class="value">${escapeHtml(value)}</p>
      <p class="meta">${escapeHtml(meta)}</p>
    </article>`).join("");

  document.getElementById("attendance-chart").innerHTML = visibleGroups.length
    ? visibleGroups.map(({ group, records, percentage }) => `
      <div class="chart-row">
        <span class="chart-label">${escapeHtml(group)}</span>
        <span class="chart-track" aria-hidden="true"><span class="chart-bar" style="width:${percentage}%"></span></span>
        <span class="chart-value">${records.length ? `${percentage}%` : "—"}</span>
      </div>`).join("")
    : '<p class="chart-empty">Tidak ada kelompok pada tingkat kehadiran ini.</p>';
  renderStatusDonut(filteredRecords);
  document.getElementById("dash-zero-table").innerHTML = rowsByAttendance(0);
  document.getElementById("dash-full-table").innerHTML = rowsByAttendance(1);
}

function renderRiwayat() {
  const group = document.getElementById("r-kelompok").value;
  const records = presensiData
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => !group || record.kelompok === group)
    .sort((a, b) => b.record.tanggal.localeCompare(a.record.tanggal)
      || a.record.nama.localeCompare(b.record.nama));
  document.getElementById("riwayat-table").innerHTML = records.map(({ record, index }) => `
    <tr>
      <td><input class="attendance-row-select" type="checkbox" value="${index}"
        aria-label="Pilih presensi ${escapeHtml(record.nama)} tanggal ${escapeHtml(record.tanggal)}"
        onchange="updateAttendanceSelection()"></td>
      <td>${escapeHtml(record.tanggal)}</td>
      <td>${escapeHtml(record.nama)}</td>
      <td>${escapeHtml(record.kelompok)}</td>
      <td>${escapeHtml(record.status)}</td>
      <td>${escapeHtml(record.metode)}</td>
    </tr>`).join("") || '<tr><td colspan="6">Belum ada riwayat presensi.</td></tr>';
  document.getElementById("riwayat-select-all").checked = false;
  document.getElementById("riwayat-select-all").indeterminate = false;
  updateAttendanceSelection();
}

function updateAttendanceSelection() {
  const checkboxes = [...document.querySelectorAll("#riwayat-table .attendance-row-select")];
  const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  const selectAll = document.getElementById("riwayat-select-all");
  selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  const deleteButton = document.getElementById("delete-selected-attendance");
  deleteButton.disabled = selectedCount === 0;
  deleteButton.textContent = `Hapus dipilih (${selectedCount})`;
}

function toggleAllAttendanceSelection(checked) {
  document.querySelectorAll("#riwayat-table .attendance-row-select")
    .forEach((checkbox) => { checkbox.checked = checked; });
  updateAttendanceSelection();
}

function deleteSelectedAttendance() {
  const selectedIndices = new Set(
    [...document.querySelectorAll("#riwayat-table .attendance-row-select:checked")]
      .map((checkbox) => Number(checkbox.value))
  );
  if (!selectedIndices.size) return;
  if (!window.confirm(`Hapus ${selectedIndices.size} catatan presensi yang dipilih?`)) return;

  presensiData = presensiData.filter((_, index) => !selectedIndices.has(index));
  saveAttendance();
  const message = document.getElementById("riwayat-delete-message");
  message.textContent = `${selectedIndices.size} catatan presensi berhasil dihapus.`;
  message.className = "form-message success-message";
  renderRiwayat();
  renderDashboard();
}

function renderJamaah() {
  const isAdmin = window.currentRole === "admin";
  const group = document.getElementById("jamaah-filter-group").value;
  const role = document.getElementById("jamaah-filter-role").value;
  document.getElementById("jamaah-table").innerHTML = [...jamaahData]
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => (!group || member.kelompok === group)
      && (!role || member.peran === role))
    .sort((a, b) => a.member.kelompok.localeCompare(b.member.kelompok)
      || a.member.nama.localeCompare(b.member.nama))
    .map(({ member, index }) => `<tr>
      ${isAdmin ? `<td><input class="member-row-select" type="checkbox" value="${index}"
        aria-label="Pilih ${escapeHtml(member.nama)}" onchange="updateMemberSelection()"></td>` : ""}
      <td>${escapeHtml(member.nama)}</td>
      <td>${escapeHtml(member.kelompok)}</td>
      <td>${member.jenisKelamin === "Tidak diatur" && isAdmin
        ? `<label class="sr-only" for="member-gender-${index}">Atur jenis kelamin ${escapeHtml(member.nama)}</label>
          <select id="member-gender-${index}" class="member-gender-select" onchange="updateMemberGender(${index},this.value)">
            <option value="">Atur jenis kelamin...</option><option value="Pria">Pria</option><option value="Wanita">Wanita</option>
          </select>`
        : escapeHtml(member.jenisKelamin)}</td>
      <td>${escapeHtml(member.peran)}</td>
      <td class="member-actions">
        <button class="table-action" type="button" onclick="selectMemberBarcode(${index})">Barcode</button>
        ${isAdmin ? `<button class="table-action member-edit-button" type="button" onclick="editJamaah(${index})">Edit</button>` : ""}
        ${isAdmin ? `<button class="table-action" type="button" onclick="removeJamaah(${index})" aria-label="Hapus ${escapeHtml(member.nama)}">Hapus</button>` : ""}
      </td>
    </tr>`).join("") || `<tr><td colspan="${isAdmin ? 6 : 5}">Tidak ada data jamaah yang sesuai filter.</td></tr>`;
  document.getElementById("jamaah-select-all-header").classList.toggle("hidden", !isAdmin);
  document.getElementById("jamaah-select-all").checked = false;
  document.getElementById("jamaah-select-all").indeterminate = false;
  document.getElementById("delete-selected-members").classList.toggle("hidden", !isAdmin);
  updateMemberSelection();
  renderBarcodeMemberOptions();
  updateAttendanceMemberOptions();
}

function updateMemberSelection() {
  const checkboxes = [...document.querySelectorAll("#jamaah-table .member-row-select")];
  const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  const selectAll = document.getElementById("jamaah-select-all");
  selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  const deleteButton = document.getElementById("delete-selected-members");
  deleteButton.disabled = selectedCount === 0;
  deleteButton.textContent = `Hapus dipilih (${selectedCount})`;
}

function toggleAllMemberSelection(checked) {
  document.querySelectorAll("#jamaah-table .member-row-select")
    .forEach((checkbox) => { checkbox.checked = checked; });
  updateMemberSelection();
}

function deleteSelectedMembers() {
  if (window.currentRole !== "admin") {
    alert("Hanya admin yang dapat menghapus data jamaah.");
    return;
  }
  const selectedIndices = new Set(
    [...document.querySelectorAll("#jamaah-table .member-row-select:checked")]
      .map((checkbox) => Number(checkbox.value))
  );
  if (!selectedIndices.size) return;

  const selectedMembers = [...selectedIndices].map((index) => jamaahData[index]).filter(Boolean);
  const membersWithAttendance = selectedMembers.filter((member) => presensiData.some((record) =>
    (record.memberId && record.memberId === member.id)
      || (record.nama.toLowerCase() === member.nama.toLowerCase()
        && record.kelompok === member.kelompok)));
  const message = document.getElementById("jamaah-action-message");
  if (membersWithAttendance.length) {
    message.textContent = `Tidak dapat menghapus jamaah yang memiliki riwayat presensi: ${membersWithAttendance.map((member) => member.nama).join(", ")}.`;
    message.className = "form-message error-message";
    return;
  }
  if (!window.confirm(`Hapus ${selectedMembers.length} jamaah yang dipilih?`)) return;

  jamaahData = jamaahData.filter((_, index) => !selectedIndices.has(index));
  saveMembers();
  message.textContent = `${selectedMembers.length} jamaah berhasil dihapus.`;
  message.className = "form-message success-message";
  renderJamaah();
  renderDashboard();
}

function updateAttendanceMemberOptions(selectedId = "") {
  const group = document.getElementById("p-kelompok").value;
  const gender = document.getElementById("p-gender").value;
  const role = document.getElementById("p-peran").value;
  const nameSelect = document.getElementById("p-nama");
  const candidates = jamaahData.filter((member) => member.kelompok === group
    && member.jenisKelamin === gender && member.peran === role);
  nameSelect.innerHTML = `<option value="">${candidates.length ? "Pilih nama..." : "Tidak ada jamaah yang cocok"}</option>`
    + candidates.map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.nama)}</option>`).join("");
  nameSelect.disabled = !group || !gender || !role || !candidates.length;
  if (selectedId && candidates.some((member) => member.id === selectedId)) {
    nameSelect.value = selectedId;
  }
}

function attendanceManualSelectionChanged() {
  document.getElementById("p-metode").value = "Satuan";
  updateAttendanceMemberOptions();
}

function renderBarcodeMemberOptions() {
  const select = document.getElementById("barcode-member");
  if (!select) return;
  const group = document.getElementById("barcode-group").value;
  const selectedId = select.value;
  const candidates = jamaahData.filter((member) => group && member.kelompok === group);
  const placeholder = !group ? "Pilih kelompok terlebih dahulu..."
    : candidates.length ? "Pilih jamaah..." : "Tidak ada jamaah di kelompok ini.";
  select.innerHTML = `<option value="">${placeholder}</option>`
    + candidates
    .map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.nama)} — ${escapeHtml(member.kelompok)} (${escapeHtml(member.jenisKelamin)})</option>`)
    .join("");
  select.disabled = !group || candidates.length === 0;
  if (candidates.some((member) => member.id === selectedId)) select.value = selectedId;
  else select.value = "";
  renderSelectedBarcode();
}

function renderSelectedBarcode() {
  const member = jamaahData.find((item) => item.id === document.getElementById("barcode-member").value);
  const preview = document.getElementById("barcode-preview");
  const message = document.getElementById("barcode-message");
  if (!member) {
    preview.classList.add("hidden");
    message.textContent = "";
    return;
  }
  if (typeof window.QRCode !== "function") {
    preview.classList.add("hidden");
    message.textContent = "Pustaka QR code tidak tersedia. Periksa koneksi internet lalu muat ulang.";
    message.className = "form-message error-message";
    return;
  }
  try {
    const codeElement = document.getElementById("member-qrcode");
    codeElement.replaceChildren();
    new window.QRCode(codeElement, {
      text: `BHM:${member.id}`,
      width: 240,
      height: 240,
      colorDark: "#064e3b",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.H
    });
    document.getElementById("barcode-member-caption").textContent = member.nama;
    preview.classList.remove("hidden");
    message.textContent = "";
    message.className = "form-message";
  } catch (error) {
    preview.classList.add("hidden");
    message.textContent = `Barcode gagal dibuat: ${error.message}`;
    message.className = "form-message error-message";
  }
}

function selectMemberBarcode(index) {
  const member = jamaahData[index];
  if (!member) return;
  document.getElementById("barcode-group").value = member.kelompok;
  renderBarcodeMemberOptions();
  document.getElementById("barcode-member").value = member.id;
  renderSelectedBarcode();
  document.querySelector(".barcode-manager").scrollIntoView({ behavior: "smooth", block: "center" });
}

function selectedBarcodeMember() {
  return jamaahData.find((member) => member.id === document.getElementById("barcode-member").value);
}

async function createBarcodePng() {
  const member = selectedBarcodeMember();
  if (!member) throw new Error("Pilih jamaah terlebih dahulu.");
  if (!window.QRCode) throw new Error("Pustaka QR code tidak tersedia. Periksa koneksi internet.");
  renderSelectedBarcode();
  const sourceCanvas = document.querySelector("#member-qrcode canvas");
  if (!sourceCanvas) throw new Error("Gambar QR code belum siap. Coba lagi.");
  const canvas = document.createElement("canvas");
  const padding = 32;
  const nameHeight = 72;
  canvas.width = sourceCanvas.width + padding * 2;
  canvas.height = sourceCanvas.height + padding * 2 + nameHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas gambar tidak tersedia di browser.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceCanvas, padding, padding);
  context.fillStyle = "#064e3b";
  context.font = "bold 32px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(member.nama, canvas.width / 2, sourceCanvas.height + padding + nameHeight / 2, canvas.width - 24);
  return { member, dataUrl: canvas.toDataURL("image/png") };
}

async function downloadBarcodeImage() {
  const message = document.getElementById("barcode-message");
  try {
    const { member, dataUrl } = await createBarcodePng();
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `barcode-${member.nama.replace(/[^\w-]+/g, "-").toLowerCase()}.png`;
    link.click();
    message.textContent = "Barcode PNG berhasil diunduh.";
    message.className = "form-message success-message";
  } catch (error) {
    message.textContent = error.message;
    message.className = "form-message error-message";
  }
}

async function downloadBarcodePdf() {
  const message = document.getElementById("barcode-message");
  if (!window.jspdf?.jsPDF) {
    message.textContent = "Pustaka PDF tidak tersedia. Periksa koneksi internet lalu muat ulang.";
    message.className = "form-message error-message";
    return;
  }
  try {
    const { member, dataUrl } = await createBarcodePng();
    const pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.setFontSize(18);
    pdf.text("Barcode Jamaah BHM", 15, 20);
    pdf.setFontSize(12);
    pdf.text(`Nama: ${member.nama}`, 15, 29);
    pdf.text(`Kelompok: ${member.kelompok}`, 15, 36);
    pdf.text(`Jenis kelamin: ${member.jenisKelamin} · Peran: ${member.peran}`, 15, 43);
    pdf.addImage(dataUrl, "PNG", 55, 51, 100, 124);
    pdf.save(`barcode-${member.nama.replace(/[^\w-]+/g, "-").toLowerCase()}.pdf`);
    message.textContent = "Barcode PDF berhasil diunduh.";
    message.className = "form-message success-message";
  } catch (error) {
    message.textContent = `PDF barcode gagal dibuat: ${error.message}`;
    message.className = "form-message error-message";
  }
}

async function stopBarcodeScanner() {
  const scanner = barcodeScanner;
  if (!scanner) return;
  barcodeScanner = null;
  try {
    await scanner.stop();
    scanner.clear();
  } finally {
    document.getElementById("barcode-scanner").classList.add("hidden");
    document.getElementById("start-scanner").classList.remove("hidden");
    document.getElementById("stop-scanner").classList.add("hidden");
  }
}

function handleBarcodeScan(value) {
  const barcodeId = String(value).trim().replace(/^BHM:/i, "");
  const member = jamaahData.find((item) => item.id === barcodeId);
  if (!member) {
    const message = document.getElementById("scanner-message");
    message.textContent = "Barcode tidak cocok dengan data jamaah di aplikasi ini.";
    message.className = "form-message error-message";
    return;
  }
  document.getElementById("p-kelompok").value = member.kelompok;
  document.getElementById("p-gender").value = member.jenisKelamin;
  document.getElementById("p-peran").value = member.peran;
  updateAttendanceMemberOptions(member.id);
  document.getElementById("p-metode").value = "Barcode";
  const message = document.getElementById("scanner-message");
  message.textContent = `${member.nama} dipilih. Atur status lalu tekan Simpan.`;
  message.className = "form-message success-message";
  stopBarcodeScanner().catch((error) => {
    message.textContent = `Barcode terbaca, tetapi kamera gagal ditutup: ${error.message}`;
    message.className = "form-message error-message";
  });
}

function findBatchMemberMatches(query, group, gender) {
  const normalizedQuery = normalizeNameForMatch(query);
  const candidates = jamaahData.filter((member) => member.kelompok === group
    && member.jenisKelamin === gender
    && normalizeNameForMatch(member.nama).includes(normalizedQuery));
  const exactMatches = candidates.filter((member) =>
    normalizeNameForMatch(member.nama) === normalizedQuery);
  return exactMatches.length ? exactMatches : candidates;
}

function normalizeAttendanceDate(value) {
  const formatDate = (year, month, day) => {
    const numbers = [Number(year), Number(month), Number(day)];
    if (numbers.some((part) => !Number.isInteger(part)) || numbers[0] < 1000 || numbers[0] > 9999) {
      return "";
    }
    const date = new Date(Date.UTC(numbers[0], numbers[1] - 1, numbers[2]));
    if (date.getUTCFullYear() !== numbers[0]
        || date.getUTCMonth() + 1 !== numbers[1]
        || date.getUTCDate() !== numbers[2]) return "";
    return `${String(numbers[0]).padStart(4, "0")}-${String(numbers[1]).padStart(2, "0")}-${String(numbers[2]).padStart(2, "0")}`;
  };
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && window.XLSX?.SSF?.parse_date_code) {
    const parsed = window.XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return formatDate(parsed.y, parsed.m, parsed.d);
    }
  }
  const text = String(value || "").trim();
  let parts = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let year;
  let month;
  let day;
  if (parts) {
    [, year, month, day] = parts;
  } else {
    parts = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
    if (!parts) return "";
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    year = parts[3];
    if (first > 12) {
      day = parts[1];
      month = parts[2];
    } else if (second > 12) {
      month = parts[1];
      day = parts[2];
    } else {
      day = parts[1];
      month = parts[2];
    }
  }
  return formatDate(year, month, day);
}

function parseAttendanceFileRows(rows, fileName) {
  if (!rows.length) throw new Error("File tidak berisi data.");
  const firstCell = String(rows[0][0] || "").trim().toLowerCase();
  if (!["nama", "nama jamaah", "name", "jamaah"].includes(firstCell)) {
    throw new Error("Baris pertama harus diawali kolom Nama, lalu tanggal pengajian pada kolom berikutnya.");
  }
  const dates = rows[0].slice(1).map(normalizeAttendanceDate);
  if (!dates.length || dates.some((date) => !date)) {
    throw new Error("Tanggal pada baris pertama tidak valid. Gunakan format YYYY-MM-DD atau DD/MM/YYYY.");
  }
  if (new Set(dates).size !== dates.length) {
    throw new Error("Tanggal pengajian pada header tidak boleh berulang.");
  }
  const entries = rows.slice(1).map((row, index) => ({
    name: String(row[0] || "").trim(),
    statuses: dates.map((_, dateIndex) => String(row[dateIndex + 1] || "").trim()),
    line: index + 2,
    extraValues: row.slice(dates.length + 1).some((value) => String(value || "").trim())
  }));
  if (!entries.some((entry) => entry.statuses.some(Boolean))) {
    throw new Error("File belum memiliki status presensi pada sel tanggal.");
  }
  return { fileName, dates, entries };
}

async function loadBatchAttendanceFile(file) {
  if (!file) return;
  const message = document.getElementById("batch-file-message");
  attendanceBatchFileData = null;
  message.textContent = "";
  message.className = "form-message";
  try {
    const extension = file.name.split(".").pop().toLowerCase();
    let rows;
    if (extension === "csv") {
      rows = parseCsv(await file.text());
    } else if (extension === "xlsx") {
      if (!window.XLSX) {
        throw new Error("Pustaka XLSX tidak tersedia. Periksa koneksi internet lalu muat ulang.");
      }
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error("Workbook tidak memiliki lembar kerja.");
      rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
        header: 1,
        raw: true,
        defval: "",
        blankrows: false
      });
    } else {
      throw new Error("Pilih file dengan format CSV atau XLSX.");
    }
    attendanceBatchFileData = parseAttendanceFileRows(rows, file.name);
    document.getElementById("attendance-batch").value = "";
    message.textContent = `${file.name} dimuat: ${attendanceBatchFileData.entries.length} baris jamaah, ${attendanceBatchFileData.dates.length} tanggal. Periksa hasil pencocokan sebelum menyimpan.`;
    message.className = "form-message success-message";
    previewBatchMatches();
  } catch (error) {
    document.getElementById("attendance-batch-file").value = "";
    message.textContent = error.message;
    message.className = "form-message error-message";
    previewBatchMatches();
  }
}

function manualBatchTextChanged() {
  if (attendanceBatchFileData) {
    attendanceBatchFileData = null;
    document.getElementById("attendance-batch-file").value = "";
    const message = document.getElementById("batch-file-message");
    message.textContent = "";
    message.className = "form-message";
  }
  previewBatchMatches();
}

function resolveBatchPresensi(group, gender) {
  const incoming = [];
  const errors = [];
  const previews = [];
  const addEntry = (query, statusValue, date, location) => {
    const status = normalizeStatus(statusValue);
    if (!query || !status) {
      errors.push(`${location}: nama dan status H/I/S/A wajib diisi dengan benar.`);
      return;
    }
    const matches = findBatchMemberMatches(query, group, gender);
    if (!matches.length) {
      errors.push(`${location}: nama "${query}" tidak ditemukan pada kelompok ${group}, ${gender}.`);
      return;
    }
    if (matches.length > 1) {
      errors.push(`${location}: "${query}" cocok dengan beberapa nama: ${matches.map((member) => member.nama).join(", ")}. Ketik nama lebih lengkap.`);
      return;
    }
    const [member] = matches;
    const record = {
      memberId: member.id,
      nama: member.nama,
      kelompok: group,
      tanggal: date,
      status,
      metode: "Massal"
    };
    if (hasAttendance(record, incoming)) {
      errors.push(`${location}: presensi ${member.nama} tanggal ${date} sudah ada.`);
      return;
    }
    incoming.push(record);
    previews.push(`${location}: ${member.nama} — ${date} — ${status}`);
  };

  if (attendanceBatchFileData) {
    attendanceBatchFileData.entries.forEach((entry) => {
      if (entry.extraValues) {
        errors.push(`Baris ${entry.line}: terdapat data di luar kolom tanggal.`);
      }
      entry.statuses.forEach((status, dateIndex) => {
        if (!status) return;
        addEntry(entry.name, status, attendanceBatchFileData.dates[dateIndex],
          `Baris ${entry.line}, kolom ${dateIndex + 2}`);
      });
    });
  } else {
    const text = document.getElementById("attendance-batch").value.trim();
    if (!text) return { incoming, errors, previews };
    const date = document.getElementById("batch-date").value;
    if (!date) errors.push("Pilih tanggal presensi untuk input ketik.");
    try {
      parseCsv(text).forEach((row, index) => {
        addEntry((row[0] || "").trim(), row[1], date, `Baris ${index + 1}`);
      });
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { incoming, errors, previews };
}

function previewBatchMatches() {
  const preview = document.getElementById("batch-match-preview");
  const group = document.getElementById("batch-group").value;
  const gender = document.getElementById("batch-gender").value;
  const text = document.getElementById("attendance-batch").value.trim();
  if (!text && !attendanceBatchFileData) {
    preview.textContent = "";
    preview.className = "form-message batch-match-preview";
    return;
  }
  if (!GROUPS.includes(group) || !["Pria", "Wanita"].includes(gender)) {
    preview.textContent = "Pilih kelompok dan jenis kelamin untuk mencocokkan nama.";
    preview.className = "form-message batch-match-preview";
    return;
  }
  const { incoming, errors, previews } = resolveBatchPresensi(group, gender);
  preview.textContent = [...previews, ...errors].join("\n");
  preview.className = `form-message batch-match-preview ${errors.length ? "error-message" : "success-message"}`;
  if (!incoming.length && !errors.length) {
    preview.textContent = attendanceBatchFileData
      ? "Tidak ada status presensi yang dapat disimpan."
      : "Masukkan nama dan status untuk melihat pencocokan.";
  }
}

async function startBarcodeScanner() {
  const message = document.getElementById("scanner-message");
  if (!window.Html5Qrcode || !window.Html5QrcodeSupportedFormats) {
    message.textContent = "Pustaka pemindai barcode tidak tersedia. Periksa koneksi internet lalu muat ulang.";
    message.className = "form-message error-message";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    message.textContent = "Kamera tidak didukung pada browser ini. Buka aplikasi melalui HTTPS atau localhost.";
    message.className = "form-message error-message";
    return;
  }
  const scannerElement = document.getElementById("barcode-scanner");
  scannerElement.classList.remove("hidden");
  document.getElementById("start-scanner").classList.add("hidden");
  document.getElementById("stop-scanner").classList.remove("hidden");
  message.textContent = "Meminta akses kamera...";
  message.className = "form-message";
  barcodeScanner = new window.Html5Qrcode("barcode-scanner", {
    formatsToSupport: [
      window.Html5QrcodeSupportedFormats.QR_CODE,
      window.Html5QrcodeSupportedFormats.CODE_128
    ]
  });
  try {
    await barcodeScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      handleBarcodeScan,
      () => {}
    );
    message.textContent = "Arahkan kamera ke barcode jamaah.";
  } catch (error) {
    const scanner = barcodeScanner;
    barcodeScanner = null;
    if (scanner) scanner.clear();
    scannerElement.classList.add("hidden");
    document.getElementById("start-scanner").classList.remove("hidden");
    document.getElementById("stop-scanner").classList.add("hidden");
    message.textContent = `Kamera tidak dapat dibuka: ${error.message}`;
    message.className = "form-message error-message";
  }
}

function addPresensi() {
  const member = jamaahData.find((item) => item.id === document.getElementById("p-nama").value);
  const record = {
    memberId: member?.id,
    nama: member?.nama || "",
    kelompok: document.getElementById("p-kelompok").value,
    tanggal: document.getElementById("p-tanggal").value,
    status: document.getElementById("p-status").value,
    metode: document.getElementById("p-metode").value
  };
  if (!member || !GROUPS.includes(record.kelompok) || !record.tanggal) {
    alert("Pilih kelompok, jenis kelamin, peran, nama jamaah, dan tanggal.");
    return;
  }
  if (hasAttendance(record)) {
    alert("Presensi untuk nama, kelompok, dan tanggal tersebut sudah ada.");
    return;
  }
  presensiData.push(record);
  saveAttendance();
  if (record.metode === "Barcode") {
    document.querySelector("#tab-input form").reset();
    document.getElementById("scanner-message").textContent = "";
    document.getElementById("scanner-message").className = "form-message";
  } else {
    document.getElementById("p-nama").value = "";
    document.getElementById("p-metode").value = "Satuan";
  }
  renderRiwayat();
  renderDashboard();
  updateAttendanceMemberOptions();
  alert("Presensi disimpan.");
}

function hasAttendance(record, pending = []) {
  const recordName = normalizeNameForMatch(record.nama);
  if (!recordName || !record.kelompok || !record.tanggal) return false;
  return [...presensiData, ...pending].some((item) => {
    const sameMemberId = record.memberId && item.memberId && item.memberId === record.memberId;
    const sameNameAndGroup = normalizeNameForMatch(item.nama) === recordName
      && normalizeGroupForMatch(item.kelompok) === normalizeGroupForMatch(record.kelompok);
    return (sameMemberId || sameNameAndGroup) && item.tanggal === record.tanggal;
  });
}

function addJamaah() {
  const member = {
    nama: document.getElementById("j-nama").value.trim(),
    kelompok: document.getElementById("j-kelompok").value,
    jenisKelamin: document.getElementById("j-gender").value,
    id: createMemberId(),
    peran: document.getElementById("j-peran").value
  };
  if (!member.nama || !GROUPS.includes(member.kelompok)
      || !["Pria", "Wanita"].includes(member.jenisKelamin)) {
    alert("Isi nama, pilih kelompok, dan tentukan jenis kelamin.");
    return;
  }
  if (isDuplicateMember(member)) {
    alert("Nama tersebut sudah terdaftar pada kelompok yang dipilih.");
    return;
  }
  jamaahData.push(member);
  saveMembers();
  document.getElementById("j-nama").value = "";
  document.getElementById("j-gender").value = "";
  renderJamaah();
  renderDashboard();
}

function removeJamaah(index) {
  if (window.currentRole !== "admin") {
    alert("Hanya admin yang dapat menghapus data jamaah.");
    return;
  }
  const member = jamaahData[index];
  if (!member) return;
  if (presensiData.some((record) => attendanceBelongsToMember(record, member))) {
    alert("Data jamaah memiliki riwayat presensi dan tidak dapat dihapus.");
    return;
  }
  if (!confirm(`Hapus data ${member.nama}?`)) return;
  jamaahData.splice(index, 1);
  saveMembers();
  renderJamaah();
  renderDashboard();
}

function updateMemberGender(index, gender) {
  const member = jamaahData[index];
  if (window.currentRole !== "admin" || !member) {
    alert("Hanya admin yang dapat memperbarui data jamaah.");
    return;
  }
  if (!["Pria", "Wanita"].includes(gender)) {
    renderJamaah();
    return;
  }
  member.jenisKelamin = gender;
  saveMembers();
  renderJamaah();
  renderDashboard();
}

function editJamaah(index) {
  if (window.currentRole !== "admin") {
    alert("Hanya admin yang dapat mengedit data jamaah.");
    return;
  }
  const member = jamaahData[index];
  if (!member) return;

  document.getElementById("member-edit-id").value = member.id;
  document.getElementById("member-edit-name").value = member.nama;
  document.getElementById("member-edit-group").value = member.kelompok;
  document.getElementById("member-edit-gender").value =
    ["Pria", "Wanita"].includes(member.jenisKelamin) ? member.jenisKelamin : "";
  document.getElementById("member-edit-role").value = member.peran;
  document.getElementById("member-edit-message").textContent = "";
  document.getElementById("member-edit-message").className = "form-message";
  const form = document.getElementById("member-edit-form");
  form.classList.remove("hidden");
  form.scrollIntoView({ behavior: "smooth", block: "center" });
  document.getElementById("member-edit-name").focus();
}

function cancelJamaahEdit() {
  const form = document.getElementById("member-edit-form");
  form.reset();
  form.classList.add("hidden");
  const message = document.getElementById("member-edit-message");
  message.textContent = "";
  message.className = "form-message";
}

function saveJamaahEdit() {
  const message = document.getElementById("member-edit-message");
  if (window.currentRole !== "admin") {
    message.textContent = "Hanya admin yang dapat mengedit data jamaah.";
    message.className = "form-message error-message";
    return;
  }
  const memberId = document.getElementById("member-edit-id").value;
  const member = jamaahData.find((item) => item.id === memberId);
  if (!member) {
    message.textContent = "Data jamaah tidak ditemukan. Muat ulang daftar lalu coba lagi.";
    message.className = "form-message error-message";
    return;
  }

  const updatedMember = {
    ...member,
    nama: document.getElementById("member-edit-name").value.trim().replace(/\s+/g, " "),
    kelompok: document.getElementById("member-edit-group").value,
    jenisKelamin: document.getElementById("member-edit-gender").value,
    peran: document.getElementById("member-edit-role").value
  };
  if (!updatedMember.nama || !GROUPS.includes(updatedMember.kelompok)
      || !["Pria", "Wanita"].includes(updatedMember.jenisKelamin)
      || !["Jamaah", "Pengurus"].includes(updatedMember.peran)) {
    message.textContent = "Lengkapi nama, kelompok, jenis kelamin, dan peran dengan data yang valid.";
    message.className = "form-message error-message";
    return;
  }
  if (isDuplicateMember(updatedMember, jamaahData.filter((item) => item.id !== member.id))) {
    message.textContent = "Nama tersebut sudah terdaftar pada kelompok yang dipilih.";
    message.className = "form-message error-message";
    return;
  }

  Object.assign(member, updatedMember);
  saveMembers();
  cancelJamaahEdit();
  renderJamaah();
  renderDashboard();
  const result = document.getElementById("jamaah-action-message");
  result.textContent = "Data jamaah berhasil diperbarui.";
  result.className = "form-message success-message";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text).replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && quoted && source[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if ((character === "," || character === "\t" || character === ";") && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV memiliki tanda kutip yang tidak berpasangan.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function importFileData() {
  const fileInput = document.getElementById("jamaah-file-input");
  const message = document.getElementById("jamaah-import-message");
  try {
    const text = fileInput.files.length
      ? await fileInput.files[0].text()
      : document.getElementById("file-paste").value;
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("Tidak ada baris data untuk diimpor.");
    const hasHeader = /nama/i.test(rows[0][0] || "");
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const incoming = [];
    const errors = [];
    dataRows.forEach((row, index) => {
      const [nama = "", kelompok = "", third = "", fourth = ""] = row;
      const oldFormat = ["jamaah", "pengurus"].includes(third.trim().toLowerCase());
      const role = oldFormat ? third.trim().toLowerCase()
        : (fourth || "Jamaah").trim().toLowerCase();
      const member = {
        nama: nama.trim(),
        kelompok: kelompok.trim(),
        jenisKelamin: oldFormat ? "Tidak diatur" : normalizeGender(third),
        peran: role === "pengurus" ? "Pengurus" : "Jamaah",
        id: createMemberId()
      };
      if (!member.nama || !GROUPS.includes(member.kelompok)
          || !["Pria", "Wanita", "Tidak diatur"].includes(member.jenisKelamin)
          || !["Jamaah", "Pengurus"].includes(member.peran)) {
        errors.push(`Baris ${index + (hasHeader ? 2 : 1)}: nama, kelompok, jenis kelamin, atau peran tidak valid.`);
      } else if (isDuplicateMember(member, [...jamaahData, ...incoming])) {
        errors.push(`Baris ${index + (hasHeader ? 2 : 1)}: ${member.nama} sudah terdaftar.`);
      } else {
        incoming.push(member);
      }
    });
    if (errors.length) throw new Error(errors.join("\n"));
    if (!incoming.length) throw new Error("Tidak ada data jamaah baru yang dapat diimpor.");
    jamaahData.push(...incoming);
    saveMembers();
    document.getElementById("file-paste").value = "";
    fileInput.value = "";
    message.textContent = `${incoming.length} data jamaah berhasil diimpor.`;
    message.className = "form-message success-message";
    renderJamaah();
    renderDashboard();
  } catch (error) {
    message.textContent = error.message;
    message.className = "form-message error-message";
  }
}

function addBatchPresensi() {
  const message = document.getElementById("attendance-import-message");
  const group = document.getElementById("batch-group").value;
  const gender = document.getElementById("batch-gender").value;
  try {
    if (!GROUPS.includes(group) || !["Pria", "Wanita"].includes(gender)) {
      throw new Error("Pilih kelompok dan jenis kelamin untuk presensi massal.");
    }
    const { incoming, errors } = resolveBatchPresensi(group, gender);
    if (errors.length) throw new Error(errors.join("\n"));
    if (!incoming.length) throw new Error("Tidak ada presensi baru untuk disimpan.");
    presensiData.push(...incoming);
    saveAttendance();
    document.getElementById("attendance-batch").value = "";
    document.getElementById("attendance-batch-file").value = "";
    attendanceBatchFileData = null;
    document.getElementById("batch-match-preview").textContent = "";
    document.getElementById("batch-file-message").textContent = "";
    message.textContent = `${incoming.length} presensi berhasil disimpan: ${incoming.map((record) => record.nama).join(", ")}.`;
    message.className = "form-message success-message";
    renderRiwayat();
    renderDashboard();
  } catch (error) {
    message.textContent = error.message;
    message.className = "form-message error-message";
  }
}

function exportRiwayat() {
  const group = document.getElementById("r-kelompok").value;
  const records = presensiData.filter((record) => !group || record.kelompok === group);
  if (!records.length) {
    alert("Tidak ada riwayat yang dapat diekspor.");
    return;
  }
  const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [["Tanggal", "Nama", "Kelompok", "Status", "Metode"], ...records.map((record) => [
    record.tanggal, record.nama, record.kelompok, record.status, record.metode
  ])].map((row) => row.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `riwayat-presensi${group ? `-${group.replace(/\s+/g, "-").toLowerCase()}` : ""}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function askAssistant() {
  const question = document.getElementById("assistant-question").value.trim().toLowerCase();
  const group = GROUPS.find((item) => question.includes(item.toLowerCase()));
  const month = currentMonth();
  const records = presensiData.filter((record) => record.tanggal.startsWith(month)
    && (!group || record.kelompok === group));
  const hadir = records.filter((record) => record.status === "Hadir").length;
  const izin = records.filter((record) => record.status === "Izin").length;
  const sakit = records.filter((record) => record.status === "Sakit").length;
  const alpa = records.filter((record) => record.status === "Alpa").length;
  const heading = group ? ` untuk ${group}` : "";
  const answer = records.length
    ? `Ringkasan bulan ${month}${heading}: ${records.length} catatan, ${hadir} hadir, ${izin} izin, ${sakit} sakit, dan ${alpa} alpa. Tingkat hadir ${Math.round((hadir / records.length) * 100)}%.`
    : `Belum ada catatan presensi bulan ${month}${heading} di browser ini.`;
  document.getElementById("assistant-answer").textContent = answer;
}

function changeAccountPassword() {
  const message = document.getElementById("password-message");
  if (window.currentRole !== "admin") {
    message.textContent = "Hanya admin yang dapat mengubah password.";
    message.className = "form-message error-message";
    return;
  }
  const username = document.getElementById("account-username").value;
  const password = document.getElementById("new-password").value;
  const confirmation = document.getElementById("confirm-password").value;
  if (password.length < 4) {
    message.textContent = "Password minimal 4 karakter.";
    message.className = "form-message error-message";
    return;
  }
  if (password !== confirmation) {
    message.textContent = "Konfirmasi password tidak cocok.";
    message.className = "form-message error-message";
    return;
  }
  const accounts = getAccounts();
  if (!accounts[username]) {
    message.textContent = "Akun tidak ditemukan.";
    message.className = "form-message error-message";
    return;
  }
  accounts[username].password = password;
  localStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(accounts));
  document.getElementById("new-password").value = "";
  document.getElementById("confirm-password").value = "";
  message.textContent = `Password akun ${username} berhasil diubah pada browser ini.`;
  message.className = "form-message success-message";
}

document.getElementById("f-bulan").value = currentMonth();
document.getElementById("p-tanggal").value = localDateString();
document.getElementById("batch-date").value = localDateString();
document.getElementById("f-bulan").addEventListener("change", renderDashboard);
document.getElementById("f-tingkat").addEventListener("change", renderDashboard);
renderDashboard();
renderRiwayat();
renderJamaah();
restoreActiveSession();

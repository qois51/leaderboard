// admin.js - Panitia Control Panel with Passphrase Auth, Dual Boards, Timer & Quick Finish

// Safe Socket.io initialization (works both with standalone server & serverless)
let socket = null;
if (typeof io !== 'undefined') {
  try {
    socket = io({ autoConnect: true, reconnectionAttempts: 3, timeout: 3000 });
  } catch (e) {
    console.warn('Socket.IO init notice:', e);
  }
}

// State
let globalData = null;
let activeBoardId = '1';
let searchQuery = '';
let parsedCsvData = [];

// DOM Elements - Auth
const authOverlay = document.getElementById('authOverlay');
const authForm = document.getElementById('authForm');
const inputPassphrase = document.getElementById('inputPassphrase');
const authErrorMsg = document.getElementById('authErrorMsg');

// DOM Elements - Tabs
const adminTab1 = document.getElementById('adminTab1');
const adminTab2 = document.getElementById('adminTab2');
const adminTab1Label = document.getElementById('adminTab1Label');
const adminTab2Label = document.getElementById('adminTab2Label');
const currentBoardHeaderTitle = document.getElementById('currentBoardHeaderTitle');

// DOM Elements - Timer
const adminTimerDigits = document.getElementById('adminTimerDigits');
const adminTimerTitle = document.getElementById('adminTimerTitle');
const adminTimerStatus = document.getElementById('adminTimerStatus');
const timerSetupModal = document.getElementById('timerSetupModal');
const setupTimerTitle = document.getElementById('setupTimerTitle');
const setupTimerMin = document.getElementById('setupTimerMin');
const setupTimerSec = document.getElementById('setupTimerSec');

// DOM Elements - Match Arena
const matchInputTeamA = document.getElementById('matchInputTeamA');
const matchInputTeamB = document.getElementById('matchInputTeamB');
const btnFinishTeamALabel = document.getElementById('btnFinishTeamALabel');
const btnFinishTeamBLabel = document.getElementById('btnFinishTeamBLabel');

// DOM Elements - Manual Form
const addTeamForm = document.getElementById('addTeamForm');
const teamNameInput = document.getElementById('teamName');
const timeMinInput = document.getElementById('timeMin');
const timeSecInput = document.getElementById('timeSec');
const timeMsInput = document.getElementById('timeMs');
const timePreview = document.getElementById('timePreview');

// DOM Elements - Table & Modals
const adminTableBody = document.getElementById('adminTableBody');
const teamCount = document.getElementById('teamCount');
const tableEmptyState = document.getElementById('tableEmptyState');
const editModal = document.getElementById('editModal');
const settingsModal = document.getElementById('settingsModal');
const importModal = document.getElementById('importModal');
const toastContainer = document.getElementById('toastContainer');

// Parse board from URL params (?board=1 or 2)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('board') && ['1', '2'].includes(urlParams.get('board'))) {
  activeBoardId = urlParams.get('board');
}

// ========================
// AUTHENTICATION LOGIC
// ========================
function getPassphrase() {
  return localStorage.getItem('admin_passphrase') || '';
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-passphrase': getPassphrase()
  };
}

// Check saved passphrase on load
async function checkInitialAuth() {
  const saved = getPassphrase();
  if (!saved) {
    authOverlay.classList.remove('hidden');
    inputPassphrase.focus();
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: saved })
    });
    if (res.ok) {
      authOverlay.classList.add('hidden');
    } else {
      localStorage.removeItem('admin_passphrase');
      authOverlay.classList.remove('hidden');
      inputPassphrase.focus();
    }
  } catch (e) {
    authOverlay.classList.remove('hidden');
  }
}
checkInitialAuth();

async function handleLoginSubmit(e) {
  e.preventDefault();
  const pass = inputPassphrase.value.trim();
  if (!pass) return;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: pass })
    });
    if (res.ok) {
      localStorage.setItem('admin_passphrase', pass);
      authOverlay.classList.add('hidden');
      authErrorMsg.classList.add('hidden');
      showToast('Akses panel panitia terbuka!');
    } else {
      authErrorMsg.classList.remove('hidden');
      inputPassphrase.select();
    }
  } catch (err) {
    alert('Terjadi kesalahan jaringan server.');
  }
}

function handleLogout() {
  if (confirm('Kunci kembali panel panitia?')) {
    localStorage.removeItem('admin_passphrase');
    inputPassphrase.value = '';
    authOverlay.classList.remove('hidden');
    authErrorMsg.classList.add('hidden');
    inputPassphrase.focus();
  }
}

// ========================
// TIME HELPERS & PREVIEW
// ========================
function formatMs(totalMs) {
  const safeMs = Math.max(0, Math.floor(totalMs || 0));
  const m = Math.floor(safeMs / 60000);
  const s = Math.floor((safeMs % 60000) / 1000);
  const ms = safeMs % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function updateLiveTimePreview() {
  const m = Math.max(0, parseInt(timeMinInput.value, 10) || 0);
  const s = Math.max(0, Math.min(59, parseInt(timeSecInput.value, 10) || 0));
  const ms = Math.max(0, Math.min(999, parseInt(timeMsInput.value, 10) || 0));
  timePreview.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
[timeMinInput, timeSecInput, timeMsInput].forEach(i => i.addEventListener('input', updateLiveTimePreview));

timeMinInput.addEventListener('keyup', (e) => {
  if (timeMinInput.value.length >= 2 && e.key >= '0' && e.key <= '9') {
    timeSecInput.focus();
    timeSecInput.select();
  }
});
timeSecInput.addEventListener('keyup', (e) => {
  if (timeSecInput.value.length >= 2 && e.key >= '0' && e.key <= '9') {
    timeMsInput.focus();
    timeMsInput.select();
  }
});

// Toast notification
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  const bg = type === 'success' ? 'bg-emerald-600 border-emerald-500' : (type === 'error' ? 'bg-rose-600 border-rose-500' : 'bg-blue-600 border-blue-500');
  toast.className = `p-3 px-4 rounded-xl text-white text-xs font-semibold shadow-2xl border flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto ${bg}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : '⚠️'}</span><span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Cache local match teams so user input is NEVER lost
const localMatchTeams = {
  '1': { teamA: '', teamB: '' },
  '2': { teamA: '', teamB: '' }
};
let lastRenderedBoardId = null;
let saveMatchTimeout = null;

function updateMatchButtonLabels() {
  const nameA = matchInputTeamA.value.trim();
  const nameB = matchInputTeamB.value.trim();
  btnFinishTeamALabel.textContent = nameA ? `(${nameA})` : 'Kelompok 1 (A)';
  btnFinishTeamBLabel.textContent = nameB ? `(${nameB})` : 'Kelompok 2 (B)';
}

// Live typing listeners for match inputs
[matchInputTeamA, matchInputTeamB].forEach(input => {
  input.addEventListener('input', () => {
    updateMatchButtonLabels();
    localMatchTeams[activeBoardId].teamA = matchInputTeamA.value;
    localMatchTeams[activeBoardId].teamB = matchInputTeamB.value;

    // Debounced silent auto-save to server
    clearTimeout(saveMatchTimeout);
    saveMatchTimeout = setTimeout(() => {
      saveMatchSetup(false);
    }, 600);
  });

  input.addEventListener('blur', () => {
    saveMatchSetup(false);
  });
});

// ========================
// DUAL BOARD SWITCHING
// ========================
function switchAdminBoard(boardId) {
  // Save current board's input to local cache before switching
  localMatchTeams[activeBoardId].teamA = matchInputTeamA.value;
  localMatchTeams[activeBoardId].teamB = matchInputTeamB.value;

  activeBoardId = boardId;
  lastRenderedBoardId = null; // force reload inputs for new board

  adminTab1.classList.toggle('active', boardId === '1');
  adminTab2.classList.toggle('active', boardId === '2');

  const newUrl = new URL(window.location);
  newUrl.searchParams.set('board', boardId);
  window.history.replaceState({}, '', newUrl);

  renderAdminView();
}

// Open Display Window
function openDisplayWindow() {
  window.open(`/display?board=${activeBoardId}`, 'LeaderboardDisplay', 'width=1280,height=720,menubar=no,toolbar=no,location=no');
}

// ========================
// RENDER ADMIN VIEW
// ========================
function renderAdminView() {
  if (!globalData || !globalData.boards) return;

  const b1 = globalData.boards["1"];
  const b2 = globalData.boards["2"];

  if (b1) adminTab1Label.textContent = `${b1.name} (Panel 1)`;
  if (b2) adminTab2Label.textContent = `${b2.name} (Panel 2)`;

  const currentBoard = globalData.boards[activeBoardId] || b1;
  currentBoardHeaderTitle.textContent = `Peringkat ${currentBoard.name}`;

  // Render Timer
  if (currentBoard.timer) {
    adminTimerTitle.textContent = currentBoard.timer.title || 'Waktu Pertandingan';
    adminTimerDigits.textContent = formatMs(currentBoard.timer.remainingMs);

    if (currentBoard.timer.remainingMs <= 0) {
      adminTimerStatus.textContent = 'HABIS';
      adminTimerStatus.className = 'px-2 py-0.5 rounded text-[10px] bg-rose-600 text-white font-bold';
    } else if (currentBoard.timer.isRunning) {
      adminTimerStatus.textContent = 'BERJALAN';
      adminTimerStatus.className = 'px-2 py-0.5 rounded text-[10px] bg-emerald-600 text-white font-bold';
    } else {
      adminTimerStatus.textContent = 'DIJEDA / SIAP';
      adminTimerStatus.className = 'px-2 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400 font-bold';
    }
  }

  // Render Match Setup Inputs safely without wiping out user's active typing
  const isBoardSwitch = lastRenderedBoardId !== activeBoardId;
  lastRenderedBoardId = activeBoardId;

  if (currentBoard.activeMatch) {
    if (isBoardSwitch) {
      // Switched board: load from local cache or server
      const cachedA = localMatchTeams[activeBoardId].teamA || currentBoard.activeMatch.teamA || '';
      const cachedB = localMatchTeams[activeBoardId].teamB || currentBoard.activeMatch.teamB || '';
      matchInputTeamA.value = cachedA;
      matchInputTeamB.value = cachedB;
    } else {
      // Same board: only populate if input is currently empty and user is not focused on it
      if (document.activeElement !== matchInputTeamA && !matchInputTeamA.value.trim() && currentBoard.activeMatch.teamA) {
        matchInputTeamA.value = currentBoard.activeMatch.teamA;
      }
      if (document.activeElement !== matchInputTeamB && !matchInputTeamB.value.trim() && currentBoard.activeMatch.teamB) {
        matchInputTeamB.value = currentBoard.activeMatch.teamB;
      }
    }
    updateMatchButtonLabels();
  }

  // Render Table
  renderTableData(currentBoard.teams || []);
}

function renderTableData(teams) {
  const query = searchQuery.trim().toLowerCase();
  const filtered = teams.filter(t => t.name.toLowerCase().includes(query));

  if (teamCount) teamCount.textContent = teams.length;
  const quickTeamCount = document.getElementById('quickTeamCount');
  if (quickTeamCount) quickTeamCount.textContent = teams.length;

  if (filtered.length === 0) {
    adminTableBody.innerHTML = '';
    tableEmptyState.classList.remove('hidden');
    return;
  }

  tableEmptyState.classList.add('hidden');
  adminTableBody.innerHTML = filtered.map(t => {
    let rankBadge = `<span class="inline-flex items-center justify-center w-6 h-6 rounded bg-gray-800 text-gray-300 font-bold">${t.rank}</span>`;
    if (t.rank === 1) rankBadge = `<span class="inline-flex items-center justify-center w-6 h-6 rounded badge-gold font-black">1</span>`;
    else if (t.rank === 2) rankBadge = `<span class="inline-flex items-center justify-center w-6 h-6 rounded badge-silver font-black">2</span>`;
    else if (t.rank === 3) rankBadge = `<span class="inline-flex items-center justify-center w-6 h-6 rounded badge-bronze font-black">3</span>`;

    return `
      <tr class="hover:bg-gray-800/40 transition">
        <td class="py-2.5 px-3 text-center">${rankBadge}</td>
        <td class="py-2.5 px-3 font-semibold text-white">
          <div class="truncate max-w-[150px] sm:max-w-[200px]" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>
        </td>
        <td class="py-2.5 px-3 text-center mono font-bold text-blue-400 text-xs sm:text-sm">
          ${t.formattedTime}
        </td>
        <td class="py-2.5 px-3 text-center mono text-[11px] text-gray-400 hidden sm:table-cell">
          ${t.gap}
        </td>
        <td class="py-2.5 px-3 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openEditModal('${t.id}')" class="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition touch-btn flex items-center justify-center" title="Edit Data">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            </button>
            <button onclick="handleDeleteTeam('${t.id}', '${escapeHtml(t.name)}')" class="p-2 rounded-lg bg-rose-950/50 hover:bg-rose-900 text-rose-400 hover:text-rose-200 transition touch-btn flex items-center justify-center" title="Hapus Data">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function handleSearch(val) {
  searchQuery = val;
  const board = (globalData && globalData.boards) ? globalData.boards[activeBoardId] : null;
  if (board) renderTableData(board.teams || []);
}

// ========================
// TIMER CONTROLS
// ========================
async function controlTimer(action) {
  const teamA = matchInputTeamA.value.trim();
  const teamB = matchInputTeamB.value.trim();
  localMatchTeams[activeBoardId].teamA = teamA;
  localMatchTeams[activeBoardId].teamB = teamB;

  try {
    const res = await fetch('/api/timer/control', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ boardId: activeBoardId, action, teamA, teamB })
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || 'Gagal mengatur timer', 'error');
    }
  } catch (e) {
    showToast('Terjadi kesalahan jaringan', 'error');
  }
}

function toggleTimerSetupModal() {
  const board = (globalData && globalData.boards) ? globalData.boards[activeBoardId] : null;
  if (board && board.timer) {
    setupTimerTitle.value = board.timer.title || 'WAKTU PERTANDINGAN';
    const totalSec = board.timer.durationSeconds || 180;
    setupTimerMin.value = Math.floor(totalSec / 60);
    setupTimerSec.value = totalSec % 60;
  }
  timerSetupModal.classList.toggle('hidden');
}

async function handleSaveTimerSetup(e) {
  e.preventDefault();
  const title = setupTimerTitle.value.trim();
  const min = parseInt(setupTimerMin.value, 10) || 0;
  const sec = parseInt(setupTimerSec.value, 10) || 0;
  const durationSeconds = (min * 60) + sec;
  const teamA = matchInputTeamA.value.trim();
  const teamB = matchInputTeamB.value.trim();

  try {
    const res = await fetch('/api/timer/control', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ boardId: activeBoardId, action: 'setup', title, durationSeconds, teamA, teamB })
    });
    if (res.ok) {
      showToast('Setup timer berhasil disimpan!');
      toggleTimerSetupModal();
    }
  } catch (e) {
    showToast('Gagal menyimpan setup timer', 'error');
  }
}

// ========================
// MATCH ARENA & QUICK FINISH
// ========================
async function saveMatchSetup(notify = true) {
  const teamA = matchInputTeamA.value.trim();
  const teamB = matchInputTeamB.value.trim();
  localMatchTeams[activeBoardId].teamA = teamA;
  localMatchTeams[activeBoardId].teamB = teamB;
  updateMatchButtonLabels();

  try {
    const res = await fetch('/api/match/setup', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ boardId: activeBoardId, teamA, teamB })
    });
    if (res.ok && notify) {
      showToast('Nama kelompok bertanding disimpan!');
    }
  } catch (e) {
    if (notify) showToast('Gagal menyimpan nama kelompok', 'error');
  }
}

async function recordTimeFromTimer(teamType) {
  const teamA = matchInputTeamA.value.trim();
  const teamB = matchInputTeamB.value.trim();
  const teamName = teamType === 'A' ? teamA : teamB;

  if (!teamName) {
    alert(`Harap isi nama Kelompok ${teamType} terlebih dahulu pada kolom input!`);
    if (teamType === 'A') matchInputTeamA.focus();
    else matchInputTeamB.focus();
    return;
  }

  // Ensure local cache preserves the values
  localMatchTeams[activeBoardId].teamA = teamA;
  localMatchTeams[activeBoardId].teamB = teamB;

  try {
    const res = await fetch('/api/match/record-time', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ boardId: activeBoardId, teamType, teamName, teamA, teamB })
    });
    const result = await res.json();
    if (res.ok) {
      showToast(`🏁 ${result.message}`);
      // Retain values in inputs and labels
      matchInputTeamA.value = teamA;
      matchInputTeamB.value = teamB;
      updateMatchButtonLabels();

      const banner = document.getElementById('lastRecordedBanner');
      const bannerText = document.getElementById('lastRecordedText');
      if (banner && bannerText && result.message) {
        banner.classList.remove('hidden');
        bannerText.textContent = result.message;
      }
    } else {
      showToast(result.error || 'Gagal mencatat waktu', 'error');
    }
  } catch (e) {
    showToast('Gagal mencatat waktu dari timer', 'error');
  }
}

// ========================
// MANUAL ADD TEAM
// ========================
async function handleAddTeam(e) {
  e.preventDefault();
  const name = teamNameInput.value.trim();
  if (!name) return;

  const minutes = parseInt(timeMinInput.value, 10) || 0;
  const seconds = parseInt(timeSecInput.value, 10) || 0;
  const milliseconds = parseInt(timeMsInput.value, 10) || 0;

  try {
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ boardId: activeBoardId, name, minutes, seconds, milliseconds })
    });
    const result = await res.json();
    if (res.ok) {
      showToast(`Catatan waktu "${name}" berhasil disimpan!`);
      teamNameInput.value = '';
      timeMinInput.value = '0';
      timeSecInput.value = '0';
      timeMsInput.value = '000';
      updateLiveTimePreview();
      teamNameInput.focus();

      const banner = document.getElementById('lastRecordedBanner');
      const bannerText = document.getElementById('lastRecordedText');
      if (banner && bannerText && result.message) {
        banner.classList.remove('hidden');
        bannerText.textContent = result.message;
      }
    } else {
      showToast(result.error || 'Gagal menyimpan data.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan koneksi server.', 'error');
  }
}

// ========================
// EDIT & DELETE TEAM
// ========================
function openEditModal(id) {
  const board = (globalData && globalData.boards) ? globalData.boards[activeBoardId] : null;
  if (!board) return;
  const team = (board.teams || []).find(t => t.id === id);
  if (!team) return;

  document.getElementById('editTeamId').value = team.id;
  document.getElementById('editTeamName').value = team.name;
  document.getElementById('editTimeMin').value = team.minutes;
  document.getElementById('editTimeSec').value = team.seconds;
  document.getElementById('editTimeMs').value = team.milliseconds;

  editModal.classList.remove('hidden');
}

function closeEditModal() {
  editModal.classList.add('hidden');
}

async function handleSaveEdit(e) {
  e.preventDefault();
  const id = document.getElementById('editTeamId').value;
  const name = document.getElementById('editTeamName').value.trim();
  const minutes = parseInt(document.getElementById('editTimeMin').value, 10) || 0;
  const seconds = parseInt(document.getElementById('editTimeSec').value, 10) || 0;
  const milliseconds = parseInt(document.getElementById('editTimeMs').value, 10) || 0;

  try {
    const res = await fetch(`/api/teams/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ boardId: activeBoardId, name, minutes, seconds, milliseconds })
    });
    if (res.ok) {
      showToast(`Data "${name}" berhasil diperbarui!`);
      closeEditModal();
    }
  } catch (e) {
    showToast('Gagal mengubah data', 'error');
  }
}

async function handleDeleteTeam(id, name) {
  if (!confirm(`Hapus catatan waktu untuk "${name}"?`)) return;
  try {
    const res = await fetch(`/api/teams/${id}?boardId=${activeBoardId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      showToast(`Data "${name}" telah dihapus.`);
    }
  } catch (e) {
    showToast('Gagal menghapus data', 'error');
  }
}

// ========================
// MANAGE TEAMS MODAL (MOBILE FRIENDLY)
// ========================
function toggleTeamsModal() {
  const modal = document.getElementById('manageTeamsModal');
  if (modal) {
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
      const searchInput = document.getElementById('searchTeam');
      if (searchInput) searchInput.focus();
    }
  }
}

function closeTeamsModal() {
  const modal = document.getElementById('manageTeamsModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// ========================
// SETTINGS MODAL
// ========================
function openSettingsModal() {
  document.getElementById('settingEventName').value = (globalData && globalData.settings) ? globalData.settings.eventName : '';
  document.getElementById('settingEventSubtitle').value = (globalData && globalData.settings) ? globalData.settings.subTitle : '';
  const currentBoard = (globalData && globalData.boards) ? globalData.boards[activeBoardId] : null;
  document.getElementById('settingBoardName').value = currentBoard ? currentBoard.name : `Leaderboard ${activeBoardId}`;
  settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const eventName = document.getElementById('settingEventName').value.trim();
  const eventSubtitle = document.getElementById('settingEventSubtitle').value.trim();
  const boardName = document.getElementById('settingBoardName').value.trim();

  try {
    const res = await fetch('/api/boards/settings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ boardId: activeBoardId, eventName, eventSubtitle, name: boardName })
    });
    if (res.ok) {
      showToast('Pengaturan nama berhasil diterapkan!');
      closeSettingsModal();
    }
  } catch (e) {
    showToast('Gagal menyimpan pengaturan', 'error');
  }
}

// ========================
// DEMO & RESET
// ========================
async function populateDemoData() {
  try {
    const res = await fetch('/api/demo-data', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ boardId: activeBoardId })
    });
    if (res.ok) showToast('Data contoh berhasil dimuat!');
  } catch (e) {
    showToast('Gagal memuat data contoh', 'error');
  }
}

async function confirmResetAll() {
  const confirmed = prompt(`PERINGATAN: Ini akan MENGHAPUS SEMUA data di Leaderboard ${activeBoardId}.\n\nKetik "RESET" untuk konfirmasi:`);
  if (confirmed !== 'RESET') return;

  try {
    const res = await fetch('/api/teams/reset', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ boardId: activeBoardId })
    });
    if (res.ok) showToast('Leaderboard berhasil direset!');
  } catch (e) {
    showToast('Gagal mereset data', 'error');
  }
}

// ========================
// CSV EXPORT & IMPORT
// ========================
function handleExportCsv() {
  window.location.href = `/api/export-csv?boardId=${activeBoardId}`;
}

function openImportModal() {
  parsedCsvData = [];
  document.getElementById('csvFileInput').value = '';
  document.getElementById('csvPreviewArea').classList.add('hidden');
  document.getElementById('btnConfirmImport').disabled = true;
  importModal.classList.remove('hidden');
}

function closeImportModal() {
  importModal.classList.add('hidden');
}

function handleCsvFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => parseCsvText(evt.target.result);
  reader.readAsText(file);
}

function parseCsvText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) {
    alert('File CSV tidak memiliki data yang cukup.');
    return;
  }

  const parseLine = (line) => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const header = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const rows = [];

  let nameIdx = header.findIndex(h => h.includes('nama') || h.includes('kelompok') || h.includes('team'));
  let minIdx = header.findIndex(h => h.includes('menit') || h.includes('min'));
  let secIdx = header.findIndex(h => h.includes('detik') || h.includes('sec'));
  let msIdx = header.findIndex(h => h.includes('mili') || h.includes('ms'));
  let timeStrIdx = header.findIndex(h => h.includes('format') || h.includes('waktu'));

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length < 2) continue;

    let name = nameIdx !== -1 ? cols[nameIdx] : (cols[1] && isNaN(cols[1]) ? cols[1] : cols[0]);
    let minutes = 0, seconds = 0, milliseconds = 0;

    if (minIdx !== -1 && secIdx !== -1) {
      minutes = parseInt(cols[minIdx], 10) || 0;
      seconds = parseInt(cols[secIdx], 10) || 0;
      milliseconds = msIdx !== -1 ? (parseInt(cols[msIdx], 10) || 0) : 0;
    } else if (timeStrIdx !== -1 && cols[timeStrIdx]) {
      const parts = cols[timeStrIdx].split(/[:.]/);
      if (parts.length >= 2) {
        minutes = parseInt(parts[0], 10) || 0;
        seconds = parseInt(parts[1], 10) || 0;
        milliseconds = parts[2] ? parseInt(parts[2], 10) || 0 : 0;
      }
    }

    if (name) {
      rows.push({
        name,
        minutes,
        seconds,
        milliseconds,
        formattedTime: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
      });
    }
  }

  if (rows.length === 0) {
    alert('Tidak ada baris data valid.');
    return;
  }

  parsedCsvData = rows;
  document.getElementById('csvRowCount').textContent = rows.length;

  const previewBody = document.getElementById('csvPreviewBody');
  previewBody.innerHTML = rows.slice(0, 10).map(r => `
    <tr>
      <td class="p-2 font-medium text-white">${escapeHtml(r.name)}</td>
      <td class="p-2 text-right mono font-bold text-blue-400">${r.formattedTime}</td>
    </tr>
  `).join('');

  document.getElementById('csvPreviewArea').classList.remove('hidden');
  document.getElementById('btnConfirmImport').disabled = false;
}

async function executeImport() {
  if (parsedCsvData.length === 0) return;
  const mode = document.getElementById('importModeSelect').value;

  try {
    const res = await fetch('/api/import-csv', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ boardId: activeBoardId, teams: parsedCsvData, mode })
    });
    const result = await res.json();
    if (res.ok) {
      showToast(`Berhasil mengimpor ${result.count} data kelompok!`);
      closeImportModal();
    } else {
      showToast(result.error || 'Gagal mengimpor', 'error');
    }
  } catch (e) {
    showToast('Terjadi kesalahan saat memproses CSV', 'error');
  }
}

// Sound toggle for Admin
function toggleSound() {
  if (typeof sounds === 'undefined') return;
  sounds.enabled = !sounds.enabled;
  localStorage.setItem('leaderboard_sound', sounds.enabled ? '1' : '0');

  const iconOn = document.getElementById('soundIconOn');
  const iconOff = document.getElementById('soundIconOff');
  if (iconOn) iconOn.classList.toggle('hidden', !sounds.enabled);
  if (iconOff) iconOff.classList.toggle('hidden', sounds.enabled);

  if (sounds.enabled) {
    sounds.playUpdate();
    showToast('🔊 Suara aktif! Buzzer akan berbunyi saat timer habis.');
  } else {
    showToast('🔇 Suara dinonaktifkan.');
  }
}

// Tombol tes bunyi buzzer langsung
function testBuzzerSound() {
  if (typeof sounds === 'undefined') return;
  sounds.enabled = true;
  localStorage.setItem('leaderboard_sound', '1');
  const iconOn = document.getElementById('soundIconOn');
  const iconOff = document.getElementById('soundIconOff');
  if (iconOn) iconOn.classList.remove('hidden');
  if (iconOff) iconOff.classList.add('hidden');

  sounds.playBuzzer();
  showToast('📢 Tes suara buzzer waktu habis dibunyikan!');
}

// Inisialisasi status ikon suara awal (Default ON)
if (typeof sounds !== 'undefined') {
  const iconOn = document.getElementById('soundIconOn');
  const iconOff = document.getElementById('soundIconOff');
  if (iconOn && iconOff) {
    iconOn.classList.toggle('hidden', !sounds.enabled);
    iconOff.classList.toggle('hidden', sounds.enabled);
  }
}

// Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ========================
// VERCEL BLOB STORAGE UI & SYNC
// ========================
function updateBlobUI(blobInfo) {
  if (!blobInfo) return;
  const badge = document.getElementById('blobStatusBadge');
  const syncTime = document.getElementById('blobSyncTime');
  const urlLink = document.getElementById('blobPublicUrlLink');

  if (badge) {
    if (blobInfo.enabled) {
      badge.textContent = 'TERHUBUNG';
      badge.className = 'px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold';
    } else {
      badge.textContent = 'LOKAL';
      badge.className = 'px-1.5 py-0.5 rounded text-[9px] bg-gray-800 text-gray-400 border border-gray-700 font-bold';
    }
  }

  if (syncTime && blobInfo.lastSync) {
    const d = new Date(blobInfo.lastSync);
    syncTime.textContent = 'Sync: ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  if (urlLink) {
    if (blobInfo.url) {
      urlLink.href = blobInfo.url;
      urlLink.classList.remove('pointer-events-none', 'opacity-50');
    } else {
      urlLink.classList.add('pointer-events-none', 'opacity-50');
    }
  }
}

async function handleManualBlobSync() {
  const btn = document.getElementById('btnSyncBlob');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-50');
  }

  try {
    const res = await fetch('/api/blob/sync', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const result = await res.json();
    if (res.ok) {
      showToast('☁️ Data tersinkron ke Vercel Blob Storage!');
      updateBlobUI({ enabled: true, url: result.url, lastSync: result.lastSync });
    } else {
      showToast(result.error || 'Gagal sinkronisasi cloud', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan koneksi sinkronisasi cloud', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-50');
    }
  }
}

// Initial API Fetch & Periodic Polling (Guarantees sync on Vercel Serverless)
async function fetchAdminData() {
  try {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      globalData = data;
      renderAdminView();
      if (data && data.blob) {
        updateBlobUI(data.blob);
      }
    }
  } catch (e) {
    // Ignore transient network errors
  }
}
fetchAdminData();
setInterval(fetchAdminData, 2000);

// Client-side smooth timer calculation (50ms loop)
setInterval(() => {
  if (!globalData || !globalData.boards) return;
  const board = globalData.boards[activeBoardId];
  if (board && board.timer && board.timer.isRunning && board.timer.targetEndTime) {
    const rem = Math.max(0, board.timer.targetEndTime - Date.now());
    board.timer.remainingMs = rem;
    adminTimerDigits.textContent = formatMs(rem);
    if (rem <= 0) {
      board.timer.isRunning = false;
      board.timer.remainingMs = 0;
      board.timer.startedAt = null;
      board.timer.targetEndTime = null;
      adminTimerStatus.textContent = 'HABIS';
      adminTimerStatus.className = 'px-2 py-0.5 rounded text-[10px] bg-rose-600 text-white font-bold';
      if (typeof sounds !== 'undefined') sounds.playBuzzer();
      showToast('⏰ WAKTU HABIS! (Buzzer Berbunyi)', 'error');
    } else {
      adminTimerStatus.textContent = 'BERJALAN';
      adminTimerStatus.className = 'px-2 py-0.5 rounded text-[10px] bg-emerald-600 text-white font-bold';
    }
  }
}, 50);

// Socket Events (if Socket.io connection is active)
if (socket) {
  socket.on('initial_data', (data) => {
    globalData = data;
    renderAdminView();
    if (data && data.blob) {
      updateBlobUI(data.blob);
    }
  });

  socket.on('leaderboard_updated', (data) => {
    globalData = data;
    renderAdminView();
    if (data && data.blob) {
      updateBlobUI(data.blob);
    }
  });

  socket.on('blob_status_updated', (payload) => {
    updateBlobUI(payload);
  });

  socket.on('timer_tick', (payload) => {
    if (!globalData || !globalData.boards[payload.boardId]) return;
    globalData.boards[payload.boardId].timer.remainingMs = payload.remainingMs;
    globalData.boards[payload.boardId].timer.isRunning = payload.isRunning;

    if (activeBoardId === payload.boardId) {
      adminTimerDigits.textContent = formatMs(payload.remainingMs);
      if (payload.remainingMs <= 0) {
        adminTimerStatus.textContent = 'HABIS';
        adminTimerStatus.className = 'px-2 py-0.5 rounded text-[10px] bg-rose-600 text-white font-bold';
      } else if (payload.isRunning) {
        adminTimerStatus.textContent = 'BERJALAN';
        adminTimerStatus.className = 'px-2 py-0.5 rounded text-[10px] bg-emerald-600 text-white font-bold';
      }
    }
  });

  // Suara timer ketika pertandingan dimulai
  socket.on('timer_started', (payload) => {
    if (typeof sounds !== 'undefined' && (activeBoardId === payload.boardId || payload.boardId === 'all')) {
      sounds.playWhistle();
    }
  });

  // Suara buzzer waktu habis (00:00)
  socket.on('timer_finished', (payload) => {
    if (typeof sounds !== 'undefined' && (activeBoardId === payload.boardId || payload.boardId === 'all')) {
      sounds.playBuzzer();
      showToast('⏰ WAKTU HABIS! (Buzzer Berbunyi)', 'error');
    }
  });
}

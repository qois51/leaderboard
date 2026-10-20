// display.js - Handles real-time display, dual boards, & countdown timer

const socket = io();

// State
let globalData = null;
let activeBoardId = '1'; // '1', '2', or 'split'
let previousLeaderIds = { '1': null, '2': null };
let lastPlayedBeepSecond = null;

// Parse board from URL params if given (e.g. ?board=2)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('board')) {
  const bParam = urlParams.get('board');
  if (['1', '2', 'split'].includes(bParam)) {
    activeBoardId = bParam;
  }
}

// DOM Elements
const eventTitle = document.getElementById('eventTitle');
const eventSubtitle = document.getElementById('eventSubtitle');
const liveClock = document.getElementById('liveClock');
const tabBoard1 = document.getElementById('tabBoard1');
const tabBoard2 = document.getElementById('tabBoard2');
const tabSplit = document.getElementById('tabSplit');
const tabBoard1Title = document.getElementById('tabBoard1Title');
const tabBoard2Title = document.getElementById('tabBoard2Title');

const singleBoardView = document.getElementById('singleBoardView');
const splitBoardView = document.getElementById('splitBoardView');

// Timer Elements
const timerTitle = document.getElementById('timerTitle');
const timerStatusBadge = document.getElementById('timerStatusBadge');
const countdownDigits = document.getElementById('countdownDigits');
const timerProgressBar = document.getElementById('timerProgressBar');
const matchTeamA = document.getElementById('matchTeamA');
const matchTeamB = document.getElementById('matchTeamB');
const matchupBanner = document.getElementById('matchupBanner');

// Leaderboard Elements
const emptyState = document.getElementById('emptyState');
const podiumSection = document.getElementById('podiumSection');
const restRankSection = document.getElementById('restRankSection');
const rankListBody = document.getElementById('rankListBody');
const totalParticipantsBadge = document.getElementById('totalParticipantsBadge');

// Split View Elements
const split1Name = document.getElementById('split1Name');
const split2Name = document.getElementById('split2Name');
const split1TimerDigits = document.getElementById('split1TimerDigits');
const split2TimerDigits = document.getElementById('split2TimerDigits');
const split1Body = document.getElementById('split1Body');
const split2Body = document.getElementById('split2Body');

// Clock updater
function updateClock() {
  const now = new Date();
  const hrs = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');
  liveClock.textContent = `${hrs}:${mins}:${secs}`;
}
setInterval(updateClock, 1000);
updateClock();

// Sound toggle
function toggleSound() {
  sounds.enabled = !sounds.enabled;
  document.getElementById('soundIconOn').classList.toggle('hidden', !sounds.enabled);
  document.getElementById('soundIconOff').classList.toggle('hidden', sounds.enabled);
  localStorage.setItem('leaderboard_sound', sounds.enabled ? '1' : '0');
}
if (localStorage.getItem('leaderboard_sound') === '0') {
  toggleSound();
}

// Fullscreen toggle
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.warn(`Fullscreen error: ${err.message}`);
    });
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    toggleFullscreen();
  }
});

// Format time MM:SS.mmm
function formatMs(totalMs) {
  const safeMs = Math.max(0, Math.floor(totalMs || 0));
  const m = Math.floor(safeMs / 60000);
  const s = Math.floor((safeMs % 60000) / 1000);
  const ms = safeMs % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// Switch Active Board
function switchDisplayBoard(boardId) {
  activeBoardId = boardId;

  // Update tabs
  tabBoard1.classList.toggle('active', boardId === '1');
  tabBoard2.classList.toggle('active', boardId === '2');
  tabSplit.classList.toggle('active', boardId === 'split');

  // Show/Hide views
  if (boardId === 'split') {
    singleBoardView.classList.add('hidden');
    splitBoardView.classList.remove('hidden');
  } else {
    singleBoardView.classList.remove('hidden');
    splitBoardView.classList.add('hidden');
  }

  // Update URL without reload
  const newUrl = new URL(window.location);
  newUrl.searchParams.set('board', boardId);
  window.history.replaceState({}, '', newUrl);

  if (globalData) {
    renderView();
  }
}

// Update Podium Card
function updatePodiumCard(elementId, team, rankNumber) {
  const card = document.getElementById(elementId);
  if (!card) return;

  const nameEl = card.querySelector('.team-name');
  const timeEl = card.querySelector('.team-time');
  const gapEl = card.querySelector('.team-gap');

  if (team) {
    nameEl.textContent = team.name;
    timeEl.textContent = team.formattedTime;
    gapEl.textContent = team.gap || '';
    card.classList.remove('opacity-30');
  } else {
    nameEl.textContent = `Menunggu Peserta...`;
    timeEl.textContent = '--:--.---';
    gapEl.textContent = `Posisi Juara ${rankNumber}`;
    card.classList.add('opacity-30');
  }
}

// Render Timer for Board
function updateTimerDisplay(board) {
  if (!board || !board.timer) return;
  const timer = board.timer;

  timerTitle.textContent = timer.title || 'WAKTU PERTANDINGAN';
  countdownDigits.textContent = formatMs(timer.remainingMs);

  // Status Badge & Classes
  countdownDigits.classList.remove('timer-warning', 'timer-danger');
  timerProgressBar.classList.remove('bg-amber-500', 'bg-rose-500');
  timerProgressBar.classList.add('bg-blue-500');

  const totalDurationMs = (timer.durationSeconds || 180) * 1000;
  const percent = Math.min(100, Math.max(0, (timer.remainingMs / totalDurationMs) * 100));
  timerProgressBar.style.width = `${percent}%`;

  if (timer.remainingMs <= 0) {
    timerStatusBadge.textContent = 'WAKTU HABIS!';
    timerStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-rose-600 text-white uppercase animate-pulse';
    countdownDigits.classList.add('timer-danger');
    timerProgressBar.classList.add('bg-rose-500');
  } else if (timer.isRunning) {
    timerStatusBadge.textContent = 'BERJALAN';
    timerStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-emerald-600 text-white uppercase';

    if (timer.remainingMs <= 10000) {
      countdownDigits.classList.add('timer-danger');
      timerProgressBar.classList.add('bg-rose-500');
      // Audio beep for final 5 seconds
      const secInt = Math.ceil(timer.remainingMs / 1000);
      if (secInt <= 5 && secInt > 0 && lastPlayedBeepSecond !== secInt) {
        lastPlayedBeepSecond = secInt;
        sounds.playCountdownBeep(secInt === 1);
      }
    } else if (timer.remainingMs <= 30000) {
      countdownDigits.classList.add('timer-warning');
      timerProgressBar.classList.add('bg-amber-500');
    }
  } else {
    timerStatusBadge.textContent = 'DIJEDA / SIAP';
    timerStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-gray-800 text-gray-400 border border-gray-700 uppercase';
  }

  // Active Matchup
  const teamA = (board.activeMatch && board.activeMatch.teamA) ? board.activeMatch.teamA : 'Kelompok A';
  const teamB = (board.activeMatch && board.activeMatch.teamB) ? board.activeMatch.teamB : 'Kelompok B';
  matchTeamA.textContent = teamA;
  matchTeamB.textContent = teamB;
}

// Render Single Board View
function renderSingleBoard(board) {
  if (!board) return;

  updateTimerDisplay(board);

  const teams = board.teams || [];

  // Sound triggering logic for new #1 leader
  if (teams.length > 0) {
    const currentLeader = teams[0];
    if (previousLeaderIds[board.id] && previousLeaderIds[board.id] !== currentLeader.id) {
      sounds.playNewRecord();
    } else if (previousLeaderIds[board.id]) {
      sounds.playUpdate();
    }
    previousLeaderIds[board.id] = currentLeader.id;
  } else {
    previousLeaderIds[board.id] = null;
  }

  // Handle empty state
  if (teams.length === 0) {
    emptyState.classList.remove('hidden');
    podiumSection.classList.add('hidden');
    restRankSection.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  podiumSection.classList.remove('hidden');

  // Podium
  updatePodiumCard('podiumRank1', teams[0], 1);
  updatePodiumCard('podiumRank2', teams[1], 2);
  updatePodiumCard('podiumRank3', teams[2], 3);

  // Ranks 4+
  const restTeams = teams.slice(3);
  totalParticipantsBadge.textContent = `${teams.length} Tim`;

  if (restTeams.length > 0) {
    restRankSection.classList.remove('hidden');
    rankListBody.innerHTML = restTeams.map((team) => `
      <div class="grid grid-cols-12 px-5 py-3.5 items-center leaderboard-row text-sm border-b border-gray-800/40">
        <div class="col-span-2 md:col-span-1 text-center">
          <span class="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-800 font-bold text-gray-300">
            ${team.rank}
          </span>
        </div>
        <div class="col-span-6 md:col-span-6 font-semibold text-white text-base truncate pr-2">
          ${escapeHtml(team.name)}
        </div>
        <div class="col-span-4 md:col-span-3 text-right mono font-bold text-blue-400 text-base">
          ${team.formattedTime}
        </div>
        <div class="hidden md:block md:col-span-2 text-right mono text-xs text-gray-400">
          ${team.gap}
        </div>
      </div>
    `).join('');
  } else {
    restRankSection.classList.add('hidden');
    rankListBody.innerHTML = '';
  }
}

// Render Split View (Both Board 1 & 2 side-by-side)
function renderSplitView() {
  const b1 = globalData.boards["1"];
  const b2 = globalData.boards["2"];

  split1Name.textContent = b1.name;
  split2Name.textContent = b2.name;

  split1TimerDigits.textContent = formatMs(b1.timer ? b1.timer.remainingMs : 0);
  split2TimerDigits.textContent = formatMs(b2.timer ? b2.timer.remainingMs : 0);

  const renderMiniTable = (teams) => {
    if (!teams || teams.length === 0) {
      return `<p class="text-xs text-gray-500 py-4 text-center italic">Belum ada catatan waktu</p>`;
    }
    return teams.slice(0, 8).map(t => {
      let badge = `<span class="w-6 h-6 rounded-md bg-gray-800 text-gray-300 font-bold flex items-center justify-center text-xs">${t.rank}</span>`;
      if (t.rank === 1) badge = `<span class="w-6 h-6 rounded-md badge-gold text-black font-black flex items-center justify-center text-xs">🥇</span>`;
      else if (t.rank === 2) badge = `<span class="w-6 h-6 rounded-md badge-silver text-black font-black flex items-center justify-center text-xs">🥈</span>`;
      else if (t.rank === 3) badge = `<span class="w-6 h-6 rounded-md badge-bronze text-white font-black flex items-center justify-center text-xs">🥉</span>`;

      return `
        <div class="flex items-center justify-between p-2 rounded-lg bg-gray-900/60 border border-gray-800/80 text-xs">
          <div class="flex items-center gap-2 truncate">
            ${badge}
            <span class="font-bold text-white truncate max-w-[150px]">${escapeHtml(t.name)}</span>
          </div>
          <div class="text-right">
            <span class="mono font-bold text-blue-400">${t.formattedTime}</span>
          </div>
        </div>
      `;
    }).join('');
  };

  split1Body.innerHTML = renderMiniTable(b1.teams);
  split2Body.innerHTML = renderMiniTable(b2.teams);
}

// Master Render
function renderView() {
  if (!globalData) return;

  // Global settings
  if (globalData.settings) {
    if (globalData.settings.eventName) eventTitle.textContent = globalData.settings.eventName;
    if (globalData.settings.subTitle) eventSubtitle.textContent = globalData.settings.subTitle;
  }

  // Tab Titles
  if (globalData.boards["1"]) tabBoard1Title.textContent = globalData.boards["1"].name;
  if (globalData.boards["2"]) tabBoard2Title.textContent = globalData.boards["2"].name;

  if (activeBoardId === 'split') {
    renderSplitView();
  } else {
    const board = globalData.boards[activeBoardId] || globalData.boards["1"];
    renderSingleBoard(board);
  }
}

// HTML escape helper
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Socket Events
socket.on('connect', () => {
  console.log('Connected to Leaderboard Server via Socket.IO');
});

socket.on('initial_data', (data) => {
  globalData = data;
  renderView();
});

socket.on('leaderboard_updated', (data) => {
  globalData = data;
  renderView();
});

socket.on('timer_tick', (payload) => {
  if (!globalData || !globalData.boards[payload.boardId]) return;
  globalData.boards[payload.boardId].timer.remainingMs = payload.remainingMs;
  globalData.boards[payload.boardId].timer.isRunning = payload.isRunning;

  if (activeBoardId === payload.boardId) {
    updateTimerDisplay(globalData.boards[payload.boardId]);
  } else if (activeBoardId === 'split') {
    renderSplitView();
  }
});

socket.on('timer_started', (payload) => {
  sounds.playWhistle();
});

socket.on('timer_finished', (payload) => {
  sounds.playBuzzer();
});

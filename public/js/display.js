// display.js - Handles real-time display, dual boards, & countdown timer

// Supabase Realtime Client for Direct WebSocket PubSub
const SUPABASE_URL = "https://ipfbayuzfblfyvyoabcf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_V4xnTcGwbgW_y55WfoVGMA_G_3uRVLk";
let supabaseClient = null;
if (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn('Supabase Realtime notice:', e);
  }
}

// Safe Socket.io initialization (works both with standalone server & fallback)
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
let activeBoardId = '1'; // '1', '2', or 'split'
let previousLeaderIds = { '1': null, '2': null };
let lastPlayedBeepSecond = null;
let serverClockOffset = 0;
const lastTimerMutationAt = { '1': 0, '2': 0 };

function getSyncedNow() {
  return Date.now() + serverClockOffset;
}

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
const currentBoardDisplayName = document.getElementById('currentBoardDisplayName');
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

// Sound toggle - Default UNMUTED (Suara selalu aktif)
function toggleSound() {
  sounds.enabled = !sounds.enabled;
  const iconOn = document.getElementById('soundIconOn');
  const iconOff = document.getElementById('soundIconOff');
  if (iconOn) iconOn.classList.toggle('hidden', !sounds.enabled);
  if (iconOff) iconOff.classList.toggle('hidden', sounds.enabled);
  localStorage.setItem('leaderboard_sound', sounds.enabled ? '1' : '0');
  if (sounds.enabled) {
    sounds.playUpdate();
  }
}

// Sinkronkan ikon suara saat inisialisasi awal (Default ON)
if (document.getElementById('soundIconOn') && document.getElementById('soundIconOff')) {
  document.getElementById('soundIconOn').classList.toggle('hidden', !sounds.enabled);
  document.getElementById('soundIconOff').classList.toggle('hidden', sounds.enabled);
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

// Render Timer for Board
function updateTimerDisplay(board) {
  if (!board || !board.timer) return;
  const timer = board.timer;

  const totalDurationMs = (timer.durationSeconds || 180) * 1000;
  let liveRemaining = timer.remainingMs;
  if (timer.isRunning && timer.targetEndTime) {
    liveRemaining = Math.max(0, timer.targetEndTime - getSyncedNow());
    timer.remainingMs = liveRemaining;
    if (liveRemaining <= 0) {
      timer.isRunning = false;
      timer.startedAt = null;
      timer.targetEndTime = null;
    }
  }

  timerTitle.textContent = timer.title || 'WAKTU PERTANDINGAN';
  countdownDigits.textContent = formatMs(liveRemaining);

  // Status Badge & Classes
  countdownDigits.classList.remove('timer-warning', 'timer-danger');
  timerProgressBar.classList.remove('bg-amber-500', 'bg-rose-500');
  timerProgressBar.classList.add('bg-blue-500');

  const percent = Math.min(100, Math.max(0, (liveRemaining / totalDurationMs) * 100));
  timerProgressBar.style.width = `${percent}%`;

  if (liveRemaining <= 0) {
    timerStatusBadge.textContent = 'WAKTU HABIS!';
    timerStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-rose-600 text-white uppercase animate-pulse';
    countdownDigits.classList.add('timer-danger');
    timerProgressBar.classList.add('bg-rose-500');
  } else if (timer.isRunning) {
    timerStatusBadge.textContent = 'BERJALAN';
    timerStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-emerald-600 text-white uppercase';

    if (liveRemaining <= 10000) {
      countdownDigits.classList.add('timer-danger');
      timerProgressBar.classList.add('bg-rose-500');
      // Audio beep for final 5 seconds
      const secInt = Math.ceil(liveRemaining / 1000);
      if (secInt <= 5 && secInt > 0 && lastPlayedBeepSecond !== secInt) {
        lastPlayedBeepSecond = secInt;
        sounds.playCountdownBeep(secInt === 1);
      }
    } else if (liveRemaining <= 30000) {
      countdownDigits.classList.add('timer-warning');
      timerProgressBar.classList.add('bg-amber-500');
    }
  } else if (liveRemaining < totalDurationMs) {
    timerStatusBadge.textContent = 'DIJEDA';
    timerStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-amber-500 text-gray-950 uppercase font-black';
  } else {
    timerStatusBadge.textContent = 'SIAP';
    timerStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-blue-600 text-white uppercase font-bold';
  }

  // Active Matchup
  const teamA = (board.activeMatch && board.activeMatch.teamA) ? board.activeMatch.teamA : 'Kelompok A';
  const teamB = (board.activeMatch && board.activeMatch.teamB) ? board.activeMatch.teamB : 'Kelompok B';
  matchTeamA.textContent = teamA;
  matchTeamB.textContent = teamB;
}

// Render Single Board View (Unified Table for ALL Ranks, 80% Left Grid)
function renderSingleBoard(board) {
  if (!board) return;

  updateTimerDisplay(board);

  // Update board title and badge
  if (currentBoardDisplayName) {
    currentBoardDisplayName.innerHTML = `<span>🏆 Peringkat ${escapeHtml(board.name || 'Leaderboard')}</span>`;
  }

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
    if (emptyState) emptyState.classList.remove('hidden');
    if (restRankSection) restRankSection.classList.add('hidden');
    if (totalParticipantsBadge) totalParticipantsBadge.textContent = '0 Tim Terdaftar';
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  if (restRankSection) restRankSection.classList.remove('hidden');
  if (totalParticipantsBadge) totalParticipantsBadge.textContent = `${teams.length} Tim Terdaftar`;

  // Render unified table for all ranks (1 to N)
  rankListBody.innerHTML = teams.map((team) => {
    let rowBg = 'border-l-4 border-l-transparent hover:bg-gray-800/40';
    let rankBadge = `<span class="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-800/90 font-bold text-gray-300 text-sm">${team.rank}</span>`;
    let nameClass = 'font-semibold text-gray-200 text-sm sm:text-base';
    let timeClass = 'mono font-bold text-blue-400 text-sm sm:text-base';
    let gapClass = 'mono text-xs text-gray-400';
    let leaderTag = '';

    if (team.rank === 1) {
      rowBg = 'bg-gradient-to-r from-amber-500/20 via-amber-500/5 to-transparent border-l-4 border-l-amber-400 hover:bg-amber-500/25';
      rankBadge = `<span class="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-amber-400 text-gray-950 font-black text-xs sm:text-sm shadow-md shadow-amber-500/20">🥇 1</span>`;
      nameClass = 'font-black text-amber-200 text-base sm:text-lg';
      timeClass = 'mono font-black text-amber-300 text-base sm:text-lg';
      gapClass = 'mono text-xs font-bold text-amber-400';
      leaderTag = `<span class="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-black bg-amber-400/20 text-amber-300 border border-amber-400/40 uppercase tracking-wider">Juara 1</span>`;
    } else if (team.rank === 2) {
      rowBg = 'bg-gradient-to-r from-slate-300/15 via-slate-300/5 to-transparent border-l-4 border-l-slate-300 hover:bg-slate-300/20';
      rankBadge = `<span class="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-slate-200 text-gray-950 font-black text-xs sm:text-sm shadow-md">🥈 2</span>`;
      nameClass = 'font-bold text-slate-100 text-sm sm:text-base';
      timeClass = 'mono font-bold text-slate-200 text-sm sm:text-base';
      gapClass = 'mono text-xs font-semibold text-slate-300';
    } else if (team.rank === 3) {
      rowBg = 'bg-gradient-to-r from-amber-700/20 via-amber-700/5 to-transparent border-l-4 border-l-amber-600 hover:bg-amber-700/25';
      rankBadge = `<span class="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg bg-amber-700 text-amber-100 font-black text-xs sm:text-sm shadow-md">🥉 3</span>`;
      nameClass = 'font-bold text-amber-100 text-sm sm:text-base';
      timeClass = 'mono font-bold text-amber-200 text-sm sm:text-base';
      gapClass = 'mono text-xs font-semibold text-amber-300/80';
    }

    return `
      <div class="grid grid-cols-12 px-6 py-3.5 items-center leaderboard-row border-b border-gray-800/40 transition-colors ${rowBg}">
        <div class="col-span-2 sm:col-span-1 text-center">
          ${rankBadge}
        </div>
        <div class="col-span-5 sm:col-span-6 truncate pr-3 flex items-center gap-2 ${nameClass}">
          <span class="truncate">${escapeHtml(team.name)}</span>
          ${leaderTag}
        </div>
        <div class="col-span-3 sm:col-span-3 text-center sm:text-right ${timeClass}">
          ${team.formattedTime}
        </div>
        <div class="col-span-2 sm:col-span-2 text-right ${gapClass}">
          ${team.gap || '-'}
        </div>
      </div>
    `;
  }).join('');
}

// Render Split View (Both Board 1 & 2 side-by-side)
function renderSplitView() {
  const b1 = globalData.boards["1"];
  const b2 = globalData.boards["2"];

  split1Name.textContent = b1.name;
  split2Name.textContent = b2.name;

  let b1Rem = b1.timer ? b1.timer.remainingMs : 0;
  if (b1.timer && b1.timer.isRunning && b1.timer.targetEndTime) {
    b1Rem = Math.max(0, b1.timer.targetEndTime - getSyncedNow());
    b1.timer.remainingMs = b1Rem;
  }
  let b2Rem = b2.timer ? b2.timer.remainingMs : 0;
  if (b2.timer && b2.timer.isRunning && b2.timer.targetEndTime) {
    b2Rem = Math.max(0, b2.timer.targetEndTime - getSyncedNow());
    b2.timer.remainingMs = b2Rem;
  }

  split1TimerDigits.textContent = formatMs(b1Rem);
  split2TimerDigits.textContent = formatMs(b2Rem);

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

// Initial API Fetch & Non-Destructive Fallback Polling
async function fetchDataFromApi(forceTeamsOnly = false) {
  const pollStartedAt = Date.now();
  try {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.serverTime) {
      serverClockOffset = data.serverTime - Date.now();
    }

    if (!globalData || !globalData.boards) {
      globalData = data;
    } else {
      if (data.settings) globalData.settings = data.settings;

      ['1', '2'].forEach(bId => {
        const incB = data.boards && data.boards[bId];
        const locB = globalData.boards[bId];
        if (!incB || !locB) return;

        locB.name = incB.name || locB.name;
        locB.subtitle = incB.subtitle || locB.subtitle;
        locB.teams = incB.teams || [];

        if (!forceTeamsOnly && lastTimerMutationAt[bId] < pollStartedAt - 2500) {
          const incT = incB.timer;
          if (incT) {
            const sameRunning = locB.timer && locB.timer.isRunning && incT.isRunning &&
              Math.abs((locB.timer.targetEndTime || 0) - (incT.targetEndTime || 0)) < 1500;
            if (!sameRunning) {
              locB.timer = {
                ...incT,
                remainingMs: (incT.isRunning && incT.targetEndTime)
                  ? Math.max(0, incT.targetEndTime - getSyncedNow())
                  : incT.remainingMs
              };
            }
          }
          if (incB.activeMatch) {
            locB.activeMatch = incB.activeMatch;
          }
        }
      });
    }

    renderView();
  } catch (err) {
    // Ignore transient network errors
  }
}
fetchDataFromApi();
setInterval(() => fetchDataFromApi(false), 5000);

// Client-side smooth timer calculation (Timestamp-based Single Source of Truth, 33ms loop)
setInterval(() => {
  if (!globalData || !globalData.boards) return;
  const now = getSyncedNow();
  let hasRunning = false;
  ['1', '2'].forEach(bId => {
    const b = globalData.boards[bId];
    if (b && b.timer && b.timer.isRunning && b.timer.targetEndTime) {
      const rem = Math.max(0, b.timer.targetEndTime - now);
      b.timer.remainingMs = rem;
      if (rem <= 0) {
        b.timer.isRunning = false;
        b.timer.remainingMs = 0;
        b.timer.startedAt = null;
        b.timer.targetEndTime = null;
        sounds.playBuzzer();
      }
      hasRunning = true;
    }
  });

  if (hasRunning) {
    if (activeBoardId === 'split') {
      renderSplitView();
    } else if (globalData.boards[activeBoardId]) {
      updateTimerDisplay(globalData.boards[activeBoardId]);
    }
  }
}, 33);

// ----------------------------------------------------
// SUPABASE REALTIME SUBSCRIPTION (Unified Broadcast + Postgres Changes)
// ----------------------------------------------------
if (supabaseClient) {
  supabaseClient
    .channel('leaderboard_live_sync', {
      config: { broadcast: { self: false } }
    })
    .on('broadcast', { event: 'timer_sync' }, ({ payload }) => {
      if (!payload || !globalData || !globalData.boards) return;
      const bId = String(payload.boardId);
      const b = globalData.boards[bId];
      if (!b || !payload.timer) return;

      const wasRunning = b.timer.isRunning;
      lastTimerMutationAt[bId] = Date.now();

      if (payload.activeMatch) {
        b.activeMatch = payload.activeMatch;
      }

      const t = payload.timer;
      b.timer.title = t.title || b.timer.title;
      b.timer.durationSeconds = t.durationSeconds || b.timer.durationSeconds;
      b.timer.isRunning = !!t.isRunning;
      b.timer.startedAt = t.startedAt ? Number(t.startedAt) : null;
      b.timer.targetEndTime = t.targetEndTime ? Number(t.targetEndTime) : null;

      if (b.timer.isRunning && b.timer.targetEndTime) {
        b.timer.remainingMs = Math.max(0, b.timer.targetEndTime - getSyncedNow());
      } else {
        b.timer.remainingMs = t.remainingMs !== undefined ? Number(t.remainingMs) : b.timer.remainingMs;
      }

      if (!wasRunning && b.timer.isRunning) {
        sounds.playWhistle();
      }

      if (activeBoardId === bId) {
        updateTimerDisplay(b);
      } else if (activeBoardId === 'split') {
        renderSplitView();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, (payload) => {
      const row = payload.new;
      if (!row || !globalData || !globalData.boards) return;
      const bId = String(row.id);
      const b = globalData.boards[bId];
      if (b) {
        const wasRunning = b.timer.isRunning;
        lastTimerMutationAt[bId] = Date.now();
        b.name = row.name || b.name;
        b.subtitle = row.subtitle || b.subtitle;
        b.activeMatch = {
          teamA: row.active_team_a || '',
          teamB: row.active_team_b || ''
        };
        b.timer.title = row.timer_title || b.timer.title;
        b.timer.durationSeconds = row.timer_duration_seconds !== null ? Number(row.timer_duration_seconds) : b.timer.durationSeconds;
        b.timer.isRunning = !!row.timer_is_running;
        b.timer.startedAt = row.timer_started_at ? Number(row.timer_started_at) : null;
        b.timer.targetEndTime = row.timer_target_end_time ? Number(row.timer_target_end_time) : null;

        if (b.timer.isRunning && b.timer.targetEndTime) {
          b.timer.remainingMs = Math.max(0, b.timer.targetEndTime - getSyncedNow());
        } else {
          b.timer.remainingMs = row.timer_remaining_ms !== null ? Number(row.timer_remaining_ms) : b.timer.remainingMs;
        }

        if (!wasRunning && b.timer.isRunning) {
          sounds.playWhistle();
        }

        if (activeBoardId === bId) {
          updateTimerDisplay(b);
        } else if (activeBoardId === 'split') {
          renderSplitView();
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, async () => {
      await fetchDataFromApi(true);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, (payload) => {
      const row = payload.new;
      if (!row || !globalData) return;
      if (row.event_name) globalData.settings.eventName = row.event_name;
      if (row.sub_title) globalData.settings.subTitle = row.sub_title;
      renderView();
    })
    .subscribe((status) => {
      console.log('⚡ Supabase Realtime (Display):', status);
    });
}

// Socket Events (Fallback for local standalone Node server)
if (socket) {
  socket.on('connect', () => {
    console.log('Connected to Leaderboard Server via Socket.IO');
  });

  socket.on('initial_data', (data) => {
    if (data && data.serverTime) {
      serverClockOffset = data.serverTime - Date.now();
    }
    if (!globalData) {
      globalData = data;
      renderView();
    }
  });

  socket.on('leaderboard_updated', (data) => {
    if (!data) return;
    if (data.serverTime) {
      serverClockOffset = data.serverTime - Date.now();
    }
    if (!globalData) {
      globalData = data;
    } else {
      if (data.settings) globalData.settings = data.settings;
      ['1', '2'].forEach(bId => {
        if (data.boards && data.boards[bId] && globalData.boards[bId]) {
          const incB = data.boards[bId];
          const locB = globalData.boards[bId];
          locB.name = incB.name || locB.name;
          locB.subtitle = incB.subtitle || locB.subtitle;
          locB.teams = incB.teams || [];
          if (incB.activeMatch) locB.activeMatch = incB.activeMatch;
          if (incB.timer) {
            lastTimerMutationAt[bId] = Date.now();
            locB.timer = {
              ...incB.timer,
              remainingMs: (incB.timer.isRunning && incB.timer.targetEndTime)
                ? Math.max(0, incB.timer.targetEndTime - getSyncedNow())
                : incB.timer.remainingMs
            };
          }
        }
      });
    }
    renderView();
  });

  socket.on('timer_started', () => {
    sounds.playWhistle();
  });

  socket.on('timer_finished', () => {
    sounds.playBuzzer();
  });
}

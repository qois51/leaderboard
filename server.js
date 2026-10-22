require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const DEFAULT_PASSPHRASE = 'qoisganteng123';

// Supabase Configuration (Single Source of Truth)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = (process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SECRET_KEY.includes('••'))
  ? process.env.SUPABASE_SECRET_KEY
  : (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    })
  : null;

let lastSupabaseSyncTime = null;
let isInitialLoaded = false;

// Concurrency & Race-Condition Guards
let activeWriteCount = 0;
let lastAnyWriteAt = 0;
const lastBoardTimerWriteAt = { '1': 0, '2': 0 };

// Initial state template for a board
function createDefaultBoard(id, name, subtitle) {
  return {
    id: String(id),
    name: name || `Leaderboard ${id}`,
    subtitle: subtitle || `Kategori / Lintasan ${id}`,
    activeMatch: {
      teamA: '',
      teamB: ''
    },
    timer: {
      title: 'WAKTU PERTANDINGAN',
      durationSeconds: 180, // default 3 minutes
      remainingMs: 180000,
      isRunning: false,
      startedAt: null,
      targetEndTime: null
    },
    teams: []
  };
}

// Initial state template
const DEFAULT_DATA = {
  passphrase: DEFAULT_PASSPHRASE,
  settings: {
    eventName: "LEADERBOARD & TIMER KOMPETISI",
    subTitle: "Waktu Tercepat Menjadi Juara 1"
  },
  boards: {
    "1": createDefaultBoard("1", "Leaderboard 1", "Kategori / Lintasan 1"),
    "2": createDefaultBoard("2", "Leaderboard 2", "Kategori / Lintasan 2")
  }
};

// State in memory
let state = {
  passphrase: DEFAULT_DATA.passphrase,
  settings: { ...DEFAULT_DATA.settings },
  boards: {
    "1": { ...DEFAULT_DATA.boards["1"] },
    "2": { ...DEFAULT_DATA.boards["2"] }
  }
};

// ----------------------------------------------------
// SUPABASE ATOMIC STORAGE HANDLERS
// ----------------------------------------------------

let lastSupabaseFetchTime = 0;
async function loadDataFromSupabase(force = false) {
  if (!supabase) return false;

  // Never let a background read overwrite an active or just-completed write
  if (!force && (activeWriteCount > 0 || Date.now() - lastAnyWriteAt < 1200)) {
    return true;
  }

  const fetchStartTime = Date.now();
  if (!force && isInitialLoaded && fetchStartTime - lastSupabaseFetchTime < 600) {
    return true;
  }
  lastSupabaseFetchTime = fetchStartTime;

  try {
    const [settingsRes, boardsRes, teamsRes] = await Promise.all([
      supabase.from('settings').select('*').eq('id', 'default').maybeSingle(),
      supabase.from('boards').select('*'),
      supabase.from('teams').select('*').order('created_at', { ascending: true })
    ]);

    // Abort applying stale read if a write occurred while the SELECT was in flight
    if (!force && (activeWriteCount > 0 || lastAnyWriteAt >= fetchStartTime)) {
      return true;
    }

    if (settingsRes.data) {
      state.passphrase = settingsRes.data.passphrase || DEFAULT_PASSPHRASE;
      state.settings.eventName = settingsRes.data.event_name || state.settings.eventName;
      state.settings.subTitle = settingsRes.data.sub_title || state.settings.subTitle;
    }

    if (boardsRes.data && boardsRes.data.length > 0) {
      const now = Date.now();
      boardsRes.data.forEach(b => {
        const bId = String(b.id);
        if (!state.boards[bId]) {
          state.boards[bId] = createDefaultBoard(bId, b.name, b.subtitle);
        }
        state.boards[bId].id = bId;
        state.boards[bId].name = b.name || state.boards[bId].name;
        state.boards[bId].subtitle = b.subtitle || state.boards[bId].subtitle;

        // Only update timer & activeMatch from DB if no newer timer write happened on this board
        if (force || lastBoardTimerWriteAt[bId] < fetchStartTime - 1500) {
          state.boards[bId].activeMatch = {
            teamA: b.active_team_a || '',
            teamB: b.active_team_b || ''
          };

          let isRunning = !!b.timer_is_running;
          let startedAt = b.timer_started_at ? Number(b.timer_started_at) : null;
          let targetEndTime = b.timer_target_end_time ? Number(b.timer_target_end_time) : null;
          const durationSeconds = b.timer_duration_seconds !== null ? Number(b.timer_duration_seconds) : 180;

          let remainingMs = b.timer_remaining_ms !== null ? Number(b.timer_remaining_ms) : (durationSeconds * 1000);
          if (isRunning && targetEndTime) {
            remainingMs = Math.max(0, targetEndTime - now);
            if (remainingMs <= 0) {
              isRunning = false;
              remainingMs = 0;
              startedAt = null;
              targetEndTime = null;
            }
          }

          state.boards[bId].timer = {
            title: b.timer_title || 'WAKTU PERTANDINGAN',
            durationSeconds,
            remainingMs,
            isRunning,
            startedAt,
            targetEndTime
          };
        }
      });
    }

    if (teamsRes.data) {
      ['1', '2'].forEach(bId => {
        if (state.boards[bId]) state.boards[bId].teams = [];
      });
      teamsRes.data.forEach(t => {
        const bId = String(t.board_id);
        if (state.boards[bId]) {
          state.boards[bId].teams.push({
            id: String(t.id),
            name: t.name,
            minutes: Number(t.minutes) || 0,
            seconds: Number(t.seconds) || 0,
            milliseconds: Number(t.milliseconds) || 0,
            totalMs: Number(t.total_ms) || 0,
            createdAt: t.created_at,
            updatedAt: t.updated_at
          });
        }
      });
    }

    isInitialLoaded = true;
    lastSupabaseSyncTime = new Date().toISOString();
    return true;
  } catch (err) {
    console.error('⚡ Error loading from Supabase:', err.message);
    return false;
  }
}

async function ensureInitialized() {
  if (!isInitialLoaded && supabase) {
    await loadDataFromSupabase(true);
  }
}

// Targeted update: ONLY timer + activeMatch columns on boards
async function syncBoardTimer(boardId) {
  if (!supabase) return;
  const b = state.boards[String(boardId)];
  if (!b) return;
  activeWriteCount++;
  const now = Date.now();
  lastAnyWriteAt = now;
  lastBoardTimerWriteAt[String(boardId)] = now;
  try {
    const payload = {
      active_team_a: b.activeMatch?.teamA || '',
      active_team_b: b.activeMatch?.teamB || '',
      timer_title: b.timer?.title || 'WAKTU PERTANDINGAN',
      timer_duration_seconds: Math.round(b.timer?.durationSeconds || 180),
      timer_remaining_ms: Math.max(0, Math.round(b.timer?.remainingMs !== undefined ? b.timer.remainingMs : 180000)),
      timer_is_running: !!b.timer?.isRunning,
      timer_started_at: b.timer?.startedAt ? Math.round(b.timer.startedAt) : null,
      timer_target_end_time: b.timer?.targetEndTime ? Math.round(b.timer.targetEndTime) : null,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase
      .from('boards')
      .update(payload)
      .eq('id', String(boardId));

    if (error) {
      console.error('⚡ Supabase syncBoardTimer error:', error.message);
    } else {
      lastSupabaseSyncTime = new Date().toISOString();
    }
  } catch (err) {
    console.error('⚡ Error syncing board timer to Supabase:', err.message);
  } finally {
    const fin = Date.now();
    lastAnyWriteAt = fin;
    lastBoardTimerWriteAt[String(boardId)] = fin;
    activeWriteCount = Math.max(0, activeWriteCount - 1);
  }
}

// Targeted update: ONLY active_team_a and active_team_b (never touches timer_* columns!)
async function syncBoardMatch(boardId) {
  if (!supabase) return;
  const b = state.boards[String(boardId)];
  if (!b) return;
  activeWriteCount++;
  lastAnyWriteAt = Date.now();
  try {
    const { error } = await supabase
      .from('boards')
      .update({
        active_team_a: b.activeMatch?.teamA || '',
        active_team_b: b.activeMatch?.teamB || '',
        updated_at: new Date().toISOString()
      })
      .eq('id', String(boardId));
    if (error) console.error('⚡ Supabase syncBoardMatch error:', error.message);
    else lastSupabaseSyncTime = new Date().toISOString();
  } catch (err) {
    console.error('⚡ Error syncing board match to Supabase:', err.message);
  } finally {
    lastAnyWriteAt = Date.now();
    activeWriteCount = Math.max(0, activeWriteCount - 1);
  }
}

// Targeted update: ONLY board name and subtitle (never touches timer_* columns!)
async function syncBoardInfo(boardId) {
  if (!supabase) return;
  const b = state.boards[String(boardId)];
  if (!b) return;
  activeWriteCount++;
  lastAnyWriteAt = Date.now();
  try {
    const { error } = await supabase
      .from('boards')
      .update({
        name: b.name,
        subtitle: b.subtitle,
        updated_at: new Date().toISOString()
      })
      .eq('id', String(boardId));
    if (error) console.error('⚡ Supabase syncBoardInfo error:', error.message);
    else lastSupabaseSyncTime = new Date().toISOString();
  } catch (err) {
    console.error('⚡ Error syncing board info to Supabase:', err.message);
  } finally {
    lastAnyWriteAt = Date.now();
    activeWriteCount = Math.max(0, activeWriteCount - 1);
  }
}

async function syncTeamUpsert(team, boardId) {
  if (!supabase) return;
  activeWriteCount++;
  lastAnyWriteAt = Date.now();
  try {
    const { error } = await supabase.from('teams').upsert({
      id: String(team.id),
      board_id: String(boardId),
      name: team.name,
      minutes: Math.round(team.minutes || 0),
      seconds: Math.round(team.seconds || 0),
      milliseconds: Math.round(team.milliseconds || 0),
      total_ms: Math.round(team.totalMs || 0),
      created_at: team.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    if (error) console.error('⚡ Supabase syncTeamUpsert error:', error.message);
    else lastSupabaseSyncTime = new Date().toISOString();
  } catch (err) {
    console.error('⚡ Error syncing team upsert to Supabase:', err.message);
  } finally {
    lastAnyWriteAt = Date.now();
    activeWriteCount = Math.max(0, activeWriteCount - 1);
  }
}

async function syncTeamDelete(teamId) {
  if (!supabase) return;
  activeWriteCount++;
  lastAnyWriteAt = Date.now();
  try {
    const { error } = await supabase.from('teams').delete().eq('id', String(teamId));
    if (error) console.error('⚡ Supabase syncTeamDelete error:', error.message);
    else lastSupabaseSyncTime = new Date().toISOString();
  } catch (err) {
    console.error('⚡ Error syncing team delete to Supabase:', err.message);
  } finally {
    lastAnyWriteAt = Date.now();
    activeWriteCount = Math.max(0, activeWriteCount - 1);
  }
}

async function syncTeamsReset(boardId) {
  if (!supabase) return;
  activeWriteCount++;
  lastAnyWriteAt = Date.now();
  try {
    const { error } = await supabase.from('teams').delete().eq('board_id', String(boardId));
    if (error) console.error('⚡ Supabase syncTeamsReset error:', error.message);
    else lastSupabaseSyncTime = new Date().toISOString();
  } catch (err) {
    console.error('⚡ Error syncing teams reset to Supabase:', err.message);
  } finally {
    lastAnyWriteAt = Date.now();
    activeWriteCount = Math.max(0, activeWriteCount - 1);
  }
}

async function syncSettingsUpdate() {
  if (!supabase) return;
  activeWriteCount++;
  lastAnyWriteAt = Date.now();
  try {
    const { error } = await supabase.from('settings').upsert({
      id: 'default',
      event_name: state.settings.eventName,
      sub_title: state.settings.subTitle,
      passphrase: state.passphrase,
      updated_at: new Date().toISOString()
    });
    if (error) console.error('⚡ Supabase syncSettingsUpdate error:', error.message);
    else lastSupabaseSyncTime = new Date().toISOString();
  } catch (err) {
    console.error('⚡ Error syncing settings to Supabase:', err.message);
  } finally {
    lastAnyWriteAt = Date.now();
    activeWriteCount = Math.max(0, activeWriteCount - 1);
  }
}

// Time calculation helper
function calculateTotalMs(minutes, seconds, milliseconds) {
  const m = Math.max(0, parseInt(minutes, 10) || 0);
  const s = Math.max(0, Math.min(59, parseInt(seconds, 10) || 0));
  const ms = Math.max(0, Math.min(999, parseInt(milliseconds, 10) || 0));
  return (m * 60 * 1000) + (s * 1000) + ms;
}

// Formatting helper: returns "01:25.450"
function formatTime(totalMs) {
  const safeMs = Math.max(0, Math.round(totalMs || 0));
  const m = Math.floor(safeMs / 60000);
  const s = Math.floor((safeMs % 60000) / 1000);
  const ms = safeMs % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// Get sorted teams with rank and gap
function getRankedTeams(teams) {
  const sorted = [...(teams || [])].sort((a, b) => {
    if (a.totalMs !== b.totalMs) {
      return a.totalMs - b.totalMs;
    }
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });

  const bestTime = sorted.length > 0 ? sorted[0].totalMs : 0;

  return sorted.map((team, index) => {
    const gapMs = team.totalMs - bestTime;
    return {
      ...team,
      rank: index + 1,
      formattedTime: formatTime(team.totalMs),
      gap: index === 0 ? 'Tercepat' : `+${formatTime(gapMs)}`
    };
  });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Passphrase Auth Middleware for Protected Routes
async function requirePassphrase(req, res, next) {
  await ensureInitialized();
  const clientPass = String(req.headers['x-passphrase'] || req.query.passphrase || req.body?.passphrase || '').trim();
  let authoritativePass = String(state.passphrase || DEFAULT_PASSPHRASE).trim();

  // Jika tidak sama dengan cache in-memory, verifikasi langsung ke database Supabase
  if (clientPass !== authoritativePass && supabase) {
    try {
      const { data } = await supabase.from('settings').select('passphrase').limit(1).maybeSingle();
      if (data && data.passphrase) {
        authoritativePass = String(data.passphrase).trim();
        state.passphrase = authoritativePass;
      }
    } catch (err) {}
  }

  if (!clientPass || clientPass !== authoritativePass) {
    return res.status(401).json({ error: 'Akses ditolak. Passphrase panitia salah atau belum dimasukkan.' });
  }
  next();
}

// Specific routes for views
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/change-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'change-password.html'));
});

// Helper to get full sanitized response
function getFullDataResponse() {
  const now = Date.now();
  const boardsResponse = {};
  for (const bId of ['1', '2']) {
    const b = state.boards[bId];
    if (b) {
      let isRunning = !!b.timer?.isRunning;
      let startedAt = b.timer?.startedAt || null;
      let targetEndTime = b.timer?.targetEndTime || null;
      let liveRemainingMs = b.timer?.remainingMs !== undefined ? b.timer.remainingMs : 180000;

      if (isRunning && targetEndTime) {
        liveRemainingMs = Math.max(0, Number(targetEndTime) - now);
        if (liveRemainingMs <= 0) {
          isRunning = false;
          liveRemainingMs = 0;
          startedAt = null;
          targetEndTime = null;
          b.timer.isRunning = false;
          b.timer.remainingMs = 0;
          b.timer.startedAt = null;
          b.timer.targetEndTime = null;
        }
      }

      boardsResponse[bId] = {
        ...b,
        timer: {
          ...b.timer,
          isRunning,
          startedAt,
          targetEndTime,
          remainingMs: liveRemainingMs,
          updatedAt: lastBoardTimerWriteAt[bId] || now
        },
        teams: getRankedTeams(b.teams)
      };
    }
  }

  return {
    serverTime: now,
    settings: state.settings,
    boards: boardsResponse,
    supabase: {
      enabled: !!supabase,
      url: SUPABASE_URL,
      lastSync: lastSupabaseSyncTime
    }
  };
}

// Timer Expiration Check Loop (Only emits when time expires, no continuous tick spam)
if (!process.env.VERCEL) {
  setInterval(async () => {
    let changed = false;
    for (const bId of ['1', '2']) {
      const board = state.boards[bId];
      if (board && board.timer && board.timer.isRunning && board.timer.targetEndTime) {
        const now = Date.now();
        if (now >= board.timer.targetEndTime) {
          board.timer.isRunning = false;
          board.timer.remainingMs = 0;
          board.timer.startedAt = null;
          board.timer.targetEndTime = null;
          changed = true;
          await syncBoardTimer(bId);
          if (io) io.emit('timer_finished', { boardId: bId });
        }
      }
    }

    if (changed) {
      const fullData = getFullDataResponse();
      if (io) io.emit('leaderboard_updated', fullData);
    }
  }, 500);
}

// ========================
// REST APIS
// ========================

// 1. Auth Endpoint (Direct Supabase Validation - Single Source of Truth)
const handleLogin = async (req, res) => {
  const inputPass = String(req.body?.passphrase || '').trim();
  if (!inputPass) {
    return res.status(400).json({ error: 'Passphrase tidak boleh kosong.' });
  }

  let authoritativePass = String(state.passphrase || DEFAULT_PASSPHRASE).trim();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('passphrase')
        .limit(1)
        .maybeSingle();

      if (!error && data && data.passphrase) {
        authoritativePass = String(data.passphrase).trim();
        state.passphrase = authoritativePass;
      }
    } catch (err) {
      console.error('⚡ Error checking passphrase directly from Supabase:', err.message);
    }
  }

  if (inputPass === authoritativePass) {
    state.passphrase = authoritativePass;
    res.json({ success: true, message: 'Autentikasi berhasil.' });
  } else {
    res.status(401).json({ error: 'Passphrase salah!' });
  }
};

app.post('/api/auth/login', handleLogin);
app.post('/auth/login', handleLogin);

// 1b. Change Password Endpoint
const handleChangePassword = async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '').trim();
  const newPassword = String(req.body?.newPassword || '').trim();

  let activePass = String(state.passphrase || DEFAULT_PASSPHRASE).trim();
  if (supabase) {
    try {
      const { data } = await supabase.from('settings').select('passphrase').limit(1).maybeSingle();
      if (data && data.passphrase) {
        activePass = String(data.passphrase).trim();
        state.passphrase = activePass;
      }
    } catch (e) {}
  }

  if (!currentPassword) {
    return res.status(400).json({ error: 'Password saat ini harus diisi.' });
  }

  if (currentPassword !== activePass) {
    return res.status(401).json({ error: 'Password saat ini salah!' });
  }

  if (!newPassword || newPassword === '') {
    return res.status(400).json({ error: 'Password baru tidak boleh kosong.' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Password baru minimal 4 karakter.' });
  }

  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'Password baru harus berbeda dari password sekarang.' });
  }

  state.passphrase = newPassword;
  await syncSettingsUpdate();

  res.json({ success: true, message: 'Password admin berhasil diperbarui!' });
};

app.post('/api/auth/change-password', handleChangePassword);
app.post('/auth/change-password', handleChangePassword);

// 2. Get current state (public)
app.get('/api/data', async (req, res) => {
  await loadDataFromSupabase();
  res.json(getFullDataResponse());
});

// 3. Add team (Protected)
app.post('/api/teams', requirePassphrase, async (req, res) => {
  const { boardId = '1', name, minutes, seconds, milliseconds } = req.body;
  const board = state.boards[String(boardId)];
  if (!board) {
    return res.status(400).json({ error: 'Leaderboard tidak valid.' });
  }
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Nama kelompok wajib diisi.' });
  }

  const m = parseInt(minutes, 10) || 0;
  const s = parseInt(seconds, 10) || 0;
  const ms = parseInt(milliseconds, 10) || 0;
  const totalMs = calculateTotalMs(m, s, ms);

  const newTeam = {
    id: 'team_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    name: name.trim(),
    minutes: m,
    seconds: s,
    milliseconds: ms,
    totalMs: totalMs,
    createdAt: new Date().toISOString()
  };

  board.teams.push(newTeam);
  await syncTeamUpsert(newTeam, boardId);

  const fullData = getFullDataResponse();
  if (io) io.emit('leaderboard_updated', fullData);

  res.status(201).json({ success: true, team: newTeam, boardId, fullData });
});

// 4. Edit team (Protected)
app.put('/api/teams/:id', requirePassphrase, async (req, res) => {
  const { id } = req.params;
  const { boardId = '1', name, minutes, seconds, milliseconds } = req.body;
  const board = state.boards[String(boardId)];
  if (!board) {
    return res.status(400).json({ error: 'Leaderboard tidak valid.' });
  }

  const teamIndex = board.teams.findIndex(t => t.id === id);
  if (teamIndex === -1) {
    return res.status(404).json({ error: 'Kelompok tidak ditemukan.' });
  }

  if (name && name.trim()) {
    board.teams[teamIndex].name = name.trim();
  }

  const m = minutes !== undefined ? parseInt(minutes, 10) : board.teams[teamIndex].minutes;
  const s = seconds !== undefined ? parseInt(seconds, 10) : board.teams[teamIndex].seconds;
  const ms = milliseconds !== undefined ? parseInt(milliseconds, 10) : board.teams[teamIndex].milliseconds;

  board.teams[teamIndex].minutes = m;
  board.teams[teamIndex].seconds = s;
  board.teams[teamIndex].milliseconds = ms;
  board.teams[teamIndex].totalMs = calculateTotalMs(m, s, ms);
  board.teams[teamIndex].updatedAt = new Date().toISOString();

  await syncTeamUpsert(board.teams[teamIndex], boardId);

  const fullData = getFullDataResponse();
  if (io) io.emit('leaderboard_updated', fullData);

  res.json({ success: true, team: board.teams[teamIndex], fullData });
});

// 5. Delete team (Protected)
app.delete('/api/teams/:id', requirePassphrase, async (req, res) => {
  const { id } = req.params;
  const { boardId = '1' } = req.query;
  const board = state.boards[String(boardId)];
  if (!board) {
    return res.status(400).json({ error: 'Leaderboard tidak valid.' });
  }

  board.teams = board.teams.filter(t => t.id !== id);
  await syncTeamDelete(id);

  const fullData = getFullDataResponse();
  if (io) io.emit('leaderboard_updated', fullData);

  res.json({ success: true, fullData });
});

// 6. Reset all teams in a board (Protected)
app.post('/api/teams/reset', requirePassphrase, async (req, res) => {
  const { boardId = '1' } = req.body;
  const board = state.boards[String(boardId)];
  if (!board) {
    return res.status(400).json({ error: 'Leaderboard tidak valid.' });
  }

  board.teams = [];
  await syncTeamsReset(boardId);

  const fullData = getFullDataResponse();
  if (io) io.emit('leaderboard_updated', fullData);

  res.json({ success: true, message: `Data ${board.name} berhasil direset.` });
});

// 7. Timer Controls (Protected - Atomic & Deterministic)
app.post('/api/timer/control', requirePassphrase, async (req, res) => {
  const { boardId = '1', action, durationSeconds, title, teamA, teamB, clientRemainingMs } = req.body;
  const bId = String(boardId);
  const board = state.boards[bId];
  if (!board) return res.status(400).json({ error: 'Leaderboard tidak valid.' });

  if (!board.activeMatch) board.activeMatch = { teamA: '', teamB: '' };
  if (teamA !== undefined) board.activeMatch.teamA = teamA.trim();
  if (teamB !== undefined) board.activeMatch.teamB = teamB.trim();

  const timer = board.timer;
  const now = Date.now();
  const totalMs = (timer.durationSeconds || 180) * 1000;

  if (action === 'setup') {
    if (title) timer.title = title.trim();
    if (durationSeconds) {
      const dur = Math.max(1, parseInt(durationSeconds, 10));
      timer.durationSeconds = dur;
      timer.remainingMs = dur * 1000;
      timer.isRunning = false;
      timer.startedAt = null;
      timer.targetEndTime = null;
    }
  } else if (action === 'start') {
    // Check if timer is genuinely still running with time left
    const currentlyRunning = timer.isRunning && timer.targetEndTime && (timer.targetEndTime - now > 200);
    if (!currentlyRunning) {
      let rem = totalMs;
      if (typeof clientRemainingMs === 'number' && clientRemainingMs > 0 && clientRemainingMs <= totalMs) {
        rem = Math.round(clientRemainingMs);
      } else if (!timer.isRunning && timer.remainingMs > 0 && timer.remainingMs <= totalMs) {
        rem = Math.round(timer.remainingMs);
      }
      timer.remainingMs = rem;
      timer.isRunning = true;
      timer.startedAt = now;
      timer.targetEndTime = now + rem;
      if (io) io.emit('timer_started', { boardId: bId });
    }
  } else if (action === 'pause') {
    let rem = timer.remainingMs;
    if (typeof clientRemainingMs === 'number' && clientRemainingMs >= 0 && clientRemainingMs <= totalMs) {
      rem = Math.round(clientRemainingMs);
    } else if (timer.isRunning && timer.targetEndTime) {
      rem = Math.max(0, Math.round(timer.targetEndTime - now));
    }
    timer.remainingMs = Math.max(0, Math.min(totalMs, rem));
    timer.isRunning = false;
    timer.startedAt = null;
    timer.targetEndTime = null;
  } else if (action === 'reset') {
    timer.isRunning = false;
    timer.remainingMs = totalMs;
    timer.startedAt = null;
    timer.targetEndTime = null;
  }

  // Persist to Supabase BEFORE returning so Vercel Serverless & subsequent polls always have the true state
  await syncBoardTimer(bId);

  const fullData = getFullDataResponse();
  if (io) io.emit('leaderboard_updated', fullData);

  res.json({
    success: true,
    serverTime: Date.now(),
    timer: fullData.boards[bId].timer,
    activeMatch: board.activeMatch
  });
});

// 8. Setup Active Battle Teams (Protected)
app.post('/api/match/setup', requirePassphrase, async (req, res) => {
  const { boardId = '1', teamA, teamB } = req.body;
  const bId = String(boardId);
  const board = state.boards[bId];
  if (!board) return res.status(400).json({ error: 'Leaderboard tidak valid.' });

  board.activeMatch = {
    teamA: (teamA || '').trim(),
    teamB: (teamB || '').trim()
  };

  await syncBoardMatch(bId);

  const fullData = getFullDataResponse();
  if (io) io.emit('leaderboard_updated', fullData);
  res.json({ success: true, activeMatch: board.activeMatch });
});

// 9. Record Time directly from Timer for Active Team (Protected)
app.post('/api/match/record-time', requirePassphrase, async (req, res) => {
  const { boardId = '1', teamType, teamName, teamA, teamB, clientElapsedMs } = req.body;
  const bId = String(boardId);
  const board = state.boards[bId];
  if (!board) return res.status(400).json({ error: 'Leaderboard tidak valid.' });

  if (!board.activeMatch) board.activeMatch = { teamA: '', teamB: '' };
  if (teamA !== undefined) board.activeMatch.teamA = teamA.trim();
  if (teamB !== undefined) board.activeMatch.teamB = teamB.trim();

  const finalName = (teamName || (teamType === 'A' ? board.activeMatch.teamA : board.activeMatch.teamB) || '').trim();
  if (!finalName) {
    return res.status(400).json({ error: 'Nama kelompok belum diatur.' });
  }

  if (teamType === 'A') board.activeMatch.teamA = finalName;
  if (teamType === 'B') board.activeMatch.teamB = finalName;

  const totalDurationMs = (board.timer.durationSeconds || 180) * 1000;
  let elapsedMs;
  if (typeof clientElapsedMs === 'number' && clientElapsedMs > 0 && clientElapsedMs <= totalDurationMs) {
    elapsedMs = Math.round(clientElapsedMs);
  } else if (board.timer.isRunning && board.timer.targetEndTime) {
    const remaining = Math.max(0, board.timer.targetEndTime - Date.now());
    elapsedMs = totalDurationMs - remaining;
  } else {
    elapsedMs = totalDurationMs - (board.timer.remainingMs !== undefined ? board.timer.remainingMs : totalDurationMs);
  }
  if (elapsedMs <= 0) elapsedMs = 500;

  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  const milliseconds = Math.round(elapsedMs % 1000);

  const existingIndex = board.teams.findIndex(t => t.name.toLowerCase() === finalName.toLowerCase());
  let savedTeam;

  if (existingIndex !== -1) {
    board.teams[existingIndex].minutes = minutes;
    board.teams[existingIndex].seconds = seconds;
    board.teams[existingIndex].milliseconds = milliseconds;
    board.teams[existingIndex].totalMs = elapsedMs;
    board.teams[existingIndex].updatedAt = new Date().toISOString();
    savedTeam = board.teams[existingIndex];
  } else {
    savedTeam = {
      id: 'team_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: finalName,
      minutes,
      seconds,
      milliseconds,
      totalMs: elapsedMs,
      createdAt: new Date().toISOString()
    };
    board.teams.push(savedTeam);
  }

  await Promise.all([
    syncTeamUpsert(savedTeam, bId),
    syncBoardMatch(bId)
  ]);

  const fullData = getFullDataResponse();
  if (io) io.emit('leaderboard_updated', fullData);

  res.json({
    success: true,
    message: `Catatan waktu "${finalName}" berhasil dicatat (${formatTime(elapsedMs)})!`,
    team: savedTeam,
    elapsedMs,
    formattedTime: formatTime(elapsedMs)
  });
});

// 10. Update board settings / titles (Protected)
app.post('/api/boards/settings', requirePassphrase, async (req, res) => {
  const { boardId = '1', name, subtitle, eventName, eventSubtitle } = req.body;
  const bId = String(boardId);
  if (eventName) state.settings.eventName = eventName.trim();
  if (eventSubtitle !== undefined) state.settings.subTitle = eventSubtitle.trim();

  const board = state.boards[bId];
  if (board) {
    if (name) board.name = name.trim();
    if (subtitle !== undefined) board.subtitle = subtitle.trim();
  }

  await Promise.all([
    syncSettingsUpdate(),
    syncBoardInfo(bId)
  ]);

  const fullData = getFullDataResponse();
  if (io) io.emit('leaderboard_updated', fullData);
  res.json({ success: true, fullData });
});

// 11. Demo data populate (Protected)
app.post('/api/demo-data', requirePassphrase, async (req, res) => {
  const { boardId = '1' } = req.body;
  const bId = String(boardId);
  const board = state.boards[bId];
  if (!board) return res.status(400).json({ error: 'Leaderboard tidak valid.' });

  const sampleTeams = bId === '1' ? [
    { name: "Tim Harimau (Jalur A)", minutes: 1, seconds: 12, milliseconds: 450 },
    { name: "Tim Rajawali (Jalur B)", minutes: 1, seconds: 18, milliseconds: 920 },
    { name: "Tim Komodo (Jalur A)", minutes: 1, seconds: 25, milliseconds: 100 },
    { name: "Tim Badak Perkasa", minutes: 1, seconds: 34, milliseconds: 80 },
    { name: "Tim Kancil Cepat", minutes: 1, seconds: 42, milliseconds: 650 }
  ] : [
    { name: "Tim Singa Perkasa", minutes: 0, seconds: 58, milliseconds: 200 },
    { name: "Tim Macan Tutul", minutes: 1, seconds: 5, milliseconds: 750 },
    { name: "Tim Garuda Emas", minutes: 1, seconds: 15, milliseconds: 300 },
    { name: "Tim Banteng Merah", minutes: 1, seconds: 22, milliseconds: 110 }
  ];

  board.teams = sampleTeams.map((st, i) => ({
    id: 'demo_' + Date.now() + '_' + i,
    name: st.name,
    minutes: st.minutes,
    seconds: st.seconds,
    milliseconds: st.milliseconds,
    totalMs: calculateTotalMs(st.minutes, st.seconds, st.milliseconds),
    createdAt: new Date(Date.now() + i * 1000).toISOString()
  }));

  await syncTeamsReset(bId);
  await Promise.all(board.teams.map(t => syncTeamUpsert(t, bId)));

  const fullData = getFullDataResponse();
  if (io) io.emit('leaderboard_updated', fullData);

  res.json({ success: true, fullData });
});

// 12. Export CSV (Public or panitia)
app.get('/api/export-csv', async (req, res) => {
  await ensureInitialized();
  const { boardId = '1' } = req.query;
  const board = state.boards[String(boardId)];
  if (!board) return res.status(400).send('Leaderboard tidak ditemukan');

  const ranked = getRankedTeams(board.teams);
  
  let csvContent = '\uFEFF';
  csvContent += `Peringkat,Nama Kelompok,Menit,Detik,Milidetik,Format Waktu,Total Milidetik,Selisih Dari Juara 1\n`;

  ranked.forEach(t => {
    const escapedName = `"${t.name.replace(/"/g, '""')}"`;
    csvContent += `${t.rank},${escapedName},${t.minutes},${t.seconds},${t.milliseconds},"${t.formattedTime}",${t.totalMs},"${t.gap}"\n`;
  });

  const safeBoardName = board.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const filename = `${safeBoardName}_export_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvContent);
});

// 13. Import CSV (Protected)
app.post('/api/import-csv', requirePassphrase, async (req, res) => {
  const { boardId = '1', teams, mode } = req.body;
  const bId = String(boardId);
  const board = state.boards[bId];
  if (!board) return res.status(400).json({ error: 'Leaderboard tidak valid.' });

  if (!Array.isArray(teams) || teams.length === 0) {
    return res.status(400).json({ error: 'Tidak ada data tim yang valid untuk diimpor.' });
  }

  const validTeams = teams.map((item, index) => {
    const m = parseInt(item.minutes, 10) || 0;
    const s = parseInt(item.seconds, 10) || 0;
    const ms = parseInt(item.milliseconds, 10) || 0;
    return {
      id: 'import_' + Date.now() + '_' + index + '_' + Math.random().toString(36).substr(2, 4),
      name: (item.name || `Kelompok ${index + 1}`).trim(),
      minutes: m,
      seconds: s,
      milliseconds: ms,
      totalMs: calculateTotalMs(m, s, ms),
      createdAt: item.createdAt || new Date().toISOString()
    };
  });

  if (mode === 'replace') {
    board.teams = validTeams;
    await syncTeamsReset(bId);
  } else {
    board.teams = [...board.teams, ...validTeams];
  }

  await Promise.all(validTeams.map(t => syncTeamUpsert(t, bId)));

  const fullData = getFullDataResponse();
  if (io) io.emit('leaderboard_updated', fullData);

  res.json({ success: true, count: validTeams.length, fullData });
});

// 14. Supabase Storage Status
app.get('/api/supabase/status', (req, res) => {
  res.json({
    enabled: !!supabase,
    url: SUPABASE_URL,
    lastSync: lastSupabaseSyncTime
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  socket.emit('initial_data', getFullDataResponse());
});

// Start server (only if run directly, not when imported as a serverless module or on Vercel)
if (require.main === module && !process.env.VERCEL) {
  server.listen(PORT, () => {
    const activePass = state.passphrase || DEFAULT_PASSPHRASE;
    console.log(`====================================================`);
    console.log(`🏆 LEADERBOARD APP (MULTI-BOARD & TIMER RUNNING)`);
    console.log(`🔒 Passphrase Panitia        : ${activePass}`);
    console.log(`📺 Layar Display Proyektor   : http://localhost:${PORT}/display`);
    console.log(`⚙️  Panel Panitia 1           : http://localhost:${PORT}/admin?board=1`);
    console.log(`⚙️  Panel Panitia 2           : http://localhost:${PORT}/admin?board=2`);
    console.log(`🔑 Ganti Password            : http://localhost:${PORT}/change-password`);
    console.log(`⚡ Supabase Database         : ${supabase ? 'Aktif (' + SUPABASE_URL + ')' : 'Tidak aktif'}`);
    console.log(`====================================================`);

    if (supabase) {
      loadDataFromSupabase(true).then(() => {
        console.log(`⚡ Supabase data initialized successfully.`);
      }).catch(err => {
        console.error(`⚡ Gagal inisialisasi Supabase:`, err.message);
      });
    }
  });
}

module.exports = app;
module.exports.server = server;

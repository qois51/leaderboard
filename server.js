require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { put, list } = require('@vercel/blob');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const DEFAULT_PASSPHRASE = 'qoisganteng123';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'leaderboard.json');
const BLOB_FILENAME = 'data/leaderboard.json';

// Cloud Vercel Blob State
let latestBlobUrl = null;
let lastBlobSyncTime = null;
let isBlobSyncing = false;
let pendingBlobSync = false;

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

// Helper to load data
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        passphrase: (parsed && parsed.passphrase) ? parsed.passphrase : DEFAULT_PASSPHRASE,
        settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) },
        boards: {
          "1": { ...createDefaultBoard("1", "Leaderboard 1", "Kategori / Lintasan 1"), ...(parsed.boards ? parsed.boards["1"] : {}) },
          "2": { ...createDefaultBoard("2", "Leaderboard 2", "Kategori / Lintasan 2"), ...(parsed.boards ? parsed.boards["2"] : {}) }
        }
      };
    }
  } catch (err) {
    console.error('Error reading data file, resetting to default:', err);
  }
  saveData(DEFAULT_DATA);
  return DEFAULT_DATA;
}

// Helper to save data safely (local disk + Vercel Blob cloud storage)
function saveData(data) {
  try {
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    console.error('Error saving data to local disk:', err);
  }
  // Asynchronously trigger Vercel Blob storage upload
  triggerBlobSync(data);
}

// Background sync to Vercel Blob Storage
async function triggerBlobSync(data) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;

  if (isBlobSyncing) {
    pendingBlobSync = true;
    return;
  }

  isBlobSyncing = true;
  pendingBlobSync = false;

  try {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = await put(BLOB_FILENAME, jsonString, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json'
    });
    latestBlobUrl = blob.url;
    lastBlobSyncTime = new Date().toISOString();
    console.log(`☁️ Vercel Blob tersinkron: ${blob.url}`);

    io.emit('blob_status_updated', {
      enabled: true,
      url: latestBlobUrl,
      lastSync: lastBlobSyncTime
    });
  } catch (err) {
    console.error('☁️ Gagal sinkronisasi ke Vercel Blob:', err.message);
  } finally {
    isBlobSyncing = false;
    if (pendingBlobSync) {
      triggerBlobSync(state);
    }
  }
}

// Inisialisasi awal sinkronisasi data dari/ke Vercel Blob saat server mulai
async function initCloudBlob() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log('ℹ️ Vercel Blob: BLOB_READ_WRITE_TOKEN tidak terkonfigurasi. Berjalan dalam mode penyimpanan file lokal.');
    return;
  }

  try {
    console.log('☁️ Memeriksa data di Vercel Blob Storage...');
    const { blobs } = await list({ prefix: BLOB_FILENAME });
    const existingBlob = blobs.find(b => b.pathname === BLOB_FILENAME || b.pathname.endsWith('leaderboard.json'));

    if (existingBlob) {
      latestBlobUrl = existingBlob.url;
      lastBlobSyncTime = existingBlob.uploadedAt ? new Date(existingBlob.uploadedAt).toISOString() : new Date().toISOString();
      console.log(`☁️ Berkas Vercel Blob ditemukan: ${existingBlob.url}`);

      // Unduh dan periksa data dari cloud
      try {
        const res = await fetch(existingBlob.url, { cache: 'no-store' });
        if (res.ok) {
          const cloudData = await res.json();
          if (cloudData && cloudData.boards) {
            state = {
              passphrase: cloudData.passphrase || state.passphrase || DEFAULT_PASSPHRASE,
              settings: { ...DEFAULT_DATA.settings, ...(cloudData.settings || {}) },
              boards: {
                "1": { ...createDefaultBoard("1", "Leaderboard 1", "Kategori / Lintasan 1"), ...(cloudData.boards ? cloudData.boards["1"] : {}) },
                "2": { ...createDefaultBoard("2", "Leaderboard 2", "Kategori / Lintasan 2"), ...(cloudData.boards ? cloudData.boards["2"] : {}) }
              }
            };
            // Perbarui cache file lokal
            const tempFile = `${DATA_FILE}.tmp`;
            fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf-8');
            fs.renameSync(tempFile, DATA_FILE);
            console.log('☁️ Data leaderboard berhasil dimuat dari Vercel Blob ke memori server.');
            io.emit('leaderboard_updated', getFullDataResponse());
          }
        }
      } catch (e) {
        console.warn('Gagal membaca data dari blob URL:', e.message);
      }
    } else {
      console.log('☁️ Belum ada berkas di Vercel Blob, mengunggah data saat ini ke cloud...');
      await triggerBlobSync(state);
    }
  } catch (err) {
    console.error('☁️ Error inisialisasi Vercel Blob:', err.message);
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
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
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

// State in memory
let state = loadData();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Passphrase Auth Middleware for Protected Routes
function requirePassphrase(req, res, next) {
  const clientPass = req.headers['x-passphrase'] || req.query.passphrase || req.body.passphrase;
  const activePass = state.passphrase || DEFAULT_PASSPHRASE;
  if (clientPass !== activePass) {
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
  return {
    settings: state.settings,
    boards: {
      "1": {
        ...state.boards["1"],
        teams: getRankedTeams(state.boards["1"].teams)
      },
      "2": {
        ...state.boards["2"],
        teams: getRankedTeams(state.boards["2"].teams)
      }
    },
    blob: {
      enabled: !!process.env.BLOB_READ_WRITE_TOKEN,
      url: latestBlobUrl,
      lastSync: lastBlobSyncTime
    }
  };
}

// Timer Loop: update running timers on server
setInterval(() => {
  let changed = false;
  ['1', '2'].forEach(bId => {
    const board = state.boards[bId];
    if (board && board.timer && board.timer.isRunning) {
      const now = Date.now();
      const remaining = Math.max(0, board.timer.targetEndTime - now);
      board.timer.remainingMs = remaining;

      if (remaining <= 0) {
        board.timer.isRunning = false;
        board.timer.remainingMs = 0;
        board.timer.startedAt = null;
        board.timer.targetEndTime = null;
        changed = true;
        io.emit('timer_finished', { boardId: bId });
      }
      
      // Emit tick
      io.emit('timer_tick', {
        boardId: bId,
        remainingMs: board.timer.remainingMs,
        isRunning: board.timer.isRunning
      });
    }
  });

  if (changed) {
    saveData(state);
  }
}, 200);

// ========================
// REST APIS
// ========================

// 1. Auth Endpoint
app.post('/api/auth/login', (req, res) => {
  const { passphrase } = req.body;
  const activePass = state.passphrase || DEFAULT_PASSPHRASE;
  if (passphrase === activePass) {
    res.json({ success: true, message: 'Autentikasi berhasil.' });
  } else {
    res.status(401).json({ error: 'Passphrase salah!' });
  }
});

// 1b. Change Password Endpoint
app.post('/api/auth/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const activePass = state.passphrase || DEFAULT_PASSPHRASE;

  if (!currentPassword) {
    return res.status(400).json({ error: 'Password saat ini harus diisi.' });
  }

  if (currentPassword !== activePass) {
    return res.status(401).json({ error: 'Password saat ini salah!' });
  }

  if (!newPassword || newPassword.trim() === '') {
    return res.status(400).json({ error: 'Password baru tidak boleh kosong.' });
  }

  if (newPassword.trim().length < 4) {
    return res.status(400).json({ error: 'Password baru minimal 4 karakter.' });
  }

  if (newPassword.trim() === currentPassword) {
    return res.status(400).json({ error: 'Password baru harus berbeda dari password sekarang.' });
  }

  state.passphrase = newPassword.trim();
  saveData(state);

  res.json({ success: true, message: 'Password admin berhasil diperbarui!' });
});

// 2. Get current state (public)
app.get('/api/data', (req, res) => {
  res.json(getFullDataResponse());
});

// 3. Add team (Protected)
app.post('/api/teams', requirePassphrase, (req, res) => {
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
  saveData(state);

  const fullData = getFullDataResponse();
  io.emit('leaderboard_updated', fullData);

  res.status(201).json({ success: true, team: newTeam, boardId, fullData });
});

// 4. Edit team (Protected)
app.put('/api/teams/:id', requirePassphrase, (req, res) => {
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

  saveData(state);

  const fullData = getFullDataResponse();
  io.emit('leaderboard_updated', fullData);

  res.json({ success: true, team: board.teams[teamIndex], fullData });
});

// 5. Delete team (Protected)
app.delete('/api/teams/:id', requirePassphrase, (req, res) => {
  const { id } = req.params;
  const { boardId = '1' } = req.query;
  const board = state.boards[String(boardId)];
  if (!board) {
    return res.status(400).json({ error: 'Leaderboard tidak valid.' });
  }

  const initialLength = board.teams.length;
  board.teams = board.teams.filter(t => t.id !== id);

  if (board.teams.length === initialLength) {
    return res.status(404).json({ error: 'Kelompok tidak ditemukan.' });
  }

  saveData(state);
  const fullData = getFullDataResponse();
  io.emit('leaderboard_updated', fullData);

  res.json({ success: true, fullData });
});

// 6. Reset all teams in a board (Protected)
app.post('/api/teams/reset', requirePassphrase, (req, res) => {
  const { boardId = '1' } = req.body;
  const board = state.boards[String(boardId)];
  if (!board) {
    return res.status(400).json({ error: 'Leaderboard tidak valid.' });
  }

  board.teams = [];
  saveData(state);

  const fullData = getFullDataResponse();
  io.emit('leaderboard_updated', fullData);

  res.json({ success: true, message: `Data ${board.name} berhasil direset.` });
});

// 7. Timer Controls (Protected)
app.post('/api/timer/control', requirePassphrase, (req, res) => {
  const { boardId = '1', action, durationSeconds, title, teamA, teamB } = req.body;
  const board = state.boards[String(boardId)];
  if (!board) return res.status(400).json({ error: 'Leaderboard tidak valid.' });

  // Retain / update match team names if passed
  if (!board.activeMatch) board.activeMatch = { teamA: '', teamB: '' };
  if (teamA !== undefined) board.activeMatch.teamA = teamA.trim();
  if (teamB !== undefined) board.activeMatch.teamB = teamB.trim();

  const timer = board.timer;

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
    if (!timer.isRunning) {
      if (timer.remainingMs <= 0) {
        timer.remainingMs = timer.durationSeconds * 1000;
      }
      timer.isRunning = true;
      timer.startedAt = Date.now();
      timer.targetEndTime = Date.now() + timer.remainingMs;
      io.emit('timer_started', { boardId });
    }
  } else if (action === 'pause') {
    if (timer.isRunning) {
      timer.remainingMs = Math.max(0, timer.targetEndTime - Date.now());
      timer.isRunning = false;
      timer.startedAt = null;
      timer.targetEndTime = null;
    }
  } else if (action === 'reset') {
    timer.isRunning = false;
    timer.remainingMs = timer.durationSeconds * 1000;
    timer.startedAt = null;
    timer.targetEndTime = null;
  }

  saveData(state);
  const fullData = getFullDataResponse();
  io.emit('leaderboard_updated', fullData);
  res.json({ success: true, timer, activeMatch: board.activeMatch });
});

// 8. Setup Active Battle Teams (Protected)
app.post('/api/match/setup', requirePassphrase, (req, res) => {
  const { boardId = '1', teamA, teamB } = req.body;
  const board = state.boards[String(boardId)];
  if (!board) return res.status(400).json({ error: 'Leaderboard tidak valid.' });

  board.activeMatch = {
    teamA: (teamA || '').trim(),
    teamB: (teamB || '').trim()
  };

  saveData(state);
  const fullData = getFullDataResponse();
  io.emit('leaderboard_updated', fullData);
  res.json({ success: true, activeMatch: board.activeMatch });
});

// 9. Record Time directly from Timer for Active Team (Protected)
app.post('/api/match/record-time', requirePassphrase, (req, res) => {
  const { boardId = '1', teamType, teamName, teamA, teamB } = req.body; // teamType: 'A' or 'B'
  const board = state.boards[String(boardId)];
  if (!board) return res.status(400).json({ error: 'Leaderboard tidak valid.' });

  if (!board.activeMatch) board.activeMatch = { teamA: '', teamB: '' };
  if (teamA !== undefined) board.activeMatch.teamA = teamA.trim();
  if (teamB !== undefined) board.activeMatch.teamB = teamB.trim();

  const finalName = (teamName || (teamType === 'A' ? board.activeMatch.teamA : board.activeMatch.teamB) || '').trim();
  if (!finalName) {
    return res.status(400).json({ error: 'Nama kelompok belum diatur.' });
  }

  // Ensure activeMatch preserves the team name
  if (teamType === 'A') board.activeMatch.teamA = finalName;
  if (teamType === 'B') board.activeMatch.teamB = finalName;

  // Calculate elapsed time (waktu yang dihabiskan)
  // Elapsed time = (durationSeconds * 1000) - remainingMs
  const totalDurationMs = board.timer.durationSeconds * 1000;
  let elapsedMs = totalDurationMs - board.timer.remainingMs;
  if (elapsedMs <= 0) elapsedMs = 500; // minimum fallback

  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  const milliseconds = elapsedMs % 1000;

  // Check if team with same name already exists in this board, update it or add new
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

  saveData(state);
  const fullData = getFullDataResponse();
  io.emit('leaderboard_updated', fullData);

  res.json({
    success: true,
    message: `Catatan waktu "${finalName}" berhasil dicatat (${formatTime(elapsedMs)})!`,
    team: savedTeam,
    elapsedMs,
    formattedTime: formatTime(elapsedMs)
  });
});

// 10. Update board settings / titles (Protected)
app.post('/api/boards/settings', requirePassphrase, (req, res) => {
  const { boardId = '1', name, subtitle, eventName, eventSubtitle } = req.body;
  if (eventName) state.settings.eventName = eventName.trim();
  if (eventSubtitle !== undefined) state.settings.subTitle = eventSubtitle.trim();

  const board = state.boards[String(boardId)];
  if (board) {
    if (name) board.name = name.trim();
    if (subtitle !== undefined) board.subtitle = subtitle.trim();
  }

  saveData(state);
  const fullData = getFullDataResponse();
  io.emit('leaderboard_updated', fullData);
  res.json({ success: true, fullData });
});

// 11. Demo data populate (Protected)
app.post('/api/demo-data', requirePassphrase, (req, res) => {
  const { boardId = '1' } = req.body;
  const board = state.boards[String(boardId)];
  if (!board) return res.status(400).json({ error: 'Leaderboard tidak valid.' });

  const sampleTeams = boardId === '1' ? [
    { name: "Tim Harimau (Jalur A)", minutes: 1, seconds: 12, milliseconds: 450 },
    { name: "Tim Rajawali (Jalur B)", minutes: 1, seconds: 18, milliseconds: 920 },
    { name: "Tim Komodo (Jalur A)", minutes: 1, seconds: 25, milliseconds: 100 },
    { name: "Tim Badak Perkasa", minutes: 1, seconds: 34, milliseconds: 80 },
    { name: "Tim Kancil Cepat", minutes: 1, seconds: 42, milliseconds: 650 }
  ] : [
    { name: "Tim Singa Perkasa", minutes: 0, seconds: 58, milliseconds: 200 },
    { name: "Tim Macan Tutul", minutes: 1, seconds: 05, milliseconds: 750 },
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

  saveData(state);
  const fullData = getFullDataResponse();
  io.emit('leaderboard_updated', fullData);

  res.json({ success: true, fullData });
});

// 12. Export CSV (Public or panitia)
app.get('/api/export-csv', (req, res) => {
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
app.post('/api/import-csv', requirePassphrase, (req, res) => {
  const { boardId = '1', teams, mode } = req.body;
  const board = state.boards[String(boardId)];
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
  } else {
    board.teams = [...board.teams, ...validTeams];
  }

  saveData(state);
  const fullData = getFullDataResponse();
  io.emit('leaderboard_updated', fullData);

  res.json({ success: true, count: validTeams.length, fullData });
});

// 12. Vercel Blob Storage Status
app.get('/api/blob/status', (req, res) => {
  res.json({
    enabled: !!process.env.BLOB_READ_WRITE_TOKEN,
    url: latestBlobUrl,
    lastSync: lastBlobSyncTime,
    pathname: BLOB_FILENAME
  });
});

// 13. Manual Sync to Vercel Blob Storage (Protected)
app.post('/api/blob/sync', requirePassphrase, async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(400).json({ error: 'BLOB_READ_WRITE_TOKEN tidak terkonfigurasi di server.' });
  }
  try {
    await triggerBlobSync(state);
    res.json({
      success: true,
      message: 'Data berhasil disinkronkan ke Vercel Blob Storage!',
      url: latestBlobUrl,
      lastSync: lastBlobSyncTime
    });
  } catch (err) {
    res.status(500).json({ error: `Gagal sinkronisasi: ${err.message}` });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  socket.emit('initial_data', getFullDataResponse());
});

// Start server
server.listen(PORT, () => {
  const activePass = state.passphrase || DEFAULT_PASSPHRASE;
  console.log(`====================================================`);
  console.log(`🏆 LEADERBOARD APP (MULTI-BOARD & TIMER RUNNING)`);
  console.log(`🔒 Passphrase Panitia        : ${activePass}`);
  console.log(`📺 Layar Display Proyektor   : http://localhost:${PORT}/display`);
  console.log(`⚙️  Panel Panitia 1           : http://localhost:${PORT}/admin?board=1`);
  console.log(`⚙️  Panel Panitia 2           : http://localhost:${PORT}/admin?board=2`);
  console.log(`🔑 Ganti Password            : http://localhost:${PORT}/change-password`);
  console.log(`☁️ Vercel Blob Storage       : ${process.env.BLOB_READ_WRITE_TOKEN ? 'Aktif' : 'Tidak aktif (Lokal)'}`);
  console.log(`====================================================`);

  // Inisialisasi sinkronisasi cloud
  initCloudBlob();
});

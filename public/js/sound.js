// sound.js - Web Audio API & HTML5 Audio Sound Manager for Leaderboard & Timer Events
class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = true; // Default UNMUTED (Suara selalu aktif)
    this.buzzerAudio = null;
    this.unlocked = false;

    // Pastikan default unmuted di localStorage
    const saved = localStorage.getItem('leaderboard_sound');
    if (saved === '0') {
      // Sesuai permintaan pengguna: buat defaultnya gk mute soundnya jadi pasti bunyi
      this.enabled = true;
      localStorage.setItem('leaderboard_sound', '1');
    } else {
      this.enabled = true;
      localStorage.setItem('leaderboard_sound', '1');
    }

    this.preloadAudio();
    this.setupAutoUnlock();
  }

  preloadAudio() {
    try {
      this.buzzerAudio = new Audio('/sounds/buzzer.mp3');
      this.buzzerAudio.preload = 'auto';
      this.buzzerAudio.volume = 1.0;
      this.buzzerAudio.onerror = () => {
        // Fallback ke file WAV jika browser memiliki kendala dengan codec MP3
        this.buzzerAudio = new Audio('/sounds/buzzer.wav');
        this.buzzerAudio.preload = 'auto';
        this.buzzerAudio.volume = 1.0;
      };
    } catch (e) {
      console.warn('Audio preload error:', e);
    }
  }

  // Buka blokir AudioContext dan HTML5 Audio pada interaksi pengguna pertama (HP/Laptop)
  setupAutoUnlock() {
    const unlockHandler = () => {
      this.unlock();
      if (this.unlocked) {
        ['click', 'touchstart', 'touchend', 'keydown', 'pointerdown'].forEach(evt => {
          window.removeEventListener(evt, unlockHandler);
        });
      }
    };

    ['click', 'touchstart', 'touchend', 'keydown', 'pointerdown'].forEach(evt => {
      window.addEventListener(evt, unlockHandler, { passive: true });
    });
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  unlock() {
    try {
      this.init();
      if (this.ctx && this.ctx.state === 'running') {
        this.unlocked = true;
      }
      if (this.buzzerAudio) {
        this.buzzerAudio.load();
      }
    } catch (e) {
      // Ignore
    }
  }

  // Subtle update ding saat waktu kelompok dicatat
  playUpdate() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.3);
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  // Fanfare saat ada Juara 1 baru
  playNewRecord() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;

      const notes = [
        { freq: 523.25, time: 0.0, dur: 0.12 }, // C5
        { freq: 659.25, time: 0.12, dur: 0.12 }, // E5
        { freq: 783.99, time: 0.24, dur: 0.16 }, // G5
        { freq: 1046.50, time: 0.40, dur: 0.45 }  // C6
      ];

      notes.forEach(n => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.freq, this.ctx.currentTime + n.time);

        gain.gain.setValueAtTime(0.12, this.ctx.currentTime + n.time);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + n.time + n.dur);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(this.ctx.currentTime + n.time);
        osc.stop(this.ctx.currentTime + n.time + n.dur);
      });
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  // Peluit saat timer dimulai (Match start)
  playWhistle() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(2800, this.ctx.currentTime + 0.1);
      osc.frequency.linearRampToValueAtTime(2400, this.ctx.currentTime + 0.35);

      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.35);
    } catch (e) {
      console.warn('Whistle audio error:', e);
    }
  }

  // Beep hitung mundur (detik 5, 4, 3, 2, 1)
  playCountdownBeep(isFinal = false) {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = isFinal ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(isFinal ? 1200 : 800, this.ctx.currentTime);

      gain.gain.setValueAtTime(isFinal ? 0.2 : 0.1, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.18);
    } catch (e) {
      console.warn('Beep error:', e);
    }
  }

  // BUZZER WAKTU HABIS (00:00) - Memainkan file audio buzzer asli + Web Audio synth
  playBuzzer() {
    if (!this.enabled) return;
    this.init();

    // 1. Putar file audio asli (MP3 / WAV Buzzer)
    if (this.buzzerAudio) {
      try {
        this.buzzerAudio.currentTime = 0;
        this.buzzerAudio.volume = 1.0;
        const playPromise = this.buzzerAudio.play();
        if (playPromise !== undefined) {
          playPromise.catch(err => {
            console.warn('HTML5 Audio play blocked or delayed, using Web Audio synth fallback:', err);
            this.playSynthBuzzer();
          });
        }
      } catch (e) {
        this.playSynthBuzzer();
      }
    }

    // 2. Putar juga Web Audio synthesizer dual-frequency horn sebagai penguat suara arena
    this.playSynthBuzzer();
  }

  // Synthesizer suara klakson / buzzer arena pertandingan
  playSynthBuzzer() {
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      // Kombinasi frekuensi harmonik khas klakson buzzer basket/arena olahraga
      [150, 188, 225].forEach(freq => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.35, this.ctx.currentTime + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.8);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 1.8);
      });
    } catch (e) {
      console.warn('Synth buzzer error:', e);
    }
  }
}

// Instance global suara
const sounds = new SoundManager();

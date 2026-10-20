// Web Audio API Sound Generator for Leaderboard & Timer Events
class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
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

  // Subtle update ding
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

  // Fanfare when new Juara 1 is achieved
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

  // Whistle sound when timer starts
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

  // Short beep for countdown seconds (3, 2, 1)
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

  // Horn Buzzer when time is UP (00:00)
  playBuzzer() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;

      // Create dual-frequency buzzer for an authentic sports arena horn
      [180, 225].forEach(freq => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.25, this.ctx.currentTime + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.6);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 1.6);
      });
    } catch (e) {
      console.warn('Buzzer error:', e);
    }
  }
}

const sounds = new SoundManager();

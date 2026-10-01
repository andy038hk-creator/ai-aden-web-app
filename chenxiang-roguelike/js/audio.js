/**
 * Short procedural SFX (Web Audio). No asset files.
 * Stays silent if autoplay blocks the context until a user gesture resumes it.
 */
export function createSfx() {
  let ctx = null;
  let master = null;
  let muted = false;

  function context() {
    if (muted) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.32;
        master.connect(ctx.destination);
      } catch {
        return null;
      }
    }
    return ctx.state === 'running' ? ctx : null;
  }

  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.resolve();
    try {
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.32;
        master.connect(ctx.destination);
      }
    } catch {
      return Promise.resolve();
    }
    if (ctx.state === 'suspended') {
      return ctx.resume().catch(() => {});
    }
    return Promise.resolve();
  }

  function envGain(c, duration, peak) {
    const g = c.createGain();
    g.connect(master);
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.03, duration));
    return g;
  }

  function tone(freq, dur, type, peak) {
    const c = context();
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    o.connect(envGain(c, dur, peak));
    o.start();
    o.stop(c.currentTime + dur + 0.03);
  }

  function noise(dur, peak, bpFreq) {
    const c = context();
    if (!c) return;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = bpFreq;
    filter.Q.value = 0.65;
    src.connect(filter);
    filter.connect(envGain(c, dur, peak));
    src.start();
  }

  function safe(fn) {
    try {
      fn();
    } catch {
      /* device busy, interrupted context, or autoplay */
    }
  }

  return {
    unlock,
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.32;
      return muted;
    },
    axe() {
      safe(() => {
        noise(0.08, 0.5, 380);
        tone(150, 0.09, 'square', 0.16);
      });
    },
    lantern() {
      safe(() => {
        tone(523, 0.16, 'sine', 0.2);
        tone(784, 0.2, 'triangle', 0.14);
      });
    },
    hit() {
      safe(() => {
        noise(0.05, 0.38, 1500);
        tone(340, 0.06, 'square', 0.1);
      });
    },
    hurt() {
      safe(() => {
        tone(108, 0.2, 'sawtooth', 0.18);
        noise(0.1, 0.22, 180);
      });
    },
    enemyDie() {
      safe(() => {
        tone(246, 0.12, 'square', 0.14);
        tone(146, 0.22, 'triangle', 0.12);
      });
    },
    playerDown() {
      safe(() => {
        tone(196, 0.28, 'sawtooth', 0.16);
        tone(92, 0.42, 'sine', 0.18);
      });
    },
    ui() {
      safe(() => tone(660, 0.08, 'sine', 0.14));
    },
    win() {
      safe(() => {
        [523, 659, 784, 1046].forEach((f, i) => {
          setTimeout(() => tone(f, 0.18, 'sine', 0.15), i * 90);
        });
      });
    },
  };
}

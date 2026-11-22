// Tiny plucked-string synth (Karplus-Strong). No samples needed.

const AudioEngine = (() => {
  let ctx = null;
  let master = null;
  const cache = new Map();
  const voices = []; // one ringing voice per string, like a real guitar

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.8;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4500;
      const comp = ctx.createDynamicsCompressor();
      master.connect(lp);
      lp.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function buffer(midi) {
    if (cache.has(midi)) return cache.get(midi);
    const sr = ctx.sampleRate;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const N = Math.max(2, Math.round(sr / f));
    const len = Math.floor(sr * 3);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const ring = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) {
      prev = prev * 0.5 + (Math.random() * 2 - 1) * 0.5; // softer pick attack
      ring[i] = prev;
    }
    const decay = Math.pow(0.001, 1 / (f * 3.5));
    let idx = 0;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const cur = ring[idx];
      const nxt = ring[(idx + 1) % N];
      d[i] = cur;
      ring[idx] = decay * 0.5 * (cur + nxt);
      idx = (idx + 1) % N;
      if (Math.abs(cur) > peak) peak = Math.abs(cur);
    }
    const g = peak > 0 ? 0.9 / peak : 1;
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < len; i++) {
      d[i] *= g;
      if (i > len - fade) d[i] *= (len - i) / fade;
    }
    cache.set(midi, buf);
    return buf;
  }

  function pluck(string, midi, time, vel = 1) {
    ensure();
    const t = Math.max(time ?? ctx.currentTime, ctx.currentTime);
    const prev = voices[string];
    if (prev) {
      try {
        prev.g.gain.cancelScheduledValues(t);
        prev.g.gain.setTargetAtTime(0, t, 0.015);
        prev.src.stop(t + 0.2);
      } catch (e) { /* already stopped */ }
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32 * vel, t);
    src.connect(g);
    g.connect(master);
    src.start(t);
    voices[string] = { src, g };
  }

  function strum(frets, time, spacing = 0.035) {
    ensure();
    const t0 = time ?? ctx.currentTime + 0.02;
    let k = 0;
    frets.forEach((f, s) => {
      if (f >= 0) pluck(s, Theory.OPEN_MIDI[s] + f, t0 + k++ * spacing, 0.8);
    });
  }

  return {
    ensure, pluck, strum,
    get ctx() { return ctx; },
  };
})();

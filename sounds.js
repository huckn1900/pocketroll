/* sounds.js — procedural camera sounds (WebAudio synthesis, no audio assets).
   Same physical-modelling approach as app.js shutterSound/ding: tiny throwaway
   contexts, noise bursts through bandpass filters = mechanical parts.
   Variants are A/B so the user can audition and pick before integration. */
const S = {
  ac(){ return new (window.AudioContext || window.webkitAudioContext)(); },
  burst(ac, t, dur, freq, gain, q){ // mechanical click: filtered noise with sharp decay
    const buf = ac.createBuffer(1, Math.max(1, Math.round(ac.sampleRate * dur)), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (dur * ac.sampleRate * 0.3));
    const src = ac.createBufferSource(); src.buffer = buf;
    const bi = ac.createBiquadFilter(); bi.type = 'bandpass'; bi.frequency.value = freq; bi.Q.value = q || 1.2;
    const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bi); bi.connect(g); g.connect(ac.destination); src.start(t);
  },
  tone(ac, t, f, dur, gain, type){ // electronic beep
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.value = f;
    const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur);
  },
  whir(ac, t, dur, baseF, amHz, gain){ // gear/motor whir: saw through bandpass, tremolo = tooth meshing
    const o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(baseF, t); o.frequency.linearRampToValueAtTime(baseF * 0.85, t + dur);
    const bi = ac.createBiquadFilter(); bi.type = 'bandpass'; bi.frequency.value = baseF * 3.2; bi.Q.value = 2.5;
    const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const lfo = ac.createOscillator(); lfo.frequency.value = amHz;
    const lg = ac.createGain(); lg.gain.value = gain * 0.55;
    lfo.connect(lg); lg.connect(g.gain);
    o.connect(bi); bi.connect(g); g.connect(ac.destination);
    o.start(t); lfo.start(t); o.stop(t + dur); lfo.stop(t + dur);
  },

  /* ---------- film advance ---------- */
  advanceLever(){ // manual lever / spring wind: heavy ratchet clicks, slightly irregular, stop-thud at end
    const ac = this.ac(); const t0 = ac.currentTime;
    for (let i = 0; i < 9; i++)
      this.burst(ac, t0 + i * 0.075 + Math.random() * 0.03, 0.055, 1250 - i * 70, 0.30 - i * 0.022, 1.4);
    this.burst(ac, t0 + 0.72, 0.09, 480, 0.28, 0.9); // the lever snaps back home
    setTimeout(() => ac.close(), 1300);
  },
  advanceMotor(){ // motorized compact (AF35M character): smooth gear whir + stop click
    const ac = this.ac(); const t0 = ac.currentTime;
    this.whir(ac, t0, 0.42, 95, 46, 0.11);
    this.burst(ac, t0 + 0.45, 0.05, 1400, 0.2, 1.3);
    setTimeout(() => ac.close(), 800);
  },

  /* ---------- focus ---------- */
  focusChirp(){ // quiet AF confirmation chirp in the viewfinder (2-tone, low level)
    const ac = this.ac(); const t0 = ac.currentTime;
    this.tone(ac, t0, 1760, 0.05, 0.055);
    this.tone(ac, t0 + 0.09, 2200, 0.05, 0.05);
    setTimeout(() => ac.close(), 400);
  },
  focusWhir(){ // lens motor adjusting, tiny stop-click at lock
    const ac = this.ac(); const t0 = ac.currentTime;
    this.whir(ac, t0, 0.22, 70, 30, 0.09);
    this.burst(ac, t0 + 0.23, 0.035, 1800, 0.13, 1.5);
    setTimeout(() => ac.close(), 600);
  },

  /* ---------- real-use combo: shutter click THEN advance (the actual sequence) ---------- */
  combo(mode){ // mode: 'lever' | 'motor'
    const ac = this.ac(); const t0 = ac.currentTime;
    for (const [off, gain, freq] of [[0, 0.3, 1400], [0.07, 0.14, 700]]) { // mirror slap + snap (app.js shutter)
      const buf = ac.createBuffer(1, Math.round(ac.sampleRate * 0.06), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (buf.length * 0.22));
      const src = ac.createBufferSource(); src.buffer = buf;
      const bi = ac.createBiquadFilter(); bi.type = 'bandpass'; bi.frequency.value = freq;
      const g = ac.createGain(); g.gain.value = gain;
      src.connect(bi); bi.connect(g); g.connect(ac.destination); src.start(t0 + off);
    }
    if (mode === 'motor') { this.whir(ac, t0 + 0.14, 0.42, 95, 46, 0.11); this.burst(ac, t0 + 0.59, 0.05, 1400, 0.2, 1.3); }
    else { for (let i = 0; i < 9; i++) this.burst(ac, t0 + 0.14 + i * 0.075 + Math.random() * 0.03, 0.055, 1250 - i * 70, 0.30 - i * 0.022, 1.4); this.burst(ac, t0 + 0.86, 0.09, 480, 0.28, 0.9); }
    setTimeout(() => ac.close(), 1500);
  }
};
window.Sounds = S;

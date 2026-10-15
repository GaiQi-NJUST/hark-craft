/**
 * WebAudio 合成音效：环境氛围铺底（缓慢变化的和弦 + 低通呼吸）与破坏/放置的“啵”声。
 * 浏览器策略：首次用户交互后才创建 AudioContext，此前完全静音。
 */
export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private padGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private chordTimer = 0;
  private oscs: OscillatorNode[] = [];
  private chordIdx = 0;

  private static CHORDS = [
    [130.81, 196.0, 329.63, 493.88], // Cmaj7
    [110.0, 164.81, 261.63, 392.0], // Am7
    [87.31, 174.61, 261.63, 329.63], // Fmaj7
    [98.0, 146.83, 246.94, 349.23], // G7sus
  ];

  /** 在用户手势中调用 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    // 白噪声缓冲
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 氛围铺底
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.4;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 450;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 4);
    filter.connect(this.padGain).connect(this.master);
    const chord = Synth.CHORDS[0];
    chord.forEach((f, i) => {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 0.5 : 0.22;
        o.connect(g).connect(filter);
        o.start();
        this.oscs.push(o);
      }
    });
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  /** 每帧调用，缓慢换和弦 */
  update(dt: number) {
    if (!this.ctx) return;
    this.chordTimer += dt;
    if (this.chordTimer > 14) {
      this.chordTimer = 0;
      this.chordIdx = (this.chordIdx + 1) % Synth.CHORDS.length;
      const chord = Synth.CHORDS[this.chordIdx];
      const t = this.ctx.currentTime;
      this.oscs.forEach((o, i) => o.frequency.setTargetAtTime(chord[Math.floor(i / 2)], t, 1.8));
    }
  }

  pop(kind: 'break' | 'place' | 'ui', pitch = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    if (kind === 'break' && this.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 * pitch;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + 0.2);
    }
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    const f0 = kind === 'place' ? 520 : kind === 'ui' ? 880 : 300;
    o.frequency.setValueAtTime(f0 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.5 * pitch, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(kind === 'ui' ? 0.08 : 0.22, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** 开场的低频轰鸣 + 闪光音 */
  whoosh() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(3000, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.7);
  }
}

export const synth = new Synth();

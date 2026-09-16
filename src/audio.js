export class DiveAudio {
  constructor(onError) { this.onError = onError; this.muted = false; this.volume = 0.35; }
  async unlock() {
    if (this.muted) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") await this.context.resume();
    } catch { this.onError("浏览器暂时无法播放音效，仍可正常答题。"); }
  }
  setMuted(value) { this.muted = value; if (this.master) this.master.gain.value = value ? 0 : this.volume; }
  tone(frequency, end = frequency, duration = 0.2, delay = 0, type = "sine", volume = 0.2) {
    if (this.muted || this.context?.state !== "running") return;
    const ctx = this.context, start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(end, start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration + 0.01);
    oscillator.connect(gain); gain.connect(this.master);
    oscillator.start(start); oscillator.stop(start + duration + 0.04);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  noise(duration = 1, cutoff = 1400, endCutoff = 180) {
    if (this.muted || this.context?.state !== "running") return;
    const ctx = this.context, start = ctx.currentTime;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const values = buffer.getChannelData(0);
    for (let i = 0; i < values.length; i++) values[i] = Math.random() * 2 - 1;
    const node = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    node.buffer = buffer; filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, start); filter.frequency.exponentialRampToValueAtTime(endCutoff, start + duration);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.15, start + 0.04); gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    node.connect(filter); filter.connect(gain); gain.connect(this.master);
    node.start(); node.stop(start + duration);
    node.onended = () => { node.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  play(event) {
    if (event === "submit") this.tone(1150, 1150, 0.16);
    else if (event === "reject") { this.tone(150, 62, 0.36); this.noise(0.22, 420, 180); }
    else if (event === "sink") { this.noise(1.3); this.tone(300, 60, 1.3); this.tone(1150, 1150, 0.5, 0, "sine", 0.06); }
    else if (event === "tick") this.tone(780, 550, 0.055, 0, "triangle", 0.12);
    else if (event === "miss") { this.tone(220, 110, 0.4); this.tone(110, 55, 0.6, 0.2); }
    else {
      const notes = event === "krillion" || event === "done" ? [523.25, 659.25, 783.99, 1046.5, 1567.98] : event === "deepcut" ? [392, 493.88, 587.33, 783.99] : event === "rare" ? [329.63, 440, 659.25] : event === "tooclever" ? [392, 369.99, 261.63] : event === "schooler" ? [329.63, 440] : [220, 261.63];
      notes.forEach((frequency, i) => this.tone(frequency, frequency, 0.55, i * 0.12, "triangle", 0.18));
    }
  }
  async visibility(hidden) {
    if (!this.context) return;
    try { if (hidden) await this.context.suspend(); else if (!this.muted) await this.context.resume(); }
    catch { this.onError("音效恢复失败，点击音效按钮可重试。"); }
  }
}

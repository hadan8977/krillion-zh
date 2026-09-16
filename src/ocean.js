export class Ocean {
  constructor(canvas, onDepth) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onDepth = onDepth;
    this.phase = "home";
    this.targetDepth = 0;
    this.depth = 0;
    this.surface = 0.59;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.character = "krillion";
    this.pointer = { x: 0.72, y: 0.7 };
    this.krill = { x: 0.72, y: 0.7 };
    this.images = {};
    this.sparkles = [];
    this.particles = Array.from({ length: 95 }, (_, i) => ({ x: ((i * 73.19) % 100) / 100, y: ((i * 37.13) % 100) / 100, size: i % 4 === 0 ? 2 : 1, speed: 0.3 + (i % 7) * 0.14 }));
    for (const name of ["bg-sky.webp", "bg-top.webp", "bg-mid.webp", "bg-trench.webp", "krillion.png", "krillion-gold.png"]) {
      const img = new Image();
      img.src = `./assets/${name}`;
      this.images[name] = img;
    }
    this.resize = () => {
      this.width = canvas.clientWidth;
      this.height = canvas.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = this.width * ratio;
      canvas.height = this.height * ratio;
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      this.ctx.imageSmoothingEnabled = false;
    };
    this.resize();
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    this.frame = (time) => { this.draw(time); this.animation = requestAnimationFrame(this.frame); };
    this.animation = requestAnimationFrame(this.frame);
  }

  set(phase, depth = 0, tier = null) {
    this.phase = phase;
    this.targetDepth = depth;
    if (tier && tier !== "miss") {
      const color = tier === "krillion" ? "#ffd166" : tier === "deepcut" ? "#9d7bff" : "#4de3ff";
      this.sparkles = Array.from({ length: 35 }, (_, i) => ({ x: this.krill.x, y: this.krill.y, angle: i * 2.399, color, born: performance.now(), speed: 25 + (i % 8) * 12 }));
    }
  }

  draw(time) {
    const { ctx: c, width: w, height: h } = this;
    if (!w || !h) return;
    const dt = Math.min(50, time - (this.previousTime || time));
    this.previousTime = time;
    const approach = this.reducedMotion ? 1 : 1 - Math.exp(-dt / 500);
    this.depth += (this.targetDepth - this.depth) * approach;
    this.surface += ((this.phase === "home" ? 0.59 : 0.215) - this.surface) * approach;
    this.onDepth(Math.round(this.depth));
    const t = this.reducedMotion ? 0 : time / 1000;
    const scale = h / 530;
    const horizon = h * this.surface - this.depth * scale;
    const gradient = c.createLinearGradient(0, 0, 0, h);
    const level = Math.min(this.depth / 1800, 1);
    gradient.addColorStop(0, `rgb(${Math.round(29 - level * 25)},${Math.round(85 - level * 77)},${Math.round(128 - level * 109)})`);
    gradient.addColorStop(1, this.depth > 2000 ? "#02050b" : "#081526");
    c.fillStyle = gradient; c.fillRect(0, 0, w, h);

    if (horizon > 0) {
      c.fillStyle = "#81cbe8"; c.fillRect(0, 0, w, horizon);
      const sky = this.images["bg-sky.webp"];
      if (sky.complete && sky.naturalWidth) {
        const imageWidth = Math.max(w, h * 1.36);
        const imageHeight = imageWidth * sky.naturalHeight / sky.naturalWidth;
        c.drawImage(sky, (w - imageWidth) * 0.3, horizon - imageHeight, imageWidth, imageHeight);
      }
      c.fillStyle = "#1d5580";
      c.beginPath(); c.moveTo(0, horizon + 5);
      for (let x = 0; x <= w + 12; x += 12) c.lineTo(x, horizon + Math.sin(x / 110 + t) * 3 + Math.sin(x / 58 - t * 0.6) * 2);
      c.lineTo(w, horizon + 13); c.lineTo(0, horizon + 13); c.fill();
    }

    c.save(); c.beginPath(); c.rect(0, Math.max(0, horizon + 10), w, h); c.clip();
    const bg = this.images[this.depth < 900 ? "bg-top.webp" : this.depth < 4200 ? "bg-mid.webp" : "bg-trench.webp"];
    if (bg.complete && bg.naturalWidth) {
      c.globalAlpha = this.depth < 500 ? 0.28 : 0.2;
      const bw = Math.max(w, 900); const bh = bw * bg.naturalHeight / bg.naturalWidth;
      const offset = this.depth < 900 ? horizon + h * 0.12 : -(this.depth % 600) * 0.2;
      c.drawImage(bg, (w - bw) / 2, offset, bw, bh);
      c.globalAlpha = 1;
    }
    for (const p of this.particles) {
      const y = ((p.y * h - t * p.speed * 7 - this.depth * scale * 0.4) % h + h) % h;
      c.fillStyle = p.size === 2 ? "#bee5ff50" : "#a5d8ff2a";
      c.fillRect(Math.floor(p.x * w + Math.sin(t * 0.2 + p.y * 8) * 10), y, p.size, p.size);
    }
    for (let i = 0; i < 13; i++) {
      const x = ((i * 87 + t * (7 + i % 3)) % (w + 60)) - 30;
      const y = ((h * (0.72 + i % 4 * 0.022) - this.depth * scale * 0.4 + i * 3) % h + h) % h;
      const size = i % 5 === 0 ? 1.1 : 0.75;
      c.fillStyle = this.depth > 2000 ? "#1e395655" : "#031827";
      c.beginPath(); c.ellipse(x, y, 10 * size, 4 * size, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(x - 7 * size, y); c.lineTo(x - 15 * size, y - 4 * size); c.lineTo(x - 15 * size, y + 4 * size); c.fill();
    }
    this.drawRuler(c, horizon, scale);
    c.restore();

    const isHome = this.phase === "home";
    const target = isHome ? { x: 0.72, y: 0.7 } : { x: this.pointer.x, y: Math.max(0.62, Math.min(0.82, this.pointer.y)) };
    this.krill.x += (target.x - this.krill.x) * approach * 0.35;
    this.krill.y += (target.y - this.krill.y) * approach * 0.35;
    const sprite = this.images[`${this.character}.png`];
    const size = w < 650 ? 47 : 56;
    const kx = this.krill.x * w, ky = this.krill.y * h + Math.sin(t * 2.5) * 6;
    if (sprite.complete && sprite.naturalWidth) c.drawImage(sprite, kx - size / 2, ky - size / 2, size, size);
    c.strokeStyle = "#aae2ff80";
    for (let i = 0; i < 3; i++) {
      const rise = (t * 19 + i * 31) % 93;
      c.globalAlpha = 1 - rise / 93;
      c.beginPath(); c.arc(kx + Math.sin(rise / 16) * 8, ky - 15 - rise, 2 + i * 0.5, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
    for (const p of this.sparkles) {
      const age = (time - p.born) / 1000;
      if (age > 1.5 || this.reducedMotion) continue;
      c.globalAlpha = 1 - age / 1.5; c.fillStyle = p.color;
      c.fillRect(p.x * w + Math.cos(p.angle) * age * p.speed, p.y * h + Math.sin(p.angle) * age * p.speed, 3, 3);
    }
    c.globalAlpha = 1;
  }

  drawRuler(c, horizon, scale) {
    const { width: w, height: h } = this;
    c.strokeStyle = "#92b4d24a"; c.fillStyle = "#92b4d2aa";
    c.font = "10px Pixel, monospace"; c.textAlign = "right";
    c.beginPath(); c.moveTo(w - 14, Math.max(0, horizon)); c.lineTo(w - 14, h); c.stroke();
    const start = Math.max(0, Math.floor(-horizon / scale / 10) * 10);
    for (let m = start; m < start + h / scale + 100; m += 10) {
      const y = horizon + m * scale;
      if (y < 0 || y > h) continue;
      const major = m % 100 === 0;
      c.beginPath(); c.moveTo(w - 14, y); c.lineTo(w - (major ? 30 : 20), y); c.stroke();
      if (major) c.fillText(`${m === 0 ? "" : "−"}${m}m`, w - 35, y + 3);
    }
    if (this.depth > 100) {
      const landmarks = [[200,"阳光渐渐消失"],[1000,"午夜区 · 这里没有阳光"],[2000,"巨型乌贼游过的深度"],[3800,"泰坦尼克号长眠于此"],[4000,"深渊带"],[6000,"超深渊带"],[7000,"海沟尽头 · 完美下潜"]];
      c.fillStyle = "#91b0d175"; c.font = `${w < 650 ? 11 : 13}px Pixel, monospace`;
      for (const [m, label] of landmarks) {
        const y = horizon + m * scale;
        if (y > 130 && y < h - 130) {
          c.textAlign = "left"; c.fillText(`── ${label}`, w < 650 ? 24 : w * 0.14, y);
        }
      }
    }
  }
}

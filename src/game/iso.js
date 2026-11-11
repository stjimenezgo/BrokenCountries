// Vista isométrica del país: dibuja el mapa, las empresas como edificios y los eventos
// (incendios, huelgas, epidemias, empresas que se van al vecino) sobre un <canvas>.
import { buildMap, hash } from './map.js';
import { SECTORS } from '../config.js';

const TW = 64, TH = 32, HU = 9;

const LAND = {
  caribe: '#bccf78', antioquia: '#8cbf68', andina: '#7db36a', santanderes: '#a9bb6c',
  pacifico: '#4e9b5c', llanos: '#c4c56c', vecino: '#cdb894',
};
const AMAZON = '#3f8a4f';

// Paleta de capas (bajo = bueno → alto = malo).
function ramp(x) {
  const t = Math.max(0, Math.min(1, x));
  const stops = [[46, 139, 87], [240, 200, 60], [214, 69, 52]];
  const [a, b, k] = t < 0.5 ? [stops[0], stops[1], t / 0.5] : [stops[1], stops[2], (t - 0.5) / 0.5];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `rgb(${c.join(',')})`;
}

export class IsoView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = buildMap();
    this.cam = { x: 0, y: 0, z: 1 };
    this.overlay = null;          // { key, values: {regionId: 0..1}, label }
    this.selected = null;
    this.hoverTile = null;
    this.slots = new Map();       // firm id → { tile, born, sector, size, informal, dying }
    this.vecinoSlots = new Map();
    this.effects = [];            // incendios, camiones, etc.
    this.seenFires = new Set();
    this.houses = [];
    this.w = null;
    this.dark = matchMedia('(prefers-color-scheme: dark)').matches;
    this.resize();
    this.fit();
    // El canvas puede medir 0 hasta que se aplica el CSS: se reencuadra la primera vez que tiene tamaño.
    new ResizeObserver(() => {
      const first = !this.vw;
      this.resize();
      if (first || this.autoFit) this.fit();
    }).observe(canvas);
    this.autoFit = true;
    this.bindInput();
  }

  // ------------------------------------------------------------ cámara

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.vw = r.width; this.vh = r.height;
  }

  fit() {
    const { rows, cols } = this.map;
    const wWorld = (cols + rows) * TW / 2, hWorld = (cols + rows) * TH / 2;
    this.cam.z = Math.min(this.vw / (wWorld * 0.82), this.vh / (hWorld * 0.95));
    const cx = ((cols - rows) / 2) * TW / 2, cy = ((cols + rows) / 2) * TH / 2;
    this.cam.x = this.vw / 2 - cx * this.cam.z;
    this.cam.y = this.vh / 2 - cy * this.cam.z + 10;
  }

  toScreen(i, j, h = 0) {
    return { x: (i - j) * TW / 2, y: (i + j) * TH / 2 - h * HU };
  }

  pick(sx, sy) {
    const wx = (sx - this.cam.x) / this.cam.z, wy = (sy - this.cam.y) / this.cam.z;
    for (const h of [2, 1, 0]) {
      const a = wx / (TW / 2), b = (wy + h * HU) / (TH / 2);
      const i = Math.floor((a + b) / 2 + 0.5), j = Math.floor((b - a) / 2 + 0.5);
      const t = this.map.at(i, j);
      if (t && t.h === h) return t;
    }
    return null;
  }

  bindInput() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) { this.cam.x = drag.cx + dx; this.cam.y = drag.cy + dy; this.autoFit = false; }
      }
      this.hoverTile = this.pick(e.clientX - r.left, e.clientY - r.top);
      this.onHover?.(this.hoverTile, e.clientX - r.left, e.clientY - r.top);
    });
    c.addEventListener('pointerup', (e) => {
      const r = c.getBoundingClientRect();
      if (drag && !drag.moved) {
        const t = this.pick(e.clientX - r.left, e.clientY - r.top);
        this.onSelect?.(t?.region ?? null);
      }
      drag = null;
    });
    c.addEventListener('pointerleave', () => { this.hoverTile = null; this.onHover?.(null); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  zoomAt(sx, sy, k) {
    const z = Math.max(0.35, Math.min(3.5, this.cam.z * k));
    k = z / this.cam.z;
    this.autoFit = false;
    this.cam.x = sx - (sx - this.cam.x) * k;
    this.cam.y = sy - (sy - this.cam.y) * k;
    this.cam.z = z;
  }

  // ------------------------------------------------------------ sincronización con el modelo

  sync(w, now = performance.now()) {
    const reset = this.w !== w;
    this.w = w;
    if (reset) { this.slots.clear(); this.vecinoSlots.clear(); this.effects = []; this.seenFires.clear(); }
    const regionId = (f) => w.regions[f.region].id;
    const used = new Set();
    for (const s of this.slots.values()) used.add(s.tile.idx);
    const alive = new Set(w.firms.map((f) => f.id));
    const relocated = new Set(w.relocated.map((f) => f.id));
    const burned = new Map();
    for (const e of w.fireEvents) if (!this.seenFires.has(e.id)) { burned.set(e.id, e); this.seenFires.add(e.id); }

    // Salidas: incendio, mudanza al vecino o quiebra.
    for (const [id, s] of this.slots) {
      if (alive.has(id) || s.dying) continue;
      if (!reset && burned.has(id)) {
        this.effects.push({ kind: 'fire', tile: s.tile, t0: now, dur: 7000 });
        this.slots.delete(id);
      } else if (!reset && relocated.has(id)) {
        const dest = this.freeTile('vecino', this.vecinoUsed(), s.sector);
        this.effects.push({ kind: 'truck', from: s.tile, to: dest, t0: now, dur: 3200, sector: s.sector });
        this.slots.delete(id);
        if (dest) this.vecinoSlots.set(id, { tile: dest, born: now + 3200, sector: s.sector, size: s.size, informal: false });
      } else {
        s.dying = now;
      }
    }
    for (const [id, s] of this.slots) if (s.dying && now - s.dying > 1400) this.slots.delete(id);
    used.clear();
    for (const s of this.slots.values()) used.add(s.tile.idx);

    // Empresas vivas: tamaño según ventas frente a la típica de su sector.
    for (const f of w.firms) {
      const typ = w.sectors[f.sector].sTypical || 1;
      const size = Math.max(0.35, Math.min(2.2, Math.sqrt(f.sales / typ)));
      let s = this.slots.get(f.id);
      if (!s) {
        const tile = this.freeTile(regionId(f), used, f.sector, f.id);
        if (!tile) continue;
        used.add(tile.idx);
        s = { tile, born: reset ? now - 5000 : now, sector: f.sector };
        this.slots.set(f.id, s);
      }
      s.size = size;
      s.informal = f.e > 0.55;
    }
    // Empresas en el vecino que ya no existen.
    for (const id of this.vecinoSlots.keys()) if (!relocated.has(id)) this.vecinoSlots.delete(id);
    for (const f of w.relocated) {
      if (this.vecinoSlots.has(f.id)) continue;
      const tile = this.freeTile('vecino', this.vecinoUsed(), f.sector, f.id);
      if (tile) this.vecinoSlots.set(f.id, { tile, born: now - 5000, sector: f.sector, size: 1, informal: false });
    }
    this.placeHouses(w, used);
  }

  vecinoUsed() {
    return new Set([...this.vecinoSlots.values()].map((s) => s.tile.idx));
  }

  // Comercio, industria y tecnología se agrupan cerca de la capital; agro y minería van al campo.
  freeTile(region, used, sector, seed = 0) {
    const list = this.map.byRegion[region];
    if (!list) return null;
    const rural = sector === 'agro' || sector === 'mineria';
    const start = rural ? Math.floor(list.length * 0.3) : 0;
    if (rural) {
      for (let k = 0; k < 12; k++) {
        const t = list[start + Math.floor(hash(seed, k, 11) * (list.length - start))];
        if (!used.has(t.idx)) return t;
      }
    }
    for (let k = start; k < list.length; k++) if (!used.has(list[k].idx)) return list[k];
    for (const t of list) if (!used.has(t.idx)) return t;
    return null;
  }

  // Viviendas: más en las regiones pobladas; la fracción informal se ve como ranchos de zinc.
  placeHouses(w, used) {
    this.houses = [];
    const lfTot = w.regions.reduce((a, r) => a + r.lf, 0);
    for (const r of w.regions) {
      const list = this.map.byRegion[r.id];
      const n = Math.round((r.lf / lfTot) * 120);
      let k = 0;
      for (const t of list) {
        if (k >= n) break;
        if (used.has(t.idx)) continue;
        this.houses.push({ tile: t, informal: hash(t.i, t.j, 13) < r.informality, unemployed: hash(t.i, t.j, 17) < r.u * 2.2 });
        k++;
      }
    }
  }

  // ------------------------------------------------------------ dibujo

  draw(now) {
    const { ctx, cam, dpr } = this;
    const w = this.w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.dark ? '#0f2233' : '#a9d2ea';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.setTransform(cam.z * dpr, 0, 0, cam.z * dpr, cam.x * dpr, cam.y * dpr);

    const byTile = new Map();
    for (const s of this.slots.values()) byTile.set(s.tile.idx, s);
    for (const s of this.vecinoSlots.values()) byTile.set(s.tile.idx, s);
    const houseAt = new Map(this.houses.map((h) => [h.tile.idx, h]));
    const strike = w?.macro.strike > 0;

    const order = [...this.map.tiles].sort((a, b) => (a.i + a.j) - (b.i + b.j) || a.i - b.i);
    for (const t of order) {
      this.drawTile(t, now);
      const s = byTile.get(t.idx);
      if (s) this.drawBuilding(t, s, now, strike);
      else if (houseAt.has(t.idx)) this.drawHouse(t, houseAt.get(t.idx));
    }
    for (const e of this.effects) this.drawEffect(e, now);
    this.effects = this.effects.filter((e) => now - e.t0 < e.dur);
    if (w) this.drawRegionMarks(w, now);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (w) this.drawLabels(w);
  }

  diamond(cx, cy, a, b) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(cx, cy - b); ctx.lineTo(cx + a, cy); ctx.lineTo(cx, cy + b); ctx.lineTo(cx - a, cy);
    ctx.closePath();
  }

  tileColor(t) {
    if (t.water) return this.dark ? '#1d4e78' : '#4f93c9';
    if (t.foreign) return this.dark ? '#77735f' : '#d8d0b6';
    if (t.region === 'llanos' && t.j > 16) return AMAZON;
    return LAND[t.region];
  }

  drawTile(t, now) {
    const ctx = this.ctx;
    const p = this.toScreen(t.i, t.j, t.h);
    let col = this.tileColor(t);
    if (t.water) {
      const k = 0.94 + 0.06 * Math.sin(now / 900 + t.i * 0.7 + t.j * 0.4);
      col = shade(col, k);
    } else if (!t.foreign) {
      col = shade(col, 0.95 + 0.1 * hash(t.i, t.j, 1));
    }
    // costados de las montañas
    if (t.h > 0) {
      const base = this.toScreen(t.i, t.j, 0);
      ctx.fillStyle = shade(LAND[t.region] ?? '#999999', 0.62);
      ctx.beginPath();
      ctx.moveTo(p.x - TW / 2, p.y); ctx.lineTo(p.x, p.y + TH / 2); ctx.lineTo(base.x, base.y + TH / 2); ctx.lineTo(base.x - TW / 2, base.y);
      ctx.fill();
      ctx.fillStyle = shade(LAND[t.region] ?? '#999999', 0.5);
      ctx.beginPath();
      ctx.moveTo(p.x + TW / 2, p.y); ctx.lineTo(p.x, p.y + TH / 2); ctx.lineTo(base.x, base.y + TH / 2); ctx.lineTo(base.x + TW / 2, base.y);
      ctx.fill();
    }
    this.diamond(p.x, p.y, TW / 2, TH / 2);
    ctx.fillStyle = col;
    ctx.fill();
    if (t.h === 2) { // nieve / páramo en los picos
      this.diamond(p.x, p.y, TW / 6, TH / 6);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    }
    if (this.overlay && t.region && t.region !== 'vecino') {
      const v = this.overlay.values[t.region];
      if (v != null) {
        this.diamond(p.x, p.y, TW / 2, TH / 2);
        ctx.fillStyle = ramp(v);
        ctx.globalAlpha = 0.55;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // fronteras entre regiones
    if (t.region) {
      ctx.strokeStyle = t.region === 'vecino' ? 'rgba(120,60,40,0.8)' : 'rgba(40,40,40,0.55)';
      ctx.lineWidth = t.region === 'vecino' ? 2.2 : 1.2;
      const nb = [[0, -1, [p.x - TW / 2, p.y], [p.x, p.y - TH / 2]], [1, 0, [p.x, p.y - TH / 2], [p.x + TW / 2, p.y]],
                  [0, 1, [p.x + TW / 2, p.y], [p.x, p.y + TH / 2]], [-1, 0, [p.x, p.y + TH / 2], [p.x - TW / 2, p.y]]];
      for (const [di, dj, a, b] of nb) {
        const n = this.map.at(t.i + di, t.j + dj);
        if (n && n.region && n.region !== t.region) {
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
      }
    }
    const sel = this.selected && t.region === this.selected;
    const hov = this.hoverTile && t.region && this.hoverTile.region === t.region;
    if (sel || hov) {
      this.diamond(p.x, p.y, TW / 2, TH / 2);
      ctx.fillStyle = sel ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
      ctx.fill();
    }
  }

  box(cx, cy, a, b, h, top, left, right) {
    const ctx = this.ctx;
    ctx.fillStyle = left;
    ctx.beginPath(); ctx.moveTo(cx - a, cy - h); ctx.lineTo(cx, cy + b - h); ctx.lineTo(cx, cy + b); ctx.lineTo(cx - a, cy); ctx.fill();
    ctx.fillStyle = right;
    ctx.beginPath(); ctx.moveTo(cx, cy + b - h); ctx.lineTo(cx + a, cy - h); ctx.lineTo(cx + a, cy); ctx.lineTo(cx, cy + b); ctx.fill();
    ctx.fillStyle = top;
    this.diamond(cx, cy - h, a, b); ctx.fill();
  }

  drawHouse(t, hs) {
    const p = this.toScreen(t.i, t.j, t.h);
    const n = 2;
    for (let k = 0; k < n; k++) {
      const ox = (hash(t.i, t.j, 20 + k) - 0.5) * 22, oy = (hash(t.i, t.j, 30 + k) - 0.5) * 9;
      if (hs.informal) this.box(p.x + ox, p.y + oy, 6, 3, 5, '#9aa3a8', '#b8a98f', '#9c8f78');
      else this.box(p.x + ox, p.y + oy, 7, 3.5, 7, '#c8553d', '#efe6d8', '#d8cdb8');
    }
  }

  drawBuilding(t, s, now, strike) {
    const ctx = this.ctx;
    const p = this.toScreen(t.i, t.j, t.h);
    let g = Math.min(1, (now - s.born) / 900);
    if (g < 0) return;
    if (s.dying) g = Math.max(0, 1 - (now - s.dying) / 1400);
    const sz = s.size * g;
    const col = SECTORS[s.sector].color;
    ctx.globalAlpha = s.dying ? 0.35 + 0.65 * g : 1;
    switch (s.sector) {
      case 'agro': {
        this.diamond(p.x, p.y, TW / 2 - 4, TH / 2 - 2);
        ctx.fillStyle = s.informal ? '#a7b56a' : '#9ccc65';
        ctx.fill();
        ctx.strokeStyle = 'rgba(80,110,40,0.55)'; ctx.lineWidth = 1;
        for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(p.x + k * 6 - 10, p.y - 5 + k * 3 + 5); ctx.lineTo(p.x + k * 6 + 10, p.y + 5 + k * 3 - 5); ctx.stroke(); }
        this.box(p.x + 8, p.y - 2, 6, 3, 7 * g, '#7b241c', '#c0392b', '#962d22');
        break;
      }
      case 'mineria': {
        this.diamond(p.x, p.y, TW / 2 - 8, TH / 2 - 4);
        ctx.fillStyle = '#9e9e8e'; ctx.fill();
        const hgt = 26 * g * Math.min(1.3, sz);
        ctx.strokeStyle = '#37474f'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x - 8, p.y + 2); ctx.lineTo(p.x, p.y - hgt); ctx.lineTo(p.x + 8, p.y + 2); ctx.stroke();
        ctx.lineWidth = 1;
        for (let k = 1; k < 4; k++) { const y = p.y + 2 - (hgt * k) / 4, dx = 8 * (1 - k / 4); ctx.beginPath(); ctx.moveTo(p.x - dx, y); ctx.lineTo(p.x + dx, y); ctx.stroke(); }
        const a = Math.sin(now / 500 + t.i) * 0.4;
        ctx.strokeStyle = '#263238'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(p.x + 10 - 9 * Math.cos(a), p.y - 6 - 9 * Math.sin(a)); ctx.lineTo(p.x + 10 + 9 * Math.cos(a), p.y - 6 + 9 * Math.sin(a)); ctx.stroke();
        break;
      }
      case 'manufactura': {
        const h = (10 + 6 * sz) * g;
        this.box(p.x, p.y, 20 * Math.min(1.2, 0.7 + 0.3 * sz), 10 * Math.min(1.2, 0.7 + 0.3 * sz), h, s.informal ? '#9aa3a8' : '#8d6e63', '#c9b29b', '#a68b74');
        this.box(p.x + 9, p.y - 3, 3, 1.5, h + 14 * g, '#5d4037', '#795548', '#5d4037');
        if (!s.dying && !strike) {
          for (let k = 0; k < 3; k++) {
            const ph = ((now / 1600 + k / 3 + hash(t.i, t.j)) % 1);
            ctx.fillStyle = `rgba(200,200,200,${0.5 * (1 - ph)})`;
            ctx.beginPath(); ctx.arc(p.x + 9 + ph * 10, p.y - 3 - h - 14 - ph * 22, 3 + ph * 5, 0, 7); ctx.fill();
          }
        }
        if (strike) this.flag(p.x - 6, p.y - h - 2, now);
        break;
      }
      case 'tecnologia': {
        const h = (22 + 18 * sz) * g;
        this.box(p.x, p.y, 11, 5.5, h, '#d6ecff', '#5aa9e6', '#3b84c4');
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
        for (let y = 6; y < h - 2; y += 6) {
          ctx.beginPath(); ctx.moveTo(p.x - 11, p.y - y); ctx.lineTo(p.x, p.y + 5.5 - y); ctx.lineTo(p.x + 11, p.y - y); ctx.stroke();
        }
        break;
      }
      default: { // servicios
        const h = (7 + 7 * Math.min(1.6, sz)) * g;
        const a = 9 + 4 * Math.min(1.4, sz);
        if (s.informal) this.box(p.x, p.y, a * 0.8, a * 0.4, h * 0.8, '#9aa3a8', '#b8a98f', '#9c8f78');
        else this.box(p.x, p.y, a, a / 2, h, col, '#efe6d8', '#d6c9b2');
        if (strike && hash(t.i, t.j, 40) < 0.25) this.flag(p.x, p.y - h - 2, now);
      }
    }
    ctx.globalAlpha = 1;
  }

  flag(x, y, now) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 12); ctx.stroke();
    const wv = Math.sin(now / 200 + x) * 1.5;
    ctx.fillStyle = '#e53935';
    ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 8, y - 10 + wv); ctx.lineTo(x, y - 7); ctx.fill();
  }

  drawEffect(e, now) {
    const ctx = this.ctx;
    const k = (now - e.t0) / e.dur;
    if (e.kind === 'fire') {
      const p = this.toScreen(e.tile.i, e.tile.j, e.tile.h);
      this.diamond(p.x, p.y, TW / 2 - 8, TH / 2 - 4);
      ctx.fillStyle = '#3e3a36'; ctx.fill();
      if (k < 0.75) {
        for (let n = 0; n < 6; n++) {
          const ph = (now / 300 + n * 0.37) % 1;
          const x = p.x + (hash(n, e.tile.i) - 0.5) * 22, y = p.y - ph * 26;
          ctx.fillStyle = n % 2 ? `rgba(255,152,0,${1 - ph})` : `rgba(255,235,59,${1 - ph})`;
          ctx.beginPath(); ctx.moveTo(x - 5 * (1 - ph), y); ctx.lineTo(x, y - 12 * (1 - ph) - 4); ctx.lineTo(x + 5 * (1 - ph), y); ctx.fill();
        }
      }
      for (let n = 0; n < 3; n++) {
        const ph = (now / 1400 + n / 3) % 1;
        ctx.fillStyle = `rgba(60,60,60,${0.45 * (1 - ph) * (1 - k)})`;
        ctx.beginPath(); ctx.arc(p.x + ph * 8, p.y - 24 - ph * 30, 5 + ph * 8, 0, 7); ctx.fill();
      }
    } else if (e.kind === 'truck' && e.to) {
      const a = this.toScreen(e.from.i, e.from.j, e.from.h), b = this.toScreen(e.to.i, e.to.j, e.to.h);
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 30;
      ctx.strokeStyle = 'rgba(180,40,40,0.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - 60, b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      this.box(x, y, 8, 4, 6, SECTORS[e.sector].color, '#eeeeee', '#bdbdbd');
    }
  }

  drawRegionMarks(w, now) {
    const ctx = this.ctx;
    for (const r of w.regions) {
      const c = this.map.capitals[r.id];
      const p = this.toScreen(c.i, c.j, c.h);
      let off = 0;
      // Multitudes en las capitales durante un paro.
      if (w.macro.strike > 0) {
        for (let n = 0; n < 14; n++) {
          const x = p.x + (hash(n, r.idx, 50) - 0.5) * 40 + Math.sin(now / 300 + n) * 1.5;
          const y = p.y + (hash(n, r.idx, 51) - 0.5) * 16;
          ctx.fillStyle = ['#e53935', '#fdd835', '#1e88e5', '#fafafa'][n % 4];
          ctx.beginPath(); ctx.arc(x, y - 3, 2.2, 0, 7); ctx.fill();
        }
      }
      // Epidemia: cruz roja que late sobre la capital.
      if (r.sick > 0.02) {
        const s = 1 + 0.15 * Math.sin(now / 250);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath(); ctx.arc(p.x - 16, p.y - 42 - off, 10 * s, 0, 7); ctx.fill();
        ctx.fillStyle = '#d32f2f';
        ctx.fillRect(p.x - 16 - 2 * s, p.y - 42 - off - 7 * s, 4 * s, 14 * s);
        ctx.fillRect(p.x - 16 - 7 * s, p.y - 42 - off - 2 * s, 14 * s, 4 * s);
        off += 0;
      }
      // Crimen alto: sirena intermitente.
      if (r.crime > 1.15 * r.crimeBase) {
        const on = Math.floor(now / 400) % 2 === 0;
        ctx.fillStyle = on ? '#e53935' : '#1e88e5';
        ctx.beginPath(); ctx.arc(p.x + 16, p.y - 40, 6, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(p.x + 14, p.y - 42, 2, 0, 7); ctx.fill();
      }
    }
  }

  // Etiquetas en coordenadas de pantalla para que se lean a cualquier zoom.
  drawLabels(w) {
    const ctx = this.ctx;
    const items = w.regions.map((r) => ({ id: r.id, name: r.name.split(' (')[0], sub: `${Math.round(r.u * 100)}% desempleo · ${r.firms} empresas` }));
    items.push({ id: 'vecino', name: 'País vecino estable', sub: `renta 25% · ${w.relocated.length} empresas que se fueron` });
    ctx.textAlign = 'center';
    const compact = this.cam.z < 0.75; // con el mapa lejos solo cabe el nombre
    for (const it of items) {
      if (compact) it.sub = '';
      const c = this.map.capitals[it.id];
      const q = this.toScreen(c.i, c.j, c.h);
      const x = this.cam.x + q.x * this.cam.z, y = this.cam.y + (q.y - 60) * this.cam.z;
      ctx.font = '600 13px system-ui, sans-serif';
      const wName = ctx.measureText(it.name).width;
      ctx.font = '11px system-ui, sans-serif';
      const wSub = ctx.measureText(it.sub).width;
      const bw = Math.max(wName, wSub) + 16;
      const sel = this.selected === it.id;
      ctx.fillStyle = sel ? 'rgba(25,60,120,0.92)' : 'rgba(20,24,28,0.72)';
      roundRect(ctx, x - bw / 2, y - 18, bw, compact ? 21 : 34, 7);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText(it.name, x, y - 3);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(it.sub, x, y + 11);
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { ramp };

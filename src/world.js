// Geography: grid, terrain, coastlines, rivers, static climate fields, resources, wild species.
import { RNG, makeNoise, clamp } from './rng.js';

export const R_EARTH = 6371;
export const LAPSE = 6.5;              // degC per km, standard atmosphere

// Wild progenitors of crops. Niches are annual-mean temperature (C) and precipitation (mm).
// yield = attainable grain-equivalent kg/ha/yr for early unimproved cultivars (archaeobotanical estimates)
export const CROPS = [
  { id: 'wheat',   name: 'winter cereals',    T: [6, 20],  P: [250, 900],  yield: 900,  kcal: 3400, rarity: 0.55 },
  { id: 'millet',  name: 'millets',           T: [6, 24],  P: [300, 1000], yield: 800,  kcal: 3600, rarity: 0.60 },
  { id: 'rice',    name: 'paddy grain',       T: [16, 29], P: [1000, 3000],yield: 1200, kcal: 3600, rarity: 0.62 },
  { id: 'maize',   name: 'maize-like grass',  T: [13, 27], P: [450, 1600], yield: 700,  kcal: 3600, rarity: 0.70, lateYield: 3 },
  { id: 'sorghum', name: 'savanna grains',    T: [19, 30], P: [300, 1000], yield: 700,  kcal: 3300, rarity: 0.60 },
  { id: 'tuber',   name: 'highland tubers',   T: [4, 16],  P: [500, 1500], yield: 2500, kcal: 770,  rarity: 0.68, minElev: 1500 },
  { id: 'yam',     name: 'tropical roots',    T: [20, 30], P: [1100, 4000],yield: 2500, kcal: 1100, rarity: 0.58 },
];
// Wild progenitors of domesticable animals (Diamond's "Anna Karenina" list, abstracted)
export const ANIMALS = [
  { id: 'caprine', name: 'sheep & goats', T: [3, 25],  P: [150, 900],  rarity: 0.55, draft: 0, dairy: 1, mount: 0 },
  { id: 'cattle',  name: 'cattle',        T: [0, 28],  P: [300, 1600], rarity: 0.55, draft: 1, dairy: 1, mount: 0 },
  { id: 'pig',     name: 'pigs',          T: [2, 28],  P: [500, 2500], rarity: 0.55, draft: 0, dairy: 0, mount: 0 },
  { id: 'horse',   name: 'horses',        T: [-6, 15], P: [200, 700],  rarity: 0.55, draft: 1, dairy: 1, mount: 1 },
  { id: 'camelid', name: 'camelids',      T: [-2, 16], P: [100, 900],  rarity: 0.62, draft: 0, dairy: 0, mount: 0, minElev: 2200 },
  { id: 'camel',   name: 'camels',        T: [14, 30], P: [30, 350],   rarity: 0.55, draft: 1, dairy: 1, mount: 1 },
  { id: 'fowl',    name: 'fowl',          T: [19, 30], P: [1000, 3500],rarity: 0.55, draft: 0, dairy: 0, mount: 0 },
];
export const ORES = ['copper', 'tin', 'iron', 'gold', 'salt'];

export class World {
  constructor(opts) {
    const { W, H, seed, kind } = opts;
    this.W = W; this.H = H; this.N = W * H; this.seed = seed; this.kind = kind;
    const N = this.N;
    this.lat = new Float32Array(N); this.lon = new Float32Array(N); this.area = new Float32Array(N);
    this.x = new Int16Array(N); this.y = new Int16Array(N);
    const dφ = Math.PI / H, dλ = 2 * Math.PI / W;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; this.x[i] = x; this.y[i] = y;
      this.lat[i] = 90 - (y + 0.5) * 180 / H; this.lon[i] = -180 + (x + 0.5) * 360 / W;
      const φ1 = Math.PI / 2 - y * dφ, φ2 = φ1 - dφ;
      this.area[i] = R_EARTH * R_EARTH * dλ * (Math.sin(φ1) - Math.sin(φ2));
    }
    // 8-neighbourhood with east-west wrap
    this.nbr = new Int32Array(N * 8).fill(-1); this.nbrDist = new Float32Array(N * 8);
    for (let i = 0; i < N; i++) {
      const x = this.x[i], y = this.y[i]; let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const yy = y + dy; const xx = (x + dx + W) % W;
        if (yy >= 0 && yy < H) { const j = yy * W + xx; this.nbr[i * 8 + k] = j; this.nbrDist[i * 8 + k] = this.dist(i, j); }
        k++;
      }
    }
    this.elev = new Float32Array(N);
    this.seaLevel = 0;
    this.land = new Uint8Array(N);
    this.distOcean = new Float32Array(N);
    this.Tbase = new Float32Array(N); this.Pbase = new Float32Array(N); this.amp = new Float32Array(N);
    this.Pmonsoon = new Float32Array(N); this.dEq = new Float32Array(N); this.amocW = new Float32Array(N); this.ensoW = new Float32Array(N);
    this.rough = new Float32Array(N); this.arable = new Float32Array(N);
    this.flowTo = new Int32Array(N); this.discharge = new Float32Array(N);
    this.ore = {}; for (const o of ORES) this.ore[o] = new Float32Array(N);
    this.cropWild = new Uint8Array(N * CROPS.length); this.animalWild = new Uint8Array(N * ANIMALS.length);
    this.moveCost = new Float32Array(N);
    this.modes = []; // regional precipitation modes (spatial patterns)
  }
  idx(x, y) { return y * this.W + ((x % this.W) + this.W) % this.W; }
  dist(i, j) { // great-circle km
    const p1 = this.lat[i] * Math.PI / 180, p2 = this.lat[j] * Math.PI / 180;
    const dl = (this.lon[j] - this.lon[i]) * Math.PI / 180;
    const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
    return R_EARTH * Math.acos(clamp(c, -1, 1));
  }
  cellName(i) { const la = this.lat[i], lo = this.lon[i]; return `${Math.abs(la).toFixed(0)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(0)}°${lo >= 0 ? 'E' : 'W'}`; }

  // ---------- terrain ----------
  loadEarth(data) {
    for (let i = 0; i < this.N; i++) this.elev[i] = data.elev[i];
    this.finishTerrain();
  }
  generate() {
    const nz = makeNoise(this.seed), nz2 = makeNoise(this.seed * 31 + 7);
    const raw = new Float32Array(this.N);
    const rng = new RNG(this.seed + 99);
    // a few "plate" centres give continents coherent shapes
    const plates = []; for (let k = 0; k < 9; k++) {
      const z = rng.range(-0.85, 0.85), th = rng.range(0, Math.PI * 2), r = Math.sqrt(1 - z * z);
      plates.push({ v: [r * Math.cos(th), r * Math.sin(th), z], cont: rng.chance(0.45) ? rng.range(0.2, 0.55) : rng.range(-0.45, -0.1) });
    }
    for (let i = 0; i < this.N; i++) {
      const φ = this.lat[i] * Math.PI / 180, λ = this.lon[i] * Math.PI / 180;
      const p = [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
      // nearest & second-nearest plate -> boundaries become mountain belts
      let b1 = -9, b2 = -9, pl = null;
      for (const P of plates) { const d = p[0] * P.v[0] + p[1] * P.v[1] + p[2] * P.v[2]; if (d > b1) { b2 = b1; b1 = d; pl = P; } else if (d > b2) b2 = d; }
      const boundary = Math.exp(-(((b1 - b2) / 0.05) ** 2));
      const base = pl.cont + 0.55 * nz.fbm(p[0] * 1.7 + 5, p[1] * 1.7, p[2] * 1.7, 6);
      const ridged = 1 - Math.abs(nz2.fbm(p[0] * 3.5, p[1] * 3.5, p[2] * 3.5, 4));
      raw[i] = base + boundary * 0.25 * ridged * (pl.cont > 0 ? 1 : 0.5) + 0.12 * ridged * ridged * Math.max(0, base);
    }
    const sorted = Array.from(raw).sort((a, b) => a - b);
    const thr = sorted[Math.floor(this.N * 0.69)], mx = sorted[this.N - 1], mn = sorted[0];
    for (let i = 0; i < this.N; i++) {
      const r = raw[i];
      this.elev[i] = r > thr ? 20 + Math.pow((r - thr) / (mx - thr), 1.6) * 6000 : -Math.pow((thr - r) / (thr - mn), 0.8) * 5000;
    }
    this.finishTerrain();
  }
  finishTerrain() {
    const N = this.N;
    for (let i = 0; i < N; i++) {
      let s = 0, n = 0; for (let k = 0; k < 8; k++) { const j = this.nbr[i * 8 + k]; if (j >= 0) { s += Math.abs(this.elev[j] - this.elev[i]); n++; } }
      this.rough[i] = s / n;
    }
    this.placeResources();
  }
  placeResources() {
    const rng = new RNG(this.seed * 17 + 3), nz = makeNoise(this.seed * 5 + 1);
    const thr = { copper: 0.18, tin: 0.42, iron: 0.08, gold: 0.33, salt: 0.25 };
    ORES.forEach((o, k) => {
      for (let i = 0; i < this.N; i++) {
        const φ = this.lat[i] * Math.PI / 180, λ = this.lon[i] * Math.PI / 180;
        const v = nz.fbm(Math.cos(φ) * Math.cos(λ) * 6 + k * 3.1, Math.cos(φ) * Math.sin(λ) * 6, Math.sin(φ) * 6, 3);
        const mount = clamp(this.rough[i] / 900 + this.elev[i] / 4000, 0, 1);
        const bias = o === 'salt' ? 0.15 : mount * 0.35;
        this.ore[o][i] = v + bias > thr[o] ? 1 : 0;
      }
    });
  }

  // ---------- coastlines & static climate ----------
  applySeaLevel(sl) {
    this.seaLevel = sl; let changed = 0;
    for (let i = 0; i < this.N; i++) { const l = this.elev[i] > sl ? 1 : 0; if (l !== this.land[i]) { changed++; this.land[i] = l; } }
    return changed;
  }
  computeStatic() {
    const N = this.N, W = this.W, H = this.H;
    // distance to ocean (Dijkstra over neighbour graph)
    const d = this.distOcean; d.fill(1e9); const heap = new MinHeap();
    for (let i = 0; i < N; i++) if (!this.land[i]) { d[i] = 0; heap.push(i, 0); }
    while (heap.size) {
      const [i, di] = heap.pop(); if (di > d[i]) continue;
      for (let k = 0; k < 8; k++) { const j = this.nbr[i * 8 + k]; if (j < 0) continue; const nd = di + this.nbrDist[i * 8 + k]; if (nd < d[j]) { d[j] = nd; heap.push(j, nd); } }
    }
    // Moisture availability: advect a moisture index from the ocean along prevailing winds
    // (Hadley/Ferrel/polar cells) and along the secondary (monsoonal / western-boundary) direction.
    // Continental moisture decays with e-folding ~2500 km (moisture-recycling length scale);
    // uplift over mountains rains moisture out on the windward side (rain shadows emerge).
    const qMain = new Float32Array(N), qOpp = new Float32Array(N), upOcean = new Float32Array(N);
    const pass = (y, dir, out, track) => {
      let q = 1, prevE = 0, since = 0;
      const la = 90 - (y + 0.5) * 180 / H;
      for (let s = 0; s < 2 * W; s++) {
        const x = ((dir > 0 ? s : -s) % W + W) % W; const i = y * W + x;
        const stepKm = 111.2 * 360 / W * Math.cos(la * Math.PI / 180);
        if (!this.land[i]) { q = 1; prevE = 0; since = 0; continue; }
        since += stepKm;
        const e = Math.max(0, this.elev[i]); const lift = Math.max(0, e - prevE) / 1000;
        q *= Math.exp(-stepKm / (2500 + 3500 * Math.exp(-((la / 15) ** 2)))) * (1 - Math.min(0.7, 0.3 * lift));
        if (s >= W) { out[i] = q * (1 + 1.2 * lift); if (track) upOcean[i] = since; }
        prevE = e;
      }
    };
    for (let y = 0; y < H; y++) {
      const a = Math.abs(90 - (y + 0.5) * 180 / H);
      const dir = (a < 30 || a > 62) ? -1 : 1;
      pass(y, dir, qMain, true); pass(y, -dir, qOpp, false);
    }
    // equatorward distance to ocean (monsoon inflow path)
    const dEq = this.dEq; dEq.fill(0);
    for (let i = 0; i < N; i++) {
      if (!this.land[i]) continue; const step = this.lat[i] >= 0 ? 1 : -1; let y = this.y[i], dkm = 0;
      while (true) { y += step; if (y < 0 || y >= H) { dkm = 1e4; break; } dkm += 111.2 * 180 / H; if (!this.land[y * W + this.x[i]]) break; if (dkm > 5000) break; }
      dEq[i] = dkm;
    }
    const P = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (!this.land[i]) continue;
      const la = this.lat[i], a = Math.abs(la);
      // observed zonal-mean precipitation profile (ITCZ, subtropical dry belts, storm tracks, polar desert)
      const Z = (120 + 2100 * Math.exp(-(((la - 3) / 13) ** 2)) + 750 * Math.exp(-(((a - 48) / 13) ** 2)) - 80 * clamp((a - 70) / 20, 0, 1)) * (1 - 0.7 * Math.exp(-(((a - 24) / 7) ** 2)));
      const wOpp = a > 20 && a < 48 ? 0.75 : 0.35;
      const q = Math.max(qMain[i], wOpp * qOpp[i], 0.55 * Math.exp(-d[i] / 900));
      P[i] = Math.max(15, Z * q);
    }
    let A = P;
    for (let it = 0; it < 2; it++) {
      const B = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        if (!this.land[i]) continue; let s = A[i] * 3, n = 3;
        for (let k = 0; k < 8; k++) { const j = this.nbr[i * 8 + k]; if (j >= 0 && this.land[j]) { s += A[j]; n++; } }
        B[i] = s / n;
      }
      A = B;
    }
    for (let i = 0; i < N; i++) {
      const la = this.lat[i], a = Math.abs(la);
      const cont = 1 - Math.exp(-d[i] / 700), contUp = 1 - Math.exp(-upOcean[i] / 900);
      this.Pbase[i] = this.land[i] ? A[i] : 0;
      // annual-mean temperature: radiative latitude profile, lapse rate, continental winter cooling
      this.Tbase[i] = 29 - 52 * Math.pow(a / 90, 1.9) - LAPSE * Math.max(0, this.elev[i]) / 1000 - cont * 16 * Math.pow(a / 90, 1.5) - (la < 0 ? 11 * clamp((a - 55) / 15, 0, 1) : 0); // southern polar ice-sheet chill
      this.amp[i] = (1.5 + 24 * Math.pow(a / 90, 1.1)) * (0.3 + 0.7 * Math.max(cont, contUp * 0.9));
      // summer monsoon: land-sea thermal contrast drawing ocean moisture inland in the tropics/subtropics
      // monsoon potential; inland reach and strength are set each year by orbital forcing (climate.js)
      this.Pmonsoon[i] = this.land[i] ? 1700 * Math.exp(-((a - 18) ** 2) / (2 * 8 * 8)) * (la > 0 ? 1 : 0.6) : 0;
      // ocean overturning teleconnection: high-latitude NH land downwind of the ocean
      this.amocW[i] = this.land[i] && la > 35 ? Math.exp(-upOcean[i] / 2500) * clamp((la - 35) / 20, 0, 1) * (this.kind === 'earth' ? (this.lon[i] > -100 && this.lon[i] < 70 ? 1 : 0.25) : 1) : 0;
      // ENSO-like teleconnection: tropical land near ocean
      this.ensoW[i] = this.land[i] && a < 30 ? Math.exp(-d[i] / 900) * Math.cos(a / 30 * Math.PI / 2) : 0;
      this.arable[i] = clamp(0.42 - this.rough[i] / 2200 - Math.max(0, this.elev[i] - 2500) / 6000, 0.02, 0.42);
    }
    this.computeRivers();
    this.computeMoveCost();
  }
  computeMoveCost() {
    for (let i = 0; i < this.N; i++) {
      const P = this.Pbase[i], T = this.Tbase[i];
      this.moveCost[i] = 1 + this.rough[i] / 600 + Math.max(0, this.elev[i] - 2000) / 1500 + (P < 150 ? 1.5 : 0) + (P > 2000 && T > 20 ? 1 : 0) + (this.discharge[i] > 300 ? -0.3 : 0);
    }
  }
  computeRivers() {
    const N = this.N, filled = new Float32Array(N), done = new Uint8Array(N), heap = new MinHeap(), order = [];
    for (let i = 0; i < N; i++) if (!this.land[i]) { filled[i] = this.elev[i]; done[i] = 1; heap.push(i, filled[i]); }
    // priority-flood: depression filling so every land cell drains to the sea
    while (heap.size) {
      const [i] = heap.pop(); if (this.land[i]) order.push(i);
      for (let k = 0; k < 8; k++) { const j = this.nbr[i * 8 + k]; if (j < 0 || done[j]) continue; done[j] = 1; filled[j] = Math.max(this.elev[j], filled[i] + 0.01); heap.push(j, filled[j]); this.flowTo[j] = i; }
    }
    this.flowTo.fill(-1);
    for (let i = 0; i < N; i++) {
      if (!this.land[i]) continue; let best = -1, be = filled[i];
      for (let k = 0; k < 8; k++) { const j = this.nbr[i * 8 + k]; if (j >= 0 && filled[j] < be) { be = filled[j]; best = j; } }
      this.flowTo[i] = best;
    }
    this.discharge.fill(0);
    for (let n = order.length - 1; n >= 0; n--) {
      const i = order[n];
      this.discharge[i] += this.runoff(i) * this.area[i] * 1e3 / 3.156e7; // mm*km2 -> m3/s
      const j = this.flowTo[i]; if (j >= 0 && this.land[j]) this.discharge[j] += this.discharge[i];
    }
  }
  runoff(i, P = this.Pbase[i], T = this.Tbase[i]) {
    // Budyko curve (Fu's form) partitions rain into evapotranspiration and runoff
    const PET = T > 0 ? 250 + 55 * T : 250 * Math.exp(0.1 * T);
    if (P <= 0) return 0; const phi = PET / P;
    const etr = Math.sqrt(phi * Math.tanh(1 / phi) * (1 - Math.exp(-phi)));
    return Math.max(0, P * (1 - etr));
  }
  placeWildSpecies() {
    // Wild progenitors occur in climatically suitable patches; patchiness from noise.
    const nz = makeNoise(this.seed * 13 + 5);
    const sample = (i, k, scale) => { const φ = this.lat[i] * Math.PI / 180, λ = this.lon[i] * Math.PI / 180; return 0.5 + 0.5 * nz.fbm(Math.cos(φ) * Math.cos(λ) * scale + k * 7.3, Math.cos(φ) * Math.sin(λ) * scale, Math.sin(φ) * scale, 3); };
    const niche = (sp, i) => {
      const T = this.Tbase[i], P = this.Pbase[i] + this.Pmonsoon[i] * 0.5 * Math.exp(-this.dEq[i] / 600);
      if (!this.land[i]) return 0; if (sp.minElev && this.elev[i] < sp.minElev) return 0;
      const ft = (T - sp.T[0]) / (sp.T[1] - sp.T[0]), fp = (Math.log(P + 1) - Math.log(sp.P[0])) / (Math.log(sp.P[1]) - Math.log(sp.P[0]));
      if (ft < 0 || ft > 1 || fp < 0 || fp > 1) return 0;
      return Math.sin(ft * Math.PI) * Math.sin(fp * Math.PI);
    };
    CROPS.forEach((c, k) => { for (let i = 0; i < this.N; i++) this.cropWild[i * CROPS.length + k] = niche(c, i) > 0.3 && sample(i, k, 3.5) > c.rarity ? 1 : 0; });
    ANIMALS.forEach((a, k) => { for (let i = 0; i < this.N; i++) this.animalWild[i * ANIMALS.length + k] = niche(a, i) > 0.25 && sample(i, k + 20, 3) > a.rarity ? 1 : 0; });
  }
  cropNiche(c, i, T, P) { // suitability 0..1 for a cultivated crop given current climate
    if (c.minElev && this.elev[i] < c.minElev * 0.6) return 0;
    const ft = (T - c.T[0] + 2) / (c.T[1] - c.T[0] + 4); if (ft <= 0 || ft >= 1) return 0;
    const fp = (Math.log(P + 1) - Math.log(c.P[0] * 0.8)) / (Math.log(c.P[1] * 1.3) - Math.log(c.P[0] * 0.8));
    const st = Math.min(1, Math.sin(ft * Math.PI) * 1.6);
    const sp = fp <= 0 ? 0 : fp >= 1 ? 0.6 : Math.min(1, Math.sin(fp * Math.PI) * 1.6);
    return st * sp;
  }
}

export class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) { const k = this.k, v = this.v; k.push(key); v.push(val); let i = k.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (v[p] <= v[i]) break; [k[p], k[i]] = [k[i], k[p]];[v[p], v[i]] = [v[i], v[p]]; i = p; } }
  pop() {
    const k = this.k, v = this.v; const r = [k[0], v[0]]; const lk = k.pop(), lv = v.pop();
    if (k.length) { k[0] = lk; v[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < k.length && v[l] < v[m]) m = l; if (rr < k.length && v[rr] < v[m]) m = rr; if (m === i) break; [k[m], k[i]] = [k[i], k[m]];[v[m], v[i]] = [v[i], v[m]]; i = m; } }
    return r;
  }
}

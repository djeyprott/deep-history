// Seeded PRNG (sfc32) + statistical helpers. All randomness in the sim flows through here
// so runs are reproducible from a seed.
export class RNG {
  constructor(seed = 1) {
    this.a = 0x9e3779b9 ^ seed; this.b = 0x243f6a88 ^ (seed * 7); this.c = 0xb7e15162 ^ (seed * 13); this.d = seed | 1;
    for (let i = 0; i < 20; i++) this.next();
  }
  next() {
    let { a, b, c, d } = this;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (t >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  normal(m = 0, s = 1) {
    let u = 0, v = 0; while (u === 0) u = this.next(); v = this.next();
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  weighted(arr, wfn) {
    let tot = 0; const ws = arr.map(x => { const w = Math.max(0, wfn(x)); tot += w; return w; });
    if (tot <= 0) return null;
    let r = this.next() * tot;
    for (let i = 0; i < arr.length; i++) { r -= ws[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  }
  poisson(l) {
    if (l <= 0) return 0;
    if (l > 30) return Math.max(0, Math.round(this.normal(l, Math.sqrt(l))));
    const L = Math.exp(-l); let k = 0, p = 1;
    do { k++; p *= this.next(); } while (p > L);
    return k - 1;
  }
  binomial(n, p) {
    if (n <= 0 || p <= 0) return 0; if (p >= 1) return n;
    if (n > 50) return Math.min(n, Math.max(0, Math.round(this.normal(n * p, Math.sqrt(n * p * (1 - p))))));
    let k = 0; for (let i = 0; i < n; i++) if (this.next() < p) k++; return k;
  }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
}

export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
export const lerp = (a, b, t) => a + (b - a) * t;
export const sigmoid = x => 1 / (1 + Math.exp(-x));

// 3D value noise for seamless spherical maps
export function makeNoise(seed) {
  const perm = new Uint16Array(512); const r = new RNG(seed);
  const p = [...Array(256).keys()]; r.shuffle(p);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256); for (let i = 0; i < 256; i++) vals[i] = r.next() * 2 - 1;
  const h = (x, y, z) => vals[perm[(perm[(perm[x & 255] + y) & 511] + z) & 511] & 255];
  const s = t => t * t * (3 - 2 * t);
  function n3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = s(x - xi), yf = s(y - yi), zf = s(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf), zf);
  }
  function fbm(x, y, z, oct = 5, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * n3(x * f, y * f, z * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
  return { n3, fbm };
}

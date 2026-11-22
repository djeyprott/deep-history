// Cultures, languages and religions as emergent identities carried by populations.
// They split when sub-populations drift apart (dialect continua break up, isolated groups diverge),
// and spread by language shift (Abrams–Strogatz, a=1.31), assimilation and religious conversion.
import { clamp } from './rng.js';
import { Language } from './language.js';
import { NTR, NDIA } from './pops.js';

const AS_A = 1.31; // Abrams & Strogatz (2003) volatility exponent fitted to real language-death data

function hsl(h, s, l) { const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return [f(0), f(8), f(4)]; }
export function randColor(rng) { return hsl(rng.range(0, 360), rng.range(0.45, 0.8), rng.range(0.4, 0.62)); }

export function makeLanguage(sim, parent = null) {
  const L = new Language(sim.nextId++, sim.rng, parent, sim.year);
  L.name = (parent && sim.rng.chance(0.3) ? 'New ' : '') + L.ethnonym() + sim.rng.pick(['an', 'ic', 'ese', 'i', 'ian', 'ish']);
  L.color = parent ? shade(parent.color, sim.rng) : randColor(sim.rng); L.n = 0; L.dead = null; L.centroid = new Float32Array(NDIA);
  sim.languages.set(L.id, L);
  if (parent) sim.logEvent('language', `${L.name} diverges from ${parent.name} as a distinct language`, { lang: L.id });
  return L;
}
function shade(c, rng) { return c.map(v => clamp(Math.round(v + rng.normal(0, 28)), 20, 235)); }

export function makeCulture(sim, langId, parent = null, tr = null) {
  const L = sim.languages.get(langId);
  const C = { id: sim.nextId++, name: L.ethnonym(), lang: langId, parent: parent ? parent.id : null, born: sim.year, dead: null,
    color: parent ? shade(parent.color, sim.rng) : randColor(sim.rng), centroid: tr ? Float32Array.from(tr) : new Float32Array(NTR), n: 0, cells: 0, folk: null };
  if (parent && C.name === parent.name) C.name = L.ethnonym() + 'a';
  sim.cultures.set(C.id, C);
  if (parent) sim.logEvent('culture', `The ${C.name} emerge as a distinct people, splitting from the ${parent.name}`, { cul: C.id });
  return C;
}

export function makeReligion(sim, opts) {
  const R = { id: sim.nextId++, born: sim.year, dead: null, n: 0, cells: 0, church: null, holy: opts.holy ?? -1, parent: opts.parent ?? null, founder: opts.founder ?? null,
    type: opts.type, tenets: opts.tenets, folkOf: opts.folkOf ?? null, name: opts.name, deity: opts.deity, color: opts.color || randColor(sim.rng), peak: 0 };
  sim.religions.set(R.id, R);
  return R;
}
export function folkReligion(sim, C) {
  const L = sim.languages.get(C.lang);
  const R = makeReligion(sim, { type: 'animist', folkOf: C.id, name: `${C.name} spirit-ways`, deity: L.word('spirit'), color: shade(C.color, sim.rng),
    tenets: { prosel: 0, excl: 0.05, hier: 0.05, moral: 0.1, ascet: sim.rng.range(0, 0.3), pacif: sim.rng.range(0, 0.4), ritual: sim.rng.range(0.2, 0.7), afterlife: sim.rng.range(0, 0.6) } });
  C.folk = R.id; return R;
}

// language internal change every year
export function languageChange(sim) {
  for (const L of sim.languages.values()) {
    if (L.dead || L.n <= 0) continue;
    if (sim.rng.chance(1 / 220)) { const d = L.soundChange(); if (L.n > 200000 && sim.rng.chance(0.15)) sim.logEvent('language', `${L.name}: ${d}`, { lang: L.id }); }
    // glottochronology: ~86% retention of core vocabulary per millennium -> 1.5e-4 per word-year
    const k = sim.rng.poisson(1.5e-4 * 70);
    for (let i = 0; i < k; i++) { const donor = L._contact && sim.rng.chance(0.35) ? sim.languages.get(L._contact) : null; L.replaceWord(donor && !donor.dead ? donor : null); }
    L._contact = null;
  }
}

// shift of language, culture, religion between neighbouring populations
export function identityDiffusion(sim) {
  const rng = sim.rng;
  for (const p of sim.pops.values()) {
    const q = sim.randomContact(p); if (!q) continue;
    const share = q.n / (q.n + p.n);
    const owner = sim.owner[p.c] >= 0 ? sim.orgs.get(sim.owner[p.c]) : null;
    // --- language shift
    if (q.lang !== p.lang) {
      const Lp = sim.languages.get(p.lang); if (Lp) Lp._contact = q.lang;
      const st = l => 1 + (owner && owner.lang === l ? 2 : 0) + (sim.cellUrbanLang[p.c] === l ? 0.5 : 0);
      const sq = st(q.lang), sp = st(p.lang), s = sq / (sq + sp);
      const rate = 0.012 * Math.pow(share, AS_A) * s * (1 + 0.5 * p.tr[4]);
      if (rng.chance(rate)) { p.lang = q.lang; const L = sim.languages.get(q.lang); if (L) p.dia.set(L.centroid); }
    }
    // --- cultural assimilation
    if (q.cul !== p.cul) {
      const st = cu => 1 + (owner && owner.cul === cu ? 1.5 : 0);
      const s = st(q.cul) / (st(q.cul) + st(p.cul));
      if (rng.chance(0.005 * Math.pow(share, AS_A) * s * (1 + 0.6 * p.tr[4] - 0.5 * p.tr[5]))) {
        const C = sim.cultures.get(q.cul); p.cul = q.cul; if (C) for (let k = 0; k < NTR; k++) p.tr[k] = 0.5 * p.tr[k] + 0.5 * C.centroid[k];
      }
    }
    // --- religious conversion
    if (q.rel !== p.rel) {
      const Rq = sim.religions.get(q.rel), Rp = sim.religions.get(p.rel); if (!Rq || !Rp) continue;
      const aq = appeal(sim, Rq, p, owner), ap = appeal(sim, Rp, p, owner);
      let rate = 0.02 * Math.pow(share, AS_A) * aq / (aq + ap) * (1 - 0.75 * Rp.tenets.excl) * (1 - 0.4 * p.tr[5]);
      if (Rq.folkOf !== null && Rq.folkOf !== p.cul) rate *= 0.15; // folk religions are tied to their people
      if (Rq.tenets.prosel > 0.5) rate *= 1 + Rq.tenets.prosel;
      if (rng.chance(rate)) convertPop(sim, p, Rq.id);
    }
  }
}
export function appeal(sim, R, p, owner) {
  const t = R.tenets;
  let a = 1 + 0.8 * t.prosel + 0.6 * t.moral * Math.max(0, p.tr[0]) + 0.5 * t.afterlife * p.crisis;
  if (owner && owner.rel === R.id) a += 1.5 * (owner.level >= 2 ? 1 : 0.5);
  if (sim.year - R.born < 300 && p.crisis > 0.3) a += 1; // new movements thrive in hard times
  a += 0.5 * (1 - Math.abs(t.pacif - (0.5 - p.tr[2] / 2))) + 0.3 * (p.tr[3] > 0 ? t.ritual : -t.ritual);
  return Math.max(0.1, a);
}
export function convertPop(sim, p, rid) { p.rel = rid; }

// periodic bookkeeping and splitting
export function identityUpdate(sim) {
  const w = sim.world;
  for (const C of sim.cultures.values()) { C.n = 0; C.cells = 0; C._sum = new Float64Array(NTR); C._pops = []; }
  for (const L of sim.languages.values()) { L.n = 0; L._sum = new Float64Array(NDIA); L._pops = []; }
  for (const R of sim.religions.values()) { R.n = 0; R._cells = new Set(); }
  for (const p of sim.pops.values()) {
    const C = sim.cultures.get(p.cul); if (C) { C.n += p.n; C._pops.push(p); for (let k = 0; k < NTR; k++) C._sum[k] += p.tr[k] * p.n; }
    const L = sim.languages.get(p.lang); if (L) { L.n += p.n; L._pops.push(p); for (let k = 0; k < NDIA; k++) L._sum[k] += p.dia[k] * p.n; }
    const R = sim.religions.get(p.rel); if (R) { R.n += p.n; R._cells.add(p.c); }
  }
  for (const C of sim.cultures.values()) {
    if (C.n > 0) { for (let k = 0; k < NTR; k++) C.centroid[k] = C._sum[k] / C.n; C.cells = new Set(C._pops.map(p => p.c)).size; const lc = {}; for (const p of C._pops) lc[p.lang] = (lc[p.lang] || 0) + p.n; C.lang = +Object.entries(lc).sort((a, b) => b[1] - a[1])[0][0]; }
    else if (!C.dead) { C.dead = sim.year; sim.logEvent('culture', `The ${C.name} have vanished as a distinct people`, { cul: C.id }); }
  }
  for (const L of sim.languages.values()) {
    if (L.n > 0) for (let k = 0; k < NDIA; k++) L.centroid[k] = L._sum[k] / L.n;
    else if (!L.dead) { L.dead = sim.year; if (L.peak > 50000) sim.logEvent('language', `${L.name} is no longer spoken`, { lang: L.id }); }
    L.peak = Math.max(L.peak || 0, L.n);
  }
  for (const R of sim.religions.values()) {
    R.cells = R._cells.size; R.peak = Math.max(R.peak, R.n);
    if (R.n === 0 && !R.dead) { R.dead = sim.year; if (R.peak > 100000) sim.logEvent('religion', `${R.name} has no remaining adherents`, { rel: R.id }); }
  }
  // splits (only when the sub-group is substantial and geographically coherent)
  for (const C of [...sim.cultures.values()]) if (C.n > 0) trySplit(sim, C, C._pops, 'tr', 0.6, (seed, members) => {
    const N = makeCulture(sim, seed.lang, C, seed.tr);
    const R = sim.religions.get(C.folk); let newFolk = null;
    for (const p of members) { p.cul = N.id; if (C.folk !== null && p.rel === C.folk) { if (!newFolk) { newFolk = folkReligion(sim, N); newFolk.parent = C.folk; } p.rel = newFolk.id; } }
  });
  for (const L of [...sim.languages.values()]) if (L.n > 0) trySplit(sim, L, L._pops, 'dia', 0.26, (seed, members) => {
    const N = makeLanguage(sim, L); N.centroid.set(seed.dia); for (const p of members) p.lang = N.id;
  });
}
function trySplit(sim, E, pops, field, thr, make) {
  if (pops.length < 3) return;
  const cen = E.centroid; const dist = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += (a[k] - b[k]) ** 2; return Math.sqrt(s); };
  let far = null, fd = thr;
  for (const p of pops) { const d = dist(p[field], cen); if (d > fd && p.n > 300) { fd = d; far = p; } }
  if (!far) return;
  const seedV = Float32Array.from(far[field]);
  const members = pops.filter(p => dist(p[field], seedV) < dist(p[field], cen) && sim.world.dist(p.c, far.c) < 2500);
  const mn = members.reduce((s, p) => s + p.n, 0);
  if (mn < 1500 || members.length === pops.length) return;
  make(far, members);
}

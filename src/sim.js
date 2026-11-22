// The simulation: owns state and runs one year at a time.
import { RNG, clamp } from './rng.js';
import { World, CROPS, ANIMALS } from './world.js';
import { Climate } from './climate.js';
import { NT, TI, TECHS, techLevel } from './tech.js';
import * as P from './pops.js';
import * as ID from './identity.js';
import { diseases, spawnPlague } from './disease.js';
import * as POL from './politics.js';
import { resetCognates } from './language.js';

export class Sim {
  constructor({ kind = 'earth', seed = 1, startYear = -15000, earthData = null, W = 240, H = 120 }) {
    this.seed = seed; this.kind = kind; this.rng = new RNG(seed); this.year = startYear; this.startYear = startYear;
    this.nextId = 1; resetCognates(1);
    const w = this.world = kind === 'earth' ? new World({ W: earthData.W, H: earthData.H, seed, kind }) : new World({ W, H, seed, kind });
    if (kind === 'earth') w.loadEarth(earthData); else w.generate();
    // wild species are placed using the modern-baseline climate, then the start-date climate is applied
    w.applySeaLevel(0); w.computeStatic(); w.placeWildSpecies();
    this.climate = new Climate(w, seed, startYear);
    w.applySeaLevel(this.climate.seaLevel); w.computeStatic();
    this.climate.step(startYear);
    const N = w.N;
    this.pops = new Map(); this.cellPops = Array.from({ length: N }, () => []);
    this.cultures = new Map(); this.languages = new Map(); this.religions = new Map(); this.diseases = new Map();
    this.persons = new Map(); this.orgs = new Map(); this.dynasties = new Map(); this.wars = new Map();
    this.game = new Float32Array(N); this.gameK = new Float32Array(N); this.fish = new Float32Array(N); this.fishK = new Float32Array(N);
    this.soil = new Float32Array(N).fill(1); this.cleared = new Float32Array(N); this.openLand = new Float32Array(N); this.salt = new Float32Array(N);
    this.farmShareLand = new Float32Array(N); this.pastureShare = new Float32Array(N);
    this.faunaMult = new Float32Array(N).fill(1); this.overkill = new Uint16Array(N);
    this.naive = new Uint8Array(N); this.naiveYears = new Uint16Array(N); this.everSettled = new Uint8Array(N);
    this.owner = new Int32Array(N).fill(-1); this.control = new Float32Array(N);
    this.cellN = new Float64Array(N); this.cellCul = new Int32Array(N).fill(-1); this.cellRel = new Int32Array(N).fill(-1); this.cellLang = new Int32Array(N).fill(-1);
    this.cellUrbanLang = new Int32Array(N).fill(-1); this.cellUrban = new Float64Array(N); this.unrest = new Float32Array(N); this.bandit = new Float32Array(N);
    this.coastal = new Uint8Array(N); this.landmass = new Int32Array(N).fill(-1); this.landmassReached = new Set();
    this.seaCache = new Map(); this._seaReach = (c, r) => P.seaReach(this, c, r);
    this.log = []; this.stats = []; this.listeners = [];
    this.computeCoastal(); this.computeLandmasses();
    for (let c = 0; c < N; c++) { this.openLand[c] = w.discharge[c] > 200 ? 0.12 : 0.04; this.cleared[c] = this.openLand[c] * w.area[c] * 100 * w.arable[c]; } // floodplains offer some easily worked land; elsewhere fields must be cleared (or sod broken)
    P.ecology(this); for (let c = 0; c < N; c++) { this.game[c] = this.gameK[c]; this.fish[c] = this.fishK[c]; }
    this.seedHumans();
    this.cellStats();
    ID.identityUpdate(this);
    POL.initPolitics(this);
    this.logEvent('era', `The simulation begins in ${this.fmtYear(startYear)}. Bands of foragers live by hunting, gathering and fishing.`, { important: true });
  }
  fmtYear(y) { return y < 0 ? `${-y} BCE` : `${y} CE`; }
  logEvent(cat, text, refs = {}) {
    const e = { y: this.year, cat, text, ...refs }; this.log.push(e);
    if (this.log.length > 60000) this.log.splice(0, 10000);
    for (const f of this.listeners) f(e);
    return e;
  }
  computeCoastal() {
    const w = this.world;
    for (let c = 0; c < w.N; c++) { let co = 0; if (w.land[c]) for (let k = 0; k < 8; k++) { const j = w.nbr[c * 8 + k]; if (j >= 0 && !w.land[j]) co = 1; } this.coastal[c] = co; }
  }
  computeLandmasses() {
    const w = this.world; this.landmass.fill(-1); let id = 0; this.landmassSize = [];
    for (let c = 0; c < w.N; c++) {
      if (!w.land[c] || this.landmass[c] >= 0) continue; const st = [c]; this.landmass[c] = id; let n = 0;
      while (st.length) { const i = st.pop(); n++; for (let k = 0; k < 8; k++) { const j = w.nbr[i * 8 + k]; if (j >= 0 && w.land[j] && this.landmass[j] < 0) { this.landmass[j] = id; st.push(j); } } }
      this.landmassSize.push(n); id++;
    }
  }
  lmKey(c) { if (this.kind === 'earth') { const n = this.landmassName(c); if (!n.startsWith('a') ) return n; } return 'lm' + this.landmass[c]; }
  landmassName(c) {
    const la = this.world.lat[c], lo = this.world.lon[c];
    if (this.kind === 'earth') {
      if (la > 55 && lo < -155) return 'Beringia'; if (lo < -30 && la > 12) return 'North America'; if (lo < -30) return 'South America';
      if (lo > 110 && la < -10) return 'Australia'; if (la < -33 && lo > 160) return 'New Zealand';
      if (lo > 43 && lo < 51 && la < -11 && la > -27) return 'Madagascar'; if (la > 58 && lo < -10 && lo > -75) return 'Greenland';
      if (la > 62 && lo < -12 && lo > -26) return 'Iceland'; if (lo > 128 && la > 30 && la < 46) return 'Japan';
    }
    const s = this.landmassSize[this.landmass[c]] || 0; return s > 400 ? 'a great continent' : s > 60 ? 'a large island' : 'an island';
  }
  seedHumans() {
    const w = this.world, rng = this.rng, N = w.N;
    let inhabit = new Uint8Array(N);
    if (this.kind === 'earth') {
      for (let c = 0; c < N; c++) {
        if (!P.habitable(this, c)) continue; const la = w.lat[c], lo = w.lon[c];
        const americas = lo < -30 && !(la > 58 && lo < -160);
        const remote = (lo > 43 && lo < 51 && la < -11 && la > -27) || (la < -33 && lo > 160) || (la > 58 && lo < -10 && lo > -75) || (la > 62 && lo < -12 && lo > -26) || la > 72;
        if (!americas && !remote) inhabit[c] = 1;
      }
    } else {
      // cradle: largest landmass with tropical land
      let best = -1, bs = 0; const trop = new Map();
      for (let c = 0; c < N; c++) if (w.land[c] && Math.abs(w.lat[c]) < 25) trop.set(this.landmass[c], (trop.get(this.landmass[c]) || 0) + 1);
      for (const [lm, n] of trop) if (n > bs) { bs = n; best = lm; }
      for (let c = 0; c < N; c++) if (this.landmass[c] === best && P.habitable(this, c) && Math.abs(w.lat[c]) < 60) inhabit[c] = 1;
    }
    const cells = []; for (let c = 0; c < N; c++) { if (inhabit[c]) cells.push(c); else if (w.land[c]) this.naive[c] = 1; }
    // identities: farthest-point sampled seeds -> cultures, grouped into language families
    const fps = (pool, k) => { const s = [rng.pick(pool)]; const d = new Float32Array(pool.length).fill(1e9); while (s.length < k) { let bi = 0, bd = -1; for (let i = 0; i < pool.length; i++) { d[i] = Math.min(d[i], w.dist(pool[i], s[s.length - 1]) * rng.range(0.8, 1.2)); if (d[i] > bd) { bd = d[i]; bi = i; } } s.push(pool[bi]); } return s; };
    const nCul = this.kind === 'earth' ? 72 : 40, nFam = this.kind === 'earth' ? 16 : 9;
    const seeds = fps(cells, nCul), famSeeds = fps(seeds, nFam);
    const protos = famSeeds.map(() => { const L = ID.makeLanguage(this); L.proto = true; L.peak = 0; L.name = 'Proto-' + L.name; return L; });
    const culs = seeds.map(s => {
      let fi = 0, fd = 1e9; famSeeds.forEach((f, k) => { const d = w.dist(s, f); if (d < fd) { fd = d; fi = k; } });
      const L = ID.makeLanguage(this, protos[fi]); L.name = L.name.replace(/^New /, '');
      for (let k = 0; k < P.NDIA; k++) L.centroid[k] = rng.normal(0, 0.05);
      const tr = new Float32Array(P.NTR).map(() => clamp(rng.normal(0, 0.3), -1, 1));
      const C = ID.makeCulture(this, L.id, null, tr); ID.folkReligion(this, C);
      const tech = new Uint8Array(NT); for (const t of TECHS) if (t.start) tech[t.idx] = 1;
      if (rng.chance(0.55)) tech[TI.bow] = 1; if (rng.chance(0.3)) tech[TI.grinding] = 1; if (rng.chance(0.25)) tech[TI.dog] = 1; if (rng.chance(0.35)) tech[TI.nets] = 1;
      return { s, C, L, tech };
    });
    this.log.length = 0; // creation noise
    for (const c of cells) {
      let best = culs[0], bd = 1e12; for (const u of culs) { const d = w.dist(c, u.s) * (1 + 0.15 * rng.next()); if (d < bd) { bd = d; best = u; } }
      const cap = (0.3 * this.gameK[c] / 4 + 0.4 * this.fishK[c] / 4) / P.KCAL_NEED;
      const n = Math.round(cap * rng.range(0.5, 0.8)); if (n < 20) continue;
      const tr = Float32Array.from(best.C.centroid).map(v => clamp(v + rng.normal(0, 0.05), -1, 1));
      const dia = Float32Array.from(best.L.centroid).map(v => v + rng.normal(0, 0.01));
      P.newPop(this, c, n, { cul: best.C.id, lang: best.L.id, rel: best.C.folk, tr, dia, tech: best.tech, farm: 0, herd: 0 });
      this.everSettled[c] = 1; this.landmassReached.add(this.lmKey(c));
    }
  }
  firstSettle(c, p) {
    const lm = this.landmass[c]; const key = this.lmKey(c);
    if (lm >= 0 && !this.landmassReached.has(key) && this.landmassSize[lm] > 25) {
      this.landmassReached.add(key); const C = this.cultures.get(p.cul);
      this.logEvent('migration', `The first humans reach ${this.landmassName(c)} — ${C ? C.name : 'wanderers'} settle near ${this.world.cellName(c)}`, { cell: c, cul: p.cul, important: true });
    }
  }
  cellStats() {
    const N = this.world.N; this.cellN.fill(0); this.cellUrban.fill(0);
    for (let c = 0; c < N; c++) {
      const l = this.cellPops[c]; if (!l.length) { this.cellCul[c] = -1; this.cellRel[c] = -1; this.cellLang[c] = -1; continue; }
      let n = 0, bc = null, bu = null, urb = 0; for (const p of l) { n += p.n; urb += p.n * p.urban; if (!bc || p.n > bc.n) bc = p; if (!bu || p.n * p.urban > bu.n * bu.urban) bu = p; }
      this.cellN[c] = n; this.cellUrban[c] = urb; this.cellCul[c] = bc.cul; this.cellRel[c] = bc.rel; this.cellLang[c] = bc.lang; this.cellUrbanLang[c] = bu.lang;
    }
  }
  randomContact(p, wide = false) {
    const w = this.world, r = this.rng; const c = p.c;
    if (r.chance(0.35) && this.cellPops[c].length > 1) { const l = this.cellPops[c]; const q = l[r.int(0, l.length - 1)]; return q === p ? null : q; }
    let j = w.nbr[c * 8 + r.int(0, 7)];
    if (wide && r.chance(0.15)) {
      const sr = p.tech[TI.ocean_nav] ? 9 : p.tech[TI.sailing] ? 3 : p.tech[TI.watercraft] ? 1 : 0;
      if (sr && this.coastal[c]) { const reach = P.seaReach(this, c, sr); if (reach.length) j = reach[r.int(0, reach.length - 1)]; }
      const o = this.owner[c] >= 0 ? this.orgs.get(this.owner[c]) : null;
      if (o && o.tradePartners && o.tradePartners.size && r.chance(0.5)) { const ps = [...o.tradePartners]; const t = this.orgs.get(r.pick(ps)); if (t && t.capital >= 0) j = t.capital; }
    }
    if (j < 0) return null; const l = this.cellPops[j]; if (!l.length) return null;
    return l[r.int(0, l.length - 1)];
  }
  pathogen(c) { const T = this.climate.T[c], Pp = this.climate.P[c]; return clamp((T - 8) / 18, 0, 1) * clamp(Pp / 1500, 0, 1) * 0.7 + clamp(this.cellN[c] / this.world.area[c] / 60, 0, 0.3); }
  tradeAccess(c, ore) {
    const w = this.world; const o = this.owner[c] >= 0 ? this.orgs.get(this.owner[c]) : null;
    if (o && o.ores && o.ores.has(ore)) return true;
    if (o && o.tradePartners) for (const t of o.tradePartners) { const ot = this.orgs.get(t); if (ot && ot.ores && ot.ores.has(ore)) return true; }
    return false;
  }
  atWar(a, b) { if (a < 0 || b < 0 || a === b) return false; const o = this.orgs.get(a); return !!(o && o.wars.some(wid => { const W = this.wars.get(wid); return W && (W.att.includes(b) || W.def.includes(b)); })); }
  onInvent(p, t) {
    const o = this.owner[p.c] >= 0 ? this.orgs.get(this.owner[p.c]) : null;
    POL.creditInvention(this, p, t, o);
  }
  onLoseTech(p, t) { if (t.cplx > 2000 && p.n > 2000) this.logEvent('tech', `Knowledge of ${t.name.toLowerCase()} is lost among the ${this.cultures.get(p.cul)?.name || 'people'} near ${this.world.cellName(p.c)}`, { cell: p.c }); }
  epidemicDeaths(p, D, deaths) {
    if (!this._epiYear || this._epiYear.y !== this.year) this._epiYear = { y: this.year, m: new Map() };
    const m = this._epiYear.m; m.set(D.id, (m.get(D.id) || 0) + deaths);
  }
  handleSeaLevel(sl) {
    const w = this.world; const before = Uint8Array.from(w.land);
    w.applySeaLevel(sl);
    let drowned = 0, cells = 0;
    for (let c = 0; c < w.N; c++) {
      if (before[c] && !w.land[c]) {
        for (const p of [...this.cellPops[c]]) {
          let dest = -1, bd = -1; for (let k = 0; k < 8; k++) { const j = w.nbr[c * 8 + k]; if (j >= 0 && w.land[j] && this.climate.NPP[j] > bd) { bd = this.climate.NPP[j]; dest = j; } }
          if (dest >= 0) { this.cellN[c] = p.n; P.movePeople(this, p, dest, p.n - 5); } drowned += p.n; P.removePop(this, p);
        }
        if (this.owner[c] >= 0) POL.loseCell(this, c);
        cells++;
      }
      if (!before[c] && w.land[c]) { this.game[c] = 0; this.fish[c] = 0; this.soil[c] = 1; }
    }
    w.computeStatic(); this.computeCoastal(); this.computeLandmasses(); this.seaCache.clear();
    for (let c = 0; c < w.N; c++) if (this.cellN[c] > 0 && w.land[c]) this.landmassReached.add(this.lmKey(c));
    if (cells > 3 && drowned > 5000) this.logEvent('climate', `Rising seas swallow ${cells} coastal lowland regions; ${Math.round(drowned).toLocaleString()} people are driven inland`, { important: drowned > 50000 });
    else if (cells > 12) this.logEvent('climate', `Sea level ${sl > -1 ? 'reaches its modern line' : 'shifts to ' + sl.toFixed(0) + ' m'}; ${cells} coastal regions ${sl > w.seaLevel ? 'drown' : 'emerge'}`, {});
  }
  step() {
    this.year++;
    const cl = this.climate;
    const nEv = cl.events.length;
    const sl = cl.step(this.year);
    for (let k = nEv; k < cl.events.length; k++) { const e = cl.events[k]; this.logEvent('climate', e.text, { cell: e.cell, important: e.type !== 'volcano' || e.vei >= 7 }); }
    if (Math.abs(sl - this.world.seaLevel) > 4) this.handleSeaLevel(sl);
    for (let c = 0; c < this.world.N; c++) if (!this.world.land[c] && this.cellPops[c].length) for (const p of [...this.cellPops[c]]) P.removePop(this, p);
    P.ecology(this);
    P.economy(this);
    P.demography(this);
    diseases(this);
    if (this._epiYear && this._epiYear.y === this.year) for (const [did, d] of this._epiYear.m) { const D = this.diseases.get(did); if (d > 20000) this.logEvent('disease', `${D.name} kills ~${Math.round(d).toLocaleString()} people this year`, { dis: did, important: d > 200000 }); }
    this.cellStats();
    P.migration(this);
    this.cellStats();
    P.culturalEvolution(this);
    ID.identityDiffusion(this);
    P.technology(this);
    ID.languageChange(this);
    POL.politicsYear(this);
    if (this.year % 25 === 0) { P.consolidate(this); ID.identityUpdate(this); }
    if (this.year % 10 === 0) this.recordStats();
  }
  recordStats() {
    let n = 0, farm = 0, herd = 0, urb = 0, cells = 0; const tl = new Float64Array(1);
    for (const p of this.pops.values()) { n += p.n; farm += p.n * p.farm; herd += p.n * p.herd; urb += p.n * p.urban; tl[0] += p.n * techLevel(p.tech); }
    for (let c = 0; c < this.world.N; c++) if (this.cellN[c] > 0) cells++;
    const live = m => { let k = 0; for (const x of m.values()) if (!x.dead && x.n > 0) k++; return k; };
    let polities = 0, orgs = 0; for (const o of this.orgs.values()) if (!o.dead) { orgs++; if (o.kind === 'polity') polities++; }
    this.stats.push({ y: this.year, pop: Math.round(n), farm: farm / n, herd: herd / n, urban: urb / n, tech: tl[0] / n, cells, cultures: live(this.cultures), languages: live(this.languages), religions: live(this.religions), polities, orgs, persons: this.livingPersons || 0, dT: this.climate.dTg, sl: this.climate.seaLevel });
  }
  // ---------- god tools ----------
  god(action, arg = {}) {
    const w = this.world, c = arg.cell;
    const near = (c0, r) => { const s = new Set(); for (let i = 0; i < w.N; i++) if (w.land[i] && w.dist(c0, i) < r) s.add(i); return s; };
    switch (action) {
      case 'drought': this.climate.forcing.droughtCells = near(c, arg.radius || 1200); this.climate.forcing.droughtYears = arg.years || 15; this.climate.forcing.droughtMult = arg.mult || 0.35; this.logEvent('god', `⚡ A great drought is imposed around ${w.cellName(c)} for ${arg.years || 15} years`, { cell: c, important: true }); break;
      case 'volcano': this.climate.volc -= arg.cool || 1.5; this.logEvent('god', `⚡ A supervolcano erupts near ${w.cellName(c ?? 0)}`, { cell: c, important: true }); break;
      case 'warm': this.climate.forcing.tempOffset += arg.dT; this.logEvent('god', `⚡ Global temperature forcing changed by ${arg.dT > 0 ? '+' : ''}${arg.dT}°C`, { important: true }); break;
      case 'plague': { const D = spawnPlague(this, c); if (D) this.logEvent('god', `⚡ ${D.name} is unleashed near ${w.cellName(c)}`, { cell: c, dis: D.id, important: true }); break; }
      case 'kill': POL.killPerson(this, this.persons.get(arg.person), 'struck down by the gods'); break;
      case 'prophet': POL.spawnProphet(this, c); break;
      case 'tech': for (const p of this.cellPops[c]) p.tech[TI[arg.tech]] = 1; this.logEvent('god', `⚡ Knowledge of ${TECHS[TI[arg.tech]].name} is revealed near ${w.cellName(c)}`, { cell: c, important: true }); break;
      case 'ice': this.climate.V = clamp(this.climate.V + arg.dV, 0, 1.05); this.logEvent('god', `⚡ Ice sheets ${arg.dV > 0 ? 'grow' : 'shrink'} by decree`, { important: true }); break;
      case 'migrants': { const p = this.cellPops[arg.from]?.sort((a, b) => b.n - a.n)[0]; if (p) P.movePeople(this, p, c, Math.floor(p.n * 0.3)); break; }
    }
  }
}

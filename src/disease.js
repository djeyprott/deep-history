// Infectious disease: crowd diseases emerge from zoonoses in large, dense, animal-keeping populations,
// spread along contacts, burn through populations via the SIR final-size relation, become endemic above
// a critical community size, attenuate over time, and devastate immunologically naive populations.
import { clamp } from './rng.js';
import { ANIMAL_TECH, TI } from './tech.js';

const SYL = ['ra', 'ko', 'mi', 'su', 'ta', 've', 'lo', 'ga', 'pe', 'ru', 'za', 'chi', 'mo', 'ne', 'ba', 'tu'];
const KIND = ['pox', 'fever', 'plague', 'flux', 'cough', 'sweat', 'spots', 'wasting'];

function finalSize(R) { if (R <= 1) return 0; let z = 0.5; for (let i = 0; i < 30; i++) z = 1 - Math.exp(-R * z); return z; }

export function diseases(sim) {
  const rng = sim.rng, w = sim.world;
  // ---- emergence
  for (const p of sim.pops.values()) {
    if (p.n < 5000) continue;
    let animals = 0; for (const i of ANIMAL_TECH) animals += p.tech[i];
    if (!animals) continue;
    const dens = sim.cellN[p.c] / w.area[p.c];
    const lam = 4e-8 * (p._neff || p.n) / 1e4 * animals * (0.3 + p.urban * 6) * Math.min(3, 0.3 + dens / 10);
    if (rng.chance(lam)) emerge(sim, p);
  }
  // ---- transmission dynamics
  const cfrMult = 1;
  const seeds = [];
  for (const p of sim.pops.values()) {
    for (const id in p.dz) {
      const s = p.dz[id]; const D = sim.diseases.get(+id); if (!D || D.extinct) { delete p.dz[id]; continue; }
      // newborns dilute immunity, waning immunity
      if (p._births) s.imm *= p.n / (p.n + p._births);
      s.imm *= Math.exp(-1 / D.immYears);
      if (!s.act) { if (s.imm < 0.001) delete p.dz[id]; continue; }
      const dens = sim.cellN[p.c] / w.area[p.c];
      const mix = clamp(0.45 + 0.18 * Math.log10(1 + dens) + 1.5 * p.urban, 0.3, 1.6);
      const S = 1 - s.imm; const Reff = D.R0 * mix * S;
      const z = finalSize(Reff); // fraction of susceptibles infected this season
      const inf = z * S * p.n;
      let cfr = D.cfr * (p.food < 0.9 ? 1.4 : 1) * (p.tech[TI.medicine] ? 0.85 : 1) * (s.naive ? 1.8 : 1);
      const deaths = Math.min(p.n * 0.6, inf * clamp(cfr, 0, 0.9));
      p.n -= deaths; s.imm = clamp(s.imm + z * S, 0, 1); D.deaths += deaths; D.cases += inf;
      if (deaths > 2000 || deaths > 0.15 * (p.n + deaths)) { p.crisis = 1; sim.epidemicDeaths(p, D, deaths); }
      s.naive = false;
      // persistence: endemic only above the critical community size (~250k for measles-like R0)
      const ccs = 3e5 / Math.sqrt(D.R0);
      const conn = (p._neff || p.n);
      s.act = (z > 0.01 && conn > ccs) ? 1 : (Reff > 1.2 && rng.chance(0.3) ? 1 : 0);
      if (z > 0.005) seeds.push([p, D, inf]);
    }
  }
  for (const [p, D, inf] of seeds) {
    const tries = 2 + (p.urban > 0.05 ? 2 : 0);
    for (let t = 0; t < tries; t++) {
      const q = sim.randomContact(p, true); if (!q || q === p) continue;
      const pr = 1 - Math.exp(-inf / 3000 * (0.3 + q.urban * 4));
      if (!rng.chance(pr)) continue;
      const s = q.dz[D.id]; if (!s) { q.dz[D.id] = { imm: 0, act: 1, naive: true }; D.spread++; } else if (!s.act && s.imm < 0.7) s.act = 1;
    }
  }
  // ---- evolution: attenuation, extinction, rare novel strains
  for (const D of sim.diseases.values()) {
    if (D.extinct) continue;
    D.cfr *= 0.9994; D.age++;
    let active = false; for (const p of sim.pops.values()) { const s = p.dz[D.id]; if (s && s.act) { active = true; break; } }
    if (!active) { D.idle++; if (D.idle > 150) { D.extinct = sim.year; sim.logEvent('disease', `${D.name} has died out`, { dis: D.id }); } } else D.idle = 0;
  }
}
function emerge(sim, p) {
  const rng = sim.rng;
  const R0 = Math.exp(rng.range(Math.log(1.6), Math.log(14)));
  const cfr = clamp(Math.exp(rng.normal(Math.log(0.12), 0.8)) / Math.sqrt(R0 / 3), 0.005, 0.6);
  const L = sim.languages.get(p.lang);
  const name = (L ? L.placeName(rng) : rng.pick(SYL) + rng.pick(SYL)) + ' ' + rng.pick(KIND);
  const D = { id: sim.nextId++, name, R0, cfr, immYears: rng.chance(0.6) ? 80 : rng.range(5, 30), origin: p.c, born: sim.year, deaths: 0, cases: 0, spread: 0, extinct: null, idle: 0, age: 0 };
  sim.diseases.set(D.id, D);
  p.dz[D.id] = { imm: 0, act: 1, naive: true };
  sim.logEvent('disease', `A new disease, ${name} (R0≈${R0.toFixed(1)}, lethality ${(cfr * 100).toFixed(0)}%), jumps from animals to people near ${sim.world.cellName(p.c)}`, { dis: D.id, cell: p.c, important: true });
  return D;
}
export function spawnPlague(sim, c) { const p = sim.cellPops[c].slice().sort((a, b) => b.n - a.n)[0]; if (!p) return null; const D = emerge(sim, p); D.R0 = 6; D.cfr = 0.3; return D; }

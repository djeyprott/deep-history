// Populations: calorie economy (foraging, fishing, farming, herding), Malthusian demography,
// migration, cultural/dialect drift, technology discovery, diffusion and loss.
import { clamp } from './rng.js';
import { CROPS, ANIMALS } from './world.js';
import { TECHS, NT, TI, CROP_TECH, ANIMAL_TECH, forageMult, fishMult, haPerWorker, yieldMult, herdMult, seaRange, innovationMult } from './tech.js';

export const KCAL_NEED = 0.8e6;      // kcal per person per year, population average incl. children (~2200/day)
export const WORK_SHARE = 0.55;      // share of people-time available for food production
const GAME_R = 0.3;                  // intrinsic regrowth of hunted animal/plant stocks per year
const FISH_R = 0.4;
const KAPPA = 1700;                  // kcal standing edible stock per km2 per (g/m2/yr NPP); calibrated so
                                     // foragers equilibrate ~0.1/km2 at NPP 800 (Binford 2001 densities)
const Q_FORAGE = 3.0;                // catchability: workers/km2 -> fraction harvested
export const TRAITS = ['hierarchy', 'collectivism', 'martial', 'piety', 'openness', 'tradition', 'mercantile', 'kinship', 'honor', 'patriarchy'];
export const NTR = TRAITS.length, NDIA = 4;

export function newPop(sim, c, n, src) {
  const p = {
    id: sim.nextId++, c, n, cul: src.cul, lang: src.lang, rel: src.rel,
    tr: Float32Array.from(src.tr), dia: Float32Array.from(src.dia), tech: Uint8Array.from(src.tech),
    farm: src.farm ?? 0, herd: src.herd ?? 0, food: 1, urban: 0, store: 0, surplus: 0, wealth: 0,
    dz: src.dz ? JSON.parse(JSON.stringify(src.dz)) : {}, crisis: 0, war: 0, born: sim.year,
  };
  sim.pops.set(p.id, p); sim.cellPops[c].push(p);
  return p;
}
export function removePop(sim, p) { sim.pops.delete(p.id); const a = sim.cellPops[p.c]; const k = a.indexOf(p); if (k >= 0) a.splice(k, 1); }

export function ecology(sim) {
  const w = sim.world, cl = sim.climate;
  for (let c = 0; c < w.N; c++) {
    if (!w.land[c]) { sim.game[c] = 0; continue; }
    const P = cl.P[c], T = cl.T[c];
    // accessibility: open grass/shrub supports most game per unit NPP; closed forest and rainforest far less
    let acc = 1; if (P > 1300) acc = 0.75; if (P > 2000 && T > 20) acc = 0.45; if (P > 250 && P < 1100 && T > -5) acc = 1.25;
    const K = cl.NPP[c] * w.area[c] * KAPPA * acc * sim.faunaMult[c] * (1 - 0.8 * sim.farmShareLand[c]) * (1 - 0.5 * sim.pastureShare[c]);
    sim.gameK[c] = K;
    const g = sim.game[c]; sim.game[c] = Math.max(K * 0.01, g + GAME_R * g * (1 - g / Math.max(1, K)));
    // aquatic stocks: coasts (higher in cool productive waters) and rivers (scaled by discharge)
    let fk = 0;
    if (sim.coastal[c]) { const a = Math.abs(w.lat[c]); fk += 2.5e10 * (0.5 + Math.exp(-(((a - 45) / 18) ** 2))); }
    fk += 1.6e7 * Math.min(w.discharge[c], 6000);
    sim.fishK[c] = fk; const f = sim.fish[c]; sim.fish[c] = Math.max(fk * 0.02, f + FISH_R * f * (1 - f / Math.max(1, fk)));
    // megafauna extinction: stocks crushed below 15% of K for long periods lose species permanently
    if (K > 0 && sim.game[c] < 0.15 * K && sim.cellN[c] > 0) {
      sim.overkill[c]++;
      if (sim.overkill[c] > 40 && sim.faunaMult[c] > 0.55) {
        sim.faunaMult[c] *= 0.85; sim.overkill[c] = 0;
        for (let k = 0; k < ANIMALS.length; k++) if (w.animalWild[c * ANIMALS.length + k] && sim.rng.chance(0.25)) { w.animalWild[c * ANIMALS.length + k] = 0; if (ANIMALS[k].id === 'horse' || ANIMALS[k].id === 'camelid') sim.logEvent('nature', `Wild ${ANIMALS[k].name} hunted to local extinction near ${w.cellName(c)}`, { cell: c }); }
      }
    } else sim.overkill[c] = Math.max(0, sim.overkill[c] - 1);
    if (sim.naive[c] && sim.cellN[c] > 0) { sim.naiveYears[c]++; if (sim.naiveYears[c] > 300) sim.naive[c] = 0; }
  }
}

function bestCrop(sim, p, c, irrigated) {
  const w = sim.world, cl = sim.climate; let best = 0, bk = -1;
  for (let k = 0; k < CROPS.length; k++) {
    if (!p.tech[CROP_TECH[k]]) continue; const cr = CROPS[k];
    let s = w.cropNiche(cr, c, cl.T[c], irrigated ? Math.max(cl.P[c], 900) : cl.P[c]);
    if (s <= 0) continue;
    const v = s * cr.yield * cr.kcal * (cr.lateYield && p.tech[TI.crop_rotation] ? 1.5 : 1);
    if (v > best) { best = v; bk = k; }
  }
  return [best, bk];
}

// Annual food production and distribution for every populated cell
export function economy(sim) {
  const w = sim.world, cl = sim.climate;
  for (let c = 0; c < w.N; c++) {
    const list = sim.cellPops[c]; if (!list.length) { sim.farmShareLand[c] *= 0.97; sim.pastureShare[c] *= 0.95; continue; }
    const A = w.area[c];
    // ---- labour allocation
    let Lf = 0, Lfarm = 0, Lherd = 0;
    for (const p of list) { const wk = p.n * (1 - p.urban) * WORK_SHARE; p._wf = wk * (1 - p.farm - p.herd) * forageMult(p); p._wa = wk * p.farm; p._wh = wk * p.herd; Lf += p._wf; Lfarm += p._wa; Lherd += p._wh; }
    // ---- foraging: split effort between land game and aquatic stocks by their sustainable yields
    const gMsy = GAME_R * sim.gameK[c] / 4, fMsy = FISH_R * sim.fishK[c] / 4;
    const phi = fMsy / Math.max(1, gMsy + fMsy);
    const naive = sim.naive[c] ? 3 : 1;
    let wild = 0; for (let k = 0; k < CROPS.length; k++) wild += w.cropWild[c * CROPS.length + k];
    const Fg = 1 - Math.exp(-Q_FORAGE * naive * Lf * (1 - phi) / A);
    const Hg = Fg * sim.game[c]; sim.game[c] -= Hg;
    let fishEff = 0; for (const p of list) fishEff += p._wf * phi * fishMult(p);
    const Ff = 1 - Math.exp(-0.4 * fishEff / 3000); // fishing grounds per cell are coast/river-limited, not area-limited
    const Hf = Math.min(Ff, 0.9) * sim.fish[c]; sim.fish[c] -= Hf;
    // ---- farming: land shared by labour; irrigation limited by river discharge (~1 L/s/ha)
    const maxHa = A * 100 * w.arable[c];
    const potHa = Math.min(maxHa, sim.cleared[c]) * sim.soil[c];
    const irrigHa = w.discharge[c] * 1000 * 0.6;
    let usedHa = 0, farmFood = 0;
    let wantHa = 0; for (const p of list) if (p._wa > 0) wantHa += p._wa * haPerWorker(p);
    const landShare = wantHa > potHa ? potHa / wantHa : 1;
    for (const p of list) {
      p._food = 0;
      if (p._wa > 0) {
        const ha = p._wa * haPerWorker(p) * landShare; usedHa += ha;
        const irr = p.tech[TI.irrigation] && w.discharge[c] > 20 ? Math.min(1, irrigHa / Math.max(1, wantHa)) : 0;
        const [vDry] = bestCrop(sim, p, c, false); const [vIrr] = irr > 0 ? bestCrop(sim, p, c, true) : [0];
        const perHa = (vDry * (1 - irr) + vIrr * 1.35 * irr) * 0.55 * yieldMult(p); // seed, losses, pests, early cultivars // 30% seed + losses
        const f = ha * perHa * (0.5 + 0.5 * sim.soil[c]);
        p._food += f; farmFood += f; p._irr = irr;
      }
    }
    // soil: depletion with intensity, recovery under fallow; salinisation of irrigated drylands
    const intensity = clamp(usedHa / Math.max(1, A * 100 * w.arable[c]), 0, 1);
    sim.farmShareLand[c] = clamp(usedHa / (A * 100), 0, 0.6);
    // forest clearance: farmers open new fields slowly (stone axes; iron doubles), unused fields revert
    let clr = 0; for (const p of list) clr += p._wa * 0.06 * (p.tech[TI.iron] ? 2 : p.tech[TI.copper] ? 1.3 : 1);
    sim.cleared[c] = clamp(sim.cleared[c] + clr - 0.02 * Math.max(0, sim.cleared[c] - usedHa * 1.3), sim.openLand[c] * maxHa, maxHa);
    let rot = 0; for (const p of list) if (p.tech[TI.crop_rotation]) rot = 1;
    const humidTrop = cl.T[c] > 22 && cl.P[c] > 1500 ? 2.5 : 1; // leached tropical soils
    sim.soil[c] += -0.012 * humidTrop * intensity * (rot ? 0.4 : 1) + 0.02 * (1 - sim.soil[c]) * (1 - intensity);
    if (cl.P[c] < 400 && list.some(p => p._irr > 0.2)) sim.salt[c] = Math.min(0.6, sim.salt[c] + 0.0004 * intensity); else sim.salt[c] = Math.max(0, sim.salt[c] - 0.00005);
    sim.soil[c] = clamp(sim.soil[c], 0.2, 1 - sim.salt[c]);
    // ---- herding: pasture = grassland not under crops; one herder manages ~3e6 kcal/yr of animal produce
    let pastFood = 0, herdLab = 0;
    for (const p of list) if (p._wh > 0) herdLab += p._wh * herdMult(p);
    if (herdLab > 0) {
      const pastureK = cl.NPP[c] * A * (1 - sim.farmShareLand[c]) * 2600;
      const prod = Math.min(herdLab * 1.2e6, pastureK * (1 - Math.exp(-herdLab * 1.2e6 / Math.max(1, pastureK))));
      sim.pastureShare[c] = clamp(prod / Math.max(1, pastureK), 0, 1);
      for (const p of list) if (p._wh > 0) { const kept = keptAnimals(sim, p, c); const f = prod * (p._wh * herdMult(p) / herdLab) * kept; p._food += f; pastFood += f; }
    } else sim.pastureShare[c] *= 0.95;
    // ---- distribute wild food by effort share
    for (const p of list) {
      const share = Lf > 0 ? p._wf / Lf : 0;
      const fs = fishEff > 0 ? p._wf * phi * fishMult(p) / fishEff : 0;
      p._forage = (Hg * share + Hf * fs) * (wild && p.tech[TI.grinding] ? 1 + 0.25 * Math.min(2, wild) : 1); // wild-cereal & tuber harvesting
      p._food += p._forage;
      const need = p.n * KCAL_NEED;
      // storage (pottery) buffers bad years
      let food = p._food;
      if (p.tech[TI.pottery]) { if (food > need) { const add = Math.min(food - need, need * 0.3 - p.store); if (add > 0) { p.store += add; food -= add; } } else { const take = Math.min(p.store, need - food); p.store -= take; food += take; } p.store *= 0.9; }
      p.food = food / Math.max(1, need);
      p.surplus = Math.max(0, food - need) / 1e6; // person-years of food
      // marginal returns guide labour reallocation (cultural inertia slows it)
      const fwk = p.n * (1 - p.urban) * WORK_SHARE;
      // marginal (not average) return of foraging: near the sustainable-yield limit, extra effort only depletes stocks
      const msyUse = clamp((Hg + Hf) / Math.max(1, gMsy + fMsy), 0, 1.5);
      const apForage = (p._wf > 0 ? p._forage / Math.max(1, fwk * (1 - p.farm - p.herd)) : (Hg + Hf) / Math.max(1, Lf + 1) * forageMult(p) + gMsy / Math.max(1, Lf + fwk) * 0.5) * clamp(1.15 - msyUse, 0.05, 1);
      const [v] = bestCrop(sim, p, c, false);
      const apFarm = v > 0 ? haPerWorker(p) * Math.min(landShare, 1) * v * 0.7 * yieldMult(p) * (0.5 + 0.5 * sim.soil[c]) : 0;
      const kept = keptAnimals(sim, p, c);
      const apHerd = kept > 0 ? 1.2e6 * herdMult(p) * kept * (1 - sim.pastureShare[c] * 0.7) : 0;
      const rate = 0.04 * (1 - 0.5 * Math.max(0, p.tr[5]));
      const best = Math.max(apForage, apFarm, apHerd); p._ap = [apForage, apFarm, apHerd];
      if (best > 0) {
        if (apFarm === best) p.farm += rate * (1 - p.farm); else p.farm -= rate * p.farm;
        if (apHerd === best) p.herd += rate * (1 - p.herd); else p.herd -= rate * p.herd;
        if (p.farm + p.herd > 0.97) { const s = 0.97 / (p.farm + p.herd); p.farm *= s; p.herd *= s; }
      }
      // urbanisation: surplus feeds non-producers; cities need markets/administration
      const ucap = 0.008 + 0.03 * p.tech[TI.accounting] + 0.04 * p.tech[TI.writing] + 0.02 * p.tech[TI.wheel] + 0.03 * p.tech[TI.coinage] + 0.03 * p.tech[TI.roads] + 0.03 * p.tech[TI.engineering] + 0.05 * p.tech[TI.printing] + 0.15 * p.tech[TI.steam];
      const ut = clamp((p.food - 1.05) * 0.5, 0, ucap) * (sim.owner[c] >= 0 ? 1 : 0.1) * clamp((p.farm + p.herd - 0.2) * 2, 0, 1) * (p.tech[TI.writing] ? 1.3 : 1) * (p.tech[TI.pottery] ? 1 : 0.2);
      p.urban += (ut - p.urban) * 0.05;
    }
  }
}
function keptAnimals(sim, p, c) {
  const w = sim.world, cl = sim.climate; let best = 0;
  for (let k = 0; k < ANIMALS.length; k++) {
    if (!p.tech[ANIMAL_TECH[k]]) continue; const a = ANIMALS[k];
    const s = w.cropNiche({ T: [a.T[0] - 4, a.T[1] + 4], P: [a.P[0] * 0.6, a.P[1] * 1.6] }, c, cl.T[c], cl.P[c]);
    best = Math.max(best, s * (a.id === 'fowl' ? 0.3 : 1));
  }
  return best;
}

export function demography(sim) {
  const w = sim.world;
  for (const p of sim.pops.values()) {
    const sed = clamp(p.farm + p.herd, 0, 1);
    const dens = sim.cellN[p.c] / w.area[p.c];
    const b0 = 0.039 + 0.009 * sed;                      // forager birth spacing vs sedentary
    const fert = clamp(p.food, 0.3, 1.0);
    let d = 0.029 + 0.0035 * Math.log10(1 + dens) + 0.012 * p.urban + 0.009 * sed + 0.012 * sed * sim.pathogen(p.c); // sedentary disease load (Neolithic demographic transition)  // background, density-dependent infection, urban penalty
    if (p.food < 1) d += 0.5 * (1 - p.food);             // famine mortality ~ half the calorie shortfall
    if (p.war > 0) { d += 0.01 * p.war; p.war *= 0.5; }
    const births = sim.rng.binomial(Math.round(p.n), b0 * fert);
    const deaths = Math.min(p.n, sim.rng.binomial(Math.round(p.n), clamp(d, 0, 0.9)));
    p.n = p.n + births - deaths;
    p._births = births;
    if (p.food < 0.85) p.crisis = Math.min(1, p.crisis + 0.3); else p.crisis *= 0.9;
  }
  for (const p of [...sim.pops.values()]) if (p.n < 8) removePop(sim, p);
}

export function seaReach(sim, c, range) {
  if (range <= 0 || !sim.coastal[c]) return [];
  const key = c * 16 + range; let r = sim.seaCache.get(key); if (r) return r;
  const w = sim.world; const seen = new Map([[c, 0]]); let frontier = [c]; r = [];
  for (let step = 1; step <= range + 1; step++) { // range = ocean cells that can be crossed
    const nf = [];
    for (const i of frontier) for (let k = 0; k < 8; k++) {
      const j = w.nbr[i * 8 + k]; if (j < 0 || seen.has(j)) continue; seen.set(j, step);
      if (w.land[j]) { if (j !== c && !isLandNbr(w, c, j)) r.push(j); } else nf.push(j);
    }
    frontier = nf;
  }
  sim.seaCache.set(key, r); return r;
}
function isLandNbr(w, a, b) { for (let k = 0; k < 8; k++) if (w.nbr[a * 8 + k] === b) return true; return false; }

export function habitable(sim, c) { return sim.world.land[c] && !sim.climate.ice[c]; }

// expected per-capita food a migrant group with given techs could get in cell j
export function prospect(sim, p, j, extraN) {
  const w = sim.world;
  if (!habitable(sim, j)) return 0;
  const forage = (GAME_R * sim.game[j] * (sim.naive[j] ? 1.5 : 1) / 3 + FISH_R * sim.fish[j] / 4) * forageMult(p);
  const [v] = bestCrop(sim, p, j, false);
  const farm = v > 0 ? Math.min(Math.max(sim.cleared[j], w.area[j] * 100 * w.arable[j] * 0.05) * sim.soil[j] * 0.8, (sim.cellN[j] + extraN) * WORK_SHARE * haPerWorker(p)) * v * 0.7 : 0;
  const herd = p.herd > 0.1 ? sim.climate.NPP[j] * w.area[j] * 2600 * 0.3 * keptAnimals(sim, p, j) : 0;
  return (forage + farm + herd) / ((sim.cellN[j] + extraN) * KCAL_NEED + 1);
}

export function migration(sim) {
  const w = sim.world, rng = sim.rng;
  const arr = [...sim.pops.values()];
  for (const p of arr) {
    if (!sim.pops.has(p.id) || p.n < 20) continue;
    const c = p.c;
    const press = clamp(1 - p.food, 0, 1);
    const sed = p.farm + p.herd * 0.3;
    // pioneers (budding of bands/villages) + distress migration
    let frac = (0.004 + 0.12 * press * press) * (1 - 0.6 * sed) + (p.food > 1.3 ? 0.002 : 0);
    if (!rng.chance(0.5)) continue; frac *= 2;
    let m = Math.floor(p.n * frac);
    if (m < 10) { if (p.n > 40 && rng.chance(0.08)) m = Math.min(30, Math.floor(p.n * 0.25)); else continue; } // small bands bud off whole families
    const here = prospect(sim, p, c, 0);
    let best = -1, bv = here * 1.15;
    const cand = [];
    for (let k = 0; k < 8; k++) { const j = w.nbr[c * 8 + k]; if (j >= 0 && w.land[j]) cand.push(j); }
    const sr = seaRange(p); if (sr > 0 && sim.coastal[c] && rng.chance(0.25)) for (const j of seaReach(sim, c, sr)) cand.push(j);
    for (const j of cand) {
      let v = prospect(sim, p, j, m);
      v /= Math.pow(w.moveCost[j], 0.5);
      if (sim.owner[j] >= 0 && sim.owner[c] !== sim.owner[j]) v *= sim.atWar(sim.owner[c], sim.owner[j]) ? 0.1 : 0.6;
      // cultural friction: dense foreign populations resist newcomers
      const dens = sim.cellN[j] / w.area[j]; if (dens > 0.5 && sim.cellCul[j] !== p.cul) v *= 0.7;
      v *= rng.range(0.85, 1.15);
      if (v > bv) { bv = v; best = j; }
    }
    if (best < 0) continue;
    movePeople(sim, p, best, m);
  }
}
export function movePeople(sim, p, dest, m) {
  m = Math.min(m, p.n - 5); if (m <= 0) return null;
  p.n -= m;
  let tgt = sim.cellPops[dest].find(q => q.cul === p.cul && q.lang === p.lang && q.rel === p.rel);
  if (tgt) { mergeInto(tgt, p, m); }
  else { tgt = newPop(sim, dest, m, p); tgt.store = 0; tgt.urban = 0; }
  if (sim.cellN[dest] === 0 && !sim.everSettled[dest]) { sim.everSettled[dest] = 1; sim.firstSettle(dest, tgt); }
  sim.cellN[dest] += m; sim.cellN[p.c] -= m;
  return tgt;
}
export function mergeInto(tgt, src, m) {
  const a = tgt.n / (tgt.n + m), b = 1 - a;
  for (let k = 0; k < tgt.tr.length; k++) tgt.tr[k] = tgt.tr[k] * a + src.tr[k] * b;
  for (let k = 0; k < tgt.dia.length; k++) tgt.dia[k] = tgt.dia[k] * a + src.dia[k] * b;
  for (let k = 0; k < NT; k++) if (src.tech[k]) tgt.tech[k] = 1;
  tgt.farm = tgt.farm * a + src.farm * b; tgt.herd = tgt.herd * a + src.herd * b;
  for (const d in src.dz) { const s = src.dz[d]; const t = tgt.dz[d] || (tgt.dz[d] = { imm: 0, act: 0 }); t.imm = t.imm * a + s.imm * b; }
  tgt.n += m;
}

export function consolidate(sim) { // merge identical pops within a cell
  for (let c = 0; c < sim.world.N; c++) {
    const l = sim.cellPops[c]; if (l.length < 2) continue;
    for (let i = 0; i < l.length; i++) for (let j = l.length - 1; j > i; j--) {
      const a = l[i], b = l[j];
      if (a.cul === b.cul && a.lang === b.lang && a.rel === b.rel) { mergeInto(a, b, b.n); sim.pops.delete(b.id); l.splice(j, 1); }
    }
  }
}

// ---------- culture & dialect drift ----------
export function culturalEvolution(sim) {
  const w = sim.world, rng = sim.rng; const par = sim.year & 1;
  for (const p of sim.pops.values()) {
    if ((p.id & 1) !== par) continue; // each pop updates every other year (rates doubled) to save time
    const c = p.c, sed = p.farm, herd = p.herd;
    const owner = sim.owner[c] >= 0 ? sim.orgs.get(sim.owner[c]) : null;
    const lvl = owner ? owner.level : 0;
    const path = sim.pathogen(c), war = Math.min(1, p.war * 5 + (owner && owner.wars.length ? 0.3 : 0));
    const plow = p.tech[TI.plow], irr = p._irr || 0;
    const tgt = [
      -0.6 + 0.8 * sed + 0.15 * lvl + 0.3 * herd,              // hierarchy
      -0.2 + 0.5 * irr + 0.4 * path - 0.2 * herd,                 // collectivism (rice/irrigation, pathogen stress)
      -0.3 + 0.6 * herd + 0.6 * war,                              // martial
      -0.1 + 0.5 * p.crisis + 0.2 * Math.min(1, lvl / 2),         // piety
      0.1 + 0.6 * p.urban * 3 - 0.4 * path - 0.3 * war,           // openness
      0.2 + 0.3 * path - 0.7 * p.urban * 3,                       // tradition
      -0.4 + 2.5 * p.urban + 0.3 * (sim.coastal[c] ? 1 : 0),      // mercantile
      0.0 + 0.4 * herd + 0.2 * sed - 0.4 * (owner && owner.hasLaw ? 1 : 0), // kinship intensity
      -0.2 + 0.7 * herd - 0.3 * (owner ? Math.min(1, lvl / 2) : 0), // honor culture (herding, weak states)
      -0.3 + 0.7 * plow + 0.3 * herd,                             // patriarchy (plough hypothesis)
    ];
    const drift = 0.012 * 1.414 / Math.sqrt(p.n / 2000 + 1);
    for (let k = 0; k < NTR; k++) p.tr[k] = clamp(p.tr[k] + 0.004 * (tgt[k] - p.tr[k]) + (rng.next() - 0.5) * 3.46 * drift, -1, 1); // uniform noise with matching variance
    for (let k = 0; k < NDIA; k++) p.dia[k] += (rng.next() - 0.5) * 3.46 * 0.0085;
    // conformity with a random contact
    const q = sim.randomContact(p); if (!q) continue;
    if (q.cul === p.cul) for (let k = 0; k < NTR; k++) p.tr[k] += 0.06 * (q.tr[k] - p.tr[k]);
    else { const o = 0.008 * (1 + p.tr[4]); for (let k = 0; k < NTR; k++) p.tr[k] += o * (q.tr[k] - p.tr[k]); }
    if (q.lang === p.lang) for (let k = 0; k < NDIA; k++) p.dia[k] += 0.08 * (q.dia[k] - p.dia[k]);
  }
}

// ---------- technology ----------
export function technology(sim) {
  const rng = sim.rng, w = sim.world;
  for (const p of sim.pops.values()) {
    // effective connected population: own + share of neighbours (social learning network)
    const c = p.c; let neff = p.n; for (let k = 0; k < 8; k++) { const j = w.nbr[c * 8 + k]; if (j >= 0) neff += 0.3 * sim.cellN[j]; }
    neff += 0.5 * (sim.cellN[c] - p.n);
    if (sim.owner[c] >= 0) { const o = sim.orgs.get(sim.owner[c]); if (o) neff += 0.15 * o.popTotal; }
    p._neff = neff;
    const im = innovationMult(p.tech) * (1 + 0.3 * p.urban * 3) * (1 - 0.3 * p.tr[5]) * clamp(p._patron || 1, 0.5, 2); p._patron = 1; // patronage effects are set afresh each year by orgs/rulers
    // discovery: one random candidate per pop-year keeps cost O(pops)
    const t = TECHS[rng.int(0, NT - 1)];
    if (!p.tech[t.idx] && t.E > 0 && prereqOk(p, t) && envOk(sim, p, t)) {
      let need = 1; if (t.id === 'cultivation' || t.crop || t.animal) need = 1 + 2 * Math.max(0, 1 - p.food) + (sim.climate.V < 0.15 ? 1 : 0);
      // a connected region invents at a rate sub-linear in its population; each pop holds its share of that chance
      const lam = Math.pow(neff / 1e5, 0.6) * (p.n / neff) * im * need / t.E * NT; // xNT: we sample one tech per year
      if (rng.chance(1 - Math.exp(-lam))) { if (globalThis.DBG) console.log("INV", sim.year, t.id, "lam", lam.toExponential(2), "neff", Math.round(neff), "n", Math.round(p.n), "im", im.toFixed(2), "need", need, "E", Math.round(t.E)); p.tech[t.idx] = 1; sim.onInvent(p, t); }
    }
    // diffusion from a contact
    const q = sim.randomContact(p, true);
    if (q) {
      const open = 0.012 * (1 + 0.5 * p.tr[4] - 0.4 * p.tr[5]) * (q.cul === p.cul ? 2 : 1);
      for (let k = 0; k < NT; k++) if (q.tech[k] && !p.tech[k]) { const tk = TECHS[k]; const sub = tk.crop || tk.animal || tk.id === 'cultivation' ? 0.15 * (0.5 + Math.max(0, 1 - p.food)) : 1; if (prereqOk(p, tk) && envOk(sim, p, tk, true) && rng.chance(open * sub)) { p.tech[k] = 1; } }
    }
    // loss (Henrich's Tasmania effect): complex skills decay in small isolated groups
    if (rng.chance(0.02)) { const t2 = TECHS[rng.int(0, NT - 1)]; if (p.tech[t2.idx] && !t2.start && t2.cplx > neff * 1.5 && rng.chance(0.15)) { p.tech[t2.idx] = 0; sim.onLoseTech(p, t2); } }
  }
}
export function prereqOk(p, t) { for (const i of t.preIdx) if (!p.tech[i]) return false; return true; }
export function envOk(sim, p, t, diffusing = false) {
  const w = sim.world, c = p.c, cl = sim.climate;
  if (t.needSedentary && p.farm + p.herd < t.needSedentary && !(sim.cellN[c] / w.area[c] > 0.3)) return false;
  if (t.needDensity && sim.cellN[c] / w.area[c] < t.needDensity && !diffusing) return false;
  if (t.needCrop && !CROP_TECH.some(i => p.tech[i])) return false;
  if (t.needPolity) { const o = sim.owner[c] >= 0 ? sim.orgs.get(sim.owner[c]) : null; if (!o || o.level < t.needPolity) return false; }
  if (t.needStable && !diffusing && (cl.V > 0.35)) return false; // glacial climate too variable & low-CO2 (Richerson et al. 2001)
  if (!t.env) return true;
  const e = t.env;
  if (e === 'cold') return cl.T[c] < 18;
  if (e === 'water') return sim.coastal[c] || w.discharge[c] > 50;
  if (e === 'grass') return cl.P[c] > 150 && cl.P[c] < 1500;
  if (e === 'coast') return sim.coastal[c];
  if (e === 'river') return w.discharge[c] > 30;
  if (e === 'wildcrop') { for (let k = 0; k < CROPS.length; k++) if (w.cropWild[c * CROPS.length + k]) return true; return diffusing; }
  if (e === 'irrigable') return w.discharge[c] > 20 && (cl.P[c] < 700 || diffusing);
  if (e === 'draft') return ANIMALS.some((a, k) => a.draft && p.tech[ANIMAL_TECH[k]]);
  if (e === 'dairyanimal') return ANIMALS.some((a, k) => a.dairy && p.tech[ANIMAL_TECH[k]]);
  if (e.startsWith('crop:')) { const k = CROPS.findIndex(x => x.id === e.slice(5)); if (diffusing) return w.cropNiche(CROPS[k], c, cl.T[c], cl.P[c]) > 0.05 || true; return w.cropWild[c * CROPS.length + k] === 1; }
  if (e.startsWith('animal:')) { const k = ANIMALS.findIndex(x => x.id === e.slice(7)); if (diffusing) return true; return w.animalWild[c * ANIMALS.length + k] === 1; }
  if (e.startsWith('ore:')) { const o = e.slice(4); if (w.ore[o][c]) return true; for (let k = 0; k < 8; k++) { const j = w.nbr[c * 8 + k]; if (j >= 0 && w.ore[o][j]) return true; } return diffusing && o !== 'tin' ? true : (diffusing && sim.tradeAccess(c, o)); }
  return true;
}

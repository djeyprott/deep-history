// Historical figures: Big-Five personalities (partly heritable, shaped by culture), skills that grow with
// use, goals derived from personality, memories that drive opinions, Siler-model mortality, families.
import { clamp, sigmoid } from './rng.js';
import { TI } from './tech.js';

export const GOALS = ['power', 'wealth', 'faith', 'knowledge', 'glory', 'family'];
export const SKILLS = ['mil', 'dip', 'adm', 'int', 'lrn'];
export const SKILL_NAMES = { mil: 'Martial', dip: 'Diplomacy', adm: 'Stewardship', int: 'Intrigue', lrn: 'Learning' };

export function makePerson(sim, o) {
  const rng = sim.rng; const C = sim.cultures.get(o.cul); const tr = C ? C.centroid : new Float32Array(10);
  const fa = o.father ? sim.persons.get(o.father) : null, mo = o.mother ? sim.persons.get(o.mother) : null;
  const female = o.female ?? rng.chance(0.5);
  // cultural shaping of trait means (small effects; most variance is individual)
  const mean = { O: 0.3 * tr[4] - 0.25 * tr[5], C: 0.2 * tr[1] + 0.15 * tr[5], E: 0.15 * tr[2] + 0.1 * tr[8], A: -0.25 * tr[2] - 0.15 * tr[8] + 0.15 * tr[1], N: 0 };
  const pers = {};
  for (const k of ['O', 'C', 'E', 'A', 'N']) {
    let v = mean[k] + rng.normal(0, 1);
    if (fa && mo) v = 0.45 * (fa.pers[k] + mo.pers[k]) / 2 + 0.55 * v; // ~40-50% heritability
    else if (fa || mo) v = 0.3 * (fa || mo).pers[k] + 0.7 * v;
    pers[k] = clamp(v, -3, 3);
  }
  const L = sim.languages.get(o.lang);
  const elite = (o.status ?? 1) >= 1;
  const sk = {
    mil: 6 + 1.8 * pers.E - 1.2 * pers.A + 1.5 * tr[2] + rng.normal(0, 2),
    dip: 6 + 1.8 * pers.A + 1.5 * pers.E - 0.8 * pers.N + rng.normal(0, 2),
    adm: 6 + 2.4 * pers.C - 0.5 * pers.N + rng.normal(0, 2),
    int: 6 - 1.3 * pers.A + 1.2 * pers.O + 0.8 * pers.N + rng.normal(0, 2),
    lrn: 5 + 2.4 * pers.O + 1.0 * pers.C + rng.normal(0, 2),
  };
  for (const k in sk) sk[k] = clamp(sk[k] + (elite ? 2 : 0), 0, 20);
  const p = {
    id: sim.nextId++, female, born: o.born ?? sim.year, died: null, cause: null,
    name: L ? L.personName(female, rng) : 'Nameless', dyn: o.dyn ?? null,
    cell: o.cell, cul: o.cul, rel: o.rel, lang: o.lang,
    fa: o.father || null, mo: o.mother || null, sp: null, kids: [],
    pers, sk, piety: clamp(0.4 * (tr[3] || 0) + rng.normal(0, 0.6), -1, 1),
    ambition: sigmoid(0.9 * pers.E - 0.8 * pers.A + 0.4 * pers.C - 0.3 * pers.N + rng.normal(0, 0.6)),
    health: 1, wealth: 0, prestige: 0, roles: new Set(), mem: new Map(), bio: [], tags: new Set(), goals: null, active: true, notable: false,
    org: o.org ?? null, // primary organisation affiliation
  };
  p.goals = computeGoals(sim, p);
  sim.persons.set(p.id, p);
  if (fa) fa.kids.push(p.id); if (mo) mo.kids.push(p.id);
  return p;
}
export function computeGoals(sim, p) {
  const C = sim.cultures.get(p.cul); const tr = C ? C.centroid : new Float32Array(10); const pe = p.pers;
  const s = {
    power: 1.4 * p.ambition + 0.3 * pe.E - 0.2 * pe.A,
    wealth: 0.4 * pe.C + 0.6 * tr[6] + 0.2 * p.ambition - 0.2 * p.piety,
    faith: 1.1 * p.piety + 0.2 * pe.O * p.piety + 0.2 * pe.N,
    knowledge: 0.9 * pe.O + 0.3 * pe.C - 0.3,
    glory: 0.5 * pe.E + 0.7 * tr[2] + 0.3 * tr[8] - 0.4 * pe.A,
    family: 0.5 * pe.A + 0.4 * pe.N + 0.4 * tr[7],
  };
  const ex = GOALS.map(g => Math.exp(2 * s[g])); const z = ex.reduce((a, b) => a + b, 0);
  const out = {}; GOALS.forEach((g, i) => out[g] = ex[i] / z); return out;
}
export function topGoal(p) { let b = null, v = -1; for (const g in p.goals) if (p.goals[g] > v) { v = p.goals[g]; b = g; } return b; }
export const age = (sim, p) => sim.year - p.born;
export function title(sim, p) { const r = [...p.roles].map(rid => { const [oid, t] = rid.split(':'); const o = sim.orgs.get(+oid); return o ? `${t} of ${o.name}` : null; }).filter(Boolean); return r[0] || null; }
export function fullName(sim, p) { if (!p) return 'someone'; const D = p.dyn ? sim.dynasties.get(p.dyn) : null; return p.name + (D ? ' ' + D.name : ''); }
export function bio(sim, p, text) { p.bio.push({ y: sim.year, t: text }); if (p.bio.length > 60) p.bio.splice(0, p.bio.length - 60); }
export function describePersonality(p) {
  const d = []; const P = p.pers;
  if (P.O > 1) d.push('curious'); if (P.O < -1) d.push('conventional');
  if (P.C > 1) d.push('diligent'); if (P.C < -1) d.push('reckless');
  if (P.E > 1) d.push('bold'); if (P.E < -1) d.push('reserved');
  if (P.A > 1) d.push('kind'); if (P.A < -1) d.push('ruthless');
  if (P.N > 1) d.push('anxious'); if (P.N < -1) d.push('calm');
  if (p.ambition > 0.8) d.push('ambitious'); if (p.piety > 0.6) d.push('devout'); if (p.piety < -0.5) d.push('skeptical');
  return d.length ? d.join(', ') : 'unremarkable';
}

// ---------- opinions ----------
export function addMem(sim, a, b, v, why) {
  if (!a || !b || a === b) return; const m = a.mem.get(b.id) || { v: 0, y: sim.year, why: [] };
  m.v = m.v * Math.exp(-(sim.year - m.y) / 25) + v; m.y = sim.year; if (why) { m.why.push(why); if (m.why.length > 4) m.why.shift(); }
  a.mem.set(b.id, m);
  if (a.mem.size > 80) { let wk = null, wv = 1e9; for (const [k, x] of a.mem) { const e = Math.abs(x.v * Math.exp(-(sim.year - x.y) / 25)); if (e < wv) { wv = e; wk = k; } } a.mem.delete(wk); }
}
export function opinion(sim, a, b) {
  if (!a || !b) return 0; if (a === b) return 100;
  let o = 6 * a.pers.A - 4 * Math.abs(a.pers.O - b.pers.O) - 3 * Math.abs(a.pers.C - b.pers.C) + 3;
  if (a.cul === b.cul) o += 10; else { const C = sim.cultures.get(a.cul); o -= 6 * (1 - (C ? C.centroid[4] : 0)); }
  if (a.rel === b.rel) o += 6 + 8 * Math.max(0, a.piety);
  else { const R = sim.religions.get(a.rel); o -= 4 + 18 * Math.max(0, a.piety) * (R ? 0.3 + R.tenets.excl : 0.5); }
  if (a.sp === b.id) o += 30; if (b.fa === a.id || b.mo === a.id) o += 35; if (a.fa === b.id || a.mo === b.id) o += 30;
  if (a.fa && a.fa === b.fa) o += 12;
  if (a.dyn && a.dyn === b.dyn) o += 8;
  o += 0.6 * (b.sk.dip - 8);
  const m = a.mem.get(b.id); if (m) o += m.v * Math.exp(-(sim.year - m.y) / 25);
  return clamp(o, -100, 100);
}
export function opinionReasons(sim, a, b) {
  const r = []; if (a.cul !== b.cul) r.push('different culture'); if (a.rel !== b.rel) r.push('different faith');
  if (a.sp === b.id) r.push('spouse'); if (b.fa === a.id || b.mo === a.id) r.push('their child'); if (a.fa === b.id || a.mo === b.id) r.push('their parent');
  const m = a.mem.get(b.id); if (m && m.why.length) r.push(...m.why);
  return r;
}

// ---------- life course ----------
const SILER = { a1: 0.35, b1: 1.0, a2: 0.011, a3: 0.00016, b3: 0.085 }; // pre-modern elite hazard (cf. Gurven & Kaplan 2007)
export function hazard(sim, p) {
  const x = age(sim, p);
  let h = SILER.a1 * Math.exp(-SILER.b1 * x) + SILER.a2 + SILER.a3 * Math.exp(SILER.b3 * x);
  const pops = sim.cellPops[p.cell] || [];
  let food = 1, epi = 0; for (const q of pops) { food = Math.min(food, q.food); for (const d in q.dz) if (q.dz[d].act) { const D = sim.diseases.get(+d); if (D) epi = Math.max(epi, D.cfr * 0.25); } }
  if (food < 1) h += 0.15 * (1 - food); h += epi;
  if (pops[0] && pops[0].tech[TI.medicine]) h *= 0.9;
  return h * (2 - p.health);
}

export function lifeYear(sim, P) {
  const rng = sim.rng; const dead = [];
  for (const p of sim.persons.values()) {
    if (!p.active) continue;
    const a = age(sim, p);
    if (rng.chance(hazard(sim, p))) { dead.push([p, a < 5 ? 'childhood illness' : a > 60 ? 'old age' : rng.pick(['illness', 'fever', 'an accident', 'illness', 'a wasting sickness'])]); continue; }
    if (rng.chance(0.01)) p.health = clamp(p.health - rng.range(0.1, 0.4), 0.2, 1); else p.health = clamp(p.health + 0.02, 0, 1);
    // births: married women 16-45
    if (p.female && p.sp && a >= 16 && a <= 45) {
      const s = sim.persons.get(p.sp);
      if (s && !s.died && rng.chance(a < 35 ? 0.28 : 0.14)) {
        if (rng.chance(0.008)) { dead.push([p, 'childbirth']); continue; }
        if (P.familyMatters(sim, p) || P.familyMatters(sim, s)) {
          const k = makePerson(sim, { cell: p.cell, cul: s.cul, rel: s.rel, lang: s.lang, father: s.id, mother: p.id, dyn: s.dyn || p.dyn, status: 1 });
          bio(sim, s, `Birth of ${k.female ? 'daughter' : 'son'} ${k.name}`); bio(sim, p, `Birth of ${k.female ? 'daughter' : 'son'} ${k.name}`);
        }
      }
    }
    // coming of age: those with no role and no close tie to power fade from the record
    if (a >= 16 && a % 4 === 0 && !p.roles.size && !P.familyMatters(sim, p) && !p.tags.has('prophet') && !p.notable) { p.active = false; P.retire(sim, p); }
  }
  for (const [p, cause] of dead) P.killPerson(sim, p, cause);
}

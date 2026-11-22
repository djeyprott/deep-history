// Organisations (polities, churches, guilds, merchant houses, banks, gangs, monastic orders, mercenary companies),
// their internal power struggles, diplomacy between leaders, and war.
import { clamp, sigmoid } from './rng.js';
import { TI, TECHS, militaryMult, defenseMult, adminReach, techLevel, NT } from './tech.js';
import { makePerson, opinion, addMem, bio, fullName, age, lifeYear, topGoal, describePersonality } from './people.js';
import { makeReligion } from './identity.js';
import { removePop, newPop } from './pops.js';

export const ORG_KINDS = { polity: 'Polity', church: 'Church', guild: 'Guild', merchant: 'Merchant house', bank: 'Bank', gang: 'Bandit gang', order: 'Religious order', mercenary: 'Mercenary company' };

// =========================================================== helpers
const P = id => null;
export function leaderOf(sim, o) { return o && o.leader ? sim.persons.get(o.leader) : null; }
function L(sim, o) { return leaderOf(sim, o); }
function langOf(sim, id) { return sim.languages.get(id) || [...sim.languages.values()].find(l => !l.dead); }
function evt(sim, cat, text, refs = {}) { return sim.logEvent(cat, text, refs); }
function pname(sim, p) { return fullName(sim, p); }
function tag(sim, p) { const o = p && p.org ? sim.orgs.get(p.org) : null; return p ? `${pname(sim, p)}${o && o.leader === p.id ? ' of ' + o.name : ''}` : 'someone'; }

export function familyMatters(sim, p) {
  if (p.roles.size || p.tags.has('heir')) return true;
  const rel = [p.fa, p.mo, p.sp].map(i => i && sim.persons.get(i)).filter(Boolean);
  for (const r of rel) if (r.active && !r.died && r.roles.size) return true;
  // grandchildren of leaders
  const f = p.fa && sim.persons.get(p.fa); if (f && f.fa) { const g = sim.persons.get(f.fa); if (g && !g.died && [...g.roles].some(x => x.endsWith(':leader'))) return true; }
  return false;
}
export function retire(sim, p) { archiveOrDrop(sim, p); }
function archiveOrDrop(sim, p) {
  if (p.notable) { sim.archive = sim.archive || new Map(); sim.archive.set(p.id, p); p.mem = new Map(); }
  sim.persons.delete(p.id);
}
export function killPerson(sim, p, cause, killer = null) {
  if (!p || p.died) return;
  p.died = sim.year; p.cause = cause; p.active = false;
  bio(sim, p, `Died (${cause}) aged ${age(sim, p)}`);
  const roles = [...p.roles];
  const isLeader = roles.some(r => r.endsWith(':leader'));
  if (p.notable || isLeader) evt(sim, 'death', `${pname(sim, p)}${isLeader ? ', ' + roleText(sim, roles.find(r => r.endsWith(':leader'))) + ',' : ''} dies (${cause}) aged ${age(sim, p)}`, { person: p.id, important: isLeader && bigOrg(sim, roles) && sim.rng.chance(0.5) });
  if (killer) for (const kid of [p.sp, ...p.kids, p.fa, p.mo]) { const k = kid && sim.persons.get(kid); if (k && !k.died) addMem(sim, k, killer, -70, `killed ${p.name}`); }
  for (const r of roles) { const [oid, t] = r.split(':'); const o = sim.orgs.get(+oid); if (!o) continue; vacate(sim, o, p, t); }
  p.roles.clear();
  if (p.sp) { const s = sim.persons.get(p.sp); if (s) { s.sp = null; s.widowed = p.id; } }
  if (p.roles.size === 0) { p.notable = p.notable || isLeader; archiveOrDrop(sim, p); }
  sim._dirtyLeaders = true;
}
function bigOrg(sim, roles) { return roles.some(r => { const o = sim.orgs.get(+r.split(':')[0]); return o && (o.kind === 'church' || o.level >= 3); }); }
function roleText(sim, r) { const [oid, t] = r.split(':'); const o = sim.orgs.get(+oid); return o ? `${titleOf(sim, o, t)} of ${o.name}` : t; }

function makeDynasty(sim, lang, founder) {
  const Lg = langOf(sim, lang); const D = { id: sim.nextId++, name: Lg ? Lg.dynastyName(sim.rng) : 'House', founder: founder ? founder.id : null, born: sim.year, prestige: 0 };
  sim.dynasties.set(D.id, D); return D;
}

// =========================================================== organisations
export function makeOrg(sim, kind, o) {
  const org = {
    id: sim.nextId++, kind, name: o.name, born: sim.year, dead: null, cul: o.cul, rel: o.rel, lang: o.lang, capital: o.capital ?? -1, seat: o.seat ?? o.capital ?? -1,
    leader: null, offices: [], succ: o.succ || 'elective', dyn: null, wealth: o.wealth || 0, legit: 0.6, level: kind === 'polity' ? 1 : 0, place: o.place || o.name,
    overlord: -1, vassals: new Set(), rels: new Map(), wars: [], hist: [], tax: 0.08, popTotal: 0, cells: 0, cellList: [], army: 0, exhaustion: 0,
    tradePartners: new Set(), ores: new Set(), hasLaw: false, tech: new Uint8Array(NT), color: o.color || [sim.rng.int(40, 220), sim.rng.int(40, 220), sim.rng.int(40, 220)],
    debts: [], loans: [], parent: o.parent ?? null, religionOf: o.religionOf ?? null, members: 0, strength: 0, men: 0, quality: 1, rev: 0, factions: [], peakPop: 0, peakCells: 0, sub: o.sub || null,
  };
  sim.orgs.set(org.id, org); sim._liveDirty = true;
  return org;
}
function hist(sim, o, t) { o.hist.push({ y: sim.year, t }); if (o.hist.length > 80) o.hist.shift(); }
export function titleOf(sim, o, t) {
  if (t !== 'leader') return t;
  const fem = (() => { const l = L(sim, o); return l && l.female; })();
  if (o.kind === 'polity') {
    if (o.succ === 'republic') return 'Consul'; if (o.succ === 'theocracy') return 'Priest-King';
    return [null, fem ? 'Chieftess' : 'Chief', fem ? 'High Chieftess' : 'High Chief', fem ? 'Queen' : 'King', fem ? 'Empress' : 'Emperor'][o.level] || 'Ruler';
  }
  return { church: 'High Priest', guild: 'Guildmaster', merchant: 'Head of House', bank: 'Banker', gang: 'Bandit Chief', order: 'Abbot', mercenary: 'Captain' }[o.kind] || 'Leader';
}
export function orgLabel(sim, o) {
  if (o.kind !== 'polity') return ORG_KINDS[o.kind];
  if (o.succ === 'republic' && o.level >= 2) return 'Republic'; if (o.succ === 'theocracy' && o.level >= 2) return 'Theocracy';
  return [null, o.succ === 'elective' ? 'Tribe' : 'Chiefdom', 'Chiefdom', 'Kingdom', 'Empire'][o.level];
}
function renamePolity(sim, o) { o.name = `${orgLabel(sim, o)} of ${o.place}`; }

function setRole(sim, o, p, t, quiet = false) {
  const off = t === 'leader' ? null : o.offices.find(x => x.t === t);
  if (t === 'leader') { const old = L(sim, o); if (old && old !== p) old.roles.delete(`${o.id}:leader`); o.leader = p.id; o.leaderSince = sim.year; }
  else if (off) { const old = off.h && sim.persons.get(off.h); if (old) old.roles.delete(`${o.id}:${t}`); off.h = p.id; }
  p.roles.add(`${o.id}:${t}`); p.org = p.org || o.id; p.notable = p.notable || t === 'leader' || (o.kind === 'polity' ? o.level >= 2 : o.wealth > 50);
  bio(sim, p, `Became ${titleOf(sim, o, t)} of ${o.name}`);
  if (t !== 'leader') { const l = L(sim, o); if (l) addMem(sim, p, l, 12, 'granted office'); }
}
function vacate(sim, o, p, t) {
  if (t === 'leader') { if (o.leader === p.id) { o.leader = null; o._vacantSince = sim.year; o._deadLeader = p; } }
  else { const off = o.offices.find(x => x.t === t && x.h === p.id); if (off) off.h = null; }
}

// =========================================================== polity founding
function cultureTraits(sim, cul) { const C = sim.cultures.get(cul); return C ? C.centroid : new Float32Array(10); }
function chooseSucc(sim, tr, urban) {
  const r = sim.rng;
  if (tr[0] < -0.15) return 'elective';
  if (tr[6] > 0.35 && urban > 0.08 && r.chance(0.5)) return 'republic';
  if (tr[7] > 0.25) return r.chance(0.5) ? 'seniority' : 'tanistry';
  return r.chance(0.8) ? 'primogeniture' : 'tanistry';
}
function femaleLeaderChance(tr) { return clamp(0.45 - 0.42 * (tr[9] + 1) / 2 * 2, 0.02, 0.45); }

export function newRuler(sim, o, cell, cul, rel, lang, dyn = null, ageMin = 22, ageMax = 45) {
  const tr = cultureTraits(sim, cul);
  const p = makePerson(sim, { cell, cul, rel, lang, female: sim.rng.chance(femaleLeaderChance(tr)), born: sim.year - sim.rng.int(ageMin, ageMax), status: 1, org: o.id });
  if (!dyn) { const D = makeDynasty(sim, lang, p); p.dyn = D.id; } else p.dyn = dyn;
  // spouse & children
  if (sim.rng.chance(0.8)) {
    const s = makePerson(sim, { cell, cul, rel, lang, female: !p.female, born: p.born + sim.rng.int(-6, 6), status: 1, org: o.id });
    p.sp = s.id; s.sp = p.id; const kids = sim.rng.int(0, 4);
    for (let k = 0; k < kids; k++) { const a = age(sim, p) - sim.rng.int(18, 40); if (a < 0) continue; const c = makePerson(sim, { cell, cul, rel, lang, father: p.female ? s.id : p.id, mother: p.female ? p.id : s.id, dyn: p.dyn, born: sim.year - a, status: 1 }); c.org = o.id; }
  }
  return p;
}
function foundPolity(sim, c, pop, how = 'emerge') {
  const C = sim.cultures.get(pop.cul), Lg = langOf(sim, pop.lang); if (!C || !Lg) return null;
  const tr = C.centroid; const place = Lg.placeName(sim.rng);
  const o = makeOrg(sim, 'polity', { name: '', cul: pop.cul, rel: pop.rel, lang: pop.lang, capital: c, place, succ: chooseSucc(sim, tr, pop.urban), color: C.color.map(v => clamp(v + sim.rng.int(-35, 35), 25, 235)) });
  renamePolity(sim, o);
  const lead = newRuler(sim, o, c, pop.cul, pop.rel, pop.lang);
  setRole(sim, o, lead, 'leader'); o.dyn = lead.dyn; lead.tags.add('founder');
  o.offices = [{ t: 'Elder', h: null, w: 1, k: 'council' }, { t: 'Elder ', h: null, w: 1, k: 'council' }, { t: 'War leader', h: null, w: 1.3, k: 'council' }];
  setOwner(sim, c, o);
  o.tech = Uint8Array.from(pop.tech);
  hist(sim, o, `Founded by ${pname(sim, lead)}`);
  if (how === 'emerge') evt(sim, 'polity', `${pname(sim, lead)} unites the ${C.name} villages near ${sim.world.cellName(c)}, founding the ${o.name}`, { org: o.id, person: lead.id, cell: c, important: sim.polityCount === undefined || sim.polityCount < 3 });
  sim.polityCount = (sim.polityCount || 0) + 1;
  return o;
}
export function setOwner(sim, c, o) {
  const prev = sim.owner[c] >= 0 ? sim.orgs.get(sim.owner[c]) : null;
  sim.owner[c] = o ? o.id : -1;
  if (prev && prev.capital === c && prev !== o) prev._lostCapital = true;
}
export function loseCell(sim, c) { setOwner(sim, c, null); }

// =========================================================== yearly loop
export function initPolitics(sim) { sim.firstTech = {}; sim.archive = new Map(); for (const t of TECHS) for (const p of sim.pops.values()) if (p.tech[t.idx]) { sim.firstTech[t.id] = { y: sim.year, c: p.c }; break; } }

export function liveOrgs(sim) {
  if (!sim._live || sim._liveDirty) { sim._live = []; for (const o of sim.orgs.values()) if (!o.dead) sim._live.push(o); sim._liveDirty = false; }
  return sim._live;
}
function buildIndex(sim) {
  const byOrg = new Map(), byDyn = new Map();
  for (const p of sim.persons.values()) {
    if (!p.active || p.died) continue;
    if (p.org) { let a = byOrg.get(p.org); if (!a) byOrg.set(p.org, a = []); a.push(p); }
    if (p.dyn) { let a = byDyn.get(p.dyn); if (!a) byDyn.set(p.dyn, a = []); a.push(p); }
  }
  sim.byOrg = byOrg; sim.byDyn = byDyn;
}
export function politicsYear(sim) {
  lifeYear(sim, { familyMatters, retire, killPerson });
  buildIndex(sim);
  census(sim);
  emergence(sim);
  const pol = liveOrgs(sim).filter(o => o.kind === 'polity');
  for (const o of pol) { if (o.dead) continue; polityEconomy(sim, o); }
  for (const o of liveOrgs(sim)) if (!o.dead) ensureLeadership(sim, o);
  for (const o of pol) { if (o.dead) continue; controlAndUnrest(sim, o); fillOffices(sim, o); internalPolitics(sim, o); }
  for (const o of pol) { if (o.dead || !o.leader) continue; leaderActions(sim, o); }
  warsYear(sim);
  otherOrgs(sim);
  religionEvents(sim);
  personalActions(sim);
  for (const o of liveOrgs(sim)) if (!o.dead && o.kind === 'polity' && o.cells === 0 && sim.year - o.born > 0) dissolve(sim, o, 'lost all its lands');
  let n = 0; for (const p of sim.persons.values()) if (p.active) n++; sim.livingPersons = n;
}

function census(sim) {
  const w = sim.world;
  for (const o of liveOrgs(sim)) if (o.kind === 'polity') { o.cellList = []; o.popTotal = 0; o.urbanPop = 0; o.surplus = 0; o.ores = new Set(); o.culMix = new Map(); }
  for (let c = 0; c < w.N; c++) {
    const id = sim.owner[c]; if (id < 0) continue; const o = sim.orgs.get(id);
    if (!o || o.dead || !w.land[c]) { sim.owner[c] = -1; continue; }
    o.cellList.push(c); o.popTotal += sim.cellN[c]; o.urbanPop += sim.cellUrban[c];
    for (const p of sim.cellPops[c]) { o.surplus += p.surplus * p.n / Math.max(1, p.n); o.culMix.set(p.cul, (o.culMix.get(p.cul) || 0) + p.n); }
    for (const ore of ['copper', 'tin', 'iron', 'gold', 'salt']) if (w.ore[ore][c]) o.ores.add(ore);
  }
  for (const o of liveOrgs(sim)) {
    if (o.kind !== 'polity' || o.dead) continue;
    o.cells = o.cellList.length; o.peakPop = Math.max(o.peakPop, o.popTotal); o.peakCells = Math.max(o.peakCells, o.cells);
    if (o.cells && (sim.owner[o.capital] !== o.id || o._lostCapital)) { // move capital to most populous remaining cell
      let best = o.cellList[0]; for (const c of o.cellList) if (sim.cellN[c] > sim.cellN[best]) best = c; o.capital = best; o._lostCapital = false; hist(sim, o, 'Capital moved');
    }
    const cap = sim.cellPops[o.capital] || []; let bp = null; for (const p of cap) if (!bp || p.n > bp.n) bp = p;
    if (bp) { o.tech = bp.tech; o.capPop = bp; }
    o.hasLaw = !!o.tech[TI.law];
    const lead = L(sim, o);
    const hered = o.succ !== 'elective' && o.succ !== 'republic';
    let lvl = 1;
    if (o.popTotal > 20000 && (hered || o.cells >= 3)) lvl = 2;
    if (o.popTotal > 150000 && (o.tech[TI.accounting] || o.tech[TI.writing]) && o.urbanPop > 4000) lvl = 3;
    if (o.cells >= 25 && o.popTotal > 1.5e6 && o.culMix.size >= 3 && o.tech[TI.writing]) lvl = 4;
    if (lvl !== o.level) {
      const up = lvl > o.level; const old = o.name; o.level = lvl; renamePolity(sim, o);
      if (up && lvl >= 2) evt(sim, 'polity', `${old} grows into the ${o.name}${lead ? ' under ' + pname(sim, lead) : ''}`, { org: o.id, important: lvl >= 3 });
      hist(sim, o, `Became a ${orgLabel(sim, o).toLowerCase()}`);
    }
  }
}

function emergence(sim) {
  const w = sim.world, rng = sim.rng;
  for (let c = 0; c < w.N; c++) {
    if (sim.owner[c] >= 0 || sim.cellN[c] < 2500) continue;
    let bp = null; for (const p of sim.cellPops[c]) if (!bp || p.n > bp.n) bp = p;
    const sed = bp.farm + 0.7 * bp.herd;
    // rich aquatic foragers (e.g. salmon coasts) can be sedentary and ranked without farming
    const aquatic = sim.fishK[c] * 0.1 > sim.gameK[c] * 0.075 && bp.food > 1.05 && sim.cellN[c] > 8000 && sim.cellN[c] / w.area[c] > 0.25 && bp.tr[0] > 0.1 && bp.tech[TI.pottery];
    // villages acquire leaders once sedentary; hierarchy-favouring cultures sooner
    if ((sed > 0.35 || aquatic) && rng.chance(0.015 * (1 + bp.tr[0]) * Math.min(3, sim.cellN[c] / 10000))) foundPolity(sim, c, bp);
  }
}

function polityEconomy(sim, o) {
  const lead = L(sim, o);
  // revenue in person-years of food: taxed surplus + taxed urban crafts/trade
  let rev = 0;
  for (const c of o.cellList) {
    const ctl = sim.control[c];
    for (const p of sim.cellPops[c]) rev += (p.surplus * o.tax + p.n * p.urban * 0.04 * (1 + 0.5 * p.tech[TI.coinage])) * ctl;
  }
  rev *= 1 + 0.15 * o.tradePartners.size;
  const tributeOut = o.overlord >= 0 ? rev * 0.1 : 0;
  if (tributeOut > 0) { const ov = sim.orgs.get(o.overlord); if (ov && !ov.dead) ov.wealth += tributeOut; else o.overlord = -1; }
  const standing = o.level >= 3 ? o.popTotal * 0.003 : 0;
  const court = 0.05 * rev + o.offices.length * 2;
  let interest = 0; for (const d of o.debts) interest += d.amt * d.rate;
  o.rev = rev; o.wealth += rev - tributeOut - standing * 0.6 - court - interest;
  // debt service
  for (const d of [...o.debts]) {
    const pay = Math.min(d.amt, Math.max(0, o.wealth * 0.2)); d.amt -= pay; o.wealth -= pay; const B = sim.orgs.get(d.bank);
    if (B && !B.dead) B.wealth += pay + d.amt * d.rate;
    if (d.amt <= 0.5) o.debts.splice(o.debts.indexOf(d), 1);
  }
  if (o.wealth < -rev * 0.5 && o.level >= 2) seekLoan(sim, o, -o.wealth + rev);
  const debtTot = o.debts.reduce((s, d) => s + d.amt, 0);
  if (debtTot > Math.max(30, rev * 4) && lead && sim.rng.chance(0.15 * (1 - sigmoid(lead.pers.C)))) defaultDebts(sim, o);
  // leader adjusts tax: greedy & ambitious raise, agreeable lower; treasury shortfalls force increases
  if (lead) {
    const want = clamp(0.08 + 0.1 * lead.goals.wealth + 0.06 * lead.goals.power - 0.04 * lead.pers.A + (o.wealth < 0 ? 0.08 : 0) + (o.wars.length ? 0.05 : 0) + 0.03 * (o.level - 1), 0.03, 0.4);
    o.tax += (want - o.tax) * 0.2;
  }
  o.strength = militaryStrength(sim, o);
}
export function militaryStrength(sim, o) {
  const lead = L(sim, o); const marshal = officeHolder(sim, o, 'Marshal') || officeHolder(sim, o, 'War leader') || lead;
  const C = sim.cultures.get(o.cul); const mart = C ? C.centroid[2] : 0;
  const mob = o.level <= 2 ? 0.05 + 0.02 * mart : 0.012 + 0.025 * clamp(o.wealth / Math.max(1, o.popTotal * 0.01), 0, 1);
  let men = 0; for (const c of o.cellList) men += sim.cellN[c] * mob * (0.4 + 0.6 * sim.control[c]);
  let herd = 0; if (o.capPop) herd = o.capPop.herd;
  const q = militaryMult(o.tech) * (1 + 0.2 * mart) * (1 + (marshal ? (marshal.sk.mil - 8) / 25 : 0)) * (1 + 0.3 * herd * o.tech[TI.riding]) * (1 - 0.5 * o.exhaustion);
  o.men = men; o.quality = q;
  return men * q;
}
function officeHolder(sim, o, t) { const off = o.offices.find(x => x.t === t); return off && off.h ? sim.persons.get(off.h) : null; }

function controlAndUnrest(sim, o) {
  const w = sim.world; const reach = adminReach(o.tech) * (0.6 + 0.6 * o.legit);
  const lost = [];
  for (const c of o.cellList) {
    const d = w.dist(c, o.capital) * Math.sqrt(w.moveCost[c]);
    let ctl = Math.exp(-((d / reach) ** 2)) * (sim.cellCul[c] === o.cul ? 1 : 0.75);
    ctl = Math.max(ctl, c === o.capital ? 1 : 0);
    sim.control[c] += (ctl - sim.control[c]) * 0.2;
    // unrest
    let u = 0; for (const p of sim.cellPops[c]) {
      const R = sim.religions.get(p.rel);
      u += p.n * (0.4 * clamp(1 - p.food, 0, 1) + (p.rel !== o.rel ? 0.15 + 0.3 * (R ? R.tenets.excl : 0) : 0) + (p.cul !== o.cul ? 0.25 * (1 - (p.tr[4] + 1) / 2) : 0) + Math.max(0, o.tax - 0.12) * 1.2);
    }
    u = u / Math.max(1, sim.cellN[c]) + 0.25 * (1 - sim.control[c]) - 0.15 * o.legit;
    sim.unrest[c] += (clamp(u, 0, 1) - sim.unrest[c]) * 0.15;
    if (c !== o.capital && sim.control[c] < 0.08 && sim.rng.chance(0.05)) lost.push(c);
  }
  for (const c of lost) { setOwner(sim, c, null); if (sim.cellN[c] > 50000) evt(sim, 'polity', `The region around ${w.cellName(c)} slips from the control of the ${o.name}`, { org: o.id, cell: c }); }
  // peaceful growth: neighbouring unruled villages join if within reach
  const lead = L(sim, o);
  if (lead && sim.rng.chance(0.25 + 0.03 * lead.sk.adm)) {
    const c = sim.rng.pick(o.cellList); for (let k = 0; k < 8; k++) {
      const j = w.nbr[c * 8 + k]; if (j < 0 || !w.land[j] || sim.owner[j] >= 0 || sim.cellN[j] < 200) continue;
      const d = w.dist(j, o.capital); if (d > reach * 1.1) continue;
      const kin = sim.cellCul[j] === o.cul ? 1 : 0.4;
      if (sim.rng.chance(0.3 * kin)) { setOwner(sim, j, o); sim.control[j] = 0.4; break; }
    }
  }
  // provincial governors for larger realms
  if (o.level >= 3 && (sim.year % 20 === 0 || !o.offices.some(x => x.k === 'governor'))) assignProvinces(sim, o);
}
function assignProvinces(sim, o) {
  const w = sim.world; const want = Math.min(8, Math.floor(o.cells / 7));
  const govs = o.offices.filter(x => x.k === 'governor');
  while (govs.length > want) { const g = govs.pop(); const h = g.h && sim.persons.get(g.h); if (h) h.roles.delete(`${o.id}:${g.t}`); o.offices.splice(o.offices.indexOf(g), 1); }
  const far = o.cellList.filter(c => w.dist(c, o.capital) > 500).sort((a, b) => sim.cellN[b] - sim.cellN[a]);
  const centers = []; for (const c of far) { if (centers.length >= want) break; if (centers.every(x => w.dist(x, c) > 600)) centers.push(c); }
  centers.forEach((c, i) => {
    let g = govs[i]; const Lg = langOf(sim, sim.cellLang[c] >= 0 ? sim.cellLang[c] : o.lang);
    if (!g) { g = { t: `Governor of ${Lg ? Lg.placeName(sim.rng) : 'the march'}`, h: null, w: 2, k: 'governor', center: c }; o.offices.push(g); }
    g.center = c;
  });
  for (const g of o.offices) if (g.k === 'governor') g.cells = o.cellList.filter(c => { let best = null, bd = w.dist(c, o.capital) * 1.1; for (const h of o.offices) if (h.k === 'governor' && h.center !== undefined) { const d = w.dist(c, h.center); if (d < bd) { bd = d; best = h; } } return best === g; });
}

function ensureOffices(sim, o) {
  if (o.kind !== 'polity') return;
  const want = o.level >= 3 ? ['Chancellor', 'Marshal', 'Steward', 'Spymaster', 'High Priest'] : o.level === 2 ? ['Elder', 'War leader', 'Priest', 'Steward'] : ['Elder', 'Elder ', 'War leader'];
  for (const t of want) if (!o.offices.some(x => x.t === t)) o.offices.push({ t, h: null, w: t === 'Marshal' || t === 'War leader' ? 1.4 : t === 'Chancellor' ? 1.3 : 1, k: 'council' });
  for (const off of [...o.offices]) if (off.k === 'council' && !want.includes(off.t) && o.level >= 2) { const h = off.h && sim.persons.get(off.h); if (h) h.roles.delete(`${o.id}:${off.t}`); o.offices.splice(o.offices.indexOf(off), 1); }
}
function candidates(sim, o) {
  // court: dynasty members, existing office holders' kin, plus fresh local notables
  const out = []; const lead = L(sim, o);
  for (const p of (sim.byOrg && sim.byOrg.get(o.id)) || []) if (p.active && !p.died && age(sim, p) >= 16 && (p.org === o.id) && !p.roles.has(`${o.id}:leader`)) out.push(p);
  return out;
}
function fillOffices(sim, o) {
  ensureOffices(sim, o);
  const lead = L(sim, o); if (!lead) return;
  for (const off of o.offices) {
    const h = off.h && sim.persons.get(off.h); if (h && !h.died) continue; off.h = null;
    if (!sim.rng.chance(0.6)) continue;
    let pool = candidates(sim, o).filter(p => p.roles.size < 2 && ![...p.roles].some(r => r.startsWith(o.id + ':')));
    // the leader appoints: weighs competence, personal favour, and kinship (nepotism scales with kin-intensity culture)
    const kinW = 0.5 + cultureTraits(sim, o.cul)[7];
    const skill = off.t.includes('Marshal') || off.t.includes('War') ? 'mil' : off.t.includes('Spymaster') ? 'int' : off.t.includes('Priest') ? 'lrn' : off.t.includes('Steward') ? 'adm' : off.t.includes('Chancellor') ? 'dip' : 'adm';
    if (pool.length < 2 || sim.rng.chance(0.4)) {
      const c = off.center ?? o.capital; let bp = null; for (const p of sim.cellPops[c] || []) if (!bp || p.n > bp.n) bp = p;
      const np = makePerson(sim, { cell: c, cul: bp ? bp.cul : o.cul, rel: bp ? bp.rel : o.rel, lang: bp ? bp.lang : o.lang, born: sim.year - sim.rng.int(22, 50), status: 1, org: o.id });
      const D = makeDynasty(sim, np.lang, np); np.dyn = D.id; pool.push(np);
    }
    const best = sim.rng.weighted(pool, p => Math.exp(p.sk[skill] / 4 + opinion(sim, lead, p) / 30 + (p.dyn === lead.dyn ? kinW : 0)));
    if (best) { setRole(sim, o, best, off.t); if (o.level >= 3 && off.k === 'council') evt(sim, 'court', `${pname(sim, lead)} appoints ${pname(sim, best)} as ${off.t} of the ${o.name}`, { org: o.id, person: best.id }); }
  }
}

// ---------------------------------------------------------- succession
function heirs(sim, o, dead) {
  const alive = id => { const p = sim.persons.get(id); return p && !p.died && p.active !== false ? p : null; };
  const tr = cultureTraits(sim, o.cul); const malePref = tr[9] > 0.1; const out = [];
  if (!dead) return out;
  const kidsOf = q => q ? q.kids.map(alive).filter(Boolean).sort((a, b) => a.born - b.born) : [];
  const sortSex = arr => malePref ? arr.filter(p => !p.female).concat(arr.filter(p => p.female)) : arr;
  const dynMembers = ((sim.byDyn && sim.byDyn.get(o.dyn)) || []).filter(p => !p.died && p.active && p.id !== dead.id);
  if (o.succ === 'primogeniture') { out.push(...sortSex(kidsOf(dead))); for (const k of dead.kids) { const kk = sim.persons.get(k); if (kk) out.push(...sortSex(kidsOf(kk))); } const fa = dead.fa && sim.persons.get(dead.fa); out.push(...sortSex(kidsOf(fa).filter(p => p.id !== dead.id))); out.push(...dynMembers.sort((a, b) => a.born - b.born)); }
  else if (o.succ === 'seniority') { out.push(...dynMembers.filter(p => age(sim, p) >= 16 && (!malePref || !p.female)).sort((a, b) => a.born - b.born)); out.push(...sortSex(kidsOf(dead))); }
  else if (o.succ === 'tanistry') { out.push(...dynMembers.filter(p => age(sim, p) >= 16).sort((a, b) => (b.sk.mil + b.sk.dip + b.prestige / 10) - (a.sk.mil + a.sk.dip + a.prestige / 10))); }
  const leadsOther = p => [...p.roles].some(r => r.endsWith(':leader'));
  return [...new Set(out)].filter(p => p && !p.died && (!leadsOther(p) || p.fa === dead.id || p.mo === dead.id));
}
function ensureLeadership(sim, o) {
  if (o.leader) { const l = sim.persons.get(o.leader); if (l && !l.died) return; o.leader = null; }
  const dead = o._deadLeader || null; o._deadLeader = null;
  let next = null; let how = 'succeeds';
  if (o.kind === 'polity' && o.succ !== 'elective' && o.succ !== 'republic') {
    const hs = heirs(sim, o, dead); next = hs[0] || null;
    // rival claimants with more support can contest
    if (next && hs.length > 1) {
      const rival = hs.slice(1).find(h => age(sim, h) >= 16 && h.ambition > 0.65);
      if (rival) {
        const sup = cand => o.offices.reduce((s, off) => { const m = off.h && sim.persons.get(off.h); return s + (m ? off.w * Math.sign(opinion(sim, m, cand) - opinion(sim, m, cand === next ? rival : next)) : 0); }, 0);
        if (sup(rival) > sup(next) + 1) { startSuccessionWar(sim, o, next, rival); }
      }
    }
    if (next && age(sim, next) < 16) { // regency
      const reg = o.offices.map(x => x.h && sim.persons.get(x.h)).filter(Boolean).sort((a, b) => b.ambition - a.ambition)[0];
      if (reg && reg.ambition > 0.85 && reg.pers.A < -0.5 && sim.rng.chance(0.3)) { evt(sim, 'intrigue', `Regent ${pname(sim, reg)} pushes aside the child ${pname(sim, next)} and seizes the ${o.name}`, { org: o.id, person: reg.id, important: o.level >= 3 }); addMem(sim, next, reg, -80, 'usurped my throne'); next = reg; how = 'usurps'; o.legit = 0.35; o.dyn = reg.dyn; }
    }
  } else {
    // elections by council / members
    const electors = o.offices.map(x => x.h && sim.persons.get(x.h)).filter(p => p && !p.died);
    const pool = candidates(sim, o).filter(p => age(sim, p) >= 25);
    if (pool.length) {
      const score = c => electors.reduce((s, e) => s + opinion(sim, e, c), 0) + 10 * (c.sk.dip + c.sk.adm) / 10 + 20 * c.ambition + sim.rng.normal(0, 10);
      next = pool.sort((a, b) => score(b) - score(a))[0]; how = 'is chosen to lead';
    }
  }
  if (!next) {
    // nobody: a new figure rises (or org dissolves)
    if (o.kind === 'polity' && o.cells > 0) { let bp = null; for (const p of sim.cellPops[o.capital] || []) if (!bp || p.n > bp.n) bp = p; if (!bp) return; next = newRuler(sim, o, o.capital, bp.cul, bp.rel, bp.lang); how = 'rises to lead'; o.dyn = next.dyn; o.legit = 0.4; }
    else if (o.kind !== 'polity') { const seat = o.seat >= 0 ? o.seat : 0; const bp = (sim.cellPops[seat] || [])[0]; if (!bp || sim.rng.chance(0.25)) { dissolve(sim, o, 'had no one to lead it'); return; } next = makePerson(sim, { cell: seat, cul: bp.cul, rel: o.rel ?? bp.rel, lang: bp.lang, born: sim.year - sim.rng.int(25, 50), status: 1, org: o.id }); next.dyn = makeDynasty(sim, next.lang, next).id; how = 'takes over'; }
    else return;
  }
  // personal union: heir already leads another polity
  const other = [...next.roles].find(r => r.endsWith(':leader'));
  setRole(sim, o, next, 'leader'); next.org = o.id; next.tags.delete('heir');
  if (o.kind === 'polity' && how !== 'usurps') { o.dyn = next.dyn ?? o.dyn; o.legit = clamp(o.legit * 0.7 + 0.25, 0, 1); }
  if (other) { const o2 = sim.orgs.get(+other.split(':')[0]); if (o2 && o2.kind === 'polity' && o.kind === 'polity' && o.union !== o2.id) { evt(sim, 'diplomacy', `${pname(sim, next)} now rules both the ${o2.name} and the ${o.name} in personal union`, { org: o.id, person: next.id, important: o.level >= 3 || o2.level >= 3 }); o.union = o2.id; o2.union = o.id; } }
  if (o.kind !== 'polity' || o.level >= 2 || sim.rng.chance(0.05)) evt(sim, 'succession', `${pname(sim, next)} ${how} as ${titleOf(sim, o, 'leader')} of the ${o.name}${dead ? ` after ${pname(sim, dead)}` : ''}`, { org: o.id, person: next.id, important: o.kind === 'polity' && o.level >= 3 });
  hist(sim, o, `${pname(sim, next)} ${how}`);
  // heir flag for kids so they stay tracked
  for (const k of next.kids) { const kk = sim.persons.get(k); if (kk) kk.tags.add('heir'); }
}
function startSuccessionWar(sim, o, heir, rival) {
  evt(sim, 'war', `A succession crisis splits the ${o.name}: ${pname(sim, rival)} disputes the claim of ${pname(sim, heir)}`, { org: o.id, person: rival.id, important: o.level >= 2 });
  const gov = o.offices.filter(x => x.k === 'governor' && x.h && opinion(sim, sim.persons.get(x.h), rival) > opinion(sim, sim.persons.get(x.h), heir));
  const cells = gov.flatMap(g => g.cells || []);
  if (!cells.length) { const half = o.cellList.filter(c => c !== o.capital && sim.rng.chance(0.4)); cells.push(...half); }
  if (!cells.length) return;
  const reb = splitPolity(sim, o, cells, rival, `${rival.name}'s faction`);
  if (reb) declareWar(sim, reb, o, 'succession', { claimant: rival.id });
}

// ---------------------------------------------------------- internal power struggles
function internalPolitics(sim, o) {
  const lead = L(sim, o); if (!lead || !o.offices.length) return;
  const members = o.offices.map(x => ({ off: x, p: x.h && sim.persons.get(x.h) })).filter(x => x.p && !x.p.died);
  // outside power-brokers seated in the realm (church, guilds, banks, gangs) also take sides
  const brokers = [];
  for (const q of liveOrgs(sim)) if (!q.dead && q.kind !== 'polity' && q.seat >= 0 && sim.owner[q.seat] === o.id && q.leader) { const p = sim.persons.get(q.leader); if (p) brokers.push({ off: { w: clamp(q.wealth / 150, 0.2, 2), k: 'broker', org: q }, p }); }
  let loyal = 0.6 + o.legit * 2 + lead.sk.int / 10 + lead.prestige / 200; const disc = [];
  for (const m of members.concat(brokers)) {
    const op = opinion(sim, m.p, lead) + 30 * o.legit + (m.p.dyn === lead.dyn ? 15 : 0) - 35 * m.p.ambition;
    m.loy = op; if (op < -5) disc.push(m); else loyal += m.off.w;
  }
  o.factions = [];
  if (!disc.length) return;
  // the most ambitious, capable discontent member heads the faction
  disc.sort((a, b) => (b.p.ambition * 20 + b.p.sk.int + b.p.sk.mil) - (a.p.ambition * 20 + a.p.sk.int + a.p.sk.mil));
  const head = disc[0].p; let power = 0; for (const m of disc) power += m.off.w * (1 + (m.p.sk.int + m.p.sk.mil) / 30);
  const regions = disc.filter(m => m.off.k === 'governor').flatMap(m => m.off.cells || []);
  const goal = regions.length && sim.cellCul[regions[0]] !== o.cul ? 'independence' : 'replace';
  // foreign backers: rivals who dislike the ruler and like the claimant
  const backers = [];
  for (const q of neighbors(sim, o)) { const ql = L(sim, q); if (!ql) continue; if (opinion(sim, ql, lead) < -20 && opinion(sim, ql, head) > 0 && sim.rng.chance(0.3 + 0.3 * ql.sk.int / 20)) { backers.push(q.id); power += 0.25 * q.strength / Math.max(1, o.strength); } }
  const F = { head: head.id, members: disc.map(m => m.p.id), power, goal, backers }; o.factions.push(F);
  if (backers.length && sim.rng.chance(0.1)) evt(sim, 'intrigue', `${backers.map(b => sim.orgs.get(b).name).join(' and ')} secretly back${backers.length > 1 ? '' : 's'} ${pname(sim, head)} against ${pname(sim, lead)} of the ${o.name}`, { org: o.id, person: head.id });
  // ruler may strike first
  if (power > loyal * 0.6 && lead.pers.A < 0 && sim.rng.chance(0.15 + 0.2 * (lead.pers.N > 0 ? 1 : 0))) {
    const ok = sim.rng.chance(lead.sk.int / (lead.sk.int + head.sk.int + 1) + 0.15);
    if (ok) { const fate = lead.pers.A < -1 ? 'executed' : 'imprisoned and stripped of office'; evt(sim, 'intrigue', `${pname(sim, lead)} uncovers the plot of ${pname(sim, head)}, who is ${fate}`, { org: o.id, person: head.id, important: o.level >= 3 }); if (fate === 'executed') killPerson(sim, head, `executed by ${lead.name}`, lead); else { for (const r of [...head.roles]) { const [oid, t] = r.split(':'); if (+oid === o.id) { head.roles.delete(r); vacate(sim, o, head, t); } } addMem(sim, head, lead, -60, 'imprisoned me'); } o.legit = clamp(o.legit + 0.03, 0, 1); return; }
    else { addMem(sim, head, lead, -30, 'tried to destroy me'); }
  }
  if (power > loyal * (0.9 + 0.4 * (1 - head.ambition)) && sim.rng.chance(0.3)) {
    if (goal === 'independence' && regions.length) {
      const reb = splitPolity(sim, o, regions, head, null);
      if (reb) { evt(sim, 'war', `${pname(sim, head)} leads ${reb.place} in revolt against the ${o.name}`, { org: reb.id, person: head.id, important: true }); declareWar(sim, reb, o, 'independence', {}); for (const b of backers) joinWar(sim, sim.orgs.get(b), reb); }
    } else if (regions.length >= 1 && o.level >= 3) {
      const reb = splitPolity(sim, o, regions, head, `${head.name}'s rebels`);
      if (reb) { evt(sim, 'war', `Civil war! ${pname(sim, head)} raises the provinces against ${pname(sim, lead)} of the ${o.name}`, { org: o.id, person: head.id, important: true }); declareWar(sim, reb, o, 'succession', { claimant: head.id }); for (const b of backers) joinWar(sim, sim.orgs.get(b), reb); }
    } else {
      const pr = power / (power + loyal);
      if (sim.rng.chance(pr)) {
        const fate = sim.rng.chance(0.5 - 0.3 * head.pers.A / 3) ? 'killed' : 'exiled';
        evt(sim, 'intrigue', `Coup in the ${o.name}: ${pname(sim, head)} overthrows ${pname(sim, lead)}, who is ${fate}`, { org: o.id, person: head.id, important: o.level >= 2 });
        hist(sim, o, `Coup by ${pname(sim, head)}`);
        if (fate === 'killed') killPerson(sim, lead, `killed in a coup by ${head.name}`, head);
        else { for (const r of [...lead.roles]) { const [oid, t] = r.split(':'); if (+oid === o.id) { lead.roles.delete(r); vacate(sim, o, lead, t); } } addMem(sim, lead, head, -100, 'overthrew me'); lead.tags.add('exile'); o._deadLeader = null; }
        for (const r of [...head.roles]) { const [oid, t] = r.split(':'); if (+oid === o.id) { head.roles.delete(r); vacate(sim, o, head, t); } }
        o.leader = null; setRole(sim, o, head, 'leader'); o.dyn = head.dyn; o.legit = 0.3; head.prestige += 20; head.notable = true;
        for (const b of backers) { const bl = L(sim, sim.orgs.get(b)); if (bl) addMem(sim, head, bl, 40, 'backed my coup'); improveRel(sim, o, sim.orgs.get(b), 30); }
      } else {
        evt(sim, 'intrigue', `A coup against ${pname(sim, lead)} of the ${o.name} fails; ${pname(sim, head)} ${sim.rng.chance(0.6) ? 'is put to death' : 'flees into exile'}`, { org: o.id, person: head.id, important: o.level >= 3 });
        if (sim.rng.chance(0.6)) killPerson(sim, head, `executed for treason by ${lead.name}`, lead); else for (const r of [...head.roles]) { const [oid, t] = r.split(':'); if (+oid === o.id) { head.roles.delete(r); vacate(sim, o, head, t); } }
        o.legit = clamp(o.legit + 0.05, 0, 1);
      }
    }
  }
}
function splitPolity(sim, o, cells, head, name) {
  cells = [...new Set(cells)].filter(c => sim.owner[c] === o.id && c !== o.capital);
  if (!cells.length) return null;
  let cap = cells[0]; for (const c of cells) if (sim.cellN[c] > sim.cellN[cap]) cap = c;
  let bp = null; for (const p of sim.cellPops[cap]) if (!bp || p.n > bp.n) bp = p; if (!bp) return null;
  const Lg = langOf(sim, bp.lang); const C = sim.cultures.get(bp.cul);
  const n = makeOrg(sim, 'polity', { name: '', cul: bp.cul, rel: bp.rel, lang: bp.lang, capital: cap, place: name || (Lg ? Lg.placeName(sim.rng) : 'the march'), succ: chooseSucc(sim, cultureTraits(sim, bp.cul), bp.urban), color: (C ? C.color : o.color).map(v => clamp(v + sim.rng.int(-40, 40), 25, 235)) });
  n.level = Math.max(1, o.level - 1); renamePolity(sim, n); if (name) n.name = name;
  for (const c of cells) { setOwner(sim, c, n); sim.control[c] = 0.6; }
  for (const r of [...head.roles]) { const [oid, t] = r.split(':'); const q = sim.orgs.get(+oid); if (q === o) { head.roles.delete(r); vacate(sim, o, head, t); } }
  setRole(sim, n, head, 'leader'); head.org = n.id; n.dyn = head.dyn; n.legit = 0.45; head.notable = true; n.parentPolity = o.id;
  n.tech = Uint8Array.from(o.tech); n.wealth = Math.max(0, o.wealth * cells.length / Math.max(1, o.cells)); o.wealth -= n.wealth;
  hist(sim, n, `Broke away from the ${o.name}`); hist(sim, o, `Lost provinces to ${n.name}`);
  return n;
}
function dissolve(sim, o, why) {
  if (o.dead) return; o.dead = sim.year; sim._liveDirty = true;
  if (o.kind === 'polity' ? o.peakPop > 30000 : o.wealth > 20 || sim.year - o.born > 30) evt(sim, o.kind === 'polity' ? 'polity' : 'org', `The ${o.name} ${why} and is no more (founded ${sim.fmtYear(o.born)})`, { org: o.id, important: o.kind === 'polity' && o.level >= 3 });
  for (const wid of [...o.wars]) endWar(sim, sim.wars.get(wid), null, 'collapse');
  for (const c of o.cellList) if (sim.owner[c] === o.id) sim.owner[c] = -1;
  const lead = L(sim, o); if (lead) { lead.roles.delete(`${o.id}:leader`); lead.tags.add('exile'); }
  for (const off of o.offices) { const h = off.h && sim.persons.get(off.h); if (h) h.roles.delete(`${o.id}:${off.t}`); }
  for (const q of liveOrgs(sim)) { q.rels.delete(o.id); q.tradePartners.delete(o.id); q.vassals.delete(o.id); if (q.overlord === o.id) q.overlord = -1; }
  hist(sim, o, `Dissolved: ${why}`);
}

// ---------------------------------------------------------- diplomacy
export function neighbors(sim, o) {
  const w = sim.world, s = new Set();
  for (const c of o.cellList) for (let k = 0; k < 8; k++) { const j = w.nbr[c * 8 + k]; if (j >= 0 && sim.owner[j] >= 0 && sim.owner[j] !== o.id) s.add(sim.owner[j]); }
  if (o.tech[TI.sailing]) for (const c of o.cellList) if (sim.coastal[c] && sim.rng.chance(0.05)) for (const j of seaReachCells(sim, c, o.tech[TI.ocean_nav] ? 6 : 2)) if (sim.owner[j] >= 0 && sim.owner[j] !== o.id) s.add(sim.owner[j]);
  return [...s].map(id => sim.orgs.get(id)).filter(q => q && !q.dead);
}
function seaReachCells(sim, c, r) { return sim._seaReach ? sim._seaReach(c, r) : []; }
function rel(o, q) { let r = o.rels.get(q.id); if (!r) { r = { op: 0, ally: false, trade: false, truce: -1e9, insults: 0 }; o.rels.set(q.id, r); } return r; }
function improveRel(sim, a, b, v) { if (!a || !b) return; rel(a, b).op += v; rel(b, a).op += v; }
export function orgOpinion(sim, a, b) {
  const la = L(sim, a), lb = L(sim, b); let v = la && lb ? opinion(sim, la, lb) * 0.6 : 0;
  v += rel(a, b).op * Math.exp(-0) ; v += a.cul === b.cul ? 10 : 0; v += a.rel === b.rel ? 10 : -10;
  return clamp(v, -100, 100);
}
function alliesOf(sim, o) { const out = []; for (const [id, r] of o.rels) if (r.ally) { const q = sim.orgs.get(id); if (q && !q.dead) out.push(q); } return out; }
function coalitionStrength(sim, o, against) {
  let s = o.strength; for (const a of alliesOf(sim, o)) if (a !== against && !alliesOf(sim, a).includes(against)) s += 0.5 * a.strength;
  for (const v of o.vassals) { const q = sim.orgs.get(v); if (q && !q.dead) s += 0.4 * q.strength; }
  return s;
}
function borderPop(sim, o, q) {
  const w = sim.world; let n = 0, k = 0;
  for (const c of q.cellList) { let adj = false; for (let i = 0; i < 8; i++) { const j = w.nbr[c * 8 + i]; if (j >= 0 && sim.owner[j] === o.id) { adj = true; break; } } if (adj) { n += sim.cellN[c]; k++; } }
  return { n, k };
}

function leaderActions(sim, o) {
  const lead = L(sim, o); if (!lead || age(sim, lead) < 16) return;
  const rng = sim.rng; const g = lead.goals;
  if (o.union && rng.chance(0.03)) tryMergeUnion(sim, o);
  // patronage & building
  if (o.capPop) o.capPop._patron = 1 + (g.knowledge > 0.25 && o.wealth > 20 ? 0.5 : 0);
  if (g.knowledge > 0.25 && o.wealth > 20) o.wealth -= 2;
  if ((g.glory > 0.25 || g.faith > 0.25) && o.wealth > o.popTotal * 0.0005 + 30 && rng.chance(0.05)) {
    const what = g.faith > g.glory ? 'a great temple' : 'a grand monument'; o.wealth *= 0.6; o.legit = clamp(o.legit + 0.08, 0, 1); lead.prestige += 15;
    if (o.level >= 2) evt(sim, 'culture', `${pname(sim, lead)} raises ${what} at ${sim.world.cellName(o.capital)} for the ${o.name}`, { org: o.id, person: lead.id });
    bio(sim, lead, `Built ${what}`);
  }
  // make office hereditary
  if (o.succ === 'elective' && g.power > 0.25 && o.legit > 0.6 && cultureTraits(sim, o.cul)[0] > -0.3 && rng.chance(0.02)) {
    o.succ = cultureTraits(sim, o.cul)[7] > 0.25 ? 'tanistry' : 'primogeniture'; renamePolity(sim, o);
    evt(sim, 'polity', `${pname(sim, lead)} makes leadership of the ${o.place} hereditary within the house of ${sim.dynasties.get(lead.dyn)?.name || lead.name}`, { org: o.id, person: lead.id, important: o.level >= 2 }); lead.notable = true;
  }
  // state religion follows a devout ruler's personal faith
  if (lead.rel !== o.rel && lead.piety > 0.3 && rng.chance(0.1)) {
    const R = sim.religions.get(lead.rel); const old = sim.religions.get(o.rel);
    o.rel = lead.rel; evt(sim, 'religion', `${pname(sim, lead)} makes ${R ? R.name : 'a new faith'} the religion of the ${o.name}${old ? ', abandoning ' + old.name : ''}`, { org: o.id, person: lead.id, rel: lead.rel, important: o.level >= 2 });
    o.legit -= 0.1;
  }
  // diplomacy: consider one counterpart per year
  const nb = neighbors(sim, o); if (!nb.length) return;
  for (const q of nb) { const r = rel(o, q); r.op *= 0.97; }
  const q = rng.pick(nb); const ql = L(sim, q); if (!ql) return;
  const r = rel(o, q), rq = rel(q, o); const op = orgOpinion(sim, o, q);
  if (sim.atWar(o.id, q.id)) return;
  const sA = coalitionStrength(sim, o, q), sB = coalitionStrength(sim, q, o);
  const pWin = sA * sA / (sA * sA + sB * sB + 1e-9);
  const bp = borderPop(sim, o, q);
  const gain = clamp(bp.n / Math.max(1, o.popTotal), 0, 1.5) * (0.5 + o.cells / Math.max(1, q.cells) * 0.0) + (q.wealth > 0 ? clamp(q.wealth / Math.max(1, o.wealth + 50), 0, 0.5) : 0);
  const R = sim.religions.get(o.rel);
  const holy = o.rel !== q.rel && R ? lead.piety * R.tenets.excl * 0.4 : 0;
  const greed = 0.6 * g.power + 0.8 * g.glory + 0.3 * g.wealth + 0.25 * cultureTraits(sim, o.cul)[2];
  const risk = 0.5 + 0.25 * lead.pers.N - 0.15 * lead.pers.E;
  const truce = sim.year - r.truce < 15;
  const util = pWin * gain * (1 + greed) * 1.6 - (1 - pWin) * risk - 0.25 + holy - op / 150 - 0.15 * lead.pers.A / 2 + (o.wars.length ? -0.5 : 0) - (r.ally ? 1 : 0) - (o.overlord === q.id || q.overlord === o.id ? 0.6 : 0);
  // pastoral raids
  if (o.capPop && o.capPop.herd > 0.35 && o.tech[TI.riding] && q.capPop && q.capPop.farm > 0.35 && !r.ally && !truce && rng.chance(0.12)) { raid(sim, o, q); return; }
  if (!truce && !r.ally && util > 0.3 && bp.k > 0 && rng.chance(0.5)) {
    const goal = pWin > 0.8 && q.popTotal > o.popTotal * 0.15 && q.overlord < 0 && rng.chance(0.4) ? 'subjugation' : holy > 0.15 ? 'holy war' : 'conquest';
    declareWar(sim, o, q, goal, {}); return;
  }
  // tribute / vassalage demand by the much stronger
  if (!truce && sA > 4 * sB && q.overlord < 0 && !q.vassals.size && g.power > 0.2 && rng.chance(0.25)) {
    const accept = (1 - pWin) < 0.2 && ql.goals.glory < 0.3 && ql.pers.A > -1 && ql.ambition < 0.75;
    if (accept) { q.overlord = o.id; o.vassals.add(q.id); evt(sim, 'diplomacy', `The ${q.name} submits as a tributary of the ${o.name}`, { org: q.id, important: q.level >= 2 && o.level >= 2 }); addMem(sim, ql, lead, -15, 'forced tribute'); hist(sim, q, `Became tributary of ${o.name}`); return; }
    else { declareWar(sim, o, q, 'subjugation', {}); return; }
  }
  // alliance against a common threat
  if (!r.ally && op > 5 && rng.chance(0.3)) {
    const threat = nb.find(t => t !== q && t.strength > o.strength * 1.3 && orgOpinion(sim, o, t) < 0 && neighbors(sim, q).includes(t));
    if (threat || op > 45) {
      const acc = orgOpinion(sim, q, o) > (threat ? -5 : 25) && rng.chance(0.6 + 0.2 * ql.pers.A / 3);
      if (acc) { r.ally = true; rq.ally = true; evt(sim, 'diplomacy', `The ${o.name} and the ${q.name} swear an alliance${threat ? ' against the ' + threat.name : ''}`, { org: o.id, important: o.level >= 3 && q.level >= 3 }); improveRel(sim, o, q, 15); return; }
    }
  }
  // dynastic marriage
  if (rng.chance(0.25) && op > -10) { if (dynasticMarriage(sim, o, q)) return; }
  // trade
  if (!o.tradePartners.has(q.id) && op > -20 && (o.tech[TI.sailing] || o.tech[TI.wheel] || o.tech[TI.coinage] || cultureTraits(sim, o.cul)[6] > 0.2) && rng.chance(0.2)) {
    o.tradePartners.add(q.id); q.tradePartners.add(o.id); improveRel(sim, o, q, 8);
    if (o.level >= 3 && q.level >= 3) evt(sim, 'diplomacy', `Trade flows between the ${o.name} and the ${q.name}`, { org: o.id });
  }
  // a tributary may throw off its overlord
  if (o.overlord === q.id && pWin > 0.55 && lead.ambition > 0.5 && rng.chance(0.2)) { declareWar(sim, o, q, 'independence', {}); }
  // break alliances with disliked allies
  if (r.ally && op < -30 && rng.chance(0.2)) { r.ally = false; rq.ally = false; evt(sim, 'diplomacy', `The alliance between the ${o.name} and the ${q.name} collapses`, { org: o.id }); }
}
function tryMergeUnion(sim, o) {
  const o2 = sim.orgs.get(o.union); if (!o2 || o2.dead || o2.leader !== o.leader) { o.union = null; return; }
  const big = o.popTotal >= o2.popTotal ? o : o2, small = big === o ? o2 : o;
  if (big.cul !== small.cul && sim.rng.chance(0.5)) return;
  for (const c of small.cellList) setOwner(sim, c, big);
  evt(sim, 'diplomacy', `The ${small.name} is merged into the ${big.name}`, { org: big.id, important: big.level >= 3 });
  const lead = L(sim, small); if (lead) lead.roles.delete(`${small.id}:leader`); small.leader = null; big.union = null; dissolve(sim, small, 'was absorbed into the ' + big.name);
}
function dynasticMarriage(sim, o, q) {
  const lead = L(sim, o), ql = L(sim, q); if (!lead || !ql) return false;
  const single = d => ((sim.byDyn && sim.byDyn.get(d)) || []).filter(p => p.active && !p.died && !p.sp && age(sim, p) >= 15 && age(sim, p) <= 35);
  const a = single(lead.dyn), b = single(ql.dyn);
  for (const x of a) for (const y of b) if (x.female !== y.female) {
    if (opinion(sim, ql, lead) < -20) return false;
    x.sp = y.id; y.sp = x.id; const wife = x.female ? x : y, hus = x.female ? y : x;
    wife.org = hus.org; wife.cell = hus.cell;
    bio(sim, x, `Married ${pname(sim, y)}`); bio(sim, y, `Married ${pname(sim, x)}`);
    addMem(sim, lead, ql, 25, 'marriage alliance'); addMem(sim, ql, lead, 25, 'marriage alliance'); improveRel(sim, o, q, 20);
    evt(sim, 'diplomacy', `${pname(sim, x)} of the ${o.name} marries ${pname(sim, y)} of the ${q.name}`, { org: o.id, person: x.id, important: o.level >= 3 && q.level >= 3 });
    return true;
  }
  return false;
}

// ---------------------------------------------------------- war
function raid(sim, o, q) {
  const w = sim.world; const sA = o.strength, sB = q.strength * defenseMult(q.tech);
  const win = sim.rng.chance(sA * sA / (sA * sA + sB * sB + 1e-9) * 1.3);
  const lead = L(sim, o), ql = L(sim, q);
  if (win) {
    const loot = Math.max(0, q.wealth * 0.15); q.wealth -= loot; o.wealth += loot * 0.8;
    const border = q.cellList.filter(c => { for (let k = 0; k < 8; k++) if (sim.owner[w.nbr[c * 8 + k]] === o.id) return true; return false; });
    for (const c of border) for (const p of sim.cellPops[c]) { p.n *= 0.99; p.war += 0.5; }
    if (lead) lead.prestige += 5;
    if (sim.rng.chance(0.3)) evt(sim, 'war', `Riders of the ${o.name} raid the lands of the ${q.name}`, { org: o.id, important: false });
  } else { o.exhaustion = clamp(o.exhaustion + 0.05, 0, 1); }
  if (lead && ql) addMem(sim, ql, lead, -12, 'raided my lands');
  rel(q, o).op -= 10;
}
export function declareWar(sim, a, b, goal, extra) {
  if (!a || !b || a.dead || b.dead || sim.atWar(a.id, b.id)) return null;
  for (const o of [a, b]) if (!o.men) { census1(sim, o); militaryStrength(sim, o); }
  const W = { id: sim.nextId++, att: [a.id], def: [b.id], goal, started: sim.year, score: 0, battles: 0, cas: [0, 0], claimant: extra.claimant ?? null, name: '', ended: null, log: [] };
  const la = L(sim, a), lb = L(sim, b);
  W.name = goal === 'succession' ? `War of the ${b.place} Succession` : goal === 'independence' ? `${a.place} War of Independence` : goal === 'holy war' ? `Holy War against ${b.place}` : `${a.place}–${b.place} War`;
  sim.wars.set(W.id, W); a.wars.push(W.id); b.wars.push(W.id);
  rel(a, b).ally = false; rel(b, a).ally = false;
  evt(sim, 'war', `${la ? pname(sim, la) + ' of the ' : 'The '}${a.name} declares ${goal === 'conquest' ? 'war' : goal} on the ${b.name}${goal === 'holy war' ? '' : ''}`, { org: a.id, war: W.id, person: la?.id, important: a.level >= 3 || b.level >= 3 });
  if (la && lb) { addMem(sim, lb, la, -40, 'attacked my realm'); la.notable = true; lb.notable = true; }
  // call allies of the defender; honour culture makes allies more reliable
  for (const al of alliesOf(sim, b)) {
    const all = L(sim, al); if (!all || al === a) continue;
    const honor = cultureTraits(sim, al.cul)[8];
    if (sim.rng.chance(0.45 + 0.25 * honor + orgOpinion(sim, al, b) / 200)) joinWar(sim, al, b, W);
    else { rel(al, b).ally = false; rel(b, al).ally = false; if (lb) addMem(sim, lb, all, -40, 'betrayed our alliance'); evt(sim, 'diplomacy', `The ${al.name} refuses its alliance obligations to the ${b.name}`, { org: al.id }); }
  }
  if (b.overlord >= 0 && b.overlord !== a.id) { const ov = sim.orgs.get(b.overlord); if (ov && sim.rng.chance(0.6)) joinWar(sim, ov, b, W); }
  return W;
}
function census1(sim, o) { o.cellList = []; o.popTotal = 0; for (let c = 0; c < sim.world.N; c++) if (sim.owner[c] === o.id) { o.cellList.push(c); o.popTotal += sim.cellN[c]; } o.cells = o.cellList.length; }
function joinWar(sim, joiner, side, W) {
  if (!joiner || joiner.dead) return;
  W = W || [...sim.wars.values()].find(x => !x.ended && (x.att.includes(side.id) || x.def.includes(side.id))); if (!W) return;
  if (W.att.includes(joiner.id) || W.def.includes(joiner.id)) return;
  (W.att.includes(side.id) ? W.att : W.def).push(joiner.id); joiner.wars.push(W.id);
  evt(sim, 'war', `The ${joiner.name} enters the ${W.name} on the side of the ${side.name}`, { org: joiner.id, war: W.id });
}
function sideStr(sim, ids, W) { let men = 0, F = 0; for (const id of ids) { const o = sim.orgs.get(id); if (!o || o.dead) continue; const share = 1 / Math.max(1, o.wars.length); men += o.men * share; F += o.strength * share * (W.def.includes(id) ? defenseMult(o.tech) : 1); } return { men, F }; }
function warsYear(sim) {
  const w = sim.world;
  for (const W of [...sim.wars.values()]) {
    if (W.ended) continue;
    W.att = W.att.filter(id => { const o = sim.orgs.get(id); return o && !o.dead; }); W.def = W.def.filter(id => { const o = sim.orgs.get(id); return o && !o.dead; });
    if (!W.att.length || !W.def.length) { endWar(sim, W, W.att.length ? 'att' : 'def', 'collapse'); continue; }
    const A = sim.orgs.get(W.att[0]), D = sim.orgs.get(W.def[0]);
    const sa = sideStr(sim, W.att, W), sd = sideStr(sim, W.def, W);
    const pA = sa.F * sa.F / (sa.F * sa.F + sd.F * sd.F + 1e-9); // Lanchester square law
    const attWins = sim.rng.chance(pA);
    const win = attWins ? sa : sd, lose = attWins ? sd : sa;
    const engaged = Math.min(sa.men, sd.men) * sim.rng.range(0.3, 0.8);
    const lCas = engaged * sim.rng.range(0.12, 0.3), wCas = engaged * sim.rng.range(0.04, 0.12) * (lose.F / Math.max(1, win.F));
    W.cas[attWins ? 1 : 0] += lCas; W.cas[attWins ? 0 : 1] += wCas; W.battles++;
    const kill = (ids, n) => { for (const id of ids) { const o = sim.orgs.get(id); if (!o || !o.popTotal) continue; const share = n / ids.length; for (const c of o.cellList) for (const p of sim.cellPops[c]) { const d = share * p.n / o.popTotal; p.n = Math.max(5, p.n - d); p.war += 0.3; } o.exhaustion = clamp(o.exhaustion + share / Math.max(1, o.men) * 0.7 + 0.03, 0, 1); } };
    kill(attWins ? W.def : W.att, lCas); kill(attWins ? W.att : W.def, wCas);
    W.score = clamp(W.score + (attWins ? 1 : -1) * (12 + 25 * Math.abs(pA - 0.5)), -100, 100);
    // territory changes hands at the front
    const winnerOrg = attWins ? A : D, loserOrg = attWins ? D : A;
    let field = -1;
    for (const c of loserOrg.cellList) { if (c === loserOrg.capital && loserOrg.cells > 1) continue; for (let k = 0; k < 8; k++) { const j = w.nbr[c * 8 + k]; if (j >= 0 && (W.att.includes(sim.owner[j]) || W.def.includes(sim.owner[j])) && sim.owner[j] === winnerOrg.id) { field = c; break; } } if (field >= 0) break; }
    if (field < 0 && loserOrg.cellList.length) field = loserOrg.capital;
    // commanders
    const gen = o => officeHolder(sim, o, 'Marshal') || officeHolder(sim, o, 'War leader') || L(sim, o);
    const gw = gen(winnerOrg), gl = gen(loserOrg);
    if (gw) { gw.prestige += 8; gw.sk.mil = Math.min(20, gw.sk.mil + 0.3); gw.notable = true; bio(sim, gw, `Victory over the ${loserOrg.name}`); }
    if (gl) { gl.sk.mil = Math.min(20, gl.sk.mil + 0.15); bio(sim, gl, `Defeat against the ${winnerOrg.name}`); }
    const big = engaged > 5000 || W.battles === 1;
    const placeN = field >= 0 ? (langOf(sim, sim.cellLang[field])?.placeName(sim.rng) || w.cellName(field)) : 'the frontier';
    if (big) { const txt = `Battle of ${placeN}: ${gw ? pname(sim, gw) + ' leads the ' : 'the '}${winnerOrg.name} to victory over the ${loserOrg.name} (${Math.round(lCas).toLocaleString()} fall)`; evt(sim, 'battle', txt, { war: W.id, org: winnerOrg.id, cell: field, person: gw?.id, important: engaged > 20000 }); W.log.push({ y: sim.year, t: txt }); }
    if (gl && sim.rng.chance(0.08)) killPerson(sim, gl, `slain at the battle of ${placeN}`, gw);
    if (field >= 0 && (attWins ? W.goal !== 'raid' : W.score < -30) && W.goal !== 'succession') {
      if (field !== loserOrg.capital || loserOrg.cells === 1) { setOwner(sim, field, winnerOrg); sim.control[field] = 0.3; if (field === loserOrg.capital && loserOrg.cells === 1) { /* last stand */ } }
    }
    // peace?
    const years = sim.year - W.started;
    const la = L(sim, A), ld = L(sim, D);
    const will = (o, l, side) => (o.exhaustion > 0.45 + 0.3 * (l ? (l.ambition - 0.5) - l.pers.A * 0.1 : 0)) || (side * W.score < -55) || (years > 12 && sim.rng.chance(0.2));
    if (W.goal === 'succession' && Math.abs(W.score) >= 70) { endWar(sim, W, W.score > 0 ? 'att' : 'def', 'decisive'); continue; }
    if (will(A, la, 1) || will(D, ld, -1)) endWar(sim, W, W.score > 20 ? 'att' : W.score < -20 ? 'def' : null, 'peace');
  }
}
function endWar(sim, W, winner, how) {
  if (!W || W.ended) return; W.ended = sim.year;
  const A = sim.orgs.get(W.att[0]), D = sim.orgs.get(W.def[0]);
  for (const id of [...W.att, ...W.def]) { const o = sim.orgs.get(id); if (o) { o.wars = o.wars.filter(x => x !== W.id); o.exhaustion *= 0.5; } }
  if (A && D) { rel(A, D).truce = sim.year; rel(D, A).truce = sim.year; }
  let txt = `The ${W.name} ends`;
  const la = A && L(sim, A), ld = D && L(sim, D);
  if (winner === 'att' && A && D && !D.dead) {
    if (W.goal === 'subjugation') { D.overlord = A.id; A.vassals.add(D.id); txt += ` — the ${D.name} becomes a tributary of the ${A.name}`; }
    else if (W.goal === 'independence') { if (D.vassals.has(A.id)) D.vassals.delete(A.id); A.overlord = -1; txt += ` — the ${A.name} wins its independence`; }
    else if (W.goal === 'succession') {
      // claimant takes the throne; rebel realm folds back in
      const cl = W.claimant && sim.persons.get(W.claimant); const old = L(sim, D);
      if (cl && !cl.died) { if (old) { killPerson(sim, old, `deposed and killed by ${cl.name}`, cl); } for (const r of [...cl.roles]) { const [oid, t] = r.split(':'); if (+oid === A.id) { cl.roles.delete(r); A.leader = null; } } D.leader = null; setRole(sim, D, cl, 'leader'); D.dyn = cl.dyn; D.legit = 0.45; cl.org = D.id; }
      for (const c of A.cellList) setOwner(sim, c, D); A.cellList = []; dissolve(sim, A, 'reunited with the ' + D.name);
      txt += ` — ${cl ? pname(sim, cl) : 'the claimant'} wins the throne of the ${D.name}`;
    } else txt += ` in victory for the ${A.name}`;
    if (la) { la.prestige += 25; la.notable = true; } if (A) A.legit = clamp(A.legit + 0.1, 0, 1); if (D) D.legit = clamp(D.legit - 0.1, 0, 1);
  } else if (winner === 'def' && A && D) {
    if (W.goal === 'succession' || W.goal === 'independence') { for (const c of A.cellList) setOwner(sim, c, D); const cl = L(sim, A); if (cl) killPerson(sim, cl, `executed as a rebel by ${ld ? ld.name : 'the victors'}`, ld); dissolve(sim, A, 'was crushed by the ' + D.name); txt += ` — the rebellion is crushed`; }
    else txt += ` in victory for the ${D.name}`;
    if (ld) { ld.prestige += 20; ld.notable = true; } D.legit = clamp(D.legit + 0.1, 0, 1);
  } else txt += how === 'collapse' ? '' : ' in a stalemate';
  txt += ` (${Math.round(W.cas[0] + W.cas[1]).toLocaleString()} dead over ${sim.year - W.started} years)`;
  evt(sim, 'war', txt, { war: W.id, org: A?.id, important: (A && A.level >= 3) || (D && D.level >= 3) || W.cas[0] + W.cas[1] > 50000 });
  W.result = txt;
  // demobilised veterans: an ambitious commander may found a mercenary company
  if (W.cas[0] + W.cas[1] > 5000 && sim.rng.chance(0.25)) { const o = sim.rng.chance(0.5) ? A : D; if (o && !o.dead) { const g = officeHolder(sim, o, 'Marshal') || officeHolder(sim, o, 'War leader'); if (g && g.goals.glory + g.goals.wealth > 0.4) foundOrg(sim, 'mercenary', g, o.capital, o); } }
}
export function warStatus(sim) { return [...sim.wars.values()]; }

// ---------------------------------------------------------- banks & loans
function seekLoan(sim, o, amt) {
  const lead = L(sim, o); if (!lead) return;
  const banks = liveOrgs(sim).slice().filter(b => !b.dead && (b.kind === 'bank' || b.kind === 'merchant') && b.wealth > amt * 0.5);
  if (!banks.length) return;
  const b = sim.rng.weighted(banks, b => Math.exp(orgOpinion(sim, b, o) / 40) * (b.kind === 'bank' ? 2 : 1)); if (!b) return;
  const bl = L(sim, b); const credit = (o.rev || 1) * 3 - o.debts.reduce((s, d) => s + d.amt, 0);
  if (credit < amt || (bl && opinion(sim, bl, lead) < -30)) return;
  const rate = clamp(0.06 + 0.1 * (1 - o.legit) + (bl ? 0.02 * (10 - bl.pers.A * 3) / 10 : 0), 0.04, 0.3);
  b.wealth -= amt; o.wealth += amt; o.debts.push({ bank: b.id, amt, rate, y: sim.year }); b.loans.push(o.id);
  if (o.level >= 3) evt(sim, 'economy', `The ${b.name} lends ${Math.round(amt)} talents to the ${o.name} at ${(rate * 100).toFixed(0)}%`, { org: b.id });
}
function defaultDebts(sim, o) {
  const lead = L(sim, o);
  for (const d of o.debts) { const b = sim.orgs.get(d.bank); if (!b) continue; const bl = L(sim, b); if (bl && lead) addMem(sim, bl, lead, -80, 'defaulted on our loans'); b.wealth -= d.amt * 0.3; evt(sim, 'economy', `${lead ? pname(sim, lead) + ' of the ' : 'The '}${o.name} repudiates its debts to the ${b.name}`, { org: o.id, important: b.wealth < 0 }); if (b.wealth < -20) dissolve(sim, b, 'was ruined by unpaid royal debts'); }
  o.debts = []; o.legit -= 0.05;
}

// ---------------------------------------------------------- other organisations
function foundOrg(sim, kind, founder, seat, polity, extra = {}) {
  const Lg = langOf(sim, founder.lang); const place = Lg ? Lg.placeName(sim.rng) : 'the city';
  const nm = {
    guild: () => `${sim.rng.pick(['Weavers', 'Potters', 'Smiths', 'Masons', 'Dyers', 'Brewers', 'Tanners', 'Scribes'])}' Guild of ${place}`,
    merchant: () => `House of ${sim.dynasties.get(founder.dyn)?.name || founder.name}`,
    bank: () => `Bank of ${sim.dynasties.get(founder.dyn)?.name || founder.name}`,
    gang: () => `${sim.rng.pick(['Red', 'Black', 'Wolf', 'Night', 'Hill', 'River', 'Knife'])} ${sim.rng.pick(['Brotherhood', 'Band', 'Hand', 'Riders', 'Company'])} of ${place}`,
    order: () => `Order of ${extra.name || place}`,
    mercenary: () => `${founder.name}'s ${sim.rng.pick(['Free Company', 'Spears', 'Lances', 'Shields'])}`,
    church: () => extra.name,
  }[kind]();
  const o = makeOrg(sim, kind, { name: nm, cul: founder.cul, rel: extra.rel ?? founder.rel, lang: founder.lang, seat, capital: seat, wealth: extra.wealth || 10, religionOf: extra.religionOf ?? null, parent: polity ? polity.id : null });
  o.succ = kind === 'merchant' || kind === 'bank' ? 'primogeniture' : 'elective';
  o.offices = kind === 'church' ? [{ t: 'Bishop', h: null, w: 1, k: 'council' }, { t: 'Bishop ', h: null, w: 1, k: 'council' }, { t: 'Treasurer', h: null, w: 1, k: 'council' }]
    : [{ t: kind === 'gang' ? 'Lieutenant' : 'Deputy', h: null, w: 1, k: 'council' }, { t: 'Treasurer', h: null, w: 0.8, k: 'council' }];
  for (const r of [...founder.roles]) { const [oid, t] = r.split(':'); if (t !== 'leader') { const q = sim.orgs.get(+oid); founder.roles.delete(r); if (q) vacate(sim, q, founder, t); } }
  setRole(sim, o, founder, 'leader'); founder.org = o.id; o.dyn = founder.dyn; founder.notable = true; founder.tags.add('founder');
  hist(sim, o, `Founded by ${pname(sim, founder)}`);
  evt(sim, 'org', `${pname(sim, founder)} founds the ${o.name}${polity ? ' in the ' + polity.name : ''}`, { org: o.id, person: founder.id, important: kind === 'church' || kind === 'bank' });
  return o;
}
function otherOrgs(sim) {
  const rng = sim.rng, w = sim.world;
  // emergence
  if (sim.year % 3 === 0) for (const o of liveOrgs(sim)) {
    if (o.dead || o.kind !== 'polity' || o.level < 2) continue;
    for (const c of o.cellList) {
      const urb = sim.cellUrban[c]; const cp = sim.cellPops[c][0]; if (!cp) continue;
      const t = cp.tech; const seated = k => liveOrgs(sim).slice().some(q => !q.dead && q.kind === k && q.seat === c);
      if (urb > 12000 && t[TI.weaving] && t[TI.copper] && rng.chance(0.02) && !seated('guild')) { const f = makePerson(sim, { cell: c, cul: cp.cul, rel: cp.rel, lang: cp.lang, born: sim.year - rng.int(30, 50), status: 1 }); f.dyn = makeDynasty(sim, f.lang, f).id; foundOrg(sim, 'guild', f, c, o); }
      if (urb > 15000 && t[TI.coinage] && (sim.coastal[c] || o.tradePartners.size) && rng.chance(0.01) && !seated('merchant')) { const f = makePerson(sim, { cell: c, cul: cp.cul, rel: cp.rel, lang: cp.lang, born: sim.year - rng.int(25, 45), status: 1 }); f.goals.wealth = 0.6; f.dyn = makeDynasty(sim, f.lang, f).id; foundOrg(sim, 'merchant', f, c, o, { wealth: 30 }); }
      if (sim.unrest[c] > 0.45 && sim.cellN[c] > 5000 && rng.chance(0.03) && !seated('gang')) { const f = makePerson(sim, { cell: c, cul: cp.cul, rel: cp.rel, lang: cp.lang, born: sim.year - rng.int(20, 40), status: 0 }); f.pers.A = Math.min(f.pers.A, -0.8); f.ambition = Math.max(f.ambition, 0.6); f.dyn = makeDynasty(sim, f.lang, f).id; foundOrg(sim, 'gang', f, c, o, { wealth: 3 }); }
    }
  }
  for (const o of liveOrgs(sim).slice()) {
    if (o.dead || o.kind === 'polity') continue;
    const lead = L(sim, o); const c = o.seat; const host = c >= 0 && sim.owner[c] >= 0 ? sim.orgs.get(sim.owner[c]) : null; const hl = host ? L(sim, host) : null;
    fillOffices(sim, o);
    if (o.kind === 'guild') {
      o.wealth += sim.cellUrban[c] * 0.0008 * (1 - (host ? host.tax : 0));
      for (const p of sim.cellPops[c] || []) p._patron = (p._patron || 1) * 0.92; // craft protectionism slows innovation
      if (host && lead && hl && host.tax > 0.25 && opinion(sim, lead, hl) < -10 && rng.chance(0.05)) { host.wealth -= host.rev * 0.15; evt(sim, 'economy', `The ${o.name} strikes against the taxes of ${pname(sim, hl)}`, { org: o.id }); addMem(sim, hl, lead, -20, 'organised a strike'); }
    } else if (o.kind === 'merchant' || o.kind === 'bank') {
      const tradeN = host ? host.tradePartners.size : 0;
      o.wealth += sim.cellUrban[c] * 0.0005 * (1 + tradeN) * (lead ? 1 + (lead.sk.adm - 10) / 30 : 1);
      if (o.kind === 'merchant' && host && host.tech[TI.banking] && o.wealth > 150 && rng.chance(0.03)) { o.kind = 'bank'; o.name = o.name.replace('House', 'Bank'); evt(sim, 'economy', `The ${o.name} turns to banking, lending to princes`, { org: o.id, important: true }); }
      if (host && lead && hl && o.wealth > 60 && rng.chance(0.03)) addMem(sim, hl, lead, 8, 'generous gifts');
    } else if (o.kind === 'gang') {
      const loot = Math.min(sim.cellUrban[c] * 0.0005 + 1, 50); o.wealth += loot; if (host) host.wealth -= loot * 0.5;
      sim.unrest[c] = clamp(sim.unrest[c] + 0.01, 0, 1);
      const gangPower = o.wealth * 25 * (lead ? 1 + lead.sk.mil / 20 : 1);
      if (host && hl && rng.chance(0.08 + 0.1 * (hl.pers.C > 0 ? 1 : 0))) {
        const localForce = host.strength * sim.control[c] * 0.05;
        if (rng.chance(localForce / (localForce + gangPower + 1))) { evt(sim, 'crime', `${pname(sim, hl)} crushes the ${o.name}`, { org: o.id }); if (lead) killPerson(sim, lead, `hanged by order of ${hl.name}`, hl); dissolve(sim, o, 'was crushed'); continue; }
      }
      if (host && lead && lead.ambition > 0.7 && gangPower > host.strength * sim.control[c] * 0.15 && sim.unrest[c] > 0.5 && rng.chance(0.05)) {
        const n = splitPolity(sim, host, [c], lead, null);
        if (n) { evt(sim, 'war', `The bandit chief ${pname(sim, lead)} seizes ${n.place} from the ${host.name} and proclaims himself ruler`, { org: n.id, person: lead.id, important: true }); declareWar(sim, host, n, 'conquest', {}); dissolve(sim, o, 'became a state'); }
      }
      if (sim.unrest[c] < 0.15 && rng.chance(0.05)) dissolve(sim, o, 'faded away in peaceful times');
    } else if (o.kind === 'church') {
      const R = sim.religions.get(o.religionOf); if (!R || R.dead) { dissolve(sim, o, 'lost its faithful'); continue; }
      o.wealth += R.n * 0.00002;
      // spiritual authority over rulers of the faith
      if (lead && rng.chance(0.2)) {
        const rulers = liveOrgs(sim).slice().filter(q => !q.dead && q.kind === 'polity' && q.rel === R.id && q.level >= 2);
        const q = rng.pick(rulers); const ql = q && L(sim, q);
        if (ql) { const op = opinion(sim, lead, ql); if (op < -40 && lead.pers.A < 0 && rng.chance(0.25)) { q.legit = clamp(q.legit - 0.25, 0, 1); addMem(sim, ql, lead, -60, 'excommunicated me'); evt(sim, 'religion', `${pname(sim, lead)}, head of the ${o.name}, excommunicates ${pname(sim, ql)} of the ${q.name}`, { org: o.id, person: ql.id, important: true }); } else if (op > 30) q.legit = clamp(q.legit + 0.02, 0, 1); }
      }
    } else if (o.kind === 'order') {
      for (const p of sim.cellPops[c] || []) p._patron = (p._patron || 1) * 1.15;
      o.wealth += 0.5;
    } else if (o.kind === 'mercenary') {
      o.wealth -= 1;
      const at = liveOrgs(sim).slice().filter(q => !q.dead && q.kind === 'polity' && q.wars.length && q.wealth > 40);
      if (at.length && rng.chance(0.3)) { const q = rng.weighted(at, q => q.wealth); const fee = q.wealth * 0.1; q.wealth -= fee; o.wealth += fee; q.strength *= 1.1; if (rng.chance(0.2)) evt(sim, 'war', `The ${o.name} sells its swords to the ${q.name}`, { org: o.id }); }
      if (o.wealth < -10) dissolve(sim, o, 'went unpaid and disbanded');
    }
    if (!o.leader && !o.dead) ensureLeadership(sim, o);
  }
}

// ---------------------------------------------------------- religion events
function religionEvents(sim) {
  const rng = sim.rng;
  // folk cults of complex societies become temple religions with priesthoods
  if (sim.year % 10 === 0) for (const o of liveOrgs(sim)) {
    if (o.dead || o.kind !== 'polity' || o.level < 2) continue; const R = sim.religions.get(o.rel);
    if (R && R.type === 'animist' && rng.chance(0.1)) {
      R.type = 'polytheist'; R.tenets.hier = 0.6; R.tenets.moral = 0.3 + 0.2 * rng.next(); R.tenets.ritual = 0.8;
      const Lg = langOf(sim, o.lang); R.name = `Temple cult of ${Lg ? Lg.personName(false, rng) : R.deity}`;
      evt(sim, 'religion', `In the ${o.name}, priests organise the old spirit-ways into the ${R.name}, with gods, temples and offerings`, { rel: R.id, org: o.id, important: o.level >= 3 });
    }
  }
  // prophets arise in crisis among complex, literate-ish societies
  for (const o of liveOrgs(sim)) {
    if (o.dead || o.kind !== 'polity' || o.level < 2 || !o.cellList.length) continue;
    let crisisN = 0; for (const c of o.cellList) for (const p of sim.cellPops[c]) crisisN += p.n * p.crisis;
    const lit = o.tech[TI.writing] ? 3 : 1, phil = o.tech[TI.philosophy] ? 2 : 1;
    if (rng.chance(1.5e-9 * (crisisN + o.popTotal * 0.05) * lit * phil)) { let best = o.capital, bv = -1; for (const c of o.cellList) { let v = 0; for (const p of sim.cellPops[c]) v += p.crisis * p.n; if (v > bv) { bv = v; best = c; } } spawnProphet(sim, best); }
  }
  // churches for organised religions
  if (sim.year % 5 === 0) for (const R of sim.religions.values()) {
    if (R.dead || R.church || R.n < 250000 || R.tenets.hier < 0.5) continue;
    const seatPol = liveOrgs(sim).slice().filter(q => !q.dead && q.kind === 'polity' && q.rel === R.id).sort((a, b) => b.popTotal - a.popTotal)[0];
    if (!seatPol) continue; const seat = R.holy >= 0 && sim.world.land[R.holy] ? R.holy : seatPol.capital; const cp = sim.cellPops[seat]?.[0] || seatPol.capPop; if (!cp) continue;
    const head = makePerson(sim, { cell: seat, cul: cp.cul, rel: R.id, lang: cp.lang, born: sim.year - rng.int(35, 55), status: 1 }); head.piety = Math.max(head.piety, 0.6); head.dyn = makeDynasty(sim, head.lang, head).id;
    const ch = foundOrg(sim, 'church', head, seat, seatPol, { name: `Church of ${R.name}`, rel: R.id, religionOf: R.id, wealth: 50 }); R.church = ch.id;
  }
  // schism: big multi-polity faiths split under a reformer
  if (sim.year % 10 === 0) for (const R of [...sim.religions.values()]) {
    if (R.dead || R.n < 3e6 || R.type === 'animist' || sim.year - R.born < 300) continue;
    if (!rng.chance(0.012)) continue;
    const pols = liveOrgs(sim).slice().filter(q => !q.dead && q.kind === 'polity' && q.rel === R.id); if (pols.length < 2) continue;
    const q = rng.pick(pols); const cp = q.capPop; if (!cp) continue;
    const ref = makePerson(sim, { cell: q.capital, cul: cp.cul, rel: R.id, lang: cp.lang, born: sim.year - rng.int(30, 50), status: 1 }); ref.pers.O = Math.max(ref.pers.O, 1); ref.piety = 0.9; ref.tags.add('reformer'); ref.notable = true; ref.dyn = makeDynasty(sim, ref.lang, ref).id;
    const t = { ...R.tenets }; for (const k in t) t[k] = clamp(t[k] + rng.normal(0, 0.2), 0, 1);
    const N = makeReligion(sim, { type: R.type, tenets: t, parent: R.id, founder: ref.id, holy: q.capital, name: `${ref.name}ite ${R.name.replace(/^(Church of |Temple cult of )/, '')}`, deity: R.deity, color: R.color.map(v => clamp(v + rng.int(-50, 50), 20, 235)) });
    ref.rel = N.id; bio(sim, ref, `Led the schism that founded ${N.name}`);
    evt(sim, 'religion', `Schism! ${pname(sim, ref)} breaks with ${R.name} and founds ${N.name} in the ${q.name}`, { rel: N.id, person: ref.id, org: q.id, important: true });
    const ql = L(sim, q); if (ql && (ql.pers.O > 0 || q.factions.length || rng.chance(0.4))) { ql.rel = N.id; q.rel = N.id; evt(sim, 'religion', `${pname(sim, ql)} of the ${q.name} embraces ${N.name}`, { org: q.id, rel: N.id }); }
    for (const p of sim.cellPops[q.capital]) if (p.rel === R.id && rng.chance(0.5)) p.rel = N.id;
    // other sides of the faith may take up arms
    for (const other of pols) if (other !== q && rng.chance(0.15)) { const ol = L(sim, other); if (ol && ol.piety > 0.4 && neighbors(sim, other).includes(q)) declareWar(sim, other, q, 'holy war', {}); }
  }
}
export function spawnProphet(sim, c) {
  const rng = sim.rng; let bp = null; for (const p of sim.cellPops[c] || []) if (!bp || p.n > bp.n) bp = p; if (!bp) return null;
  const pr = makePerson(sim, { cell: c, cul: bp.cul, rel: bp.rel, lang: bp.lang, born: sim.year - rng.int(28, 45), status: 0 });
  pr.pers.O = Math.max(pr.pers.O, 1 + rng.next()); pr.pers.E = Math.max(pr.pers.E, 0.8); pr.piety = 1; pr.tags.add('prophet'); pr.notable = true; pr.dyn = makeDynasty(sim, pr.lang, pr).id;
  pr.goals = { power: 0.05, wealth: 0, faith: 0.8, knowledge: 0.1, glory: 0, family: 0.05 };
  const old = sim.religions.get(bp.rel); const o = sim.owner[c] >= 0 ? sim.orgs.get(sim.owner[c]) : null;
  const phil = bp.tech[TI.philosophy] && rng.chance(0.4);
  const type = phil ? 'philosophy' : old && old.type === 'polytheist' && rng.chance(0.5) ? 'monotheist' : old && old.type === 'monotheist' ? 'monotheist' : rng.pick(['polytheist', 'monotheist', 'mystery cult']);
  const t = { prosel: clamp(0.4 + 0.25 * pr.pers.E + rng.normal(0, 0.2), 0, 1), excl: clamp((type === 'monotheist' ? 0.6 : 0.2) - 0.15 * pr.pers.O + rng.normal(0, 0.15), 0, 1), hier: clamp(0.3 + 0.2 * pr.pers.C + rng.normal(0, 0.2) + (bp.tech[TI.writing] ? 0.2 : 0), 0, 1),
    moral: clamp(0.6 + 0.2 * pr.pers.A + rng.normal(0, 0.15), 0, 1), ascet: clamp(0.3 + 0.2 * pr.pers.C + rng.normal(0, 0.25), 0, 1), pacif: clamp(0.4 + 0.25 * pr.pers.A + rng.normal(0, 0.2), 0, 1), ritual: clamp(0.4 + rng.normal(0, 0.25), 0, 1), afterlife: clamp(0.5 + rng.normal(0, 0.3), 0, 1) };
  const Lg = langOf(sim, bp.lang);
  const name = type === 'philosophy' ? `School of ${pr.name}` : rng.chance(0.5) ? `Way of ${pr.name}` : `${cap(Lg ? Lg.word('truth') : 'truth')} of ${Lg ? cap(Lg.word('light')) : 'Light'}`;
  const R = makeReligion(sim, { type, tenets: t, parent: old ? old.id : null, founder: pr.id, holy: c, name, deity: Lg ? cap(Lg.word('god')) : 'God' });
  pr.rel = R.id;
  // first followers
  const conv = Math.max(50, Math.floor(bp.n * 0.03)); bp.n -= conv; const fol = newPop(sim, c, conv, bp); fol.rel = R.id;
  bio(sim, pr, `Received a revelation and founded ${R.name}`);
  evt(sim, 'religion', `In a time of trouble, the ${type === 'philosophy' ? 'sage' : 'prophet'} ${pname(sim, pr)} of the ${sim.cultures.get(bp.cul)?.name || ''} begins teaching ${R.name} near ${sim.world.cellName(c)}${o ? ' in the ' + o.name : ''}`, { rel: R.id, person: pr.id, cell: c, important: true });
  // rulers react according to their own piety and openness
  const ol = o && L(sim, o);
  if (ol) { if (ol.pers.O < -0.5 && ol.piety > 0.3 && old && old.id === o.rel && rng.chance(0.3)) { evt(sim, 'religion', `${pname(sim, ol)} persecutes the followers of ${pname(sim, pr)}`, { person: pr.id, org: o.id }); if (rng.chance(0.4)) killPerson(sim, pr, `martyred by ${ol.name}`, ol); fol.n *= 0.5; } else if (ol.pers.O > 0.8 && rng.chance(0.15)) { ol.rel = R.id; } }
  return pr;
}
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// ---------------------------------------------------------- personal life
function personalActions(sim) {
  const rng = sim.rng; const act = [];
  for (const p of sim.persons.values()) if (p.active && !p.died && age(sim, p) >= 16) act.push(p);
  for (const p of act) {
    if (p.died) continue;
    // marriage (arranged among the elite)
    if (!p.sp && age(sim, p) < 40 && rng.chance(0.15)) {
      const pool = ((p.org && sim.byOrg.get(p.org)) || []).filter(q => q !== p && !q.sp && !q.died && q.female !== p.female && Math.abs(q.born - p.born) < 12 && q.dyn !== p.dyn && age(sim, q) >= 16);
      const s = rng.weighted(pool.slice(0, 40), q => Math.exp(opinion(sim, p, q) / 30));
      if (s) { p.sp = s.id; s.sp = p.id; bio(sim, p, `Married ${pname(sim, s)}`); bio(sim, s, `Married ${pname(sim, p)}`); }
    }
    // friendships & rivalries with colleagues
    if (p.org && rng.chance(0.3)) {
      const o = sim.orgs.get(p.org); if (!o || o.dead) continue;
      const peers = o.offices.map(x => x.h).concat([o.leader]).filter(id => id && id !== p.id).map(id => sim.persons.get(id)).filter(Boolean);
      const q = rng.pick(peers); if (q) {
        const compat = 8 * p.pers.A - 6 * Math.abs(p.pers.E - q.pers.E) + rng.normal(0, 8);
        if (compat > 10) addMem(sim, p, q, 6, 'friendship'); else if (compat < -12) addMem(sim, p, q, -6, 'quarrels');
        if (p.ambition > 0.7 && q.ambition > 0.7 && rng.chance(0.2)) { addMem(sim, p, q, -10, 'rival'); addMem(sim, q, p, -10, 'rival'); }
      }
    }
    // murder: ruthless ambitious schemers remove those standing in their way
    if (p.ambition > 0.75 && p.pers.A < -0.8 && p.sk.int > 9 && rng.chance(0.006)) {
      const targets = [];
      for (const [id, m] of p.mem) { const q = sim.persons.get(id); if (q && !q.died && opinion(sim, p, q) < -40) targets.push(q); }
      const o = p.org && sim.orgs.get(p.org); const ol = o && L(sim, o);
      if (ol && ol !== p && opinion(sim, p, ol) < -20 && p.roles.size) targets.push(ol);
      const t = rng.pick(targets);
      if (t) {
        const spy = t.org && sim.orgs.get(t.org) ? officeHolder(sim, sim.orgs.get(t.org), 'Spymaster') : null;
        const def = (spy ? spy.sk.int : 5) + t.sk.int * 0.5;
        if (rng.chance(p.sk.int / (p.sk.int + def))) { killPerson(sim, t, rng.pick(['poisoned', 'murdered', 'killed in a "hunting accident"', 'strangled in their bed']), p); if (rng.chance(0.4)) { evt(sim, 'intrigue', `${pname(sim, p)} is suspected in the death of ${pname(sim, t)}`, { person: p.id }); for (const k of t.kids) { const kk = sim.persons.get(k); if (kk) addMem(sim, kk, p, -60, 'murdered my parent'); } } }
        else { evt(sim, 'intrigue', `A plot by ${pname(sim, p)} against ${pname(sim, t)} is discovered`, { person: p.id }); addMem(sim, t, p, -80, 'tried to murder me'); if (rng.chance(0.5)) killPerson(sim, p, `executed for plotting against ${t.name}`, t); }
      }
    }
    // personal conversion through spouse
    if (p.sp && rng.chance(0.01)) { const s = sim.persons.get(p.sp); if (s && s.rel !== p.rel && s.piety > p.piety + 0.3) { p.rel = s.rel; bio(sim, p, `Converted to ${sim.religions.get(s.rel)?.name}`); } }
    // ambitious devout found religious orders; merchants with means found houses
    if (p.goals.faith > 0.35 && p.piety > 0.6 && !p.roles.size && rng.chance(0.01)) { const R = sim.religions.get(p.rel); if (R && R.church && R.n > 500000 && sim.rng.chance(0.15) && !liveOrgs(sim).some(q => q.kind === 'order' && q.seat === p.cell)) foundOrg(sim, 'order', p, p.cell, sim.owner[p.cell] >= 0 ? sim.orgs.get(sim.owner[p.cell]) : null, { name: p.name }); }
    // skills grow with experience
    if (p.roles.size) { const k = ['mil', 'dip', 'adm', 'int', 'lrn'][rng.int(0, 4)]; p.sk[k] = Math.min(20, p.sk[k] + 0.05); }
  }
}

// ---------------------------------------------------------- inventions
export function creditInvention(sim, pop, t, o) {
  const first = sim.firstTech[t.id] === undefined; if (first) sim.firstTech[t.id] = { y: sim.year, c: pop.c };
  const C = sim.cultures.get(pop.cul);
  if (o && o.level >= 2 && (o.tech[TI.writing] || o.level >= 3) && sim.rng.chance(first ? 0.9 : 0.3)) {
    const inv = makePerson(sim, { cell: pop.c, cul: pop.cul, rel: pop.rel, lang: pop.lang, born: sim.year - sim.rng.int(25, 55), status: 1 });
    inv.pers.O = Math.max(inv.pers.O, 1); inv.sk.lrn = Math.max(inv.sk.lrn, 14); inv.tags.add('inventor'); inv.notable = true; inv.dyn = makeDynasty(sim, inv.lang, inv).id; inv.org = o.id;
    bio(sim, inv, `Credited with ${t.name.toLowerCase()}`);
    evt(sim, 'tech', `${pname(sim, inv)} of the ${o.name} is credited with ${first ? 'inventing ' : 'introducing '}${t.name.toLowerCase()}`, { person: inv.id, org: o.id, cell: pop.c, important: first });
    sim.persons.set(inv.id, inv);
  } else if (first) {
    evt(sim, 'tech', `${t.crop || t.animal ? (t.name + ' appear') : (t.name + ' is invented')} among the ${C ? C.name : 'people'} near ${sim.world.cellName(pop.c)} — a world first`, { cell: pop.c, cul: pop.cul, important: true });
  }
}

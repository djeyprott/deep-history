// Technology: knowledge held by populations. Discovery is a per-person-year chance (Kremer/Henrich:
// innovation scales with connected population), gated by prerequisites and environment; techs diffuse
// along contacts and can be lost when the community that maintains them shrinks below its complexity.
// E = expected years to invent with 100,000 connected people once all prerequisites are met.
import { CROPS, ANIMALS } from './world.js';

export const TECHS = [];
// E is scaled by complexity: elaborate techniques need specialists, so the per-person invention rate falls as the
// knowledge base grows (calibrated so independent inventions are rare and centuries to millennia apart)
const T = (id, name, pre, E, cplx, opts = {}) => TECHS.push({ id, name, pre, E: E * 4 * (1 + Math.sqrt(cplx / 120)), cplx, ...opts });

T('watercraft', 'Rafts & canoes', [], 0, 100, { start: true });
T('spear_thrower', 'Spear-thrower', [], 0, 50, { start: true });
T('bow', 'Bow & arrow', ['spear_thrower'], 1500, 150);
T('dog', 'Dog domestication', [], 2500, 50, { env: 'cold' });
T('nets', 'Nets, hooks & weirs', ['watercraft'], 1200, 150, { env: 'water' });
T('grinding', 'Grinding stones', [], 1500, 100, { env: 'grass' });
T('pottery', 'Pottery', ['grinding'], 1800, 400, { needSedentary: 0.25 });
T('cultivation', 'Cultivation', ['grinding'], 250, 600, { env: 'wildcrop', needDensity: 0.15, needStable: true });
CROPS.forEach(c => T('crop_' + c.id, 'Domesticated ' + c.name, ['cultivation'], 250, 300, { env: 'crop:' + c.id, crop: c.id }));
ANIMALS.forEach(a => T('herd_' + a.id, 'Domesticated ' + a.name, a.id === 'horse' || a.id === 'camelid' || a.id === 'camel' ? [] : ['cultivation'], a.id === 'horse' ? 3000 : 700, 300, { env: 'animal:' + a.id, animal: a.id, needDensity: 0.03, needStable: true }));
T('dairy', 'Dairying', ['pottery'], 800, 400, { env: 'dairyanimal' });
T('weaving', 'Loom weaving', ['pottery'], 900, 600, {});
T('irrigation', 'Irrigation', ['cultivation', 'pottery'], 900, 3000, { env: 'irrigable', needCrop: true });
T('plow', 'Ard plough', ['cultivation'], 1000, 2000, { env: 'draft', needCrop: true });
T('copper', 'Copper smelting', ['pottery'], 1200, 3000, { env: 'ore:copper' });
T('wheel', 'Wheel & cart', ['plow'], 900, 4000, {});
T('sailing', 'Sailing ships', ['watercraft', 'weaving'], 900, 5000, { env: 'coast' });
T('accounting', 'Tokens & tallies', ['pottery'], 1200, 4000, { needPolity: 1 });
T('masonry', 'Masonry & monuments', ['copper'], 900, 8000, { needPolity: 1 });
T('bronze', 'Bronze', ['copper'], 900, 15000, { env: 'ore:tin' });
T('writing', 'Writing', ['accounting'], 1500, 30000, { needPolity: 2 });
T('riding', 'Horse riding', ['herd_horse'], 1500, 500, {});
T('chariot', 'Chariot', ['wheel', 'bronze', 'herd_horse'], 600, 20000, {});
T('mathematics', 'Mathematics', ['writing'], 1000, 40000, {});
T('astronomy', 'Astronomy & calendar', ['mathematics'], 900, 40000, {});
T('law', 'Law codes', ['writing'], 700, 40000, { needPolity: 2 });
T('iron', 'Iron working', ['bronze'], 1300, 20000, { env: 'ore:iron' });
T('coinage', 'Coinage', ['writing', 'copper'], 900, 50000, { env: 'ore:gold' });
T('roads', 'Paved roads', ['wheel', 'masonry'], 900, 60000, { needPolity: 3 });
T('medicine', 'Medicine', ['writing'], 1200, 50000, {});
T('philosophy', 'Philosophy', ['mathematics', 'law'], 1200, 80000, {});
T('ocean_nav', 'Ocean navigation', ['sailing', 'astronomy'], 1200, 30000, { env: 'coast' });
T('engineering', 'Engineering', ['masonry', 'mathematics'], 1000, 80000, {});
T('cavalry', 'Mounted warfare', ['riding', 'iron'], 700, 20000, {});
T('crop_rotation', 'Crop rotation', ['plow', 'iron'], 1300, 30000, { needCrop: true });
T('paper', 'Paper', ['writing', 'weaving'], 1500, 60000, {});
T('banking', 'Banking', ['coinage', 'mathematics'], 1200, 150000, {});
T('steel', 'Steel', ['iron', 'engineering'], 1500, 120000, {});
T('heavy_plow', 'Heavy plough', ['crop_rotation'], 1200, 50000, { needCrop: true });
T('water_mill', 'Water mills', ['engineering', 'iron'], 1200, 80000, { env: 'river' });
T('alchemy', 'Alchemy', ['medicine', 'philosophy'], 1300, 120000, {});
T('compass', 'Magnetic compass', ['ocean_nav', 'iron'], 1500, 100000, {});
T('printing', 'Printing', ['paper', 'steel'], 1800, 300000, {});
T('gunpowder', 'Gunpowder', ['alchemy', 'iron'], 1600, 200000, {});
T('firearms', 'Firearms', ['gunpowder', 'steel'], 900, 300000, {});
T('science', 'Scientific method', ['printing', 'philosophy', 'astronomy'], 2000, 1000000, {});
T('steam', 'Steam power', ['science', 'steel'], 1000, 2000000, {});

export const NT = TECHS.length;
export const TI = {}; TECHS.forEach((t, i) => { t.idx = i; TI[t.id] = i; t.preIdx = t.pre.map(p => TI[p]); });
// crop/animal index lookup
export const CROP_TECH = CROPS.map(c => TI['crop_' + c.id]);
export const ANIMAL_TECH = ANIMALS.map(a => TI['herd_' + a.id]);

export const has = (pop, id) => pop.tech[TI[id]] === 1;

// ----- effect helpers (multipliers grounded in archaeological/agronomic estimates) -----
export function forageMult(p) { return 1 + 0.15 * p.tech[TI.bow] + 0.07 * p.tech[TI.dog] + 0.08 * p.tech[TI.grinding]; }
export function fishMult(p) { return 1 + 0.7 * p.tech[TI.nets] + 0.3 * p.tech[TI.sailing]; }
export function haPerWorker(p) { // hectares one farm worker can cultivate per year
  // hoe vs ard: early farming barely out-yielded foraging per hour of work
  let h = 1.2; if (p.tech[TI.plow]) h *= 2.3; if (p.tech[TI.heavy_plow]) h *= 1.25; if (p.tech[TI.iron]) h *= 1.1; if (p.tech[TI.steam]) h *= 2; return h;
}
export function yieldMult(p) {
  let m = 1; if (p.tech[TI.bronze]) m *= 1.03; if (p.tech[TI.iron]) m *= 1.08; if (p.tech[TI.crop_rotation]) m *= 1.25; if (p.tech[TI.astronomy]) m *= 1.04; if (p.tech[TI.water_mill]) m *= 1.06; if (p.tech[TI.science]) m *= 1.3; return m;
}
export function herdMult(p) { return 1 + 0.45 * p.tech[TI.dairy] + 0.1 * p.tech[TI.riding]; }
export function seaRange(p) { return p.tech[TI.ocean_nav] ? (p.tech[TI.compass] ? 14 : 9) : p.tech[TI.sailing] ? 3 : p.tech[TI.watercraft] ? 1 : 0; }
export function militaryMult(t) { // t = tech array of the polity's core population
  let m = 1; if (t[TI.bow]) m *= 1.15; if (t[TI.copper]) m *= 1.1; if (t[TI.bronze]) m *= 1.3; if (t[TI.iron]) m *= 1.35; if (t[TI.riding]) m *= 1.25;
  if (t[TI.chariot]) m *= 1.2; if (t[TI.cavalry]) m *= 1.3; if (t[TI.steel]) m *= 1.15; if (t[TI.gunpowder]) m *= 1.4; if (t[TI.firearms]) m *= 1.8; if (t[TI.engineering]) m *= 1.1; return m;
}
export function defenseMult(t) { return 1 + 0.3 * t[TI.masonry] + 0.2 * t[TI.engineering]; }
export function adminReach(t) { // km over which a capital can project control
  let r = 120; if (t[TI.riding]) r += 140; if (t[TI.wheel]) r += 50; if (t[TI.sailing]) r += 40; if (t[TI.accounting]) r *= 1.3; if (t[TI.writing]) r *= 1.8; if (t[TI.law]) r *= 1.2; if (t[TI.roads]) r *= 1.5; if (t[TI.paper]) r *= 1.2; if (t[TI.printing]) r *= 1.2; if (t[TI.steam]) r *= 1.6; return r;
}
export function innovationMult(t) { let m = 1; if (t[TI.writing]) m *= 1.4; if (t[TI.paper]) m *= 1.2; if (t[TI.philosophy]) m *= 1.15; if (t[TI.printing]) m *= 1.8; if (t[TI.science]) m *= 3; return m; }
export function techLevel(t) { let s = 0; for (let i = 0; i < NT; i++) s += t[i]; return s; }

// Generated languages: phoneme inventories, phonotactics, a core lexicon with cognate tracking,
// regular sound changes, lexical replacement (glottochronology), borrowing, and naming.
import { RNG } from './rng.js';

const CONS = [ // [token, weight]  weights ~ cross-linguistic frequency (PHOIBLE-ish)
  ['m', 10], ['n', 10], ['k', 10], ['t', 10], ['p', 9], ['s', 9], ['l', 8], ['j', 8], ['w', 8], ['h', 6], ['b', 6], ['d', 6], ['g', 6],
  ['r', 7], ['ng', 5], ['ny', 3], ['f', 4], ['v', 3], ['z', 3], ['sh', 4], ['ch', 4], ['ts', 2], ['kh', 2], ['q', 2], ['th', 1.5], ['dh', 1], ['zh', 1], ['gh', 1.5], ['x', 1], ["'", 3], ['lh', 0.8], ['dz', 1],
];
const VOW = [['a', 10], ['i', 10], ['u', 9], ['e', 7], ['o', 7], ['ä', 1.5], ['ö', 1], ['ü', 1.5], ['y', 1], ['aa', 2], ['ii', 1.5], ['uu', 1.5]];
const isV = t => /^[aeiouäöüy]+$/.test(t);
const STOPS = { p: 'b', t: 'd', k: 'g' };
const LENITE = { p: 'f', b: 'v', t: 'th', d: 'dh', k: 'kh', g: 'gh', s: 'h', f: 'h', kh: 'h' };

export const CONCEPTS = ['I', 'you', 'we', 'one', 'two', 'three', 'water', 'fire', 'sun', 'moon', 'star', 'sky', 'earth', 'stone', 'mountain', 'river', 'sea', 'tree', 'forest', 'grass',
  'man', 'woman', 'child', 'mother', 'father', 'people', 'chief', 'god', 'spirit', 'blood', 'bone', 'eye', 'hand', 'heart', 'eat', 'drink', 'die', 'kill', 'see', 'speak',
  'good', 'bad', 'big', 'small', 'new', 'old', 'red', 'white', 'black', 'night', 'day', 'house', 'town', 'land', 'road', 'war', 'peace', 'gold', 'iron', 'horse',
  'grain', 'bread', 'ship', 'king', 'law', 'truth', 'light', 'holy', 'strong', 'wise'];

let COG = 1;
export function resetCognates(n) { COG = n; }
export function getCognateCounter() { return COG; }

export class Language {
  constructor(id, rng, parent = null, year = 0) {
    this.id = id; this.parent = parent ? parent.id : null; this.family = parent ? parent.family : id; this.born = year;
    this.rng = rng;
    if (parent) {
      this.cons = parent.cons.slice(); this.vows = parent.vows.slice(); this.syl = { ...parent.syl };
      this.lex = {}; for (const k in parent.lex) this.lex[k] = { f: parent.lex[k].f.slice(), cog: parent.lex[k].cog };
      this.nameRoots = parent.nameRoots.map(r => r.slice()); this.mEnd = parent.mEnd.slice(); this.fEnd = parent.fEnd.slice(); this.placeSuf = parent.placeSuf.slice();
      this.depth = parent.depth + 1;
      // the founder effect: a couple of immediate changes so daughters differ from day one
      this.soundChange(); this.soundChange();
    } else {
      const nC = rng.int(8, 18), nV = rng.int(3, 7);
      this.cons = pickW(rng, CONS, nC); this.vows = pickW(rng, VOW, nV);
      if (!this.vows.includes('a')) this.vows[0] = 'a';
      this.syl = { coda: rng.next() < 0.6 ? rng.range(0.1, 0.5) : 0, cluster: rng.next() < 0.35 ? rng.range(0.05, 0.25) : 0, vInit: rng.range(0, 0.25), len: rng.range(1.6, 2.6) };
      this.lex = {}; for (const c of CONCEPTS) this.lex[c] = { f: this.makeWord(), cog: COG++ };
      this.nameRoots = Array.from({ length: 40 }, () => this.makeWord(rng.int(1, 2)));
      this.mEnd = [this.makeSyl(), []]; this.fEnd = [this.makeSyl(true), [rng.pick(this.vows)]];
      this.placeSuf = this.makeWord(1);
      this.depth = 0;
    }
    this.name = null;
  }
  makeSyl(vEnd = false) {
    const r = this.rng, s = [];
    if (r.next() > this.syl.vInit) { s.push(r.pick(this.cons)); if (r.next() < this.syl.cluster) { const liq = this.cons.filter(c => c === 'r' || c === 'l' || c === 'w' || c === 'j'); if (liq.length) s.push(r.pick(liq)); } }
    s.push(r.pick(this.vows));
    if (!vEnd && r.next() < this.syl.coda) s.push(r.pick(this.cons.filter(c => c !== "'" && c !== 'h' && c !== 'w' && c !== 'j')) || 'n');
    return s;
  }
  makeWord(n) {
    const r = this.rng; n = n || Math.max(1, Math.round(r.normal(this.syl.len, 0.6)));
    let w = []; for (let i = 0; i < n; i++) w = w.concat(this.makeSyl());
    return w.filter(Boolean);
  }
  word(c) { return this.lex[c] ? spell(this.lex[c].f) : '?'; }
  // ---- change ----
  soundChange() {
    const r = this.rng; const type = r.int(0, 9); let desc = '';
    const applyAll = fn => { for (const k in this.lex) this.lex[k].f = clean(fn(this.lex[k].f)); this.nameRoots = this.nameRoots.map(x => clean(fn(x))); this.placeSuf = clean(fn(this.placeSuf)); };
    if (type === 0) { // intervocalic voicing
      applyAll(w => w.map((t, i) => (STOPS[t] && i > 0 && i < w.length - 1 && isV(w[i - 1]) && isV(w[i + 1])) ? STOPS[t] : t)); desc = 'intervocalic voicing';
    } else if (type === 1) { // lenition of one consonant
      const c = r.pick(Object.keys(LENITE).filter(k => this.cons.includes(k))); if (c) { const to = LENITE[c]; applyAll(w => w.map((t, i) => t === c && i > 0 && isV(w[i - 1]) ? to : t)); desc = `${c} > ${to} after vowels`; }
    } else if (type === 2) { // apocope: final vowel loss in long words
      applyAll(w => (w.length >= 4 && isV(w[w.length - 1]) && !isV(w[w.length - 2])) ? w.slice(0, -1) : w); desc = 'loss of final vowels';
    } else if (type === 3) { // final consonant loss
      applyAll(w => (w.length >= 2 && !isV(w[w.length - 1])) ? w.slice(0, -1) : w); desc = 'loss of final consonants';
    } else if (type === 4) { // palatalisation
      applyAll(w => w.map((t, i) => (t === 'k' || t === 't' || t === 's') && i < w.length - 1 && (w[i + 1] === 'i' || w[i + 1] === 'e') ? ({ k: 'ch', t: 'ts', s: 'sh' })[t] : t)); desc = 'palatalisation before front vowels';
    } else if (type === 5) { // vowel shift
      const v = r.pick(this.vows); const to = r.pick(VOW.map(x => x[0]).filter(x => x !== v && x.length === 1)); applyAll(w => w.map(t => t === v ? to : t)); desc = `vowel shift ${v} > ${to}`;
    } else if (type === 6) { // cluster simplification
      applyAll(w => w.filter((t, i) => !(i > 0 && !isV(t) && !isV(w[i - 1]) && i < w.length - 1 && !isV(w[i + 1])))); desc = 'cluster simplification';
    } else if (type === 7) { // unconditional merger of two consonants
      const a = r.pick(this.cons), b = r.pick(this.cons); if (a !== b) { applyAll(w => w.map(t => t === a ? b : t)); desc = `merger of ${a} with ${b}`; }
    } else if (type === 8) { // vowel reduction of long vowels
      applyAll(w => w.map(t => t.length === 2 && isV(t) ? t[0] : t)); desc = 'shortening of long vowels';
    } else { // prothesis / epenthesis
      const v = r.pick(this.vows); applyAll(w => (w.length > 1 && !isV(w[0]) && !isV(w[1])) ? [v].concat(w) : w); desc = 'prothetic vowels';
    }
    // inventory follows the lexicon
    const inv = new Set(); for (const k in this.lex) for (const t of this.lex[k].f) inv.add(t);
    this.cons = [...inv].filter(t => !isV(t)); this.vows = [...inv].filter(isV); if (!this.vows.length) this.vows = ['a']; if (this.cons.length < 4) this.cons.push('n', 't', 'k', 'm');
    return desc;
  }
  replaceWord(donor) { // lexical replacement: coinage or borrowing
    const c = this.rng.pick(CONCEPTS);
    if (donor && donor !== this) { this.lex[c] = { f: donor.lex[c].f.slice(), cog: donor.lex[c].cog }; return { c, borrowed: true }; }
    this.lex[c] = { f: this.makeWord(), cog: COG++ }; return { c, borrowed: false };
  }
  similarity(other) { // share of cognates in core vocabulary
    let s = 0; for (const c of CONCEPTS) if (this.lex[c].cog === other.lex[c].cog) s++; return s / CONCEPTS.length;
  }
  // ---- naming ----
  personName(female, rng = this.rng) {
    const root = rng.pick(this.nameRoots); const end = rng.pick(female ? this.fEnd : this.mEnd);
    let w = root.concat(end); if (w.length > 7) w = w.slice(0, 7);
    return cap(spell(clean(w)));
  }
  dynastyName(rng = this.rng) { const c = rng.pick(['father', 'strong', 'gold', 'horse', 'sun', 'stone', 'river', 'mountain', 'red', 'black', 'wise', 'old', 'big']); return cap(spell(clean(this.lex[c].f.concat(rng.chance(0.5) ? rng.pick(this.nameRoots).slice(0, 2) : [])))); }
  placeName(rng = this.rng) {
    const c = rng.pick(['river', 'stone', 'mountain', 'sea', 'sun', 'tree', 'forest', 'grass', 'red', 'white', 'black', 'big', 'old', 'new', 'holy', 'gold']);
    const base = rng.chance(0.4) ? rng.pick(this.nameRoots) : this.lex[c].f;
    return cap(spell(clean(base.concat(rng.chance(0.6) ? this.placeSuf : []))));
  }
  ethnonym(rng = this.rng) { return cap(spell(clean(rng.chance(0.5) ? this.lex.people.f.slice(0, 4) : rng.pick(this.nameRoots).concat(this.makeSyl(true))))); }
  sample(n = 8) { return CONCEPTS.slice(6, 6 + n).map(c => `${c}: ${this.word(c)}`).join(', '); }
}

function pickW(r, list, n) { const out = [], pool = list.slice(); while (out.length < n && pool.length) { const x = r.weighted(pool, e => e[1]); out.push(x[0]); pool.splice(pool.indexOf(x), 1); } return out; }
function clean(w) { const o = []; for (const t of w) { if (!t) continue; if (o.length && o[o.length - 1] === t && !isV(t)) continue; if (o.length >= 2 && isV(t) && isV(o[o.length - 1]) && isV(o[o.length - 2])) continue; o.push(t); } return o.length ? o : ['a']; }
export function spell(w) { return w.join(''); }
export function cap(s) { s = s.replace(/^'+/, ''); return s.charAt(0).toUpperCase() + s.slice(1); }

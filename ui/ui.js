import { Sim } from '../src/sim.js';
import { TECHS, TI, NT, techLevel } from '../src/tech.js';
import { CROPS, ANIMALS } from '../src/world.js';
import { TRAITS } from '../src/pops.js';
import { opinion, opinionReasons, fullName, age, describePersonality, topGoal, SKILL_NAMES } from '../src/people.js';
import { orgLabel, titleOf, leaderOf, ORG_KINDS, neighbors, orgOpinion } from '../src/politics.js';
import { CONCEPTS } from '../src/language.js';
import EARTH from '../data/earth.json';

const $ = s => document.querySelector(s);
let sim = null, running = false, speed = 5, mode = 'political', sel = null, view = { tab: 'overview' }, lastDraw = 0, godTool = null, evFilter = { imp: true, cats: new Set() };
const fmtN = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : n >= 1000 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toString();
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const rgb = c => c ? `rgb(${c[0]},${c[1]},${c[2]})` : '#555';

// ---------------------------------------------------------------- setup
function newWorld(kind, seed) {
  running = false; $('#play').textContent = '▶ Play';
  sim = new Sim({ kind, seed, earthData: kind === 'earth' ? EARTH : null, startYear: -15000 });
  sel = null; view = { tab: 'overview' }; rivers = null; offs = null;
  draw(true); render();
}
const ERAS = [['steam', 'Industrial age'], ['printing', 'Age of print'], ['gunpowder', 'Gunpowder age'], ['paper', 'Age of manuscripts'], ['philosophy', 'Classical age'], ['iron', 'Iron Age'], ['bronze', 'Bronze Age'], ['copper', 'Copper Age'], ['cultivation', 'Neolithic'], ['pottery', 'Mesolithic'], [null, 'Late Stone Age']];
function eraName() { const known = new Set(); for (const k in sim.firstTech) known.add(k); for (const [t, n] of ERAS) if (!t || known.has(t)) return n; }

// ---------------------------------------------------------------- loop
function loop(t) {
  if (running && sim) {
    const t0 = performance.now(); const budget = speed >= 999 ? 60 : 40;
    sim._acc = (sim._acc || 0) + speed / 60;
    while (sim._acc >= 1 && performance.now() - t0 < budget) { sim.step(); sim._acc -= 1; }
    if (sim._acc > 3) sim._acc = 0;
  }
  if (sim && t - lastDraw > (running ? 250 : 1000)) { lastDraw = t; draw(); if (running) render(true); }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- map
let offs = null, rivers = null; const SC = 4;
function biome(T, P, elev, ice) {
  if (ice) return [235, 240, 245];
  let c;
  if (T < -6) c = [150, 145, 130]; else if (P < 180) c = [214, 190, 140]; else if (P < 420) c = T > 18 ? [196, 180, 110] : [170, 170, 110];
  else if (T < 3) c = [70, 105, 80]; else if (T > 20 && P > 1500) c = [40, 115, 55]; else if (T > 18) c = [120, 160, 70]; else if (P > 750) c = [70, 130, 70]; else c = [130, 150, 85];
  const s = Math.min(1, Math.max(0, elev) / 4500); return c.map(v => Math.round(v * (1 - 0.35 * s) + 255 * 0.35 * s * 0.8));
}
function ramp(t, a = [30, 30, 60], b = [250, 200, 60]) { t = Math.max(0, Math.min(1, t)); const m = [200, 70, 70]; return t < 0.5 ? a.map((v, i) => v + (m[i] - v) * t * 2) : m.map((v, i) => v + (b[i] - v) * (t - 0.5) * 2); }
function div(t) { t = Math.max(-1, Math.min(1, t)); return t < 0 ? [Math.round(240 + 200 * t * 0.9), Math.round(240 + 160 * t), 245] : [245, Math.round(240 - 160 * t), Math.round(240 - 200 * t)]; }
function cellColor(c) {
  const w = sim.world, cl = sim.climate;
  if (!w.land[c]) { const d = w.elev[c] - w.seaLevel; return d > -130 ? [52, 92, 130] : d > -1600 ? [30, 62, 104] : [20, 42, 78]; }
  const base = biome(cl.T[c], cl.P[c], w.elev[c], cl.ice[c]);
  const n = sim.cellN[c], dens = n / w.area[c];
  const dim = (col, k) => col.map((v, i) => Math.round(v * k + base[i] * (1 - k)));
  switch (mode) {
    case 'terrain': return base;
    case 'political': { const o = sim.owner[c]; if (o < 0) return dim(base.map(v => v * 0.55 + 60), 1); const O = sim.orgs.get(o); return O ? dim(O.color, 0.85) : base; }
    case 'population': return n ? ramp(Math.log10(dens + 0.01) / 3 + 0.5) : base.map(v => v * 0.35);
    case 'culture': { const C = sim.cultures.get(sim.cellCul[c]); return C ? dim(C.color, n ? Math.min(1, 0.55 + Math.log10(dens + 0.1) * 0.25) : 0) : base.map(v => v * 0.45); }
    case 'language': { const L = sim.languages.get(sim.cellLang[c]); return L ? dim(L.color, 0.9) : base.map(v => v * 0.45); }
    case 'religion': { const R = sim.religions.get(sim.cellRel[c]); return R ? dim(R.color, 0.9) : base.map(v => v * 0.45); }
    case 'tech': { const p = sim.cellPops[c][0]; return p ? ramp(techLevel(p.tech) / 40) : base.map(v => v * 0.4); }
    case 'subsistence': { let f = 0, h = 0, n2 = 0; for (const p of sim.cellPops[c]) { f += p.farm * p.n; h += p.herd * p.n; n2 += p.n; } if (!n2) return base.map(v => v * 0.4); f /= n2; h /= n2; return [Math.round(60 + 190 * h), Math.round(60 + 190 * f), Math.round(60 + 190 * (1 - f - h))]; }
    case 'temp': return div(cl.Tanom[c] / 8);
    case 'precip': return div(-cl.Panom[c]);
    case 'npp': return ramp(cl.NPP[c] / 2200, [60, 40, 20], [40, 200, 60]);
    case 'unrest': return sim.owner[c] >= 0 ? ramp(sim.unrest[c]) : base.map(v => v * 0.4);
    case 'disease': { let a = 0; for (const p of sim.cellPops[c]) for (const d in p.dz) if (p.dz[d].act) a++; return a ? [230, 50 + 30 * Math.min(4, a), 50] : n ? [70, 80, 70] : base.map(v => v * 0.35); }
  }
  return base;
}
function draw(force) {
  if (!sim) return;
  const w = sim.world, W = w.W, H = w.H;
  if (!offs) { offs = document.createElement('canvas'); offs.width = W * SC; offs.height = H * SC; }
  const ctx = offs.getContext('2d'); const img = ctx.createImageData(W * SC, H * SC); const d = img.data;
  const borderMode = mode === 'political' || mode === 'culture' || mode === 'religion' || mode === 'language';
  const key = c => mode === 'political' ? sim.owner[c] : mode === 'culture' ? sim.cellCul[c] : mode === 'religion' ? sim.cellRel[c] : sim.cellLang[c];
  for (let c = 0; c < w.N; c++) {
    const col = cellColor(c); const x0 = w.x[c] * SC, y0 = w.y[c] * SC;
    const k = borderMode && w.land[c] ? key(c) : null;
    const kr = k !== null ? key(w.idx(w.x[c] + 1, w.y[c])) : null, kd = k !== null && w.y[c] < H - 1 ? key(c + W) : null;
    for (let yy = 0; yy < SC; yy++) for (let xx = 0; xx < SC; xx++) {
      let r = col[0], g = col[1], b = col[2];
      if (k !== null && k >= 0 && ((xx === SC - 1 && kr !== k) || (yy === SC - 1 && kd !== k))) { r *= 0.35; g *= 0.35; b *= 0.35; }
      const i = ((y0 + yy) * W * SC + x0 + xx) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const cv = $('#map'), wrap = $('#mapwrap'); const dpr = window.devicePixelRatio || 1;
  cv.width = wrap.clientWidth * dpr; cv.height = wrap.clientHeight * dpr;
  const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.fillStyle = '#0d1015'; g.fillRect(0, 0, cv.width, cv.height);
  const s = Math.min(cv.width / W, cv.height / H); const ox = (cv.width - W * s) / 2, oy = (cv.height - H * s) / 2; view.map = { s, ox, oy };
  g.drawImage(offs, ox, oy, W * s, H * s);
  // rivers
  if (!rivers || rivers.sl !== w.seaLevel) { rivers = { sl: w.seaLevel, seg: [] }; for (let c = 0; c < w.N; c++) { const j = w.flowTo[c]; if (w.land[c] && j >= 0 && w.discharge[c] > 250 && Math.abs(w.x[c] - w.x[j]) < 2) rivers.seg.push([c, j, Math.min(3, 0.5 + w.discharge[c] / 4000)]); } }
  if (mode === 'terrain' || mode === 'political' || mode === 'subsistence') {
    g.strokeStyle = 'rgba(90,150,215,.85)'; g.lineCap = 'round';
    for (const [a, b, wd] of rivers.seg) { g.lineWidth = wd * s / 4; g.beginPath(); g.moveTo(ox + (w.x[a] + .5) * s, oy + (w.y[a] + .5) * s); g.lineTo(ox + (w.x[b] + .5) * s, oy + (w.y[b] + .5) * s); g.stroke(); }
  }
  // capitals & seats
  if (mode === 'political') {
    g.font = `${Math.max(10, s * 2.2) | 0}px system-ui`; g.textAlign = 'center';
    const pols = [...sim.orgs.values()].filter(o => !o.dead && o.kind === 'polity' && o.capital >= 0).sort((a, b) => b.popTotal - a.popTotal);
    pols.forEach((o, i) => {
      const x = ox + (w.x[o.capital] + .5) * s, y = oy + (w.y[o.capital] + .5) * s; const r = Math.max(1.5, s * (o.level >= 3 ? 0.55 : 0.35));
      g.fillStyle = o.level >= 3 ? '#fff' : '#ddd'; g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
      if (i < 25 && o.level >= 2) { g.fillStyle = 'rgba(0,0,0,.65)'; g.fillText(o.place, x + 1, y - r - 2 + 1); g.fillStyle = '#fff'; g.fillText(o.place, x, y - r - 2); }
    });
  }
  if (sel && sel.k === 'cell') { const x = ox + w.x[sel.id] * s, y = oy + w.y[sel.id] * s; g.strokeStyle = '#ffd54a'; g.lineWidth = 2; g.strokeRect(x, y, s, s); }
  if (sel && sel.k === 'org') { const o = sim.orgs.get(sel.id); if (o && o.kind === 'polity') { g.fillStyle = 'rgba(255,213,74,.25)'; for (const c of o.cellList) g.fillRect(ox + w.x[c] * s, oy + w.y[c] * s, s, s); } }
  legend();
  bottom();
}
function legend() {
  const L = {
    terrain: 'Biomes from current temperature & rainfall; white = ice. Blue lines: major rivers.', political: 'Polities (borders dark). Dots = capitals; white = kingdoms/empires.',
    population: 'Population density (log scale): dark → yellow = 0.01 → 1000+ per km²', culture: 'Dominant culture per region', language: 'Dominant language per region', religion: 'Dominant religion per region',
    tech: 'Technology level of the largest local population', subsistence: '<span class="sw" style="background:#3cf03c"></span>farming <span class="sw" style="background:#f03c3c"></span>herding <span class="sw" style="background:#3c3cf0"></span>foraging',
    temp: 'Temperature anomaly vs. modern baseline (blue cold / red warm, ±8°C)', precip: 'Rainfall anomaly vs. baseline (red drier / blue wetter)', npp: 'Plant productivity (Miami model)', unrest: 'Unrest within polities', disease: 'Red = active epidemics',
  };
  $('#legend').innerHTML = L[mode] || '';
}
function cellAt(ev) {
  const cv = $('#map'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; const { s, ox, oy } = view.map || {};
  if (!s) return -1; const x = Math.floor(((ev.clientX - r.left) * dpr - ox) / s), y = Math.floor(((ev.clientY - r.top) * dpr - oy) / s);
  if (x < 0 || y < 0 || x >= sim.world.W || y >= sim.world.H) return -1; return y * sim.world.W + x;
}

// ---------------------------------------------------------------- links & helpers
const link = (k, id, text) => `<a class="l" data-k="${k}" data-id="${id}">${esc(text)}</a>`;
function P(id) { return sim.persons.get(id) || (sim.archive && sim.archive.get(id)); }
const pl = id => { const p = P(id); return p ? link('person', id, fullName(sim, p)) : '<span class="muted">(forgotten)</span>'; };
const ol = id => { const o = sim.orgs.get(id); return o ? link('org', id, o.name) : '—'; };
const cl = id => { const c = sim.cultures.get(id); return c ? link('culture', id, c.name) : '—'; };
const ll = id => { const c = sim.languages.get(id); return c ? link('lang', id, c.name) : '—'; };
const rl = id => { const c = sim.religions.get(id); return c ? link('rel', id, c.name) : '—'; };
const cellL = c => link('cell', c, sim.world.cellName(c));
function linkify(e) {
  let t = esc(e.text); const refs = [];
  if (e.person && P(e.person)) refs.push(link('person', e.person, '👤')); if (e.org && sim.orgs.get(e.org)) refs.push(link('org', e.org, '🏛')); if (e.war && sim.wars.get(e.war)) refs.push(link('war', e.war, '⚔'));
  if (e.rel && sim.religions.get(e.rel)) refs.push(link('rel', e.rel, '✦')); if (e.cul && sim.cultures.get(e.cul)) refs.push(link('culture', e.cul, '◆')); if (e.lang && sim.languages.get(e.lang)) refs.push(link('lang', e.lang, '❝'));
  if (e.dis && sim.diseases.get(e.dis)) refs.push(link('dis', e.dis, '☣')); if (e.cell >= 0 && e.cell !== undefined) refs.push(link('cell', e.cell, '📍'));
  return `<div class="ev${e.important ? ' imp' : ''}"><span class="y">${sim.fmtYear(e.y)}</span>${t} ${refs.join(' ')}</div>`;
}
const bar = (v, mid = false, cls = '') => `<div class="bar ${mid ? 'mid' : ''} ${cls}"><i style="${mid ? (v >= 0 ? `left:50%;width:${Math.min(50, v * 50)}%` : `left:${50 + Math.max(-50, v * 50)}%;width:${Math.min(50, -v * 50)}%`) : `left:0;width:${Math.max(0, Math.min(100, v * 100))}%`}"></i></div>`;
const row = (label, v, txt, mid = false, cls = '') => `<div class="row"><span>${label}</span>${bar(v, mid, cls)}<span class="muted small">${txt}</span></div>`;

// ---------------------------------------------------------------- panels
const TABS = [['overview', 'World'], ['inspect', 'Inspector'], ['events', 'Chronicle'], ['people', 'People'], ['orgs', 'Groups'], ['peoples', 'Peoples'], ['tech', 'Tech'], ['climate', 'Climate'], ['god', 'God tools']];
function render(live = false) {
  if (!sim) return;
  $('#year').textContent = sim.fmtYear(sim.year); $('#era').textContent = eraName();
  $('#tabs').innerHTML = TABS.map(([k, n]) => `<button data-tab="${k}" class="${view.tab === k ? 'on' : ''}">${n}</button>`).join('');
  if (live && (view.tab === 'inspect' && sel && sel.k === 'person')) return renderPane(); // keep it lively
  if (live && document.querySelector('#pane:hover')) return; // don't yank content under the cursor
  renderPane();
}
function renderPane() {
  const f = { overview: paneOverview, inspect: paneInspect, events: paneEvents, people: panePeople, orgs: paneOrgs, peoples: panePeoples, tech: paneTech, climate: paneClimate, god: paneGod }[view.tab];
  const st = $('#pane').scrollTop; $('#pane').innerHTML = f(); $('#pane').scrollTop = st;
  for (const cv of document.querySelectorAll('canvas.chart')) drawChart(cv);
}
function bottom() {
  const s = sim.stats[sim.stats.length - 1] || {};
  let pop = 0; for (const p of sim.pops.values()) pop += p.n;
  $('#bottom').innerHTML = `<span>Population <b>${fmtN(pop)}</b></span><span>Polities <b>${s.polities ?? 0}</b></span><span>Cultures <b>${s.cultures ?? 0}</b></span><span>Languages <b>${s.languages ?? 0}</b></span><span>Religions <b>${s.religions ?? 0}</b></span><span>Figures alive <b>${sim.livingPersons || 0}</b></span><span>Wars <b>${[...sim.wars.values()].filter(w => !w.ended).length}</b></span><span>Global ΔT <b>${sim.climate.dTg.toFixed(1)}°C</b></span><span>Sea level <b>${sim.climate.seaLevel.toFixed(0)} m</b></span><span>${sim.kind === 'earth' ? 'Earth' : 'Generated world'} · seed ${sim.seed}</span>`;
}
function paneOverview() {
  const pols = [...sim.orgs.values()].filter(o => !o.dead && o.kind === 'polity').sort((a, b) => b.popTotal - a.popTotal).slice(0, 12);
  const wars = [...sim.wars.values()].filter(w => !w.ended).slice(-8);
  const ev = sim.log.filter(e => e.important).slice(-14).reverse();
  return `<h2>${esc(eraName())}, ${sim.fmtYear(sim.year)}</h2>
  <canvas class="chart" data-series="pop" data-title="World population (log)"></canvas>
  <h3>Largest polities</h3>${pols.length ? `<table><tr><th>Polity</th><th>Ruler</th><th>People</th><th>Regions</th></tr>${pols.map(o => `<tr><td><span class="sw" style="background:${rgb(o.color)}"></span>${ol(o.id)}</td><td>${o.leader ? pl(o.leader) : '—'}</td><td>${fmtN(o.popTotal)}</td><td>${o.cells}</td></tr>`).join('')}</table>` : '<div class="muted">No one rules anyone yet. Foragers live in egalitarian bands.</div>'}
  ${wars.length ? `<h3>Wars in progress</h3>${wars.map(w => `<div>${link('war', w.id, w.name)} <span class="muted">since ${sim.fmtYear(w.started)}, score ${w.score.toFixed(0)}</span></div>`).join('')}` : ''}
  <h3>Recent major events</h3>${ev.map(linkify).join('') || '<div class="muted">Quiet so far.</div>'}`;
}
function paneEvents() {
  const cats = ['climate', 'migration', 'tech', 'polity', 'war', 'battle', 'diplomacy', 'succession', 'intrigue', 'court', 'death', 'religion', 'culture', 'language', 'disease', 'economy', 'org', 'crime', 'nature', 'god'];
  let list = sim.log.filter(e => (!evFilter.imp || e.important) && (!evFilter.cats.size || evFilter.cats.has(e.cat)));
  list = list.slice(-400).reverse();
  return `<div class="filters"><button data-evimp class="${evFilter.imp ? 'on' : ''}">Major only</button>${cats.map(c => `<button data-evcat="${c}" class="${evFilter.cats.has(c) ? 'on' : ''}">${c}</button>`).join('')}</div>${list.map(linkify).join('') || '<div class="muted">No events match.</div>'}`;
}
function panePeople() {
  const ps = [...sim.persons.values()].filter(p => p.active && !p.died && (p.roles.size || p.tags.size || p.notable));
  const key = view.psort || 'power'; const val = p => key === 'age' ? -age(sim, p) : key === 'prestige' ? p.prestige : key === 'name' ? 0 : [...p.roles].some(r => r.endsWith(':leader')) ? 1000 + (sim.orgs.get(p.org)?.popTotal || 0) / 1e4 : p.roles.size * 10 + p.prestige / 10;
  ps.sort((a, b) => val(b) - val(a));
  return `<h2>Living historical figures (${ps.length})</h2><div class="filters">${['power', 'prestige', 'age'].map(k => `<button data-psort="${k}" class="${key === k ? 'on' : ''}">by ${k}</button>`).join('')}</div>
  <table><tr><th>Name</th><th>Age</th><th>Role</th><th>Drive</th></tr>${ps.slice(0, 250).map(p => { const r = [...p.roles][0]; const [oid, t] = r ? r.split(':') : []; const o = r && sim.orgs.get(+oid); return `<tr><td>${pl(p.id)}${p.tags.has('prophet') ? ' <span class="tag">prophet</span>' : ''}${p.tags.has('inventor') ? ' <span class="tag">inventor</span>' : ''}</td><td>${age(sim, p)}</td><td class="small">${o ? esc(titleOf(sim, o, t)) + ', ' + ol(o.id) : p.tags.has('exile') ? 'exile' : 'family'}</td><td class="small muted">${topGoal(p)}</td></tr>`; }).join('')}</table>`;
}
function paneOrgs() {
  const k = view.okind || 'polity';
  const os = [...sim.orgs.values()].filter(o => !o.dead && o.kind === k).sort((a, b) => (b.popTotal || b.wealth) - (a.popTotal || a.wealth));
  const dead = [...sim.orgs.values()].filter(o => o.dead && o.kind === k && (o.kind !== 'polity' || o.peakPop > 50000)).sort((a, b) => b.dead - a.dead).slice(0, 40);
  return `<div class="filters">${Object.entries(ORG_KINDS).map(([kk, n]) => `<button data-okind="${kk}" class="${k === kk ? 'on' : ''}">${n}s (${[...sim.orgs.values()].filter(o => !o.dead && o.kind === kk).length})</button>`).join('')}</div>
  <table><tr><th>Name</th><th>Leader</th><th>${k === 'polity' ? 'People' : 'Wealth'}</th><th>Since</th></tr>${os.slice(0, 300).map(o => `<tr><td><span class="sw" style="background:${rgb(o.color)}"></span>${ol(o.id)}</td><td class="small">${o.leader ? pl(o.leader) : '—'}</td><td>${k === 'polity' ? fmtN(o.popTotal) : Math.round(o.wealth)}</td><td class="small muted">${sim.fmtYear(o.born)}</td></tr>`).join('')}</table>
  ${dead.length ? `<h3>Fallen</h3>${dead.map(o => `<div class="small">${ol(o.id)} <span class="muted">${sim.fmtYear(o.born)} – ${sim.fmtYear(o.dead)}</span></div>`).join('')}` : ''}`;
}
function panePeoples() {
  const sub = view.sub || 'culture';
  const tabs = `<div class="filters">${['culture', 'lang', 'rel', 'dis'].map(s => `<button data-sub="${s}" class="${sub === s ? 'on' : ''}">${{ culture: 'Cultures', lang: 'Languages', rel: 'Religions', dis: 'Diseases' }[s]}</button>`).join('')}</div>`;
  if (sub === 'dis') { const ds = [...sim.diseases.values()].sort((a, b) => b.deaths - a.deaths); return tabs + `<table><tr><th>Disease</th><th>R0</th><th>Lethality</th><th>Deaths</th><th>Status</th></tr>${ds.map(D => `<tr><td>${link('dis', D.id, D.name)}</td><td>${D.R0.toFixed(1)}</td><td>${(D.cfr * 100).toFixed(1)}%</td><td>${fmtN(D.deaths)}</td><td class="small muted">${D.extinct ? 'extinct ' + sim.fmtYear(D.extinct) : 'active'}</td></tr>`).join('')}</table>` || tabs + '<div class="muted">No crowd diseases yet — they need dense, animal-keeping populations.</div>'; }
  const m = sub === 'culture' ? sim.cultures : sub === 'lang' ? sim.languages : sim.religions;
  const xs = [...m.values()].filter(x => !x.dead && x.n > 0 && !x.proto).sort((a, b) => b.n - a.n);
  return tabs + `<table><tr><th>Name</th><th>People</th><th>Since</th></tr>${xs.slice(0, 300).map(x => `<tr><td><span class="sw" style="background:${rgb(x.color)}"></span>${link(sub, x.id, x.name)}</td><td>${fmtN(x.n)}</td><td class="small muted">${sim.fmtYear(x.born)}</td></tr>`).join('')}</table>`;
}
function paneTech() {
  const rows = TECHS.map(t => { const f = sim.firstTech[t.id]; let n = 0, tot = 0; for (const p of sim.pops.values()) { tot += p.n; if (p.tech[t.idx]) n += p.n; } return { t, f, share: n / Math.max(1, tot) }; });
  return `<h2>Technology</h2><div class="note">Inventions happen at a rate proportional to connected population, need, and prerequisites; they spread along contacts and can be forgotten by small, isolated groups.</div>
  <table><tr><th>Technology</th><th>First</th><th>Share of humanity</th></tr>${rows.map(r => `<tr><td>${esc(r.t.name)}<div class="small muted">${r.t.pre.map(p => TECHS[TI[p]].name).join(', ')}</div></td><td class="small">${r.f ? sim.fmtYear(r.f.y) + ' ' + cellL(r.f.c) : r.t.start ? 'known' : '—'}</td><td style="width:110px">${bar(r.share)}<span class="small muted">${(r.share * 100).toFixed(1)}%</span></td></tr>`).join('')}</table>`;
}
function paneClimate() {
  const c = sim.climate;
  return `<h2>Climate</h2><div class="kv"><div>Global ΔT</div><div>${c.dTg.toFixed(2)} °C vs modern</div><div>Ice volume</div><div>${(c.V * 100).toFixed(0)}% of glacial max</div><div>Sea level</div><div>${c.seaLevel.toFixed(0)} m</div><div>Ocean overturning</div><div>${c.amoc > 0.5 ? 'running' : '<b style="color:var(--bad)">collapsed</b>'}</div><div>Monsoon strength</div><div>${c.monsoon.toFixed(2)}</div><div>Orbital forcing</div><div>${(c.ins * 100).toFixed(1)}% NH summer insolation anomaly</div><div>Volcanic forcing</div><div>${c.volc.toFixed(2)} °C</div></div>
  <canvas class="chart" data-series="dT" data-title="Global temperature anomaly (°C)"></canvas><canvas class="chart" data-series="sl" data-title="Sea level (m)"></canvas><canvas class="chart" data-series="mon" data-title="Monsoon strength"></canvas>
  <div class="note">Cycles are not scripted: orbital forcing drives ice sheets (with albedo hysteresis), meltwater can shut down the ocean overturning, monsoons follow insolation with a vegetation feedback, and on top sit millennial, solar, ENSO-like and decadal regional oscillations plus random eruptions.</div>`;
}
function paneGod() {
  const t = (k, n) => `<button data-god="${k}" class="${godTool === k ? 'on' : ''}">${n}</button>`;
  return `<h2>God tools</h2><div class="note">Pick a tool, then click the map. Use these to test how the world responds.</div>
  <h3>Click-to-apply</h3><div class="god">${t('drought', '☀ Megadrought (15 yrs)')}${t('plague', '☣ Release plague')}${t('prophet', '✦ Raise a prophet')}${t('volcano', '🌋 Supervolcano')}${t('migrants', '➜ Send migrants from selected region')}${t('techgift', '💡 Reveal technology')}
  <select id="godtech">${TECHS.map(x => `<option value="${x.id}">${x.name}</option>`).join('')}</select></div>
  <h3>Global</h3><div class="god"><button data-gg="warm">+1°C</button><button data-gg="cool">−1°C</button><button data-gg="iceup">Grow ice sheets</button><button data-gg="icedown">Melt ice sheets</button></div>
  <div class="note">Person and polity pages also have god buttons (strike down a ruler, spark a revolt).</div>`;
}
function paneInspect() {
  if (!sel) return '<div class="muted">Click the map or any link to inspect it.</div>';
  const f = { cell: inspCell, person: inspPerson, org: inspOrg, culture: inspCulture, lang: inspLang, rel: inspRel, war: inspWar, dis: inspDis }[sel.k];
  return f ? f(sel.id) : '';
}
function inspCell(c) {
  const w = sim.world, cl = sim.climate; const pops = sim.cellPops[c].slice().sort((a, b) => b.n - a.n);
  const o = sim.owner[c] >= 0 ? sim.orgs.get(sim.owner[c]) : null;
  const crops = CROPS.filter((x, k) => w.cropWild[c * CROPS.length + k]).map(x => x.name), anim = ANIMALS.filter((x, k) => w.animalWild[c * ANIMALS.length + k]).map(x => x.name);
  const ores = ['copper', 'tin', 'iron', 'gold', 'salt'].filter(x => w.ore[x][c]);
  const seated = [...sim.orgs.values()].filter(q => !q.dead && q.kind !== 'polity' && q.seat === c);
  return `<h2>${w.cellName(c)}</h2><div class="kv">
  <div>Ruled by</div><div>${o ? ol(o.id) + (o.capital === c ? ' <span class="tag">capital</span>' : '') : '<span class="muted">no one</span>'}</div>
  <div>Population</div><div>${fmtN(sim.cellN[c])} (${(sim.cellN[c] / w.area[c]).toFixed(2)}/km²), ${fmtN(sim.cellUrban[c])} urban</div>
  <div>Area</div><div>${fmtN(w.area[c])} km² · elev ${Math.round(w.elev[c])} m ${w.discharge[c] > 100 ? '· river ' + fmtN(w.discharge[c]) + ' m³/s' : ''}</div>
  <div>Climate now</div><div>${cl.T[c].toFixed(1)} °C (${cl.Tanom[c] >= 0 ? '+' : ''}${cl.Tanom[c].toFixed(1)}), ${Math.round(cl.P[c])} mm (${cl.Panom[c] >= 0 ? '+' : ''}${(cl.Panom[c] * 100).toFixed(0)}%) ${cl.ice[c] ? '· ice' : ''}</div>
  <div>Productivity</div><div>${Math.round(cl.NPP[c])} g/m²/yr · game ${(sim.game[c] / Math.max(1, sim.gameK[c]) * 100).toFixed(0)}% of capacity · soil ${(sim.soil[c] * 100).toFixed(0)}%${sim.salt[c] > 0.05 ? ' (salinised)' : ''}</div>
  <div>Wild plants</div><div>${crops.join(', ') || '—'}</div><div>Wild animals</div><div>${anim.join(', ') || '—'}</div><div>Deposits</div><div>${ores.join(', ') || '—'}</div>
  ${o ? `<div>Control / unrest</div><div>${(sim.control[c] * 100).toFixed(0)}% / ${(sim.unrest[c] * 100).toFixed(0)}%</div>` : ''}
  </div>${seated.length ? `<h3>Based here</h3>${seated.map(q => `<div>${ol(q.id)} <span class="muted">${ORG_KINDS[q.kind]}</span></div>`).join('')}` : ''}
  <h3>Populations</h3>${pops.map(p => `<div style="margin-bottom:8px"><b>${fmtN(p.n)}</b> ${cl(p.cul)} · speaking ${ll(p.lang)} · ${rl(p.rel)}<div class="small muted">food ${(p.food * 100).toFixed(0)}% of need · farming ${(p.farm * 100).toFixed(0)}% herding ${(p.herd * 100).toFixed(0)}% foraging ${((1 - p.farm - p.herd) * 100).toFixed(0)}% · urban ${(p.urban * 100).toFixed(1)}% · tech ${techLevel(p.tech)}</div>
  <div class="small muted">${TECHS.filter(t => p.tech[t.idx] && !t.start).map(t => t.name).join(', ')}</div>
  ${Object.keys(p.dz).length ? `<div class="small">Diseases: ${Object.entries(p.dz).map(([d, s]) => `${link('dis', d, sim.diseases.get(+d)?.name || '?')} ${s.act ? '(active)' : ''} ${(s.imm * 100).toFixed(0)}% immune`).join('; ')}</div>` : ''}</div>`).join('') || '<div class="muted">Uninhabited.</div>'}`;
}
function inspPerson(id) {
  const p = P(id); if (!p) return '<div class="muted">This person has been forgotten by history.</div>';
  const D = p.dyn && sim.dynasties.get(p.dyn); const alive = !p.died;
  const roles = [...p.roles].map(r => { const [oid, t] = r.split(':'); const o = sim.orgs.get(+oid); return o ? `${esc(titleOf(sim, o, t))} of ${ol(o.id)}` : ''; }).filter(Boolean);
  const op = []; if (alive) { for (const [oid] of p.mem) { const q = P(oid); if (q && !q.died) op.push([q, opinion(sim, p, q)]); } for (const r of [...p.roles]) { const o = sim.orgs.get(+r.split(':')[0]); if (o) { for (const x of [o.leader, ...o.offices.map(f => f.h)]) { const q = x && P(x); if (q && q !== p && !op.some(e => e[0] === q)) op.push([q, opinion(sim, p, q)]); } } } }
  op.sort((a, b) => b[1] - a[1]);
  const pe = p.pers; const big = [['Openness', pe.O], ['Conscientiousness', pe.C], ['Extraversion', pe.E], ['Agreeableness', pe.A], ['Neuroticism', pe.N]];
  const ruled = p.roles.size && [...p.roles].find(r => r.endsWith(':leader'));
  return `<h2>${esc(fullName(sim, p))} ${p.female ? '♀' : '♂'}</h2>
  <div class="muted">${alive ? `Age ${age(sim, p)}` : `${sim.fmtYear(p.born)} – ${sim.fmtYear(p.died)}, ${esc(p.cause || '')}`} · ${cl(p.cul)} · ${rl(p.rel)}${D ? ' · house ' + esc(D.name) : ''}</div>
  ${roles.length ? `<div style="margin:6px 0">${roles.join('<br>')}</div>` : ''}${[...p.tags].map(t => `<span class="tag">${t}</span>`).join('')}
  <h3>Character</h3><div class="small" style="margin-bottom:4px">${esc(describePersonality(p))}</div>
  ${big.map(([n, v]) => row(n, v / 2.5, (v >= 0 ? '+' : '') + v.toFixed(1), true)).join('')}
  ${row('Ambition', p.ambition, (p.ambition * 100).toFixed(0), false, 'c')}${row('Piety', (p.piety + 1) / 2, p.piety.toFixed(2), false, 'c')}
  <h3>Goals</h3>${Object.entries(p.goals).sort((a, b) => b[1] - a[1]).map(([g, v]) => row(g, v / 0.7, (v * 100).toFixed(0) + '%', false, 'c')).join('')}
  <h3>Skills</h3>${Object.entries(p.sk).map(([k, v]) => row(SKILL_NAMES[k], v / 20, v.toFixed(1))).join('')}
  <div class="kv" style="margin-top:6px"><div>Prestige</div><div>${p.prestige.toFixed(0)}</div><div>Health</div><div>${(p.health * 100).toFixed(0)}%</div></div>
  <h3>Family</h3><div class="kv"><div>Father</div><div>${p.fa ? pl(p.fa) : '—'}</div><div>Mother</div><div>${p.mo ? pl(p.mo) : '—'}</div><div>Spouse</div><div>${p.sp ? pl(p.sp) : p.widowed ? 'widowed (' + pl(p.widowed) + ')' : '—'}</div><div>Children</div><div>${p.kids.map(pl).join(', ') || '—'}</div></div>
  ${op.length ? `<h3>Opinions</h3>${op.slice(0, 6).concat(op.length > 6 ? op.slice(-4) : []).map(([q, v]) => `<div class="row"><span>${pl(q.id)}</span>${bar(v / 100, true)}<span class="small muted">${v.toFixed(0)}</span></div><div class="small muted" style="margin:-2px 0 4px 116px">${esc(opinionReasons(sim, p, q).join(', '))}</div>`).join('')}` : ''}
  <h3>Life</h3>${p.bio.slice().reverse().map(b => `<div class="ev"><span class="y">${sim.fmtYear(b.y)}</span>${esc(b.t)}</div>`).join('')}
  ${alive ? `<h3>God</h3><button data-godp="kill" data-id="${p.id}">⚡ Strike down</button>` : ''}`;
}
function inspOrg(id) {
  const o = sim.orgs.get(id); if (!o) return '';
  const lead = leaderOf(sim, o);
  const rels = [...o.rels.entries()].map(([qid, r]) => [sim.orgs.get(qid), r]).filter(([q]) => q && !q.dead);
  const wars = o.wars.map(wid => sim.wars.get(wid)).filter(Boolean);
  const debt = o.debts.reduce((s, d) => s + d.amt, 0);
  return `<h2><span class="sw" style="background:${rgb(o.color)}"></span>${esc(o.name)}</h2><div class="muted">${o.kind === 'polity' ? orgLabel(sim, o) : ORG_KINDS[o.kind]} · founded ${sim.fmtYear(o.born)}${o.dead ? ' · fell ' + sim.fmtYear(o.dead) : ''}</div>
  <div class="kv" style="margin-top:6px"><div>${esc(titleOf(sim, o, 'leader'))}</div><div>${lead ? pl(lead.id) + ` <span class="muted">(since ${sim.fmtYear(o.leaderSince)})</span>` : '<span class="muted">vacant</span>'}</div>
  ${o.kind === 'polity' ? `<div>Succession</div><div>${o.succ}</div><div>People</div><div>${fmtN(o.popTotal)} in ${o.cells} regions (${fmtN(o.urbanPop || 0)} urban)</div><div>Capital</div><div>${cellL(o.capital)}</div><div>Culture / faith</div><div>${cl(o.cul)} · ${rl(o.rel)} · ${ll(o.lang)}</div>
  <div>Treasury</div><div>${Math.round(o.wealth)} (income ${Math.round(o.rev || 0)}/yr, tax ${(o.tax * 100).toFixed(0)}%)${debt ? ` · debt ${Math.round(debt)}` : ''}</div><div>Legitimacy</div><div>${(o.legit * 100).toFixed(0)}%</div><div>Army</div><div>${fmtN(o.men || 0)} men × quality ${(o.quality || 1).toFixed(2)}</div><div>Exhaustion</div><div>${(o.exhaustion * 100).toFixed(0)}%</div>
  ${o.overlord >= 0 ? `<div>Overlord</div><div>${ol(o.overlord)}</div>` : ''}${o.vassals.size ? `<div>Tributaries</div><div>${[...o.vassals].map(ol).join(', ')}</div>` : ''}${o.tradePartners.size ? `<div>Trade with</div><div>${[...o.tradePartners].map(ol).join(', ')}</div>` : ''}`
      : `<div>Seat</div><div>${o.seat >= 0 ? cellL(o.seat) : '—'}${o.parent ? ' in ' + ol(o.parent) : ''}</div><div>Wealth</div><div>${Math.round(o.wealth)}</div>${o.religionOf ? `<div>Faith</div><div>${rl(o.religionOf)}</div>` : ''}${o.loans.length ? `<div>Lent to</div><div>${[...new Set(o.loans)].map(ol).join(', ')}</div>` : ''}`}</div>
  <h3>Officers</h3>${o.offices.map(f => `<div class="row" style="grid-template-columns:150px 1fr"><span class="muted">${esc(f.t)}</span><span>${f.h ? pl(f.h) + (lead && P(f.h) ? ` <span class="small muted">(${opinion(sim, P(f.h), lead).toFixed(0)} towards ruler)</span>` : '') : '<span class="muted">vacant</span>'}</span></div>`).join('') || '<div class="muted">—</div>'}
  ${o.factions.length ? `<h3>Factions</h3>${o.factions.map(F => `<div>${pl(F.head)} seeks to <b>${F.goal === 'replace' ? 'seize power' : 'break away'}</b> · power ${F.power.toFixed(1)}<div class="small muted">with ${F.members.filter(m => m !== F.head).map(pl).join(', ') || 'no one else'}${F.backers.length ? ' · backed by ' + F.backers.map(ol).join(', ') : ''}</div></div>`).join('')}` : ''}
  ${wars.length ? `<h3>At war</h3>${wars.map(w => `<div>${link('war', w.id, w.name)}</div>`).join('')}` : ''}
  ${rels.length ? `<h3>Relations</h3>${rels.sort((a, b) => orgOpinion(sim, o, b[0]) - orgOpinion(sim, o, a[0])).slice(0, 12).map(([q, r]) => { const v = orgOpinion(sim, o, q); return `<div class="row"><span>${ol(q.id)}</span>${bar(v / 100, true)}<span class="small muted">${v.toFixed(0)}${r.ally ? ' ally' : ''}</span></div>`; }).join('')}` : ''}
  <h3>History</h3>${o.hist.slice().reverse().map(h => `<div class="ev"><span class="y">${sim.fmtYear(h.y)}</span>${esc(h.t)}</div>`).join('')}
  ${!o.dead ? `<h3>God</h3>${lead ? `<button data-godp="kill" data-id="${lead.id}">⚡ Strike down the ruler</button>` : ''} ${o.kind === 'polity' ? `<button data-godo="revolt" data-id="${o.id}">🔥 Spark a revolt</button> <button data-godo="enrich" data-id="${o.id}">💰 Shower with gold</button>` : ''}` : ''}`;
}
function inspCulture(id) {
  const C = sim.cultures.get(id); if (!C) return '';
  const kids = [...sim.cultures.values()].filter(x => x.parent === id);
  return `<h2><span class="sw" style="background:${rgb(C.color)}"></span>The ${esc(C.name)}</h2><div class="muted">Culture since ${sim.fmtYear(C.born)}${C.dead ? ', vanished ' + sim.fmtYear(C.dead) : ''} · ${fmtN(C.n)} people in ${C.cells} regions</div>
  <div class="kv" style="margin-top:6px"><div>Main language</div><div>${ll(C.lang)}</div><div>Folk religion</div><div>${C.folk ? rl(C.folk) : '—'}</div><div>Descended from</div><div>${C.parent ? link('culture', C.parent, sim.cultures.get(C.parent)?.name || '?') : '—'}</div><div>Offshoots</div><div>${kids.map(k => cl(k.id)).join(', ') || '—'}</div></div>
  <h3>Values</h3>${TRAITS.map((t, k) => row(t, C.centroid[k], C.centroid[k].toFixed(2), true)).join('')}
  <div class="note">Values drift randomly (faster in small groups), adapt to how people live (plough → patriarchy, herding → honour, irrigation → collectivism, cities → openness), converge with neighbours, and split into new peoples when groups diverge.</div>`;
}
function inspLang(id) {
  const L = sim.languages.get(id); if (!L) return '';
  const anc = []; let a = L.parent; while (a) { const x = sim.languages.get(a); if (!x) break; anc.push(x); a = x.parent; }
  const sis = [...sim.languages.values()].filter(x => x.family === L.family && x.id !== L.id && !x.dead && x.n > 0).map(x => [x, L.similarity(x)]).sort((p, q) => q[1] - p[1]).slice(0, 8);
  return `<h2><span class="sw" style="background:${rgb(L.color)}"></span>${esc(L.name)}</h2><div class="muted">${L.dead ? 'Extinct ' + sim.fmtYear(L.dead) : fmtN(L.n) + ' speakers'} · since ${sim.fmtYear(L.born)}</div>
  <div class="kv" style="margin-top:6px"><div>Lineage</div><div>${anc.map(x => link('lang', x.id, x.name)).join(' ← ') || '—'}</div><div>Consonants</div><div>${esc(L.cons.join(' '))}</div><div>Vowels</div><div>${esc(L.vows.join(' '))}</div></div>
  <h3>Core vocabulary</h3><table>${CONCEPTS.slice(0, 40).map(c => `<tr><td class="muted">${c}</td><td><b>${esc(L.word(c))}</b></td></tr>`).join('')}</table>
  ${sis.length ? `<h3>Relatives (shared core vocabulary)</h3>${sis.map(([x, s]) => `<div class="row"><span>${link('lang', x.id, x.name)}</span>${bar(s)}<span class="small muted">${(s * 100).toFixed(0)}%</span></div>`).join('')}` : ''}
  <div class="note">Words change through regular sound laws, lose ~14% of core vocabulary per millennium, and borrow from neighbours. Isolated dialects become separate languages.</div>`;
}
function inspRel(id) {
  const R = sim.religions.get(id); if (!R) return '';
  const kids = [...sim.religions.values()].filter(x => x.parent === id);
  return `<h2><span class="sw" style="background:${rgb(R.color)}"></span>${esc(R.name)}</h2><div class="muted">${R.type} · ${R.dead ? 'extinct ' + sim.fmtYear(R.dead) : fmtN(R.n) + ' adherents in ' + R.cells + ' regions'} · since ${sim.fmtYear(R.born)}</div>
  <div class="kv" style="margin-top:6px"><div>Founder</div><div>${R.founder ? pl(R.founder) : 'ancestral'}</div><div>Deity</div><div>${esc(R.deity || '—')}</div><div>Holy site</div><div>${R.holy >= 0 ? cellL(R.holy) : '—'}</div><div>Church</div><div>${R.church ? ol(R.church) : '—'}</div><div>Derived from</div><div>${R.parent ? rl(R.parent) : '—'}</div><div>Offshoots</div><div>${kids.map(k => rl(k.id)).join(', ') || '—'}</div></div>
  <h3>Teachings</h3>${Object.entries(R.tenets).map(([k, v]) => row({ prosel: 'proselytising', excl: 'exclusivity', hier: 'clergy hierarchy', moral: 'moralising god(s)', ascet: 'asceticism', pacif: 'pacifism', ritual: 'ritualism', afterlife: 'afterlife focus' }[k] || k, v, (v * 100).toFixed(0), false, 'c')).join('')}`;
}
function inspWar(id) {
  const W = sim.wars.get(id); if (!W) return '';
  return `<h2>${esc(W.name)}</h2><div class="muted">${W.goal} · ${sim.fmtYear(W.started)}${W.ended ? ' – ' + sim.fmtYear(W.ended) : ' – ongoing'}</div>
  <div class="kv" style="margin-top:6px"><div>Attackers</div><div>${W.att.map(ol).join(', ')}</div><div>Defenders</div><div>${W.def.map(ol).join(', ')}</div><div>War score</div><div>${W.score.toFixed(0)} (attacker +)</div><div>Casualties</div><div>${fmtN(W.cas[0])} / ${fmtN(W.cas[1])}</div><div>Battles</div><div>${W.battles}</div>${W.claimant ? `<div>Claimant</div><div>${pl(W.claimant)}</div>` : ''}</div>
  ${W.result ? `<div class="note">${esc(W.result)}</div>` : ''}<h3>Battles</h3>${W.log.slice().reverse().map(b => `<div class="ev"><span class="y">${sim.fmtYear(b.y)}</span>${esc(b.t)}</div>`).join('') || '<div class="muted">Skirmishes only.</div>'}`;
}
function inspDis(id) {
  const D = sim.diseases.get(id); if (!D) return '';
  let act = 0; for (const p of sim.pops.values()) if (p.dz[id] && p.dz[id].act) act++;
  return `<h2>☣ ${esc(D.name)}</h2><div class="kv"><div>Emerged</div><div>${sim.fmtYear(D.born)} near ${cellL(D.origin)}</div><div>R0</div><div>${D.R0.toFixed(1)}</div><div>Lethality</div><div>${(D.cfr * 100).toFixed(1)}% (falls as it adapts to hosts)</div><div>Immunity</div><div>${D.immYears > 60 ? 'lifelong' : '~' + Math.round(D.immYears) + ' years'}</div><div>Cases / deaths</div><div>${fmtN(D.cases)} / ${fmtN(D.deaths)}</div><div>Active in</div><div>${act} populations</div><div>Status</div><div>${D.extinct ? 'extinct ' + sim.fmtYear(D.extinct) : 'circulating'}</div></div>`;
}

// ---------------------------------------------------------------- charts
function drawChart(cv) {
  const dpr = window.devicePixelRatio || 1; cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const W = cv.clientWidth, H = cv.clientHeight; const s = cv.dataset.series;
  let pts;
  if (s === 'pop') pts = sim.stats.map(x => [x.y, Math.log10(Math.max(1, x.pop))]);
  else pts = sim.climate.history.map(x => [x.year, s === 'dT' ? x.dT : s === 'sl' ? x.sl : x.mon]);
  g.fillStyle = '#98a1b0'; g.font = '11px system-ui'; g.fillText(cv.dataset.title, 6, 13);
  if (pts.length < 2) return;
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0]; let y0 = Infinity, y1 = -Infinity; for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } if (y1 - y0 < 1e-6) { y1 += 1; y0 -= 1; }
  const X = x => 30 + (x - x0) / (x1 - x0 || 1) * (W - 36), Y = y => H - 14 - (y - y0) / (y1 - y0) * (H - 32);
  g.strokeStyle = '#313845'; g.beginPath(); g.moveTo(30, Y(y0)); g.lineTo(W - 6, Y(y0)); g.stroke();
  g.fillStyle = '#98a1b0'; g.fillText(s === 'pop' ? fmtN(10 ** y1) : y1.toFixed(1), 2, Y(y1) + 4); g.fillText(s === 'pop' ? fmtN(10 ** y0) : y0.toFixed(1), 2, Y(y0)); g.fillText(sim.fmtYear(x0), 30, H - 2); g.textAlign = 'right'; g.fillText(sim.fmtYear(x1), W - 6, H - 2); g.textAlign = 'left';
  g.strokeStyle = s === 'dT' ? '#e06f6f' : s === 'sl' ? '#6fb3e0' : '#e0b553'; g.lineWidth = 1.5; g.beginPath();
  const step = Math.max(1, Math.floor(pts.length / 600)); pts.forEach((p, i) => { if (i % step) return; i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])); }); g.stroke();
}

// ---------------------------------------------------------------- events
function show(k, id) { sel = { k, id: k === 'cell' ? +id : +id }; view.tab = 'inspect'; draw(); render(); }
document.addEventListener('click', e => {
  const a = e.target.closest('[data-k]'); if (a) { e.preventDefault(); show(a.dataset.k, a.dataset.id); return; }
  const t = e.target.closest('[data-tab]'); if (t) { view.tab = t.dataset.tab; render(); return; }
  const b = e.target;
  if (b.dataset.evimp !== undefined) { evFilter.imp = !evFilter.imp; render(); }
  if (b.dataset.evcat) { const c = b.dataset.evcat; evFilter.cats.has(c) ? evFilter.cats.delete(c) : evFilter.cats.add(c); render(); }
  if (b.dataset.psort) { view.psort = b.dataset.psort; render(); }
  if (b.dataset.okind) { view.okind = b.dataset.okind; render(); }
  if (b.dataset.sub) { view.sub = b.dataset.sub; render(); }
  if (b.dataset.mode) { mode = b.dataset.mode; document.querySelectorAll('#modes button').forEach(x => x.classList.toggle('on', x.dataset.mode === mode)); draw(); }
  if (b.dataset.god) { godTool = godTool === b.dataset.god ? null : b.dataset.god; render(); }
  if (b.dataset.gg) { const g = b.dataset.gg; if (g === 'warm') sim.god('warm', { dT: 1 }); if (g === 'cool') sim.god('warm', { dT: -1 }); if (g === 'iceup') sim.god('ice', { dV: 0.15 }); if (g === 'icedown') sim.god('ice', { dV: -0.15 }); render(); }
  if (b.dataset.godp === 'kill') { sim.god('kill', { person: +b.dataset.id }); render(); }
  if (b.dataset.godo) { const o = sim.orgs.get(+b.dataset.id); if (b.dataset.godo === 'enrich') { o.wealth += 500; sim.logEvent('god', `⚡ Gold rains upon the ${o.name}`, { org: o.id, important: true }); } else godRevolt(o); render(); }
});
function godRevolt(o) {
  const govs = o.offices.filter(f => f.k === 'governor' && f.h); const off = govs[0] || o.offices.find(f => f.h); if (!off) return;
  const p = sim.persons.get(off.h); p.ambition = 1; p.mem.set(o.leader, { v: -150, y: sim.year, why: ['divine discontent'] }); sim.logEvent('god', `⚡ ${fullName(sim, p)} is filled with rebellious fury`, { person: p.id, org: o.id, important: true });
}
$('#map').addEventListener('click', e => {
  if (!sim) return; const c = cellAt(e); if (c < 0) return;
  if (godTool) {
    if (godTool === 'drought') sim.god('drought', { cell: c }); if (godTool === 'plague') sim.god('plague', { cell: c }); if (godTool === 'prophet') sim.god('prophet', { cell: c }); if (godTool === 'volcano') sim.god('volcano', { cell: c });
    if (godTool === 'migrants' && sel && sel.k === 'cell') sim.god('migrants', { from: sel.id, cell: c }); if (godTool === 'techgift') sim.god('tech', { cell: c, tech: $('#godtech')?.value || 'bow' });
    godTool = null; draw(); render(); return;
  }
  show('cell', c);
});
$('#map').addEventListener('mousemove', e => {
  if (!sim) return; const c = cellAt(e); const h = $('#hover'); if (c < 0 || !sim.world.land[c]) { h.style.display = 'none'; return; }
  const o = sim.owner[c] >= 0 ? sim.orgs.get(sim.owner[c]) : null; const C = sim.cultures.get(sim.cellCul[c]); const R = sim.religions.get(sim.cellRel[c]);
  h.innerHTML = `<b>${sim.world.cellName(c)}</b><br>${o ? esc(o.name) + '<br>' : ''}${fmtN(sim.cellN[c])} people${C ? ' · ' + esc(C.name) : ''}${R ? '<br>' + esc(R.name) : ''}<br><span class="muted">${sim.climate.T[c].toFixed(1)}°C · ${Math.round(sim.climate.P[c])} mm</span>`;
  const r = $('#mapwrap').getBoundingClientRect(); h.style.display = 'block'; h.style.left = Math.min(e.clientX - r.left + 14, r.width - 290) + 'px'; h.style.top = (e.clientY - r.top + 14) + 'px';
});
$('#map').addEventListener('mouseleave', () => $('#hover').style.display = 'none');
$('#play').onclick = () => { running = !running; $('#play').textContent = running ? '⏸ Pause' : '▶ Play'; };
$('#step').onclick = () => { sim.step(); draw(); render(); };
$('#step100').onclick = () => { const t0 = performance.now(); for (let i = 0; i < 100; i++) sim.step(); draw(); render(); };
$('#speed').onchange = e => { speed = +e.target.value; };
$('#new').onclick = () => { $('#dlg').style.display = 'flex'; };
$('#go').onclick = () => { $('#dlg').style.display = 'none'; $('#loading').style.display = 'block'; setTimeout(() => { newWorld($('#wkind').value, +$('#wseed').value || 1); $('#loading').style.display = 'none'; }, 30); };
window.addEventListener('resize', () => draw());
document.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; if (e.code === 'Space') { e.preventDefault(); $('#play').click(); } });
$('#modes').innerHTML = [['political', 'Polities'], ['terrain', 'Terrain'], ['population', 'Population'], ['culture', 'Cultures'], ['language', 'Languages'], ['religion', 'Religions'], ['subsistence', 'Subsistence'], ['tech', 'Tech'], ['temp', 'Temp anomaly'], ['precip', 'Rain anomaly'], ['npp', 'Productivity'], ['unrest', 'Unrest'], ['disease', 'Epidemics']].map(([k, n]) => `<button data-mode="${k}" class="${k === mode ? 'on' : ''}">${n}</button>`).join('');
requestAnimationFrame(loop);

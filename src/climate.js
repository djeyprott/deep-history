// Climate dynamics. Nothing is scripted: cycles come from forcing + feedback processes.
//  - Orbital forcing (precession 23 kyr, obliquity 41 kyr) -> NH summer insolation anomaly
//  - Ice-sheet volume with slow growth / faster melt and albedo hysteresis -> glacial cycles, sea level
//  - Meltwater flux can collapse the overturning circulation (bistable) -> abrupt NH cold snaps (Younger-Dryas-like)
//  - Monsoon strength follows insolation; vegetation-albedo feedback makes green/dry deserts switch abruptly
//  - Millennial (~1500 yr), solar (88/208/2300 yr), ENSO-like (2-7 yr), decadal regional modes (AR1),
//    stochastic volcanic eruptions with VEI-dependent cooling
//  - NPP from the Miami model (Lieth 1975), reduced by low glacial CO2
import { RNG, makeNoise, clamp } from './rng.js';

export class Climate {
  constructor(world, seed, startYear) {
    this.w = world; this.rng = new RNG(seed * 3 + 11);
    const N = world.N;
    this.T = new Float32Array(N); this.P = new Float32Array(N); this.NPP = new Float32Array(N);
    this.ice = new Uint8Array(N); this.veg = new Float32Array(N);
    this.Tanom = new Float32Array(N); this.Panom = new Float32Array(N);
    this.year = startYear;
    // phases: Earth uses real orbital timing (insolation max ~9000 BCE); procedural worlds randomise
    const earth = world.kind === 'earth';
    this.precPhase = earth ? 9000 : this.rng.range(0, 23000);
    this.oblPhase = earth ? 8000 : this.rng.range(0, 41000);
    this.V = earth ? 0.82 : this.rng.range(0.1, 0.8); // ice volume, 1 = full glacial maximum
    this.amoc = 1; this.amocOffSince = null;
    this.millPhase = this.rng.range(0, Math.PI * 2); this.millAmp = 1;
    this.solarPh = [0, 1, 2].map(() => this.rng.range(0, Math.PI * 2));
    this.enso = [0, 0]; this.red = 0; this.volc = 0;
    this.nModes = 7; this.modeCoef = new Float32Array(this.nModes);
    // spatial precipitation modes (smooth random teleconnection patterns)
    this.modes = [];
    for (let k = 0; k < this.nModes; k++) {
      const nz = makeNoise(seed * 101 + k * 17), f = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const φ = world.lat[i] * Math.PI / 180, λ = world.lon[i] * Math.PI / 180;
        f[i] = nz.fbm(Math.cos(φ) * Math.cos(λ) * 2.2, Math.cos(φ) * Math.sin(λ) * 2.2, Math.sin(φ) * 2.2, 3) * 2.2;
      }
      this.modes.push(f);
    }
    const ez = makeNoise(seed * 7 + 3); this.ensoSign = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (earth) { const lo = world.lon[i]; this.ensoSign[i] = (lo > 60 && lo < 160) || (lo > -30 && lo < 50) ? -1 : (lo < -60 && lo > -90 ? 1 : -0.3); }
      else { const φ = world.lat[i] * Math.PI / 180, λ = world.lon[i] * Math.PI / 180; this.ensoSign[i] = ez.n3(Math.cos(φ) * Math.cos(λ) * 1.5, Math.cos(φ) * Math.sin(λ) * 1.5, 0.3) > 0 ? 1 : -1; }
    }
    this.history = []; this.events = [];
    this.forcing = { tempOffset: 0, precipMult: 1, droughtCells: null, droughtYears: 0, droughtMult: 1 }; // god tools
    this.seaLevel = -125 * this.V;
  }
  insolation(t) {
    return 0.055 * Math.cos(2 * Math.PI * (t + this.precPhase) / 23000) + 0.03 * Math.cos(2 * Math.PI * (t + this.oblPhase) / 41000);
  }
  step(year) {
    this.year = year; const r = this.rng, w = this.w;
    const ins = this.insolation(year); this.ins = ins;
    // --- ice sheets: albedo feedback makes the glaciation threshold depend on current ice volume (hysteresis)
    const θ = 0.072 - 0.08 * this.V;
    const Veq = 1 / (1 + Math.exp(-((-ins - θ) / 0.01)));
    const tau = Veq > this.V ? 15000 : 4200;
    const dV = (Veq - this.V) / tau; this.V = clamp(this.V + dV, 0, 1.05);
    const melt = Math.max(0, -dV);
    // --- overturning circulation: bistable; collapses under large meltwater flux, recovers after flux drops
    if (this.amoc > 0.5 && melt > 1.5e-4 * clamp(1 + 0.25 * r.normal(), 0.6, 1.6)) { this.amoc = 0.15; this.amocOffSince = year; this.events.push({ year, type: 'amoc_off', text: 'Meltwater floods the northern seas; the ocean overturning circulation collapses' }); }
    else if (this.amoc < 0.5 && melt < 0.9e-4 && year - this.amocOffSince > 600 && r.chance(1 / 500)) { this.amoc = 1; this.events.push({ year, type: 'amoc_on', text: 'The ocean overturning circulation restarts; northern lands warm abruptly' }); }
    // --- variability
    this.millPhase += 2 * Math.PI / 1470 + r.normal(0, 0.004);
    this.millAmp = clamp(this.millAmp + r.normal(0, 0.01), 0.3, 1.5);
    const mill = 0.3 * this.millAmp * Math.sin(this.millPhase) * (1 + 2.5 * this.V);
    const sol = 0.1 * Math.sin(2 * Math.PI * year / 208 + this.solarPh[0]) + 0.07 * Math.sin(2 * Math.PI * year / 88 + this.solarPh[1]) + 0.12 * Math.sin(2 * Math.PI * year / 2300 + this.solarPh[2]);
    this.red = 0.7 * this.red + r.normal(0, 0.08);
    const om = 2 * Math.PI / 4.5, rr = 0.75; const e = 2 * rr * Math.cos(om) * this.enso[0] - rr * rr * this.enso[1] + r.normal(0, 0.6);
    this.enso = [e, this.enso[0]];
    for (let k = 0; k < this.nModes; k++) this.modeCoef[k] = 0.88 * this.modeCoef[k] + r.normal(0, 0.085);
    // --- volcanoes: VEI frequency-magnitude (VEI5 ~1/10yr, VEI6 ~1/80yr, VEI7 ~1/800yr)
    this.volc *= 0.45;
    const u = r.next(); let vei = 0;
    if (u < 1 / 800) vei = 7; else if (u < 1 / 80) vei = 6; else if (u < 1 / 10) vei = 5;
    if (vei >= 6) {
      const cool = vei === 7 ? r.range(0.9, 1.6) : r.range(0.25, 0.7); this.volc -= cool;
      let c = -1; for (let t = 0; t < 50 && c < 0; t++) { const j = r.int(0, w.N - 1); if (w.land[j] && w.rough[j] > 300) c = j; }
      this.events.push({ year, type: 'volcano', cell: c, vei, text: `A colossal eruption (VEI ${vei})${c >= 0 ? ' near ' + w.cellName(c) : ''} veils the sun; ~${cool.toFixed(1)}°C global cooling` });
    }
    const dTg = -5.8 * this.V + mill * 0.4 + sol + this.red + this.volc + 0.15 * this.enso[0] * 0.3 + this.forcing.tempOffset;
    this.dTg = dTg;
    // monsoon strength: insolation, ice, overturning
    const mon = clamp(0.8 + 5 * ins - 0.5 * this.V - 0.25 * (1 - this.amoc) + 0.08 * this.enso[0] * -0.5, 0.05, 1.6);
    this.monsoon = mon;
    const monL = 700 * Math.pow(0.3 + mon, 1.5);
    // sea level
    this.seaLevel = -125 * Math.max(0, this.V - 0.02);
    // --- per-cell
    const N = w.N; let gT = 0, gA = 0;
    const iceThr = 12 * Math.pow(Math.max(0, this.V), 0.7) - 1;
    for (let i = 0; i < N; i++) {
      if (!w.land[i]) { this.ice[i] = 0; this.NPP[i] = 0; this.T[i] = w.Tbase[i] + dTg; this.P[i] = 0; continue; }
      const a = Math.abs(w.lat[i]) / 90;
      let dT = dTg * (1 + 1.5 * a * a) + mill * 0.6 * w.amocW[i] - 7 * (1 - this.amoc) * w.amocW[i];
      const T = w.Tbase[i] + dT;
      let modeSum = 0; for (let k = 0; k < this.nModes; k++) modeSum += this.modes[k][i] * this.modeCoef[k];
      const pm0 = w.Pmonsoon[i] * mon * Math.exp(-w.dEq[i] / monL);
      const pm = pm0 * (1 + 1.3 * this.veg[i] * Math.exp(-pm0 / 300)); // vegetation-albedo feedback matters only at the desert margin
      let P = (w.Pbase[i] * (1 + 0.02 * dTg) * (1 - 0.3 * this.V) + pm) * Math.exp(clamp(modeSum, -1.2, 1.2) * 0.55) * (1 + 0.25 * this.enso[0] * this.ensoSign[i] * w.ensoW[i]);
      P *= this.forcing.precipMult;
      if (this.forcing.droughtYears > 0 && this.forcing.droughtCells && this.forcing.droughtCells.has(i)) P *= this.forcing.droughtMult;
      P = Math.max(5, P);
      this.T[i] = T; this.P[i] = P; this.Tanom[i] = dT; this.Panom[i] = P / Math.max(5, w.Pbase[i] + w.Pmonsoon[i] * 0.55 * Math.exp(-w.dEq[i] / 530)) - 1;
      const summer = T + w.amp[i];
      const iced = (summer < iceThr && P > 300) || summer < -1 ? 1 : 0; this.ice[i] = iced; // ice sheets, or polar desert too cold to live in
      let npp = 0;
      if (!iced) {
        // Miami model, g dry matter / m2 / yr; CO2 fertilisation loss at glacial CO2 (~190 ppm)
        const nT = 3000 / (1 + Math.exp(1.315 - 0.119 * T)), nP = 3000 * (1 - Math.exp(-0.000664 * P));
        npp = Math.min(nT, nP) * (1 - 0.22 * this.V);
        // short growing season penalty (frozen most of the year)
        if (summer < 10) npp *= clamp(summer / 10, 0, 1);
      }
      this.NPP[i] = npp;
      this.veg[i] += (clamp(npp / 900, 0, 1) - this.veg[i]) * 0.08;
      gT += dT * w.area[i]; gA += w.area[i];
    }
    if (this.forcing.droughtYears > 0) this.forcing.droughtYears--;
    if (year % 10 === 0) this.history.push({ year, dT: +dTg.toFixed(2), V: +this.V.toFixed(3), sl: +this.seaLevel.toFixed(1), amoc: this.amoc, mon: +mon.toFixed(2), volc: +this.volc.toFixed(2) });
    return this.seaLevel;
  }
  growingSeason(i) { // months above 5C, from annual mean and seasonal half-amplitude
    const T = this.T[i], A = this.w.amp[i];
    if (A < 0.5) return T > 5 ? 12 : 0;
    const x = clamp((5 - T) / A, -1, 1); return 12 * Math.acos(x) / Math.PI;
  }
}

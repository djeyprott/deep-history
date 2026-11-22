import { Sim } from '../src/sim.js';
import fs from 'fs';
const kind=process.argv[2]||'earth', years=+(process.argv[3]||500), seed=+(process.argv[4]||1), every=+(process.argv[5]||100);
const earthData=kind==='earth'?JSON.parse(fs.readFileSync('data/earth.json')):null;
let t0=Date.now();
const sim=new Sim({kind,seed,earthData,startYear:-15000});
console.log('init ms',Date.now()-t0,'pops',sim.pops.size);
let li=0;
for(let k=0;k<years;k++){ sim.step();
  if(sim.year%every===0){ const s=sim.stats[sim.stats.length-1];
    console.log(`${sim.fmtYear(sim.year)} pop=${(s.pop/1e6).toFixed(2)}M farm=${(s.farm*100).toFixed(1)}% herd=${(s.herd*100).toFixed(1)}% urb=${(s.urban*100).toFixed(2)}% tech=${s.tech.toFixed(1)} cells=${s.cells} cul=${s.cultures} lang=${s.languages} rel=${s.religions} pol=${s.polities} orgs=${s.orgs} persons=${s.persons} pops=${sim.pops.size} dT=${s.dT.toFixed(1)} ms/yr=${((Date.now()-t0)/(k+1)).toFixed(0)}`);
    for(;li<sim.log.length;li++){const e=sim.log[li]; if(e.important) console.log('   ',sim.fmtYear(e.y),'['+e.cat+']',e.text);} li=sim.log.length;
  }
}
const cats={};for(const e of sim.log)cats[e.cat]=(cats[e.cat]||0)+1;console.log(cats);

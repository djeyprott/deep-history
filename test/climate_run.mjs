import { World } from '../src/world.js';
import { Climate } from '../src/climate.js';
import fs from 'fs';
const d=JSON.parse(fs.readFileSync('data/earth.json'));
const w=new World({W:d.W,H:d.H,seed:1,kind:'earth'}); w.loadEarth(d);
const c=new Climate(w,1,-15000); w.applySeaLevel(c.seaLevel); w.computeStatic(); w.placeWildSpecies();
const at=(la,lo)=>Math.floor((90-la)/1.5)*w.W+Math.floor((lo+180)/1.5);
const S=at(23,10), K=at(22.6,88.4), L=at(51.5,-0.1), B=at(65,-170), Ch=at(42,-88), M=at(33.3,44.4);
let t0=Date.now();
for(let y=-15000;y<=2000;y++){ const sl=c.step(y); if(Math.abs(sl-w.seaLevel)>4){ w.applySeaLevel(sl); w.computeStatic(); }
 if(y%1000===0){ let ice=0,land=0;for(let i=0;i<w.N;i++){if(w.land[i]){land++;ice+=c.ice[i];}}
  console.log(y,'V',c.V.toFixed(2),'sl',c.seaLevel.toFixed(0),'dT',c.dTg.toFixed(1),'amoc',c.amoc,'mon',c.monsoon.toFixed(2),'ice%',(ice/land*100).toFixed(1),'Sahara P',c.P[S].toFixed(0),'npp',c.NPP[S].toFixed(0),'Kolk',c.P[K].toFixed(0),'Lon T',c.T[L].toFixed(1),'ice',c.ice[L],'Bering land',w.land[B],'Chic ice',c.ice[Ch],'Mesop P',c.P[M].toFixed(0)); }}
console.log('ms',Date.now()-t0); console.log(c.events.filter(e=>e.type!=='volcano').map(e=>e.year+' '+e.text).join('\n'));
console.log('volcanoes',c.events.filter(e=>e.type==='volcano').length);

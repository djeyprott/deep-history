import { World } from '../src/world.js';
import fs from 'fs';
const d=JSON.parse(fs.readFileSync('data/earth.json'));
const w=new World({W:d.W,H:d.H,seed:1,kind:'earth'}); w.loadEarth(d); w.applySeaLevel(0); w.computeStatic();
const places={London:[51.5,-0.1],Cairo:[30,31.2],Baghdad:[33.3,44.4],Beijing:[39.9,116.4],Manaus:[-3.1,-60],Sahara:[23,10],Moscow:[55.7,37.6],Chicago:[41.9,-87.6],Delhi:[28.6,77.2],Sydney:[-33.9,151],Congo:[0,22],Riyadh:[24.7,46.7],Paris:[48.9,2.3],Kolkata:[22.6,88.4],Yakutsk:[62,129.7],Lagos:[6.5,3.4],Mexico:[19.4,-99.1],Seattle:[47.6,-122.3],LasVegas:[36.2,-115.1],Alice:[-23.7,133.9],Tibet:[32,88],Jakarta:[-6.2,106.8],Khartoum:[15.5,32.5],Rome:[41.9,12.5],Ulaanbaatar:[47.9,106.9]};
for(const [n,[la,lo]] of Object.entries(places)){const y=Math.floor((90-la)/1.5),x=Math.floor((lo+180)/1.5);const i=y*w.W+x;
console.log(n.padEnd(12),'land',w.land[i],'T',w.Tbase[i].toFixed(1),'amp',w.amp[i].toFixed(1),'P',w.Pbase[i].toFixed(0),'mon',w.Pmonsoon[i].toFixed(0),'Q',w.discharge[i].toFixed(0),'elev',w.elev[i]);}
let mx=[...w.discharge].map((q,i)=>[q,i]).sort((a,b)=>b[0]-a[0]).slice(0,12);for(const [q,i] of mx)console.log('river',w.cellName(i),q.toFixed(0));

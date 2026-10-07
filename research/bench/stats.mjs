import { mulberry32 } from '../agent/conditions.mjs';
const choose=(n,k)=>{let r=1;for(let i=1;i<=k;i++)r=r*(n-k+i)/i;return r};
export function signTestOneSided(n,w){if(!n)return null;let p=0;for(let k=w;k<=n;k++)p+=choose(n,k)*0.5**n;return p}
export function bootstrapCI(d,{B=10000,seed=20261006}={}){if(!d.length)return[0,0];const r=mulberry32(seed),s=[];for(let b=0;b<B;b++){let sum=0;for(let i=0;i<d.length;i++)sum+=d[Math.floor(r()*d.length)];s.push(sum/d.length)}s.sort((a,b)=>a-b);return[s[Math.floor(.025*B)],s[Math.ceil(.975*B)-1]]}
export function cohenKappa(table){const n=table.flat().reduce((a,b)=>a+b,0);if(!n)return null;const po=(table[0][0]+table[1][1])/n,row=[table[0][0]+table[0][1],table[1][0]+table[1][1]],col=[table[0][0]+table[1][0],table[0][1]+table[1][1]],pe=(row[0]*col[0]+row[1]*col[1])/(n*n);return pe===1?1:(po-pe)/(1-pe)}
export function wtl(d,tau){let wins=0,ties=0,losses=0,excluded=0;for(const x of d){if(x==null||!Number.isFinite(x)){excluded++;continue}if(Math.abs(x)<=tau)ties++;else if(x>tau)wins++;else losses++;}return{wins,ties,losses,excluded}}

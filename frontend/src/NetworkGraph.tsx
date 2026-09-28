import { ExternalLink, Network } from 'lucide-react';
import type { NetworkGraphData } from './accountApi';

const edgeColors: Record<string,string> = {
  connected_1st: '#1f65e8',
  mutual_connection: '#8c5be8',
  public_interaction: '#df9d22',
  imported_contact: '#8e99a8',
};

export function NetworkGraphView({graph}:{graph:NetworkGraphData}) {
  const shown = graph.nodes.slice(0, 32);
  const ids = new Set(shown.map(node=>node.id));
  const owner = shown.find(node=>node.id===graph.ownerId);
  const others = shown.filter(node=>node.id!==graph.ownerId);
  const targets = others.filter(node=>node.kind==='target');
  const mutuals = others.filter(node=>node.kind==='mutual');
  const remaining = others.filter(node=>!['target','mutual'].includes(node.kind));
  const height = Math.max(330, Math.ceil(Math.max(remaining.length, targets.length, mutuals.length)/2)*76+100);
  const points = new Map<string,{x:number;y:number}>();
  if(owner) points.set(owner.id,{x:82,y:height/2});
  const distribute=(nodes:typeof others,x:number,spread=1)=>nodes.forEach((node,index)=>{
    const columns=spread>1?2:1, column=index%columns, row=Math.floor(index/columns), rows=Math.ceil(nodes.length/columns);
    points.set(node.id,{x:x+column*125,y:(row+1)*height/(rows+1)});
  });
  distribute(mutuals,310,1); distribute(targets,650,1); distribute(remaining,220,2);
  const edges=graph.edges.filter(edge=>ids.has(edge.from)&&ids.has(edge.to)&&points.has(edge.from)&&points.has(edge.to));
  return <section className="ng-card" aria-label="Grafo de red profesional">
    <header><div><Network size={18}/><span><b>Network graph</b><small>{graph.summary.people} personas · {graph.summary.verified} relaciones verificadas · {graph.summary.mutualPaths} caminos mutuos</small></span></div><span className="ng-updated">Evidencia, no suposiciones</span></header>
    <div className="ng-canvas"><svg viewBox={`0 0 760 ${height}`} role="img" aria-label="Relaciones profesionales encontradas">
      <defs><filter id="node-shadow"><feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity=".12"/></filter></defs>
      {edges.map(edge=>{const a=points.get(edge.from)!,b=points.get(edge.to)!;return <g key={edge.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={edgeColors[edge.kind]||'#a3acb8'} strokeWidth={1.5+edge.strength*3} strokeDasharray={edge.verified?'':'6 5'} opacity=".72"/><title>{edge.source} · {Math.round(edge.strength*100)}%</title></g>;})}
      {shown.map(node=>{const p=points.get(node.id);if(!p)return null;const fill=node.kind==='owner'?'#1f65e8':node.kind==='target'?'#8c5be8':node.kind==='mutual'?'#3c9d78':node.kind==='public'?'#efad35':'#eef3ff';const ink=['owner','target','mutual'].includes(node.kind)?'#fff':'#24437a';const content=<g><circle cx={p.x} cy={p.y} r={node.kind==='owner'?29:23} fill={fill} filter="url(#node-shadow)"/><text x={p.x} y={p.y+4} textAnchor="middle" fill={ink} fontSize="11" fontWeight="700">{node.label.split(/\s+/).slice(0,2).map(v=>v[0]).join('').slice(0,2).toUpperCase()}</text><text x={p.x} y={p.y+40} textAnchor="middle" fill="#263246" fontSize="10" fontWeight="600">{node.label.length>20?`${node.label.slice(0,18)}…`:node.label}</text><text x={p.x} y={p.y+53} textAnchor="middle" fill="#818b99" fontSize="8">{node.subtitle.length>26?`${node.subtitle.slice(0,24)}…`:node.subtitle}</text></g>;return node.url?<a key={node.id} href={node.url} target="_blank" rel="noreferrer">{content}</a>:<g key={node.id}>{content}</g>;})}
    </svg></div>
    <footer><span><i style={{background:edgeColors.connected_1st}}/>Conexión confirmada</span><span><i style={{background:edgeColors.mutual_connection}}/>Contacto mutuo</span><span><i style={{background:edgeColors.public_interaction}}/>Interacción pública</span>{graph.nodes.length>shown.length&&<em>Mostrando 32 de {graph.nodes.length} nodos</em>}<ExternalLink size={12}/></footer>
  </section>;
}

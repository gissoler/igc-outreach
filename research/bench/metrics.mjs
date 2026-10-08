/**
 * Calcula métricas y comparaciones por identidad estable.
 * No ejecuta corridas ni modifica etiquetas.
 * Contratos: run_result/1, pool y label/1.
 */
import { identifierKeys } from '../agent/identifiers.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { wtl, signTestOneSided, bootstrapCI, cohenKappa } from './stats.mjs';
import { decide } from './decide.mjs';
import { validate } from '../agent/contracts.mjs';
/**
 * Conserva el contrato público de gain para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function gain(l) {
  if(['closed','not_a_call','awarded'].includes(l.status)||l.scope==='off'||l.hard_eligibility==='ineligible'
    ||l.route==='not_actionable')return 0;
  if(l.route==='direct_apply'&&l.hard_eligibility==='eligible'&&l.scope==='on'&&['open','rolling'].includes(l.status))return 3;
  if(['direct_apply','partner_subaward'].includes(l.route)&&['open','rolling','upcoming'].includes(l.status))return 2;
  return 1
}
const match=(a,b)=> {
  const ak=identifierKeys(a),bk=identifierKeys(b);
  return[...ak].some(x=>bk.has(x))||a.stable_id===b.stable_id
};
/**
 * Conserva el contrato público de matchToPool para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function matchToPool(entity,pool) {
  if(!entity)return null;
  const keys=identifierKeys(entity);
  return pool.find(item=>[...keys].some(key=>identifierKeys(item).has(key)))?.item_key||null
}
const itemKeyForLabel=(label,pool)=>label.item_key||pool.find(item=>item.stable_id===label.stable_id)?.item_key||label.stable_id;
const topItemKeys=(ranked,entities,pool,k)=> {
  const seen=new Set(),out=[];
  for(const row of ranked.slice(0,k)) {
    const entity=entities.find(item=>item.stable_id===(row.stable_id||row))||row;
    const key=pool.length?matchToPool(entity,pool):(row.stable_id||row);
    if(key&&!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out
};
/**
 * Conserva el contrato público de hitAt20 para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function hitAt20(ranked,anchor,entities=[],pool=[]) {
  if(pool.length) {
    const key=pool.find(item=>item.from?.anchor)?.item_key;
    if(!key)return null;
    return topItemKeys(ranked,entities,pool,20).includes(key)?1:0;
  }
  if(!anchor)return null;
  return ranked.slice(0,20).some(x=> {
    const e=entities.find(y=>y.stable_id===(x.stable_id||x))||x;return match(e,anchor)
  })?1:0
}
/**
 * Conserva el contrato público de pooledRecallAt20 para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function pooledRecallAt20(ranked,positives,entities=[],pool=[]) {
  if(!positives.length)return null;
  const found=new Set(topItemKeys(ranked,entities,pool,20)),keys=positives.map(label=>itemKeyForLabel(label,
  pool));
  return keys.filter(key=>found.has(key)).length/keys.length
}
/**
 * Conserva el contrato público de ndcgAt10 para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function ndcgAt10(ranked,labels,entities=[],pool=[]) {
  const gm=new Map(labels.map(label=>[itemKeyForLabel(label,pool),gain(label)])),keys=topItemKeys(ranked,
  entities,pool,10),dcg=keys.reduce((sum,key,index)=>sum+(2**(gm.get(key)||0)-1)/Math.log2(index+2),0),
  ideal=[...gm.values()].sort((a,b)=>b-a).slice(0,10).reduce((sum,value,index)=>sum+(2**value-1)/Math.log2(index+2),
  0);
  return ideal?dcg/ideal:null
}
/**
 * Conserva el contrato público de accuracyMetrics para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function accuracyMetrics(result,labels,pool=[]) {
  const lm=new Map(labels.map(label=>[itemKeyForLabel(label,pool),label])),seen=new Set(),top=[];
  for(const row of result.ranked.slice(0,20)) {
    const entity=result.entities.find(item=>item.stable_id===row.stable_id),key=pool.length?matchToPool(entity,
    pool):row.stable_id;
    if(!key||seen.has(key)||!lm.has(key))continue;
    seen.add(key);
    top.push( {
      row,entity,label:lm.get(key)
    });
  }
  if(!top.length)return {
    identity_accuracy:null,status_accuracy:null,deadline_accuracy:null
  };
  const identity=top.filter(x=>x.label.identity_correct===true).length/top.length,correct=top.filter(x=>x.label.identity_correct===true),
  status=correct.length?correct.filter(x=>x.entity.validity.status!=='unknown'
    &&x.entity.validity.status===x.label.status).length/correct.length:null,
  dead=correct.filter(x=>x.label.deadline!=null),deadline=dead.length?dead.filter(x=>
    x.entity.validity.closes_on===x.label.deadline).length/dead.length:null;
  return {
    identity_accuracy:identity,status_accuracy:status,deadline_accuracy:deadline
  }
}
/**
 * Conserva el contrato público de hardFalsePositiveRate para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function hardFalsePositiveRate(result,labels,pool=[]) {
  const lm=new Map(labels.map(label=>[itemKeyForLabel(label,pool),label])),rows=[];
  for(const row of result.ranked.filter(item=>item.recommendable)) {
    const entity=result.entities.find(item=>item.stable_id===row.stable_id),key=pool.length?matchToPool(entity,
    pool):row.stable_id;
    if(key&&lm.has(key)&&!rows.some(item=>item.key===key))rows.push( {
      key,label:lm.get(key)
    });
  }
  if(!rows.length)return null;
  return rows.filter(( {
    label
  })=>label.hard_eligibility==='ineligible'||label.scope==='off'||['closed','awarded',
    'not_a_call'].includes(label.status)).length/rows.length
}
/**
 * Conserva el contrato público de curveForRun para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function curveForRun(result,positives,pool=[]) {
  const grid=[];
  for(let t=0;t<=600000;t+=50000) {
    const point=[...result.prefix_curve].filter(x=>x.tokens_nominal<=t).at(-1),ids=new Set(point?.stable_ids_so_far||[]),
    ranked=(result.ranked?result.ranked.filter(x=>ids.has(x.stable_id)):[...ids].map(stable_id=>( {
      stable_id
    }))).slice(0,20);
    grid.push( {
      tokens:t,pooled_recall_at_20:pooledRecallAt20(ranked,positives,result.entities||[],pool)
    });
  }
  return grid
}
const STATES=['met','not_met','unknown','not_applicable','conflict'];
function binaryStats(matrix,index) {
  let tp=0,fp=0,fn=0;
  for(let h=0;h<5;h++)for(let j=0;j<5;j++) {
    const n=matrix[h][j];
    if(h===index&&j===index)tp+=n;
    else if(h!==index&&j===index)fp+=n;
    else if(h===index&&j!==index)fn+=n;
  }
  const precision=tp+fp?tp/(tp+fp):null,pooled_recall=tp+fn?tp/(tp+fn):null;
  return {
    precision,pooled_recall,f1:precision!=null&&pooled_recall!=null
      &&precision+pooled_recall?2*precision*pooled_recall/(precision+pooled_recall):0
  }
}
function criteriaMetrics(runs,labels,pools) {
  const output= {
  };
  for(const condition of['B0','B1','B2']) {
    const matrix=STATES.map(()=>STATES.map(()=>0));
    let total=0,unknown=0;
    for(const run of runs.filter(x=>x.condition===condition)) {
      const pool=pools.get(run.case_id)||[],byKey=new Map(labels.filter(x=>x.case_id===run.case_id).map(label=>[itemKeyForLabel(label,
      pool),label]));
      for(const judgment of run.judgments) {
        const entity=run.entities.find(item=>item.stable_id===judgment.stable_id),key=pool.length?matchToPool(entity,
        pool):judgment.stable_id,label=byKey.get(key);
        if(!label)continue;
        for(const human of label.criteria) {
          const system=judgment.criteria.find(x=>x.criterion_id===human.criterion_id);
          if(!system)continue;
          matrix[STATES.indexOf(human.state)][STATES.indexOf(system.state)]++;
          total++;
          if(system.state==='unknown')unknown++;
        }
      }
    }
    const all=STATES.map((_,i)=>binaryStats(matrix,i)),supported=all.filter((_,i)=>matrix[i].some(Boolean));
    output[condition]= {
      states:STATES,confusion_matrix_human_rows_judge_columns:matrix,met:all[0],not_met:all[1],
        macro_f1:supported.length?avg(supported.map(x=>x.f1)):null,
      unknown_rate:total?unknown/total:null,n_pairs:total
    };
  }
  return output
}
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null,sd=a=>a.length?Math.sqrt(a.reduce((s,x)=>s+(x-avg(a))**2,
0)/a.length):null,sha=b=>createHash('sha256').update(b).digest('hex');
const lines=p=>existsSync(p)?readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
function logsValid(baseDir) {
  try {
    for(const dir of readdirSync(resolve(baseDir,'runs'))) {
      const path=resolve(baseDir,'runs',dir,'steps.jsonl');
      if(!existsSync(path))return false;
      for(const entry of lines(path))validate('log_entry',entry);
    }
    return true
  }
  catch {
    return false
  }
}
function labelingQuality(adj,second,pre,baseDir) {
  let agree=0;
  const table=[[0,0],[0,0]],hardTable=[[0,0],[0,0]];
  for(const[k,a]of adj) {
    const b=second.get(k);
    if(!b)continue;
    const ai=gain(a)>=2?0:1,bi=gain(b)>=2?0:1;
    table[ai][bi]++;
    if(ai===bi)agree++;
    hardTable[a.hard_eligibility==='ineligible'?1:0][b.hard_eligibility==='ineligible'?1:0]++;
  }
  let tp=0,fp=0,fn=0;
  const preMap=new Map(pre.map(x=>[`${x.case_id}|${x.stable_id}`,x]));
  for(const[k,human]of adj) {
    const p=preMap.get(k);
    if(!p)continue;
    const predicted=gain(p)>=2,actual=gain(human)>=2;
    if(predicted&&actual)tp++;
    else if(predicted)fp++;
    else if(actual)fn++;
  }
  let negatives_sampled=0,negatives_found_positive=0;
  const dir=resolve(baseDir,'labeling');
  if(existsSync(dir))for(const file of readdirSync(dir).filter(x=>x.startsWith('key-')
    &&x.endsWith('.json')))for(const item of Object.values(JSON.parse(readFileSync(resolve(dir,
  file))))) {
    if(!item.strata?.includes('S5'))continue;
    negatives_sampled++;
    const human=[...adj.values()].find(x=>x.stable_id===item.stable_id);
    if(human&&gain(human)>=2)negatives_found_positive++;
  }
  const reviewed=table.flat().reduce((a,b)=>a+b,0);
  return {
    adjudicated_items:adj.size,second_reviewed_items:reviewed,kappa_positive:reviewed?cohenKappa(table):null,
    kappa_hard_eligibility:reviewed?cohenKappa(hardTable):null,agreement_raw:reviewed?agree/reviewed:null,
    preannotator_vs_human: {
      precision:tp+fp?tp/(tp+fp):null,pooled_recall:tp+fn?tp/(tp+fn):null
    },negatives_sampled,negatives_found_positive
  }
}
/**
 * Conserva el contrato público de decisionFromReport para que sus consumidores compartan una sola implementación.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function decisionFromReport(report, {
  baseDir,runs
}
= {
}) {
  const allRuns=runs||(baseDir?readdirSync(resolve(baseDir,'runs')).map(dir=>resolve(baseDir,'runs',dir,
  'result.json')).filter(existsSync).map(path=>JSON.parse(readFileSync(path))):[]),primary=Object.fromEntries(['B0',
  'B1'].map(condition=> {
    const comparison=report.comparisons.find(item=>item.metric==='pooled_recall_at_20'
      &&item.b===condition);return[condition.toLowerCase().replace('b',
    'vs_b'), {
      wins:comparison.wins,ties:comparison.ties,losses:comparison.losses,p:comparison.sign_test_p_one_sided,
      ci:comparison.bootstrap_ci95
    }]
  })),means=Object.fromEntries(['B0','B1','B2'].map(condition=>[condition, {
    hard_false_positive_rate:avg(report.per_run.filter(item=>item.condition===condition).map(item=>
      item.hard_false_positive_rate).filter(value=>value!=null))??0,
    hit_at_20:avg(report.per_run.filter(item=>item.condition===condition).map(item=>item.hit_at_20).filter(value=>value!=null))??0,
    correct_abstentions:Number(report.abstention[condition].correct_abstentions.split('/')[0])
  }])),unknown_to_met=allRuns.flatMap(run=>run.judgments||[]).flatMap(judgment=>judgment.criteria).filter(item=>item.state==='met'
    &&item.llm_state!=null&&item.llm_state!=='met').length;
  return decide( {
    ...primary,means,integrity: {
      fatal_rate:report.per_run.filter(item=>item.stop_reason==='fatal_error').length/Math.max(1,report.per_run.length),
      logs_valid:baseDir?logsValid(baseDir):true,unknown_to_met,kappa_positive:report.labeling_quality.kappa_positive??-1
    }
  })
}
/**
 * Conserva el contrato público de buildMetricsReport para que sus consumidores compartan una sola implementación.
 * Excepción de 60 líneas: compone en un solo reporte las métricas congeladas y su decisión derivada.
 * @param {unknown} input Entrada definida por el contrato de la función.
 * @returns {unknown} Resultado definido por el contrato de la función.
 */
export function buildMetricsReport( {
  benchId,baseDir,configPath,casesDir,generatedAt
}) {
  const config=JSON.parse(readFileSync(configPath)),timestamp=generatedAt||`${config.today}T00:00:00.000Z`,
  runPaths=readdirSync(resolve(baseDir,'runs')).map(d=>resolve(baseDir,'runs',d,'result.json')).filter(existsSync),
  runs=runPaths.map(p=>JSON.parse(readFileSync(p))),human=[...lines(resolve(baseDir,'labels/adjudicator.jsonl')),
  ...lines(resolve(baseDir,'labels/second_reviewer.jsonl'))],pre=lines(resolve(baseDir,'labels/preannotations.jsonl')),
  last=(role)=>new Map(human.filter(x=>x.role===role).map(x=>[`${x.case_id}|${x.stable_id}`,x])),adj=last('adjudicator'),
  second=last('second_reviewer'),effective=new Map(adj);
  const per_run=[],curveRows=[],caseFiles=readdirSync(casesDir).filter(x=>x.endsWith('.json')&&x!=='manifest.json'),
  cases=caseFiles.map(f=>JSON.parse(readFileSync(resolve(casesDir,f)))),pools=new Map(cases.map(c=> {
    const path=resolve(baseDir,'pool',`${c.case_id}.json`);return[c.case_id,existsSync(path)?JSON.parse(readFileSync(path)):[]]
  }));
  for(const r of runs) {
    const labels=[...effective.values()].filter(x=>x.case_id===r.case_id),positive=labels.filter(x=>gain(x)>=2),
    c=cases.find(x=>x.case_id===r.case_id),pool=pools.get(r.case_id)||[],acc=accuracyMetrics(r,labels,pool);
    per_run.push( {
      run_id:r.run_id,case_id:r.case_id,condition:r.condition,seed:r.seed,hit_at_20:hitAt20(r.ranked,c?.anchor,
      r.entities,pool),pooled_recall_at_20:pooledRecallAt20(r.ranked,positive,r.entities,pool),ndcg_at_10:ndcgAt10(r.ranked,
      labels,r.entities,pool),hard_false_positive_rate:hardFalsePositiveRate(r,labels,pool),...acc,abstained:r.abstained,
      tokens_discovery_nominal:r.totals.tokens_discovery_nominal,seconds_discovery_nominal:r.totals.seconds_discovery_nominal,
      searches:r.totals.searches,stop_reason:r.stop_reason
    });
    for(const point of curveForRun(r,positive,pool))curveRows.push( {
      run_id:r.run_id,case_id:r.case_id,condition:r.condition,seed:r.seed,...point
    });
  }
  const metrics=['hit_at_20','pooled_recall_at_20','ndcg_at_10','hard_false_positive_rate','status_accuracy',
  'deadline_accuracy','identity_accuracy'];
  const per_case=cases.map(c=> {
    const poolPath=resolve(baseDir,'pool',`${c.case_id}.json`),pool=existsSync(poolPath)?JSON.parse(readFileSync(poolPath)):[],
    labels=[...effective.values()].filter(x=>x.case_id===c.case_id);const by_condition= {
    };for(const cond of['B0','B1','B2']) {
      const rr=per_run.filter(x=>x.case_id===c.case_id&&x.condition===cond);by_condition[cond]= {
      };for(const m of metrics) {
        const v=rr.map(x=>x[m]).filter(x=>x!=null);by_condition[cond][m]= {
          mean:avg(v),sd:sd(v),min:v.length?Math.min(...v):null,max:v.length?Math.max(...v):null
        };
      }
    }
    return {
      case_id:c.case_id,kind:c.kind,pool_size:pool.length,pool_positives:labels.filter(x=>gain(x)>=2).length,
      by_condition
    };
  });
  const comparisons=[];
  for(const metric of['pooled_recall_at_20','ndcg_at_10','hit_at_20'])for(const other of['B0','B1']) {
    const tau= {
      pooled_recall_at_20:.05,ndcg_at_10:.03,hit_at_20:0
    }
    [metric],d=per_case.filter(x=>x.kind==='anchor').map(x=> {
      const a=x.by_condition.B2[metric].mean,b=x.by_condition[other][metric].mean;return a==null||b==null?null:a-b
    }),w=wtl(d,tau),vals=d.filter(x=>x!=null),n=w.wins+w.losses;
    comparisons.push( {
      metric,a:'B2',b:other,n_cases:vals.length,wins:w.wins,ties:w.ties,losses:w.losses,tie_margin:tau,mean_diff:avg(vals)||0,
      bootstrap_ci95:bootstrapCI(vals),sign_test_p_one_sided:n?signTestOneSided(n,w.wins):null
    });
  }
  const labeling_quality=labelingQuality(adj,second,pre,baseDir),abstention= {
  };
  for(const cond of['B0','B1','B2']) {
    let correct=0,falseA=0,nNull=0,nAnchor=0;
    for(const c of cases) {
      const rr=per_run.filter(x=>x.case_id===c.case_id&&x.condition===cond),major=rr.filter(x=>x.abstained).length>=2;
      if(c.kind==='null') {
        nNull++;
        if(major)correct++;
      }
      else {
        nAnchor++;
        if(major)falseA++;
      }
    }
    abstention[cond]= {
      correct_abstentions:`${correct}/${nNull}`,false_abstentions:`${falseA}/${nAnchor}`
    };
  }
  const manifest=resolve(casesDir,'manifest.json'),allLabelBytes=['adjudicator','second_reviewer'].map(x=>resolve(baseDir,
  `labels/${x}.jsonl`)).filter(existsSync).map(path=>readFileSync(path));
  const report= {
    schema_version:'metrics_report/1',bench_id:benchId,generated_at:timestamp,run_config_sha256:sha(readFileSync(configPath)),
    cases_manifest_sha256:sha(existsSync(manifest)?readFileSync(manifest):Buffer.from('no-manifest')),
      labels_sha256:sha(Buffer.concat(allLabelBytes.length?allLabelBytes:[Buffer.from('no-labels')])),
    per_run,per_case,comparisons,labeling_quality,criteria_eval:criteriaMetrics(runs,[...effective.values()],
    pools),abstention
  };
  report.decision=decisionFromReport(report, {
    baseDir,runs
  });
  validate('metrics_report',report);
  const curve=[];
  for(const condition of['B0','B1','B2'])for(let tokens=0;tokens<=600000;tokens+=50000) {
    const caseMeans=cases.map(c=>avg(curveRows.filter(x=>x.condition===condition&&x.case_id===c.case_id&&x.tokens===tokens).map(x=>
      x.pooled_recall_at_20).filter(x=>x!=null))).filter(x=>x!=null);
    curve.push( {
      condition,tokens,pooled_recall_at_20:avg(caseMeans)
    });
  }
  const columns=['condition','tokens','pooled_recall_at_20'];
  writeFileSync(resolve(baseDir,'curve.csv'),columns.join(',')+'\n'+curve.map(row=>columns.map(k=>row[k]??'').join(',')).join('\n')+'\n');
  writeFileSync(resolve(baseDir,'metrics_report.json'),JSON.stringify(report,null,2)+'\n');
  const median=a=> {
    if(!a.length)return null;
    const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);
    return s.length%2?s[m]:(s[m-1]+s[m])/2
  };
  return {
    ...report,curve,latency:Object.fromEntries(['B0','B1','B2'].map(c=>[c, {
      discovery_seconds_median:median(runs.filter(x=>x.condition===c).map(x=>x.totals.seconds_discovery_nominal)),
      judge_seconds_median:median(runs.filter(x=>x.condition===c).map(x=>x.totals.seconds_judge_nominal)),
        median_seed_sd:Object.fromEntries(metrics.map(m=>[m,
      median(per_case.map(x=>x.by_condition[c][m].sd).filter(x=>x!=null))]))
    }]))
  }
}

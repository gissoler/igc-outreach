#!/usr/bin/env bash
# Guardia de Exa para la corrida nocturna SIN tope: cuando Exa deja de responder (saldo agotado, 401/402/403/429,
# "credits"/"balance"/"quota", o 3 errores seguidos de Exa), crea .overnight-stop y corta las corridas en curso,
# para que ninguna termine usando otros buscadores. No toca run-overnight.sh (está corriendo).
# Uso, desde la raíz del repo:   nohup bash research/bench/investors/exa-guard.sh > research/bench/investors/out/exa-guard.txt 2>&1 & disown
cd "$(dirname "$0")/../.."            # → research/
INV=bench/investors; STOP=$INV/out/.overnight-stop
SINCE=$(date -u -v-15M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '-15 min' +%Y-%m-%dT%H:%M:%SZ)
say() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
say "guardia de Exa activa (eventos desde $SINCE)"
while sleep 20; do
  r=$(node -e '
const fs=require("fs"),since=Date.parse(process.argv[1]);let consec=0,why=null,ok=0,err=0;
for(const d of process.argv.slice(2)){const f=d+"/events.jsonl";if(!fs.existsSync(f))continue;
 for(const l of fs.readFileSync(f,"utf8").split("\n")){if(!l)continue;let e;try{e=JSON.parse(l)}catch{continue}
  if(e.event!=="search_end"||Date.parse(e.timestamp)<since)continue;
  for(const a of e.attempts??[]){if(a.provider!=="exa"||a.cached)continue;
   if(a.error){err++;consec++;const m=String(a.error.message||"");
     if(/\b40[123]\b|\b429\b|credit|balance|quota|insufficient|payment|billing|exceeded/i.test(m))why="Exa: "+m.slice(0,160);}
   else{ok++;consec=0;}}}}
if(!why&&consec>=3)why="Exa: 3 errores seguidos";
console.log(why?"STOP "+why:"ok exa_ok="+ok+" exa_err="+err);' "$SINCE" $INV/out/investors-internal-2026-10-09-v5-pairs $INV/out/investors-internal-2026-10-09-v6)
  case "$r" in
    STOP*) touch "$STOP"; pkill -f run-experiment.v6.mjs; say "$r → se creó .overnight-stop y se cortaron las corridas en curso (no dejan result.json)"; exit 0;;
  esac
  pgrep -f run-overnight.sh >/dev/null || { say "run-overnight.sh terminó; guardia sale ($r)"; exit 0; }
done

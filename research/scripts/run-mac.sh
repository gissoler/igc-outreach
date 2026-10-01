#!/usr/bin/env bash
# Desde tu Mac:  bash research/scripts/run-mac.sh
# El motor (research, APIs de búsqueda, .env) corre AQUÍ, en el Mac. En g355 solo vive el modelo de IA.
#  1. copia a g355 solo el script que levanta el modelo (no se copia .env ni código)   4. prueba las APIs de búsqueda (desde el Mac)
#  2. lo ejecuta allí (Docker, misma imagen de vLLM que la flota, GPUs libres)          5. corre el brief con el modelo grande y con Qwen3-30B
#  3. abre un túnel SSH Mac → g355 (modelo grande + Qwen3-30B)                          6. cierra el túnel; reportes en research/eval/runs/
# MODO SIN TOCAR NADA: ENGINE_REMOTE_PORT=8005 usa el modelo que YA corre en g355 en ese puerto (no levanta ni apaga nada allí).
# Variables: G355_HOST (voltage-park) · OBJECTIVES (grant,investment) · BRIEF · COMPARE_30B (1) · ENGINE_MODEL (auto | <modelo HF> | none)
#            ENGINE_PORT · ENGINE_TP · ENGINE_GPUS · ENGINE_IMAGE · G355_CHAT_PORT (8000) — las ENGINE_* se pasan al script remoto.
# Sale con código distinto de 0 si algún paso falla (y lo dice al final); nunca declara "listo" sin reporte.
# Cuidado con g355: antes y después toma una foto del estado (contenedores, GPUs, disco, carga) y avisa si algo AJENO cambió; usa solo GPUs vacías;
# el modelo grande se APAGA al terminar (o si interrumpes con Ctrl-C) salvo KEEP_MODEL=1. Los pesos descargados se quedan en disco (los cita al final).
set -uo pipefail
cd "$(dirname "$0")/.."
HOST="${G355_HOST:-voltage-park}"; OBJECTIVES="${OBJECTIVES:-grant,investment}"; BRIEF="${BRIEF:-eval/briefs/mentiva.json}"
COMPARE_30B="${COMPARE_30B:-1}"; KEEP_MODEL="${KEEP_MODEL:-0}"; REMOTE_EXISTING="${ENGINE_REMOTE_PORT:-}"; CHAT_PORT="${G355_CHAT_PORT:-8000}"; ENGINE_MODEL_MODE="${ENGINE_MODEL:-auto}"
# Las corridas de evaluación NO gastan créditos de Firecrawl salvo que lo pidas (≈5 créditos por página, hasta 75 por corrida): ENGINE_EXTRACT=auto para activar la segunda lectura.
export ENGINE_EXTRACT="${ENGINE_EXTRACT:-off}"
say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
fail=0; notes=()
note() { notes+=("$*"); fail=1; printf '\033[1;31m✖ %s\033[0m\n' "$*"; }

TMPD="$(mktemp -d "${TMPDIR:-/tmp}/g355-run.XXXXXX")" || { echo "✖ no pude crear un directorio temporal"; exit 1; }
SOCK="$TMPD/ctl"
MODEL_STARTED=0; STOPPED=0
stop_remote() { (( MODEL_STARTED && ! STOPPED )) || return 0; STOPPED=1; echo "Apagando el modelo grande en g355…"; ssh -o ConnectTimeout=15 "$HOST" 'bash ~/outreach-engine-serve/g355-serve-engine-model.sh stop' 2>&1 | sed 's/^/  /' || echo "⚠ no pude apagarlo; hazlo tú: ssh $HOST 'bash ~/outreach-engine-serve/g355-serve-engine-model.sh stop'"; }
cleanup() { [[ "$KEEP_MODEL" == 1 ]] || stop_remote; ssh -S "$SOCK" -O exit "$HOST" >/dev/null 2>&1 || true; rm -rf "$TMPD"; }
trap cleanup EXIT
trap 'echo; echo "Interrumpido."; exit 130' INT TERM
health() { ssh -o ConnectTimeout=15 "$HOST" 'bash -s -- --snapshot' < scripts/g355-health.sh 2>/dev/null; }

command -v node >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0]>=22?0:1)' || { echo "✖ Necesitas Node 22+ en el Mac (node -v)"; exit 1; }
[[ -f .env ]] || { echo "✖ Falta research/.env"; exit 1; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
free_port() { local p="$1"; while port_busy "$p"; do p=$((p + 1)); done; echo "$p"; }

# ── 1-2. modelo grande en g355
REMOTE_PORT=""
if [[ -n "$REMOTE_EXISTING" ]]; then
  say "1-2/6 Usando el modelo que YA corre en g355 (puerto $REMOTE_EXISTING): no se levanta ni se apaga nada allí"
  [[ "$REMOTE_EXISTING" =~ ^[0-9]+$ ]] || { echo "✖ ENGINE_REMOTE_PORT debe ser un número"; exit 1; }
  ssh "$HOST" 'mkdir -p ~/outreach-engine-serve' && scp -q scripts/g355-health.sh "$HOST:outreach-engine-serve/" || { echo "✖ no pude conectar a $HOST por SSH"; exit 1; }
  health > "$TMPD/before"; [[ -s "$TMPD/before" ]] || echo "⚠ no pude tomar la foto previa de g355 (no habrá comparación al final)"
  echo "Estado de g355 antes de empezar:"; grep -E "load|mem_available|disk|gpu|container" "$TMPD/before" | sed 's/^/  /'
  REMOTE_PORT="$REMOTE_EXISTING"
elif [[ "$ENGINE_MODEL_MODE" != none ]]; then
  say "1-2/6 Modelo grande en g355 (solo se copia un script)"
  ssh "$HOST" 'mkdir -p ~/outreach-engine-serve' && scp -q scripts/g355-serve-engine-model.sh scripts/g355-health.sh "$HOST:outreach-engine-serve/" || { echo "✖ no pude conectar a $HOST por SSH"; exit 1; }
  health > "$TMPD/before" ; [[ -s "$TMPD/before" ]] || echo "⚠ no pude tomar la foto previa de g355 (no habrá comparación al final)"
  echo "Estado de g355 antes de empezar:"; sed 's/^/  /' "$TMPD/before" | grep -E "load|mem_available|disk|gpu|container"
  MODEL_STARTED=1
  PASS=""; for v in ENGINE_MODEL ENGINE_PORT ENGINE_TP ENGINE_GPUS ENGINE_MAX_LEN ENGINE_IMAGE ENGINE_REASONING ENGINE_IDLE_MIB ENGINE_ALLOW_PIP; do [[ -n "${!v:-}" ]] && PASS+="$v=$(printf '%q' "${!v}") "; done
  if ssh -t "$HOST" "${PASS}bash ~/outreach-engine-serve/g355-serve-engine-model.sh"; then
    # config escrita por el script remoto: se lee línea a línea y solo se aceptan claves conocidas (sin eval)
    while IFS='=' read -r k v; do
      case "$k" in ENGINE_LLM_URL|ENGINE_LLM_MODEL|ENGINE_LLM_JSON_MODE|ENGINE_LLM_REASONING_EFFORT|ENGINE_LLM_TIMEOUT_MS|ENGINE_LLM_MAX_TOKENS|ENGINE_GPUS_USED) export "$k=$v";; esac
    done < <(ssh "$HOST" 'cat ~/.outreach-engine.env' 2>/dev/null)
    REMOTE_PORT="$(sed -n 's#^http://127\.0\.0\.1:\([0-9][0-9]*\)/v1$#\1#p' <<<"${ENGINE_LLM_URL:-}")"
    [[ -n "$REMOTE_PORT" && -n "${ENGINE_LLM_MODEL:-}" ]] || { note "el modelo grande arrancó pero no pude leer su configuración (~/.outreach-engine.env en g355)"; unset ENGINE_LLM_URL ENGINE_LLM_MODEL; }
  else
    note "el modelo grande no arrancó en g355 (mensajes arriba; log: ~/.outreach-engine/vllm-*.log y 'docker logs' allí). Sigo solo con Qwen3-30B."
  fi
else
  echo "ENGINE_MODEL=none: no se levanta ningún modelo; se usa el Qwen3-30B (y ENGINE_LLM_* si ya las tienes en .env)."
fi

# ── 3. túnel
say "3/6 Túnel SSH"
LOCAL_ENGINE=""; LOCAL_CHAT="$(free_port 18000)"
FWD=(-L "$LOCAL_CHAT:127.0.0.1:$CHAT_PORT")
if [[ -n "$REMOTE_PORT" ]]; then LOCAL_ENGINE="$(free_port "$REMOTE_PORT")"; FWD+=(-L "$LOCAL_ENGINE:127.0.0.1:$REMOTE_PORT"); fi
if ssh -f -N -M -S "$SOCK" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 "${FWD[@]}" "$HOST"; then
  echo "127.0.0.1:$LOCAL_CHAT → Qwen3-30B (g355:$CHAT_PORT)${LOCAL_ENGINE:+ · 127.0.0.1:$LOCAL_ENGINE → modelo grande (g355:$REMOTE_PORT)}"
  [[ -n "$LOCAL_ENGINE" ]] && export ENGINE_LLM_URL="http://127.0.0.1:$LOCAL_ENGINE/v1"
else
  note "no pude abrir el túnel SSH"; unset ENGINE_LLM_URL ENGINE_LLM_MODEL
  echo "sin túnel no hay modelo; termino."; exit 1
fi
export VLLM_CHAT_URL="http://127.0.0.1:$LOCAL_CHAT/v1"
export VLLM_CHAT_MODEL="$(curl -s -m 8 "$VLLM_CHAT_URL/models" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null || true)"
echo "Qwen 30B: ${VLLM_CHAT_MODEL:-(no responde por el túnel)}"
if [[ -n "$REMOTE_EXISTING" ]]; then   # el id del modelo lo dice el propio servidor
  export ENGINE_LLM_MODEL="$(curl -s -m 8 "http://127.0.0.1:$LOCAL_ENGINE/v1/models" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null || true)"
  [[ -n "$ENGINE_LLM_MODEL" ]] || { note "no respondió nada en g355:$REMOTE_EXISTING (¿ese puerto sirve un modelo?)"; unset ENGINE_LLM_URL ENGINE_LLM_MODEL; }
  export ENGINE_LLM_TIMEOUT_MS="${ENGINE_LLM_TIMEOUT_MS:-240000}"
fi
[[ -n "${ENGINE_LLM_MODEL:-}" ]] && echo "modelo grande: $ENGINE_LLM_MODEL"
if [[ -n "${ENGINE_LLM_URL:-}" ]]; then
  [[ -n "$(curl -s -m 8 "$ENGINE_LLM_URL/models")" ]] || { note "el modelo grande no responde por el túnel"; unset ENGINE_LLM_URL ENGINE_LLM_MODEL; }
fi

# ── 4. APIs
say "4/6 APIs de búsqueda (desde el Mac)"
node --env-file-if-exists=.env scripts/search-apis-check.mjs || { note "ninguna API de búsqueda respondió; revisa claves/red arriba"; echo "sin búsqueda no hay corrida; termino."; exit 1; }

# ── 5. corridas (un fallo se anota y se sigue; el código de salida final lo refleja)
runs_ok=0
if [[ -n "${ENGINE_LLM_MODEL:-}" && -n "${ENGINE_LLM_URL:-}" ]]; then
  say "5/6 Motor v2 con el modelo grande ($ENGINE_LLM_MODEL)"
  if node --env-file-if-exists=.env scripts/engine-run.mjs --brief "$BRIEF" --objectives "$OBJECTIVES" --label "$(basename "$ENGINE_LLM_MODEL")"; then runs_ok=$((runs_ok + 1)); else note "engine-run con el modelo grande terminó con error"; fi
else echo "(sin modelo grande: se omite)"; fi
if [[ "$COMPARE_30B" == 1 ]]; then
  if [[ -n "$VLLM_CHAT_MODEL" ]]; then
    say "5b/6 Mismo brief con Qwen3-30B (mismas búsquedas en caché)"
    if env -u ENGINE_LLM_URL -u ENGINE_LLM_MODEL -u ENGINE_LLM_JSON_MODE -u ENGINE_LLM_REASONING_EFFORT node --env-file-if-exists=.env scripts/engine-run.mjs --brief "$BRIEF" --objectives "$OBJECTIVES" --label qwen3-30b; then runs_ok=$((runs_ok + 1)); else note "engine-run con Qwen3-30B terminó con error"; fi
  else note "no se pudo correr con Qwen3-30B: no responde por el túnel"; fi
fi

# ── 6. resumen honesto
say "6/6 Resumen"
if (( runs_ok > 0 )); then
  ls -1dt eval/runs/*/ 2>/dev/null | head -"$runs_ok" | while read -r d; do echo "── $d"; grep -E '^(- Modelo|\| (grant|investment) |## Recall)' "$d/report.md"; done
  echo "Reportes en $(pwd)/eval/runs/"
else note "ninguna corrida produjo reporte"; fi
if (( MODEL_STARTED )) && [[ "$KEEP_MODEL" == 1 ]]; then echo "KEEP_MODEL=1: el modelo grande SIGUE corriendo en g355 (apagar: ssh $HOST 'bash ~/outreach-engine-serve/g355-serve-engine-model.sh stop')."; else stop_remote; fi
if [[ -s "$TMPD/before" ]]; then
  say "Integridad de g355 (antes → después)"
  sleep 5; health > "$TMPD/after"
  python3 - "$TMPD/before" "$TMPD/after" "${ENGINE_GPUS_USED:-}" "$KEEP_MODEL" "$MODEL_STARTED" <<'PY' || fail=1
import sys
def load(p):
    d={'gpu':{}, 'cont':{}, 'disk':{}, 'load':None, 'mem':None, 'stray':0, 'own':0}
    for l in open(p).read().splitlines():
        w=l.split()
        if not w: continue
        if w[0]=='gpu': d['gpu'][w[1]]=int(w[3])
        elif w[0]=='container': d['cont'][w[1]]=(w[3], w[5])
        elif w[0]=='disk': d['disk'][w[1]]=int(w[3])
        elif w[0]=='load': d['load']=(float(w[1]), int(w[3]))
        elif w[0]=='mem_available_gb': d['mem']=int(w[1])
        elif w[0]=='stray_log_followers': d['stray']=int(w[1])
        elif w[0]=='own_vllm': d['own']=int(w[1])
    return d
b,a=load(sys.argv[1]),load(sys.argv[2]); ours={g for g in sys.argv[3].split(',') if g}; keep=sys.argv[4]=='1'; started=sys.argv[5]=='1'
problems=[]
for n,(t,o) in b['cont'].items():
    if o=='1': continue
    if n not in a['cont']: problems.append(f"el contenedor ajeno «{n}» YA NO está corriendo")
    elif a['cont'][n][0]!=t: problems.append(f"el contenedor ajeno «{n}» se reinició")
for g,u in b['gpu'].items():
    if keep and g in ours: continue
    d=a['gpu'].get(g,u)-u
    if abs(d)>1500: problems.append(f"GPU {g}: memoria {u} → {a['gpu'].get(g)} MiB ({d:+d})")
left=[n for n,(t,o) in a['cont'].items() if o=='1' and n not in b['cont']]
if left and not keep: problems.append("quedan contenedores propios corriendo: "+", ".join(left))
if a['own']>b['own'] and not keep: problems.append(f"quedan {a['own']-b['own']} proceso(s) vLLM propios en marcha")
if a['stray']>b['stray']: problems.append(f"quedan {a['stray']-b['stray']} proceso(s) 'docker logs -f' de Outreach")
for m,f in b['disk'].items():
    if m in a['disk'] and a['disk'][m]!=f: print(f"  disco {m}: {f} → {a['disk'][m]} GB libres ({a['disk'][m]-f:+d}; los pesos descargados se quedan en disco)")
if b['load'] and a['load']: print(f"  carga: {b['load'][0]} → {a['load'][0]} (núcleos: {a['load'][1]})")
if b['mem'] is not None: print(f"  RAM disponible: {b['mem']} → {a['mem']} GB")
if problems:
    print("\033[1;31m✖ Cambios en g355 que conviene revisar:\033[0m"); [print("   -", p) for p in problems]; sys.exit(1)
print("  ✔ contenedores ajenos intactos, GPUs ajenas sin cambios" + (", modelo propio apagado" if started and not keep else ""))
PY
  (( fail )) && notes+=("la comprobación de integridad de g355 encontró cambios (arriba)")
fi
if (( fail )); then printf '\n\033[1;31mTerminó con problemas:\033[0m\n'; printf ' - %s\n' "${notes[@]}"; exit 1; fi
echo "Todo correcto."

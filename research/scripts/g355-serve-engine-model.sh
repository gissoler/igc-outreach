#!/usr/bin/env bash
# Levanta en g355 el modelo que PLANEA y LEE en el motor v2 (rol "engine"), en GPUs vacías, sin tocar la flota.
#   bash g355-serve-engine-model.sh            # arranca (o reutiliza el propio si ya sirve el mismo modelo)
#   bash g355-serve-engine-model.sh check      # SOLO LEE: dice qué runtime, modelo, GPU y puerto usaría, y no arranca nada
#   bash g355-serve-engine-model.sh stop       # apaga lo propio (solo procesos de este usuario que este script arrancó)
# Runtime (en este orden): ENGINE_PYTHON · el python de la flota (`vllm serve` del sistema: ya es compatible con el driver) · Docker con la imagen de la flota
#   (solo si tu usuario ya puede usar Docker) · pip (solo con ENGINE_ALLOW_PIP=1). Nunca sudo.
# Variables (opcionales):
#   ENGINE_MODEL   auto (por defecto): openai/gpt-oss-120b si vLLM >= 0.10.2; si no, Qwen/Qwen3-235B-A22B-Instruct-2507-FP8
#   ENGINE_TP (auto: 1 gpt-oss, 4 el 235B)   ENGINE_MAX_LEN   ENGINE_PORT (auto: primero libre desde 8010)   ENGINE_GPUS (lista fija)   ENGINE_IDLE_MIB (1000)
#   ENGINE_PYTHON  ENGINE_IMAGE  HF_HOME (auto: disco con más espacio)  HF_TOKEN
# Escribe ~/.outreach-engine.env (URL, modelo, GPUs usadas) que lee run-mac.sh.
set -uo pipefail
ACTION="${1:-start}"
STATE="$HOME/.outreach-engine"; mkdir -p "$STATE"; OUTENV="$HOME/.outreach-engine.env"; CPREFIX="outreach-engine"
say() { printf '\033[1m[engine-model]\033[0m %s\n' "$*" >&2; }
busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
model_at() { curl -s -m 5 "http://127.0.0.1:$1/v1/models" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null; }
D=""; if command -v docker >/dev/null && docker ps >/dev/null 2>&1; then D="docker"; fi   # solo si el usuario ya puede; nunca sudo

# ── procesos propios (python runtime): un .pid por puerto; se comprueba que el pid sea de verdad nuestro antes de tocarlo
own_pid() { local f="$STATE/vllm-$1.pid" pid; [[ -f "$f" ]] || return 1; pid=$(cat "$f"); ps -o args= -p "$pid" 2>/dev/null | grep -q "vllm.entrypoints.openai.api_server.*--port $1" && echo "$pid"; }
stop_own() {
  local f p pid n=0
  for f in "$STATE"/vllm-*.pid; do [[ -f "$f" ]] || continue; p="${f##*vllm-}"; p="${p%.pid}"; pid=$(own_pid "$p") || { rm -f "$f"; continue; }
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$pid" 2>/dev/null && { kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null; }
    rm -f "$f"; n=$((n+1)); say "detenido el modelo propio del puerto $p (pid $pid)"; done
  if [[ -n "$D" ]]; then ids=$($D ps -aq --filter "name=$CPREFIX-" 2>/dev/null); [[ -n "$ids" ]] && { $D rm -f $ids >/dev/null && say "contenedor(es) propios detenidos"; n=$((n+1)); }; fi
  (( n )) || say "no había nada propio en marcha"
}
[[ "$ACTION" == stop ]] && { stop_own; exit 0; }

# ── runtime
PY="${ENGINE_PYTHON:-}"; IMAGE="${ENGINE_IMAGE:-}"; RUNTIME=""; VLLM_VER=""; WHY=""
if [[ -z "$PY" && -z "$IMAGE" ]]; then
  FP=$(ps -eo args= | grep -E '[v]llm serve|[v]llm\.entrypoints' | awk '{print $1}' | grep -E '^/.*python' | sort -u | head -1)   # python de la flota (procesos de cualquier usuario)
  if [[ -n "$FP" ]]; then ERR=$("$FP" -c 'import vllm' 2>&1 | tail -1); [[ -z "$ERR" ]] && PY="$FP" || WHY="el python de la flota ($FP) no puede importar vllm con este usuario: $ERR"; fi
fi
if [[ -n "$PY" ]]; then RUNTIME=python
  VLLM_VER=$("$PY" -c 'import vllm; print(vllm.__version__)' 2>/dev/null | tail -1 | sed 's/[^0-9.].*//')
  CUDA_OK=$("$PY" -c 'import torch; print(torch.version.cuda, torch.cuda.is_available())' 2>/dev/null | tail -1)
  say "runtime: $PY · vLLM ${VLLM_VER:-?} · torch CUDA/disponible: ${CUDA_OK:-?}"
  [[ "$CUDA_OK" == *True ]] || { say "✖ ese python no ve CUDA (${CUDA_OK:-sin torch}); no sigo"; exit 1; }
elif [[ -n "$D" && -z "$PY" ]]; then
  [[ -z "$IMAGE" ]] && { IMAGE=$($D ps --filter publish=8000 --format '{{.Image}}' 2>/dev/null | head -1); [[ -z "$IMAGE" ]] && IMAGE=$($D ps --format '{{.Image}}' 2>/dev/null | grep -i vllm | head -1); }
  if [[ -n "$IMAGE" ]]; then RUNTIME=docker; say "runtime: Docker, imagen $IMAGE"
    VLLM_VER=$($D run --rm --entrypoint python3 "$IMAGE" -c 'import vllm; print(vllm.__version__)' 2>/dev/null | tail -1 | sed 's/[^0-9.].*//'); fi
fi
if [[ -z "$RUNTIME" ]]; then
  if [[ "${ENGINE_ALLOW_PIP:-0}" == 1 ]]; then RUNTIME=pip; say "ENGINE_ALLOW_PIP=1: entorno pip propio (puede no arrancar si su CUDA es más nuevo que el driver)"
  else say "✖ no encontré un runtime de vLLM utilizable. No instalo nada por mi cuenta. ${WHY}"; say "  Opciones: ENGINE_PYTHON=<python con vllm> · ENGINE_IMAGE=<imagen> (si tu usuario puede usar Docker) · ENGINE_ALLOW_PIP=1 (instala vLLM con pip, varios GB)"; exit 1; fi
fi

# ── modelo, GPUs, contexto
MODEL="${ENGINE_MODEL:-auto}"
if [[ "$MODEL" == auto ]]; then
  if [[ -n "$VLLM_VER" && "$(printf '%s\n0.10.2\n' "$VLLM_VER" | sort -V | head -1)" == "0.10.2" ]]; then MODEL="openai/gpt-oss-120b"; else MODEL="Qwen/Qwen3-235B-A22B-Instruct-2507-FP8"; fi
fi
case "$MODEL" in *gpt-oss-120b*) TPD=1; LEND=65536; NEED=70;; *235B*) TPD=4; LEND=32768; NEED=250;; *) TPD=1; LEND=32768; NEED=100;; esac
TP="${ENGINE_TP:-$TPD}"; MAXLEN="${ENGINE_MAX_LEN:-$LEND}"
say "modelo: $MODEL · TP=$TP · contexto $MAXLEN"

# ¿ya hay uno propio sirviendo este modelo? Se reutiliza; si sirve otro, se apaga para liberar las GPU.
REUSED=""; PORT=""
for f in "$STATE"/vllm-*.pid; do [[ -f "$f" ]] || continue; p="${f##*vllm-}"; p="${p%.pid}"
  if own_pid "$p" >/dev/null; then
    if [[ "$(model_at "$p")" == "$MODEL" ]]; then say "ya está arriba (propio, puerto $p)"; PORT="$p"; REUSED=1; else [[ "$ACTION" == check ]] || { say "hay otro modelo propio en el puerto $p; lo apago"; stop_own; }; fi
  fi
done
write_env() {
  { echo "ENGINE_LLM_URL=http://127.0.0.1:$PORT/v1"; echo "ENGINE_LLM_MODEL=$MODEL"
    if [[ "$MODEL" == *gpt-oss* ]]; then echo "ENGINE_LLM_JSON_MODE=0"; echo "ENGINE_LLM_REASONING_EFFORT=${ENGINE_REASONING:-medium}"; fi
    echo "ENGINE_LLM_TIMEOUT_MS=240000"; echo "ENGINE_GPUS_USED=${FREE:-}"; } > "$OUTENV"
  say "listo: $MODEL en el puerto $PORT de g355 (config en $OUTENV)"
}
[[ -n "$REUSED" && "$ACTION" != check ]] && { write_env; exit 0; }

# ── GPUs: SOLO las vacías (< ENGINE_IDLE_MIB, 1000). Nunca se comparte una GPU con la flota salvo ENGINE_GPUS explícito.
IDLE="${ENGINE_IDLE_MIB:-1000}"
if [[ -n "${ENGINE_GPUS:-}" ]]; then FREE="$ENGINE_GPUS"; say "ENGINE_GPUS explícito ($FREE): asumes que esas GPU se pueden usar"
else FREE=$(nvidia-smi --query-gpu=index,memory.used --format=csv,noheader,nounits | awk -F', *' -v m="$IDLE" '$2<m{print $2" "$1}' | sort -n | head -n "$TP" | awk '{print $2}' | sort -n | paste -sd, -); fi
N=$([[ -z "$FREE" ]] && echo 0 || awk -F, '{print NF}' <<<"$FREE")
if (( N < TP )); then say "✖ hacen falta $TP GPU(s) vacías (< $IDLE MiB usados) y hay $N. No toco GPUs con procesos de la flota. Estado:"; nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv >&2; say "opciones: ENGINE_MODEL=openai/gpt-oss-120b (1 GPU; requiere vLLM >= 0.10.2), o un modelo que quepa en $N GPU con ENGINE_TP=$N"; exit 1; fi
say "GPU(s): $FREE"

# ── puerto: el pedido si está libre; si no, el primero libre desde 8010 (no se toca lo que ya escucha)
PORT="${ENGINE_PORT:-8010}"
if busy "$PORT"; then say "el puerto $PORT ya está ocupado por otro servicio; busco uno libre"; for p in $(seq 8010 8060); do busy "$p" || { PORT="$p"; break; }; done; fi
busy "$PORT" && { say "✖ no encontré un puerto libre entre 8010 y 8060"; exit 1; }
say "puerto: $PORT"

# ── pesos: disco con más espacio, y se comprueba el espacio ANTES de descargar
if [[ -z "${HF_HOME:-}" ]]; then
  best="$HOME"; bestfree=$(df -Pk "$HOME" | awk 'NR==2{print $4}')
  for d in /data /data/home/"$USER" /scratch /mnt/data; do [[ -d "$d" && -w "$d" ]] || continue; f=$(df -Pk "$d" | awk 'NR==2{print $4}'); (( f > bestfree )) && { best="$d"; bestfree=$f; }; done
  export HF_HOME="$best/.cache/huggingface"; [[ -d "$HOME/.cache/huggingface/hub/models--${MODEL//\//--}" ]] && export HF_HOME="$HOME/.cache/huggingface"
fi
CACHED=0; [[ -d "$HF_HOME/hub/models--${MODEL//\//--}/snapshots" ]] && CACHED=1
FREEGB=$(df -Pk "$(dirname "$HF_HOME")" 2>/dev/null | awk 'NR==2{print int($4/1048576)}')
say "pesos en $HF_HOME (${FREEGB:-?} GB libres; descargados: $( ((CACHED)) && echo sí || echo no ))"
if (( ! CACHED )) && [[ -n "$FREEGB" ]] && (( FREEGB < NEED + 50 )); then say "✖ el modelo necesita ~$NEED GB y quiero dejar 50 GB de margen; hay $FREEGB GB libres. No descargo nada."; exit 1; fi
LOADAVG=$(cut -d' ' -f1 /proc/loadavg); CORES=$(nproc)
say "carga de la máquina: $LOADAVG sobre $CORES núcleos (lo ajeno se ve con g355-inventory.sh); el modelo propio arranca con nice 10"
[[ "$ACTION" == check ]] && { say "CHECK: con esto arrancaría $MODEL en GPU $FREE, puerto $PORT, con $RUNTIME. No he arrancado nada."; exit 0; }

mkdir -p "$HF_HOME"; LOG="$STATE/vllm-$PORT.log"; CN="$CPREFIX-$PORT"
alive_pid() { kill -0 "$PID" 2>/dev/null; }
alive_docker() { [[ "$($D inspect -f '{{.State.Running}}' "$CN" 2>/dev/null)" == true ]]; }
last_log() { if [[ "$RUNTIME" == docker ]]; then $D logs --tail 1 "$CN" 2>&1 | cut -c1-150; else tail -1 "$LOG" | cut -c1-150; fi; }
fail_cleanup() { if [[ "$RUNTIME" == docker ]]; then $D rm -f "$CN" >/dev/null 2>&1; else own_pid "$PORT" >/dev/null && stop_own; fi; }   # nada a medias
wait_ready() {
  for i in $(seq 1 360); do   # hasta 90 min (la primera vez baja los pesos)
    [[ "$(model_at "$PORT")" == "$MODEL" ]] && return 0
    "$1" || { say "✖ el proceso terminó. Últimas líneas:"; if [[ "$RUNTIME" == docker ]]; then $D logs --tail 30 "$CN" >&2 2>&1; else tail -30 "$LOG" >&2; fi; return 1; }
    (( i % 12 == 0 )) && say "… esperando ($((i/4)) min) · $(last_log)"
    sleep 15
  done; say "✖ no respondió en 90 min (log: $LOG)"; return 1
}

if [[ "$RUNTIME" == docker ]]; then
  MEMTOT=$(awk '/MemTotal/{print int($2/1048576)}' /proc/meminfo); LIMITS=(--pids-limit 8192 --security-opt no-new-privileges --restart no --log-opt max-size=20m --log-opt max-file=2)
  (( MEMTOT >= 64 )) && LIMITS+=(--memory "$((MEMTOT / 2))g")
  $D rm -f "$CN" >/dev/null 2>&1
  $D run -d --name "$CN" --gpus "\"device=$FREE\"" --ipc=host --shm-size=16g "${LIMITS[@]}" -p "127.0.0.1:$PORT:8000" \
    -v "$HF_HOME:/root/.cache/huggingface" -e HF_HOME=/root/.cache/huggingface ${HF_TOKEN:+-e HF_TOKEN="$HF_TOKEN"} \
    --entrypoint vllm "$IMAGE" serve "$MODEL" --host 0.0.0.0 --port 8000 --tensor-parallel-size "$TP" \
    --max-model-len "$MAXLEN" --gpu-memory-utilization 0.88 --max-num-seqs 32 >"$STATE/docker-run-$PORT.out" 2>&1 \
    || { say "✖ docker no pudo arrancar el contenedor:"; cat "$STATE/docker-run-$PORT.out" >&2; fail_cleanup; exit 1; }
  say "contenedor $CN arrancando (GPU $FREE, solo 127.0.0.1:$PORT); la primera vez descarga los pesos"
  wait_ready alive_docker || { fail_cleanup; exit 1; }
else
  if [[ "$RUNTIME" == pip ]]; then
    V="$STATE/venv"; PY=""; [[ -x "$V/bin/python" ]] && "$V/bin/python" -c 'import vllm, torch; assert torch.cuda.is_available()' 2>/dev/null && PY="$V/bin/python"
    if [[ -z "$PY" ]]; then
      rm -rf "$V"; UV=$(command -v uv || true)
      if [[ -z "$UV" ]]; then curl -fsSL https://astral.sh/uv/install.sh 2>>"$LOG" | env UV_UNMANAGED_INSTALL="$STATE/uv" sh >>"$LOG" 2>&1; [[ -x "$STATE/uv/uv" ]] && UV="$STATE/uv/uv"; fi
      [[ -n "$UV" ]] || { say "✖ no pude instalar uv"; exit 1; }
      say "instalando vLLM en $V (detalle en $LOG)…"; { "$UV" venv --python 3.11 "$V" || "$UV" venv "$V"; } >>"$LOG" 2>&1
      "$UV" pip install --python "$V/bin/python" vllm --torch-backend=auto >>"$LOG" 2>&1 || { say "✖ no pude instalar vLLM:"; tail -15 "$LOG" >&2; exit 1; }
      "$V/bin/python" -c 'import vllm, torch; assert torch.cuda.is_available()' 2>>"$LOG" || { say "✖ el vLLM instalado no arranca con este driver (¿CUDA más nuevo que el driver?). Borra $V y usa ENGINE_PYTHON"; exit 1; }
    fi; PY="$V/bin/python"
  fi
  # setsid: el modelo es su propio grupo de procesos (se apaga entero y no depende de la sesión SSH); nice: no compite con la carga ajena
  setsid nice -n 10 env CUDA_VISIBLE_DEVICES="$FREE" HF_HOME="$HF_HOME" HF_HUB_DISABLE_TELEMETRY=1 "$PY" -m vllm.entrypoints.openai.api_server --model "$MODEL" \
    --host 127.0.0.1 --port "$PORT" --tensor-parallel-size "$TP" --max-model-len "$MAXLEN" --gpu-memory-utilization 0.88 --max-num-seqs 32 </dev/null >>"$LOG" 2>&1 &
  PID=$!; echo "$PID" > "$STATE/vllm-$PORT.pid"
  say "modelo propio arrancando (pid $PID, GPU $FREE, solo 127.0.0.1:$PORT); log: $LOG"
  wait_ready alive_pid || { fail_cleanup; exit 1; }
fi
write_env

#!/usr/bin/env bash
# Sirve modelos propios en g355 sin tocar la flota compartida.
# Modo anterior: start, check y stop sin ENGINE_NAME.
# Instancias: ENGINE_NAME=judge|compiler; stop por nombre; stop all.
set -uo pipefail

ACTION="${1:-start}"
STOP_TARGET="${2:-${ENGINE_NAME:-}}"
STATE="$HOME/.outreach-engine"
mkdir -p "$STATE"
CPREFIX="outreach-engine"
NAME="${ENGINE_NAME:-}"

say() { printf '\033[1m[engine-model%s]\033[0m %s\n' "${NAME:+:$NAME}" "$*" >&2; }
die() { say "ERROR: $*"; exit 1; }
busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
model_at() { curl -s -m 5 "http://127.0.0.1:$1/v1/models" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null; }
valid_name() { [[ -z "$1" || "$1" =~ ^[a-z][a-z0-9_-]{0,31}$ ]]; }
valid_name "$NAME" || die "ENGINE_NAME debe usar letras minúsculas, cifras, guion o guion bajo"

D=""
if command -v docker >/dev/null && docker ps >/dev/null 2>&1; then D="docker"; fi

pid_file_for() {
  local name="$1" port="${2:-}"
  if [[ -n "$name" ]]; then printf '%s/vllm-%s.pid\n' "$STATE" "$name"; else printf '%s/vllm-%s.pid\n' "$STATE" "$port"; fi
}
port_from_pid() { ps -o args= -p "$1" 2>/dev/null | sed -nE 's/.*--port[= ]+([0-9]+).*/\1/p' | head -1; }
own_pid_file() {
  local f="$1" pid expected_port args owner
  [[ -f "$f" ]] || return 1
  pid=$(sed -n '1p' "$f" 2>/dev/null)
  expected_port=$(sed -n '2p' "$f" 2>/dev/null)
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  owner=$(ps -o user= -p "$pid" 2>/dev/null | xargs) || return 1
  [[ "$owner" == "$USER" ]] || return 1
  args=$(ps -o args= -p "$pid" 2>/dev/null) || return 1
  [[ "$args" == *vllm* && "$args" == *"--port "* ]] || return 1
  [[ -z "$expected_port" || "$args" == *"--port $expected_port"* ]] || return 1
  printf '%s\n' "$pid"
}
stop_pid_file() {
  local f="$1" pid port
  pid=$(own_pid_file "$f") || { rm -f "$f"; return 1; }
  port=$(port_from_pid "$pid")
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -0 "$pid" 2>/dev/null && { kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null; }
  rm -f "$f"
  say "detenido el proceso propio ${port:+del puerto $port }(pid $pid)"
}
stop_named() {
  local target="$1" f cn n=0
  valid_name "$target" || die "nombre de instancia no válido: $target"
  f=$(pid_file_for "$target")
  stop_pid_file "$f" && n=1
  cn="$CPREFIX-$target"
  if [[ -n "$D" && -n "$($D ps -aq --filter "name=^/${cn}$" 2>/dev/null)" ]]; then
    $D rm -f "$cn" >/dev/null && say "contenedor propio $cn detenido"; n=1
  fi
  (( n )) || say "no había una instancia propia llamada $target"
}
stop_legacy() {
  local f base n=0
  for f in "$STATE"/vllm-[0-9]*.pid; do [[ -f "$f" ]] || continue; stop_pid_file "$f" && n=1; done
  if [[ -n "$D" ]]; then
    while read -r base; do [[ "$base" =~ ^${CPREFIX}-[0-9]+$ ]] || continue; $D rm -f "$base" >/dev/null; n=1; done < <($D ps -a --format '{{.Names}}' --filter "name=$CPREFIX-" 2>/dev/null)
  fi
  (( n )) || say "no había un proceso propio del modo anterior"
}
stop_all() {
  local f name n=0
  for f in "$STATE"/vllm-*.pid; do [[ -f "$f" ]] || continue; stop_pid_file "$f" && n=1; done
  if [[ -n "$D" ]]; then
    while read -r name; do [[ -n "$name" ]] || continue; $D rm -f "$name" >/dev/null; n=1; done < <($D ps -a --format '{{.Names}}' --filter "name=$CPREFIX-" 2>/dev/null)
  fi
  (( n )) || say "no había procesos propios en marcha"
}
if [[ "$ACTION" == stop ]]; then
  case "${STOP_TARGET:-legacy}" in all) stop_all ;; legacy) stop_legacy ;; *) stop_named "$STOP_TARGET" ;; esac
  exit 0
fi
[[ "$ACTION" == start || "$ACTION" == check ]] || die "uso: start | check | stop [nombre|all]"

PY="${ENGINE_PYTHON:-}"
IMAGE="${ENGINE_IMAGE:-}"
RUNTIME=""
VLLM_VER=""
WHY=""
if [[ -z "$PY" && -z "$IMAGE" ]]; then
  FP=$(ps -eo args= | grep -E '[v]llm serve|[v]llm\.entrypoints' | awk '{print $1}' | grep -E '^/.*python' | sort -u | head -1)
  if [[ -n "$FP" ]]; then ERR=$("$FP" -c 'import vllm' 2>&1 | tail -1); [[ -z "$ERR" ]] && PY="$FP" || WHY="el python detectado ($FP) no puede importar vllm: $ERR"; fi
fi
if [[ -n "$PY" ]]; then
  RUNTIME=python
  VLLM_VER=$("$PY" -c 'import vllm; print(vllm.__version__)' 2>/dev/null | tail -1 | sed 's/[^0-9.].*//')
  CUDA_OK=$("$PY" -c 'import torch; print(torch.version.cuda, torch.cuda.is_available())' 2>/dev/null | tail -1)
  say "runtime: $PY; vLLM ${VLLM_VER:-no medido}; CUDA: ${CUDA_OK:-no medido}"
  [[ "$CUDA_OK" == *True ]] || die "ese python no ve CUDA"
elif [[ -n "$D" ]]; then
  [[ -n "$IMAGE" ]] || IMAGE=$($D ps --format '{{.Image}}' 2>/dev/null | grep -i vllm | head -1)
  if [[ -n "$IMAGE" ]]; then RUNTIME=docker; VLLM_VER=$($D run --rm --entrypoint python3 "$IMAGE" -c 'import vllm; print(vllm.__version__)' 2>/dev/null | tail -1 | sed 's/[^0-9.].*//'); fi
fi
if [[ -z "$RUNTIME" ]]; then [[ "${ENGINE_ALLOW_PIP:-0}" == 1 ]] && RUNTIME=pip || die "no encontré un runtime de vLLM utilizable. $WHY"; fi

MODEL="${ENGINE_MODEL:-auto}"
if [[ "$MODEL" == auto ]]; then
  if [[ -n "$VLLM_VER" && "$(printf '%s\n0.10.2\n' "$VLLM_VER" | sort -V | head -1)" == 0.10.2 ]]; then MODEL="openai/gpt-oss-120b"; else MODEL="Qwen/Qwen3-235B-A22B-Instruct-2507-FP8"; fi
fi
case "$MODEL" in
  *gpt-oss-120b*) TPD=1; LEND=65536; SEQD=4; NEED=70; PARSERD=openai_gptoss ;;
  *Qwen3-30B-A3B-Instruct-2507*) TPD=1; LEND=32768; SEQD=8; NEED=65; PARSERD= ;;
  *235B*) TPD=4; LEND=32768; SEQD=32; NEED=250; PARSERD= ;;
  *) TPD=1; LEND=32768; SEQD=32; NEED=100; PARSERD= ;;
esac
TP="${ENGINE_TP:-$TPD}"
MAXLEN="${ENGINE_MAX_LEN:-$LEND}"
MAXSEQS="${ENGINE_MAX_SEQS:-$SEQD}"
GPU_UTIL="${ENGINE_GPU_MEMORY_UTILIZATION:-0.88}"
REASONING_PARSER="${ENGINE_REASONING_PARSER:-$PARSERD}"
say "modelo: $MODEL; TP=$TP; contexto=$MAXLEN; secuencias=$MAXSEQS"

REUSED=""; PORT=""; PID=""
if [[ -n "$NAME" ]]; then
  INSTANCE_PIDFILE=$(pid_file_for "$NAME")
  if PID=$(own_pid_file "$INSTANCE_PIDFILE"); then
    PORT=$(port_from_pid "$PID")
    if [[ "$(model_at "$PORT")" == "$MODEL" ]]; then REUSED=1; say "la instancia ya sirve el modelo en el puerto $PORT"
    elif [[ "$ACTION" != check ]]; then die "la instancia $NAME ya existe pero no sirve $MODEL"; fi
  elif [[ -f "$INSTANCE_PIDFILE" ]]; then rm -f "$INSTANCE_PIDFILE"; fi
else
  for f in "$STATE"/vllm-[0-9]*.pid; do
    [[ -f "$f" ]] || continue
    if PID=$(own_pid_file "$f"); then
      PORT=$(port_from_pid "$PID")
      if [[ "$(model_at "$PORT")" == "$MODEL" ]]; then REUSED=1; break
      elif [[ "$ACTION" != check ]]; then stop_legacy; fi
    else rm -f "$f"; fi
  done
fi

OUTENV="${NAME:+$HOME/.outreach-engine-$NAME.env}"
OUTENV="${OUTENV:-$HOME/.outreach-engine.env}"
write_env() {
  {
    echo "ENGINE_NAME=$NAME"
    echo "ENGINE_LLM_URL=http://127.0.0.1:$PORT/v1"
    echo "ENGINE_LLM_MODEL=$MODEL"
    echo "ENGINE_LLM_JSON_MODE=1"
    [[ "$MODEL" == *gpt-oss* ]] && echo "ENGINE_LLM_REASONING_EFFORT=${ENGINE_REASONING:-medium}"
    echo "ENGINE_LLM_TIMEOUT_MS=${ENGINE_TIMEOUT_MS:-240000}"
    echo "ENGINE_GPUS_USED=${FREE:-}"
    echo "ENGINE_MAX_LEN=$MAXLEN"
    echo "ENGINE_MAX_SEQS=$MAXSEQS"
    echo "ENGINE_REASONING_PARSER=$REASONING_PARSER"
    echo "ENGINE_PYTHON=${PY:-}"
  } > "$OUTENV"
  say "listo: $MODEL en 127.0.0.1:$PORT; configuración: $OUTENV"
}
if [[ -n "$REUSED" && "$ACTION" != check ]]; then FREE=""; write_env; exit 0; fi

IDLE="${ENGINE_IDLE_MIB:-1000}"
if [[ -n "${ENGINE_GPUS:-}" ]]; then
  FREE="$ENGINE_GPUS"
  while IFS=',' read -r idx used; do
    idx="${idx// /}"; used="${used// /}"
    [[ ",$FREE," == *",$idx,"* ]] || continue
    (( used < IDLE )) || die "la GPU $idx usa $used MiB; el límite es $IDLE MiB"
  done < <(nvidia-smi --query-gpu=index,memory.used --format=csv,noheader,nounits)
else
  FREE=$(nvidia-smi --query-gpu=index,memory.used --format=csv,noheader,nounits | awk -F', *' -v m="$IDLE" '$2<m{print $2" "$1}' | sort -n | head -n "$TP" | awk '{print $2}' | sort -n | paste -sd, -)
fi
N=$([[ -z "$FREE" ]] && echo 0 || awk -F, '{print NF}' <<<"$FREE")
(( N >= TP )) || { nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv >&2; die "hacen falta $TP GPU y hay $N por debajo de $IDLE MiB"; }
say "GPU: $FREE"

PORT="${ENGINE_PORT:-8010}"
if busy "$PORT"; then
  if [[ -n "${ENGINE_PORT:-}" || -n "$NAME" ]]; then die "el puerto $PORT está ocupado"; fi
  for p in $(seq 8010 8060); do busy "$p" || { PORT="$p"; break; }; done
fi
busy "$PORT" && die "no encontré un puerto libre"
say "puerto: $PORT"

if [[ -z "${HF_HOME:-}" ]]; then
  best="$HOME"; bestfree=$(df -Pk "$HOME" | awk 'NR==2{print $4}')
  for d in /data /data/home/"$USER" /scratch /mnt/data; do [[ -d "$d" && -w "$d" ]] || continue; f=$(df -Pk "$d" | awk 'NR==2{print $4}'); (( f > bestfree )) && { best="$d"; bestfree=$f; }; done
  export HF_HOME="$best/.cache/huggingface"
  [[ -d "$HOME/.cache/huggingface/hub/models--${MODEL//\//--}" ]] && export HF_HOME="$HOME/.cache/huggingface"
fi
MODEL_DIR="$HF_HOME/hub/models--${MODEL//\//--}"
CACHED=$(python3 - "$MODEL_DIR" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
complete = False
for snap in (root / "snapshots").glob("*") if (root / "snapshots").is_dir() else ():
    indexes = list(snap.glob("*.safetensors.index.json"))
    if indexes:
        try:
            names = {name for index in indexes for name in json.loads(index.read_text()).get("weight_map", {}).values()}
            complete = bool(names) and all((snap / name).exists() for name in names)
        except (OSError, ValueError):
            complete = False
    else:
        complete = any(snap.glob("*.safetensors"))
    if complete:
        break
print(1 if complete else 0)
PY
)
FREEGB=$(df -Pk "$(dirname "$HF_HOME")" 2>/dev/null | awk 'NR==2{print int($4/1048576)}')
say "pesos: $HF_HOME; disco libre=${FREEGB:-no medido} GB; caché completa=$CACHED"
if (( ! CACHED )) && [[ -n "$FREEGB" ]] && (( FREEGB < NEED + 50 )); then die "se estiman $NEED GB y se requieren 50 GB de margen; hay $FREEGB GB"; fi
say "carga: $(cut -d' ' -f1 /proc/loadavg); núcleos: $(nproc)"
if [[ "$ACTION" == check ]]; then say "CHECK: usaría $MODEL, GPU $FREE, puerto $PORT y runtime $RUNTIME; no inicié procesos"; exit 0; fi

mkdir -p "$HF_HOME"
if [[ -n "$NAME" ]]; then PIDFILE=$(pid_file_for "$NAME"); LOG="$STATE/vllm-$NAME.log"; CN="$CPREFIX-$NAME"; else PIDFILE=$(pid_file_for "" "$PORT"); LOG="$STATE/vllm-$PORT.log"; CN="$CPREFIX-$PORT"; fi
VLLM_ARGS=(--model "$MODEL" --host 127.0.0.1 --port "$PORT" --tensor-parallel-size "$TP" --max-model-len "$MAXLEN" --gpu-memory-utilization "$GPU_UTIL" --max-num-seqs "$MAXSEQS")
[[ -n "$REASONING_PARSER" ]] && VLLM_ARGS+=(--reasoning-parser "$REASONING_PARSER")
[[ "${ENGINE_ENABLE_PREFIX_CACHING:-1}" == 1 ]] && VLLM_ARGS+=(--enable-prefix-caching)
[[ "${ENGINE_ENABLE_CHUNKED_PREFILL:-1}" == 1 ]] && VLLM_ARGS+=(--enable-chunked-prefill)
[[ "${ENGINE_ENFORCE_EAGER:-0}" == 1 ]] && VLLM_ARGS+=(--enforce-eager)

alive_pid() { [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; }
alive_docker() { [[ "$($D inspect -f '{{.State.Running}}' "$CN" 2>/dev/null)" == true ]]; }
last_log() { if [[ "$RUNTIME" == docker ]]; then $D logs --tail 1 "$CN" 2>&1 | cut -c1-180; else tail -1 "$LOG" 2>/dev/null | cut -c1-180; fi; }
fail_cleanup() { if [[ "$RUNTIME" == docker ]]; then $D rm -f "$CN" >/dev/null 2>&1; elif [[ -f "$PIDFILE" ]]; then stop_pid_file "$PIDFILE" || true; fi; }
wait_ready() {
  for i in $(seq 1 480); do
    [[ "$(model_at "$PORT")" == "$MODEL" ]] && return 0
    "$1" || { say "ERROR: el proceso terminó"; if [[ "$RUNTIME" == docker ]]; then $D logs --tail 40 "$CN" >&2; else tail -40 "$LOG" >&2; fi; return 1; }
    (( i % 12 == 0 )) && say "espera=$((i/4)) min; $(last_log)"
    sleep 15
  done
  say "ERROR: no respondió en 120 min"; return 1
}

if [[ "$RUNTIME" == docker ]]; then
  $D rm -f "$CN" >/dev/null 2>&1
  DOCKER_ARGS=(serve "$MODEL" --host 0.0.0.0 --port 8000 --tensor-parallel-size "$TP" --max-model-len "$MAXLEN" --gpu-memory-utilization "$GPU_UTIL" --max-num-seqs "$MAXSEQS")
  [[ -n "$REASONING_PARSER" ]] && DOCKER_ARGS+=(--reasoning-parser "$REASONING_PARSER")
  $D run -d --name "$CN" --gpus "\"device=$FREE\"" --ipc=host --shm-size=16g --restart no -p "127.0.0.1:$PORT:8000" -v "$HF_HOME:/root/.cache/huggingface" -e HF_HOME=/root/.cache/huggingface ${HF_TOKEN:+-e HF_TOKEN="$HF_TOKEN"} --entrypoint vllm "$IMAGE" "${DOCKER_ARGS[@]}" >"$STATE/docker-run-${NAME:-$PORT}.out" 2>&1 || { fail_cleanup; die "docker no inició"; }
  wait_ready alive_docker || { fail_cleanup; exit 1; }
else
  [[ "$RUNTIME" != pip ]] || die "define ENGINE_PYTHON; el entorno pip anterior no es compatible"
  setsid nice -n 10 env CUDA_VISIBLE_DEVICES="$FREE" HF_HOME="$HF_HOME" HF_HUB_DISABLE_TELEMETRY=1 "$PY" -m vllm.entrypoints.openai.api_server "${VLLM_ARGS[@]}" </dev/null >>"$LOG" 2>&1 &
  PID=$!
  printf '%s\n%s\n%s\n' "$PID" "$PORT" "$MODEL" > "$PIDFILE"
  say "proceso propio iniciando: pid=$PID; GPU=$FREE; 127.0.0.1:$PORT; log=$LOG"
  wait_ready alive_pid || { fail_cleanup; exit 1; }
fi
write_env

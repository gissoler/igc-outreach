#!/usr/bin/env bash
# SOLO LEE. Responde: ¿cómo corre la flota?, ¿puedo usar Docker?, ¿qué GPU están realmente libres?, ¿qué trajo el vLLM del primer intento?
#   ssh voltage-park 'bash -s' < research/scripts/g355-inventory.sh
export LC_ALL=C
h() { printf '\n== %s ==\n' "$*"; }
h "usuario y grupos"; id
h "Docker / contenedores: ¿instalado y con permiso?"
for c in docker podman nerdctl apptainer singularity; do printf '%-12s %s\n' "$c" "$(command -v $c || echo no)"; done
if command -v docker >/dev/null; then docker ps 2>&1 | head -3; ls -l /var/run/docker.sock 2>&1; fi
h "GPU: driver y procesos con GPU (de cualquier usuario si el driver lo permite)"
nvidia-smi --query-gpu=index,name,driver_version,memory.used,memory.total --format=csv,noheader
nvidia-smi --query-compute-apps=gpu_uuid,pid,used_memory --format=csv,noheader 2>&1 | head -20
h "Procesos vLLM / motores (todos los usuarios)"
ps -eo user:14,pid,etimes,args | grep -Ei '[v]llm|[E]ngineCore|[a]pi_server' | cut -c1-210 | head -15
h "Puertos TCP en escucha (8000-8099)"
(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | awk '{print $4}' | grep -E ':80[0-9][0-9]$' | sort -u
h "Quién carga la CPU ahora"
uptime; ps -eo user:14,pcpu,rss,comm --sort=-pcpu | head -8
h "Python y entornos"
python3 --version 2>&1; command -v python3; conda env list 2>/dev/null | head; ls /opt 2>/dev/null | head
h "Lo que instaló el primer intento (nuestro venv)"
V="$HOME/.outreach-engine/venv/bin/python"
[[ -x "$V" ]] && "$V" -c 'import vllm,torch; print("vllm", vllm.__version__, "· torch", torch.__version__, "· CUDA de torch", torch.version.cuda)' 2>&1 | tail -2 || echo "(no hay venv)"
h "Salida a Hugging Face (código HTTP)"
curl -s -o /dev/null -m 8 -w '%{http_code}\n' https://huggingface.co || echo fail

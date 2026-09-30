#!/usr/bin/env bash
# SOLO LEE (no instala, no arranca, no borra). Estado de g355 y huella de Outreach.
#   ssh voltage-park 'bash -s' < research/scripts/g355-health.sh            # informe legible
#   ssh voltage-park 'bash -s -- --snapshot' < research/scripts/g355-health.sh   # líneas comparables (lo usa run-mac.sh)
export LC_ALL=C
D=""; command -v docker >/dev/null && docker ps >/dev/null 2>&1 && D="docker"
snap() {
  echo "load $(cut -d' ' -f1 /proc/loadavg) cores $(nproc)"
  echo "mem_available_gb $(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo)"
  for m in / /data "$HOME"; do df -Pk "$m" 2>/dev/null | awk -v m="$m" 'NR==2{print "disk "m" free_gb "int($4/1048576)}'; done | sort -u
  nvidia-smi --query-gpu=index,memory.used --format=csv,noheader,nounits 2>/dev/null | awk -F', *' '{print "gpu "$1" used_mib "$2}'
  if [[ -n "$D" ]]; then
    $D ps --format '{{.Names}}' | sort | while read -r n; do [[ -n "$n" ]] && echo "container $n started $($D inspect -f '{{.State.StartedAt}}' "$n" 2>/dev/null) ours $([[ $n == outreach-engine-* ]] && echo 1 || echo 0)"; done
  else echo "docker none"; fi   # ver g355-inventory.sh para el motivo
  echo "own_vllm $(ps -u "$USER" -o args= | grep -cE '[v]llm\.entrypoints\.openai\.api_server')"
  echo "stray_log_followers $(ps -u "$USER" -o args= | grep -cE '[d]ocker logs -f outreach-engine')"
}
if [[ "${1:-}" == "--snapshot" ]]; then snap; exit 0; fi
echo "== $(hostname) · $(date -u +%FT%TZ) =="; snap | sed 's/^/  /'
echo; echo "== Huella de Outreach en esta máquina =="
[[ -n "$D" ]] && { echo "contenedores propios:"; $D ps -a --filter name=outreach-engine- --format '  {{.Names}}  {{.Status}}  {{.Image}}' | sed '/^$/d'; [[ -z "$($D ps -aq --filter name=outreach-engine-)" ]] && echo "  (ninguno)"; }
for d in "$HOME/.outreach-engine" "$HOME/.outreach-engine/venv" "$HOME/outreach-engine-serve" "$HOME/.outreach-engine.env"; do [[ -e "$d" ]] && printf '  %-45s %s\n' "$d" "$(du -sh "$d" 2>/dev/null | cut -f1)"; done
for hf in $(printf '%s\n' "${HF_HOME:-}" "$HOME/.cache/huggingface" /data/home/"$USER"/.cache/huggingface | awk 'NF && !seen[$0]++'); do for m in "$hf"/hub/models--openai--gpt-oss-120b "$hf"/hub/models--Qwen--Qwen3-235B-A22B-Instruct-2507-FP8; do [[ -d "$m" ]] && printf '  pesos %-60s %s\n' "$m" "$(du -sh "$m" 2>/dev/null | cut -f1)"; done; done
echo "procesos vLLM del usuario (incluye los de la flota):"; ps -u "$USER" -o pid=,etimes=,rss=,args= | grep -E '[v]llm' | cut -c1-150 | sed 's/^/  /' | head -12

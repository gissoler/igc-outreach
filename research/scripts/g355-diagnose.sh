#!/usr/bin/env bash
# Diagnóstico de g355 para montar el motor local. Solo lee; no instala ni cambia nada.
echo "== GPUs libres (MiB usados) =="; nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader
echo; echo "== Disco =="; df -h /data /home 2>/dev/null | sed -n 1,5p
echo; echo "== Salida a internet (código HTTP) =="
for u in https://duckduckgo.com/html/?q=test https://www.bing.com/search?q=test https://search.brave.com/search?q=test https://www.google.com/search?q=test https://huggingface.co https://www.nia.nih.gov https://www.grants.gov https://pypi.org; do printf "%-55s " "$u"; curl -s -o /dev/null -m 10 -A "Mozilla/5.0" -w "%{http_code}\n" "$u" || echo fail; done
echo; echo "== Herramientas =="; for c in docker python3 pip node git; do printf "%-8s" $c; command -v $c || echo no; done
echo; echo "== Modelos ya descargados =="; ls -d /data/models/* /data/home/*/models/* ~/.cache/huggingface/hub/models--* 2>/dev/null | head -30
echo; echo "== vLLM en marcha =="; ps aux | grep -E "vllm.*serve|vllm.entrypoints" | grep -v grep | sed -E 's/ +/ /g' | cut -c1-260

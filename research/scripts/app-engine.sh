#!/usr/bin/env bash
# Enciende/apaga el motor v2 en la APP (servidor research) sin tocar el resto de tu .env.
#   bash research/scripts/app-engine.sh on          # motor v2 con Qwen3-30B (puerto 8000 de g355)
#   bash research/scripts/app-engine.sh off         # vuelve al comportamiento anterior
#   bash research/scripts/app-engine.sh status
# Solo escribe un bloque marcado dentro de research/.env (copia previa en .env.bak-motor). Después REINICIA el servidor
# (npm start) porque lee el .env al arrancar. El modelo llega por túnel: deja abierto  bash research/scripts/tunnel-g355.sh
# NO se activa nada en g355: solo se usan modelos que ya corren allí.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; ENVF="${ENV_FILE:-$ROOT/.env}"
CMD="${1:-status}"
BEGIN="# >>> motor v2 (app-engine.sh) — no editar a mano"; END="# <<< motor v2 (app-engine.sh)"
[[ -f "$ENVF" ]] || { echo "No existe $ENVF"; exit 1; }
ENVF="$ENVF" BEGIN="$BEGIN" END="$END" CMD="$CMD" python3 - <<'PY'
import os, re, shutil, sys
f, B, E, cmd = (os.environ[k] for k in ("ENVF","BEGIN","END","CMD"))
txt = open(f).read()
pat = re.compile(re.escape(B) + r".*?" + re.escape(E) + r"\n?", re.S)
has = bool(pat.search(txt)); outside = pat.sub("", txt)
KEYS = ["ENGINE_V2","VLLM_CHAT_URL","VLLM_CHAT_MODEL","ENGINE_SEARCH_PROVIDERS","ENGINE_MAX_QUERIES","RESEARCH_RUN_TIMEOUT_MS"]
def keys_outside():
    return [k for k in KEYS if re.search(r"^\s*%s=\s*\S" % k, outside, re.M)]
if cmd == "status":
    print("motor v2 en la app:", "ENCENDIDO" if has else "apagado")
    if has: print(pat.search(txt).group(0))
    dup = keys_outside()
    if dup: print("aviso: estas variables también están fuera del bloque y pueden pisarlo:", ", ".join(dup))
    sys.exit(0)
if cmd == "off":
    if has:
        shutil.copy(f, f + ".bak-motor"); open(f, "w").write(outside.rstrip("\n") + "\n")
    print("motor v2 APAGADO en .env. Reinicia el servidor (npm start).")
    sys.exit(0)
if cmd != "on": print("uso: on | off | status"); sys.exit(2)
dup = keys_outside()
if dup:
    print("Estas variables ya tienen valor en .env fuera del bloque:", ", ".join(dup)); print("Bórralas o vacíalas y repite (para no pisar tu configuración)."); sys.exit(1)
lines = [B, "ENGINE_V2=1",
  "# Linkup sin saldo: añádelo a la lista cuando lo recargues",
  "ENGINE_SEARCH_PROVIDERS=exa,you,tavily,jina,serper",
  "ENGINE_MAX_QUERIES=18",
  "# El pipeline aborta todo el run a los 180 s por defecto; el motor v2 necesita 2-4 min",
  "RESEARCH_RUN_TIMEOUT_MS=600000"]
lines += ["VLLM_CHAT_URL=http://127.0.0.1:18000/v1", "VLLM_CHAT_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507"]
lines.append(E)
shutil.copy(f, f + ".bak-motor")
open(f, "w").write(outside.rstrip("\n") + "\n\n" + "\n".join(lines) + "\n")
print("motor v2 ENCENDIDO. Reinicia el servidor (npm start) y deja abierto el túnel.")
PY

#!/usr/bin/env bash
# Añade a research/.env del servidor las claves que falten, tomándolas de OUTREACH_ENV_FILE (tu research/.env local).
# Lo llaman setup.sh y actualizar.sh; no hace falta correrlo a mano. Idempotente.
#  - Por defecto nunca pisa un valor que ya tengas puesto en el servidor; con OUTREACH_ENV_OVERWRITE=1 (lo pone desplegar.sh)
#    el valor de tu .env local reemplaza al del servidor (se guarda copia en .env.bak). Un valor vacío local no borra nada.
#  - No copia lo que es solo de tu Mac: puerto, dominio, ENGINE_*, VLLM_* ni nada que apunte a localhost o a rutas de tu Mac.
#  - En AWS solo corren el front y el back: el motor v2 y los modelos de g355 se usan desde tu Mac (app-motor.sh),
#    así que aquí el motor v2 queda siempre apagado.
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/outreach}"; APP_USER="${APP_USER:-outreach}"; ENV_R="$APP_DIR/research/.env"
[[ $EUID -eq 0 ]] || { echo "Corre esto con sudo."; exit 1; }
[[ -f "$ENV_R" ]] || { echo "    claves: no existe $ENV_R (corre setup.sh primero)."; exit 1; }
if [[ -z "${OUTREACH_ENV_FILE:-}" || ! -f "${OUTREACH_ENV_FILE:-}" ]]; then
  echo "    claves: sin OUTREACH_ENV_FILE; se dejan las del servidor como están."
else
  cp -p "$ENV_R" "$ENV_R.bak" 2>/dev/null || true
  ENV_R="$ENV_R" SRC="$OUTREACH_ENV_FILE" OVERWRITE="${OUTREACH_ENV_OVERWRITE:-0}" python3 - <<'PY'
import os, re
dst, src = os.environ["ENV_R"], os.environ["SRC"]
SKIP = re.compile(r"^(RESEARCH_PORT|RESEARCH_PUBLIC_ORIGIN|RESEARCH_BROWSER|RESEARCH_RUN_TIMEOUT_MS|NODE_ENV|ENGINE_.*|VLLM_.*)$")
def parse(p):
    d = {}
    for l in open(p):
        m = re.match(r"^\s*([A-Z][A-Z0-9_]*)=(.*)$", l.rstrip("\n"))
        if m: d[m.group(1)] = m.group(2)
    return d
have, new = parse(dst), parse(src)
add = [(k, v) for k, v in new.items()
       if not SKIP.match(k) and v.strip() and not re.search(r"127\.0\.0\.1|localhost", v) and not re.match(r"^\s*(/Users/|/home/|[A-Za-z]:\\)", v) and (os.environ.get("OVERWRITE") == "1" and have.get(k) != v or not have.get(k, "").strip())]
lines = open(dst).read().splitlines()
for k, v in add:
    for i, l in enumerate(lines):
        if re.match(r"^\s*%s=" % k, l) and (os.environ.get("OVERWRITE") == "1" or not l.split("=", 1)[1].strip()): lines[i] = f"{k}={v}"; break
    else: lines.append(f"{k}={v}")
open(dst, "w").write("\n".join(lines).rstrip("\n") + "\n")
print("    claves: %d añadidas o actualizadas en research/.env: %s" % (len(add), ", ".join(k for k, _ in add) or "ninguna (ya estaban todas)"))
PY
fi
# El motor v2 nunca se enciende en el servidor (si quedó un bloque de una versión anterior, se quita).
ENV_R="$ENV_R" python3 - <<'PY'
import os, re
f = os.environ["ENV_R"]; t = open(f).read()
t2 = re.sub(r"\n?# >>> motor v2 \((?:deploy/motor-v2\.sh|app-engine\.sh)\).*?# <<< motor v2 \((?:deploy/motor-v2\.sh|app-engine\.sh)\)\n?", "\n", t, flags=re.S)
if t2 != t: open(f, "w").write(t2.rstrip("\n") + "\n"); print("    claves: bloque antiguo del motor v2 quitado.")
PY
chown "$APP_USER:$APP_USER" "$ENV_R"; chmod 600 "$ENV_R"

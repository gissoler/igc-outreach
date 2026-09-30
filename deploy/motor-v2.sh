#!/usr/bin/env bash
# Motor de búsqueda v2 en la instancia. Lo llaman setup.sh y actualizar.sh; no hace falta correrlo a mano.
# Idempotente. Hace tres cosas:
#   1. Añade a research/.env las claves de búsqueda que falten (Exa, You, Tavily, Jina…) desde OUTREACH_ENV_FILE
#      (nunca pisa un valor que ya tengas en el servidor).
#   2. Deja un túnel SSH permanente hacia el modelo Qwen3-30B de g355 (servicio outreach-g355-tunnel), si le das
#      OUTREACH_G355_TARGET y OUTREACH_G355_KEY_FILE la primera vez.
#   3. Enciende el motor v2 (bloque marcado en research/.env) solo si el modelo responde por el túnel; si no,
#      lo deja APAGADO y la app sigue con las fuentes de siempre. Apagarlo a la fuerza: OUTREACH_MOTOR=off.
# Uso: la primera vez, con la clave de g355 (la que usas desde tu Mac, mejor una propia y restringida):
#   scp -i LightsailKey.pem ~/.ssh/CLAVE_G355 ubuntu@IP:/tmp/g355.key
#   sudo OUTREACH_G355_TARGET=usuario@host-de-g355 OUTREACH_G355_KEY_FILE=/tmp/g355.key bash /opt/outreach/deploy/actualizar.sh
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/outreach}"; APP_USER="${APP_USER:-outreach}"
ENV_R="$APP_DIR/research/.env"; CONF_DIR="/etc/outreach"; CONF="$CONF_DIR/g355.env"
UNIT="outreach-g355-tunnel"; LOCAL_PORT=18000; REMOTE_PORT=8000
BEGIN="# >>> motor v2 (deploy/motor-v2.sh) — no editar a mano"; END="# <<< motor v2 (deploy/motor-v2.sh)"
[[ $EUID -eq 0 ]] || { echo "Corre esto con sudo."; exit 1; }
[[ -f "$ENV_R" ]] || { echo "motor v2: no existe $ENV_R (corre setup.sh primero)."; exit 1; }
say() { echo "    motor v2: $*"; }

# ── 1. Claves nuevas desde un .env (solo las que falten) ─────────────────────────────────────────
if [[ -n "${OUTREACH_ENV_FILE:-}" && -f "$OUTREACH_ENV_FILE" ]]; then
  ENV_R="$ENV_R" SRC="$OUTREACH_ENV_FILE" python3 - <<'PY'
import os, re
dst, src = os.environ["ENV_R"], os.environ["SRC"]
SKIP = {"RESEARCH_PORT", "RESEARCH_PUBLIC_ORIGIN", "RESEARCH_BROWSER", "NODE_ENV", "ENGINE_V2", "ENGINE_SEARCH_PROVIDERS",
        "ENGINE_MAX_QUERIES", "RESEARCH_RUN_TIMEOUT_MS", "VLLM_CHAT_URL", "VLLM_CHAT_MODEL", "ENGINE_LLM_URL", "ENGINE_LLM_MODEL", "ENGINE_LLM_THINKING"}
def parse(p):
    d = {}
    for l in open(p):
        m = re.match(r"^\s*([A-Z][A-Z0-9_]*)=(.*)$", l.rstrip("\n"))
        if m: d[m.group(1)] = m.group(2)
    return d
have, new = parse(dst), parse(src)
add = [(k, v) for k, v in new.items() if k not in SKIP and v.strip() and not have.get(k, "").strip()]
lines = open(dst).read().splitlines()
for k, v in add:
    for i, l in enumerate(lines):
        if re.match(r"^\s*%s=\s*$" % k, l): lines[i] = f"{k}={v}"; break
    else: lines.append(f"{k}={v}")
open(dst, "w").write("\n".join(lines).rstrip("\n") + "\n")
print("    motor v2: %d claves añadidas a research/.env: %s" % (len(add), ", ".join(k for k, _ in add) or "ninguna"))
PY
fi

# ── 2. Túnel SSH al modelo de g355 ───────────────────────────────────────────────────────────────
if [[ -n "${OUTREACH_G355_TARGET:-}" && -f "${OUTREACH_G355_KEY_FILE:-}" ]]; then
  install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/.ssh"
  install -m 600 -o "$APP_USER" -g "$APP_USER" "$OUTREACH_G355_KEY_FILE" "$APP_DIR/.ssh/g355_key"
  install -d -m 755 "$CONF_DIR"
  printf 'G355_TARGET=%s\n' "$OUTREACH_G355_TARGET" > "$CONF"; chmod 644 "$CONF"
  say "clave y destino de g355 guardados (puedes borrar $OUTREACH_G355_KEY_FILE del servidor)."
fi
if [[ -f "$CONF" && -f "$APP_DIR/.ssh/g355_key" ]]; then
  # shellcheck disable=SC1090
  . "$CONF"
  cat > "/etc/systemd/system/$UNIT.service" <<UNITEOF
[Unit]
Description=IGC Outreach - túnel SSH al modelo de g355 (solo reenvía el puerto del Qwen3-30B)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
ExecStart=/usr/bin/ssh -N -i $APP_DIR/.ssh/g355_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$APP_DIR/.ssh/known_hosts -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o ConnectTimeout=20 -L 127.0.0.1:$LOCAL_PORT:127.0.0.1:$REMOTE_PORT $G355_TARGET
Restart=always
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNITEOF
  systemctl daemon-reload; systemctl enable "$UNIT" >/dev/null 2>&1; systemctl restart "$UNIT"
else
  say "túnel a g355 sin configurar (falta OUTREACH_G355_TARGET / OUTREACH_G355_KEY_FILE la primera vez)."
fi

# ── 3. Encender o apagar el motor v2 en research/.env ────────────────────────────────────────────
strip_block() { ENV_R="$ENV_R" BEGIN="$BEGIN" END="$END" python3 - <<'PY'
import os, re
f, B, E = os.environ["ENV_R"], os.environ["BEGIN"], os.environ["END"]
t = open(f).read(); t2 = re.sub(re.escape(B) + r".*?" + re.escape(E) + r"\n?", "", t, flags=re.S)
if t2 != t: open(f, "w").write(t2.rstrip("\n") + "\n")
PY
}
strip_block
MODEL=""
if [[ "${OUTREACH_MOTOR:-on}" != off && -f "$CONF" ]]; then
  for _ in 1 2 3 4 5 6; do   # el túnel tarda unos segundos en levantar
    MODEL="$(curl -s -m 8 "http://127.0.0.1:$LOCAL_PORT/v1/models" 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null || true)"
    [[ -n "$MODEL" ]] && break; sleep 3
  done
fi
if [[ -n "$MODEL" ]]; then
  if grep -qE '^(ENGINE_V2|VLLM_CHAT_URL|VLLM_CHAT_MODEL|ENGINE_SEARCH_PROVIDERS|ENGINE_MAX_QUERIES|RESEARCH_RUN_TIMEOUT_MS)=.+' "$ENV_R"; then
    say "APAGADO: research/.env ya define ENGINE_*/VLLM_CHAT_*/RESEARCH_RUN_TIMEOUT_MS por su cuenta; bórralas para que lo gestione el script."
  else
    PROV="${OUTREACH_SEARCH_PROVIDERS:-exa,you,tavily,jina}"
    { echo; echo "$BEGIN"; echo "ENGINE_V2=1"; echo "ENGINE_SEARCH_PROVIDERS=$PROV"; echo "ENGINE_MAX_QUERIES=18"
      echo "# El pipeline aborta todo el run a los 180 s por defecto; el motor v2 necesita 2-4 min"; echo "RESEARCH_RUN_TIMEOUT_MS=600000"
      echo "VLLM_CHAT_URL=http://127.0.0.1:$LOCAL_PORT/v1"; echo "VLLM_CHAT_MODEL=$MODEL"; echo "$END"; } >> "$ENV_R"
    chown "$APP_USER:$APP_USER" "$ENV_R"; chmod 600 "$ENV_R"
    say "ENCENDIDO con $MODEL (buscadores: $PROV)."
  fi
else
  say "APAGADO: $([[ "${OUTREACH_MOTOR:-on}" == off ]] && echo 'pedido con OUTREACH_MOTOR=off' || echo 'el modelo de g355 no responde por el túnel. Mira: journalctl -u outreach-g355-tunnel -n 30 --no-pager')."
fi

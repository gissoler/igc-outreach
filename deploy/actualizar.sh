#!/usr/bin/env bash
# Trae la última versión y reinicia.  sudo bash /opt/outreach/deploy/actualizar.sh
set -euo pipefail
APP_DIR="/opt/outreach"
RAMA="${OUTREACH_RAMA:-main}"
[[ $EUID -eq 0 ]] || { echo "Corre esto con sudo."; exit 1; }

# Todo dentro de una función: bash lee el archivo entero antes de ejecutarlo, así el `git reset --hard`
# que reemplaza este mismo archivo no lo rompe a mitad de camino.
main() {
  sudo -u outreach git -C "$APP_DIR" fetch --quiet origin "$RAMA"
  sudo -u outreach git -C "$APP_DIR" reset --hard --quiet "origin/$RAMA"
  sudo -u outreach env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 bash -lc "cd $APP_DIR/research && npm ci --omit=dev --no-audit --no-fund"
  # Si el navegador de la app está encendido (deploy/navegador.sh), baja el Chromium que pida esta versión de Playwright.
  if grep -q '^RESEARCH_BROWSER=on' "$APP_DIR/research/.env" 2>/dev/null; then
    sudo -u outreach bash -lc "cd $APP_DIR/research && npx playwright install chromium" || echo "navegador: no se pudo actualizar Chromium; corre sudo bash $APP_DIR/deploy/navegador.sh"
  fi
  sudo -u outreach bash -lc "cd $APP_DIR/frontend && npm ci --no-audit --no-fund && npm run build"
  sudo -u outreach bash -lc "$APP_DIR/.venv/bin/pip install --quiet -e $APP_DIR/backend"
  # Claves nuevas (Exa, etc.) desde tu .env local, sin pisar las del servidor (ver deploy/claves.sh).
  bash "$APP_DIR/deploy/claves.sh" || echo "claves: no se pudieron fusionar; el servidor sigue con las que tenía."
  # nginx: servir .mjs como JavaScript (worker del lector de PDF). Idempotente; no toca el sitio que certbot editó.
  install -m 644 "$APP_DIR/deploy/nginx-mjs.conf" /etc/nginx/conf.d/outreach-mjs.conf
  nginx -t && systemctl reload nginx || echo "nginx: revisa la configuración (nginx -t)."
  install -m 644 "$APP_DIR/deploy/outreach-research.service" /etc/systemd/system/outreach-research.service
  systemctl daemon-reload
  systemctl restart outreach-research outreach-api
  sleep 3
  for s in outreach-research outreach-api; do
    systemctl is-active --quiet "$s" || { echo "El servicio $s no arrancó. Mira el registro:"; journalctl -u "$s" -n 40 --no-pager; exit 1; }
  done
  echo "Listo. IGC Outreach está corriendo."
}
main "$@"
exit $?

#!/usr/bin/env bash
# Trae la última versión y reinicia.  sudo bash /opt/outreach/deploy/actualizar.sh
set -euo pipefail
APP_DIR="/opt/outreach"
RAMA="${OUTREACH_RAMA:-main}"
[[ $EUID -eq 0 ]] || { echo "Corre esto con sudo."; exit 1; }

sudo -u outreach git -C "$APP_DIR" fetch --quiet origin "$RAMA"
sudo -u outreach git -C "$APP_DIR" reset --hard --quiet "origin/$RAMA"
sudo -u outreach env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 bash -lc "cd $APP_DIR/research && npm ci --omit=dev --no-audit --no-fund"
sudo -u outreach bash -lc "cd $APP_DIR/frontend && npm ci --no-audit --no-fund && npm run build"
sudo -u outreach bash -lc "$APP_DIR/.venv/bin/pip install --quiet -e $APP_DIR/backend"
install -m 644 "$APP_DIR/deploy/outreach-research.service" /etc/systemd/system/outreach-research.service
systemctl daemon-reload
systemctl restart outreach-research outreach-api
sleep 3
for s in outreach-research outreach-api; do
  systemctl is-active --quiet "$s" || { echo "El servicio $s no arrancó. Mira el registro:"; journalctl -u "$s" -n 40 --no-pager; exit 1; }
done
echo "Listo. IGC Outreach está corriendo."

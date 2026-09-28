#!/usr/bin/env bash
# Deja una instancia de Lightsail (Ubuntu 24.04) sirviendo IGC Outreach.
# Puede ser la MISMA instancia de Mentiva: usa otro usuario, otra carpeta,
# otros puertos y su propio sitio de nginx. No toca nada de Mentiva.
#
#   sudo bash deploy/setup.sh outreach.mentiva.co tu@correo.com
#
# Es idempotente: si algo falla a mitad de camino, se arregla y se vuelve a
# correr entero. No borra las bases de datos ni los .env existentes.
#
# Deja instalado: Node 22, Python 3 + venv, nginx, certbot, dos servicios
# systemd (research en :8788 y api en :8000) y el certificado HTTPS.

set -euo pipefail

DOMINIO="${1:-}"
CORREO="${2:-}"
APP_USER="outreach"
APP_DIR="/opt/outreach"
REPO="${OUTREACH_REPO:-https://github.com/gissoler/igc-outreach.git}"
RAMA="${OUTREACH_RAMA:-main}"
PUERTO_RESEARCH=8788
PUERTO_API=8000

[[ $EUID -eq 0 ]] || { echo "Corre esto con sudo."; exit 1; }
[[ -n "$DOMINIO" ]] || { echo "Uso: sudo bash deploy/setup.sh DOMINIO CORREO"; exit 1; }

echo "==> Paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git nginx ufw python3 python3-venv python3-pip build-essential

echo "==> Memoria (swap)"
# Las instancias de 512 MB / 1 GB se quedan sin memoria compilando el frontend.
if [[ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ]] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    Swap de 2 GB creado."
fi

echo "==> Node 22 (obligatorio: research pide >= 22.13 por node:sqlite)"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".").map(Number)[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

echo "==> Puertos"
for par in "outreach-research:$PUERTO_RESEARCH" "outreach-api:$PUERTO_API"; do
  svc="${par%%:*}"; p="${par##*:}"
  systemctl is-active --quiet "$svc" 2>/dev/null && continue   # es nuestro, de una corrida anterior
  if ss -ltn "sport = :$p" | grep -q LISTEN; then
    echo "    El puerto $p ya lo usa otro programa:"; ss -ltnp "sport = :$p"; exit 1
  fi
done

echo "==> Usuario de la aplicación"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

echo "==> Código"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --quiet origin "$RAMA"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard --quiet "origin/$RAMA"
else
  mkdir -p "$APP_DIR"
  chown "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone --quiet --branch "$RAMA" "$REPO" "$APP_DIR"
fi
chmod 755 "$APP_DIR"

echo "==> Variables de entorno"
# research/.env: las claves de Firecrawl, ScrapeGraph, Exa, etc. Nunca van en git.
ENV_R="$APP_DIR/research/.env"
if [[ ! -f "$ENV_R" ]]; then
  if [[ -n "${OUTREACH_ENV_FILE:-}" && -f "$OUTREACH_ENV_FILE" ]]; then
    cp "$OUTREACH_ENV_FILE" "$ENV_R"
    echo "    research/.env copiado desde $OUTREACH_ENV_FILE."
  else
    cp "$APP_DIR/research/.env.example" "$ENV_R"
    echo "    research/.env creado desde .env.example. Llena FIRECRAWL_API_KEY, SGAI_API_KEY, EXA_API_KEY…"
  fi
fi
# Valores de producción (se agregan solo si faltan).
sed -i '/^RESEARCH_PORT=/d' "$ENV_R"; echo "RESEARCH_PORT=$PUERTO_RESEARCH" >> "$ENV_R"
# Sin esto el servidor research solo acepta localhost y responde "Local use only".
ORIGENES="https://$DOMINIO"
[[ "$(tr -cd '.' <<<"$DOMINIO" | wc -c)" -eq 1 ]] && ORIGENES="$ORIGENES,https://www.$DOMINIO"
sed -i '/^RESEARCH_PUBLIC_ORIGIN=/d' "$ENV_R"; echo "RESEARCH_PUBLIC_ORIGIN=$ORIGENES" >> "$ENV_R"
grep -q '^RESEARCH_BROWSER=' "$ENV_R"|| echo "RESEARCH_BROWSER=off" >> "$ENV_R"
grep -q '^NODE_ENV=' "$ENV_R" || echo "NODE_ENV=production" >> "$ENV_R"
chown "$APP_USER:$APP_USER" "$ENV_R"
chmod 600 "$ENV_R"

# backend: config del proyecto (si no existe, arranca con el ejemplo).
for f in project rounds; do
  [[ -f "$APP_DIR/backend/config/$f.yaml" ]] || sudo -u "$APP_USER" cp "$APP_DIR/backend/config/$f.example.yaml" "$APP_DIR/backend/config/$f.yaml"
done
sudo -u "$APP_USER" mkdir -p "$APP_DIR/backend/data" "$APP_DIR/backend/out" "$APP_DIR/backend/exports" "$APP_DIR/research/data"

echo "==> Instalar y construir"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
sudo -u "$APP_USER" env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 bash -lc "cd $APP_DIR/research && npm ci --omit=dev --no-audit --no-fund"
sudo -u "$APP_USER" bash -lc "cd $APP_DIR/frontend && npm ci --no-audit --no-fund && npm run build"
[[ -x "$APP_DIR/.venv/bin/python" ]] || sudo -u "$APP_USER" python3 -m venv "$APP_DIR/.venv"
sudo -u "$APP_USER" bash -lc "$APP_DIR/.venv/bin/pip install --quiet --upgrade pip && $APP_DIR/.venv/bin/pip install --quiet -e $APP_DIR/backend"

echo "==> Servicios"
install -m 644 "$APP_DIR/deploy/outreach-research.service" /etc/systemd/system/outreach-research.service
sed "s#DOMINIO#$DOMINIO#g" "$APP_DIR/deploy/outreach-api.service" > /etc/systemd/system/outreach-api.service
chmod 644 /etc/systemd/system/outreach-api.service
systemctl daemon-reload
systemctl enable outreach-research outreach-api
systemctl restart outreach-research outreach-api

echo "==> nginx"
sed "s/DOMINIO/$DOMINIO/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/outreach
ln -sf /etc/nginx/sites-available/outreach /etc/nginx/sites-enabled/outreach
# Solo quitamos el sitio por defecto; el de Mentiva (si existe) se queda como está.
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "==> HTTPS"
if [[ -n "$CORREO" ]]; then
  apt-get install -y -qq certbot python3-certbot-nginx
  DOMS=(-d "$DOMINIO")
  # www solo para dominios raíz (ej. igcoutreach.com), no para subdominios (outreach.mentiva.co).
  [[ "$(tr -cd '.' <<<"$DOMINIO" | wc -c)" -eq 1 ]] && DOMS+=(-d "www.$DOMINIO")
  certbot --nginx "${DOMS[@]}" --non-interactive --agree-tos -m "$CORREO" --redirect || \
    echo "    certbot falló. Revisa que el DNS de $DOMINIO ya apunte a esta IP y vuelve a correr el script."
else
  echo "    Sin correo, se saltó el certificado. Corre el script otra vez con el correo cuando el DNS esté listo."
fi

sleep 3
for s in outreach-research outreach-api; do
  systemctl is-active --quiet "$s" || { echo "El servicio $s no arrancó:"; journalctl -u "$s" -n 40 --no-pager; exit 1; }
done

echo
echo "==================================================================="
echo " IGC Outreach está sirviendo en https://$DOMINIO"
echo
if ! grep -q '^FIRECRAWL_API_KEY=.\+' "$ENV_R"; then
  echo " FALTA: pon tus claves en $ENV_R y luego:"
  echo "        sudo systemctl restart outreach-research"
  echo
fi
echo " Estado:     systemctl status outreach-research outreach-api"
echo " Registro:   journalctl -u outreach-research -f"
echo " Actualizar: sudo bash $APP_DIR/deploy/actualizar.sh"
echo "==================================================================="

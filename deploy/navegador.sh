#!/usr/bin/env bash
# Instala Chromium en la instancia de Lightsail y enciende el navegador dentro de la app
# (pestaña "Official page": los sitios que no se dejan embeber se abren solos en el navegador remoto).
#   sudo bash /opt/outreach/deploy/navegador.sh          # instalar y encender
#   sudo bash /opt/outreach/deploy/navegador.sh off      # apagar (no desinstala)
# Idempotente: se puede correr varias veces. actualizar.sh lo vuelve a sincronizar si ya está encendido.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/outreach}"; APP_USER="${APP_USER:-outreach}"; ENV_R="$APP_DIR/research/.env"
[[ $EUID -eq 0 ]] || { echo "Corre esto con sudo."; exit 1; }
[[ -f "$ENV_R" ]] || { echo "No existe $ENV_R (corre setup.sh primero)."; exit 1; }

set_browser() {
  if grep -q '^RESEARCH_BROWSER=' "$ENV_R"; then sed -i "s/^RESEARCH_BROWSER=.*/RESEARCH_BROWSER=$1/" "$ENV_R"; else echo "RESEARCH_BROWSER=$1" >> "$ENV_R"; fi
  chown "$APP_USER:$APP_USER" "$ENV_R"; chmod 600 "$ENV_R"
}

if [[ "${1:-on}" == "off" ]]; then
  set_browser off; systemctl restart outreach-research; echo "Navegador apagado."; exit 0
fi

main() {
  # 1) Memoria: Chromium necesita ~300-500 MB. En instancias de 1 GB se añade 2 GB de swap (una sola vez).
  local mem_mb; mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if (( mem_mb < 2048 )) && ! swapon --show | grep -q '/swapfile'; then
    echo "==> RAM ${mem_mb} MB: creando 2 GB de swap"
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile; mkswap /swapfile >/dev/null; swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  # 2) Librerías del sistema que necesita Chromium (apt; por eso va como root).
  echo "==> Librerías del sistema para Chromium"
  (cd "$APP_DIR/research" && npx --yes playwright install-deps chromium)
  # 3) El binario de Chromium, en la caché del usuario que corre el servicio (misma versión que el Playwright del proyecto).
  echo "==> Chromium para el usuario $APP_USER"
  sudo -u "$APP_USER" bash -lc "cd $APP_DIR/research && npx playwright install chromium"
  # 4) Encender y reiniciar.
  set_browser on
  systemctl restart outreach-research
  sleep 3
  systemctl is-active --quiet outreach-research || { echo "El servicio no arrancó:"; journalctl -u outreach-research -n 40 --no-pager; exit 1; }
  # 5) Prueba real: arrancar Chromium con el mismo Playwright del proyecto.
  sudo -u "$APP_USER" bash -lc "cd $APP_DIR/research && node -e \"import('playwright').then(async ({chromium}) => { const b = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] }); console.log('Chromium OK', b.version()); await b.close(); }).catch((e) => { console.error('Chromium FALLÓ:', e.message.split('\\\\n')[0]); process.exit(1); })\""
  echo "Listo: RESEARCH_BROWSER=on. Las páginas que no se dejan embeber se abren solas en el navegador de la app."
}
main "$@"

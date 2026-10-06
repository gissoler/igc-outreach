#!/usr/bin/env bash
# Desde tu Mac: sube tus claves nuevas y actualiza la instancia de Amazon. Es lo único que tienes que correr.
#   bash deploy/desplegar.sh
# Antes: haz commit y push (el servidor baja el código de GitHub). Variables opcionales:
#   OUTREACH_SSH=aws (alias de ~/.ssh/config; es el valor por defecto si existe) o ubuntu@3.145.175.110   LIGHTSAIL_KEY=/ruta/clave.pem   OUTREACH_ENV=research/.env
# Las claves viajan por scp hacia /tmp del servidor, se fusionan con las del servidor (las tuyas reemplazan a las suyas, salvo lo que es solo de tu Mac) y se borran.
set -uo pipefail
cd "$(dirname "$0")/.."
DEST="${OUTREACH_SSH:-}"; ENVF="${OUTREACH_ENV:-research/.env}"; KEY="${LIGHTSAIL_KEY:-}"
# Si corriste  bash deploy/ssh-aws.sh  una vez, existe el alias "aws" en ~/.ssh/config y se usa solo.
if [[ -z "$DEST" ]]; then
  if grep -qsE '^[[:space:]]*Host[[:space:]]+aws([[:space:]]|$)' "$HOME/.ssh/config"; then DEST=aws; else DEST=ubuntu@3.145.175.110; fi
fi
KEYARGS=()
if [[ "$DEST" == *@* ]]; then   # usuario@IP: hace falta el .pem (un alias de ~/.ssh/config ya trae el suyo)
  if [[ -z "$KEY" ]]; then
    for c in ./LightsailKey.pem ./LightsailDefaultKey-us-east-2.pem "$HOME/.ssh/LightsailDefaultKey-us-east-2.pem" "$HOME/.ssh/LightsailKey.pem" "$HOME/Downloads/LightsailDefaultKey-us-east-2.pem" "$HOME/Downloads/LightsailKey.pem" "$HOME/Documents/LightsailKey.pem"; do [[ -f "$c" ]] && KEY="$c" && break; done
  fi
  [[ -n "$KEY" && -f "$KEY" ]] || { echo "No encuentro la clave .pem de Lightsail. Corre  bash deploy/ssh-aws.sh  una vez, o pásala así:  LIGHTSAIL_KEY=/ruta/clave.pem bash deploy/desplegar.sh"; exit 1; }
  chmod 400 "$KEY" 2>/dev/null || true
  KEYARGS=(-i "$KEY")
fi
[[ -f "$ENVF" ]] || { echo "No existe $ENVF"; exit 1; }

# El servidor baja el código de GitHub: si no está subido, no se desplegaría lo último.
if [[ -n "$(git status --porcelain 2>/dev/null | grep -v '^??')" ]]; then echo "Hay cambios sin commit. Haz commit y push antes de desplegar."; exit 1; fi
git fetch --quiet origin main 2>/dev/null || true
AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
[[ "$AHEAD" == 0 ]] || { echo "Hay $AHEAD commit(s) sin subir a GitHub. Corre  git push  y repite."; exit 1; }

# Tu .env local manda: sus valores reemplazan a los del servidor (copia en .env.bak). Para solo añadir las que falten: OUTREACH_ENV_KEEP=1
OVERWRITE=1; [[ "${OUTREACH_ENV_KEEP:-0}" == 1 ]] && OVERWRITE=0
SSH=(ssh ${KEYARGS[@]+"${KEYARGS[@]}"} -o StrictHostKeyChecking=accept-new "$DEST")
echo "==> Subiendo claves a $DEST"
scp -q ${KEYARGS[@]+"${KEYARGS[@]}"} -o StrictHostKeyChecking=accept-new "$ENVF" "$DEST:/tmp/outreach.env" || { echo "No pude copiar el archivo (¿IP, usuario o clave?)."; exit 1; }
echo "==> Actualizando el servidor"
# Trae el código primero por separado: así el actualizar.sh que se ejecuta ya es el nuevo.
"${SSH[@]}" 'set -e; trap "rm -f /tmp/outreach.env" EXIT
  chmod 600 /tmp/outreach.env
  sudo -u outreach git -C /opt/outreach fetch --quiet origin main
  sudo -u outreach git -C /opt/outreach reset --hard --quiet origin/main
  sudo OUTREACH_ENV_FILE=/tmp/outreach.env OUTREACH_ENV_OVERWRITE=$OVERWRITE bash /opt/outreach/deploy/actualizar.sh'
RC=$?
[[ $RC == 0 ]] && echo "==> Listo." || echo "==> Falló (código $RC). Mira el mensaje de arriba."
exit $RC

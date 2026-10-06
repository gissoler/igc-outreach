#!/usr/bin/env bash
# Una sola vez, desde tu Mac:  bash deploy/ssh-aws.sh [/ruta/LightsailDefaultKey-us-east-2.pem]
# Deja listo  ssh aws  (como ya haces con  ssh voltage-park): MUEVE la clave a ~/.ssh (no queda copia donde estaba) con permisos 400 y
# añade el bloque "Host aws" a ~/.ssh/config. Después  bash deploy/desplegar.sh  usa ese alias solo.
# La clave no se guarda en el repo (.gitignore ya excluye *.pem).
set -uo pipefail
HOST_IP="${AWS_HOST:-3.145.175.110}"; USER_NAME="${AWS_USER:-ubuntu}"; KEYNAME="LightsailDefaultKey-us-east-2.pem"
SRC="${1:-}"
if [[ -z "$SRC" ]]; then
  for c in "$HOME/.ssh/$KEYNAME" "$HOME/Downloads/$KEYNAME" "$HOME/Documents/$KEYNAME" "$HOME/Desktop/$KEYNAME" "./$KEYNAME" "$HOME/.ssh/LightsailKey.pem" "$HOME/Downloads/LightsailKey.pem"; do [[ -f "$c" ]] && SRC="$c" && break; done
fi
[[ -n "$SRC" && -f "$SRC" ]] || { echo "No encuentro la clave. Pásala así:  bash deploy/ssh-aws.sh /ruta/$KEYNAME"; exit 1; }
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
DST="$HOME/.ssh/$(basename "$SRC")"
if [[ "$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")" != "$DST" ]]; then
  chmod 600 "$DST" 2>/dev/null || true   # por si ya había una copia de solo lectura
  mv -f "$SRC" "$DST" && echo "Clave movida de $SRC a $DST (ya no queda en la carpeta original)."
fi
chmod 400 "$DST"
CFG="$HOME/.ssh/config"; touch "$CFG"; chmod 600 "$CFG"
if grep -qE '^[[:space:]]*Host[[:space:]]+aws([[:space:]]|$)' "$CFG"; then
  echo "Ya existe  Host aws  en $CFG; no lo toco."
else
  cp -p "$CFG" "$CFG.bak-aws" 2>/dev/null || true
  printf '\n# IGC Outreach (Lightsail)\nHost aws\n  HostName %s\n  User %s\n  IdentityFile %s\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n' "$HOST_IP" "$USER_NAME" "$DST" >> "$CFG"
  echo "Añadido  Host aws  a $CFG"
fi
echo "Probando la conexión…"
if ssh -o BatchMode=yes -o ConnectTimeout=10 aws 'echo conectado a $(hostname)'; then
  echo "Listo. Desde ahora:  ssh aws   y   bash deploy/desplegar.sh"
else
  echo "No pude conectar. Revisa que la instancia esté encendida y el puerto 22 abierto en Lightsail (IP $HOST_IP)."; exit 1
fi

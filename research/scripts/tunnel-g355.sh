#!/usr/bin/env bash
# Túnel SSH manual desde tu Mac al Qwen3-30B YA cargado en g355 (127.0.0.1:18000 → g355:8000). Normalmente no hace falta:
# app-motor.sh lo abre solo.
HOST="${G355_HOST:-voltage-park}"
echo "Túnel: 18000 → Qwen3-30B  (Ctrl-C para cerrar)"
exec ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -L 127.0.0.1:18000:127.0.0.1:8000 "$HOST"

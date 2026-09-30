# Desplegar IGC Outreach en Lightsail

Mismo esquema que Mentiva: un `setup.sh` idempotente y un `actualizar.sh`. Puede ir en la
misma instancia de Mentiva (usuario `outreach`, carpeta `/opt/outreach`, puertos 8788 y 8000,
sitio de nginx propio) o en una nueva.

```
navegador ─https─> nginx ─┬─ /                → frontend/dist (estático)
                          ├─ /api/research/*  → research  :8788  (node, SQLite)
                          └─ /api/*           → warmpath  :8000  (FastAPI, DuckDB)
```

## Primera vez

1. **Sube el código a GitHub** (la carpeta ya es un repo con su primer commit; el `.gitignore` deja fuera `.env`,
   bases de datos, `backend/data/`, `Stuff/` y los resultados de evaluación):

   ```bash
   git remote add origin https://github.com/gissoler/igc-outreach.git   # créalo privado antes
   git push -u origin main
   ```

   Si el repo es privado, en el servidor usa una URL con token o una deploy key.

2. **DNS**: crea un registro A `outreach.tudominio.com` → IP estática de la instancia.

3. **Pasa tus claves** (Firecrawl, ScrapeGraph, Exa…) sin meterlas en git:

   ```bash
   scp -i LightsailKey.pem research/.env ubuntu@IP:/tmp/outreach.env
   ```

4. **En el servidor**:

   ```bash
   git clone https://github.com/gissoler/igc-outreach.git /tmp/outreach
   sudo OUTREACH_REPO=https://github.com/gissoler/igc-outreach.git \
        OUTREACH_ENV_FILE=/tmp/outreach.env \
        bash /tmp/outreach/deploy/setup.sh outreach.tudominio.com tu@correo.com
   rm /tmp/outreach.env
   ```

   El script agrega solo lo de producción al `.env` (`RESEARCH_PUBLIC_ORIGIN`, `RESEARCH_PORT`,
   `RESEARCH_BROWSER=off`). Sin `RESEARCH_PUBLIC_ORIGIN` el servidor research responde
   "Local use only", porque por defecto solo acepta localhost.

5. En Lightsail → Networking, abre el puerto **443** (HTTPS). El 80 y el 22 ya vienen abiertos.

## Actualizar

```bash
sudo bash /opt/outreach/deploy/actualizar.sh
```

Trae la última versión, instala, construye, configura el motor de búsqueda v2 (abajo) y reinicia.

## Motor de búsqueda v2 (Exa, You.com, Tavily, Jina + Qwen3-30B de g355)

`setup.sh` y `actualizar.sh` llaman a `deploy/motor-v2.sh`, que es idempotente y hace tres cosas:

1. **Claves nuevas:** si pasas `OUTREACH_ENV_FILE`, añade a `research/.env` las que falten (nunca pisa las que ya hay).
2. **Túnel al modelo:** servicio `outreach-g355-tunnel` (SSH, solo reenvía `127.0.0.1:18000` → puerto 8000 de g355).
3. **Enciende el motor solo si el modelo responde por el túnel**; si no, lo deja apagado y la app sigue con las fuentes de siempre.

La primera vez, con la clave SSH de g355 (de preferencia una propia y restringida):

```bash
scp -i LightsailKey.pem research/.env ubuntu@IP:/tmp/outreach.env
scp -i LightsailKey.pem ~/.ssh/CLAVE_G355 ubuntu@IP:/tmp/g355.key
# en el servidor:
sudo OUTREACH_ENV_FILE=/tmp/outreach.env \
     OUTREACH_G355_TARGET=usuario@host-de-g355 OUTREACH_G355_KEY_FILE=/tmp/g355.key \
     bash /opt/outreach/deploy/actualizar.sh
rm /tmp/outreach.env /tmp/g355.key
```

Las siguientes veces basta `sudo bash /opt/outreach/deploy/actualizar.sh`. Para apagar el motor: `sudo OUTREACH_MOTOR=off bash /opt/outreach/deploy/actualizar.sh`.

- g355 es una máquina compartida: en su `authorized_keys` conviene limitar esa clave a `restrict,port-forwarding,permitopen="127.0.0.1:8000"` para que solo pueda abrir ese túnel.
- La instancia tiene que poder llegar por SSH a g355. Si g355 solo es accesible por VPN o desde tu red, el túnel no levantará y el motor quedará apagado (`journalctl -u outreach-g355-tunnel -n 30`).
- Cada búsqueda con el motor tarda 2-4 min; el script sube el límite del run a 10 min (`RESEARCH_RUN_TIMEOUT_MS`).
- Linkup está fuera de la lista por defecto (sin saldo). Para incluirlo: `OUTREACH_SEARCH_PROVIDERS=linkup,exa,you,tavily,jina`.

## Operación

| Qué | Comando |
|---|---|
| Estado | `systemctl status outreach-research outreach-api` |
| Logs | `journalctl -u outreach-research -f` |
| Cambiar claves | `sudo nano /opt/outreach/research/.env && sudo systemctl restart outreach-research` |
| Backup de cuentas | `sudo cp /opt/outreach/research/data/research.sqlite ~/backup-$(date +%F).sqlite` |

Notas:
- La base de cuentas (`research/data/research.sqlite`) empieza vacía en el servidor: cada
  persona se registra de nuevo. No se sube la local.
- Las cookies de sesión salen con `Secure`, así que el login solo funciona por HTTPS.
- El navegador en vivo (Playwright) queda apagado. Para activarlo:
  `sudo -u outreach bash -lc "cd /opt/outreach/research && npx playwright install --with-deps chromium"`
  (el `--with-deps` necesita sudo) y cambia `RESEARCH_BROWSER=off` en el `.env`.
- En instancias de 1 GB el script crea 2 GB de swap para que compile el frontend.

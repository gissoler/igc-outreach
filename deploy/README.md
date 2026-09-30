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

## Actualizar (y subir claves nuevas)

Desde tu Mac, después de `git push`:

```bash
bash deploy/desplegar.sh
```

Copia tu `research/.env` al servidor, trae el código de GitHub, instala, construye y reinicia. Las claves que ya tiene el
servidor no se pisan; solo se añaden las que falten (`deploy/claves.sh`). No copia lo que es de tu Mac (puerto, dominio,
`ENGINE_*`, `VLLM_*`, rutas y URLs locales). El archivo temporal se borra del servidor al terminar.
Si no encuentra tu `.pem`: `LIGHTSAIL_KEY=/ruta/LightsailKey.pem bash deploy/desplegar.sh`.
También puedes hacerlo a mano en el servidor: `sudo bash /opt/outreach/deploy/actualizar.sh`.

En AWS solo corren el front y el back. El motor de búsqueda v2 y los modelos de g355 se usan desde tu Mac
(`bash research/scripts/app-motor.sh`), no desde la instancia.

Dominio de esta instancia: `3-145-175-110.nip.io` (para una instalación nueva: `sudo bash deploy/setup.sh 3-145-175-110.nip.io tu@correo.com`).

## Operación

| Qué | Comando |
|---|---|
| Estado | `systemctl status outreach-research outreach-api` |
| Logs | `journalctl -u outreach-research -f` |
| Cambiar claves | `sudo nano /opt/outreach/research/.env && sudo systemctl restart outreach-research` |
| Backup de cuentas | `sudo cp /opt/outreach/research/data/research.sqlite ~/backup-$(date +%F).sqlite` |

Notas:
- La base (`research/data/research.sqlite`) empieza vacía en el servidor: cada navegador abre su propio
  espacio de trabajo, sin inicio de sesión. No se sube la local.
- Las cookies de sesión salen con `Secure`, así que la app solo funciona por HTTPS.
- No hay inicio de sesión: quien tenga la URL puede abrir su propio espacio y gastar tus claves de búsqueda. Si no quieres eso, ponle contraseña a nginx (basic auth) o limita la URL.
- El navegador en vivo (Playwright) queda apagado. Para activarlo:
  `sudo -u outreach bash -lc "cd /opt/outreach/research && npx playwright install --with-deps chromium"`
  (el `--with-deps` necesita sudo) y cambia `RESEARCH_BROWSER=off` en el `.env`.
- En instancias de 1 GB el script crea 2 GB de swap para que compile el frontend.

# Runbook de Apollo (solo lectura)

## 1. Crear una clave mínima

En Apollo, crea una API key con los scopes de salud/autenticación, estadísticas de créditos y API, búsqueda de organizaciones y people search. Evita una master key salvo que Apollo demuestre que un endpoint requerido la necesita. No habilites contactos, secuencias, emails, tareas ni operaciones de escritura.

Guarda la clave solo en `research/.env`:

```dotenv
APOLLO_ENABLED=0
APOLLO_API_KEY=...
APOLLO_PREFLIGHT_DOMAIN=apollo.io
```

Nunca uses variables `VITE_*`, no copies la clave al frontend y no la incluyas en tickets o reportes.

## 2. Ejecutar el preflight

Desde `research/`:

```bash
npm run preflight:apollo -- --as-of YYYY-MM-DD --domain dominio-oficial.example --out artifacts/apollo-preflight.json
```

La prueba hace únicamente:

1. `GET /auth/health`;
2. estadísticas de créditos y límites;
3. una página mínima de organization search;
4. una búsqueda mínima de persona por dominio/organización.

Según la documentación oficial consultada el 08/10/2026, organization search consume 1 crédito por página y people search 0. Confirma el consumo real en el reporte de Apollo porque planes legacy pueden diferir. El preflight no enriquece emails o teléfonos.

## 3. Interpretar estados

- `connected`: autenticación, cuota/límites y búsquedas mínimas disponibles.
- `connected_limited`: conexión válida con algún límite no bloqueante.
- `not_configured`: falta clave.
- `authentication_failed`: clave inválida o cuenta inactiva.
- `insufficient_credits`: Apollo rechazó por créditos.
- `quota_unknown`: la conexión funciona pero el endpoint oficial de crédito no está disponible.
- `unsupported_by_plan`: el plan o scope bloquea un endpoint requerido.
- `error`: fallo no clasificado.

No infieras saldo si Apollo no lo devuelve.

## 4. Activar producción

Solo después de revisar el preflight:

```dotenv
APOLLO_ENABLED=1
APOLLO_MAX_CREDITS_PER_RUN=8
APOLLO_MAX_CREDITS_PER_ORG=3
APOLLO_MAX_CREDITS_PER_DAY=30
APOLLO_MAX_ORGS_PER_RUN=3
APOLLO_PEOPLE_PER_ORG=5
APOLLO_CACHE_TTL_HOURS=24
```

Apollo se ejecuta después del ranking de organizaciones y no lo modifica. Reiniciar el proceso vacía la caché y el contador diario en memoria; antes de escalar volumen debe migrarse el ledger a almacenamiento persistente compartido.

## 5. Apagar y responder a incidentes

Pon `APOLLO_ENABLED=0` y reinicia el servicio. Rota la clave en Apollo si sospechas exposición. El resto de la investigación continúa con páginas oficiales, fuentes web, Hunter/Apify configurados y red autorizada.

No envíes mensajes, no crees campañas y no trates un perfil o email de Apollo como warm path.

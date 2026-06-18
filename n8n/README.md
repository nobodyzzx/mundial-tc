# Workflows de n8n (fuente versionada)

Automatizaciones de WhatsApp/Telegram de la Polla, alojadas en n8n self-hosted
(`n8n.tecnocondor.dev`). Estos JSON son la **fuente de verdad**: editar aquí,
commitear, y luego en n8n usar **`⋮` → Import from File** para aplicar.

> Importar **reemplaza** el contenido del workflow abierto. La importación NO trae
> las credenciales: hay que reasignarlas a cada nodo HTTP/Telegram tras importar.

## Workflows

| Archivo | Workflow en n8n | Cron | Endpoints / acción |
|---|---|---|---|
| `workflows/polla-sync.json` | Polla · sync marcadores | `* * * * *` (1 min) | `sync` — único que llama a ESPN; gatea por ventana de partido |
| `workflows/polla-cada-5-min.json` | Polla · cada 5 min | `*/5 * * * *` | `dia-pronosticos`, `resumen-dia`, `jornada-reminder`, `standings-announce` |
| `workflows/polla-cada-10-min.json` | Polla · cada 10 min | `*/10 * * * *` | `jornada-abierta`, `tarjetas-aviso` |
| `workflows/polla-alertas-error.json` | Polla · alertas de error | Error Trigger | avisa por Telegram cuando otro workflow falla |

## Credenciales a reasignar tras importar

- Nodos HTTP → **Bearer Auth** `polla CRON-SECRET` (token crudo = `CRON_SECRET`).
- Nodo Telegram → credencial **Telegram API** del bot de alertas.

## ⚠️ Al crear/importar un workflow nuevo: conectarlo a las alertas

El Error Trigger de `polla-alertas-error.json` SOLO se dispara para workflows que lo
tengan marcado como su *Error Workflow*. En cada workflow de producción:

**Settings (engranaje) → Error Workflow → "Polla · alertas de error" → guardar/publicar.**

Si te olvidas de este paso en un workflow nuevo, sus fallos pasarán silenciosos.

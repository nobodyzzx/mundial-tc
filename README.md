# Polla Mundial 2026

App web de pronósticos para el Mundial FIFA 2026. Los jugadores predicen marcadores antes de cada partido y acumulan puntos según la precisión de sus pronósticos.

**[mundial.tecnocondor.dev](https://mundial.tecnocondor.dev)**

---

## Características

- Pronósticos de marcador por partido (fase de grupos y eliminatorias)
- Tabla de posiciones en tiempo real
- Sistema de pagos con seguimiento de inscripciones (70 Bs + 50 Bs)
- Panel de administración para referís (resultados, pagos, sanciones)
- Notificaciones automáticas por WhatsApp vía n8n
- Autenticación por email con Supabase Auth

---

## Sistema de puntos

### Fase de grupos

| Acierto | Puntos |
|---------|--------|
| Marcador exacto | 3 |
| Ganador / empate correcto | 1 |

### Fase eliminatoria — sin penales

| Acierto | Puntos |
|---------|--------|
| Marcador exacto | 3 |
| Ganador correcto | 1 |
| No acertó ganador | 0 |

### Fase eliminatoria — definición por penales *(empate en 120')*

> Si el jugador no pronosticó empate recibe 0 puntos automáticamente.

| Acierto | Puntos |
|---------|--------|
| Marcador 90' exacto + marcador penales exacto | 6 |
| Marcador 90' exacto + clasificado correcto | 4 |
| Marcador 90' no exacto + clasificado correcto | 2 |
| Marcador 90' no exacto + clasificado incorrecto | 1 |

> **Regla de jornada completa:** si el jugador no pronostica todos los partidos de una jornada, sus puntos de esa jornada se anulan.

---

## El pozo

La inscripción es de **120 Bs** en dos cuotas:

| Cuota | Monto | Efecto |
|-------|-------|--------|
| 1er pago | 70 Bs | Habilita pronósticos |
| 2do pago | 50 Bs | Participación completa en el pozo |

De cada pago, **20 Bs van al réferi** y el resto al pozo (hasta 100 Bs por jugador). El jugador con más puntos al final se lleva todo el pozo.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | [Astro 6](https://astro.build) (SSR) |
| Estilos | Tailwind CSS 4 |
| Base de datos | [Supabase](https://supabase.com) — PostgreSQL + Auth + RLS |
| Deploy | [Vercel](https://vercel.com) |
| Fixtures | [football-data.org](https://www.football-data.org) |
| Automatizaciones | n8n (mensajes WhatsApp diarios) |

---

## Desarrollo local

```bash
pnpm install
pnpm dev
```

Variables de entorno requeridas en `.env`:

```env
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
FOOTBALL_API_KEY=
TOURNAMENT_CODE=WC
TOURNAMENT_SEASON=2026
CRON_SECRET=
PUBLIC_BETA=true
```

---

## Estructura del proyecto

```
src/
├── pages/
│   ├── index.astro              # Landing pública
│   ├── dashboard.astro          # App principal (requiere auth)
│   ├── perfil.astro             # Perfil del usuario
│   ├── pago.astro               # Info e instrucciones de pago
│   ├── admin/                   # Panel de administración
│   └── api/
│       ├── auth/                # login, logout, reset
│       ├── admin/               # pagos, resultados, usuarios
│       ├── predictions/         # submit de pronósticos
│       └── cron/                # mensajes automáticos
├── layouts/
│   └── Layout.astro
└── lib/
    ├── supabase.ts              # Cliente Supabase
    └── betaTime.ts              # Offset para testing de fechas
```

---

## Deploy

Cada push a `main` dispara un deploy automático en Vercel.

```bash
git push  # → Vercel deploy automático
```

---

## Documentación

Ver carpeta [`docs/`](./docs):

- [`01-overview.md`](./docs/01-overview.md) — Resumen del sistema
- [`02-admin.md`](./docs/02-admin.md) — Manual del referí/admin
- [`03-jugadores.md`](./docs/03-jugadores.md) — Guía para jugadores
- [`04-ops.md`](./docs/04-ops.md) — Operaciones y mantenimiento

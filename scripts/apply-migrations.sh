#!/usr/bin/env bash
# Aplica todas las migraciones SQL a una BD Supabase nueva.
# Requiere psql instalado y la URL de conexión directa del proyecto.
#
# Uso:
#   DATABASE_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres" \
#     bash scripts/apply-migrations.sh
#
# La URL directa está en: Supabase Dashboard → Settings → Database → Connection String (URI)

set -euo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"
DB_URL="${DATABASE_URL:-}"

if [ -z "$DB_URL" ]; then
  # Intentar leer de .env.test
  if [ -f "$(dirname "$0")/../.env.test" ]; then
    DB_URL=$(grep '^TEST_DATABASE_URL=' "$(dirname "$0")/../.env.test" | cut -d'=' -f2-)
  fi
fi

if [ -z "$DB_URL" ]; then
  echo "Error: DATABASE_URL no configurada."
  echo ""
  echo "Opción 1: exportar antes de ejecutar"
  echo "  export DATABASE_URL='postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres'"
  echo "  bash scripts/apply-migrations.sh"
  echo ""
  echo "Opción 2: agregar TEST_DATABASE_URL en .env.test"
  exit 1
fi

echo "[migrations] Aplicando $(ls "$MIGRATIONS_DIR"/*.sql | wc -l) migraciones..."
echo ""

for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  name=$(basename "$f")
  echo "[migrations] → $name"
  psql "$DB_URL" -q -f "$f" 2>&1 | sed 's/^/             /'
done

echo ""
echo "[migrations] ✓ Todas las migraciones aplicadas."

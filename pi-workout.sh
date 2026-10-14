#!/usr/bin/env bash
set -euo pipefail
WORKOUT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${PI_BIN:-}" ]]; then
  WORKOUT_PI="$PI_BIN"
elif command -v pi >/dev/null 2>&1; then
  WORKOUT_PI="$(command -v pi)"
elif [[ -x "$WORKOUT_ROOT/node_modules/.bin/pi" ]]; then
  WORKOUT_PI="$WORKOUT_ROOT/node_modules/.bin/pi"
else
  echo "Install Pi or run npm install --ignore-scripts in $WORKOUT_ROOT." >&2
  exit 1
fi
if [[ -z "${PI_WORKOUT_DATA_DIR:-}" && -d "$WORKOUT_ROOT/.local/.venv" ]]; then
  export PI_WORKOUT_DATA_DIR="$WORKOUT_ROOT/.local"
fi
exec "$WORKOUT_PI" --extension "$WORKOUT_ROOT/extensions/index.ts" "$@"

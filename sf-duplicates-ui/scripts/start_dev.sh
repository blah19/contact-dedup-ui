#!/usr/bin/env bash
set -euo pipefail
# Start the dev server with all necessary VITE_* env vars wired from .env/.env.local
# - sources .env and .env.local if present
# - derives VITE_SF_INSTANCE, VITE_SF_CLIENT_ID, VITE_SF_REDIRECT_URI from available vars
# - if PORT is not set, tries to extract it from VITE_SF_REDIRECT_URI, otherwise defaults to 5173

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . .env; set +a
fi
if [ -f .env.local ]; then
  # shellcheck disable=SC1091
  set -a; . .env.local; set +a
fi

# Derive VITE_ values from existing variables if not explicitly set
: "${VITE_SF_INSTANCE:=${AUTH_DOMAIN:-${SF_INSTANCE:-${VITE_SF_INSTANCE:-}}}}"
: "${VITE_SF_CLIENT_ID:=${CLIENT_ID:-${VITE_SF_CLIENT_ID:-}}}"
: "${VITE_SF_REDIRECT_URI:=${REDIRECT_URI:-${VITE_SF_REDIRECT_URI:-}}}"

export VITE_SF_INSTANCE VITE_SF_CLIENT_ID VITE_SF_REDIRECT_URI

# If PORT not provided, try to extract from redirect URI (e.g. http://localhost:53682/...)
if [ -z "${PORT:-}" ]; then
  if [[ "${VITE_SF_REDIRECT_URI:-}" =~ :([0-9]+) ]]; then
    PORT="${BASH_REMATCH[1]}"
  else
    PORT=5173
  fi
fi
export PORT

echo "Starting dev server with:"
echo "  PORT=$PORT"
echo "  VITE_SF_INSTANCE=$VITE_SF_INSTANCE"
echo "  VITE_SF_CLIENT_ID=$VITE_SF_CLIENT_ID"
echo "  VITE_SF_REDIRECT_URI=$VITE_SF_REDIRECT_URI"

# Kill stale dev servers on common ports and the target port so the callback URI can be served.
ports_to_check=(5173 5174 5175 5176 5177 5178 "$PORT")
echo "Checking for existing processes on ports: ${ports_to_check[*]}"
for p in "${ports_to_check[@]}"; do
  # skip empty
  if [ -z "$p" ]; then
    continue
  fi
  # find pids listening on the port
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti :$p || true)
  else
    # fallback to ss
    pids=$(ss -ltnp 2>/dev/null | awk -v port=":$p" '$0 ~ port {print $0}' | sed -n 's/.*pid=\([0-9]*\),.*/\1/p' | tr '\n' ' ')
  fi
  if [ -n "$pids" ]; then
    echo "Found processes on port $p: $pids"
    for pid in $pids; do
      # don't kill our own shell
      if [ "$pid" = "$$" ]; then
        continue
      fi
      echo "Stopping PID $pid (port $p)"
      kill "$pid" || true
      # wait up to 5s for it to exit
      for i in 1 2 3 4 5; do
        if kill -0 "$pid" 2>/dev/null; then
          sleep 1
        else
          break
        fi
      done
      if kill -0 "$pid" 2>/dev/null; then
        echo "PID $pid did not exit, force killing"
        kill -9 "$pid" || true
      fi
    done
  fi
done

# Wait for the target port to be free up to a timeout. This prevents race between killing and vite starting.
wait_for_port_free() {
  local port=$1
  local timeout=${2:-10}
  local elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if command -v lsof >/dev/null 2>&1; then
      if ! lsof -iTCP -sTCP:LISTEN -Pn | grep -q ":$port\b"; then
        return 0
      fi
    else
      if ! ss -ltn | awk '{print $4}' | grep -q ":$port\$"; then
        return 0
      fi
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

echo "Waiting for port $PORT to be free..."
if ! wait_for_port_free "$PORT" 10; then
  echo "Port $PORT still appears in use after waiting. Listing listeners for diagnostics:"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP -sTCP:LISTEN -Pn | grep ":$PORT" || true
  else
    ss -ltnp | grep ":$PORT" || true
  fi
  echo "If this is unexpected, try running 'lsof -i :$PORT' or 'ss -ltnp' to identify the process and kill it."
fi

# Finally exec vite with an explicit port and strictPort so it fails if it can't bind, which
# makes the behavior repeatable for the OAuth redirect callback.
echo "Starting vite with --port $PORT --strictPort"
exec vite --port "$PORT" --strictPort

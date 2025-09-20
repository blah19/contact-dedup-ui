#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="$(command -v python3 2>/dev/null || true)"
PERL_BIN="$(command -v perl 2>/dev/null || true)"
NC_BIN="$(command -v nc 2>/dev/null || command -v netcat 2>/dev/null || true)"
MKTEMP_BIN="$(command -v mktemp 2>/dev/null || true)"
JQ_BIN="$(command -v jq 2>/dev/null || true)"
CURL_BIN="$(command -v curl 2>/dev/null || true)"

CLIENT_ID=${CLIENT_ID:-}
CLIENT_SECRET=${CLIENT_SECRET:-}
REDIRECT_URI=${REDIRECT_URI:-http://localhost:5173/oauth/callback}
AUTH_DOMAIN=${AUTH_DOMAIN:-https://login.salesforce.com}
SCOPE=${SCOPE:-api refresh_token}
TOKEN_FILE=${TOKEN_FILE:-./token.json}

prompt_for_if_empty(){
  local varname=$1
  local prompt=$2
  if [ -z "${!varname:-}" ]; then
    read -r -p "$prompt: " val
    export $varname="$val"
  fi
}

prompt_for_if_empty CLIENT_ID "Enter Salesforce Client ID (Consumer Key)"
if [ -z "${CLIENT_SECRET}" ]; then
  read -r -s -p "Enter Salesforce Client Secret (press Enter if none): " CLIENT_SECRET
  echo
fi

python_parse_redirect() {
  python3 -c 'import sys, urllib.parse
u = urllib.parse.urlparse(sys.argv[1])
print(u.hostname or "")
print(u.port or "")
print(u.path or "")' "$1"
}

read HOST PORT PATH < <(python_parse_redirect "$REDIRECT_URI")
if [ -z "$PORT" ]; then PORT=53682; fi
if [ "$HOST" != "localhost" ] && [ "$HOST" != "127.0.0.1" ]; then
  echo "REDIRECT_URI must use localhost. Current: $REDIRECT_URI"
  exit 1
fi

if [ -n "$MKTEMP_BIN" ]; then
  CODE_FILE=$($MKTEMP_BIN /tmp/sf_oauth_code.XXXX)
else
  CODE_FILE="/tmp/sf_oauth_code.$$.$RANDOM"; : > "$CODE_FILE"
fi
trap 'if [ -n "${CODE_FILE:-}" ] && [ -f "$CODE_FILE" ]; then /bin/rm -f "$CODE_FILE"; fi' EXIT

INUSE=""
if command -v lsof >/dev/null 2>&1; then
  INUSE=$(lsof -t -i :"$PORT" 2>/dev/null || true)
elif command -v ss >/dev/null 2>&1; then
  INUSE=$(ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$0 ~ p {print 1}' || true)
fi
if [ -n "$INUSE" ]; then
  echo "Port $PORT is in use. Change REDIRECT_URI to a free port and add it to the Connected App."
  exit 1
fi

if [ -n "$PYTHON_BIN" ]; then
  "$PYTHON_BIN" - <<PY &
import http.server, urllib.parse
from pathlib import Path
CODE_FILE = Path(r"$CODE_FILE")
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        code = qs.get('code', [None])[0]
        if code:
            CODE_FILE.write_text(code)
        self.send_response(200)
        self.send_header('Content-type','text/html')
        self.end_headers()
        self.wfile.write(b"<html><body><h2>Authorization complete. You may close this window.</h2></body></html>")
    def log_message(self, format, *args):
        return
httpd = http.server.HTTPServer(('localhost', $PORT), Handler)
httpd.handle_request()
PY
  PYTHON_PID=$!
  SERVER_KIND=python
elif [ -n "$NC_BIN" ] && [ -n "$PERL_BIN" ]; then
  if [ -n "$MKTEMP_BIN" ]; then
    REQUEST_FILE=$($MKTEMP_BIN /tmp/sf_req.XXXX)
  else
    REQUEST_FILE="/tmp/sf_req.$$.$RANDOM"; : > "$REQUEST_FILE"
  fi
  (
    { printf 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n';
      printf '<html><body><h2>Authorization complete. You may close this window.</h2></body></html>\r\n';
    } | nc -l -p "$PORT" > "$REQUEST_FILE"
  ) &
  NC_PID=$!
  SERVER_KIND=nc
else
  echo "python3 or nc+perl required." >&2
  exit 1
fi

AUTH_QS="$("$PYTHON_BIN" - <<'PY'
import os, urllib.parse
q = {
  'response_type':'code',
  'client_id': os.environ['CLIENT_ID'],
  'redirect_uri': os.environ['REDIRECT_URI'],
  'scope': os.environ.get('SCOPE','api refresh_token')
}
print(urllib.parse.urlencode(q, quote_via=urllib.parse.quote))
PY
)"
AUTH_URL="$AUTH_DOMAIN/services/oauth2/authorize?$AUTH_QS"

echo "Opening browser for authorization..."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$AUTH_URL" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "$AUTH_URL" >/dev/null 2>&1 || true
else
  echo "Open this URL in your browser: $AUTH_URL"
fi

TIMEOUT=${OAUTH_TIMEOUT:-120}
SECS=0
while [ $SECS -lt $TIMEOUT ]; do
  if [ "${SERVER_KIND:-}" = "python" ]; then
    if [ -s "$CODE_FILE" ]; then break; fi
  else
    if [ -n "${REQUEST_FILE:-}" ] && [ -s "$REQUEST_FILE" ]; then break; fi
  fi
  /bin/sleep 1
  SECS=$((SECS + 1))
done

if [ "${SERVER_KIND:-}" = "python" ]; then
  if [ ! -s "$CODE_FILE" ]; then
    echo "Timed out waiting for authorization code (${TIMEOUT}s)."
    kill ${PYTHON_PID:-0} 2>/dev/null || true
    exit 1
  fi
  CODE=$(cat "$CODE_FILE")
else
  if [ -z "${REQUEST_FILE:-}" ] || [ ! -s "$REQUEST_FILE" ]; then
    echo "Timed out waiting for authorization code (${TIMEOUT}s)."
    kill ${NC_PID:-0} 2>/dev/null || true
    exit 1
  fi
  REQ_LINE=$(head -n1 "$REQUEST_FILE" | tr -d '\r')
  REQ_PATH=$(printf '%s' "$REQ_LINE" | awk '{print $2}')
  QS=${REQ_PATH#*?}
  CODE_ENC=$(printf '%s' "$QS" | sed -n 's/.*code=\([^&]*\).*/\1/p')
  if [ -n "$PERL_BIN" ]; then
    CODE=$(printf '%s' "$CODE_ENC" | "$PERL_BIN" -MURI::Escape -ne 'print uri_unescape($_)')
  else
    CODE=$(printf '%b' "${CODE_ENC//%/\\x}")
  fi
fi

echo "Exchanging code for tokens..."
if [ -n "$CLIENT_SECRET" ]; then
  RESPONSE=$($CURL_BIN -s -X POST "$AUTH_DOMAIN/services/oauth2/token" \
    -d grant_type=authorization_code \
    -d code="$CODE" \
    -d client_id="$CLIENT_ID" \
    -d client_secret="$CLIENT_SECRET" \
    -d redirect_uri="$REDIRECT_URI")
else
  RESPONSE=$($CURL_BIN -s -X POST "$AUTH_DOMAIN/services/oauth2/token" \
    -d grant_type=authorization_code \
    -d code="$CODE" \
    -d client_id="$CLIENT_ID" \
    -d redirect_uri="$REDIRECT_URI")
fi

if [ -z "$RESPONSE" ]; then
  echo "Empty response from token endpoint"
  exit 1
fi

echo "$RESPONSE" | jq . > "$TOKEN_FILE" 2>/dev/null || echo "$RESPONSE" > "$TOKEN_FILE"
echo "Saved token response to $TOKEN_FILE"

if [ -n "$JQ_BIN" ]; then
  ACCESS_TOKEN=$(echo "$RESPONSE" | "$JQ_BIN" -r '.access_token // empty')
  INSTANCE_URL=$(echo "$RESPONSE" | "$JQ_BIN" -r '.instance_url // empty')
else
  ACCESS_TOKEN=$(printf '%s' "$RESPONSE" | sed -n 's/.*"access_token"\s*:\s*"\([^"]*\)".*/\1/p')
  INSTANCE_URL=$(printf '%s' "$RESPONSE" | sed -n 's/.*"instance_url"\s*:\s*"\([^"]*\)".*/\1/p')
fi

if [ -n "$ACCESS_TOKEN" ]; then
  echo "Access token received."
  echo "Instance URL: $INSTANCE_URL"
  echo "Paste the access token into the app's Bearer token field and the instance URL into the Instance URL field."
else
  echo "No access_token found in response. Inspect $TOKEN_FILE for details."
  echo "$RESPONSE"
  exit 1
fi

exit 0

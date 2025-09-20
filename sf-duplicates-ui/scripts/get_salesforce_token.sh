#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="$(command -v python3 || true)"
JQ_BIN="$(command -v jq || true)"
CURL_BIN="$(command -v curl || true)"

CLIENT_ID=${CLIENT_ID:-}
CLIENT_SECRET=${CLIENT_SECRET:-}
AUTH_DOMAIN=${AUTH_DOMAIN:-https://login.salesforce.com}
REDIRECT_URI=${REDIRECT_URI:-http://localhost:53682/oauth/callback}
SCOPE=${SCOPE:-api refresh_token openid}
TOKEN_FILE=${TOKEN_FILE:-./token.json}

prompt_for_if_empty(){ local n=$1 p=$2; if [ -z "${!n:-}" ]; then read -r -p "$p: " v; export $n="$v"; fi; }
prompt_for_if_empty CLIENT_ID "Enter Salesforce Client ID (Consumer Key)"

python_parse_redirect(){ python3 - "$1" <<'PY'
import sys,urllib.parse
u=urllib.parse.urlparse(sys.argv[1])
print(u.hostname or "");print(u.port or "");print(u.path or "")
PY
}

PKCE_VERIFIER="$($PYTHON_BIN - <<'PY'
import os,base64; print(base64.urlsafe_b64encode(os.urandom(64)).decode().rstrip('='))
PY
)"
export PKCE_VERIFIER
PKCE_CHALLENGE="$($PYTHON_BIN - <<PY
import os,base64,hashlib; v=os.environ['PKCE_VERIFIER'].encode()
print(base64.urlsafe_b64encode(hashlib.sha256(v).digest()).decode().rstrip('='))
PY
)"
export PKCE_CHALLENGE
STATE="$($PYTHON_BIN - <<'PY'
import os,base64; print(base64.urlsafe_b64encode(os.urandom(24)).decode().rstrip('='))
PY
)"

read HOST PORT CALLBACK_PATH < <(python_parse_redirect "$REDIRECT_URI")
[ -z "$PORT" ] && PORT=53682
if [ "$HOST" != "localhost" ] && [ "$HOST" != "127.0.0.1" ]; then echo "Error: REDIRECT_URI must use localhost"; exit 1; fi

CODE_FILE="$(mktemp /tmp/sf_oauth_code.XXXX)"
trap 'rm -f "$CODE_FILE" "$CODE_FILE.log" 2>/dev/null || true' EXIT

# start listener
$PYTHON_BIN - <<PY &
import http.server, urllib.parse, json
from pathlib import Path
CODE_FILE=Path(r"$CODE_FILE"); LOG=Path(r"$CODE_FILE.log")
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        p=urllib.parse.urlparse(self.path); qs=urllib.parse.parse_qs(p.query)
        LOG.write_text(json.dumps({"path":self.path,"query":qs}, indent=2))
        c=qs.get("code",[None])[0]
        if c: CODE_FILE.write_text(c)
        self.send_response(200); self.send_header("Content-type","text/html"); self.end_headers()
        self.wfile.write(b"<html><body><h2>Authorization complete. You may close this window.</h2></body></html>")
    def log_message(self, *a, **k): pass
http.server.HTTPServer(("localhost",$PORT),H).handle_request()
PY
PY_PID=$!

# build URL
AUTH_QS="$($PYTHON_BIN - <<'PY'
import os,urllib.parse
q={"response_type":"code","client_id":os.environ["CLIENT_ID"],"redirect_uri":os.environ["REDIRECT_URI"],
   "scope":os.environ.get("SCOPE","api refresh_token openid"),
   "code_challenge":os.environ["PKCE_CHALLENGE"],"code_challenge_method":"S256",
   "state":os.environ["STATE"],"prompt":"login"}
print(urllib.parse.urlencode(q, quote_via=urllib.parse.quote))
PY
)"
AUTH_URL="$AUTH_DOMAIN/services/oauth2/authorize?$AUTH_QS"

echo "AUTH_URL:"
echo "$AUTH_URL"
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$AUTH_URL" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then open "$AUTH_URL" >/dev/null 2>&1 || true
fi

# wait for code
TIMEOUT=${OAUTH_TIMEOUT:-180}
for _ in $(seq 1 $TIMEOUT); do [ -s "$CODE_FILE" ] && break; sleep 1; done
[ -s "$CODE_FILE" ] || { echo "Error: no authorization code received"; [ -f "$CODE_FILE.log" ] && cat "$CODE_FILE.log"; kill $PY_PID 2>/dev/null || true; exit 1; }
CODE="$(cat "$CODE_FILE")"

# validate code
if [ "$CODE" = "TEST" ] || [ "${#CODE}" -lt 12 ]; then
  echo "Error: invalid test/short code received: '$CODE'"; [ -f "$CODE_FILE.log" ] && cat "$CODE_FILE.log"; exit 1
fi

# token exchange
if [ -n "${CLIENT_SECRET:-}" ]; then
  RESPONSE=$($CURL_BIN -s -X POST "$AUTH_DOMAIN/services/oauth2/token" \
    -d grant_type=authorization_code -d code="$CODE" -d client_id="$CLIENT_ID" \
    -d client_secret="$CLIENT_SECRET" -d redirect_uri="$REDIRECT_URI" -d code_verifier="$PKCE_VERIFIER")
else
  RESPONSE=$($CURL_BIN -s -X POST "$AUTH_DOMAIN/services/oauth2/token" \
    -d grant_type=authorization_code -d code="$CODE" -d client_id="$CLIENT_ID" \
    -d redirect_uri="$REDIRECT_URI" -d code_verifier="$PKCE_VERIFIER")
fi

[ -n "$RESPONSE" ] || { echo "Error: empty token response"; exit 1; }
echo "$RESPONSE" | ${JQ_BIN:-cat} > "$TOKEN_FILE" || echo "$RESPONSE" > "$TOKEN_FILE"
echo "Saved token response to $TOKEN_FILE"

AT="$(echo "$RESPONSE" | ${JQ_BIN:-cat} | sed -n 's/.*"access_token"\s*:\s*"\([^"]*\)".*/\1/p')"
IU="$(echo "$RESPONSE" | ${JQ_BIN:-cat} | sed -n 's/.*"instance_url"\s*:\s*"\([^"]*\)".*/\1/p')"
[ -n "$AT" ] && echo "Access token received" || { echo "Token error"; cat "$TOKEN_FILE"; exit 1; }
echo "Instance URL: $IU"

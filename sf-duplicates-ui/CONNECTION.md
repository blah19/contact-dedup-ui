Connection guide — how to get the app talking to Salesforce (from nothing)

This document walks you through the full local development connection flow for the sf-duplicates-ui project. It assumes a fresh machine and a Salesforce developer account (or scratch/dev org) and covers Connected App setup, local environment configuration, obtaining tokens (Authorization Code + PKCE), running the helper script, wiring the dev proxy, and common troubleshooting.

Contents
- Prerequisites
- Create a Connected App in Salesforce
- Why PKCE / refresh_token vs client_secret
- Configure local environment (.env)
- Obtain a token (interactive helper)
- Where tokens are stored and how the app uses them
- Start the dev server and use the UI
- Refreshing an access token (refresh_token grant)
- Common problems and how to fix them
- Security / production notes

---

Prerequisites
- Node.js + npm installed (recommended recent LTS)
- Python 3 for small helper utilities
- A Salesforce developer org, scratch org or sandbox with API access
- This repository checked out; your working dir contains `sf-duplicates-ui`
- Browser for the interactive auth flow (used by the helper script)

Files / helpful paths in this repo
- sf-duplicates-ui/scripts/get_salesforce_token.sh  — interactive Authorization Code + PKCE helper (opens browser and captures code)
- sf-duplicates-ui/scripts/refresh_token.py         — (optional) small script included in this workspace for refresh examples
- sf-duplicates-ui/public/token.json               — served by Vite during dev if present (dev convenience)
- sf-duplicates-ui/token.json                      — token file written by the helper (single-source of truth locally)
- sf-duplicates-ui/src/components/ConnectionForm.tsx — UI that auto-loads `/token.json` on localhost and lets you Reapply / Test token
- sf-duplicates-ui/vite.config.ts                  — dev server proxy configuration for /services/apexrest

Create a Connected App in Salesforce
1. Login to your Salesforce org (Setup → App Manager → New Connected App).
2. Fill in basic info for the app (Name, Contact Email).
3. Under "API (Enable OAuth Settings)":
   - Enable OAuth settings.
   - Callback URL: set to your local callback used by the helper (example):
     http://localhost:53682/oauth/callback
   - Selected OAuth Scopes: add at least
     - api
     - refresh_token
     - openid (optional but useful for userinfo)
   - (Optional) Use PKCE if the app will be used in a browser/mobile environment; otherwise you can use client secret.
4. Save the Connected App and copy the Consumer Key (CLIENT_ID) and Consumer Secret (CLIENT_SECRET) — you will put these into `.env` for dev.

Why PKCE, refresh_token and client_secret
- For local development using an interactive browser, PKCE is recommended (Authorization Code + PKCE). The helper script in `scripts/get_salesforce_token.sh` implements that.
- The `refresh_token` scope allows you to get a refresh token on the first OAuth authorization so you can exchange it later for new access tokens without re-opening the browser.
- The client secret is sensitive. For local dev it’s acceptable to store it in `.env` (not committed); for production store secrets on the server only.

Configure local environment (.env)
1. Create or edit `sf-duplicates-ui/.env` and set the variables from your Connected App:

Example `.env` (do NOT commit this file):

```bash
# Salesforce OAuth settings (local dev only)
export CLIENT_ID=<<YOUR_CONSUMER_KEY>>
export CLIENT_SECRET=<<YOUR_CONSUMER_SECRET>>
export AUTH_DOMAIN=https://<your-org-domain>.my.salesforce.com
export REDIRECT_URI=http://localhost:53682/oauth/callback
export SCOPE="api refresh_token openid"
```

Notes:
- `AUTH_DOMAIN` is typically `https://<your-dev-org>.my.salesforce.com` (or the sandbox/scratch org domain).
- The helper script reads `.env` to pick CLIENT_ID/CLIENT_SECRET and AUTH_DOMAIN.

Obtain a token (interactive helper)
The repository includes a helper script to run the Authorization Code + PKCE flow, receive the code locally, exchange it for tokens, and write `token.json`.

Run it from the `sf-duplicates-ui` directory:

```bash
cd sf-duplicates-ui
./scripts/get_salesforce_token.sh
```

What it does (high level):
- Generates PKCE verifier/challenge
- Builds an authorization URL and opens it in your browser
- Listens locally for the redirect with the authorization code
- Exchanges code for tokens (access_token, refresh_token, id_token) and writes `token.json`

After completion you'll have `token.json` in the `sf-duplicates-ui` folder. Example contents (sensitive fields removed):

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "instance_url": "https://your-org.my.salesforce.com",
  "issued_at": "<unix-ms>"
}
```

Where tokens are stored and how the app uses them
- `sf-duplicates-ui/token.json` — the helper writes tokens here. This file is used as the authoritative file during development.
- `sf-duplicates-ui/public/token.json` — the app sometimes fetches `/token.json` (served from `public/`) so putting a copy here makes it available to the browser without special file serving. The helper script may copy the file or you can manually copy it.
- The app `ConnectionForm` will auto-load `/token.json` when running on `localhost` and will auto-apply the token (calls `onChange(instanceUrl, token)` for you). It also has a Reapply and Test button to pick up changes without a full reload.

Start the dev server and confirm the proxy
1. Start Vite pinned to port 5173 (our proxy config assumes dev origin on 5173):
```bash
cd sf-duplicates-ui
PORT=5173 npm run dev
```

2. Confirm `/token.json` is served by the dev server (this is what the browser reads):
```bash
curl -I http://127.0.0.1:5173/token.json
```
You should get HTTP/200 and Content-Type: application/json.

3. Open the app at the dev origin:
- http://127.0.0.1:5173

4. Connection form behavior:
- When `token.json` is found and contains `instance_url` and `access_token`, the UI shows "using token.json (dev)" and hides the token input.
- If needed, use Reveal → Apply to manually set the token for this origin, or click Reapply after editing `token.json`.
- Click Test token (shows the proxied request result in the UI).

Refreshing an access token using the refresh_token
If `token.json` contains `refresh_token` you can obtain a new access_token with the refresh_token grant (non-interactive):

Example using curl (do not paste your real CLIENT_SECRET in public places):

```bash
CLIENT_ID=<<from .env>>
CLIENT_SECRET=<<from .env>>   # may be optional if your app uses PKCE
REFRESH_TOKEN=$(jq -r .refresh_token token.json)
INSTANCE=$(jq -r .instance_url token.json)

curl -X POST "$INSTANCE/services/oauth2/token" \
  -d grant_type=refresh_token \
  -d client_id="$CLIENT_ID" \
  -d refresh_token="$REFRESH_TOKEN" \
  -d client_secret="$CLIENT_SECRET"
```

Successful response contains a new `access_token` and possibly a new `issued_at` value. Merge that into `token.json` and copy it to `public/token.json` so the app can pick it up (or use the Reapply button in the UI).

Automating refresh in this repo (dev-only)
- There is a small helper script in `scripts/refresh_token.py` (or the interactive curl sequence above) you can run in the repo to refresh and write `token.json` and `public/token.json`.
- The UI includes a Reapply button and a Test token button to pick up the new token without reloading.

Common problems and how to fix them
- 401 Unauthorized / INVALID_SESSION_ID
  - Most common: the access token expired. Use the refresh_token grant or re-run the interactive helper.
  - Verify the browser is on the correct origin (Vite dev server port). If the app tab is using the wrong port (eg :5174) it will not hit the working proxy. Open http://127.0.0.1:5173.
  - In DevTools → Network, inspect the failing request's Authorization header. Confirm the token prefix matches the value in `token.json`.
- CORS preflight errors
  - In dev, the Vite proxy is configured to forward `/services/apexrest` to your Salesforce instance so the browser avoids Salesforce CORS restrictions. Ensure Vite is started and requests are using the relative path `/services/apexrest/...` (the app does this automatically on localhost).
- Stale dev server port
  - Vite may fall back to another port if 5173 is taken. For stability, kill stale vite processes and start Vite with `PORT=5173 npm run dev`.
- Refresh token missing or revoked
  - If `token.json` does not contain `refresh_token` or refresh calls fail with 400/invalid_grant, you may need to re-run the interactive helper to get a fresh refresh_token. Admins can also revoke refresh tokens.
- Scratch orgs expire
  - If using a scratch org, it can expire and then all tokens become invalid; create a new dev org (or re-setup the org) and re-authenticate.

Debug checklist (fast)
1. Did `./scripts/get_salesforce_token.sh` complete and produce `token.json`? (Yes → continue)
2. Is Vite running on the expected port? `ss -ltnp | grep 5173` and `curl -I http://127.0.0.1:5173/token.json`
3. In the app connection bar: click Reapply → Test token. If Test shows 200 and JSON, you’re good.
4. If Test shows 401, open DevTools → Network → Request Headers → Authorization and compare first ~20 chars with `jq -r .access_token token.json | sed -E 's/^(.{20}).*/\1.../'`.
5. If header differs, Reveal → Apply or clear saved settings: `localStorage.removeItem('sf-dup-ui-settings'); location.reload();` then reapply.
6. If header matches and 401 persists, refresh with the refresh_token grant or re-run the interactive helper.

Security notes / production recommendations
- Never commit `token.json`, `.env` or `public/token.json` containing secrets to source control. They are stored locally for dev convenience only.
- In production, never store refresh tokens in client-side code. Implement a server-side session store and perform OAuth refresh on the server. The server should forward only short-lived access tokens or proxy requests to avoid leaking tokens.
- Treat client_secret like any secret — store it in secure vaults or environment variables on the server (not in client-side code).

Appendix — useful commands recap
- Start dev server pinned to 5173
```bash
cd sf-duplicates-ui
PORT=5173 npm run dev
```
- Interactive auth helper (writes token.json)
```bash
cd sf-duplicates-ui
./scripts/get_salesforce_token.sh
# follow the browser flow
```
- Refresh token with curl
```bash
CLIENT_ID=...; CLIENT_SECRET=...; REFRESH_TOKEN=$(jq -r .refresh_token token.json); INSTANCE=$(jq -r .instance_url token.json)
curl -X POST "$INSTANCE/services/oauth2/token" -d grant_type=refresh_token -d client_id="$CLIENT_ID" -d refresh_token="$REFRESH_TOKEN" -d client_secret="$CLIENT_SECRET"
```
- Test proxy endpoint server-side
```bash
python3 - <<'PY'
import json,requests
j=json.load(open('token.json'))
access=j['access_token']
print(requests.get('http://127.0.0.1:5173/services/apexrest/v1/duplicate-matches?status=pending&expand=customerA,customerB', headers={'Authorization':'Bearer '+access,'Origin':'http://127.0.0.1:5173'}).status_code)
PY
```

If something in this guide doesn't work on your machine, tell me which step failed and paste the exact output (errors, HTTP status, or logs). I can then run the next troubleshooting step or add a small dev-only helper to automate refresh-and-reapply.

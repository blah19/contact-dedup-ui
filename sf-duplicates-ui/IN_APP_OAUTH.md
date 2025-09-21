In-app OAuth (PKCE) flow — developer notes

This project supports starting the OAuth Authorization Code + PKCE flow from the browser during development.

How it works (dev):

- The Connection bar shows a "Login with Salesforce" button when running locally.
- The button generates a PKCE code_verifier and code_challenge, stores the verifier in sessionStorage, and redirects the browser to:
  {AUTH_DOMAIN}/services/oauth2/authorize?response_type=code&client_id={CLIENT_ID}&redirect_uri={ORIGIN}/oauth/callback&scope=refresh_token+openid+api&code_challenge={CHALLENGE}&code_challenge_method=S256
- After user consent Salesforce redirects back to /oauth/callback with ?code=...
- The app handles /oauth/callback (client-side component) and performs a POST to /services/oauth2/token with grant_type=authorization_code, code, redirect_uri, code_verifier, and client_id.
- Vite dev proxy forwards /services/oauth2/token to your Salesforce instance so the browser can POST without CORS issues.
- On success the app saves the token to localStorage (dev convenience) and to the app settings so it can be used immediately.

Dev setup:

- Expose two values for dev in `index.html` before the bundle loads:
  <script>
    window.__SF_AUTH_DOMAIN__ = 'https://your-org.my.salesforce.com'
    window.__SF_CLIENT_ID__ = 'YOUR_CONSUMER_KEY'
  </script>

- Ensure `vite.config.ts` has `SF_INSTANCE` or `AUTH_DOMAIN` set so the dev server proxy points to the right Salesforce instance. See `vite.config.ts`.

Security notes:

- This client-side token exchange is only for developer convenience. In production you should perform token exchanges and refreshes on a trusted server and never expose client secrets in frontend code.


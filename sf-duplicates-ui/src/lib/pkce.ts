// PKCE helpers: generate code_verifier and code_challenge
export function randomBase64Url(size = 64) {
  const arr = new Uint8Array(size)
  crypto.getRandomValues(arr)
  // base64url
  return btoa(String.fromCharCode(...Array.from(arr))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateCodeVerifier() {
  return randomBase64Url(64)
}

export async function generateCodeChallenge(verifier: string) {
  const enc = new TextEncoder()
  const data = enc.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const bytes = Array.from(new Uint8Array(hash))
  const b64 = btoa(String.fromCharCode(...bytes))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function buildAuthUrl({ authDomain, clientId, redirectUri, scope, codeChallenge }: { authDomain: string; clientId: string; redirectUri: string; scope: string; codeChallenge: string }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  })
  return `${authDomain.replace(/\/$/, '')}/services/oauth2/authorize?${params.toString()}`
}

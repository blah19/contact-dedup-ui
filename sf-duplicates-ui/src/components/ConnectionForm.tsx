import { useEffect, useState } from 'react'
import { loadSettings, saveSettings } from '../lib/storage'
import { generateCodeVerifier, generateCodeChallenge, buildAuthUrl } from '../lib/pkce'

type Props = { onChange: (instanceUrl: string, token: string) => void }

export default function ConnectionForm({ onChange }: Props) {
  const initial = loadSettings()
  const [instanceUrl, setInstanceUrl] = useState(initial.instanceUrl)
  const [token, setToken] = useState(initial.token)
  const [autoLoaded, setAutoLoaded] = useState(false)
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoLoadError, setAutoLoadError] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [authPreviewUrl, setAuthPreviewUrl] = useState<string | null>(null)
  const [devClientSecret, setDevClientSecret] = useState<string>(() => {
    try { return sessionStorage.getItem('sf_client_secret') || '' } catch { return '' }
  })
  const [rememberSecret, setRememberSecret] = useState<boolean>(() => {
    try { return !!sessionStorage.getItem('sf_client_secret') } catch { return false }
  })

  // On mount, try to load a local /token.json for developer convenience.
  // Behavior:
  // - If running on localhost/127.0.0.1, always attempt to fetch /token.json and apply it.
  // - If not local, only attempt to fetch when there are no saved settings.
  useEffect(() => {
    let mounted = true
    async function tryLoadLocalToken() {
      try {
        setAutoLoadError(null)
        setAutoLoading(false)
        const isLocal = typeof window !== 'undefined' && /(^localhost$|^127\.0\.0\.1$)/.test(window.location.hostname)

        // Consider saved settings empty if they're only whitespace
        const savedInstance = (initial.instanceUrl || '').trim()
        const savedToken = (initial.token || '').trim()

        // If not local and we already have saved settings, skip attempting to fetch the public token.json
        if (!isLocal && (savedInstance || savedToken)) return

        // Attempt to fetch token.json (cache-busted). Track loading state so the UI doesn't
        // claim it is "using token.json" until we've verified the file exists and parses.
        setAutoLoading(true)
        const res = await fetch(`/token.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) {
          setAutoLoadError(`token.json fetch failed: ${res.status} ${res.statusText}`)
          setAutoLoading(false)
          return
        }
        let j: any
        try {
          j = await res.json()
        } catch (err: any) {
          setAutoLoadError(`token.json parse error: ${err && err.message ? err.message : String(err)}`)
          setAutoLoading(false)
          return
        }
        if (!mounted) return
        if (j.instance_url && j.access_token) {
          const isLocalHost = isLocal
          const inst = j.instance_url || ((isLocalHost && !savedInstance) ? window.location.origin : '')
          const tok = j.access_token
          setInstanceUrl(inst)
          setToken(tok)
          setAutoLoaded(true)
          setAutoLoadError(null)
          setAutoLoading(false)
          try { onChange(inst, tok) } catch {}
          try {
            if (isLocalHost && typeof window !== 'undefined') {
              const port = window.location.port || '80'
              if (port !== '5173') {
                window.location.replace(`http://127.0.0.1:5173${window.location.pathname}${window.location.search}`)
              }
            }
          } catch { }
        }
      } catch (err) {
        setAutoLoadError(String(err && (err as any).message ? (err as any).message : err))
        setAutoLoading(false)
      }
    }
    tryLoadLocalToken()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    onChange(instanceUrl, token)
    saveSettings({ instanceUrl, token })
  }, [instanceUrl, token, onChange])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, marginBottom: 12, alignItems: 'center' }}>
      <input
        placeholder="https://yourinstance.my.salesforce.com"
        value={instanceUrl}
        onChange={e => setInstanceUrl(e.target.value)}
        style={{ padding: 8, border: '1px solid #ccc', borderRadius: 8 }}
      />
      {autoLoaded ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ padding: '6px 10px', background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 8, color: '#0050b3' }}>
            using token.json (dev)
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={async () => {
                // start PKCE auth flow
                try {
                  setLoginError(null)
                  const authDomain = (window as any).__SF_AUTH_DOMAIN__ || ''
                  const clientId = (window as any).__SF_CLIENT_ID__ || ''
                  if (!authDomain || !clientId) {
                    setLoginError('Missing OAuth configuration: set window.__SF_AUTH_DOMAIN__ and window.__SF_CLIENT_ID__ for in-app login (see IN_APP_OAUTH.md)')
                    return
                  }
                  const redirect = (window as any).__SF_REDIRECT_URI__ || `${window.location.origin}/oauth/callback`
                  const scope = 'refresh_token openid api'
                  const verifier = generateCodeVerifier()
                  // persist verifier in sessionStorage and as a cookie so it survives
                  // dev flows where the authorize request and the callback are on different ports
                  sessionStorage.setItem('pkce_verifier', verifier)
                  try {
                    // cookie is host-scoped (not port), so it will be visible across localhost ports
                    document.cookie = `pkce_verifier=${encodeURIComponent(verifier)}; path=/; samesite=Lax`
                  } catch {
                    // ignore in environments without document
                  }
                  // store debug info (trimmed) for diagnostics
                  try {
                    const debug = {
                      ts: Date.now(),
                      verifier_preview: verifier.slice(0, 8) + '…' + verifier.slice(-4),
                      origin: typeof window !== 'undefined' ? window.location.origin : '',
                    }
                    sessionStorage.setItem('pkce_debug', JSON.stringify(debug))
                    console.debug('PKCE start', debug)
                  } catch {
                    // ignore
                  }
                    const challenge = await generateCodeChallenge(verifier)
                    // also persist a debug preview of the challenge
                    try {
                      const chDebug = challenge.slice(0, 8) + '…' + challenge.slice(-4)
                      sessionStorage.setItem('pkce_challenge_preview', chDebug)
                      console.debug('PKCE challenge', chDebug)
                    } catch {
                      // ignore
                    }
                  let url = buildAuthUrl({ authDomain, clientId, redirectUri: redirect, scope, codeChallenge: challenge })
                  try {
                    // store the code_challenge in a host-scoped cookie for debugging and validation
                    document.cookie = `pkce_challenge=${encodeURIComponent(challenge)}; path=/; samesite=Lax`
                  } catch {
                    // ignore
                  }
                  // include the pkce verifier in the state so the callback can recover it even
                  // when sessionStorage or cookies are not visible across localhost hostnames/ports.
                  // Prefix with 'pkce:' to avoid colliding with other state values.
                  try {
                    const sep = url.includes('?') ? '&' : '?'
                    url = `${url}${sep}state=${encodeURIComponent('pkce:' + verifier)}`
                  } catch {
                    // ignore
                  }
                  try {
                    // persist the full authorize URL for debugging and copy-paste
                    sessionStorage.setItem('pkce_last_auth_url', url)
                    console.debug('PKCE authorize URL', url)
                  } catch {
                    // ignore
                  }
                  // Show the authorize preview interstitial so the developer can confirm
                  // the URL contains the expected state and code_challenge before leaving
                  // the originating tab (sessionStorage is scoped by origin:port).
                  setAuthPreviewUrl(url)
                } catch (err) {
                  setLoginError(String(err && (err as any).message ? (err as any).message : err))
                }
              }}
              style={{ padding: 6, borderRadius: 8, border: '1px solid #ccc', background: '#fffbe6' }}
            >
              Login with Salesforce
            </button>
            
            <button
              onClick={async () => {
                  // re-fetch /token.json and reapply the token; keep autoLoaded state
                  try {
                    setAutoLoadError(null)
                    setAutoLoading(true)
                    const res = await fetch(`/token.json?t=${Date.now()}`, { cache: 'no-store' })
                    if (!res.ok) {
                      setAutoLoadError(`token.json fetch failed: ${res.status} ${res.statusText}`)
                      setAutoLoading(false)
                      return
                    }
                    let j: any
                    try {
                      j = await res.json()
                    } catch (err: any) {
                      setAutoLoadError(`token.json parse error: ${err && err.message ? err.message : String(err)}`)
                      setAutoLoading(false)
                      return
                    }
                    if (j.instance_url && j.access_token) {
                      // Prefer the instance URL from token.json; fall back to page origin if missing.
                      const inst = j.instance_url || ((typeof window !== 'undefined' && /(^localhost$|^127\.0\.0\.1$)/.test(window.location.hostname) && !(initial.instanceUrl || '').trim()) ? window.location.origin : '')
                      const tok = j.access_token
                      setInstanceUrl(inst)
                      setToken(tok)
                      setAutoLoaded(true)
                      setAutoLoadError(null)
                      setAutoLoading(false)
                      try {
                        onChange(inst, tok)
                      } catch {
                        // ignore
                      }
                      // If running on localhost but not on 5173, redirect so the app uses the working proxy
                      try {
                        if (typeof window !== 'undefined' && /(^localhost$|^127\.0\.0\.1$)/.test(window.location.hostname)) {
                          const port = window.location.port || '80'
                          if (port !== '5173') {
                            window.location.replace(`http://127.0.0.1:5173${window.location.pathname}${window.location.search}`)
                          }
                        }
                      } catch {
                        // ignore
                      }
                    }
                  } catch (err) {
                    setAutoLoadError(String(err && (err as any).message ? (err as any).message : err))
                    setAutoLoading(false)
                  }
              }}
              style={{ padding: 6, borderRadius: 8, border: '1px solid #ccc', background: '#fafafa' }}
            >
              Reapply
            </button>
            <button
              onClick={async () => {
                // run a client-side test using the current token value
                try {
                  setTesting(true)
                  setTestStatus(null)
                  setTestMessage(null)
                  const r = await fetch('/services/apexrest/v1/duplicate-matches?status=pending&expand=customerA,customerB', {
                    headers: { Authorization: `Bearer ${token}` }
                  })
                  const body = await r.text()
                  setTestStatus(r.ok ? 'ok' : `error ${r.status}`)
                  setTestMessage(body.slice(0, 2000))
                } catch (e: any) {
                  setTestStatus('error')
                  setTestMessage(String(e && e.message ? e.message : e))
                } finally {
                  setTesting(false)
                }
              }}
              style={{ padding: 6, borderRadius: 8, border: '1px solid #ccc', background: '#fafafa' }}
            >
              {testing ? 'Testing…' : 'Test token'}
            </button>
            <button
              onClick={() => {
                // open the likely dev origin where the vite proxy runs
                try {
                  window.open('http://127.0.0.1:5173', '_blank')
                } catch {
                  // ignore in environments without window
                }
              }}
              title="Open dev origin (127.0.0.1:5173)"
              style={{ padding: 6, borderRadius: 8, border: '1px solid #ccc', background: '#fafafa' }}
            >
              Open dev origin
            </button>
            <button
              onClick={() => {
                // reveal inputs for manual override
                setAutoLoaded(false)
              }}
              style={{ padding: 6, borderRadius: 8, border: '1px solid #ccc', background: '#fafafa' }}
            >
              Reveal
            </button>
          </div>
        </div>
      ) : (
        <input
          placeholder="Bearer token"
          value={token}
          onChange={e => setToken(e.target.value)}
          style={{ padding: 8, border: '1px solid #ccc', borderRadius: 8 }}
        />
      )}
      {/* Show a short inline status when we attempted to auto-load but failed */}
      {autoLoadError ? (
        <div style={{ gridColumn: '1 / -1', color: 'crimson', fontSize: 12, marginTop: 6 }}>
          {`token.json not applied: ${autoLoadError}`}
        </div>
      ) : null}
      {authPreviewUrl ? (
        <div style={{ gridColumn: '1 / -1', marginTop: 8, padding: 8, background: '#fffbe6', borderRadius: 6 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}><strong>Authorize URL preview</strong></div>
          <pre style={{ maxHeight: 120, overflow: 'auto', background: '#f7f7f7', padding: 8, borderRadius: 6 }}>{authPreviewUrl}</pre>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={() => { try { navigator.clipboard.writeText(authPreviewUrl) } catch {} }} style={{ padding: 6 }}>Copy</button>
            <button onClick={async () => {
                try {
                  if (!authPreviewUrl) return
                  // ensure state and pkce persistence before navigating
                  const u = new URL(authPreviewUrl)
                  const params = u.searchParams
                  // recover verifier if present in sessionStorage or cookies
                  let verifier = null
                  try { verifier = sessionStorage.getItem('pkce_verifier') } catch {}
                  if (!verifier) {
                    try {
                      const m = document.cookie.match(/(?:^|; )pkce_verifier=([^;]+)/)
                      if (m) verifier = decodeURIComponent(m[1])
                    } catch {}
                  }
                  // if verifier not present but state contains pkce:..., extract it
                  try {
                    const stateRaw = params.get('state')
                    if (!verifier && stateRaw && stateRaw.startsWith('pkce:')) {
                      verifier = decodeURIComponent(stateRaw.slice('pkce:'.length))
                    }
                  } catch {}
                  // persist verifier to sessionStorage and cookie (short-lived)
                  try { if (verifier) sessionStorage.setItem('pkce_verifier', verifier) } catch {}
                  try { if (verifier) document.cookie = `pkce_verifier=${encodeURIComponent(verifier)}; Max-Age=600; path=/; samesite=Lax` } catch {}
                  // ensure challenge cookie exists; compute if needed
                  try {
                    const hasChallenge = !!(document.cookie.match(/(?:^|; )pkce_challenge=([^;]+)/))
                    if (!hasChallenge && verifier) {
                      const ch = await generateCodeChallenge(verifier)
                      try { document.cookie = `pkce_challenge=${encodeURIComponent(ch)}; Max-Age=600; path=/; samesite=Lax` } catch {}
                      // also, if url missing code_challenge param, append it
                      if (!params.get('code_challenge')) {
                        params.set('code_challenge', ch)
                        params.set('code_challenge_method', 'S256')
                        u.search = params.toString()
                      }
                    }
                  } catch {}
                  // ensure state param exists and includes pkce verifier for callback fallback
                  try {
                    if (!params.get('state')) {
                      if (verifier) params.set('state', `pkce:${encodeURIComponent(verifier)}`)
                      u.search = params.toString()
                    }
                  } catch {}
                  // persist last auth url
                  try { sessionStorage.setItem('pkce_last_auth_url', u.toString()) } catch {}
                  // navigate
                  window.location.href = u.toString()
                } catch (e) {
                  console.error('Proceed to authorization failed', e)
                }
              }} style={{ padding: 6 }}>Proceed to Authorization</button>
            <button onClick={async () => {
                try {
                  if (!authPreviewUrl) return
                  const u = new URL(authPreviewUrl)
                  const params = u.searchParams
                  let verifier = null
                  try { verifier = sessionStorage.getItem('pkce_verifier') } catch {}
                  if (!verifier) {
                    try {
                      const m = document.cookie.match(/(?:^|; )pkce_verifier=([^;]+)/)
                      if (m) verifier = decodeURIComponent(m[1])
                    } catch {}
                  }
                  try {
                    const stateRaw = params.get('state')
                    if (!verifier && stateRaw && stateRaw.startsWith('pkce:')) {
                      verifier = decodeURIComponent(stateRaw.slice('pkce:'.length))
                    }
                  } catch {}
                  try { if (verifier) sessionStorage.setItem('pkce_verifier', verifier) } catch {}
                  try { if (verifier) document.cookie = `pkce_verifier=${encodeURIComponent(verifier)}; Max-Age=600; path=/; samesite=Lax` } catch {}
                  try {
                    const hasChallenge = !!(document.cookie.match(/(?:^|; )pkce_challenge=([^;]+)/))
                    if (!hasChallenge && verifier) {
                      const ch = await generateCodeChallenge(verifier)
                      try { document.cookie = `pkce_challenge=${encodeURIComponent(ch)}; Max-Age=600; path=/; samesite=Lax` } catch {}
                      if (!params.get('code_challenge')) {
                        params.set('code_challenge', ch)
                        params.set('code_challenge_method', 'S256')
                        u.search = params.toString()
                      }
                    }
                  } catch {}
                  try {
                    if (!params.get('state')) {
                      if (verifier) params.set('state', `pkce:${encodeURIComponent(verifier)}`)
                      u.search = params.toString()
                    }
                  } catch {}
                  try { sessionStorage.setItem('pkce_last_auth_url', u.toString()) } catch {}
                  // open in a new tab which some devs prefer to preserve the original app
                  window.open(u.toString(), '_blank', 'noopener')
                } catch (e) {
                  console.error('Open in new tab failed', e)
                }
              }} style={{ padding: 6 }}>Open in new tab</button>
            <button onClick={() => setAuthPreviewUrl(null)} style={{ padding: 6 }}>Cancel</button>
          </div>
        </div>
      ) : null}
      {autoLoading ? (
        <div style={{ gridColumn: '1 / -1', color: '#666', fontSize: 12, marginTop: 6 }}>
          checking for token.json…
        </div>
      ) : null}
      <div>
        {!autoLoaded ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onChange(instanceUrl, token)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', background: '#fafafa' }}
            >
              Apply
            </button>
            <button
              onClick={async () => {
                // start PKCE auth flow from the browser for dev (only shown when token.json not applied)
                try {
                  setLoginError(null)
                  const authDomain = (window as any).__SF_AUTH_DOMAIN__ || ''
                  const clientId = (window as any).__SF_CLIENT_ID__ || ''
                  if (!authDomain || !clientId) {
                    setLoginError('Missing OAuth configuration: set window.__SF_AUTH_DOMAIN__ and window.__SF_CLIENT_ID__ for in-app login (see IN_APP_OAUTH.md)')
                    return
                  }
                  const redirect = (window as any).__SF_REDIRECT_URI__ || `${window.location.origin}/oauth/callback`
                  const scope = 'refresh_token openid api'
                  const verifier = generateCodeVerifier()
                  // persist verifier to sessionStorage and a host-scoped cookie
                  try { sessionStorage.setItem('pkce_verifier', verifier) } catch {}
                  try { document.cookie = `pkce_verifier=${encodeURIComponent(verifier)}; path=/; samesite=Lax` } catch {}
                  const challenge = await generateCodeChallenge(verifier)
                  const url = buildAuthUrl({ authDomain, clientId, redirectUri: redirect, scope, codeChallenge: challenge })
                  try { document.cookie = `pkce_challenge=${encodeURIComponent(challenge)}; path=/; samesite=Lax` } catch {}
                  try {
                    sessionStorage.setItem('pkce_last_auth_url', url)
                  } catch {}
                  // Show preview so the dev can confirm the URL/state before navigating
                  setAuthPreviewUrl(url)
                } catch (err) {
                  setLoginError(String(err && (err as any).message ? (err as any).message : err))
                }
              }}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', background: '#fffbe6' }}
            >
              Login with Salesforce
            </button>
          </div>
        ) : null}
      </div>
      {loginError ? (
        <div style={{ gridColumn: '1 / -1', color: 'crimson', fontSize: 12, marginTop: 6 }}>
          {loginError}
        </div>
      ) : null}
      {/* test output area (dev only) */}
      <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
        <div style={{ fontSize: 12, marginBottom: 6 }}><strong>Developer client secret (optional)</strong></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Client secret for connected app (dev)" value={devClientSecret}
            onChange={e => {
              const v = e.target.value
              setDevClientSecret(v)
              try {
                if (v && rememberSecret) sessionStorage.setItem('sf_client_secret', v)
                else if (!v) sessionStorage.removeItem('sf_client_secret')
              } catch {}
            }}
            style={{ padding: 8, minWidth: 360 }} />
          <label style={{ fontSize: 12 }}>
            <input type="checkbox" checked={rememberSecret} onChange={e => {
              const val = e.target.checked
              setRememberSecret(val)
              try {
                if (val && devClientSecret) sessionStorage.setItem('sf_client_secret', devClientSecret)
                if (!val) sessionStorage.removeItem('sf_client_secret')
              } catch {}
            }} /> remember for session
          </label>
          <button onClick={() => { setDevClientSecret(''); try { sessionStorage.removeItem('sf_client_secret') } catch {} }} style={{ padding: 6 }}>Clear</button>
        </div>
      </div>
      <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
        {testStatus ? (
          <div style={{ fontSize: 12, color: testStatus === 'ok' ? 'green' : 'crimson' }}>
            Test: {testStatus}
          </div>
        ) : null}
        {testMessage ? (
          <pre style={{ maxHeight: 200, overflow: 'auto', background: '#f7f7f7', padding: 8, borderRadius: 6 }}>{testMessage}</pre>
        ) : null}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { saveSettings } from '../lib/storage'

export default function OAuthCallback() {
  const [status, setStatus] = useState('Exchanging code...')
  const [debug, setDebug] = useState<any | null>(null)
  const [lastError, setLastError] = useState<any | null>(null)
  const [clientSecret, setClientSecret] = useState('')
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    let mounted = true
    async function run() {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        if (!code) {
          setStatus('No code in URL')
          return
        }
  let verifier = sessionStorage.getItem('pkce_verifier') || ''
        // sessionStorage is scoped per-origin:port. In dev the authorize redirect may land on
        // a different port than the one that set sessionStorage. Fall back to a host-scoped
        // cookie if present (we set it in ConnectionForm).
        if (!verifier) {
          try {
            const m = document.cookie.match(/(?:^|; )pkce_verifier=([^;]+)/)
            if (m) verifier = decodeURIComponent(m[1])
            // try an alternate name used on some flows
            if (!verifier) {
              const m2 = document.cookie.match(/(?:^|; )pkce_v=([^;]+)/)
              if (m2) verifier = decodeURIComponent(m2[1])
            }
          } catch {
            // ignore
          }
        }
        // If still not present, attempt to recover pkce verifier from the state parameter
        // (we encoded it as state=pkce:<verifier> when starting the auth flow in dev).
        if (!verifier) {
          try {
            const params = new URLSearchParams(window.location.search)
            const stateRaw = params.get('state') || ''
            const state = decodeURIComponent(stateRaw)
            if (state && state.startsWith('pkce:')) {
              verifier = state.slice('pkce:'.length)
            }
          } catch {
            // ignore
          }
        }

        // capture debug info for visibility in the UI and console
        const paramsNow = new URLSearchParams(window.location.search)
        const stateRawNow = paramsNow.get('state') || null
        const debugObj: any = {
          verifier_preview: verifier ? (verifier.slice(0,8) + '…' + verifier.slice(-4)) : null,
          state: stateRawNow,
          state_decoded: stateRawNow ? decodeURIComponent(stateRawNow) : null,
          code: paramsNow.get('code') || null,
          redirect_uri_used: (window as any).__SF_REDIRECT_URI__ || `${window.location.origin}/oauth/callback`,
          cookies: typeof document !== 'undefined' ? document.cookie : null,
        }
        try { sessionStorage.setItem('pkce_debug_callback', JSON.stringify(debugObj)) } catch {}
        console.debug('OAuthCallback debug start', debugObj)
        setDebug(debugObj)
        // build form body
        const body = new URLSearchParams()
        body.set('grant_type', 'authorization_code')
        body.set('code', code)
  body.set('redirect_uri', (window as any).__SF_REDIRECT_URI__ || `${window.location.origin}/oauth/callback`)
        body.set('code_verifier', verifier)
        // client_id must be present in global for dev convenience
        const clientId = (window as any).__SF_CLIENT_ID__ || ''
        if (!clientId) {
          setStatus('Missing client_id in window.__SF_CLIENT_ID__')
          return
        }
        body.set('client_id', clientId)
        // if a dev client secret is present in sessionStorage, include it (dev convenience)
        try {
          const devSecret = sessionStorage.getItem('sf_client_secret') || ''
          const envSecret = (window as any).__SF_CLIENT_SECRET__ || ''
          if (devSecret) body.set('client_secret', devSecret)
          else if (envSecret) body.set('client_secret', envSecret)
        } catch {}

        // Salesforce expects application/x-www-form-urlencoded body for the token exchange.
        const res = await fetch('/services/oauth2/token', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        // Try to parse JSON response (error responses from Salesforce are JSON with error_description)
        let j: any = null
        try {
          j = await res.json()
        } catch (parseErr) {
          // Not JSON — capture text for diagnostics
          const txt = await res.text()
          if (!mounted) return
          console.error('Token exchange non-JSON response', txt)
          setStatus(`Token exchange failed: ${res.status} — ${txt.slice(0, 200)}`)
          return
        }
        if (!mounted) return
        if (!res.ok) {
          // Surface Salesforce error details when available
          const errMsg = j && (j.error_description || j.error || JSON.stringify(j))
          console.error('Token exchange error', j)
          setLastError(j)
          setStatus(`Token exchange failed: ${res.status} — ${errMsg}`)
          return
        }
        // For debugging: compute the code_challenge from the recovered verifier and compare
        // to the originally stored challenge (if present) to help diagnose invalid verifier issues.
        try {
          const storedChallengeMatch = (typeof document !== 'undefined' && document.cookie) ? document.cookie.match(/(?:^|; )pkce_challenge=([^;]+)/) : null
          if (storedChallengeMatch && verifier) {
            const storedChallenge = decodeURIComponent(storedChallengeMatch[1])
            // compute challenge from verifier
            const enc = new TextEncoder()
            const data = enc.encode(verifier)
            const hash = await crypto.subtle.digest('SHA-256', data)
            const bytes = Array.from(new Uint8Array(hash))
            const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
            if (b64 !== storedChallenge) {
              setStatus(`Token exchange failed: verifier/challenge mismatch (computed != stored). Computed: ${b64.slice(0,8)}..., Stored: ${storedChallenge.slice(0,8)}...`)
              return
            }
          }
        } catch (e) {
          // ignore cryptography errors, proceed to attempt exchange and let server report
        }

        // Persist token in localStorage for dev convenience and update saved settings
        const inst = j.instance_url || window.location.origin
        const tok = j.access_token || ''
        saveSettings({ instanceUrl: inst, token: tok })
        // keep a copy in sessionStorage as well
        sessionStorage.setItem('sf_token', JSON.stringify(j))
        // clear pkce cookie now that it was used
        try {
          document.cookie = 'pkce_verifier=; Max-Age=0; path=/; samesite=Lax'
        } catch {
          // ignore
        }
        try {
          document.cookie = 'pkce_challenge=; Max-Age=0; path=/; samesite=Lax'
        } catch {
          // ignore
        }
  setStatus('Success — redirecting to app')
  console.debug('Token exchange success', j)
        // redirect to root so the app picks up the new settings
        setTimeout(() => {
          window.location.replace('/')
        }, 800)
      } catch (e: any) {
        setStatus(String(e && e.message ? e.message : e))
      }
    }
    run()
    return () => {
      mounted = false
    }
  }, [])

  async function retryWithSecret() {
    try {
      setRetrying(true)
      setStatus('Retrying token exchange with client secret...')
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (!code) {
        setStatus('No code in URL')
        setRetrying(false)
        return
      }
      // recover verifier similar to initial run
      let verifier = sessionStorage.getItem('pkce_verifier') || ''
      if (!verifier) {
        try {
          const m = document.cookie.match(/(?:^|; )pkce_verifier=([^;]+)/)
          if (m) verifier = decodeURIComponent(m[1])
        } catch {}
      }
      if (!verifier) {
        try {
          const stateRaw = params.get('state') || ''
          const state = decodeURIComponent(stateRaw)
          if (state && state.startsWith('pkce:')) verifier = state.slice('pkce:'.length)
        } catch {}
      }
      const body = new URLSearchParams()
      body.set('grant_type', 'authorization_code')
      body.set('code', code)
      body.set('redirect_uri', (window as any).__SF_REDIRECT_URI__ || `${window.location.origin}/oauth/callback`)
      body.set('code_verifier', verifier)
      const clientId = (window as any).__SF_CLIENT_ID__ || ''
      body.set('client_id', clientId)
      if (clientSecret) body.set('client_secret', clientSecret)

      const res = await fetch('/services/oauth2/token', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      let j: any = null
      try { j = await res.json() } catch (err) { const txt = await res.text(); setStatus(`Token exchange failed: ${res.status} — ${txt.slice(0,200)}`); setRetrying(false); return }
      if (!res.ok) {
        setLastError(j)
        setStatus(`Token exchange failed: ${res.status} — ${j && (j.error_description || j.error)}`)
        setRetrying(false)
        return
      }
      // success
      const inst = j.instance_url || window.location.origin
      const tok = j.access_token || ''
      saveSettings({ instanceUrl: inst, token: tok })
      sessionStorage.setItem('sf_token', JSON.stringify(j))
      try { document.cookie = 'pkce_verifier=; Max-Age=0; path=/; samesite=Lax' } catch {}
      try { document.cookie = 'pkce_challenge=; Max-Age=0; path=/; samesite=Lax' } catch {}
      setStatus('Success — redirecting to app')
      console.debug('Token exchange success (retry)', j)
      setTimeout(() => window.location.replace('/'), 800)
    } catch (e: any) {
      setStatus(String(e && e.message ? e.message : e))
    } finally { setRetrying(false) }
  }

  return (
    <div style={{ padding: 16 }}>
      <div>{status}</div>
      {debug ? (
        <div style={{ marginTop: 12, fontSize: 12, color: '#333' }}>
          <div><strong>PKCE debug</strong></div>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: 8, borderRadius: 6 }}>{JSON.stringify(debug, null, 2)}</pre>
        </div>
      ) : null}
      {lastError ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12 }}><strong>Token exchange error (dev)</strong></div>
          <pre style={{ background: '#fff3f3', padding: 8, borderRadius: 6, color: '#a00' }}>{JSON.stringify(lastError, null, 2)}</pre>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <input placeholder="Client secret (dev)" value={clientSecret} onChange={e => setClientSecret(e.target.value)} style={{ padding: 8 }} />
            <button onClick={() => retryWithSecret()} disabled={retrying} style={{ padding: 8 }}>{retrying ? 'Retrying…' : 'Retry with client secret'}</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

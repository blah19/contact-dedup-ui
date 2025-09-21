import { useEffect, useState } from 'react'
import { loadSettings, saveSettings } from '../lib/storage'
import { generateCodeVerifier, generateCodeChallenge, buildAuthUrl } from '../lib/pkce'

type Props = { onChange: (instanceUrl: string, token: string) => void }

export default function ConnectionForm({ onChange }: Props) {
  const initial = loadSettings()
  const [instanceUrl, setInstanceUrl] = useState(initial.instanceUrl)
  const [token, setToken] = useState(initial.token)
  const [autoLoaded, setAutoLoaded] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  // On mount, try to load a local /token.json for developer convenience.
  useEffect(() => {
    let mounted = true
    async function tryLoadLocalToken() {
      try {
        const isLocal = typeof window !== 'undefined' && /(^localhost$|^127\.0\.0\.1$)/.test(window.location.hostname)

        // Consider saved settings empty if they're only whitespace
        const savedInstance = (initial.instanceUrl || '').trim()
        const savedToken = (initial.token || '').trim()

        // If not local and we already have saved settings, skip attempting to fetch the public token.json
        if (!isLocal && (savedInstance || savedToken)) return

        // Attempt to fetch token.json (cache-busted)
        const res = await fetch(`/token.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return

        let j: any
        try {
          j = await res.json()
        } catch (err: any) {
          return
        }
        if (!mounted) return
        if (j.instance_url && j.access_token) {
          const inst = j.instance_url || ((isLocal && !savedInstance) ? window.location.origin : '')
          const tok = j.access_token
          setInstanceUrl(inst)
          setToken(tok)
          setAutoLoaded(true)
          try { onChange(inst, tok) } catch {}
          try {
            if (isLocal && typeof window !== 'undefined') {
              const port = window.location.port || '80'
              if (port !== '5173') {
                window.location.replace(`http://127.0.0.1:5173${window.location.pathname}${window.location.search}`)
              }
            }
          } catch { }
        }
      } catch (err) {
       
      }
    }
    tryLoadLocalToken()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    onChange(instanceUrl, token)
    saveSettings({ instanceUrl, token })
  }, [instanceUrl, token, onChange])

  // If we have tokens loaded, don't show the login button
  if (autoLoaded || (instanceUrl && token)) {
    return null
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
      <button
        onClick={async () => {
          // start PKCE auth flow and navigate directly
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
            // Navigate directly to the auth URL instead of showing preview
            window.location.href = url
          } catch (err) {
            setLoginError(String(err && (err as any).message ? (err as any).message : err))
          }
        }}
        style={{ 
          padding: '12px 24px', 
          borderRadius: 8, 
          border: '1px solid #007acc', 
          background: '#0070f3', 
          color: 'white',
          fontSize: '16px', 
          fontWeight: '500',
          cursor: 'pointer',
          transition: 'background-color 0.2s ease'
        }}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#005bb5'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#0070f3'}
      >
        Login with Salesforce
      </button>
      {loginError ? (
        <div style={{ color: 'crimson', fontSize: 12, textAlign: 'center' }}>
          {loginError}
        </div>
      ) : null}
    </div>
  )
}

import { requestJson } from './http'
import type { ListMatchesResponse } from '../types/api'

export type ApiConfig = { baseUrl: string; token: string }

function url(c: ApiConfig, path: string) {
  // If running in the browser on localhost, prefer a relative URL so the
  // Vite dev server proxy will forward the request and avoid browser CORS.
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    const isLocal = /(^localhost$|^127\.0\.0\.1$)/.test(hostname)
    // Also if the configured baseUrl matches the current origin, use relative
    const originMatch = c.baseUrl && c.baseUrl.replace(/\/+$/, '') === `${window.location.origin}`
    if (isLocal || originMatch) {
      return `/services/apexrest/v1${path}`
    }
  }
  const base = c.baseUrl.replace(/\/+$/, '')
  return `${base}/services/apexrest/v1${path}`
}

function auth(c: ApiConfig) {
  return { Authorization: `Bearer ${c.token}` }
}

export async function listPending(c: ApiConfig) {
  const u = url(c, '/duplicate-matches?status=pending&expand=customerA,customerB')
  return requestJson<ListMatchesResponse>(u, { headers: auth(c) })
}

export async function resolveMatch(c: ApiConfig, id: string, status: 'merged' | 'ignored') {
  const u = url(c, `/duplicate-matches/${encodeURIComponent(id)}`)
  return requestJson<void>(u, {
    method: 'PATCH',
    headers: { ...auth(c), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  })
}

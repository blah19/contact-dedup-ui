import { requestJson } from './http'
import type { ListMatchesResponse } from '../types/api'

export type ApiConfig = { baseUrl: string; token: string }

function url(c: ApiConfig, path: string) {
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

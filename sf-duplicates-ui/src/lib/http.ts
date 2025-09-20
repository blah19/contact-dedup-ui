import type { Problem } from '../types/api'

export class HttpError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, init)
  if (r.status === 204) return undefined as unknown as T
  if (r.ok) return r.json() as Promise<T>
  const text = await r.text()
  try {
    const p = JSON.parse(text) as Problem
    throw new HttpError(p.title + (p.detail ? ': ' + p.detail : ''), p.status || r.status)
  } catch (err: unknown) {
    // If parsing failed, fall back to raw text
    throw new HttpError((err instanceof Error ? err.message : text) || `HTTP ${r.status}`, r.status)
  }
}

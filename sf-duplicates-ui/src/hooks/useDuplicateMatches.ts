import { useCallback, useEffect, useState } from 'react'
import type { MatchItem } from '../types/api'
import type { ApiConfig } from '../lib/api'
import { listPending, resolveMatch } from '../lib/api'
import { HttpError } from '../lib/http'

export function useDuplicateMatches(cfg: ApiConfig | null) {
  const [items, setItems] = useState<MatchItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!cfg) return
    setLoading(true)
    setError(null)
    try {
      const res = await listPending(cfg)
      setItems(res.items)
    } catch (e: unknown) {
      if (e instanceof HttpError) setError(e.message)
      else if (e instanceof Error) setError(e.message)
      else setError('Request failed')
    } finally {
      setLoading(false)
    }
  }, [cfg])

  const act = useCallback(
    async (id: string, status: 'merged' | 'ignored') => {
      if (!cfg) return
      setError(null)
      setItems(prev => (prev ? prev.filter(x => x.id !== id) : prev))
      try {
        await resolveMatch(cfg, id, status)
      } catch (e: unknown) {
        if (e instanceof HttpError) setError(e.message)
        else if (e instanceof Error) setError(e.message)
        else setError('Request failed')
        await fetchAll()
      }
    },
    [cfg, fetchAll]
  )

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  return { items, loading, error, refresh: fetchAll, act }
}

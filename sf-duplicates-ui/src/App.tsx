import { useCallback, useMemo, useState } from 'react'
import ConnectionForm from './components/ConnectionForm'
import DuplicateTable from './components/DuplicateTable'
import { useDuplicateMatches } from './hooks/useDuplicateMatches'

export default function App() {
  const [instanceUrl, setInstanceUrl] = useState('')
  const [token, setToken] = useState('')

  const cfg = useMemo(() => {
    if (!instanceUrl || !token) return null
    return { baseUrl: instanceUrl, token }
  }, [instanceUrl, token])

  const { items, loading, error, refresh, act } = useDuplicateMatches(cfg)

  const onChange = useCallback((u: string, t: string) => {
    setInstanceUrl(u)
    setToken(t)
  }, [])

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Salesforce Duplicate Contacts</h1>
      <ConnectionForm onChange={onChange} />
      {!cfg ? (
        <div style={{ color: '#555' }}>Login with Salesforce first</div>
      ) : (
        <DuplicateTable
          items={items ?? []}
          loading={loading}
          error={error}
          onMerge={(id: string) => act(id, 'merged')}
          onIgnore={(id: string) => act(id, 'ignored')}
          onRefresh={refresh}
        />
      )}
    </div>
  )
}

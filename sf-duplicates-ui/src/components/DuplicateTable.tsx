import type { MatchItem } from '../types/api'

type Props = {
  items: MatchItem[]
  loading: boolean
  error: string | null
  onMerge: (id: string) => void
  onIgnore: (id: string) => void
  onRefresh: () => void
}

function nameOf(c?: MatchItem['customerA']) {
  if (!c) return ''
  const n = [c.firstName ?? '', c.lastName ?? ''].join(' ').trim()
  return n || c.email || c.id
}

export default function DuplicateTable({ items, loading, error, onMerge, onIgnore, onRefresh }: Props) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', background: '#fafafa' }}
        >
          Refresh
        </button>
        {loading && <span>Loading…</span>}
        {error && <span style={{ color: '#a00' }}>{error}</span>}
      </div>
      {items.length === 0 ? (
        <div>No pending matches</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Customer A</th>
              <th style={th}>Customer B</th>
              <th style={thSmall}>Score</th>
              <th style={thSmall}>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map(row => (
              <tr key={row.id}>
                <td style={td}>{nameOf(row.customerA)}</td>
                <td style={td}>{nameOf(row.customerB)}</td>
                <td style={tdSmall}>{row.score}</td>
                <td style={tdSmall}>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button style={btn} onClick={() => onMerge(row.id)}>Merge</button>
                    <button style={btn} onClick={() => onIgnore(row.id)}>Ignore</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px 6px' }
const thSmall: React.CSSProperties = { textAlign: 'center', borderBottom: '1px solid #ddd', padding: '8px 6px', width: 120 }
const td: React.CSSProperties = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px' }
const tdSmall: React.CSSProperties = { borderBottom: '1px solid #f0f0f0', padding: '8px 6px', textAlign: 'center' }
const btn: React.CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }

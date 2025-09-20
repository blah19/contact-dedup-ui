import { useEffect, useState } from 'react'
import { loadSettings, saveSettings } from '../lib/storage'

type Props = { onChange: (instanceUrl: string, token: string) => void }

export default function ConnectionForm({ onChange }: Props) {
  const initial = loadSettings()
  const [instanceUrl, setInstanceUrl] = useState(initial.instanceUrl)
  const [token, setToken] = useState(initial.token)

  useEffect(() => {
    onChange(instanceUrl, token)
    saveSettings({ instanceUrl, token })
  }, [instanceUrl, token, onChange])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, marginBottom: 12 }}>
      <input
        placeholder="https://yourinstance.my.salesforce.com"
        value={instanceUrl}
        onChange={e => setInstanceUrl(e.target.value)}
        style={{ padding: 8, border: '1px solid #ccc', borderRadius: 8 }}
      />
      <input
        placeholder="Bearer token"
        value={token}
        onChange={e => setToken(e.target.value)}
        style={{ padding: 8, border: '1px solid #ccc', borderRadius: 8 }}
      />
      <button
        onClick={() => onChange(instanceUrl, token)}
        style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', background: '#fafafa' }}
      >
        Apply
      </button>
    </div>
  )
}

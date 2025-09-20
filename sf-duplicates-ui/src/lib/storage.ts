const KEY = 'sf-dup-ui-settings'
export type Settings = { instanceUrl: string; token: string }
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { instanceUrl: '', token: '' }
    const parsed = JSON.parse(raw)
    return { instanceUrl: parsed.instanceUrl ?? '', token: parsed.token ?? '' }
  } catch {
    return { instanceUrl: '', token: '' }
  }
}
export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

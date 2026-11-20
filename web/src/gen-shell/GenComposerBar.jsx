import { useEffect, useRef, useState } from 'react'

// GEN-MOD: 输入框模型选择（仿 DSH：一个小胶囊 + 浮层两行）
const EFFORT_LABEL = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High', max: 'Max' }

function shortModel(id = '') {
  return String(id).replace(/^deepseek-/, '').replace(/^kimi-/, '').replace(/-/g, ' ')
}

export default function GenComposerBar() {
  const [settings, setSettings] = useState(null)
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState('')
  const [saved, setSaved] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    fetch('/api/gen/settings').then(r => r.json()).then(setSettings).catch(() => {})
  }, [])

  useEffect(() => {
    if (!open) return
    const close = e => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])

  if (!settings) return null
  const provider = settings.main.provider || 'deepseek'
  const model = settings.main.model || 'deepseek-v4-flash'
  const effort = settings.main.reasoningEffort || 'high'
  const eager = EFFORT_LABEL[effort] || effort
  const isKimi = provider === 'kimi'

  async function save(next) {
    try {
      const r = await fetch('/api/gen/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ main: { provider, model, ...next } }),
      })
      const data = await r.json()
      if (r.ok) {
        setSettings(data.settings)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch { /* ignore */ }
  }

  const chip = shortModel(model)

  return <div className="gen-model" ref={rootRef}>
    <button
      type="button"
      className="gen-model-chip"
      title={`主模型：${isKimi ? 'Kimi' : 'DeepSeek'} / ${model} / ${eager}（选择后重启网关生效）`}
      onClick={() => { setOpen(v => !v); setSub('') }}
    >
      {saved ? '✓ 已保存' : chip}
    </button>

    {open && <div className="gen-model-pop">
      <div
        className={`gm-row${sub === 'model' ? ' on' : ''}`}
        onClick={() => setSub(v => v === 'model' ? '' : 'model')}
      >
        <span>模型</span><b>{shortModel(model)}</b><i>›</i>
      </div>
      {sub === 'model' && <div className="gm-list">
        {Object.entries(settings.main.models || {}).map(([prov, list]) => <div key={prov}>
          <div className="gm-group">{prov === 'kimi' ? 'Kimi for Coding' : 'DeepSeek'}</div>
          {list.map(m => <div
            key={`${prov}/${m.id}`}
            className={`gm-item${prov === provider && m.id === model ? ' on' : ''}`}
            onClick={() => { save({ provider: prov, model: m.id }); setOpen(false); setSub('') }}
          >{m.id}</div>)}
        </div>)}
      </div>}
      <div
        className={`gm-row${sub === 'effort' ? ' on' : ''}`}
        onClick={() => setSub(v => v === 'effort' ? '' : 'effort')}
      >
        <span>推理等级</span><b>{eager}</b><i>›</i>
      </div>
      {sub === 'effort' && <div className="gm-list">
        {(settings.main.reasoningEfforts || []).map(e => <div
          key={e.id}
          className={`gm-item${e.id === effort ? ' on' : ''}`}
          onClick={() => { save({ reasoningEffort: e.id }); setOpen(false); setSub('') }}
        >{e.label}</div>)}
      </div>}
    </div>}
  </div>
}

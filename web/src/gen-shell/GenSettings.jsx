import { useEffect, useState } from 'react'

const modelOptions = [
  'qwen-audio-3.1-realtime-flash',
  'qwen-audio-3.1-realtime-plus',
  'qwen-audio-3.0-realtime-flash',
]

export default function GenSettings() {
  const [settings, setSettings] = useState(null)
  const [account, setAccount] = useState(null)
  const [usage, setUsage] = useState(null)
  const [rtKey, setRtKey] = useState('')
  const [mainKey, setMainKey] = useState('')
  const [model, setModel] = useState('')
  const [mainProvider, setMainProvider] = useState('deepseek')
  const [mainModel, setMainModel] = useState('deepseek-v4-flash')
  const [retention, setRetention] = useState('30')
  const [voiceCurrent, setVoiceCurrent] = useState('longanqian_v3.1')
  const [voiceSpeed, setVoiceSpeed] = useState(1)
  const [voiceOptions, setVoiceOptions] = useState([])
  const [previewBusy, setPreviewBusy] = useState(false)
  const [meetingAsr, setMeetingAsr] = useState(() => localStorage.getItem('gen-meeting-asr') || 'streaming')
  const native = typeof window !== 'undefined' && window.GenNative ? window.GenNative : null
  const [notifyAccess, setNotifyAccess] = useState(false)
  const [batteryOk, setBatteryOk] = useState(true)
  const [email, setEmail] = useState({ enabled: false, address: '', host: 'imap.gmail.com', port: '993', user: '', password: '', pollMinutes: '15' })
  const [emailMsg, setEmailMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    try {
      const [s, a, u] = await Promise.all([
        fetch('/api/gen/settings').then(r => r.json()),
        fetch('/api/gen/account').then(r => r.json()),
        fetch('/api/gen/usage').then(r => r.json()),
      ])
      setSettings(s)
      setAccount(a)
      setUsage(u)
      setModel(s?.realtime?.model || modelOptions[0])
      setMainProvider(s?.main?.provider || 'deepseek')
      setMainModel(s?.main?.model || 'deepseek-v4-flash')
      setRetention(String(s?.diary?.retentionDays ?? 30))
      if (s?.voice) {
        setVoiceCurrent(s.voice.current || 'longanqian_v3.1')
        setVoiceSpeed(Number(s.voice.speed) || 1)
        setVoiceOptions(s.voice.options || [])
      }
      setEmail({
        enabled: Boolean(s?.email?.enabled),
        address: s?.email?.address || '',
        host: s?.email?.host || 'imap.gmail.com',
        port: String(s?.email?.port || 993),
        user: s?.email?.user || s?.email?.address || '',
        password: '',
        pollMinutes: String(s?.email?.pollMinutes || 15),
        passwordPresent: Boolean(s?.email?.password?.present),
        passwordHint: s?.email?.password?.hint || '',
      })
    } catch {
      setMessage('读取设置失败')
    }
  }

  useEffect(() => {
    setMessage('')
    void load()
  }, [])

  async function refreshAccount() {
    setChecking(true)
    try {
      const [a, u] = await Promise.all([
        fetch('/api/gen/account').then(r => r.json()),
        fetch('/api/gen/usage').then(r => r.json()),
      ])
      setAccount(a)
      setUsage(u)
    } finally { setChecking(false) }
  }

  async function syncEmailNow() {
    setEmailMsg('收取中…（Gmail 需 app password，且本网络直连 Gmail IMAP 可能被墙）')
    try {
      const r = await fetch('/api/gen/email/sync', { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || '收取失败')
      setEmailMsg(`已收取 ${d.added || 0} 封新邮件`)
      void load()
    } catch (error) {
      setEmailMsg(`收取失败：${error.message}`)
    }
  }

  async function applyVoice() {
    setSaving(true)
    setMessage('正在应用音色…')
    try {
      const r = await fetch('/api/gen/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voice: { current: voiceCurrent, speed: Number(voiceSpeed) || 1 } }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || '保存失败')
      setSettings(d.settings)
      setMessage('已应用。正在重连语音使音色生效…')
      setTimeout(() => { window.location.reload() }, 1200)
    } catch (error) {
      setMessage(`应用失败：${error.message}`)
    } finally { setSaving(false) }
  }

  async function previewVoice() {
    setPreviewBusy(true)
    setMessage('正在生成试听…')
    try {
      const r = await fetch('/api/gen/voice/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voice: voiceCurrent }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || '试听失败')
      const audio = new Audio(`data:audio/wav;base64,${d.wav}`)
      await audio.play()
      setMessage(`正在试听：${voiceCurrent}`)
    } catch (error) {
      setMessage(`试听失败：${error.message}`)
    } finally { setPreviewBusy(false) }
  }

  useEffect(() => {
    try {
      if (!native) return
      setNotifyAccess(Boolean(native.hasNotificationAccess?.()))
      setBatteryOk(Boolean(native.isIgnoringBatteryOptimizations?.()))
    } catch { /* ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      const body = { realtime: {}, main: {} }
      if (rtKey.trim()) body.realtime.apiKey = rtKey.trim()
      if (mainKey.trim()) body.main.apiKey = mainKey.trim()
      if (model) body.realtime.model = model
      body.main = { provider: mainProvider, model: mainModel }
      body.diary = { retentionDays: Number(retention) }
      body.voice = { current: voiceCurrent, speed: Number(voiceSpeed) || 1 }
      body.email = {
        enabled: Boolean(email.enabled),
        address: email.address,
        host: email.host,
        port: Number(email.port) || 993,
        user: email.user,
        pollMinutes: Number(email.pollMinutes) || 15,
      }
      if (email.password) body.email.password = email.password
      if (mainKey.trim()) body.main.apiKey = mainKey.trim()
      const r = await fetch('/api/gen/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || '保存失败')
      setSettings(data.settings)
      setRtKey('')
      setMainKey('')
      setMessage('已保存。Key 写入 config.env，重启网关后生效（当前会话不受影响）。')
      void refreshAccount()
    } catch (error) {
      setMessage(`保存失败：${error.message}`)
    } finally { setSaving(false) }
  }

  const keyBadge = (info) => info?.present
    ? <span className="gen-set-badge ok">已配置 · {info.hint}{info.source ? ` · ${info.source}` : ''}</span>
    : <span className="gen-set-badge off">未配置</span>

  return <div className="gd gen-set-page">
    <div className="gd-head">
      <b>设置</b>
      <span className="gd-count" style={{ marginLeft: 'auto' }}>Key 只写入服务器 config.env（0600），不会下发到浏览器</span>
      <button className="gd-btn primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
    </div>
    <div className="gen-set-body gen-set-body-page">
        <section className="gen-set-sec">
          <h4>语音模型（说话与聆听）</h4>
          <div className="gen-set-row">
            <span className="lab">提供商</span>
            <span className="val">DashScope · 阿里云百炼</span>
          </div>
          <div className="gen-set-row">
            <span className="lab">模型</span>
            <select value={model} onChange={e => setModel(e.target.value)}>
              {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="gen-set-row">
            <span className="lab">API Key</span>
            <div className="gen-set-key">
              {settings?.realtime?.apiKey ? keyBadge(settings.realtime.apiKey) : null}
              <input
                type="password"
                placeholder={settings?.realtime?.apiKey?.present ? `替换 Key（当前 ${settings.realtime.apiKey.hint}）` : '粘贴 DashScope API Key（sk-…）'}
                value={rtKey}
                onChange={e => setRtKey(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
        </section>

        <section className="gen-set-sec">
          <h4>主模型（后台执行 · DSH）</h4>
          <div className="gen-set-row">
            <span className="lab">通道</span>
            <span className="val">DSH（dsh --profile acp）· 后台执行始终由 DSH 承担</span>
          </div>
          <div className="gen-set-row">
            <span className="lab">提供商</span>
            <select value={mainProvider} onChange={e => {
              setMainProvider(e.target.value)
              const list = settings?.main?.models?.[e.target.value] || []
              setMainModel(list[0]?.id || '')
            }}>
              <option value="deepseek">DeepSeek（官方）</option>
              <option value="kimi">Kimi for Coding（Kimi Code）</option>
            </select>
          </div>
          <div className="gen-set-row">
            <span className="lab">模型</span>
            <select value={mainModel} onChange={e => setMainModel(e.target.value)}>
              {(settings?.main?.models?.[mainProvider] || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="gen-set-row">
            <span className="lab">API Key</span>
            <div className="gen-set-key">
              {mainProvider === 'kimi'
                ? (settings?.main?.kimiApiKey ? keyBadge(settings.main.kimiApiKey) : null)
                : (settings?.main?.apiKey ? keyBadge(settings.main.apiKey) : null)}
              <input
                type="password"
                placeholder={mainProvider === 'kimi'
                  ? (settings?.main?.kimiApiKey?.present ? `替换 Kimi Key（当前 ${settings.main.kimiApiKey.hint}）` : '粘贴 Kimi for Coding API Key（sk-…）')
                  : (settings?.main?.apiKey?.present ? `替换 Key（当前 ${settings.main.apiKey.hint}）` : '粘贴 DeepSeek API Key（sk-…）')}
                value={mainKey}
                onChange={e => setMainKey(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="gen-set-row">
            <span className="lab">状态</span>
            <span className="val muted">保存后重启网关生效；后台执行始终是 DSH，切换的是 DSH 使用的模型</span>
          </div>
        </section>

        <section className="gen-set-sec">
          <h4>数据与备份</h4>
          <div className="gen-set-row">
            <span className="lab">日记回收站保留</span>
            <input style={{ width: 70 }} value={retention} onChange={e => setRetention(e.target.value)} />
            <span className="val muted">天（0–3650）</span>
          </div>
          <div className="gen-set-row">
            <span className="lab">导出</span>
            <span className="val muted">日记页右上「导出」可导出当天 Markdown</span>
          </div>
        </section>

        <section className="gen-set-sec">
          <h4>声音（音色与语速）</h4>
          <div className="gen-set-row">
            <span className="lab">音色</span>
            <select value={voiceCurrent} onChange={e => setVoiceCurrent(e.target.value)}>
              {voiceOptions.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <button className="mini" onClick={previewVoice} disabled={previewBusy}>{previewBusy ? '生成中…' : '试听'}</button>
            <button className="mini" onClick={applyVoice} disabled={saving}>应用</button>
          </div>
          <div className="gen-set-row">
            <span className="lab">语速</span>
            <input
              type="number"
              min="0.5"
              max="2"
              step="0.05"
              value={voiceSpeed}
              onChange={e => setVoiceSpeed(e.target.value)}
              style={{ width: 80 }}
            />
            <span className="val muted">倍（0.5–2.0，1 = 正常）</span>
            {[0.8, 1, 1.2, 1.5].map(v => <button key={v} className="mini" onClick={() => setVoiceSpeed(v)}>{v}×</button>)}
          </div>
          <div className="gen-set-row">
            <span className="lab">说明</span>
            <span className="val muted">试听用当前语音模型实时合成；点「应用」保存并重连语音，立即生效。</span>
          </div>
        </section>

        {native && <section className="gen-set-sec">
          <h4>手机同步</h4>
          <>
            <div className="gen-set-row">
              <span className="lab">通知使用权</span>
              <span className="val">{notifyAccess ? '已授权 ✅' : '未授权 ⚠️'}</span>
              <button className="mini" onClick={() => { native.openNotificationSettings?.(); setTimeout(() => setNotifyAccess(Boolean(native.hasNotificationAccess?.())), 1500) }}>去授权</button>
            </div>
            <div className="gen-set-row">
              <span className="lab">电池优化</span>
              <span className="val">{batteryOk ? '已加入白名单 ✅' : '受系统限制，可能被杀 ⚠️'}</span>
              <button className="mini" onClick={() => { native.requestIgnoreBatteryOptimizations?.(); setTimeout(() => setBatteryOk(Boolean(native.isIgnoringBatteryOptimizations?.())), 2000) }}>去设置</button>
            </div>
            <div className="gen-set-row">
              <span className="lab">立即同步</span>
              <button className="mini" onClick={() => native.syncNotifications?.()}>同步通知</button>
            </div>
          </>
        </section>}

        <section className="gen-set-sec">
          <h4>会议</h4>
          <div className="gen-set-row">
            <span className="lab">转写方式</span>
            <select
              value={meetingAsr}
              onChange={e => {
                setMeetingAsr(e.target.value)
                localStorage.setItem('gen-meeting-asr', e.target.value)
              }}
            >
              <option value="streaming">实时流式（边录边出字，约 ¥1–3/小时）</option>
              <option value="batch">结束后转写（约 ¥0.3/小时）</option>
            </select>
          </div>
          <div className="gen-set-row">
            <span className="lab">说明</span>
            <span className="val muted">实时流式延迟 1–3 秒；结束后转写延迟 5–10 秒但便宜 5–10 倍。会议页也可临时切换。</span>
          </div>
        </section>

        <section className="gen-set-sec">
          <h4>账户与用量</h4>
          <div className="gen-set-account">
            <div className="acc-card">
              <div className="acc-top"><span>主模型余额</span><button className="mini" onClick={refreshAccount} disabled={checking}>{checking ? '查询中…' : '刷新'}</button></div>
              {account?.deepseek?.ok
                ? account.deepseek.balances?.map(b => <b key={b.currency}>{b.currency} ¥{b.total}</b>)
                : <b className="bad">{account?.deepseek?.error || '—'}</b>}
              <small>DeepSeek 官方接口实时查询{account?.deepseek?.checkedAt ? ` · ${new Date(account.deepseek.checkedAt).toLocaleTimeString()}` : ''}</small>
            </div>
            <div className="acc-card">
              <div className="acc-top"><span>语音模型余额</span></div>
              <b className="hint">sk Key 无法查余额</b>
              <small>{account?.dashscope?.hint || '请在百炼控制台查看'}</small>
            </div>
          </div>
          <div className="gen-usage">
            <div className="gen-usage-head"><span>语音用量（本机账本）</span><button className="mini" onClick={refreshAccount} disabled={checking}>{checking ? '刷新中…' : '刷新'}</button></div>
            {usage?.voice?.supported
              ? <>
                <div className="gen-usage-grid">
                  <div><small>今日</small><b>{usage.voice.today.responses} 次回应</b><span>输入 {usage.voice.today.input} · 输出 {usage.voice.today.output} tokens</span><em>≈ ¥{usage.voice.today.cost}</em></div>
                  <div><small>本月</small><b>{usage.voice.month.responses} 次回应</b><span>音频入 {usage.voice.month.audioIn} · 出 {usage.voice.month.audioOut} tokens</span><em>≈ ¥{usage.voice.month.cost}</em></div>
                </div>
                <small className="gen-usage-note">单价：文本入 ¥1.5 / 音频入 ¥6 / 文本出 ¥4.5 / 音频出 ¥12 每百万 token（百炼华北2）</small>
              </>
              : <span className="val muted">账本未启用（需重启网关）</span>}
          </div>
        </section>

        {message && <div className="gen-set-msg">{message}</div>}
    </div>
  </div>
}

import { useEffect, useState } from 'react'

const TABS = [['inbox', '收件箱'], ['compose', '写信'], ['settings', '设置']]

export default function GenEmail() {
  const [tab, setTab] = useState('inbox')
  const [filter, setFilter] = useState('normal')
  const [query, setQuery] = useState('')
  const [emails, setEmails] = useState([])
  const [detail, setDetail] = useState(null)
  const [status, setStatus] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ to: '', subject: '', text: '' })
  const [cfg, setCfg] = useState({
    enabled: false, address: '', host: 'imap.163.com', port: '993', user: '',
    password: '', pollMinutes: '15', smtpHost: '', smtpPort: '465',
  })

  async function load() {
    const [list, st, settings] = await Promise.all([
      fetch(`/api/gen/email/list?limit=60&flag=${filter}&q=${encodeURIComponent(query)}`).then(r => r.json()).catch(() => ({ emails: [] })),
      fetch('/api/gen/email/status').then(r => r.json()).catch(() => null),
      fetch('/api/gen/settings').then(r => r.json()).catch(() => null),
    ])
    setEmails(list.emails || [])
    setStatus(st)
    const e = settings?.email
    if (e) {
      setCfg({
        enabled: Boolean(e.enabled),
        address: e.address || '',
        host: e.host || 'imap.163.com',
        port: String(e.port || 993),
        user: e.user || e.address || '',
        password: '',
        pollMinutes: String(e.pollMinutes || 15),
        smtpHost: e.smtpHost || '',
        smtpPort: String(e.smtpPort || 465),
        passwordPresent: Boolean(e.password?.present),
        passwordHint: e.password?.hint || '',
      })
    }
  }

  useEffect(() => { void load() }, [filter])

  async function syncNow() {
    setBusy(true)
    setMsg('收取中…')
    try {
      const r = await fetch('/api/gen/email/sync', { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || '收取失败')
      setMsg(`新增 ${d.added || 0} 封`)
      void load()
    } catch (error) {
      setMsg(`收取失败：${error.message}`)
    } finally { setBusy(false) }
  }

  async function act(id, action) {
    try {
      if (action === 'junk') await fetch(`/api/gen/email/${encodeURIComponent(id)}/flag`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flag: 'junk' }) })
      else if (action === 'unjunk') await fetch(`/api/gen/email/${encodeURIComponent(id)}/flag`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flag: '' }) })
      else if (action === 'delete') await fetch(`/api/gen/email/${encodeURIComponent(id)}`, { method: 'DELETE' })
      else if (action === 'junk-sender') {
        const mail = detail?.id === id ? detail : null
        const from = mail?.from || emails.find(m => m.id === id)?.from || ''
        await fetch('/api/gen/email/junk-sender', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from }) })
      }
      else if (action === 'restore') await fetch(`/api/gen/email/${encodeURIComponent(id)}/restore`, { method: 'POST' })
      else if (action === 'purge') await fetch(`/api/gen/email/${encodeURIComponent(id)}/purge`, { method: 'POST' })
      if (detail?.id === id) setDetail(null)
      void load()
    } catch { setMsg('操作失败') }
  }

  async function openDetail(id) {
    const r = await fetch(`/api/gen/email/detail/${encodeURIComponent(id)}`)
    const d = await r.json()
    if (!d.error) setDetail(d.email)
  }

  async function send() {
    if (!form.to.trim() || !form.subject.trim()) { setMsg('收件人和主题必填'); return }
    setBusy(true)
    setMsg('发送中…')
    try {
      const r = await fetch('/api/gen/email/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || '发送失败')
      setMsg('已发送')
      setForm({ to: '', subject: '', text: '' })
    } catch (error) {
      setMsg(`发送失败：${error.message}`)
    } finally { setBusy(false) }
  }

  async function saveCfg() {
    setBusy(true)
    setMsg('保存中…')
    try {
      const body = { email: {
        enabled: Boolean(cfg.enabled),
        address: cfg.address,
        host: cfg.host,
        port: Number(cfg.port) || 993,
        user: cfg.user,
        pollMinutes: Number(cfg.pollMinutes) || 15,
        smtpHost: cfg.smtpHost,
        smtpPort: Number(cfg.smtpPort) || 465,
      } }
      if (cfg.password) body.email.password = cfg.password
      const r = await fetch('/api/gen/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || '保存失败')
      setMsg('已保存配置')
      void load()
    } catch (error) {
      setMsg(`保存失败：${error.message}`)
    } finally { setBusy(false) }
  }

  function fmt(ms) {
    if (!ms) return ''
    return new Date(ms).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return <div className="gd">
    <div className="gd-head">
      <b>邮箱</b>
      <div className="gd-tabs">
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <span className="gd-count" style={{ marginLeft: 'auto' }}>{status?.address || '未配置'}</span>
      {filter === 'deleted' && <button className="gd-btn" onClick={async () => {
        if (!window.confirm('彻底删除所有已删除邮件？不可恢复')) return
        await fetch('/api/gen/email/purge-all', { method: 'POST' })
        void load()
      }}>清空已删除</button>}
      <button className="gd-btn" disabled={busy} onClick={syncNow}>立即收取</button>
    </div>

    {tab === 'inbox' && <>
      <div className="gen-mail-filters">
        {[['normal', '正常'], ['junk', '垃圾'], ['deleted', '已删除'], ['all', '全部']].map(([k, label]) => (
          <span key={k} className={`gd-fchip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{label}</span>
        ))}
      </div>
      <div className="gen-mail-searchrow">
        <input
          className="gen-mail-search"
          placeholder="搜索主题/发件人/正文…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void load() }}
        />
        <button className="gd-btn" onClick={() => void load()}>搜索</button>
      </div>
    </>}

    {msg && <div className="gen-set-msg">{msg}</div>}

    {tab === 'inbox' && <div className="gen-mail-layout">
      <div className="gen-mail-list">
        {emails.length === 0 && <div className="gd-empty">还没有邮件。<br /><small>点「立即收取」或等待自动同步。</small></div>}
        {emails.map(mail => <div key={mail.id} className="gen-mail-item" onClick={() => openDetail(mail.id)}>
          <div className="gen-mail-top">
            <b>{mail.subject || '(无主题)'}</b>
            <span>{fmt(mail.dateAt)}</span>
          </div>
          <div className="gen-mail-from">{mail.from}</div>
          <div className="gen-mail-snippet">{mail.snippet}</div>
          <div className="gen-mail-actions" onClick={e => e.stopPropagation()}>
            {mail.deleted
              ? <>
                  <button onClick={() => act(mail.id, 'restore')}>恢复</button>
                  <button onClick={() => act(mail.id, 'purge')}>彻底删除</button>
                </>
              : <>
                  {mail.flagged === 'junk'
                    ? <button onClick={() => act(mail.id, 'unjunk')}>取消垃圾</button>
                    : <button onClick={() => act(mail.id, 'junk')}>标为垃圾</button>}
                  <button onClick={() => act(mail.id, 'delete')}>删除</button>
                </>}
          </div>
        </div>)}
      </div>
      <div className={`gen-mail-detail${detail ? ' open' : ''}`}>
        {!detail && <div className="gd-empty">选择左侧邮件查看内容</div>}
        {detail && <>
          <div className="gen-mail-detail-head">
            <b>{detail.subject}</b>
            <span>{detail.from} · {fmt(detail.dateAt)}</span>
            <div className="gen-mail-actions">
              <button onClick={() => act(detail.id, 'junk')}>标为垃圾</button>
              <button onClick={() => act(detail.id, 'junk-sender')}>此发件人全标垃圾</button>
              <button onClick={() => act(detail.id, 'delete')}>删除</button>
            </div>
          </div>
          <div className="gen-mail-body">{detail.text}</div>
        </>}
      </div>
    </div>}

    {tab === 'compose' && <div className="gd-creative">
      <div className="gd-period">写邮件（通过 {status?.address || '邮箱'} 发送）</div>
      <div className="gd-modal" style={{ width: '100%', maxWidth: 720 }}>
        <label>收件人<input value={form.to} onChange={e => setForm(v => ({ ...v, to: e.target.value }))} placeholder="someone@example.com" /></label>
        <label>主题<input value={form.subject} onChange={e => setForm(v => ({ ...v, subject: e.target.value }))} placeholder="主题" /></label>
        <label>正文<textarea style={{ minHeight: 180, borderRadius: 9, border: '1px solid #ffffff1f', background: '#ffffff0d', color: '#eef6f1', padding: 10, font: 'inherit' }} value={form.text} onChange={e => setForm(v => ({ ...v, text: e.target.value }))} /></label>
        <div className="gd-modal-actions">
          <button className="gd-btn" onClick={() => setForm({ to: '', subject: '', text: '' })}>清空</button>
          <button className="gd-btn primary" disabled={busy} onClick={send}>发送</button>
        </div>
      </div>
    </div>}

    {tab === 'settings' && <div className="gd-creative">
      <div className="gd-period">邮件账户</div>
      <div className="gd-modal" style={{ width: '100%', maxWidth: 640 }}>
        <label className="gd-check"><input type="checkbox" checked={Boolean(cfg.enabled)} onChange={e => setCfg(v => ({ ...v, enabled: e.target.checked }))} />启用定时收取</label>
        <label>邮箱地址<input value={cfg.address} onChange={e => setCfg(v => ({ ...v, address: e.target.value, user: v.user || e.target.value }))} /></label>
        <label>IMAP 主机 / 端口
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ flex: 1 }} value={cfg.host} onChange={e => setCfg(v => ({ ...v, host: e.target.value }))} />
            <input style={{ width: 80 }} value={cfg.port} onChange={e => setCfg(v => ({ ...v, port: e.target.value }))} />
          </div>
        </label>
        <label>账号<input value={cfg.user} onChange={e => setCfg(v => ({ ...v, user: e.target.value }))} /></label>
        <label>授权码<input type="password" value={cfg.password} placeholder={cfg.passwordPresent ? `已配置 ${cfg.passwordHint}（留空不变）` : '客户端授权码'} onChange={e => setCfg(v => ({ ...v, password: e.target.value }))} /></label>
        <label>SMTP 主机 / 端口
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ flex: 1 }} value={cfg.smtpHost} placeholder="smtp.163.com" onChange={e => setCfg(v => ({ ...v, smtpHost: e.target.value }))} />
            <input style={{ width: 80 }} value={cfg.smtpPort} onChange={e => setCfg(v => ({ ...v, smtpPort: e.target.value }))} />
          </div>
        </label>
        <label>收取间隔（分钟）<input style={{ width: 90 }} value={cfg.pollMinutes} onChange={e => setCfg(v => ({ ...v, pollMinutes: e.target.value }))} /></label>
        {status?.lastError && <div className="gen-set-msg">最近错误：{status.lastError}</div>}
        <div className="gd-modal-actions">
          <button className="gd-btn primary" disabled={busy} onClick={saveCfg}>保存</button>
        </div>
      </div>
    </div>}
  </div>
}

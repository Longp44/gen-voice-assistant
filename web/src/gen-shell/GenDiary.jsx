import { useEffect, useState } from 'react'

const CATEGORIES = ['会议记录', '通话记录', '微信记录', '对话记录', '报销', '消费记录', '项目讨论', '学习记录', '任务', '手动记录']

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isAudioFile(file) {
  const mime = String(file?.mime || '')
  const name = String(file?.name || '').toLowerCase()
  return mime.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg|flac|amr)$/.test(name)
}

function isImageFile(file) {
  const mime = String(file?.mime || '')
  const name = String(file?.name || '').toLowerCase()
  return mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic)$/.test(name)
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function periodOf(time) {
  const hour = Number(String(time || '00:00').split(':')[0])
  if (hour < 12) return '上午'
  if (hour < 18) return '下午'
  return '晚上'
}

export default function GenDiary() {
  const [date, setDate] = useState(todayStr())
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('timeline')
  const [subject, setSubject] = useState('全部')
  const [source, setSource] = useState('全部')
  const [category, setCategory] = useState('全部')
  const [manualOpen, setManualOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [mdReader, setMdReader] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [notifyCategory, setNotifyCategory] = useState('all')
  const native = typeof window !== 'undefined' && window.GenNative ? window.GenNative : null
  const [mdSize, setMdSize] = useState(() => Number(localStorage.getItem('gen-md-size')) || 16)
  const [trash, setTrash] = useState(null)
  const [summary, setSummary] = useState(null)
  const [docs, setDocs] = useState([])
  const [docEdit, setDocEdit] = useState(null) // {id, name, content}
  const [docBusy, setDocBusy] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [form, setForm] = useState({ summary: '', category: '手动记录', amount: '', sensitive: false, todo: false, todoTitle: '', todoDue: '' })
  const [busy, setBusy] = useState(false)

  async function load(d = date) {
    try {
      const [diary, sum] = await Promise.all([
        fetch(`/api/gen/diary?date=${d}`).then(r => r.json()),
        fetch(`/api/gen/diary/summary?date=${d}`).then(r => r.json()),
      ])
      setData(diary)
      setSummary(sum)
      const creative = await fetch(`/api/gen/creative?scope=all`).then(r => r.json()).catch(() => ({ docs: [] }))
      setDocs(creative.docs || [])
    } catch { /* ignore */ }
  }

  async function newDoc() {
    const name = `创作-${date}-${new Date().toTimeString().slice(0, 5).replace(':', '')}.md`
    await fetch(`/api/gen/creative/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date, content: `# ${name.replace(/\.md$/, '')}\n\n` }),
    })
    const creative = await fetch(`/api/gen/creative?scope=all`).then(r => r.json())
    setDocs(creative.docs || [])
    const doc = await fetch(`/api/gen/creative/${encodeURIComponent(name)}?date=${date}`).then(r => r.json())
    setDocEdit({ ...doc, date })
  }

  async function openDoc(doc) {
    const docDate = doc.date || date
    const d = await fetch(`/api/gen/creative/${encodeURIComponent(doc.id)}?date=${docDate}`).then(r => r.json())
    if (!d.error) setDocEdit({ ...d, date: docDate })
  }

  async function saveDoc() {
    if (!docEdit) return
    setDocBusy(true)
    try {
      let currentId = docEdit.id
      const desired = docEdit.name.trim().replace(/\.md$/i, '')
      const currentBase = currentId.replace(/\.md$/i, '')
      if (desired && desired !== currentBase) {
        const r = await fetch(`/api/gen/creative/${encodeURIComponent(currentId)}/rename`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ date: docEdit.date || date, name: desired }),
        })
        const d = await r.json()
        if (r.ok) {
          currentId = d.id
          setDocEdit({ ...docEdit, id: currentId, name: d.id })
        }
      }
      await fetch(`/api/gen/creative/${encodeURIComponent(currentId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: docEdit.date || date, content: docEdit.content }),
      })
      const creative = await fetch(`/api/gen/creative?scope=all`).then(r => r.json())
      setDocs(creative.docs || [])
    } finally { setDocBusy(false) }
  }

  async function generateSummary() {
    setSummarizing(true)
    try {
      const r = await fetch('/api/gen/diary/summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const d = await r.json()
      if (r.ok) {
        setSummary({ cached: { text: d.text, model: d.model, stale: false }, rule: summary?.rule })
      }
    } finally { setSummarizing(false) }
  }

  useEffect(() => { void load(date) }, [date])

  function shiftDay(delta) {
    const t = new Date(`${date}T12:00:00`)
    t.setDate(t.getDate() + delta)
    setDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`)
  }

  async function loadNotifications() {
    try {
      const r = await fetch(`/api/gen/notifications?date=${date}&limit=300`)
      const d = await r.json()
      setNotifications(d.notifications || [])
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (tab === 'notify') void loadNotifications()
  }, [tab, date]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openMdFile(file) {
    try {
      const text = await fetch(`/api/gen/files/${encodeURIComponent(file.id)}`).then(r => r.text())
      setMdReader({ id: file.id, name: file.name, text })
    } catch { /* ignore */ }
  }

  async function removeFile(id, name) {
    if (!window.confirm(`删除文件「${name}」？\n（只删除文件库副本，不影响对话记录）`)) return
    await fetch(`/api/gen/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (previewFile?.id === id) setPreviewFile(null)
    void load()
  }

  async function openTrash() {
    try {
      const r = await fetch('/api/gen/diary/trash')
      setTrash(await r.json())
      setTrashOpen(true)
    } catch { /* ignore */ }
  }

  async function restoreItem(type, id) {
    await fetch('/api/gen/diary/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, id }),
    })
    const r = await fetch('/api/gen/diary/trash')
    setTrash(await r.json())
    void load()
  }

  async function removeEntry(id) {
    if (!window.confirm('删除这条日记？（不会删除对话本身）')) return
    await fetch(`/api/gen/diary/${encodeURIComponent(id)}`, { method: 'DELETE' })
    void load()
  }

  async function suppressEntry(id) {
    if (!window.confirm('以后不再记录这一类条目（同类会一起隐藏）？')) return
    await fetch(`/api/gen/diary/${encodeURIComponent(id)}/suppress`, { method: 'POST' })
    void load()
  }

  async function submitManual() {
    if (!form.summary.trim()) return
    setBusy(true)
    try {
      const body = {
        at: new Date().toISOString(),
        category: form.category,
        summary: form.summary,
        amount: form.amount ? Number(form.amount) : undefined,
        sensitive: form.sensitive,
        todo: form.todo && form.todoTitle.trim()
          ? { title: form.todoTitle, dueAt: form.todoDue ? new Date(form.todoDue).getTime() : null }
          : undefined,
      }
      const r = await fetch('/api/gen/diary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) {
        setManualOpen(false)
        setForm({ summary: '', category: '手动记录', amount: '', sensitive: false, todo: false, todoTitle: '', todoDue: '' })
        void load()
      }
    } finally { setBusy(false) }
  }

  const timeline = (data?.timeline || []).filter(e => (
    (subject === '全部' || e.subject === subject)
    && (source === '全部' || e.source === source)
    && (category === '全部' || e.category === category)
    && (showAll || e.kind !== '对话' || (e.value ?? 1) >= 2 || e.sensitive)
  ))
  const groups = {}
  for (const e of timeline) {
    const p = periodOf(e.time)
    ;(groups[p] ||= []).push(e)
  }
  const stats = data?.stats || {}

  return <div className="gd">
    <div className="gd-head">
      <b>日记</b>
      <div className="gd-nav">
        <button onClick={() => shiftDay(-1)}>‹</button>
        <span>{date}</span>
        <button onClick={() => shiftDay(1)}>›</button>
      </div>
      <button className="gd-today" onClick={() => setDate(todayStr())}>今天</button>
      <div className="gd-tabs">
        {[['timeline', '时间线'], ['files', '文件'], ['creative', '创作'], ['notify', '通知']].map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div className="gd-actions">
        <button className="gd-btn" onClick={() => window.open(`/api/gen/diary/export?date=${date}`, '_blank')}>导出</button>
        <button className="gd-btn" onClick={openTrash}>回收站</button>
        <button className="gd-btn" onClick={() => setManualOpen(true)}>＋ 记一笔</button>
      </div>
    </div>

    {tab === 'notify' && <div className="gd-notify">
      <div className="gd-notify-bar">
        <span>{notifications.length} 条通知</span>
        {native && <button className="gd-btn" onClick={() => { native.syncNotifications(); setTimeout(() => void loadNotifications(), 1500) }}>同步手机通知</button>}
        {!native && <span className="gd-fchip">仅在 APK 内可自动同步</span>}
      </div>
      <div className="gd-f-row">
        {[['all', '全部'], ['high', '重要'], ['message', '消息'], ['finance', '金融'], ['delivery', '快递外卖'], ['schedule', '日程'], ['other', '其他']].map(([k, label]) => (
          <span key={k} className={`gd-fchip${notifyCategory === k ? ' on' : ''}`} onClick={() => setNotifyCategory(k)}>{label}</span>
        ))}
      </div>
      {notifications.length === 0 && <div className="gd-notify-guide">
        <b>还没有收到通知</b>
        {native && !native.hasNotificationAccess?.() && <>
          <p>需要先开启「通知访问权限」：</p>
          <ol>
            <li>点下方按钮，会打开系统「通知访问权限」页面</li>
            <li>在列表里找到「艮」并打开开关</li>
            <li>返回本页，点「同步手机通知」</li>
          </ol>
          <button className="gd-btn primary" onClick={() => native.openNotificationSettings?.()}>去开启通知访问权限</button>
        </>}
        {native && native.hasNotificationAccess?.() && <p>权限已开启但还没收到通知：请等几条新通知，或点上方「同步手机通知」。</p>}
        {!native && <p>通知自动同步仅限 APK 内使用；浏览器里只能查看已上传的通知。</p>}
      </div>}
      <div className="gd-notify-list">
        {notifications
          .filter(n => notifyCategory === 'all'
            ? true
            : notifyCategory === 'high'
              ? n.importance === 'high'
              : n.category === notifyCategory)
          .map(n => <div className={`gd-notify-item${n.importance === 'high' ? ' high' : ''}`} key={n.id}>
            <div className="gd-notify-top">
              <b>{n.app_name || n.package}</b>
              <span>{new Date(Number(n.posted_at)).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="gd-notify-title">{n.title}</div>
            {n.text && <div className="gd-notify-text">{n.text}</div>}
          </div>)}
      </div>
    </div>}

    {tab === 'timeline' && <>
      <div className="gd-filters">
        <div className="gd-f-row">
          <span className="gd-f-label">主体</span>
          {['全部', '我', '项目', '系统'].map(k => <span key={k}
            className={`gd-fchip${subject === k ? ' on' : ''}`} onClick={() => setSubject(k)}>{k}</span>)}
        </div>
        <div className="gd-f-row">
          <span className="gd-f-label">来源</span>
          {['全部', '电脑上传', '手机上传', '同步', '对话', '系统'].map(s => <span key={s}
            className={`gd-fchip${source === s ? ' on' : ''}`} onClick={() => setSource(s)}>{s}</span>)}
        </div>
        <div className="gd-f-row">
          <span className="gd-f-label">分类</span>
          {['全部', '会议记录', '通话记录', '微信记录', '对话记录', '报销', '消费记录', '任务'].map(c => <span key={c}
            className={`gd-fchip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>{c}</span>)}
        </div>
      </div>

      <div className="gd-summary">
        <div className="gd-sum-top">
          今日总结
          <button className="gd-sum-gen" disabled={summarizing} onClick={generateSummary}>
            {summarizing ? '生成中…' : (summary?.cached?.text ? '重新生成' : 'AI 生成')}
          </button>
          {summary?.cached?.stale && summary?.cached?.text && <em className="gd-sum-stale">记录有更新，建议重新生成</em>}
        </div>
        <div className="gd-sum-text">
          {summary?.cached?.text || summary?.rule?.text || '今天还没有总结。'}
        </div>
        <div className="gd-sum-chips">
          <span className="gd-chip">事件 {stats.entries || 0}</span>
          <span className="gd-chip">文件 {(data?.files?.input?.length || 0) + (data?.files?.output?.length || 0)}</span>
          <span className="gd-chip">创作 {data?.creative?.length || 0}</span>
          <span className="gd-chip">敏感 {stats.sensitive || 0}</span>
          {(data?.todos?.length || 0) > 0 && <span className="gd-chip">今日待办 {data.todos.length}</span>}
          {stats.collapsed > 0 && <span className="gd-chip gd-chip-link" onClick={() => setShowAll(v => !v)}>
            {showAll ? '收起低价值对话' : `已折叠 ${stats.collapsed} 条低价值对话`}
          </span>}
          {stats.filteredOut > 0 && <span className="gd-chip">已忽略 {stats.filteredOut} 条（寒暄/状态/错误）</span>}
        </div>
      </div>

      {timeline.length === 0 && <div className="gd-empty">今天还没有记录。<br /><small>说一句话、上传文件或派个活，会自动出现在这里。</small></div>}
      {Object.entries(groups).map(([period, list]) => <div key={period}>
        <div className="gd-period">{period}</div>
        {list.map(e => <div key={e.id} className={`gd-entry${e.sensitive ? ' sensitive' : ''}`}>
          <span className="gd-time">{e.time}</span>
          <span className={`gd-dot ${e.actor === '我' ? 'me' : e.actor === '艮' ? 'ai' : 'ext'}`} />
          <div className="gd-mid">
            <div className="gd-title">
              <b>{e.title}</b>
              <span className="gd-badge src">{e.source}</span>
              <span className="gd-badge">{e.actor}</span>
              {e.category && e.category !== '对话记录' && <span className="gd-badge">{e.category}</span>}
              {e.refs?.project && <span className="gd-badge">{e.refs.project}</span>}
              {e.fields?.status && <span className="gd-badge">{e.fields.status}</span>}
            </div>
            {e.summary && e.summary !== e.title && <div className="gd-sub">{e.summary}</div>}
            {e.files?.length > 0 && <div className="gd-files">{e.files.map(f => <span key={f.id}
              className="gd-file" onClick={() => window.open(`/api/gen/files/${f.id}`, '_blank')}>{f.name}</span>)}</div>}
          </div>
          <div className="gd-entry-actions">
            <button title="删除这条" onClick={() => removeEntry(e.id)}>删除</button>
            <button title="忽略这一类" onClick={() => suppressEntry(e.id)}>忽略此类</button>
          </div>
        </div>)}
      </div>)}
    </>}

    {tab === 'files' && <div className="gd-files-view">
      <div className="gd-period">输入文件（{data?.files?.input?.length || 0}）</div>
      <div className="gd-file-grid">
        {(data?.files?.input || []).map(f => <div key={f.id} className="gd-file-card" onClick={() => {
          const lower = String(f.name || '').toLowerCase()
          if (lower.endsWith('.md')) { void openMdFile(f); return }
          if (isImageFile(f) || isAudioFile(f)) setPreviewFile(f)
          else window.open(`/api/gen/files/${f.id}`, '_blank')
        }}>
          {isImageFile(f)
            ? <img className="gd-thumb-img" src={`/api/gen/files/${f.id}`} alt={f.name} />
            : <div className="gd-thumb">{isAudioFile(f) ? 'AUDIO' : 'FILE'}</div>}
          <div className="gd-fname">{f.name}</div>
          <div className="gd-meta">{f.origin} · {formatBytes(f.bytes)}</div>
          <button className="gd-file-del" title="删除文件" onClick={e => { e.stopPropagation(); void removeFile(f.id, f.name) }}>✕</button>
        </div>)}
        {!data?.files?.input?.length && <div className="gd-empty">还没有输入文件</div>}
      </div>
      <div className="gd-period">输出文件（{data?.files?.output?.length || 0}）</div>
      <div className="gd-file-grid">
        {(data?.files?.output || []).map(f => <div key={f.id} className="gd-file-card" onClick={() => {
          const lower = String(f.name || '').toLowerCase()
          if (lower.endsWith('.md')) { void openMdFile(f); return }
          if (isImageFile(f) || isAudioFile(f)) setPreviewFile(f)
          else window.open(`/api/gen/files/${f.id}`, '_blank')
        }}>
          {isImageFile(f)
            ? <img className="gd-thumb-img" src={`/api/gen/files/${f.id}`} alt={f.name} />
            : <div className="gd-thumb">{isAudioFile(f) ? 'AUDIO' : 'OUT'}</div>}
          <div className="gd-fname">{f.name}</div>
          <div className="gd-meta">{f.origin} · {formatBytes(f.bytes)}</div>
          <button className="gd-file-del" title="删除文件" onClick={e => { e.stopPropagation(); void removeFile(f.id, f.name) }}>✕</button>
        </div>)}
        {!data?.files?.output?.length && <div className="gd-empty">还没有输出文件</div>}
      </div>
    </div>}

    {tab === 'creative' && <div className="gd-creative">
      <div className="gd-creative-head">
        <span>创作 · Markdown 文档</span>
        <button className="gd-btn primary" onClick={newDoc}>＋ 新建创作</button>
      </div>
      {docs.length === 0 && <div className="gd-empty">还没有创作文档。<br /><small>和艮讨论完说「整理成文档」，或点「新建创作」。</small></div>}
      {docs.map(doc => <div key={doc.id} className="gd-work" onClick={() => openDoc(doc)}>
        <div className="gd-work-ic">MD</div>
        <div style={{ flex: 1 }}>
          <div className="gd-work-t">{doc.name.replace(/\.md$/, '')}</div>
          <div className="gd-work-s">{doc.date ? `${doc.date} · ` : ''}{formatBytes(doc.bytes)} · 更新于 {new Date(doc.updatedAt).toLocaleTimeString('zh-CN')}</div>
        </div>
        <span className="gd-link">打开编辑 ›</span>
      </div>)}
    </div>}

    {docEdit && <div className="gd-mask" onClick={ev => { if (ev.target === ev.currentTarget) setDocEdit(null) }}>
      <div className="gd-modal gd-editor">
        <div className="gd-editor-head">
          <input
            className="gd-editor-name"
            value={docEdit.name.replace(/\.md$/, '')}
            onChange={e => setDocEdit({ ...docEdit, name: e.target.value })}
          />
          <button className="gd-btn primary" disabled={docBusy} onClick={saveDoc}>{docBusy ? '保存中…' : '保存'}</button>
          <button className="gd-btn" onClick={() => setDocEdit(null)}>关闭</button>
        </div>
        <textarea className="gd-editor-area" value={docEdit.content} onChange={e => setDocEdit({ ...docEdit, content: e.target.value })} />
      </div>
    </div>}

    {mdReader && <div className="gen-md-reader">
      <div className="gen-md-head">
        <b>{mdReader.name}</b>
        <button onClick={() => { const next = Math.max(12, mdSize - 1); setMdSize(next); localStorage.setItem('gen-md-size', String(next)) }}>A−</button>
        <button onClick={() => { const next = Math.min(26, mdSize + 1); setMdSize(next); localStorage.setItem('gen-md-size', String(next)) }}>A＋</button>
        <button onClick={() => { void navigator.clipboard?.writeText(mdReader.text) }}>复制</button>
        <button onClick={() => window.open(`/api/gen/files/${encodeURIComponent(mdReader.id || '')}`, '_blank')}>下载</button>
        <button onClick={() => setMdReader(null)}>关闭</button>
      </div>
      <div className="gen-md-body" style={{ fontSize: mdSize }}>{mdReader.text}</div>
    </div>}

    {previewFile && <div className="gd-mask" onClick={ev => { if (ev.target === ev.currentTarget) setPreviewFile(null) }}>
      <div className="gd-img-preview">
        {isAudioFile(previewFile)
          ? <audio className="gd-audio-preview" controls autoPlay src={`/api/gen/files/${previewFile.id}`} />
          : <img src={`/api/gen/files/${previewFile.id}`} alt={previewFile.name} />}
        <div className="gd-img-preview-bar">
          <b>{previewFile.name}</b>
          <span>{formatBytes(previewFile.bytes)}</span>
          <button className="gd-btn" onClick={() => window.open(`/api/gen/files/${previewFile.id}`, '_blank')}>原图下载</button>
          <button className="gd-btn" onClick={() => void removeFile(previewFile.id, previewFile.name)}>删除</button>
          <button className="gd-btn" onClick={() => setPreviewFile(null)}>关闭</button>
        </div>
      </div>
    </div>}

    {trashOpen && <div className="gd-mask" onClick={ev => { if (ev.target === ev.currentTarget) setTrashOpen(false) }}>
      <div className="gd-modal" style={{ width: 'min(560px, 100%)' }}>
        <h3>回收站</h3>
        <div className="gd-trash-sec">
          <div className="gd-period">已删除（{trash?.deleted?.length || 0}）</div>
          {(trash?.deleted || []).length === 0 && <div className="gd-empty">没有已删除的条目</div>}
          {(trash?.deleted || []).map(item => <div key={item.id} className="gd-trash-row">
            <div className="gd-trash-main">
              <b>{item.title}</b>
              <span>{item.kind} · {new Date(item.at).toLocaleString('zh-CN')}</span>
            </div>
            <button className="gd-btn primary" onClick={() => restoreItem('deleted', item.id)}>恢复</button>
          </div>)}
        </div>
        <div className="gd-trash-sec">
          <div className="gd-period">已忽略的类别（{trash?.suppressed?.length || 0}）</div>
          {(trash?.suppressed || []).length === 0 && <div className="gd-empty">没有忽略规则</div>}
          {(trash?.suppressed || []).map(rule => <div key={rule.id} className="gd-trash-row">
            <div className="gd-trash-main">
              <b>{rule.kind} · {rule.category}{rule.subject ? ` · ${rule.subject}` : ''}</b>
              <span>共 {rule.items?.length || 0} 条被忽略</span>
            </div>
            <button className="gd-btn primary" onClick={() => restoreItem('suppression', rule.id)}>恢复该类</button>
          </div>)}
        </div>
        <div className="gd-modal-actions">
          <button className="gd-btn" onClick={() => setTrashOpen(false)}>关闭</button>
        </div>
      </div>
    </div>}

    {manualOpen && <div className="gd-mask" onClick={ev => { if (ev.target === ev.currentTarget) setManualOpen(false) }}>
      <div className="gd-modal">
        <h3>记一笔</h3>
        <label>摘要<input value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} placeholder="今天做了什么…" /></label>
        <label>分类<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select></label>
        <label>金额（可选）<input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></label>
        <label className="gd-check"><input type="checkbox" checked={form.sensitive} onChange={e => setForm({ ...form, sensitive: e.target.checked })} /> 标记为敏感</label>
        <label className="gd-check"><input type="checkbox" checked={form.todo} onChange={e => setForm({ ...form, todo: e.target.checked })} /> 同时加入待办</label>
        {form.todo && <>
          <label>待办标题<input value={form.todoTitle} onChange={e => setForm({ ...form, todoTitle: e.target.value })} placeholder="要做什么" /></label>
          <label>截止时间<input type="datetime-local" value={form.todoDue} onChange={e => setForm({ ...form, todoDue: e.target.value })} /></label>
        </>}
        <div className="gd-modal-actions">
          <button className="gd-btn" onClick={() => setManualOpen(false)}>取消</button>
          <button className="gd-btn primary" disabled={busy} onClick={submitManual}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>}
  </div>
}

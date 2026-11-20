import { useState } from 'react'
import { t } from '../i18n.js'

const icons = {
  chat: <path d="M21 12a8 8 0 1 1-3-6.2L21 4v8z" />,
  diary: <><path d="M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 1-2-2z" /><path d="M9 2v18" /></>,
  tasks: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h5" /></>,
  inbox: <><path d="M4 5h16v12H8l-4 4z" /><path d="M8 10h8M8 13h5" /></>,
  knowledge: <><path d="M4 6h16M4 12h16M4 18h10" /></>,
  lists: <><path d="M9 11l2 2 4-4" /><rect x="4" y="4" width="16" height="16" rx="3" /></>,
  data: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-.9c.6.5 1.3.9 2 1.2L10 21h4l.5-2.5c.7-.3 1.4-.7 2-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" /></>,
}

function NavIcon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{icons[name]}</svg>
}

export default function GenSidebar({ width = 224, onToggleCollapse, onStartResize, onDeleteSession, tasksCount = 0, onOpenSettings, active = 'chat', onNavigate, selectedDate, onSelectDate, sessions = [], activeSession = '', onSelectSession, onNewSession, historyOnly = false }) {
  const historySessions = sessions.filter(s => (s.count || 0) > 0 || s.named)
  const [query, setQuery] = useState('')
  const filteredSessions = query.trim()
    ? sessions.filter(s => String(s.title || '').toLowerCase().includes(query.trim().toLowerCase()))
    : historySessions
  const items = [
    ['chat', '对话'],
    ['diary', '日记'],
  ]
  if (historyOnly) {
    return <aside className="gen-rail gen-rail-history" style={{ width }}>
      <div className="gen-history-head">
        <b>历史对话</b>
        <button className="gen-history-close" onClick={onToggleCollapse}>关闭</button>
      </div>
      <input
        className="gen-session-search"
        placeholder="搜索历史对话…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className="gen-history-list">
        {sessions.length === 0 && <div className="gen-sessions-empty">还没有历史对话</div>}
        {sessions.length > 0 && filteredSessions.length === 0 && <div className="gen-sessions-empty">没有匹配的对话</div>}
        {filteredSessions.map(s => <div
          key={s.id}
          className={`gen-session${s.id === activeSession ? ' on' : ''}`}
          title={s.title}
          onClick={() => { onSelectSession?.(s.id); onNavigate?.('chat') }}
        >
          <span className="gen-session-title">{s.title}</span>
          <span className="gen-session-time">{s.lastAt ? new Date(s.lastAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : ''}</span>
          <button className="gen-session-del" title="删除会话" onClick={ev => { ev.stopPropagation(); onDeleteSession?.(s.id, s.title) }}>✕</button>
        </div>)}
      </div>
    </aside>
  }

  return <aside className="gen-rail" style={{ width }}>
    <button className="gen-rail-collapse" title="收起侧栏" onClick={onToggleCollapse}>‹</button>
    <div className="gen-rail-resizer" onPointerDown={onStartResize} title="拖动调整宽度" />
    <nav className="gen-nav">
      {items.map(([key, label, count]) => <a
        key={key}
        href="#"
        className={key === active ? 'on' : ''}
        onClick={e => { e.preventDefault(); if (['chat', 'diary', 'lists'].includes(key)) onNavigate?.(key === 'lists' ? 'todos' : key) }}
      >
        <NavIcon name={key} />
        {t(label)}
        {count ? <span className="cnt">{count}</span> : null}
        {key === 'chat' && onNewSession ? <button
          className="gen-new-chat"
          title="新建对话"
          onClick={e => { e.preventDefault(); e.stopPropagation(); onNewSession() }}
        >＋</button> : null}
      </a>)}
      <a href="#" className={active === 'settings' ? 'on' : ''} onClick={e => { e.preventDefault(); onNavigate?.('settings') }}>
        <NavIcon name="settings" />
        {t('设置')}
      </a>
      <a href="#" className={active === 'email' ? 'on' : ''} onClick={e => { e.preventDefault(); onNavigate?.('email') }}>
        <NavIcon name="inbox" />
        {t('邮箱')}
      </a>
      <a href="#" className={active === 'calendar' ? 'on' : ''} onClick={e => { e.preventDefault(); onNavigate?.('calendar') }}>
        <NavIcon name="data" />
        {t('日历')}
      </a>
      <a href="#" className={active === 'meeting' ? 'on' : ''} onClick={e => { e.preventDefault(); onNavigate?.('meeting') }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        {t('会议')}
      </a>
      <div className="gen-sessions">
        <div className="gen-sessions-head">历史会话</div>
        {historySessions.length === 0 && <div className="gen-sessions-empty">还没有历史对话</div>}
        <input
          className="gen-session-search"
          placeholder="搜索历史对话…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {filteredSessions.slice(0, 30).map(s => <div
          key={s.id}
          className={`gen-session${s.id === activeSession ? ' on' : ''}`}
          title={s.title}
          onClick={() => { onSelectSession?.(s.id); onNavigate?.('chat') }}
        >
          <span className="gen-session-title">{s.title}</span>
          <span className="gen-session-time">{s.lastAt ? new Date(s.lastAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : ''}</span>
          <button className="gen-session-del" title="删除会话" onClick={ev => { ev.stopPropagation(); onDeleteSession?.(s.id, s.title) }}>✕</button>
        </div>)}
      </div>
    </nav>
  </aside>
}

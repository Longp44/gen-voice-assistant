import { useEffect, useState } from 'react'

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false })
  } catch { return String(iso || '') }
}

export default function GenLogs() {
  const [todos, setTodos] = useState([])
  const [logs, setLogs] = useState([])
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')

  async function load() {
    const [t, l] = await Promise.all([
      fetch('/api/gen/todos').then(r => r.json()).catch(() => ({ todos: [] })),
      fetch('/api/gen/logs?limit=100').then(r => r.json()).catch(() => ({ logs: [] })),
    ])
    setTodos(t.todos || [])
    setLogs(l.logs || [])
  }

  useEffect(() => { void load() }, [])

  async function add() {
    if (!title.trim()) return
    await fetch('/api/gen/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, dueAt: due ? new Date(due).toISOString() : null }),
    })
    setTitle('')
    setDue('')
    void load()
  }

  async function toggle(todo) {
    await fetch(`/api/gen/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: todo.status === 'done' ? 'pending' : 'done' }),
    })
    void load()
  }

  async function remove(id) {
    await fetch(`/api/gen/todos/${id}`, { method: 'DELETE' })
    void load()
  }

  const pending = todos.filter(t => t.status === 'pending')
  const done = todos.filter(t => t.status !== 'pending')

  return <div className="gd">
    <div className="gd-head"><b>日志与待办</b><span className="gd-count">{pending.length} 项待办</span></div>

    <div className="gd-period">待办</div>
    <div className="gd-todo-add">
      <input value={title} placeholder="新建待办…" onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add() }} />
      <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
      <button className="gd-btn primary" onClick={add}>添加</button>
    </div>
    {pending.length === 0 && <div className="gd-empty">没有待办。<br /><small>在对话里说「提醒我…」会自动生成。</small></div>}
    {pending.map(t => <div key={t.id} className="gd-todo-row">
      <span className="gd-todo-check" onClick={() => toggle(t)}>○</span>
      <div className="gd-todo-t">{t.title}</div>
      <div className="gd-todo-due">{t.due_at ? new Date(t.due_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div>
      <span className="gd-todo-del" title="删除" onClick={() => remove(t.id)}>✕</span>
    </div>)}
    {done.length > 0 && <>
      <div className="gd-period">已完成</div>
      {done.map(t => <div key={t.id} className="gd-todo-row done">
        <span className="gd-todo-check" onClick={() => toggle(t)}>●</span>
        <div className="gd-todo-t">{t.title}</div>
        <span className="gd-todo-del" onClick={() => remove(t.id)}>✕</span>
      </div>)}
    </>}

    <div className="gd-period">运行日志</div>
    {logs.length === 0 && <div className="gd-empty">暂无日志</div>}
    {logs.map((log, i) => <div key={i} className={`gd-log-row ${log.level}`}>
      <span className="gd-log-time">{fmtTime(log.time)}</span>
      <span className={`gd-log-level ${log.level}`}>{log.level}</span>
      <span className="gd-log-event">{log.event}</span>
      {log.message && <span className="gd-log-msg">{log.message}</span>}
    </div>)}
  </div>
}

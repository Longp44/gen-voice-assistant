import { useEffect, useState } from 'react'

export default function GenTodos() {
  const [todos, setTodos] = useState([])
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')

  async function load() {
    try {
      const r = await fetch('/api/gen/todos')
      const d = await r.json()
      setTodos(d.todos || [])
    } catch { /* ignore */ }
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

  const pending = todos.filter(t => t.status === 'pending')
  const done = todos.filter(t => t.status !== 'pending')

  return <div className="gd">
    <div className="gd-head"><b>清单</b><span className="gd-count">{pending.length} 项待办</span></div>
    <div className="gd-todo-add">
      <input value={title} placeholder="新建待办…" onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add() }} />
      <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
      <button className="gd-btn primary" onClick={add}>添加</button>
    </div>
    <div className="gd-period">待办</div>
    {pending.length === 0 && <div className="gd-empty">没有待办。<br /><small>说「提醒我明天交报告」或在这里添加。</small></div>}
    {pending.map(t => <div key={t.id} className="gd-todo-row">
      <span className="gd-todo-check" onClick={() => toggle(t)}>○</span>
      <div className="gd-todo-t">{t.title}</div>
      <div className="gd-todo-due">{t.due_at ? new Date(t.due_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div>
      <div className="gd-todo-src">{t.source}</div>
    </div>)}
    {done.length > 0 && <><div className="gd-period">已完成</div>
      {done.map(t => <div key={t.id} className="gd-todo-row done">
        <span className="gd-todo-check" onClick={() => toggle(t)}>●</span>
        <div className="gd-todo-t">{t.title}</div>
      </div>)}
    </>}
  </div>
}

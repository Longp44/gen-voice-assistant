import { useEffect, useMemo, useState } from 'react'

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']

function monthDays(base) {
  const first = new Date(base.getFullYear(), base.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  const days = []
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push(d)
  }
  return days
}

export default function GenCalendar({ selectedDate, onSelectDate }) {
  const [base, setBase] = useState(new Date())
  const [todos, setTodos] = useState([])
  const [title, setTitle] = useState('')
  const [addFor, setAddFor] = useState(null)
  const [monthOpen, setMonthOpen] = useState(false)
  const selected = selectedDate || ymd(new Date())

  async function load() {
    const r = await fetch('/api/gen/todos')
    const d = await r.json()
    setTodos(d.todos || [])
  }

  useEffect(() => { void load() }, [selected])

  const byDay = useMemo(() => {
    const map = {}
    for (const t of todos) {
      if (!t.due_at) continue
      const key = ymd(new Date(t.due_at))
      ;(map[key] ||= []).push(t)
    }
    return map
  }, [todos])

  async function add(dateKey = selected) {
    if (!title.trim()) return
    const due = new Date(`${dateKey}T09:00:00`)
    await fetch('/api/gen/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, dueAt: due.toISOString() }),
    })
    setTitle('')
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

  const dayTodos = todos.filter(t => t.due_at && ymd(new Date(t.due_at)) === selected)
  const noDateTodos = todos.filter(t => !t.due_at && t.status === 'pending')
  const pendingCount = todos.filter(t => t.status === 'pending').length
  const todayKey = ymd(new Date())
  const weekKeys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return ymd(d)
  })
  const monthLabel = `${base.getFullYear()} 年 ${base.getMonth() + 1} 月`

  function shiftMonth(delta) {
    setBase(new Date(base.getFullYear(), base.getMonth() + delta, 1))
  }

  return <div className="gd">
    <div className="gd-head">
      <b>日历</b>
      <button className="gd-date-btn" onClick={() => setMonthOpen(true)}>{selected} · 点击展开月历</button>
      <button className="gd-today" onClick={() => onSelectDate?.(todayKey)}>今天</button>
      <span className="gd-count" style={{ marginLeft: 'auto' }}>{pendingCount} 项待办</span>
    </div>

    <div className="gd-period">最近一周</div>
    <div className="gen-week">
      {Array.from({ length: 7 }, (_, i) => {
        const d = new Date()
        d.setDate(d.getDate() + i)
        const key = ymd(d)
        const list = byDay[key] || []
        return <div key={key}
          className={`gen-week-day${key === todayKey ? ' today' : ''}${key === selected ? ' sel' : ''}`}
          onClick={() => onSelectDate?.(key)}
        >
          <div className="gen-week-label">
            <b>{d.getMonth() + 1}/{d.getDate()}</b>
            <span>{WEEK_CN[d.getDay()]}{key === todayKey ? ' · 今天' : ''}</span>
          </div>
          <div className="gen-week-body">
            {list.length === 0 && addFor !== key && <div className="gen-week-empty">—</div>}
            {list.map(t => <div key={t.id} className={`gen-week-todo${t.status === 'done' ? ' done' : ''}`}>
              <span className="gd-todo-check" onClick={ev => { ev.stopPropagation(); toggle(t) }}>{t.status === 'done' ? '●' : '○'}</span>
              <span className="gen-week-title">{t.title}</span>
              <span className="gen-week-src">{t.source === '手动' ? '手动' : ''}</span>
            </div>)}
            {addFor === key
              ? <div className="gen-week-add" onClick={ev => ev.stopPropagation()}>
                <input autoFocus value={title} placeholder="输入待办，回车保存" onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { void add(key); setAddFor(null) } if (e.key === 'Escape') { setAddFor(null); setTitle('') } }} />
                <button className="gd-btn primary" onClick={() => { void add(key); setAddFor(null) }}>添加</button>
              </div>
              : <button className="gen-week-plus" onClick={ev => { ev.stopPropagation(); setAddFor(key) }}>＋</button>}
          </div>
        </div>
      })}
    </div>

    {!weekKeys.includes(selected) && <>
      <div className="gd-period">{selected}（周外日期）的待办</div>
      <div className="gd-todo-add">
        <input value={title} placeholder="添加这天的待办…" onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add() }} />
        <button className="gd-btn primary" onClick={() => add()}>添加</button>
      </div>
      {dayTodos.length === 0 && <div className="gd-empty">这一天没有待办</div>}
      {dayTodos.map(t => <div key={t.id} className={`gd-todo-row${t.status === 'done' ? ' done' : ''}`}>
        <span className="gd-todo-check" onClick={() => toggle(t)}>{t.status === 'done' ? '●' : '○'}</span>
        <div className="gd-todo-t">{t.title}</div>
        <span className="gd-todo-del" onClick={() => remove(t.id)}>✕</span>
      </div>)}
    </>}

    {noDateTodos.length > 0 && <>
      <div className="gd-period">未定日期的待办</div>
      {noDateTodos.map(t => <div key={t.id} className="gd-todo-row">
        <span className="gd-todo-check" onClick={() => toggle(t)}>○</span>
        <div className="gd-todo-t">{t.title}</div>
        <span className="gd-todo-del" onClick={() => remove(t.id)}>✕</span>
      </div>)}
    </>}

    {monthOpen && <div className="gd-mask" onClick={ev => { if (ev.target === ev.currentTarget) setMonthOpen(false) }}>
      <div className="gd-modal gen-month-modal">
        <div className="gd-editor-head">
          <b>{monthLabel}</b>
          <div className="gd-nav" style={{ marginLeft: 12 }}>
            <button onClick={() => shiftMonth(-1)}>‹</button>
            <button onClick={() => shiftMonth(1)}>›</button>
          </div>
          <span className="gd-count" style={{ marginLeft: 'auto' }}>{pendingCount} 项待办</span>
          <button className="gd-btn" onClick={() => setMonthOpen(false)}>关闭</button>
        </div>
        <div className="gen-cal">
          {['一', '二', '三', '四', '五', '六', '日'].map(w => <div key={w} className="gen-cal-w">{w}</div>)}
          {monthDays(base).map(d => {
            const key = ymd(d)
            const list = byDay[key] || []
            return <div key={key}
              className={`gen-cal-day${d.getMonth() === base.getMonth() ? '' : ' dim'}${key === todayKey ? ' today' : ''}${key === selected ? ' sel' : ''}`}
              onClick={() => { onSelectDate?.(key); setMonthOpen(false) }}
            >
              <span className="gen-cal-num">{d.getDate()}</span>
              {list.length > 0 && <span className={`gen-cal-dots${list.every(t => t.status === 'done') ? ' done' : ''}`}>
                {list.length > 3 ? '3+' : '●'.repeat(Math.min(list.length, 3))}
              </span>}
            </div>
          })}
        </div>
      </div>
    </div>}
  </div>
}

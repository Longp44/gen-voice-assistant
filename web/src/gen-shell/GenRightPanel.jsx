import { useEffect, useState } from 'react'

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// GEN-MOD: 右侧栏 —— 缩略月历 + 今日待办
export default function GenRightPanel({ selectedDate, onSelectDate, onCollapse }) {
  const [base, setBase] = useState(new Date())
  const [byDay, setByDay] = useState({})
  const [todayList, setTodayList] = useState([])

  async function load() {
    try {
      const d = await fetch('/api/gen/todos').then(r => r.json())
      const map = {}
      for (const todo of d.todos || []) {
        if (!todo.due_at) continue
        const key = ymd(new Date(todo.due_at))
        ;(map[key] ||= []).push(todo)
      }
      setByDay(map)
      setTodayList((d.todos || []).filter(t => t.status !== 'done' && t.due_at && ymd(new Date(t.due_at)) === ymd(new Date())))
    } catch { /* ignore */ }
  }

  useEffect(() => { void load() }, [selectedDate])

  async function toggleTodo(todo) {
    await fetch(`/api/gen/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    void load()
  }

  const first = new Date(base.getFullYear(), base.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  const days = []
  for (let i = 0; i < 42; i += 1) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d) }
  const today = ymd(new Date())

  return <aside className="gen-right-panel">
    <button className="gen-right-collapse" title="收起日历面板" onClick={onCollapse}>›</button>
    <div className="gen-side-cal-head">
      <button onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() - 1, 1))}>‹</button>
      <span>{base.getFullYear()} / {base.getMonth() + 1}</span>
      <button onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() + 1, 1))}>›</button>
    </div>
    <div className="gen-side-cal-grid">
      {['一', '二', '三', '四', '五', '六', '日'].map(w => <div key={w} className="gen-side-cal-w">{w}</div>)}
      {days.map(d => {
        const key = ymd(d)
        const list = byDay[key] || []
        return <div key={key}
          className={`gen-side-cal-day${d.getMonth() === base.getMonth() ? '' : ' dim'}${key === today ? ' today' : ''}${key === selectedDate ? ' sel' : ''}`}
          onClick={() => onSelectDate?.(key)}
        >
          {d.getDate()}
          {list.length > 0 && <i className={list.every(x => x.status === 'done') ? 'done' : ''} />}
        </div>
      })}
    </div>

    <div className="gen-today-list">
      <div className="gen-today-head">今日待办 · {todayList.length}</div>
      {todayList.length === 0 && <div className="gen-sessions-empty">今天没有待办</div>}
      {todayList.map(t => <div key={t.id} className="gen-today-item" onClick={() => toggleTodo(t)}>
        <span className="gen-today-check">○</span>
        <span className="gen-today-title">{t.title}</span>
      </div>)}
    </div>
  </aside>
}

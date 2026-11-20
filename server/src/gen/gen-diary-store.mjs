// GEN-MOD: 日记存储层 —— SQLite 索引 + 文件对象库 + journal 采集器
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, rmSync,
} from 'node:fs'
import { resolve, join } from 'node:path'

let db = null
let dataDir = ''
let stateDir = ''
let lastSkipped = 0

function now() { return Date.now() }

function dbPath() { return resolve(dataDir, 'db', 'gen.db') }

export function initDiaryStore(config) {
  dataDir = config.dataDirectory
  stateDir = config.stateDirectory
  mkdirSync(resolve(dataDir, 'db'), { recursive: true, mode: 0o700 })
  db = new DatabaseSync(dbPath())
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      at INTEGER NOT NULL,
      actor TEXT,
      source TEXT,
      source_app TEXT,
      kind TEXT,
      category TEXT,
      title TEXT,
      summary TEXT,
      fields TEXT,
      refs TEXT,
      sensitive INTEGER DEFAULT 0,
      subject TEXT DEFAULT '',
      value INTEGER DEFAULT 1,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date, at);
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      sha256 TEXT,
      name TEXT,
      mime TEXT,
      bytes INTEGER,
      path TEXT,
      origin TEXT,
      entry_id TEXT,
      role TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tombstones (
      id TEXT PRIMARY KEY,
      at INTEGER,
      kind TEXT,
      title TEXT,
      snapshot TEXT,
      source TEXT DEFAULT 'delete'
    );
    CREATE TABLE IF NOT EXISTS suppressions (
      id TEXT PRIMARY KEY,
      kind TEXT,
      category TEXT,
      subject TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS suppressed_items (
      id TEXT PRIMARY KEY,
      rule_id TEXT,
      snapshot TEXT,
      at INTEGER
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      aliases TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS todo_extractions (
      msg_id TEXT PRIMARY KEY,
      at INTEGER
    );
    CREATE TABLE IF NOT EXISTS emails (
      message_id TEXT PRIMARY KEY,
      subject TEXT,
      from_addr TEXT,
      to_addr TEXT,
      date_at INTEGER,
      text TEXT,
      flagged TEXT DEFAULT '',
      deleted INTEGER DEFAULT 0,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS junk_senders (
      pattern TEXT PRIMARY KEY,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS email_seen (
      message_id TEXT PRIMARY KEY,
      at INTEGER
    );
    CREATE TABLE IF NOT EXISTS memory_sync (
      date TEXT PRIMARY KEY,
      at INTEGER
    );
    CREATE TABLE IF NOT EXISTS deleted_sessions (
      id TEXT PRIMARY KEY,
      at INTEGER
    );
    CREATE TABLE IF NOT EXISTS session_meta (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT,
      started_at INTEGER,
      duration_ms INTEGER DEFAULT 0,
      status TEXT DEFAULT 'recording',
      audio_file_id TEXT,
      transcript TEXT,
      summary_md TEXT,
      asr_mode TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      package TEXT,
      app_name TEXT,
      title TEXT,
      text TEXT,
      posted_at INTEGER,
      category TEXT,
      importance TEXT,
      sensitive TEXT,
      device TEXT,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_posted ON notifications(posted_at);
    CREATE TABLE IF NOT EXISTS meeting_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      start_ms INTEGER,
      end_ms INTEGER,
      text TEXT,
      speaker TEXT,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_segments ON meeting_segments(meeting_id);
    CREATE TABLE IF NOT EXISTS diary_summaries (
      date TEXT PRIMARY KEY,
      hash TEXT,
      text TEXT,
      model TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT,
      due_at INTEGER,
      remind_at INTEGER,
      status TEXT DEFAULT 'pending',
      source TEXT,
      entry_id TEXT,
      created_at INTEGER,
      done_at INTEGER
    );
  `)
  // GEN-MOD: 来源取值迁移（聊天→对话；文件上传→对话上传；系统事件→系统）
  try {
    db.exec("UPDATE entries SET source = '电脑上传' WHERE source IN ('聊天','文件','对话上传') AND category = '文件上传'")
    db.exec("UPDATE entries SET source = '对话' WHERE source IN ('聊天','手动')")
    db.exec("UPDATE entries SET source = '同步' WHERE source = '邮件'")
    db.exec("UPDATE entries SET source = '系统' WHERE kind = '系统事件' AND source != '系统'")
  } catch { /* ignore */ }
  const ecols = db.prepare('PRAGMA table_info(emails)').all().map(c => c.name)
  if (!ecols.includes('flagged')) db.exec("ALTER TABLE emails ADD COLUMN flagged TEXT DEFAULT ''")
  if (!ecols.includes('deleted')) db.exec('ALTER TABLE emails ADD COLUMN deleted INTEGER DEFAULT 0')
  const cols = db.prepare('PRAGMA table_info(entries)').all().map(c => c.name)
  if (!cols.includes('value')) db.exec('ALTER TABLE entries ADD COLUMN value INTEGER DEFAULT 1')
  const cols2 = db.prepare('PRAGMA table_info(entries)').all().map(c => c.name)
  if (!cols2.includes('subject')) db.exec("ALTER TABLE entries ADD COLUMN subject TEXT DEFAULT ''")
  const tcols = db.prepare('PRAGMA table_info(tombstones)').all().map(c => c.name)
  for (const [name, sql] of [
    ['kind', 'ALTER TABLE tombstones ADD COLUMN kind TEXT'],
    ['title', 'ALTER TABLE tombstones ADD COLUMN title TEXT'],
    ['snapshot', 'ALTER TABLE tombstones ADD COLUMN snapshot TEXT'],
    ['source', "ALTER TABLE tombstones ADD COLUMN source TEXT DEFAULT 'delete'"],
  ]) if (!tcols.includes(name)) db.exec(sql)
}

function dayOf(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const GREETINGS = /^(你好|您好|hi|hello|嗨|在吗|在不在|谢谢|多谢|好的|好|嗯|哦|喔|收到|可以|行|ok|okay|再见|拜拜|早|晚安|辛苦了)[!！。,.，\s]*$/i
const STATUS_LINE = /^(好的[，,。]?\s*)?(正在|稍等|马上|稍候|我这就|我这就去|处理中|已安排|好的，正在)/
const STACK_LINE = /(Error:|EPERM|ENOENT|at .*\(.*:\d+:\d+\)|Internal error|session\/new 失败|\bstopped\b)/
const ERROR_EXPLAIN = /(失败了|没能成功|没做成|出问题|超时|无法创建|无法完成|异常|抱歉[，,].{0,40}(失败|问题|无法))/

function isNoise(content, isUser) {
  const text = String(content || '').trim()
  if (!text) return true
  if (isUser && GREETINGS.test(text)) return true          // A 寒暄/确认
  if (isUser && text.length <= 2) return true               // 过短无信息
  if (!isUser && STATUS_LINE.test(text)) return true        // C 中间过程
  if (!isUser && STACK_LINE.test(text)) return true         // D 错误堆栈
  if (!isUser && ERROR_EXPLAIN.test(text) && text.length > 24) return true // D 失败解释（由任务条目代表）
  return false
}

// 相关性：项目关键词（后续改为项目注册表）
const PROJECT_WORDS = ['艮', 'DSH', '插件', 'ERP', '语音', '助手', '项目', '方案', '预算', '合同', '部署', '上线', '报销', '发票', '账单', '邮件', '日历', '微信', '会议', '代码', '脚本', '服务器']
const SUBJECT_PATTERNS = [
  ['我', /(决定|确定|定了|就按|改成|计划|打算|承诺|答应|以后|记住|偏好|喜欢|讨厌|习惯|学习|学到|理解|记住|提醒我|我的|我要|我想)/],
  ['项目', /(项目|需求|方案|预算|合同|交付|里程碑|上线|部署|验收|客户|评审|原型|设计稿)/],
  ['系统', /(配置|设置|模型|插件|网关|接口|权限|日志|故障|报错|崩溃|修复|升级|重启|安装|卸载|API|Key|Token)/],
  ['我', /(报销|发票|消费|金额|花费|账单|付款|转账)/],
]
function classifySubject(content) {
  const text = String(content || '')
  const project = matchProject(text)
  const hits = SUBJECT_PATTERNS.filter(([, re]) => re.test(text)).map(([s]) => s)
  const uniq = [...new Set(hits)]
  if (project) return { subject: '项目', relevant: true, project: project.name }
  if (uniq.length === 0) return { subject: '', relevant: false }
  // 项目类优先（有具体项目/交付语义），其次系统，最后我
  const subject = uniq.includes('项目') ? '项目' : uniq.includes('系统') ? '系统' : '我'
  const projectHit = PROJECT_WORDS.some(w => text.includes(w))
  return { subject, relevant: true, project: null }
}

function importance(content, isUser) {
  const text = String(content || '')
  let score = 1
  if (/帮我|创建|整理|分析|写|做|发|查|安排|计划|提醒|记一下|预算|方案|邮件|文件|报告|代码|合同|报销|金额|结论|决定|确认/i.test(text)) score = 2
  if (isUser && text.length >= 12) score = Math.max(score, 2)
  return score
}

function truncate(text, n = 60) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}

// ---------- 文件对象库 ----------
export function registerFileFromPath(path, { name, mime, origin = '', entryId = '', role = 'output' } = {}) {
  if (!db) return null
  if (!path || !existsSync(path)) return null
  let bytes = 0
  try { bytes = statSync(path).size } catch { return null }
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
  const id = `file_${hash.slice(0, 16)}`
  const displayName = name || path.split('/').pop()
  db.prepare(`INSERT OR IGNORE INTO files (id, sha256, name, mime, bytes, path, origin, entry_id, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, hash, displayName, mime || '', bytes, path, origin, entryId || null, role, now())
  db.prepare('UPDATE files SET name = ?, bytes = ? WHERE id = ?').run(displayName, bytes, id)
  return id
}

export function registerFileFromDataUrl(dataUrl, { name, origin = '', entryId = '', role = 'input' } = {}) {
  if (!db) return null
  const m = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!m) return null
  const mime = m[1] || 'application/octet-stream'
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8')
  const hash = createHash('sha256').update(buf).digest('hex')
  const dir = resolve(dataDir, 'objects', 'sha256', hash.slice(0, 2))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const filePath = join(dir, hash)
  if (!existsSync(filePath)) writeFileSync(filePath, buf, { mode: 0o600 })
  const id = `file_${hash.slice(0, 16)}`
  const displayName = name || hash.slice(0, 8)
  db.prepare(`INSERT OR IGNORE INTO files (id, sha256, name, mime, bytes, path, origin, entry_id, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, hash, displayName, mime, buf.length, filePath, origin, entryId || null, role, now())
  db.prepare('UPDATE files SET name = ? WHERE id = ?').run(displayName, id)
  return id
}

function linkFile(entryId, name) {
  if (!entryId || !name) return
  try {
    db.prepare(`UPDATE files SET entry_id = ?
      WHERE name = ? AND (entry_id IS NULL OR entry_id = '')`).run(entryId, name)
  } catch { /* ignore */ }
}

// 任务完成时扫描工作区中该时段新增/修改的文件 → 登记为输出
function scanWorkspaceForTask(task, entryId) {
  const workspace = resolve(dataDir, 'workspace')
  if (!existsSync(workspace)) return
  const from = Number(task.createdAt || 0) - 5000
  const to = Number(task.completedAt || Date.now()) + 5000
  const walk = dir => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      const p = join(dir, name)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p); continue }
      if (!st.isFile() || st.size <= 0) continue
      if (st.mtimeMs < from || st.mtimeMs > to) continue
      const id = registerFileFromPath(p, {
        name,
        origin: 'DSH 产物',
        entryId,
        role: 'output',
      })
      if (id) linkFile(entryId, name)
    }
  }
  walk(workspace)
}

export function latestInputImage() {
  return db.prepare(`SELECT id, name, mime, bytes, origin FROM files
    WHERE role = 'input' AND (mime LIKE 'image/%' OR name LIKE '%.png' OR name LIKE '%.jpg' OR name LIKE '%.jpeg' OR name LIKE '%.webp' OR name LIKE '%.gif')
    ORDER BY created_at DESC LIMIT 1`).get() || null
}

export function deleteFile(id) {
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id)
  if (!row) return null
  try {
    if (row.path && existsSync(row.path)) unlinkSync(row.path)
  } catch { /* 文件已不在也继续删记录 */ }
  db.prepare('DELETE FROM files WHERE id = ?').run(id)
  return row
}

export function fileObject(id) {
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id)
  if (!row) return null
  if (row.path && existsSync(row.path)) return { ...row, content: readFileSync(row.path) }
  // GEN-MOD: 迁移后旧路径失效时，按 sha256 回退到当前对象库
  if (row.sha256) {
    const fallback = join(resolve(dataDir, 'objects', 'sha256'), row.sha256.slice(0, 2), row.sha256)
    if (existsSync(fallback)) return { ...row, path: fallback, content: readFileSync(fallback) }
  }
  return null
}

// ---------- 条目写入 ----------
function isTombstoned(id) {
  return Boolean(db.prepare('SELECT 1 FROM tombstones WHERE id = ?').get(id))
}

function isSuppressed(entry) {
  const rules = db.prepare('SELECT * FROM suppressions').all()
  return rules.some(rule => (
    (!rule.kind || rule.kind === entry.kind)
    && (!rule.category || rule.category === entry.category)
    && (!rule.subject || rule.subject === entry.subject)
  ))
}

function signatureOf(entry) {
  return `sig:${entry.kind || ''}:${String(entry.title || '').slice(0, 80)}`
}

function upsertEntry(entry) {
  if (isTombstoned(entry.id)) return entry.id
  if (isTombstoned(signatureOf(entry))) return entry.id // 同签名（同标题同类）不再重扫回来
  if (isSuppressed(entry)) return entry.id
  const at = Number(entry.at) || now()
  const date = entry.date || dayOf(at)
  db.prepare(`INSERT INTO entries (id, date, at, actor, source, source_app, kind, category, subject, title, summary, fields, refs, sensitive, value, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      actor=excluded.actor, source=excluded.source, source_app=excluded.source_app,
      kind=excluded.kind, category=excluded.category, subject=excluded.subject, title=excluded.title,
      summary=excluded.summary, fields=excluded.fields, refs=excluded.refs,
      sensitive=excluded.sensitive, value=excluded.value`)
    .run(
      entry.id, date, at, entry.actor || '', entry.source || '', entry.sourceApp || '',
      entry.kind || '', entry.category || '', entry.subject || '', entry.title || '', entry.summary || '',
      JSON.stringify(entry.fields || {}), JSON.stringify(entry.refs || {}),
      entry.sensitive ? 1 : 0, Number.isFinite(entry.value) ? entry.value : 1, entry.createdAt || now(),
    )
  return entry.id
}

// 系统事件采集器：从网关日志提取"我的系统"相关事件
function syncSystemEvents() {
  const logPath = resolve(stateDir, 'logs', 'gateway.log')
  if (!existsSync(logPath)) return 0
  let count = 0
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const at = Date.parse(ev.time) || 0
    if (!at) continue
    const event = ev.event || ''
    let title = ''
    let category = '系统变更'
    if (event === 'gen.settings.saved') title = '修改模型/密钥设置'
    else if (event === 'gen.settings.acp_patch') title = '切换主模型路由'
    else if (event === 'acp.initialization_failed') { title = '后台初始化失败'; category = '系统故障' }
    else if (event === 'gen.diary.read' && ev.level === 'error') { title = '日记接口异常'; category = '系统故障' }
    else continue
    // 同日同标题合并：只保留一条，summary 记录次数
    const existing = db.prepare(`SELECT id, fields FROM entries
      WHERE kind = '系统事件' AND title = ? AND date = ? ORDER BY at DESC LIMIT 1`)
      .get(title, dayOf(at))
    if (existing) {
      const fields = JSON.parse(existing.fields || '{}')
      fields.count = (fields.count || 1) + 1
      db.prepare('UPDATE entries SET fields = ?, at = ? WHERE id = ?')
        .run(JSON.stringify(fields), at, existing.id)
    } else {
      upsertEntry({
        id: `sys:${event}:${at}`,
        at,
        actor: '系统',
        source: '手动',
        sourceApp: '艮系统',
        kind: '系统事件',
        category,
        subject: '系统',
        title,
        summary: ev.error?.message ? String(ev.error.message).slice(0, 120) : '',
        fields: { count: 1 },
        value: 2,
      })
    }
    count += 1
  }
  return count
}

// 聊天采集器：扫描 journal（去重靠 id）
let lastCleanup = 0
export function syncJournal() {
  if (now() - lastCleanup > 6 * 60 * 60 * 1000) {
    const days = Number(process.env.GEN_TRASH_RETENTION_DAYS || 30)
    cleanupTrash(Number.isFinite(days) ? days : 30)
    lastCleanup = now()
  }
  const root = resolve(stateDir, 'sessions')
  lastSkipped = 0
  if (!existsSync(root) || !db) return 0
  let count = 0
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      if (!name.endsWith('.jsonl')) continue
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        if (!line.trim()) continue
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        count += ingestJournalEvent(ev, name, p)
      }
    }
  }
  walk(root)
  count += syncSystemEvents()
  return count
}

function ingestJournalEvent(ev, fileName, filePath) {
  const sessionId = ev.sessionId || ''
  const seq = ev.seq
  let changed = 0
  if (ev.type === 'user/message' || ev.type === 'assistant/message') {
    const p = ev.payload || {}
    const at = Number(p.historyPosition) || Date.parse(ev.time) || now()
    const content = String(p.content || '')
      .replace(/^【用户通过输入框发言】.*?不要自己直接回答。\s*/, '')
      .trim()
    if (!content) return 0
    const isUser = ev.type === 'user/message'
    // 按轮次聚合：一轮对话 = 一条日记条目（用户提问 + 艮的回答）
    if (isNoise(content, isUser)) { lastSkipped += 1; return 0 } // GEN-MOD: 寒暄/状态/错误堆栈不进日记
    const hasInputs = Array.isArray(p.inputs) && p.inputs.length > 0
    const rel = hasInputs
      ? { subject: '我', relevant: true, project: null }
      : classifySubject(content)
    if (!rel.relevant) { lastSkipped += 1; return 0 } // 无主体（闲聊/天气/测试）不进日记
    const turnId = String(ev.turnId || p.messageId || seq)
    const entryId = `turn:${sessionId}:${turnId}`
    const existing = db.prepare('SELECT id FROM entries WHERE id = ?').get(entryId)
    if (!isUser && ev.source === 'agent-presentation') { lastSkipped += 1; return 0 } // 结果播报由任务条目代表
    if (isUser) {
      upsertEntry({
        id: entryId,
        at,
        actor: '我',
        source: hasInputs ? '电脑上传' : '对话',
        sourceApp: '艮',
        kind: hasInputs ? '上传' : '对话',
        category: hasInputs ? '文件上传'
          : rel.subject === '项目' ? '项目讨论' : rel.subject === '系统' ? '系统操作' : '决定/偏好',
        subject: rel.subject,
        title: truncate(content),
        summary: truncate(content, 120),
        value: importance(content, true),
        refs: { conversationId: sessionId, turnId, ...(rel.project ? { project: rel.project } : {}) },
      })
    } else if (existing) {
      if (/^\[生成失败\]$/.test(content)) return 0 // provider 占位符不写入日记
      db.prepare('UPDATE entries SET summary = ?, value = MAX(value, ?) WHERE id = ?')
        .run(truncate(content, 120), importance(content, false), entryId)
    } else {
      const relA = classifySubject(content)
      if (!relA.relevant) { lastSkipped += 1; return 0 }
      upsertEntry({
        id: entryId,
        at,
        actor: '艮',
        source: '对话',
        sourceApp: '艮',
        kind: '回答',
        category: '对话记录',
        subject: relA.subject,
        title: truncate(content),
        summary: truncate(content, 120),
        value: importance(content, false),
        refs: { conversationId: sessionId, turnId },
      })
    }
    // 输入文件登记（journal 只有元数据，按文件名回链到对话条目）
    for (const input of p.inputs || []) {
      if (input?.filename) linkFile((isUser ? entryId : entryId), input.filename)
      if (input?.url) {
        registerFileFromDataUrl(input.url, {
          name: input.filename || input.label || '附件',
          origin: '对话输入',
          entryId,
          role: 'input',
        })
      }
    }
    return 1
  }
  if (ev.type === 'qwaudio/task/event') {
    const p = ev.payload || {}
    const task = p.task || {}
    const at = Number(task.createdAt) || now()
    const state = task.workState || task.status || ''
    // B 重复/重试：同目标 15 分钟内合并；若与用户提问同名，则并入那条对话
    const objective = truncate(task.objective || '任务', 60)
    const atTask = at
    const window = 15 * 60 * 1000
    const ask = db.prepare(`SELECT id FROM entries
      WHERE kind = '对话' AND title = ? AND at BETWEEN ? AND ?
      ORDER BY at DESC LIMIT 1`).get(objective, atTask - window, atTask + window)
    if (ask) {
      db.prepare('UPDATE entries SET summary = ?, value = MAX(value, ?), subject = COALESCE(NULLIF(subject, \'\'), ?) WHERE id = ?')
        .run(`${state}${task.result ? ` · ${truncate(task.result, 100)}` : ''}${task.error ? ` · 失败` : ''}`,
          2, '项目', ask.id)
      if (state === 'completed') scanWorkspaceForTask(task, ask.id)
      return 1
    }
    const dup = db.prepare(`SELECT id, at FROM entries
      WHERE kind = '任务' AND title = ? AND at BETWEEN ? AND ?
      ORDER BY at DESC LIMIT 1`).get(objective, atTask - window, atTask + window)
    const entryId = dup ? dup.id : `task:${sessionId}:${task.id}`
    upsertEntry({
      id: entryId,
      at,
      actor: '艮',
      source: '对话',
      sourceApp: 'DSH',
      kind: '任务',
      category: '任务',
      subject: (matchProject(objective) || /(项目|需求|方案|预算|合同|交付|上线|部署|验收|客户|评审)/.test(objective)) ? '项目' : '系统',
      title: objective,
      summary: `${state}${task.result ? ` · ${truncate(task.result, 120)}` : ''}${task.error ? ` · ${truncate(task.error, 120)}` : ''}`,
      fields: { status: state, elapsedMs: task.elapsedMs || 0 },
      refs: { taskId: task.id, conversationId: sessionId, ...(matchProject(objective) ? { project: matchProject(objective).name } : {}) },
    })
    if (state === 'completed') scanWorkspaceForTask(task, entryId)
    // 任务产物登记为输出文件
    for (const artifact of task.artifacts || []) {
      for (const part of artifact.parts || []) {
        if (part?.url) {
          registerFileFromDataUrl(part.url, {
            name: part.filename || artifact.name || '产物',
            origin: 'DSH 产物',
            entryId,
            role: 'output',
          })
        } else if (part?.path) {
          registerFileFromPath(part.path, { name: part.filename || artifact.name, origin: 'DSH 产物', entryId, role: 'output' })
        }
      }
    }
    return 1
  }
  return 0
}

// ---------- 日记视图 ----------
const SOURCE_ORDER = ['录音', '通知', '邮件', '聊天', '上传', '手动']

export function diaryView(date) {
  const all = db.prepare('SELECT * FROM entries WHERE date = ? ORDER BY at ASC').all(date)
  const rows = all.filter(r => (r.value ?? 1) > 0)
  const filteredOut = lastSkipped
  const collapsed = rows.filter(r => r.kind === '对话' && (r.value ?? 1) < 2).length
  const bySubject = rows.reduce((acc, r) => { const k = r.subject || '其他'; acc[k] = (acc[k] || 0) + 1; return acc }, {})
  const timeline = rows.map(row => ({
    id: row.id,
    time: new Date(row.at).toTimeString().slice(0, 5),
    at: row.at,
    actor: row.actor,
    source: row.source,
    sourceApp: row.source_app,
    kind: row.kind,
    category: row.category,
    subject: row.subject,
    title: row.title,
    summary: row.summary,
    fields: JSON.parse(row.fields || '{}'),
    refs: JSON.parse(row.refs || '{}'),
    sensitive: Boolean(row.sensitive),
    value: row.value ?? 1,
    files: db.prepare('SELECT id, name, mime, bytes, role FROM files WHERE entry_id = ?').all(row.id),
  }))
  const files = db.prepare('SELECT id, name, mime, bytes, role, origin, entry_id FROM files ORDER BY created_at DESC LIMIT 200').all()
  const todos = db.prepare('SELECT * FROM todos ORDER BY due_at ASC NULLS LAST LIMIT 200').all()
  const DOC_TYPES = /\.(md|docx?|pptx?|pdf|txt|html?)$/i
  const creative = timeline.filter(e => {
    if (e.category === '创作') return true
    if (['项目讨论', '学习'].includes(e.category)) return true
    if (e.files?.some(f => DOC_TYPES.test(f.name || ''))) return true
    return false
  })
  return {
    date,
    timeline,
    files: {
      input: files.filter(f => f.role !== 'output'),
      output: files.filter(f => f.role === 'output'),
    },
    creative,
    todos: todos.filter(t => t.due_at && dayOf(t.due_at) === date),
    stats: {
      entries: rows.length,
      files: files.length,
      sensitive: rows.filter(r => r.sensitive).length,
      filteredOut,
      collapsed,
      bySubject,
    },
  }
}

// ---------- 手动入口 ----------
function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function renderDiaryMarkdown(date) {
  const view = diaryView(date)
  const lines = []
  lines.push(`# ${date} 日记`)
  lines.push('')
  lines.push(`> 事件 ${view.stats.entries} · 文件 ${(view.files.input?.length || 0) + (view.files.output?.length || 0)} · 创作 ${view.creative?.length || 0}`)
  if (view.summary?.text) { lines.push('', view.summary.text) }
  const bySource = {}
  for (const e of view.timeline) (bySource[e.source || '其他'] ||= []).push(e)
  for (const [source, list] of Object.entries(bySource)) {
    lines.push('', `## ${source}`)
    for (const e of list) {
      const files = e.files?.length ? `（文件：${e.files.map(f => f.name).join('、')}）` : ''
      lines.push(`- ${e.time} [${e.subject || e.category}] ${e.title}${files}`)
    }
  }
  if (view.files.input?.length || view.files.output?.length) {
    lines.push('', '## 文件')
    for (const f of [...(view.files.input || []), ...(view.files.output || [])]) {
      lines.push(`- ${f.name}（${f.origin}，${formatBytes(f.bytes)}）`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

export function upsertEmailRow({ messageId, subject, from, to, dateAt, text }) {
  db.prepare(`INSERT INTO emails (message_id, subject, from_addr, to_addr, date_at, text, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET
      subject=excluded.subject, from_addr=excluded.from_addr, to_addr=excluded.to_addr,
      date_at=excluded.date_at, text=excluded.text`)
    .run(messageId, subject || '', from || '', to || '', dateAt || now(), String(text || '').slice(0, 20000), now())
}

export function listEmails({ limit = 50, offset = 0, flag = 'normal', q = '' } = {}) {
  const where = []
  const params = []
  if (flag === 'deleted') where.push('deleted = 1')
  else if (flag === 'junk') { where.push("deleted = 0 AND flagged = 'junk'"); }
  else if (flag === 'all') where.push('deleted = 0')
  else where.push("deleted = 0 AND flagged != 'junk'")
  if (q) { where.push('(subject LIKE ? OR from_addr LIKE ? OR text LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  const sql = `SELECT message_id, subject, from_addr, to_addr, date_at, flagged, deleted, substr(text,1,220) AS snippet FROM emails
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date_at DESC LIMIT ? OFFSET ?`
  return db.prepare(sql).all(...params, limit, offset).map(r => ({
    id: r.message_id, subject: r.subject, from: r.from_addr, to: r.to_addr,
    dateAt: r.date_at, flagged: r.flagged || '', deleted: Boolean(r.deleted), snippet: r.snippet,
  }))
}

function setSenderJunkPattern(sender) {
  const clean = String(sender || '').trim()
  if (clean) db.prepare('INSERT OR IGNORE INTO junk_senders (pattern, created_at) VALUES (?, ?)').run(clean, now())
}

function emailEntryId(messageId) {
  return `mail:${createHash('sha256').update(messageId).digest('hex').slice(0, 16)}`
}

export function markEmailJunk(messageId) {
  const row = db.prepare('SELECT * FROM emails WHERE message_id = ?').get(messageId)
  if (!row) return null
  db.prepare("UPDATE emails SET flagged = 'junk' WHERE message_id = ?").run(messageId)
  const sender = String(row.from_addr || '').match(/<([^>]+)>/)?.[1] || row.from_addr || ''
  if (sender) setSenderJunkPattern(sender)
  // 日记条目同步移除
  db.prepare('DELETE FROM entries WHERE id = ?').run(emailEntryId(messageId))
  return row
}

export function markSenderJunk(fromAddr) {
  const sender = String(fromAddr || '').match(/<([^>]+)>/)?.[1] || String(fromAddr || '')
  if (!sender) return 0
  const rows = db.prepare('SELECT message_id FROM emails WHERE from_addr LIKE ?').all(`%${sender}%`)
  db.prepare("UPDATE emails SET flagged = 'junk' WHERE from_addr LIKE ?").run(`%${sender}%`)
  setSenderJunkPattern(sender)
  for (const row of rows) db.prepare('DELETE FROM entries WHERE id = ?').run(emailEntryId(row.message_id))
  return rows.length
}

export function unmarkEmailJunk(messageId) {
  db.prepare("UPDATE emails SET flagged = '' WHERE message_id = ?").run(messageId)
}

export function deleteEmail(messageId) {
  db.prepare('UPDATE emails SET deleted = 1 WHERE message_id = ?').run(messageId)
  db.prepare('DELETE FROM entries WHERE id = ?').run(emailEntryId(messageId))
}

export function purgeEmail(messageId) {
  db.prepare('DELETE FROM emails WHERE message_id = ?').run(messageId)
  db.prepare('DELETE FROM entries WHERE id = ?').run(emailEntryId(messageId))
}

export function purgeDeletedEmails() {
  const rows = db.prepare('SELECT message_id FROM emails WHERE deleted = 1').all()
  for (const row of rows) {
    db.prepare('DELETE FROM entries WHERE id = ?').run(emailEntryId(row.message_id))
  }
  db.prepare('DELETE FROM emails WHERE deleted = 1').run()
  return rows.length
}

export function restoreEmail(messageId) {
  db.prepare('UPDATE emails SET deleted = 0 WHERE message_id = ?').run(messageId)
}

export function isJunkSender(fromAddr) {
  const text = String(fromAddr || '')
  const rows = db.prepare('SELECT pattern FROM junk_senders').all()
  return rows.some(r => r.pattern && text.includes(r.pattern))
}

export function getEmail(messageId) {
  return db.prepare('SELECT * FROM emails WHERE message_id = ?').get(messageId) || null
}

export function isEmailSeen(messageId) {
  return Boolean(db.prepare('SELECT 1 FROM email_seen WHERE message_id = ?').get(messageId))
}

export function markEmailSeen(messageId) {
  db.prepare('INSERT OR IGNORE INTO email_seen (message_id, at) VALUES (?, ?)').run(messageId, now())
}

export function createEmailEntry({ messageId, subject, from, to, receivedAt, text, attachments = [] }) {
  if (isEmailSeen(messageId)) return null
  if (isJunkSender(from)) { markEmailSeen(messageId); return null }
  const body = String(text || '').replace(/\s+/g, ' ').trim()
  const rel = classifySubject(`${subject} ${body}`)
  const id = `mail:${createHash('sha256').update(messageId).digest('hex').slice(0, 16)}`
  const emailText = `${subject}${body}`
  const category = /(发票|报销)/.test(emailText) ? '报销'
    : /(转入|转出|支出|消费|交易|余额|金额|账单|付款|转账)/.test(emailText) ? '消费记录'
      : '邮件记录'
  upsertEntry({
    id,
    at: receivedAt || now(),
    actor: '外部',
    source: '同步',
    sourceApp: '邮件',
    kind: '邮件',
    category,
    subject: rel.relevant ? rel.subject : '',
    title: subject || '(无主题)',
    summary: `${from ? `发件人：${from}` : ''}${body ? ` · ${body.slice(0, 140)}` : ''}`,
    fields: { from, to, messageId },
    refs: rel.project ? { project: rel.project } : {},
    sensitive: /(验证码|密码|密钥|token)/i.test(`${subject}${body}`),
    value: 2,
  })
  for (const att of attachments) {
    if (!att?.content) continue
    const dataUrl = `data:${att.contentType || 'application/octet-stream'};base64,${Buffer.from(att.content).toString('base64')}`
    registerFileFromDataUrl(dataUrl, {
      name: att.filename || '附件',
      origin: '邮件附件',
      entryId: id,
      role: 'input',
    })
  }
  markEmailSeen(messageId)
  return id
}

export function createManualEntry({ at, category, summary, amount, sensitive, todo, source = '手动' }) {
  const when = Number(at) || now()
  const id = `manual:${when}:${Math.random().toString(36).slice(2, 8)}`
  const rel = classifySubject(summary) // 手动记录也按项目/主体归类
  upsertEntry({
    id,
    at: when,
    actor: '我',
    source: '对话',
    sourceApp: '手动',
    kind: '手动记录',
    subject: rel.relevant ? rel.subject : '',
    category: category || '手动记录',
    title: truncate(summary),
    summary: String(summary || ''),
    fields: amount ? { amount } : {},
    refs: rel.project ? { project: rel.project } : {},
    sensitive,
  })
  let todoId = null
  if (todo?.title) {
    todoId = createTodo({ title: todo.title, dueAt: todo.dueAt, remindAt: todo.remindAt, source: '手动', entryId: id })
  }
  return { id, todoId }
}

export function deleteEntry(id) {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id)
  if (!row) return null
  const snapshot = JSON.stringify(row)
  db.prepare('INSERT OR REPLACE INTO tombstones (id, at, kind, title, snapshot, source) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, now(), row.kind, row.title, snapshot, 'delete')
  db.prepare('INSERT OR REPLACE INTO tombstones (id, at, kind, title, snapshot, source) VALUES (?, ?, ?, ?, ?, ?)')
    .run(signatureOf({ kind: row.kind, title: row.title }), now(), row.kind, row.title, snapshot, 'delete')
  db.prepare('DELETE FROM entries WHERE id = ?').run(id)
  return row
}

// 回收站视图：已删除条目 + 已忽略规则及其快照
// 回收站保留策略：快照保留 N 天；签名墓碑（防复活）永久保留（极小）
export function cleanupTrash(retentionDays = 30) {
  const cutoff = now() - retentionDays * 24 * 60 * 60 * 1000
  try {
    // 1) 清掉过期的删除快照（保留 sig: 墓碑与规则性拦截）
    db.prepare("DELETE FROM tombstones WHERE source = 'delete' AND snapshot IS NOT NULL AND id NOT LIKE 'sig:%' AND at < ?").run(cutoff)
    // 2) 过期忽略快照
    db.prepare('DELETE FROM suppressed_items WHERE at < ?').run(cutoff)
    // 3) 已删除条目的签名墓碑保持永久（只存 id/kind/title，极小）
    return true
  } catch { return false }
}

export function trashView() {
  const deleted = db.prepare("SELECT * FROM tombstones WHERE source = 'delete' AND snapshot IS NOT NULL AND id NOT LIKE 'sig:%' ORDER BY at DESC").all()
    .map(row => ({ id: row.id, at: row.at, kind: row.kind, title: row.title, snapshot: JSON.parse(row.snapshot || '{}') }))
  const rules = db.prepare('SELECT * FROM suppressions ORDER BY created_at DESC').all()
  const suppressed = rules.map(rule => ({
    ...rule,
    items: db.prepare('SELECT * FROM suppressed_items WHERE rule_id = ? ORDER BY at DESC LIMIT 100').all(rule.id)
      .map(item => ({ id: item.id, at: item.at, snapshot: JSON.parse(item.snapshot || '{}') })),
  }))
  return { deleted, suppressed }
}

// 恢复单条删除：删墓碑后由重新扫描重建
export function restoreDeleted(id) {
  db.prepare("DELETE FROM tombstones WHERE id = ?").run(id)
  db.prepare("DELETE FROM tombstones WHERE id = ?").run(`sig:${id}`)
  // 按快照里的 kind/title 找到签名墓碑并删除
  const row = db.prepare("SELECT * FROM tombstones WHERE id = ?").get(id)
  const snap = row?.snapshot ? JSON.parse(row.snapshot) : null
  if (snap) db.prepare("DELETE FROM tombstones WHERE id = ?").run(signatureOf(snap))
  const all = db.prepare("SELECT id, snapshot FROM tombstones WHERE source='delete'").all()
  for (const t of all) {
    if (!t.snapshot) continue
    const s = JSON.parse(t.snapshot)
    if (s.id === id || s.title === snap?.title && s.kind === snap?.kind) {
      db.prepare('DELETE FROM tombstones WHERE id = ?').run(t.id)
    }
  }
  return true
}

// 恢复忽略规则：删除规则与快照后重新扫描
export function restoreSuppression(ruleId) {
  db.prepare('DELETE FROM suppressions WHERE id = ?').run(ruleId)
  db.prepare('DELETE FROM suppressed_items WHERE rule_id = ?').run(ruleId)
  return true
}

export function suppressLike(id) {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id)
  if (!row) return null
  const ruleId = `sup_${row.kind}_${row.category}_${row.subject || 'any'}`
  db.prepare('INSERT OR IGNORE INTO suppressions (id, kind, category, subject, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ruleId, row.kind, row.category, row.subject || '', now())
  const ids = db.prepare('SELECT * FROM entries WHERE kind = ? AND category = ?').all(row.kind, row.category)
  for (const entry of ids) {
    // 保存快照用于回收站展示与恢复；同类条目靠 suppression 规则拦截重建
    db.prepare('INSERT OR REPLACE INTO suppressed_items (id, rule_id, snapshot, at) VALUES (?, ?, ?, ?)')
      .run(entry.id, ruleId, JSON.stringify(entry), now())
    db.prepare('DELETE FROM entries WHERE id = ?').run(entry.id)
  }
  return { ruleId, removed: ids.length }
}

export function createTodo({ title, dueAt, remindAt, source = '手动', entryId = '' }) {
  const id = `todo_${now()}_${Math.random().toString(36).slice(2, 6)}`
  db.prepare(`INSERT INTO todos (id, title, due_at, remind_at, status, source, entry_id, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`)
    .run(id, String(title), dueAt || null, remindAt || null, source, entryId || null, now())
  return id
}

export function deleteTodo(id) {
  db.prepare('DELETE FROM todos WHERE id = ?').run(id)
}

export function setSessionTitle(id, title) {
  if (!id) return
  db.prepare('INSERT INTO session_meta (id, title, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title')
    .run(id, String(title || '').slice(0, 60), now())
}

function sessionTitles() {
  const map = {}
  for (const row of db.prepare('SELECT id, title FROM session_meta').all()) map[row.id] = row.title
  return map
}

export function createSession(title) {
  const id = crypto.randomUUID()
  setSessionTitle(id, title)
  return { id, title }
}

export function listSessions(limit = 30) {
  const root = resolve(stateDir, 'sessions')
  if (!existsSync(root)) return []
  const out = []
  const deleted = new Set(db.prepare('SELECT id FROM deleted_sessions').all().map(r => r.id))
  const titles = sessionTitles()
  let owners = []
  try { owners = readdirSync(root) } catch { return [] }
  for (const owner of owners) {
    const ownerDir = join(root, owner)
    let sessions = []
    try { sessions = readdirSync(ownerDir) } catch { continue }
    for (const encoded of sessions) {
      const file = join(ownerDir, encoded, 'session.jsonl')
      if (!existsSync(file)) continue
      let sessionId = encoded
      try { sessionId = Buffer.from(encoded, 'base64url').toString('utf8') } catch { /* keep raw */ }
      const lines = readFileSync(file, 'utf8').split('\n')
      let title = ''
      let lastAt = 0
      let count = 0
      for (const line of lines) {
        if (!line) continue
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        const at = Date.parse(ev.time) || 0
        if (at > lastAt) lastAt = at
        if (ev.type !== 'user/message') continue
        count += 1
        const content = String(ev.payload?.content || '')
          .replace(/^【用户通过输入框发言】.*?不要自己直接回答。\s*/, '')
          .trim()
        if (!title && content) title = content.slice(0, 24)
      }
      if (deleted.has(sessionId)) continue
      out.push({ id: sessionId, title: titles[sessionId] || title || '未命名对话', lastAt, count, named: Boolean(titles[sessionId]) })
    }
  }
  // 已命名但还没产生 journal 的新会话也要能看到
  const seen = new Set(out.map(s => s.id))
  for (const row of db.prepare('SELECT id, title, created_at FROM session_meta').all()) {
    if (seen.has(row.id) || deleted.has(row.id)) continue
    out.push({ id: row.id, title: row.title || '未命名对话', lastAt: row.created_at || 0, count: 0, named: true })
  }
  return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit)
}

export function deleteSession(sessionId) {
  const root = resolve(stateDir, 'sessions')
  const encoded = Buffer.from(String(sessionId || ''), 'utf8').toString('base64url')
  let found = false
  if (existsSync(root)) {
    for (const owner of readdirSync(root)) {
      const dir = join(root, owner, encoded)
      if (!existsSync(dir)) continue
      rmSync(dir, { recursive: true, force: true })
      found = true
    }
  }
  try {
    db.prepare('INSERT OR IGNORE INTO deleted_sessions (id, at) VALUES (?, ?)').run(sessionId, now())
    db.prepare('DELETE FROM session_meta WHERE id = ?').run(sessionId)
    // 清理从该会话派生出的日记条目
    db.prepare("DELETE FROM entries WHERE refs LIKE ?").run(`%${sessionId}%`)
  } catch { /* ignore */ }
  return found
}

const TODO_TRIGGER = /(提醒我|提醒一下|记得|别忘|要交|截止|到期|明天|后天|大后天|下周[一二三四五六日天]?|周[一二三四五六日天]|月底|月初|下个月|上午|下午|晚上|\d{1,2}点)/

export function pendingTodoCandidates(limit = 20) {
  const root = resolve(stateDir, 'sessions')
  if (!existsSync(root)) return []
  const out = []
  const since = now() - 48 * 60 * 60 * 1000
  let owners = []
  try { owners = readdirSync(root) } catch { return [] }
  for (const owner of owners) {
    let sessions = []
    try { sessions = readdirSync(join(root, owner)) } catch { continue }
    for (const encoded of sessions) {
      const file = join(root, owner, encoded, 'session.jsonl')
      if (!existsSync(file)) continue
      let sessionId = encoded
      try { sessionId = Buffer.from(encoded, 'base64url').toString('utf8') } catch { /* keep */ }
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        if (ev.type !== 'user/message') continue
        const at = Date.parse(ev.time) || 0
        if (at < since) continue
        const content = String(ev.payload?.content || '')
          .replace(/^【用户通过输入框发言】.*?不要自己直接回答。\s*/, '')
          .trim()
        if (content.length < 4 || content.length > 300) continue
        if (!TODO_TRIGGER.test(content)) continue
        const msgId = `${sessionId}:${ev.seq}`
        if (db.prepare('SELECT 1 FROM todo_extractions WHERE msg_id = ?').get(msgId)) continue
        out.push({ msgId, text: content, at, sessionId })
        if (out.length >= limit) return out
      }
    }
  }
  return out
}

export function markTodoCandidate(msgId) {
  db.prepare('INSERT OR IGNORE INTO todo_extractions (msg_id, at) VALUES (?, ?)').run(msgId, now())
}

export function isMemorySynced(date) {
  return Boolean(db.prepare('SELECT 1 FROM memory_sync WHERE date = ?').get(date))
}

export function markMemorySynced(date) {
  db.prepare('INSERT OR IGNORE INTO memory_sync (date, at) VALUES (?, ?)').run(date, now())
}

export function listSystemLogs(limit = 80) {
  const logPath = resolve(stateDir, 'logs', 'gateway.log')
  if (!existsSync(logPath)) return []
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  const out = []
  const MEANINGFUL = new Set([
    'gateway.ready', 'gen.settings.saved', 'gen.settings.acp_patch', 'gen.settings.acp_patch_failed',
    'acp.process_started', 'acp.initialized', 'acp.initialization_failed', 'acp.process_exited',
    'gen.diary.auto_summary', 'gen.diary.auto_summary_failed',
    'realtime.transport_closed', 'task.failed',
  ])
  for (const line of lines.slice(-400)) {
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (!MEANINGFUL.has(ev.event)) continue
    out.push({
      time: ev.time,
      level: ev.level || 'info',
      event: ev.event,
      message: ev.error?.message ? String(ev.error.message).slice(0, 200) : '',
    })
  }
  return out.slice(-limit).reverse()
}

export function listTodos() {
  return db.prepare('SELECT * FROM todos ORDER BY (status = \'pending\') DESC, due_at ASC NULLS LAST').all()
}

export function updateTodo(id, { status, dueAt }) {
  if (status) {
    db.prepare('UPDATE todos SET status = ?, done_at = ? WHERE id = ?')
      .run(status, status === 'done' ? now() : null, id)
  }
  if (dueAt) db.prepare('UPDATE todos SET due_at = ? WHERE id = ?').run(dueAt, id)
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(id) || null
}


// ---------- 创作（Markdown 文档）----------
function creativeDir(date) {
  return resolve(dataDir, 'creative', date)
}

export function listAllCreativeDocs(limit = 50) {
  const root = resolve(dataDir, 'creative')
  if (!existsSync(root)) return []
  const out = []
  for (const day of readdirSync(root)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const dir = join(root, day)
    let names = []
    try { names = readdirSync(dir) } catch { continue }
    for (const name of names) {
      if (!name.endsWith('.md') || name.startsWith('._') || name === '.DS_Store') continue
      const p = join(dir, name)
      let st
      try { st = statSync(p) } catch { continue }
      out.push({ id: name, name, date: day, bytes: st.size, updatedAt: st.mtimeMs })
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

export function listCreativeDocs(date) {
  const dir = creativeDir(date)
  const docs = []
  let names = []
  try { names = readdirSync(dir) } catch { return docs }
  for (const name of names) {
    if (!name.endsWith('.md') || name.startsWith('._') || name === '.DS_Store') continue
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    docs.push({ id: name, name, bytes: st.size, updatedAt: st.mtimeMs, date })
  }
  return docs.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function readCreativeDoc(date, id) {
  if (!/^[^/\\]+\.md$/.test(id)) return null
  const p = join(creativeDir(date), id)
  if (!existsSync(p)) return null
  return { id, name: id, content: readFileSync(p, 'utf8') }
}

export function writeCreativeDoc(date, id, content) {
  const safe = String(id || '').trim()
  if (!/^[^/\\]+\.md$/.test(safe)) throw new Error('invalid doc name')
  const dir = creativeDir(date)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const p = join(dir, safe)
  writeFileSync(p, String(content ?? ''), { mode: 0o600 })
  // 登记到文件库（创作产物）
  const fileId = registerFileFromPath(p, { name: safe, mime: 'text/markdown', origin: '创作', role: 'output' })
  return { id: safe, name: safe, fileId }
}

export function renameCreativeDoc(date, oldId, newName) {
  const safe = String(newName || '').trim().replace(/\.md$/i, '')
  if (!safe || !/^[^/\\]+$/.test(safe)) throw new Error('invalid name')
  const newId = `${safe}.md`
  const dir = creativeDir(date)
  const from = join(dir, oldId)
  const to = join(dir, newId)
  if (!existsSync(from)) throw new Error('not found')
  if (existsSync(to) && from !== to) throw new Error('name exists')
  const content = readFileSync(from, 'utf8')
  writeFileSync(to, content, { mode: 0o600 })
  if (from !== to) { try { unlinkSync(from) } catch { /* ignore */ } }
  const fileId = registerFileFromPath(to, { name: newId, mime: 'text/markdown', origin: '创作', role: 'output' })
  return { id: newId, name: newId, fileId }
}

// ---------- 每日总结 ----------
export function entriesDigest(date) {
  const rows = db.prepare('SELECT id, title, summary, kind, category, subject, fields FROM entries WHERE date = ? ORDER BY at ASC').all(date)
  const text = rows.map(r => `${r.id}|${r.title}|${r.summary}|${r.kind}|${r.category}|${r.subject}`).join('\n')
  return { hash: createHash('sha256').update(text).digest('hex').slice(0, 16), rows }
}

export function ruleSummary(date) {
  const { rows } = entriesDigest(date)
  if (!rows.length) return { text: '今天还没有值得记入日记的事。', kind: 'empty' }
  const bySubject = {}
  const byCategory = {}
  for (const r of rows) {
    bySubject[r.subject || '其他'] = (bySubject[r.subject || '其他'] || 0) + 1
    byCategory[r.category || '其他'] = (byCategory[r.category || '其他'] || 0) + 1
  }
  const notable = rows.filter(r => (r.kind === '任务' && (r.fields || '').includes('completed'))).map(r => r.title).slice(0, 5)
  const parts = []
  parts.push(`今天有 ${rows.length} 条值得记录的事（${Object.entries(bySubject).map(([k, v]) => `${k} ${v} 条`).join('，')}）。`)
  if (notable.length) parts.push(`完成的事情包括：${notable.join('；')}。`)
  return { text: parts.join(''), kind: 'rule' }
}

export function getCachedSummary(date) {
  const { hash } = entriesDigest(date)
  const row = db.prepare('SELECT * FROM diary_summaries WHERE date = ?').get(date)
  if (!row) return { text: '', stale: true, hash }
  return { text: row.text, model: row.model, createdAt: row.created_at, stale: row.hash !== hash }
}

export function saveSummary(date, text, model = '') {
  const { hash } = entriesDigest(date)
  db.prepare(`INSERT INTO diary_summaries (date, hash, text, model, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET hash=excluded.hash, text=excluded.text, model=excluded.model, created_at=excluded.created_at`)
    .run(date, hash, text, model, now())
}

export function buildSummaryPrompt(date) {
  const { rows } = entriesDigest(date)
  const lines = rows.map(r => {
    const when = new Date(r.at).toTimeString().slice(0, 5)
    const status = r.fields ? (JSON.parse(r.fields).status || '') : ''
    return `- ${when} [${r.subject || '其他'}/${r.category}] ${r.title}${r.summary && r.summary !== r.title ? `（${String(r.summary).slice(0, 80)}）` : ''}${status ? ` [${status}]` : ''}`
  }).join('\n')
  return [
    '你是一个人的日记整理助手。下面是他/她今天的记录（只包含值得记录的事）。',
    '请用 3-5 句话写出"今天干了什么"：做了什么、完成了什么、有什么决定或问题、涉及哪些项目。',
    '要求：只依据记录，不编造；口语化、简短；不要罗列条目、不要用 Markdown 列表。',
    '',
    lines,
  ].join('\n')
}


// ---------- 项目注册表 ----------
let projectCache = null
export function listProjects() {
  return db.prepare('SELECT * FROM projects ORDER BY created_at ASC').all()
    .map(p => ({ ...p, aliases: JSON.parse(p.aliases || '[]') }))
}
export function addProject(name, aliases = []) {
  const clean = String(name || '').trim()
  if (!clean) return null
  const id = `prj_${createHash('sha256').update(clean).digest('hex').slice(0, 10)}`
  db.prepare('INSERT OR IGNORE INTO projects (id, name, aliases, created_at) VALUES (?, ?, ?, ?)')
    .run(id, clean, JSON.stringify(aliases), now())
  projectCache = null
  return { id, name: clean, aliases }
}
export function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  projectCache = null
}
function projectTerms() {
  if (projectCache) return projectCache
  const rows = listProjects()
  projectCache = rows.flatMap(p => [p.name, ...p.aliases].filter(Boolean).map(term => ({ term, name: p.name })))
  return projectCache
}
function matchProject(content) {
  const text = String(content || '')
  return projectTerms().find(({ term }) => text.includes(term)) || null
}

// ---------- 会议 ----------

export function createMeeting({ title, asrMode = 'streaming' } = {}) {
  const id = `meeting_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const d = new Date()
  const auto = `会议 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  db.prepare(`INSERT INTO meetings (id, title, started_at, duration_ms, status, asr_mode, created_at, updated_at)
    VALUES (?, ?, ?, 0, 'recording', ?, ?, ?)`)
    .run(id, String(title || '').trim() || auto, now(), asrMode, now(), now())
  return getMeeting(id)
}

export function getMeeting(id) {
  const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id)
  if (!row) return null
  const segments = db.prepare('SELECT start_ms, end_ms, text FROM meeting_segments WHERE meeting_id = ? ORDER BY start_ms ASC, id ASC').all(id)
  return { ...row, segments }
}

export function listMeetings({ limit = 50 } = {}) {
  return db.prepare(`SELECT id, title, started_at, duration_ms, status, audio_file_id, summary_md IS NOT NULL AS has_summary
    FROM meetings ORDER BY started_at DESC LIMIT ?`).all(limit)
}

export function updateMeeting(id, patch = {}) {
  const fields = []
  const values = []
  for (const key of ['title', 'duration_ms', 'status', 'audio_file_id', 'transcript', 'summary_md']) {
    if (patch[key] !== undefined) { fields.push(`${key} = ?`); values.push(patch[key]) }
  }
  if (!fields.length) return getMeeting(id)
  fields.push('updated_at = ?'); values.push(now()); values.push(id)
  db.prepare(`UPDATE meetings SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getMeeting(id)
}

function migrateMeetingSpeaker() {
  try { db.exec('ALTER TABLE meeting_segments ADD COLUMN speaker TEXT') } catch { /* already exists */ }
}

export function addMeetingSegment(meetingId, { startMs = 0, endMs = 0, text = '', speaker = '' }) {
  migrateMeetingSpeaker()
  if (!meetingId || !text) return
  db.prepare('INSERT INTO meeting_segments (meeting_id, start_ms, end_ms, text, speaker, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(meetingId, startMs, endMs, text, String(speaker || ''), now())
}

export function replaceMeetingSegments(meetingId, segments = []) {
  db.prepare('DELETE FROM meeting_segments WHERE meeting_id = ?').run(meetingId)
  for (const s of segments) addMeetingSegment(meetingId, s)
}

export function deleteMeeting(id) {
  db.prepare('DELETE FROM meetings WHERE id = ?').run(id)
  db.prepare('DELETE FROM meeting_segments WHERE meeting_id = ?').run(id)
  return true
}


// ---------- 手机通知 ----------
function notificationId(item) {
  const raw = `${item.package}|${item.postedAt}|${item.title || ''}|${item.text || ''}`
  return 'n_' + createHash('sha1').update(raw).digest('hex').slice(0, 20)
}

export function saveNotifications(items = [], { device = '' } = {}) {
  let added = 0
  const stmt = db.prepare(`INSERT OR IGNORE INTO notifications
    (id, package, app_name, title, text, posted_at, category, importance, sensitive, device, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const item of items) {
    if (!item?.package || !item?.postedAt) continue
    const id = notificationId(item)
    try {
      const res = stmt.run(
        id,
        String(item.package).slice(0, 120),
        String(item.appName || '').slice(0, 80),
        String(item.title || '').slice(0, 300),
        String(item.text || '').slice(0, 2000),
        Number(item.postedAt) || now(),
        String(item.category || 'other'),
        String(item.importance || 'normal'),
        String(item.sensitive || 'no'),
        device || '',
        now(),
      )
      if (res.changes) added += 1
    } catch { /* ignore */ }
  }
  return added
}

export function listNotifications({ date = '', category = '', q = '', limit = 200 } = {}) {
  const clauses = []
  const values = []
  if (date) {
    const start = new Date(`${date}T00:00:00+08:00`).getTime()
    clauses.push('posted_at >= ? AND posted_at < ?')
    values.push(start, start + 86400000)
  }
  if (category && category !== 'all') { clauses.push('category = ?'); values.push(category) }
  if (q) { clauses.push('(title LIKE ? OR text LIKE ? OR app_name LIKE ?)'); values.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  values.push(Math.min(Math.max(Number(limit) || 200, 1), 500))
  return db.prepare(`SELECT id, package, app_name, title, text, posted_at, category, importance, sensitive
    FROM notifications ${where} ORDER BY posted_at DESC LIMIT ?`).all(...values)
}

export function notificationStats(date) {
  const start = new Date(`${date}T00:00:00+08:00`).getTime()
  const rows = db.prepare(`SELECT category, importance, COUNT(*) AS n FROM notifications
    WHERE posted_at >= ? AND posted_at < ? GROUP BY category, importance`).all(start, start + 86400000)
  return rows
}

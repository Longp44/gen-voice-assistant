// GEN-MOD: 日记 HTTP 接口
import {
  initDiaryStore, syncJournal, diaryView, createManualEntry,
  createTodo, listTodos, updateTodo, fileObject, registerFileFromDataUrl,
  createMeeting, getMeeting, listMeetings, updateMeeting, deleteMeeting,
  saveNotifications, listNotifications, notificationStats,
  addMeetingSegment, replaceMeetingSegments,
  deleteEntry, suppressLike, trashView, restoreDeleted, restoreSuppression, // GEN-MOD: 删除/忽略/回收站
  ruleSummary, getCachedSummary, saveSummary, buildSummaryPrompt, // GEN-MOD: 每日总结
  listProjects, addProject, deleteProject, // GEN-MOD: 项目注册表
  listSystemLogs, deleteTodo, // GEN-MOD: 日志与待办
  listSessions, deleteSession, createSession, setSessionTitle, // GEN-MOD: 会话列表
  listEmails, getEmail, latestInputImage, deleteFile, markEmailJunk, unmarkEmailJunk, deleteEmail, restoreEmail, markSenderJunk, purgeEmail, purgeDeletedEmails, // GEN-MOD: 邮件查看
  pendingTodoCandidates, markTodoCandidate, isMemorySynced, markMemorySynced, // GEN-MOD: 待办抽取/记忆同步
  renderDiaryMarkdown, // GEN-MOD: 导出
  listCreativeDocs, listAllCreativeDocs, readCreativeDoc, writeCreativeDoc, renameCreativeDoc, // GEN-MOD: 创作文档

} from './gen-diary-store.mjs'
import { startEmailCollector, syncEmailNow, emailStatus, sendEmailNow } from './gen-email-collector.mjs' // GEN-MOD: 邮件采集
import { previewVoice, describeImage } from './gen-voice.mjs' // GEN-MOD: 音色试听/图片识别
import { transcribePcmChunk } from './gen-asr-chunk.mjs' // GEN-MOD: 分段实时转写

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

// GEN-MOD: 会议转写/总结助手
const MEETING_MEDIA_DIR = '/var/www/gen-media'

async function transcribeAudioFile(content, mime = 'audio/mp4') {
  const dashKey = (() => {
    try {
      const envPath = resolve(process.env.QWAUDIO_CONFIG_DIR || '', 'config.env')
      if (existsSync(envPath)) {
        const m = readFileSync(envPath, 'utf8').match(/^QWEN_AUDIO_REALTIME_API_KEY=(.+)$/m)
        if (m) return m[1].trim()
      }
    } catch { /* ignore */ }
    return process.env.QWEN_AUDIO_REALTIME_API_KEY || ''
  })()
  if (!dashKey) throw new Error('缺少 DashScope Key')
  const ext = mime.includes('wav') ? 'wav' : 'm4a'
  const name = `meeting_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const dirReady = (() => { try { mkdirSync(MEETING_MEDIA_DIR, { recursive: true }); return true } catch { return false } })()
  if (!dirReady) throw new Error('临时媒体目录不可写')
  const filePath = resolve(MEETING_MEDIA_DIR, name)
  writeFileSync(filePath, content)
  // GEN-MOD: 公网基础地址走环境变量，默认本机（见 config.env.example 的 GEN_PUBLIC_BASE_URL）
  const publicBase = (process.env.GEN_PUBLIC_BASE_URL || 'http://127.0.0.1:3201').replace(/\/+$/, '')
  const url = `${publicBase}/media/${name}`
  try {
    const submit = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
      method: 'POST',
      headers: { authorization: `Bearer ${dashKey}`, 'x-dashscope-async': 'enable', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'paraformer-v2', input: { file_urls: [url] }, parameters: { language_hints: ['zh'], diarization_enabled: true } }),
    })
    const submitted = await submit.json()
    const taskId = submitted?.output?.task_id
    if (!taskId) throw new Error(submitted?.message || 'ASR 提交失败')
    let task = null
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 3000))
      const poll = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, { headers: { authorization: `Bearer ${dashKey}` } })
      const data = await poll.json()
      task = data?.output
      if (task?.task_status === 'SUCCEEDED' || task?.task_status === 'FAILED') break
    }
    if (!task || task.task_status !== 'SUCCEEDED') throw new Error(task?.message || 'ASR 任务失败')
    let transcriptionUrl = ''
    for (const r of task.results || []) for (const sub of r.results || []) {
      if (sub.transcription_url) transcriptionUrl = sub.transcription_url
    }
    if (!transcriptionUrl) throw new Error('没有转写结果')
    const resultRes = await fetch(transcriptionUrl)
    const result = await resultRes.json()
    const transcripts = result.transcripts || []
    const text = transcripts.map(t => t.text).join('\n').trim()
    const segments = []
    for (const t of transcripts) {
      for (const sentence of t.sentences || []) {
        const st = String(sentence.text || '').trim()
        if (!st) continue
        segments.push({
          startMs: Number(sentence.begin_time ?? 0),
          endMs: Number(sentence.end_time ?? 0),
          text: st,
          speaker: sentence.speaker_id != null ? String(sentence.speaker_id) : '',
        })
      }
      if (!(t.sentences || []).length && t.text) {
        segments.push({ startMs: 0, endMs: Number(t.content_duration_in_milliseconds || 0), text: String(t.text).trim(), speaker: '' })
      }
    }
    return { text, segments }
  } finally {
    try { unlinkSync(filePath) } catch { /* ignore */ }
  }
}

function transcriptFromSegments(segments = []) {
  const speakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))]
  const multi = speakers.length > 1
  return segments
    .map(s => (multi && s.speaker ? `说话人${Number(s.speaker) + 1}：${s.text}` : s.text))
    .join('\n')
}

function wavFromPcm16(pcm, sampleRate = 16000) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function transcribePcmWindow(pcm, sampleRate) {
  const durationMs = Math.round((pcm.length / 2 / sampleRate) * 1000)
  const { text, speaker } = await transcribePcmChunk(pcm, { sampleRate })
  return { text: (text || '').replace(/\n/g, ''), durationMs, speaker }
}

async function summarizeMeeting(meeting, transcript) {
  const key = readDeepSeekKey()
  if (!key) throw new Error('未配置 DeepSeek Key')
  const prompt = [
    '你是会议纪要助手。根据下面的会议转写生成结构化中文 Markdown 纪要。',
    '格式：## 会议主题 / ## 参会人（推断，不确定写"未提及"）/ ## 讨论要点（分条）/ ## 决议 / ## 待办（每条以 - [ ] 开头，尽量含负责人和时间）',
    '不要编造转写里没有的信息；口语重复要精简。',
    '',
    `会议标题：${meeting.title || ''}`,
    '转写全文：',
    transcript.slice(0, 12000),
  ].join('\n')
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1600,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!r.ok) throw new Error(`DeepSeek 失败 HTTP ${r.status}`)
  const data = await r.json()
  const text = String(data?.choices?.[0]?.message?.content || '').trim()
  if (!text) throw new Error('总结为空')
  return text
}

function readDeepSeekKey() {
  try {
    const envPath = resolve(process.env.QWAUDIO_CONFIG_DIR || process.env.QWEN_AUDIO_CONFIG_DIR || '', 'config.env')
    if (process.env.QWAUDIO_CONFIG_DIR && existsSync(envPath)) {
      const m = readFileSync(envPath, 'utf8').match(/^DEEPSEEK_API_KEY=(.+)$/m)
      if (m) return m[1].trim()
    }
    const dshHome = process.env.DSH_HOME || resolve(homedir(), '.dsh')
    const credPath = resolve(dshHome, '.credentials.yaml')
    if (existsSync(credPath)) {
      const m = readFileSync(credPath, 'utf8').match(/^\s{2}DEEPSEEK_API_KEY:\s*(\S+)\s*$/m)
      if (m) return m[1]
    }
  } catch { /* ignore */ }
  return process.env.DEEPSEEK_API_KEY || ''
}

function ruleBasedTodo(text, nowDate = new Date()) {
  const base = new Date(nowDate)
  let dayOffset = null
  if (/大后天/.test(text)) dayOffset = 3
  else if (/后天/.test(text)) dayOffset = 2
  else if (/明天|明日/.test(text)) dayOffset = 1
  else if (/今天|今日/.test(text)) dayOffset = 0
  let due = null
  if (dayOffset !== null) {
    const d = new Date(base)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(9, 0, 0, 0)
    due = d.getTime()
  }
  const hourMatch = text.match(/(上午|中午|下午|晚上)?\s*(\d{1,2})\s*点(半)?/)
  if (hourMatch) {
    let hour = Number(hourMatch[2])
    if (hourMatch[1] === '下午' || hourMatch[1] === '晚上') hour += 12
    if (hourMatch[3]) hour += 0.5
    if (dayOffset === null) {
      const d = new Date(base)
      d.setDate(d.getDate() + 1)
      due = d.getTime()
    }
    const d = new Date(due ?? base)
    d.setHours(Math.floor(hour), hourMatch[3] ? 30 : 0, 0, 0)
    due = d.getTime()
  }
  const weekdayMatch = text.match(/(下)?周([一二三四五六日天])/)
  if (weekdayMatch && dayOffset === null) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
    const target = map[weekdayMatch[2]]
    const d = new Date(base)
    let diff = (target - d.getDay() + 7) % 7
    if (diff === 0) diff = 7
    if (weekdayMatch[1]) diff += 7
    d.setDate(d.getDate() + diff)
    d.setHours(9, 0, 0, 0)
    due = d.getTime()
  }
  if (due === null) return null
  const title = text
    .replace(/^(提醒我|提醒一下|记得|别忘了)/, '')
    .replace(/(明天|今日|今天|后天|大后天|下周[一二三四五六日天]|周[一二三四五六日天])/, '')
    .replace(/(上午|中午|下午|晚上)?\s*\d{1,2}\s*点(半)?/, '')
    .trim()
  if (title.length < 2) return null
  return { title: title.slice(0, 60), dueAt: due }
}

let todoExtractBusy = false
let genMemoryService = null // GEN-MOD: 记忆服务（由路由注册时注入）
async function extractTodosFromConversation(logger) {
  if (todoExtractBusy) return
  const candidates = pendingTodoCandidates(10)
  if (!candidates.length) return
  const key = readDeepSeekKey()
  if (!key) return
  todoExtractBusy = true
  try {
    const now = new Date()
    const local = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    for (const candidate of candidates) {
      markTodoCandidate(candidate.msgId)
      try {
        const r = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{
              role: 'user',
              content: [
                `当前时间：${local}（Asia/Shanghai）。`,
                '从下面这句话中提取"用户明确要做/需要提醒"的待办事项；提问、闲聊、天气查询、信息询问一律不提取。没有明确要做的事就返回空数组。',
                '只输出 JSON：{"todos":[{"title":"简短动作","dueAt":"ISO8601 带 +08:00 或 null"}]}',
                '不要输出其他文字。',
                `用户说：${candidate.text}`,
              ].join('\n'),
            }],
            max_tokens: 300,
            temperature: 0.1,
          }),
          signal: AbortSignal.timeout(20_000),
        })
        if (!r.ok) continue
        const data = await r.json()
        const raw = String(data?.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim()
        if (!raw) continue
        const parsed = JSON.parse(raw)
        const existing = listTodos()
        let items = parsed.todos || []
        if (!items.length) {
          const fallback = ruleBasedTodo(candidate.text)
          if (fallback) items = [fallback]
        }
        for (const todo of items) {
          const title = String(todo?.title || '').trim()
          if (!title) continue
          // 提问、闲聊、天气查询不当作待办
          if (/[？?]\s*$|吗\s*$|什么|怎么样|如何|为什么|天气/.test(title)) continue
          const looksActionable = /(提醒|记得|别忘|要|需要|打算|计划|开始|交|发|去|买|约|准备|完成|提交|打给|打电话|联系|处理|安排|开会|面试|报名|缴费|还款|预约)/.test(candidate.text)
          if (!looksActionable) continue
          let dueAt = todo?.dueAt ? Date.parse(todo.dueAt) : null
          if (Number.isFinite(dueAt)) {
            const dd = new Date(dueAt)
            if (dd.getHours() === 0 && dd.getMinutes() === 0) {
              dd.setHours(9, 0, 0, 0)
              dueAt = dd.getTime()
            }
          }
          // 已由语音提醒桥接写入的同类待办不再重复
          const dup = existing.some(t => (
            (Number.isFinite(dueAt) && t.due_at && Math.abs(t.due_at - dueAt) < 60 * 60 * 1000)
            || (t.title || '').replace(/^提醒：/, '').includes(title.slice(0, 8))
          ))
          if (dup) continue
          createTodo({
            title: title.slice(0, 120),
            dueAt: Number.isFinite(dueAt) ? dueAt : null,
            source: '对话',
            remindAt: Number.isFinite(dueAt) ? dueAt : null,
          })
        }
      } catch (error) {
        logger?.warn?.('gen.todos.extract_failed', { error: error.message })
      }
    }
  } finally {
    todoExtractBusy = false
  }
}

let autoSummaryBusy = false
async function generateSummaryFor(date, logger) {
  const prompt = buildSummaryPrompt(date)
  const key = readDeepSeekKey()
  if (!key) return false
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 500, temperature: 0.4 }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!r.ok) return false
  const data = await r.json()
  const text = String(data?.choices?.[0]?.message?.content || '').trim()
  if (!text) return false
  saveSummary(date, text, data?.model || 'deepseek-chat')
  logger?.info?.('gen.diary.auto_summary', { date })
  // GEN-MOD: 日记总结写入长期记忆（MEMORY.md），让助手越用越懂用户
  try {
    if (genMemoryService && !isMemorySynced(date) && typeof genMemoryService.apply === 'function') {
      await genMemoryService.apply('user_personal', [{
        document: 'memory',
        append: `- ${date} 日记：${String(text).replace(/\n+/g, ' ').slice(0, 300)}`,
      }], { source: 'diary-summary' })
      markMemorySynced(date)
    }
  } catch (error) {
    logger?.warn?.('gen.memory.sync_failed', { error: error?.message })
  }
  return true
}

function startAutoSummary(logger) {
  const tick = async () => {
    if (autoSummaryBusy) return
    const now = new Date()
    if (now.getHours() < 21) return
    autoSummaryBusy = true
    try {
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const cached = getCachedSummary(today)
      if (!cached.text || cached.stale) await generateSummaryFor(today, logger)
    } catch (e) { logger?.error?.('gen.diary.auto_summary_failed', { error: e }) }
    finally { autoSummaryBusy = false }
  }
  setInterval(tick, 10 * 60 * 1000) // 每 10 分钟检查（21:00 后尽快生成）
  setTimeout(tick, 60 * 1000)
  setInterval(() => { void extractTodosFromConversation(logger) }, 5 * 60 * 1000)
  setTimeout(() => { void extractTodosFromConversation(logger) }, 30 * 1000)
}

export function registerGenDiaryRoutes(app, { config, logger, memoryService }) {
  initDiaryStore(config)
  genMemoryService = memoryService || null
  startEmailCollector({ config, logger })
  startAutoSummary(logger)

  app.get('/api/gen/diary', (req, res) => {
    try {
      syncJournal()
      const date = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/)
        ? req.query.date
        : new Date().toISOString().slice(0, 10)
      res.json(diaryView(date))
    } catch (error) {
      logger?.error?.('gen.diary.read', { error })
      res.status(500).json({ error: 'diary read failed' })
    }
  })

  app.post('/api/gen/diary', (req, res) => {
    try {
      const body = req.body || {}
      if (!String(body.summary || '').trim()) return res.status(400).json({ error: 'summary required' })
      const result = createManualEntry({
        at: body.at ? Date.parse(body.at) : Date.now(),
        category: body.category,
        summary: body.summary,
        amount: body.amount,
        sensitive: Boolean(body.sensitive),
        todo: body.todo,
      })
      res.json({ ok: true, ...result })
    } catch (error) {
      logger?.error?.('gen.diary.write', { error })
      res.status(500).json({ error: 'diary write failed' })
    }
  })

  // ---------- 手机通知 ----------
  app.post('/api/gen/notifications/batch', (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : []
      const device = String(req.body?.device || '')
      const added = saveNotifications(items, { device })
      res.json({ ok: true, received: items.length, added })
    } catch (error) {
      logger?.error?.('gen.notifications.batch', { error })
      res.status(500).json({ error: 'failed' })
    }
  })

  app.get('/api/gen/notifications', (req, res) => {
    try {
      const date = String(req.query.date || '').trim()
      const category = String(req.query.category || '').trim()
      const q = String(req.query.q || '').trim()
      res.json({
        notifications: listNotifications({ date, category, q, limit: req.query.limit }),
        stats: date ? notificationStats(date) : [],
      })
    } catch (error) {
      logger?.error?.('gen.notifications.list', { error })
      res.status(500).json({ error: 'failed' })
    }
  })

  // ---------- 会议 ----------
  app.post('/api/gen/meetings', (req, res) => {
    try {
      const title = String(req.body?.title || '').trim()
      const asrMode = String(req.body?.asrMode || 'streaming')
      res.json({ ok: true, meeting: createMeeting({ title, asrMode }) })
    } catch (error) { logger?.error?.('gen.meetings.create', { error }); res.status(500).json({ error: 'failed' }) }
  })

  app.get('/api/gen/meetings', (_req, res) => {
    try { res.json({ meetings: listMeetings() }) } catch (error) {
      logger?.error?.('gen.meetings.list', { error }); res.status(500).json({ error: 'failed' })
    }
  })

  app.get('/api/gen/meetings/:id', (req, res) => {
    try {
      const meeting = getMeeting(req.params.id)
      if (!meeting) return res.status(404).json({ error: 'not found' })
      res.json({ meeting })
    } catch (error) { logger?.error?.('gen.meetings.get', { error }); res.status(500).json({ error: 'failed' }) }
  })

  app.patch('/api/gen/meetings/:id', (req, res) => {
    try {
      const meeting = updateMeeting(req.params.id, {
        title: req.body?.title,
        duration_ms: req.body?.durationMs,
        status: req.body?.status,
        transcript: req.body?.transcript,
        summary_md: req.body?.summaryMd,
      })
      if (!meeting) return res.status(404).json({ error: 'not found' })
      if (Array.isArray(req.body?.segments)) replaceMeetingSegments(req.params.id, req.body.segments)
      res.json({ ok: true, meeting })
    } catch (error) { logger?.error?.('gen.meetings.patch', { error }); res.status(500).json({ error: 'failed' }) }
  })

  app.delete('/api/gen/meetings/:id', (req, res) => {
    try { deleteMeeting(req.params.id); res.json({ ok: true }) } catch (error) {
      logger?.error?.('gen.meetings.delete', { error }); res.status(500).json({ error: 'failed' })
    }
  })

  app.post('/api/gen/meetings/:id/audio', (req, res) => {
    try {
      const raw = String(req.body?.audio || '')
      const m = raw.match(/^data:([^;,]+)[^,]*;base64,([\s\S]*)$/)
      if (!m) return res.status(400).json({ error: 'audio must be data url' })
      const mime = m[1] || 'audio/mp4'
      const buf = Buffer.from(m[2], 'base64')
      if (!buf.length) return res.status(400).json({ error: 'empty audio' })
      const meeting = getMeeting(req.params.id)
      if (!meeting) return res.status(404).json({ error: 'not found' })
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      const name = `${meeting.title || '会议'}-${stamp}.${mime.includes('wav') ? 'wav' : 'm4a'}`
      const fileId = registerFileFromDataUrl(`data:${mime};base64,${m[2]}`, { name, origin: '手机录音', role: 'input' })
      const updated = updateMeeting(req.params.id, {
        audio_file_id: fileId,
        duration_ms: Number(req.body?.durationMs) || meeting.duration_ms || 0,
        status: 'uploaded',
      })
      res.json({ ok: true, meeting: updated, fileId })
    } catch (error) { logger?.error?.('gen.meetings.audio', { error }); res.status(500).json({ error: 'failed' }) }
  })

  // 会后转写（文件转写 fallback / 分段模式）
  app.post('/api/gen/meetings/:id/transcribe', async (req, res) => {
    try {
      const meeting = getMeeting(req.params.id)
      if (!meeting) return res.status(404).json({ error: 'not found' })
      if (!meeting.audio_file_id) return res.status(400).json({ error: '还没有录音' })
      const file = fileObject(meeting.audio_file_id)
      if (!file) return res.status(400).json({ error: '录音文件不存在' })
      const result = await transcribeAudioFile(file.content, file.mime)
      const transcript = transcriptFromSegments(result.segments || []) || result.text
      updateMeeting(meeting.id, {
        transcript,
        status: transcript ? 'transcribed' : 'uploaded',
      })
      if (result.segments?.length) replaceMeetingSegments(meeting.id, result.segments)
      res.json({ ok: true, transcript, segments: result.segments || [] })
    } catch (error) {
      logger?.error?.('gen.meetings.transcribe', { error })
      res.status(502).json({ error: String(error?.message || '转写失败') })
    }
  })

  // 录音中的分段转写（原生后台录音用：每 10 秒一段 PCM）
  app.post('/api/gen/meetings/:id/chunk', async (req, res) => {
    try {
      const meeting = getMeeting(req.params.id)
      if (!meeting) return res.status(404).json({ error: 'not found' })
      const pcm = Buffer.from(String(req.body?.pcm || ''), 'base64')
      if (!pcm.length) return res.status(400).json({ error: 'pcm empty' })
      const startMs = Number(req.body?.startMs) || 0
      const sampleRate = Number(req.body?.sampleRate) || 16000
      const result = await transcribePcmWindow(pcm, sampleRate)
      logger?.info?.('gen.meetings.chunk', { meetingId: meeting.id, bytes: pcm.length, startMs, chars: (result.text || '').length, speaker: result.speaker })
      if (result.text) {
        addMeetingSegment(meeting.id, { startMs, endMs: startMs + result.durationMs, text: result.text, speaker: result.speaker ? String(result.speaker) : '' })
        const full = getMeeting(meeting.id)
        updateMeeting(meeting.id, { transcript: transcriptFromSegments(full.segments || []) })
      }
      res.json({ ok: true, text: result.text, speaker: result.speaker || 0 })
    } catch (error) {
      logger?.warn?.('gen.meetings.chunk_failed', { error: error.message })
      res.status(502).json({ error: String(error?.message || 'chunk failed') })
    }
  })

  // 生成会议总结（DeepSeek 快问通道）
  app.post('/api/gen/meetings/:id/summary', async (req, res) => {
    try {
      const meeting = getMeeting(req.params.id)
      if (!meeting) return res.status(404).json({ error: 'not found' })
      const transcript = String(req.body?.transcript || meeting.transcript || '').trim()
      if (!transcript) return res.status(400).json({ error: '没有转写文本，请先转写' })
      const summary = await summarizeMeeting(meeting, transcript)
      const updated = updateMeeting(meeting.id, { summary_md: summary, status: 'summarized' })
      let creative = null
      try {
        const today = new Date().toISOString().slice(0, 10)
        const safe = String(meeting.title || '会议').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 40)
        writeCreativeDoc(today, `会议纪要-${safe}.md`, summary)
        creative = `会议纪要-${safe}.md`
      } catch { /* 创作保存失败不影响返回 */ }
      res.json({ ok: true, summary, meeting: updated, creative })
    } catch (error) {
      logger?.error?.('gen.meetings.summary', { error })
      res.status(502).json({ error: String(error?.message || '总结失败') })
    }
  })

  app.post('/api/gen/recordings', async (req, res) => {
    try {
      const raw = String(req.body?.audio || '')
      const m = raw.match(/^data:([^;,]+)[^,]*;base64,([\s\S]*)$/)
      if (!m) return res.status(400).json({ error: 'audio 必须是 data URL' })
      const mime = m[1] || 'audio/mp4'
      const b64 = m[2]
      const buf = Buffer.from(b64, 'base64')
      if (!buf.length) return res.status(400).json({ error: '录音为空' })
      const now = new Date()
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
      const title = String(req.body?.title || `会议录音-${stamp}`)
      const fileId = registerFileFromDataUrl(`data:${mime};base64,${b64}`, {
        name: `${title}.${mime.includes('wav') ? 'wav' : 'm4a'}`,
        origin: '手机录音',
        role: 'input',
      })
      res.json({ ok: true, fileId, name: `${title}.${mime.includes('wav') ? 'wav' : 'm4a'}`, bytes: buf.length })
    } catch (error) {
      logger?.error?.('gen.recordings.upload', { error })
      res.status(500).json({ error: '上传失败' })
    }
  })

  app.delete('/api/gen/files/:id', (req, res) => {
    try {
      const row = deleteFile(req.params.id)
      if (!row) return res.status(404).json({ error: 'not found' })
      res.json({ ok: true, name: row.name })
    } catch (error) {
      logger?.error?.('gen.files.delete', { error })
      res.status(500).json({ error: 'delete failed' })
    }
  })

  app.get('/api/gen/files/:id', (req, res) => {
    const file = fileObject(req.params.id)
    if (!file) return res.status(404).json({ error: 'not found' })
    res.setHeader('content-type', file.mime || 'application/octet-stream')
    res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name || file.id)}`)
    res.end(file.content)
  })

  app.delete('/api/gen/diary/:id', (req, res) => {
    try {
      const row = deleteEntry(req.params.id)
      if (!row) return res.status(404).json({ error: 'not found' })
      res.json({ ok: true })
    } catch (error) {
      logger?.error?.('gen.diary.delete', { error })
      res.status(500).json({ error: 'delete failed' })
    }
  })

  app.post('/api/gen/diary/:id/suppress', (req, res) => {
    try {
      const result = suppressLike(req.params.id)
      if (!result) return res.status(404).json({ error: 'not found' })
      res.json({ ok: true, ...result })
    } catch (error) {
      logger?.error?.('gen.diary.suppress', { error })
      res.status(500).json({ error: 'suppress failed' })
    }
  })

  app.get('/api/gen/diary/summary', (req, res) => {
    try {
      const date = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : new Date().toISOString().slice(0, 10)
      const cached = getCachedSummary(date)
      const rule = ruleSummary(date)
      res.json({ date, cached, rule })
    } catch (error) {
      logger?.error?.('gen.diary.summary.read', { error })
      res.status(500).json({ error: 'summary read failed' })
    }
  })

  app.post('/api/gen/diary/summary', async (req, res) => {
    try {
      const date = String(req.body?.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.body.date : new Date().toISOString().slice(0, 10)
      const ok = await generateSummaryFor(date, logger)
      if (!ok) return res.status(502).json({ error: '生成失败（检查主模型 Key）' })
      const cached = getCachedSummary(date)
      res.json({ ok: true, date, text: cached.text, model: cached.model || '' })
    } catch (error) {
      logger?.error?.('gen.diary.summary.write', { error })
      res.status(500).json({ error: 'summary failed' })
    }
  })

  app.get('/api/gen/creative', (req, res) => {
    try {
      const date = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : new Date().toISOString().slice(0, 10)
      if (req.query.scope === 'all') return res.json({ date, docs: listAllCreativeDocs(100) })
      res.json({ date, docs: listCreativeDocs(date) })
    } catch (error) {
      logger?.error?.('gen.creative.list', { error })
      res.status(500).json({ error: 'creative list failed' })
    }
  })

  app.get('/api/gen/creative/:id', (req, res) => {
    try {
      const date = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : new Date().toISOString().slice(0, 10)
      let doc = readCreativeDoc(date, req.params.id)
      if (!doc) {
        const hit = listAllCreativeDocs(200).find(d => d.id === req.params.id)
        if (hit) doc = readCreativeDoc(hit.date, req.params.id)
      }
      if (!doc) return res.status(404).json({ error: 'not found' })
      res.json(doc)
    } catch (error) {
      logger?.error?.('gen.creative.read', { error })
      res.status(500).json({ error: 'creative read failed' })
    }
  })

  app.post('/api/gen/creative/:id/rename', (req, res) => {
    try {
      const date = String(req.body?.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.body.date : new Date().toISOString().slice(0, 10)
      const result = renameCreativeDoc(date, req.params.id, req.body?.name)
      res.json({ ok: true, ...result })
    } catch (error) {
      logger?.error?.('gen.creative.rename', { error })
      res.status(400).json({ error: error.message || 'rename failed' })
    }
  })

  app.put('/api/gen/creative/:id', (req, res) => {
    try {
      const date = String(req.body?.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.body.date : new Date().toISOString().slice(0, 10)
      const result = writeCreativeDoc(date, req.params.id, req.body?.content ?? '')
      res.json({ ok: true, ...result })
    } catch (error) {
      logger?.error?.('gen.creative.write', { error })
      res.status(500).json({ error: 'creative write failed' })
    }
  })

  app.get('/api/gen/diary/export', (req, res) => {
    try {
      const date = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : new Date().toISOString().slice(0, 10)
      const markdown = renderDiaryMarkdown(date)
      res.setHeader('content-type', 'text/markdown; charset=utf-8')
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`day-${date}.md`)}`)
      res.end(markdown)
    } catch (error) {
      logger?.error?.('gen.diary.export', { error })
      res.status(500).json({ error: 'export failed' })
    }
  })

  app.get('/api/gen/projects', (_req, res) => {
    try { res.json({ projects: listProjects() }) } catch (error) {
      logger?.error?.('gen.projects.read', { error })
      res.status(500).json({ error: 'projects read failed' })
    }
  })

  app.post('/api/gen/projects', (req, res) => {
    try {
      const { name, aliases } = req.body || {}
      const project = addProject(name, Array.isArray(aliases) ? aliases : [])
      if (!project) return res.status(400).json({ error: 'name required' })
      res.json({ ok: true, project })
    } catch (error) {
      logger?.error?.('gen.projects.write', { error })
      res.status(500).json({ error: 'projects write failed' })
    }
  })

  app.delete('/api/gen/projects/:id', (req, res) => {
    try { deleteProject(req.params.id); res.json({ ok: true }) } catch (error) {
      logger?.error?.('gen.projects.delete', { error })
      res.status(500).json({ error: 'projects delete failed' })
    }
  })

  app.get('/api/gen/diary/trash', (_req, res) => {
    try { res.json(trashView()) } catch (error) {
      logger?.error?.('gen.diary.trash', { error })
      res.status(500).json({ error: 'trash read failed' })
    }
  })

  app.post('/api/gen/diary/restore', (req, res) => {
    try {
      const { type, id } = req.body || {}
      if (type === 'suppression') restoreSuppression(id)
      else restoreDeleted(id)
      res.json({ ok: true })
    } catch (error) {
      logger?.error?.('gen.diary.restore', { error })
      res.status(500).json({ error: 'restore failed' })
    }
  })

  app.post('/api/gen/sessions', (req, res) => {
    try {
      const title = String(req.body?.title || '').trim()
      const session = createSession(title)
      res.json({ ok: true, session })
    } catch (error) {
      logger?.error?.('gen.sessions.create', { error })
      res.status(500).json({ error: 'session create failed' })
    }
  })

  app.patch('/api/gen/sessions/:id', (req, res) => {
    try { setSessionTitle(req.params.id, req.body?.title || ''); res.json({ ok: true }) } catch (error) {
      logger?.error?.('gen.sessions.rename', { error })
      res.status(500).json({ error: 'session rename failed' })
    }
  })

  app.get('/api/gen/email/list', (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200)
      const offset = Math.max(0, Number(req.query.offset) || 0)
      const flag = ['normal', 'junk', 'deleted', 'all'].includes(req.query.flag) ? req.query.flag : 'normal'
      const q = String(req.query.q || '').trim()
      res.json({ emails: listEmails({ limit, offset, flag, q }) })
    } catch (error) {
      logger?.error?.('gen.email.list', { error })
      res.status(500).json({ error: 'email list failed' })
    }
  })

  app.patch('/api/gen/email/:id/flag', (req, res) => {
    try {
      const flag = String(req.body?.flag || '')
      if (flag === 'junk') markEmailJunk(req.params.id)
      else unmarkEmailJunk(req.params.id)
      res.json({ ok: true })
    } catch (error) {
      logger?.error?.('gen.email.flag', { error })
      res.status(500).json({ error: 'email flag failed' })
    }
  })

  app.post('/api/gen/email/junk-sender', (req, res) => {
    try {
      const removed = markSenderJunk(String(req.body?.from || ''))
      res.json({ ok: true, removed })
    } catch (error) {
      logger?.error?.('gen.email.junk_sender', { error })
      res.status(500).json({ error: 'junk sender failed' })
    }
  })

  app.delete('/api/gen/email/:id', (req, res) => {
    try { deleteEmail(req.params.id); res.json({ ok: true }) } catch (error) {
      logger?.error?.('gen.email.delete', { error })
      res.status(500).json({ error: 'email delete failed' })
    }
  })

  app.post('/api/gen/email/purge-all', (req, res) => {
    try { res.json({ ok: true, removed: purgeDeletedEmails() }) } catch (error) {
      logger?.error?.('gen.email.purge_all', { error })
      res.status(500).json({ error: 'purge failed' })
    }
  })

  app.post('/api/gen/email/:id/purge', (req, res) => {
    try { purgeEmail(req.params.id); res.json({ ok: true }) } catch (error) {
      logger?.error?.('gen.email.purge', { error })
      res.status(500).json({ error: 'purge failed' })
    }
  })

  app.post('/api/gen/email/:id/restore', (req, res) => {
    try { restoreEmail(req.params.id); res.json({ ok: true }) } catch (error) {
      logger?.error?.('gen.email.restore', { error })
      res.status(500).json({ error: 'email restore failed' })
    }
  })

  app.get('/api/gen/email/detail/:id', (req, res) => {
    try {
      const email = getEmail(req.params.id)
      if (!email) return res.status(404).json({ error: 'not found' })
      res.json({ email: { id: email.message_id, subject: email.subject, from: email.from_addr, to: email.to_addr, dateAt: email.date_at, text: email.text } })
    } catch (error) {
      logger?.error?.('gen.email.detail', { error })
      res.status(500).json({ error: 'email detail failed' })
    }
  })

  app.post('/api/gen/email/send', async (req, res) => {
    try {
      const { to, subject, text } = req.body || {}
      if (!to || !subject) return res.status(400).json({ error: '收件人和主题必填' })
      const result = await sendEmailNow({ to: String(to), subject: String(subject), text: String(text || '') })
      res.json({ ok: true, ...result })
    } catch (error) {
      logger?.warn?.('gen.email.send_failed', { error: error.message })
      res.status(502).json({ error: String(error?.message || '发送失败') })
    }
  })

  app.post('/api/gen/vision/describe', async (req, res) => {
    try {
      let fileId = String(req.body?.fileId || '').trim()
      if (!fileId) {
        const row = latestInputImage()
        fileId = row?.id || ''
      }
      if (!fileId) return res.status(404).json({ error: '没有可识别的图片' })
      const file = fileObject(fileId)
      if (!file) return res.status(404).json({ error: '文件不存在' })
      const description = await describeImage(file.content, file.mime, String(req.body?.question || '请用简洁中文描述这张图片的内容。'))
      res.json({ ok: true, fileId, name: file.name, description })
    } catch (error) {
      logger?.warn?.('gen.vision.failed', { error: error.message })
      res.status(502).json({ error: String(error?.message || '识别失败') })
    }
  })

  app.get('/api/gen/vision/latest-image', (_req, res) => {
    try { res.json({ file: latestInputImage() }) } catch (error) {
      logger?.error?.('gen.vision.latest', { error })
      res.status(500).json({ error: 'failed' })
    }
  })

  app.post('/api/gen/voice/preview', async (req, res) => {
    try {
      const voice = String(req.body?.voice || '').trim()
      if (!voice) return res.status(400).json({ error: 'voice 必填' })
      const result = await previewVoice(voice, String(req.body?.text || '你好，我是艮，很高兴认识你。'))
      res.json({ ok: true, ...result })
    } catch (error) {
      logger?.warn?.('gen.voice.preview_failed', { error: error.message })
      res.status(502).json({ error: String(error?.message || '试听失败') })
    }
  })

  app.get('/api/gen/email/status', (_req, res) => {
    try { res.json(emailStatus()) } catch (error) {
      logger?.error?.('gen.email.status', { error })
      res.status(500).json({ error: 'email status failed' })
    }
  })

  app.post('/api/gen/email/sync', async (_req, res) => {
    try {
      const result = await syncEmailNow()
      res.json({ ok: true, ...result, status: emailStatus() })
    } catch (error) {
      res.status(502).json({ error: String(error?.message || '邮件收取失败'), status: emailStatus() })
    }
  })

  app.get('/api/gen/sessions', (_req, res) => {
    try { res.json({ sessions: listSessions() }) } catch (error) {
      logger?.error?.('gen.sessions.read', { error })
      res.status(500).json({ error: 'sessions read failed' })
    }
  })

  app.delete('/api/gen/sessions/:id', (req, res) => {
    try {
      const deleted = deleteSession(req.params.id)
      res.json({ ok: true, deleted })
    } catch (error) {
      logger?.error?.('gen.sessions.delete', { error })
      res.status(500).json({ error: 'session delete failed' })
    }
  })

  app.get('/api/gen/logs', (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 80, 200)
      res.json({ logs: listSystemLogs(limit) })
    } catch (error) {
      logger?.error?.('gen.logs.read', { error })
      res.status(500).json({ error: 'logs read failed' })
    }
  })

  app.delete('/api/gen/todos/:id', (req, res) => {
    try { deleteTodo(req.params.id); res.json({ ok: true }) } catch (error) {
      logger?.error?.('gen.todos.delete', { error })
      res.status(500).json({ error: 'todos delete failed' })
    }
  })

  app.get('/api/gen/todos', (_req, res) => {
    try { res.json({ todos: listTodos() }) } catch (error) {
      logger?.error?.('gen.todos.read', { error })
      res.status(500).json({ error: 'todos read failed' })
    }
  })

  app.post('/api/gen/todos', (req, res) => {
    try {
      const { title, dueAt, remindAt } = req.body || {}
      if (!String(title || '').trim()) return res.status(400).json({ error: 'title required' })
      const id = createTodo({ title, dueAt: dueAt ? Date.parse(dueAt) : null, remindAt: remindAt ? Date.parse(remindAt) : null })
      res.json({ ok: true, id })
    } catch (error) {
      logger?.error?.('gen.todos.write', { error })
      res.status(500).json({ error: 'todos write failed' })
    }
  })

  app.patch('/api/gen/todos/:id', (req, res) => {
    try {
      const { status, dueAt } = req.body || {}
      const todo = updateTodo(req.params.id, { status, dueAt: dueAt ? Date.parse(dueAt) : null })
      if (!todo) return res.status(404).json({ error: 'not found' })
      res.json({ ok: true, todo })
    } catch (error) {
      logger?.error?.('gen.todos.update', { error })
      res.status(500).json({ error: 'todos update failed' })
    }
  })
}

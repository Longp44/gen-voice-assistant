// GEN-ACCEPTANCE: 艮 电脑端验收脚本（语音链路 + 主模型 + 接口耗时）
// 用法：node scripts/gen-acceptance.mjs [baseUrl]
import WebSocket from 'ws'

const BASE = process.argv[2] || 'http://127.0.0.1:3201'
const WS_URL = BASE.replace(/^http/, 'ws') + '/api/realtime?sessionId=' + `gen-accept-${Date.now()}`
const results = []

function ms(start) { return Math.round(Date.now() - start) }

async function httpTests() {
  const cases = [
    ['GET', '/api/gen/settings'],
    ['GET', '/api/gen/account'],
    ['GET', '/api/gen/todos'],
    ['GET', '/api/gen/sessions'],
    ['GET', '/api/gen/email/status'],
    ['GET', '/api/gen/email/list?limit=10&flag=normal'],
    ['GET', `/api/gen/diary?date=${new Date().toISOString().slice(0, 10)}`],
    ['GET', `/api/gen/creative?date=${new Date().toISOString().slice(0, 10)}`],
    ['GET', `/api/gen/diary/export?date=${new Date().toISOString().slice(0, 10)}`],
  ]
  for (const [method, path] of cases) {
    const start = Date.now()
    try {
      const r = await fetch(BASE + path, { method })
      const body = await r.text()
      results.push({ group: 'HTTP', name: `${method} ${path.split('?')[0]}`, ok: r.ok, ms: ms(start), note: `${r.status} · ${body.length}B` })
    } catch (error) {
      results.push({ group: 'HTTP', name: `${method} ${path.split('?')[0]}`, ok: false, ms: ms(start), note: error.message })
    }
  }

  // 待办 CRUD
  let start = Date.now()
  try {
    const created = await fetch(BASE + '/api/gen/todos', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '验收测试待办', dueAt: new Date(Date.now() + 3600_000).toISOString() }),
    }).then(r => r.json())
    results.push({ group: 'HTTP', name: 'POST /api/gen/todos（创建）', ok: Boolean(created.id), ms: ms(start), note: created.id || '' })
    start = Date.now()
    const patched = await fetch(`${BASE}/api/gen/todos/${created.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    }).then(r => r.json())
    results.push({ group: 'HTTP', name: 'PATCH /api/gen/todos（完成）', ok: Boolean(patched.ok), ms: ms(start), note: '' })
    start = Date.now()
    const removed = await fetch(`${BASE}/api/gen/todos/${created.id}`, { method: 'DELETE' }).then(r => r.json())
    results.push({ group: 'HTTP', name: 'DELETE /api/gen/todos（删除）', ok: Boolean(removed.ok), ms: ms(start), note: '' })
  } catch (error) {
    results.push({ group: 'HTTP', name: '待办 CRUD', ok: false, ms: 0, note: error.message })
  }
}

function voiceTests(text = '用一句话说明什么是双工语音，不要查资料。') {
  return new Promise(resolve => {
    const t0 = Date.now()
    const ws = new WebSocket(WS_URL)
    const t = { open: 0, input: 0, responseStarted: 0, firstAudio: 0, toolCall: 0, toolResult: 0, transcriptFinal: 0, toolName: '', toolMs: 0 }
    let seq = 0
    let done = false
    const send = (type, payload = {}) => ws.send(JSON.stringify({ type, event_id: `evt_${++seq}`, ...payload }))
    const finish = note => {
      if (done) return
      done = true
      try { ws.close() } catch { /* ignore */ }
      resolve({
        openMs: t.open ? t.open - t0 : 0, responseMs: t.responseStarted - t.input || 0,
        ttfbMs: t.firstAudio ? t.firstAudio - t.input : 0,
        toolMs: t.toolMs || (t.toolResult && t.toolCall ? t.toolResult - t.toolCall : 0),
        toolName: t.toolName,
        totalMs: t.transcriptFinal ? t.transcriptFinal - t.input : 0,
        note,
      })
    }
    const timeout = setTimeout(() => finish('超时（30s）'), 30_000)

    ws.on('open', () => {
      t.open = Date.now()
      send('session.hello', {
        protocol: { min: '7.0.0', max: '7.0.0' },
        client: { type: 'web', instance_id: 'acceptance' },
        capabilities: ['input.text', 'session.takeover'],
        locale: 'zh-CN',
        connection: { input_enabled: true, output_enabled: false, takeover: true },
      })
    })
    ws.on('message', raw => {
      let m
      try { m = JSON.parse(raw) } catch { return }
      const now = Date.now()
      if (m.type === 'session.ready') {
        t.input = now
        send('conversation.item.create', { parts: [{ type: 'text', text }] })
      }
      if (m.type === 'response.started' && !t.responseStarted) t.responseStarted = now
      if (m.type === 'audio.delta' && !t.firstAudio) t.firstAudio = now
      if (m.type === 'tool.call' && m.name) {
        t.toolName = m.name
        if (m.status === 'completed' || m.status === 'failed') {
          t.toolResult = now
          if (typeof m.durationMs === 'number') t.toolMs = m.durationMs
          if (t.transcriptFinal) { /* keep */ }
        } else if (!t.toolCall) t.toolCall = now
      }
      if (m.type === 'transcript.final' && m.role === 'assistant') {
        t.transcriptFinal = now
        clearTimeout(timeout)
        finish('')
      }
      if (m.type === 'error') { clearTimeout(timeout); finish(`错误：${m.message || ''}`) }
    })
    ws.on('error', error => { clearTimeout(timeout); finish(`连接错误：${error.message}`) })
    ws.on('close', () => {
      if (!done) { clearTimeout(timeout); finish(t.transcriptFinal ? '' : '连接提前关闭') }
    })
  })
}

function printReport(voice, modelVoice) {
  const line = '-'.repeat(78)
  console.log(`\n艮 · 电脑端验收报告  ${new Date().toLocaleString('zh-CN')}`)
  console.log(line)
  console.log('【语音链路】（文本输入 → 语音模型响应）')
  console.log(`  连接建立        ${voice.openMs} ms`)
  console.log(`  首响应开始      ${voice.responseMs} ms`)
  console.log(`  首音频包(TTFB)  ${voice.ttfbMs} ms`)
  console.log(`  主模型工具       ${voice.toolName || '未调用'}  ${voice.toolMs ? voice.toolMs + ' ms' : ''}`)
  console.log(`  整轮完成        ${voice.totalMs} ms`)
  if (voice.note) console.log(`  备注            ${voice.note}`)
  console.log('')
  console.log('【主模型链路】（文字提问 → DSH 执行 → 语音转述）')
  console.log(`  首响应开始      ${modelVoice.responseMs} ms`)
  console.log(`  工具            ${modelVoice.toolName || '未调用'}  ${modelVoice.toolMs ? modelVoice.toolMs + ' ms' : ''}`)
  console.log(`  首音频包(TTFB)  ${modelVoice.ttfbMs} ms`)
  console.log(`  整轮完成        ${modelVoice.totalMs} ms`)
  if (modelVoice.note) console.log(`  备注            ${modelVoice.note}`)
  console.log(line)
  console.log('【接口】')
  for (const r of results) {
    const status = r.ok ? 'PASS' : 'FAIL'
    console.log(`  ${status}  ${String(r.ms).padStart(5)}ms  ${r.name}  ${r.note || ''}`)
  }
  const fails = results.filter(r => !r.ok).length
  console.log(line)
  console.log(`接口 ${results.length - fails}/${results.length} 通过`)
}

await httpTests()
const voice = await voiceTests()
const modelVoice = await voiceTests('请交给主模型处理：用 Python 写一个快速排序函数。')
printReport(voice, modelVoice)

// GEN-MOD: 用 DashScope 实时 ASR 直接转写 PCM 片段（无需公网文件 URL）
import WebSocket from 'ws'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function readKey() {
  try {
    const dir = process.env.QWAUDIO_CONFIG_DIR || process.env.QWEN_AUDIO_CONFIG_DIR || ''
    const p = resolve(dir, 'config.env')
    if (dir && existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^QWEN_AUDIO_REALTIME_API_KEY=(.+)$/m)
      if (m) return m[1].trim()
    }
  } catch { /* ignore */ }
  return process.env.QWEN_AUDIO_REALTIME_API_KEY || ''
}

export async function transcribePcmChunk(pcm, { sampleRate = 16000, timeoutMs = 25000 } = {}) {
  const key = readKey()
  if (!key) throw new Error('缺少 DashScope Key')
  return await new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference', {
      headers: { Authorization: `Bearer ${key}` },
    })
    const taskId = `gen_chunk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const byId = new Map()
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      try { ws.close() } catch { /* ignore */ }
      if (error) rejectPromise(error)
      else resolvePromise(value)
    }
    const timer = setTimeout(() => finish(new Error('ASR 超时')), timeoutMs)
    ws.on('open', () => {
      ws.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio', task: 'asr', function: 'recognition',
          model: 'paraformer-realtime-v2',
          parameters: { format: 'pcm', sample_rate: sampleRate, language_hints: ['zh'], speaker_diarization: true },
          input: {},
        },
      }))
    })
    ws.on('message', raw => {
      let m
      try { m = JSON.parse(raw.toString()) } catch { return }
      const event = m.header?.event
      if (event === 'task-started') {
        // 分块发送，避免单帧过大
        const chunkSize = 3200 * 5
        let offset = 0
        const sendNext = () => {
          if (offset >= pcm.length) {
            ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId }, payload: { input: {} } }))
            return
          }
          ws.send(pcm.subarray(offset, offset + chunkSize))
          offset += chunkSize
          setTimeout(sendNext, 30)
        }
        sendNext()
      }
      if (event === 'result-generated') {
        const s = m.payload?.output?.sentence
        if (s?.text) byId.set(String(s.sentence_id ?? byId.size), { text: s.text, end: s.sentence_end !== false, speaker: s.speaker_id ?? 0 })
      }
      if (event === 'task-finished') {
        clearTimeout(timer)
        const items = [...byId.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, v]) => v)
        // 去掉被后续文本包含的前缀（流式 ASR 的中间结果）
        const finals = []
        for (let i = 0; i < items.length; i += 1) {
          const next = items.slice(i + 1).find(it => it.text.startsWith(items[i].text))
          if (next) continue
          finals.push(items[i])
        }
        const speaker = finals.length ? Number(finals[0].speaker) || 0 : 0
        finish(null, { text: finals.map(f => f.text).join(''), speaker })
      }
      if (event === 'task-failed') {
        clearTimeout(timer)
        const message = String(m.header?.error_message || '')
        if (message.includes('SUCCESS_WITH_NO_VALID_FRAGMENT')) { finish(null, { text: '', speaker: 0 }); return }
        finish(new Error(message || 'ASR 失败'))
      }
    })
    ws.on('error', error => { clearTimeout(timer); finish(error) })
  })
}

// GEN-MOD: 会议实时转写 WS 桥接（手机 PCM → 艮网关 → DashScope paraformer-realtime-v2）
import { WebSocket, WebSocketServer } from 'ws'
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

const ASR_PATH = '/api/gen/asr/realtime'

export function attachGenAsrWebSocket(server, { accessRuntime, logger } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 })

  server.on('upgrade', (req, socket, head) => {
    let url
    try { url = new URL(req.url, 'http://localhost') } catch { return }
    if (url.pathname !== ASR_PATH) return
    const identity = accessRuntime?.resolveUpgrade?.(req)
    if (!identity) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })

  wss.on('connection', client => {
    const key = readKey()
    if (!key) { client.close(1011, 'asr key missing'); return }
    const taskId = `gen_asr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const upstream = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference', {
      headers: { Authorization: `Bearer ${key}` },
    })
    let ready = false
    let closed = false

    const sendJson = (obj) => { try { client.send(JSON.stringify(obj)) } catch { /* ignore */ } }
    logger?.info?.('gen.asr.client_connected', { key: key.slice(0, 6) + '…' })

    upstream.on('open', () => {
      upstream.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: 'paraformer-realtime-v2',
          parameters: { format: 'pcm', sample_rate: 16000, language_hints: ['zh'] },
          input: {},
        },
      }))
    })

    upstream.on('message', raw => {
      let m
      try { m = JSON.parse(raw.toString()) } catch { return }
      const event = m.header?.event
      if (event === 'task-started') { ready = true; sendJson({ type: 'ready' }); return }
      if (event === 'result-generated') {
        const s = m.payload?.output?.sentence
        if (s && s.text) {
          sendJson({
            type: 'sentence',
            id: s.sentence_id,
            text: s.text,
            beginMs: s.begin_time ?? 0,
            endMs: s.end_time ?? 0,
            final: s.sentence_end !== false,
          })
        }
        return
      }
      if (event === 'task-finished') { sendJson({ type: 'done' }); try { client.close() } catch { /* ignore */ } return }
      if (event === 'task-failed') {
        sendJson({ type: 'error', message: m.header?.error_message || 'asr failed' })
        try { client.close(1011) } catch { /* ignore */ }
      }
    })

    client.on('message', (data, isBinary) => {
      if (!ready) return
      if (isBinary) {
        try { upstream.send(data) } catch { /* ignore */ }
        return
      }
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'stop') {
          upstream.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId }, payload: { input: {} } }))
        }
      } catch { /* ignore */ }
    })

    const cleanup = () => {
      if (closed) return
      closed = true
      try { upstream.close() } catch { /* ignore */ }
    }
    client.on('close', cleanup)
    client.on('error', cleanup)
    upstream.on('error', error => {
      logger?.warn?.('gen.asr.upstream_error', { error: error.message, code: error.code, stack: String(error.stack || '').slice(0, 300) })
      sendJson({ type: 'error', message: error.message })
      cleanup()
    })
    upstream.on('close', () => { if (!closed) { try { client.close() } catch { /* ignore */ } } })
  })

  logger?.info?.('gen.asr.ws_attached', { path: ASR_PATH })
  return wss
}

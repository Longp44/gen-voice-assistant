// GEN-MOD: 音色列表 + 试听（真实实时模型 TTS）
import WebSocket from 'ws'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const VOICES = [
  ['longanqian_v3.1', '默认 · 龙安倩（女）'],
  ['longanlingxin_v3.1', '龙安灵心（女）'],
  ['longanlingxi_v3.1', '龙安灵犀（女）'],
  ['longanfengyue_v3.1', '龙安风月（女）'],
  ['longanhuan_v3.1', '龙安欢（女）'],
  ['longxiaoxia_v3.1', '龙小夏（女）'],
  ['xiaxiaochen_v3.1', '夏小晨（女）'],
  ['yuxiaoyun_v3.1', '于小云（女）'],
  ['qiaoxiaojiao_v3.1', '乔小娇（女）'],
  ['anxiaolan_v3.1', '安晓岚（女）'],
  ['xieshurou_v3.1', '谢书柔（女）'],
  ['baiqinglan_v3.1', '白清兰（女）'],
  ['emily_v3.1', 'Emily（女·美音）'],
  ['luna_v3.1', 'Luna（女·美音）'],
  ['abby_v3.1', 'Abby（女）'],
  ['annie_v3.1', 'Annie（女）'],
  ['ava_v3.1', 'Ava（女）'],
  ['beth_v3.1', 'Beth（女）'],
  ['betty_v3.1', 'Betty（女）'],
  ['cally_v3.1', 'Cally（女）'],
  ['cindy_v3.1', 'Cindy（女）'],
  ['donna_v3.1', 'Donna（女）'],
  ['eric_v3.1', 'Eric（男·美音）'],
  ['luca_v3.1', 'Luca（男）'],
  ['andy_v3.1', 'Andy（男）'],
  ['brian_v3.1', 'Brian（男）'],
  ['david_v3.1', 'David（男）'],
  ['anmingyuan_v3.1', '安明远（男）'],
  ['wenhuaiqing_v3.1', '文怀清（男）'],
  ['longanlang_v3.1', '龙安朗（男）'],
  ['longanzhi_v3.1', '龙安志（男）'],
  ['daniel', 'Daniel（男）'],
  ['echo', 'Echo（男）'],
  ['hannah', 'Hannah（女）'],
  ['sherry', 'Sherry（女）'],
]

function readEnv(key) {
  try {
    const dir = process.env.QWAUDIO_CONFIG_DIR || process.env.QWEN_AUDIO_CONFIG_DIR || ''
    const p = resolve(dir, 'config.env')
    if (dir && existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'))
      if (m) return m[1].trim()
    }
  } catch { /* ignore */ }
  return process.env[key] || ''
}

function wavFromPcm16(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export async function previewVoice(voice, text = '你好，我是艮，很高兴认识你。') {
  const key = readEnv('QWEN_AUDIO_REALTIME_API_KEY')
  if (!key) throw new Error('未配置语音模型 Key')
  const model = readEnv('QWEN_AUDIO_REALTIME_MODEL') || 'qwen-audio-3.1-realtime-flash'
  const url = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${encodeURIComponent(model)}`
  return await new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${key}` } })
    const chunks = []
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      try { ws.close() } catch { /* ignore */ }
      if (error) rejectPromise(error)
      else resolvePromise(result)
    }
    const timer = setTimeout(() => finish(new Error('试听超时')), 25_000)
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: { voice, modalities: ['text', 'audio'], instructions: '用一句话自然地说出下面这句话。' },
      }))
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `请说：${text}` }] },
        }))
        ws.send(JSON.stringify({ type: 'response.create', response: { instructions: `请只说这一句：${text}` } }))
      }, 250)
    })
    ws.on('message', raw => {
      let m
      try { m = JSON.parse(raw) } catch { return }
      if (m.type === 'response.audio.delta' && m.delta) chunks.push(Buffer.from(m.delta, 'base64'))
      if (m.type === 'response.done') {
        clearTimeout(timer)
        if (!chunks.length) return finish(new Error('没有生成音频'))
        finish(null, { wav: wavFromPcm16(Buffer.concat(chunks)).toString('base64'), voice })
      }
      if (m.type === 'error') {
        clearTimeout(timer)
        finish(new Error(m.error?.message || '试听失败'))
      }
    })
    ws.on('error', error => { clearTimeout(timer); finish(error) })
  })
}


// GEN-MOD: 图片识别（独立视觉模型通道）
export async function describeImage(content, mime = 'image/png', question = '请用简洁中文描述这张图片的内容。') {
  const key = readEnv('QWEN_AUDIO_REALTIME_API_KEY')
  if (!key) throw new Error('未配置语音模型 Key（视觉通道复用同一 Key）')
  const dataUrl = `data:${mime || 'image/png'};base64,${Buffer.from(content).toString('base64')}`
  const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3-vl-plus',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`视觉模型失败 HTTP ${r.status} ${text.slice(0, 120)}`)
  }
  const data = await r.json()
  const answer = String(data?.choices?.[0]?.message?.content || '').trim()
  if (!answer) throw new Error('视觉模型没有返回内容')
  return answer
}

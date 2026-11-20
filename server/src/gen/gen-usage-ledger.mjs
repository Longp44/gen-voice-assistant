// GEN-MOD: 语音用量账本 —— 从实时会话 response.done.usage 记账，按官方价目估算花费
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// 百炼华北2 单价（元/百万 token），来源：qwen-audio-3.1-realtime-flash 官方页
const PRICE = {
  textIn: 1.5,
  audioIn: 6,
  textOut: 4.5,
  audioOut: 12,
}

let dataDir = null

export function initUsageLedger(directory) {
  dataDir = directory
}

function ledgerPath() {
  return resolve(dataDir, 'usage', 'ledger.jsonl')
}

function num(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

export function recordVoiceUsage({ provider, model, ownerId, sessionId, responseId, status, usage }) {
  if (!dataDir || !usage) return
  try {
    const input = num(usage.input_tokens ?? usage.inputTokens)
    const output = num(usage.output_tokens ?? usage.outputTokens)
    const inDetails = usage.input_tokens_details || {}
    const outDetails = usage.output_tokens_details || {}
    const audioIn = num(inDetails.audio_tokens)
    const audioOut = num(outDetails.audio_tokens)
    const textIn = num(inDetails.text_tokens) || Math.max(0, input - audioIn)
    const textOut = num(outDetails.text_tokens) || Math.max(0, output - audioOut)
    const cost = (textIn * PRICE.textIn + audioIn * PRICE.audioIn + textOut * PRICE.textOut + audioOut * PRICE.audioOut) / 1e6
    const line = {
      kind: 'voice',
      at: Date.now(),
      provider: provider || '',
      model: model || '',
      ownerId: ownerId || '',
      sessionId: sessionId || '',
      responseId: responseId || '',
      status: status || '',
      input,
      output,
      audioIn,
      audioOut,
      textIn,
      textOut,
      cost: Number(cost.toFixed(6)),
    }
    mkdirSync(resolve(dataDir, 'usage'), { recursive: true })
    appendFileSync(ledgerPath(), JSON.stringify(line) + '\n')
  } catch {
    // 记账失败不能影响语音主链路
  }
}

export function readUsageSummary() {
  const empty = {
    today: { responses: 0, input: 0, output: 0, audioIn: 0, audioOut: 0, cost: 0 },
    month: { responses: 0, input: 0, output: 0, audioIn: 0, audioOut: 0, cost: 0 },
    recent: [],
  }
  if (!dataDir || !existsSync(ledgerPath())) return { supported: true, ...empty }
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const summary = structuredClone(empty)
  let text = ''
  try { text = readFileSync(ledgerPath(), 'utf8') } catch { return { supported: true, ...empty } }
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    let row
    try { row = JSON.parse(raw) } catch { continue }
    if (row.kind !== 'voice') continue
    if (row.at >= dayStart) add(summary.today, row)
    if (row.at >= monthStart) add(summary.month, row)
    summary.recent.push(row)
  }
  summary.recent = summary.recent.slice(-20).reverse()
  return { supported: true, ...summary }
}

function add(acc, row) {
  acc.responses += 1
  acc.input += row.input || 0
  acc.output += row.output || 0
  acc.audioIn += row.audioIn || 0
  acc.audioOut += row.audioOut || 0
  acc.cost = Number((acc.cost + (row.cost || 0)).toFixed(6))
}

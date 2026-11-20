// GEN-MOD: 艮设置接口（Key 输入 / 账户余额 / 用量）
// 仅服务于同源本地 UI；Key 只写不读（只返回掩码），落盘到 config.env（0600）。
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { initUsageLedger, readUsageSummary } from './gen-usage-ledger.mjs'

export const MAIN_MODELS = {
  deepseek: [
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash（默认）' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  ],
  kimi: [
    { id: 'kimi-for-coding', label: 'Kimi For Coding（默认）' },
    { id: 'kimi-for-coding-highspeed', label: 'Kimi For Coding Highspeed' },
    { id: 'k3', label: 'Kimi K3' },
    { id: 'k3-256k', label: 'Kimi K3-256K' },
    { id: 'k3.1-pro', label: 'Kimi K3.1 Pro' },
    { id: 'k3.1-pro-highspeed', label: 'Kimi K3.1 Pro Highspeed' },
  ],
}

const DEFAULT_MAIN = { provider: 'deepseek', model: 'deepseek-v4-flash' }

export const REASONING_EFFORTS = [
  { id: 'off', label: 'Off（不推理）' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High（默认）' },
  { id: 'max', label: 'Max（最强）' },
]

import { VOICES } from './gen-voice.mjs'

const ENV_KEYS = [
  'GEN_TRASH_RETENTION_DAYS',
  'GEN_EMAIL_ENABLED',
  'GEN_EMAIL_ADDRESS',
  'GEN_EMAIL_IMAP_HOST',
  'GEN_EMAIL_IMAP_PORT',
  'GEN_EMAIL_IMAP_USER',
  'GEN_EMAIL_IMAP_PASSWORD',
  'GEN_EMAIL_POLL_MINUTES',
  'GEN_EMAIL_SMTP_HOST',
  'GEN_EMAIL_SMTP_PORT',
  'QWEN_AUDIO_REALTIME_PROVIDER',
  'QWEN_AUDIO_REALTIME_MODEL',
  'QWEN_AUDIO_REALTIME_URL',
  'QWEN_AUDIO_REALTIME_VOICE',
  'GEN_VOICE_SPEED',
  'QWEN_AUDIO_REALTIME_API_KEY',
  'DEEPSEEK_API_KEY',
]

function parseEnvFile(text) {
  const values = {}
  const lines = text.split('\n')
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) values[m[1]] = m[2]
  }
  return { values, lines }
}

// DSH 凭证文件里的 refs 段存有明文 Key（version 1）；作为未在 config.env 配置时的回退来源
function readDshCredentialKeys() {
  const dshHome = process.env.DSH_HOME || resolve(homedir(), '.dsh')
  const file = resolve(dshHome, '.credentials.yaml')
  if (!existsSync(file)) return {}
  try {
    const text = readFileSync(file, 'utf8')
    const refs = {}
    let inRefs = false
    for (const line of text.split('\n')) {
      if (/^refs:\s*$/.test(line)) { inRefs = true; continue }
      if (inRefs) {
        if (/^\S/.test(line)) break
        const m = line.match(/^\s{2}([A-Z0-9_]+):\s*(\S+)\s*$/)
        if (m) refs[m[1]] = m[2]
      }
    }
    return refs
  } catch { return {} }
}

function mask(value) {
  const v = String(value || '')
  if (!v) return ''
  if (v.length <= 8) return '••••'
  return `${v.slice(0, 3)}…${v.slice(-4)}`
}

function setEnvLines(lines, updates) {
  const keys = new Set(Object.keys(updates))
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/)
    if (!m || !keys.has(m[1])) return line
    keys.delete(m[1])
    return `${m[1]}=${updates[m[1]] ?? ''}`
  })
  for (const key of keys) out.push(`${key}=${updates[key] ?? ''}`)
  return out.join('\n')
}

export function registerGenSettingsRoutes(app, { config, logger }) {
  const configPath = resolve(config.configDirectory, 'config.env')
  if (config.dataDirectory) initUsageLedger(config.dataDirectory)

  function readConfig() {
    const text = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
    return parseEnvFile(text)
  }

  function publicView() {
    const { values } = readConfig()
    const fallback = readDshCredentialKeys()
    const realtimeKey = values.QWEN_AUDIO_REALTIME_API_KEY || fallback.DASHSCOPE_API_KEY || ''
    const mainKey = values.DEEPSEEK_API_KEY || fallback.DEEPSEEK_API_KEY || ''
    const kimiKey = values.KIMI_API_KEY || values.KIMI_CODING_API_KEY || fallback.KIMI_CODING_API_KEY || ''
    const provider = values.GEN_MAIN_PROVIDER || DEFAULT_MAIN.provider
    const model = values.GEN_MAIN_MODEL || DEFAULT_MAIN.model
    const reasoningEffort = values.GEN_REASONING_EFFORT || 'high'
    return {
      configPath,
      diary: {
        retentionDays: Number(values.GEN_TRASH_RETENTION_DAYS || 30),
      },
      voice: {
        current: values.QWEN_AUDIO_REALTIME_VOICE || 'longanqian_v3.1',
        options: VOICES.map(([id, label]) => ({ id, label })),
        speed: Number(values.GEN_VOICE_SPEED || 1) || 1,
      },
      email: {
        enabled: String(values.GEN_EMAIL_ENABLED || 'off').toLowerCase() === 'on',
        address: values.GEN_EMAIL_ADDRESS || '',
        host: values.GEN_EMAIL_IMAP_HOST || 'imap.gmail.com',
        port: Number(values.GEN_EMAIL_IMAP_PORT || 993),
        user: values.GEN_EMAIL_IMAP_USER || values.GEN_EMAIL_ADDRESS || '',
        password: { present: Boolean(values.GEN_EMAIL_IMAP_PASSWORD), hint: mask(values.GEN_EMAIL_IMAP_PASSWORD) },
        pollMinutes: Number(values.GEN_EMAIL_POLL_MINUTES || 15),
        smtpHost: values.GEN_EMAIL_SMTP_HOST || '',
        smtpPort: Number(values.GEN_EMAIL_SMTP_PORT || 465),
      },
      realtime: {
        provider: values.QWEN_AUDIO_REALTIME_PROVIDER || 'dashscope',
        model: values.QWEN_AUDIO_REALTIME_MODEL || '',
        endpoint: values.QWEN_AUDIO_REALTIME_URL || '',
        voice: values.QWEN_AUDIO_REALTIME_VOICE || '',
        apiKey: { present: Boolean(realtimeKey), hint: mask(realtimeKey), source: values.QWEN_AUDIO_REALTIME_API_KEY ? 'config.env' : (fallback.DASHSCOPE_API_KEY ? 'DSH 凭证' : null) },
      },
      main: {
        provider,
        model,
        models: MAIN_MODELS,
        reasoningEffort,
        reasoningEfforts: REASONING_EFFORTS,
        apiKey: { present: Boolean(mainKey), hint: mask(mainKey), source: values.DEEPSEEK_API_KEY ? 'config.env' : (fallback.DEEPSEEK_API_KEY ? 'DSH 凭证' : null) },
        kimiApiKey: { present: Boolean(kimiKey), hint: mask(kimiKey), source: values.KIMI_API_KEY || values.KIMI_CODING_API_KEY ? 'config.env' : (fallback.KIMI_CODING_API_KEY ? 'DSH 凭证' : null) },
        via: 'DSH（ACP）· 后台执行始终由 DSH 承担',
      },
    }
  }

  app.get('/api/gen/settings', (_req, res) => {
    try { res.json(publicView()) } catch (error) {
      logger?.error?.('gen.settings.read', { error })
      res.status(500).json({ error: 'settings read failed' })
    }
  })

  app.put('/api/gen/settings', (req, res) => {
    try {
      const body = req.body || {}
      const updates = {}
      const realtime = body.realtime || {}
      const main = body.main || {}
      if (typeof realtime.apiKey === 'string') updates.QWEN_AUDIO_REALTIME_API_KEY = realtime.apiKey.trim()
      if (typeof realtime.model === 'string') updates.QWEN_AUDIO_REALTIME_MODEL = realtime.model.trim()
      if (typeof realtime.endpoint === 'string') updates.QWEN_AUDIO_REALTIME_URL = realtime.endpoint.trim()
      if (typeof realtime.voice === 'string') updates.QWEN_AUDIO_REALTIME_VOICE = realtime.voice.trim()
      const mainProvider = main.provider === 'kimi' ? 'kimi' : (main.provider === 'deepseek' ? 'deepseek' : null)
      const mainModel = typeof main.model === 'string' ? main.model.trim() : ''
      if (mainProvider) updates.GEN_MAIN_PROVIDER = mainProvider
      if (mainModel) updates.GEN_MAIN_MODEL = mainModel
      const effort = typeof main.reasoningEffort === 'string' ? main.reasoningEffort.trim() : ''
      if (effort && REASONING_EFFORTS.some(e => e.id === effort)) updates.GEN_REASONING_EFFORT = effort
      const voice = body.voice || {}
      if (typeof voice.current === 'string' && voice.current.trim()) {
        updates.QWEN_AUDIO_REALTIME_VOICE = voice.current.trim()
        process.env.QWEN_AUDIO_REALTIME_VOICE = voice.current.trim() // 立即对新会话生效
      }
      if (voice.speed !== undefined && Number.isFinite(Number(voice.speed))) {
        const speed = Math.min(2, Math.max(0.5, Number(voice.speed)))
        updates.GEN_VOICE_SPEED = String(speed)
        process.env.GEN_VOICE_SPEED = String(speed)
      }
      const email = body.email || {}
      if (email.enabled !== undefined) updates.GEN_EMAIL_ENABLED = email.enabled ? 'on' : 'off'
      if (typeof email.address === 'string') updates.GEN_EMAIL_ADDRESS = email.address.trim()
      if (typeof email.host === 'string' && email.host.trim()) updates.GEN_EMAIL_IMAP_HOST = email.host.trim()
      if (email.port !== undefined && Number.isFinite(Number(email.port))) updates.GEN_EMAIL_IMAP_PORT = String(Math.trunc(Number(email.port)))
      if (typeof email.user === 'string') updates.GEN_EMAIL_IMAP_USER = email.user.trim()
      if (typeof email.password === 'string' && email.password.trim()) updates.GEN_EMAIL_IMAP_PASSWORD = email.password.trim()
      if (email.pollMinutes !== undefined && Number.isFinite(Number(email.pollMinutes))) updates.GEN_EMAIL_POLL_MINUTES = String(Math.max(1, Math.trunc(Number(email.pollMinutes))))
      if (typeof email.smtpHost === 'string') updates.GEN_EMAIL_SMTP_HOST = email.smtpHost.trim()
      if (email.smtpPort !== undefined && Number.isFinite(Number(email.smtpPort))) updates.GEN_EMAIL_SMTP_PORT = String(Math.trunc(Number(email.smtpPort)))
      const diary = body.diary || {}
      if (diary.retentionDays !== undefined) {
        const days = Number(diary.retentionDays)
        if (Number.isFinite(days) && days >= 0 && days <= 3650) updates.GEN_TRASH_RETENTION_DAYS = String(Math.floor(days))
      }
      if (typeof main.apiKey === 'string' && main.apiKey.trim()) {
        const key = main.apiKey.trim()
        if ((mainProvider || '') === 'kimi') {
          updates.KIMI_API_KEY = key
          updates.KIMI_CODING_API_KEY = key
        } else {
          updates.DEEPSEEK_API_KEY = key
        }
      }
      if (!Object.keys(updates).length) return res.status(400).json({ error: 'no fields' })
      if (Object.values(updates).some(v => typeof v !== 'string')) return res.status(400).json({ error: 'invalid field' })
      const { lines } = readConfig()
      const next = setEnvLines(lines, updates)
      const tmp = `${configPath}.tmp-${process.pid}`
      writeFileSync(tmp, next, { mode: 0o600 })
      renameSync(tmp, configPath)
      chmodSync(configPath, 0o600)
      if (mainProvider || mainModel || updates.KIMI_API_KEY) {
        const provider = mainProvider || readConfig().values.GEN_MAIN_PROVIDER || DEFAULT_MAIN.provider
        const model = mainModel || readConfig().values.GEN_MAIN_MODEL || DEFAULT_MAIN.model
        applyAcpMainModel({ provider, model, logger })
      }
      logger?.info?.('gen.settings.saved', { keys: Object.keys(updates), path: configPath })
      res.json({ ok: true, settings: publicView(), restartRequired: true })
    } catch (error) {
      logger?.error?.('gen.settings.write', { error })
      res.status(500).json({ error: 'settings write failed' })
    }
  })

  // 账户余额：DeepSeek 官方接口实时查询；DashScope sk key 不支持查余额
  app.get('/api/gen/account', async (_req, res) => {
    const { values } = readConfig()
    const fallback = readDshCredentialKeys()
    const deepseekKey = values.DEEPSEEK_API_KEY || fallback.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY
    let deepseek
    if (!deepseekKey) {
      deepseek = { ok: false, error: '未配置主模型 Key' }
    } else {
      try {
        const r = await fetch('https://api.deepseek.com/user/balance', {
          headers: { Authorization: `Bearer ${deepseekKey}` },
          signal: AbortSignal.timeout(6000),
        })
        if (!r.ok) deepseek = { ok: false, error: `HTTP ${r.status}` }
        else {
          const data = await r.json()
          deepseek = {
            ok: true,
            available: data.is_available,
            balances: (data.balance_infos || []).map(b => ({
              currency: b.currency,
              total: b.total_balance,
              granted: b.granted_balance,
              toppedUp: b.topped_up_balance,
            })),
            checkedAt: new Date().toISOString(),
          }
        }
      } catch (error) {
        deepseek = { ok: false, error: error?.name === 'TimeoutError' ? '查询超时' : '查询失败' }
      }
    }
    res.json({
      deepseek,
      dashscope: {
        ok: false,
        supported: false,
        hint: 'DashScope（sk 开头）Key 无法查询账户余额；余额请在百炼控制台查看，或在配置阿里云 RAM AccessKey 后接入 BSS 账单接口',
      },
    })
  })

  // 用量：本地统计（MVP 返回空数据 + 明确标注，后续 Q3 接入账本）
  app.get('/api/gen/usage', (_req, res) => {
    try {
      const voice = readUsageSummary()
      res.json({
        supported: true,
        voice,
        main: { supported: false, note: '主模型用量待 Q3 从 DSH 会话聚合' },
        pricing: { textIn: 1.5, audioIn: 6, textOut: 4.5, audioOut: 12, currency: 'CNY', unit: 'token' },
      })
    } catch (error) {
      logger?.error?.('gen.usage.read', { error })
      res.status(500).json({ error: 'usage read failed' })
    }
  })
}


function acpPatchPath() {
  const dshHome = process.env.DSH_HOME || resolve(homedir(), '.dsh')
  return resolve(dshHome, 'profiles', 'acp', 'cordis.patch.yml')
}

// 艮托管：把 acp profile 的模型行切到所选 provider/model。
// 后台执行始终是 DSH（dsh --profile acp），这里只改 DSH 使用哪个模型。
function applyAcpMainModel({ provider, model, logger }) {
  try {
    const file = acpPatchPath()
    const dir = resolve(file, '..')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const isKimi = provider === 'kimi'
    const lines = [
      '# 艮（GEN）托管：主模型路由。由模型设置页生成，手工修改会被覆盖。',
      '# 后台执行始终由 DSH 承担（dsh --profile acp）。',
    ]
    if (isKimi) {
      lines.push(
        '- id: llm-pi-ai',
        '  config:',
        '    providers:',
        '      kimi-coding:',
        '        apiKeyEnv: KIMI_API_KEY',
        '        displayName: Kimi For Coding',
      )
    }
    lines.push(
      '- id: acp',
      '  config:',
      `    provider: ${isKimi ? 'kimi-coding' : 'deepseek-official'}`,
      `    model: ${model}`,
    )
    const tmp = `${file}.tmp-${process.pid}`
    writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 })
    renameSync(tmp, file)
    logger?.info?.('gen.settings.acp_patch', { provider, model, file })
  } catch (error) {
    logger?.error?.('gen.settings.acp_patch_failed', { error })
  }
}

// GEN-MOD: 邮件采集器（IMAP）——定时收件 → 日记"同步"来源条目
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createEmailEntry, isEmailSeen, upsertEmailRow } from './gen-diary-store.mjs'

const DEFAULTS = {
  host: 'imap.gmail.com',
  port: 993,
  pollMinutes: 15,
}

function readEnv(config) {
  const env = {}
  try {
    const path = resolve(config?.configDirectory || '', 'config.env')
    if (existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
        if (m) env[m[1]] = m[2]
      }
    }
  } catch { /* ignore */ }
  return env
}

function emailConfig(config) {
  const env = readEnv(config)
  return {
    enabled: String(env.GEN_EMAIL_ENABLED || 'off').toLowerCase() === 'on',
    address: String(env.GEN_EMAIL_ADDRESS || '').trim(),
    host: String(env.GEN_EMAIL_IMAP_HOST || DEFAULTS.host).trim(),
    port: Number(env.GEN_EMAIL_IMAP_PORT || DEFAULTS.port),
    user: String(env.GEN_EMAIL_IMAP_USER || env.GEN_EMAIL_ADDRESS || '').trim(),
    pass: String(env.GEN_EMAIL_IMAP_PASSWORD || '').trim(),
    pollMinutes: Math.max(1, Number(env.GEN_EMAIL_POLL_MINUTES || DEFAULTS.pollMinutes)),
    rawEnv: env,
  }
}

let busy = false
let lastRun = 0
let lastError = ''
let lastCount = 0
let timer = null
let log = null
let cfgReader = null

export function emailStatus() {
  const cfg = cfgReader ? cfgReader() : {}
  return {
    enabled: Boolean(cfg.enabled),
    address: cfg.address || '',
    host: cfg.host || '',
    port: cfg.port || 993,
    user: cfg.user || '',
    hasPassword: Boolean(cfg.pass),
    pollMinutes: cfg.pollMinutes || 15,
    lastRun,
    lastError,
    lastCount,
  }
}

export async function syncEmailNow({ days = 7 } = {}) {
  const cfg = cfgReader ? cfgReader() : {}
  if (!cfg.user || !cfg.pass) throw new Error('邮箱账号或授权码未配置')
  if (busy) return { skipped: true }
  busy = true
  lastError = ''
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
  })
  let added = 0
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      for await (const msg of client.fetch({ since }, { source: true, envelope: true })) {
        try {
          const parsed = await simpleParser(msg.source)
          const messageId = parsed.messageId || `uid:${msg.uid}`
          const from = parsed.from?.value?.[0]
          const htmlClean = String(parsed.html || '')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<!doctype[^>]*>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<\/?[a-z][^>]*>/gi, ' ')
          const textBody = String(parsed.text || htmlClean || '')
            .replace(/\r/g, '')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
          upsertEmailRow({
            messageId,
            subject: parsed.subject || '',
            from: from ? `${from.name || ''} <${from.address || ''}>` : '',
            to: Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(', ') : (parsed.to?.text || ''),
            dateAt: parsed.date ? parsed.date.getTime() : Date.now(),
            text: textBody,
          })
          if (isEmailSeen(messageId)) continue
          createEmailEntry({
            messageId,
            subject: parsed.subject || '',
            from: from ? `${from.name || ''} <${from.address || ''}>` : '',
            to: Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(', ') : (parsed.to?.text || ''),
            receivedAt: parsed.date ? parsed.date.getTime() : Date.now(),
            text: parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '',
            attachments: (parsed.attachments || []).map(a => ({
              filename: a.filename,
              contentType: a.contentType,
              content: a.content,
            })).filter(a => a.content && a.content.length < 20 * 1024 * 1024),
          })
          added += 1
        } catch (error) {
          log?.warn?.('gen.email.parse_failed', { error: error.message })
        }
      }
    } finally {
      lock.release()
    }
    lastRun = Date.now()
    lastCount = added
    log?.info?.('gen.email.synced', { added })
    return { added }
  } catch (error) {
    lastError = String(error?.message || error)
    lastRun = Date.now()
    log?.warn?.('gen.email.sync_failed', { error: lastError })
    throw error
  } finally {
    busy = false
    try { await client.logout() } catch { /* ignore */ }
  }
}

export async function sendEmailNow({ to, subject, text, html }) {
  const cfg = cfgReader ? cfgReader() : {}
  if (!cfg.user || !cfg.pass) throw new Error('邮箱账号或授权码未配置')
  const env = cfg.rawEnv || {}
  const host = env.GEN_EMAIL_SMTP_HOST || cfg.host.replace(/^imap\./, 'smtp.')
  const port = Number(env.GEN_EMAIL_SMTP_PORT || 465)
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  })
  const info = await transporter.sendMail({
    from: cfg.address || cfg.user,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  })
  return { messageId: info.messageId, accepted: info.accepted || [] }
}

export function startEmailCollector({ config, logger }) {
  cfgReader = () => emailConfig(config)
  log = logger
  const tick = () => {
    const cfg = cfgReader()
    if (!cfg.enabled || !cfg.user || !cfg.pass) return
    void syncEmailNow().catch(() => {})
  }
  setTimeout(tick, 20_000)
  timer = setInterval(tick, Math.max(1, emailConfig(config).pollMinutes) * 60 * 1000)
  return { stop: () => { if (timer) clearInterval(timer) } }
}

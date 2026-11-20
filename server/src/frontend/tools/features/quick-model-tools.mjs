// GEN-MOD: ask_quick_model —— 简单问答走直连 API（约 1-2s），不启动 DSH Agent
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

export const ASK_QUICK_MODEL_TOOL_NAME = 'ask_quick_model'

function readKey() {
  try {
    const cfgDir = process.env.QWAUDIO_CONFIG_DIR || process.env.QWEN_AUDIO_CONFIG_DIR || ''
    const envPath = resolve(cfgDir, 'config.env')
    if (cfgDir && existsSync(envPath)) {
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

const tool = {
  type: 'function',
  function: {
    name: ASK_QUICK_MODEL_TOOL_NAME,
    description: [
      '快速问答通道：适合闲聊、常识、解释概念、翻译、润色、简单计算等不需要电脑操作的问题。',
      '直连文本模型，1-2 秒返回，适合立即回答。',
      '需要代码执行、读写文件、浏览器操作、深入多步推理时，改用 spawn_thinking 交给后台异步执行。',
      '调用前先对用户说一句简短过渡语（如"好的，我看一下"），再调用本工具。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '要回答的问题，保留用户完整意图' },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
}

export const quickModelToolEntries = [
  { definition: tool, policy: { responseOnSuccess: 'auto' } },
]

export function quickModelToolHandlers(runtime) {
  return {
    [ASK_QUICK_MODEL_TOOL_NAME]: async ({ callId, turnId, args }) => {
      const question = String(args?.question || '').trim()
      if (!question) {
        await runtime.sendOutput(callId, { status: 'error', error: 'question 不能为空' }, turnId)
        return
      }
      const key = readKey()
      if (!key) {
        await runtime.sendOutput(callId, { status: 'error', error: '未配置主模型 Key' }, turnId)
        return
      }
      try {
        const r = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: '你是语音助手，用简短口语回答，控制在 120 字以内，不要输出 Markdown。' },
              { role: 'user', content: question },
            ],
            max_tokens: 400,
            temperature: 0.6,
          }),
          signal: AbortSignal.timeout(20_000),
        })
        if (!r.ok) throw new Error(`模型 HTTP ${r.status}`)
        const data = await r.json()
        const answer = String(data?.choices?.[0]?.message?.content || '').trim()
        if (!answer) throw new Error('模型没有返回内容')
        await runtime.sendOutput(callId, { status: 'ok', answer }, turnId)
      } catch (error) {
        await runtime.sendOutput(callId, { status: 'error', error: String(error?.message || '快问失败').slice(0, 200) }, turnId)
      }
    },
  }
}

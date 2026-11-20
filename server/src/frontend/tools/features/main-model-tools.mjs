// GEN-MOD: ask_main_model —— 输入框文字交给主模型（DSH）回答，语音模型只负责转述
import { registerActiveRun, unregisterActiveRun } from './active-runs.mjs'
export const ASK_MAIN_MODEL_TOOL_NAME = 'ask_main_model'

const askMainModelTool = {
  type: 'function',
  function: {
    name: ASK_MAIN_MODEL_TOOL_NAME,
    description: [
      '把问题交给主模型（DSH，具备代码、文件、深入推理能力）回答，然后由你用自然口语转述回答。',
      '用户通过文字输入提问时，优先调用本工具，而不是自己直接作答。',
      '调用后把 answer 当作事实材料，用自己的话完整、准确地转述；不要逐字朗读代码块或路径。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: '要交给主模型的完整问题或指令，保留用户的原始意图和必要上下文。',
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
}

export const mainModelToolEntries = [
  { definition: askMainModelTool, policy: { responseOnSuccess: 'auto' } },
]

export function mainModelToolHandlers(runtime) {
  return {
    [ASK_MAIN_MODEL_TOOL_NAME]: async ({ callId, turnId, args }) => {
      const question = String(args?.question || '').trim()
      if (!question) {
        await runtime.sendOutput(callId, { status: 'error', error: 'question 不能为空' }, turnId)
        return
      }
      const backend = runtime.backendRuntime
      if (!backend) {
        await runtime.sendOutput(callId, { status: 'error', error: '后台主模型未配置' }, turnId)
        return
      }
      try {
        const ownerId = String(runtime.ownerId || 'user_personal')
        const taskId = `ask_${Date.now().toString(36)}`
        registerActiveRun(taskId, runtime)
        let result
        try {
          result = await backend.run(
            { instruction: question, objective: question },
            {
              taskId,
              ownerId,
              signal: AbortSignal.timeout(180_000),
            },
          )
        } finally {
          unregisterActiveRun(taskId)
        }
        const answer = String(result?.content || '').trim()
        if (!answer) {
          await runtime.sendOutput(callId, { status: 'error', error: '主模型没有返回内容' }, turnId)
          return
        }
        await runtime.sendOutput(callId, { status: 'ok', answer }, turnId)
      } catch (error) {
        await runtime.sendOutput(callId, {
          status: 'error',
          error: String(error?.message || '主模型调用失败').slice(0, 300),
        }, turnId)
      }
    },
  }
}

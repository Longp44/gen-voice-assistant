// GEN-MOD: create_creative_doc —— 把对话内容整理成 Markdown 创作文档
import { writeCreativeDoc } from '../../../gen/gen-diary-store.mjs'

export const CREATE_CREATIVE_DOC_TOOL_NAME = 'create_creative_doc'

const tool = {
  type: 'function',
  function: {
    name: CREATE_CREATIVE_DOC_TOOL_NAME,
    description: [
      '把内容保存为「日记 → 创作」里的 Markdown 文档。',
      '用户说"整理成文档 / 写成方案 / 生成周报 / 记录下来"时调用本工具。',
      'title 用简短标题（不要带 .md）；content 是完整 Markdown 正文。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '文档标题，如：数据安全方案' },
        content: { type: 'string', description: 'Markdown 正文内容' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
  },
}

export const creativeToolEntries = [
  { definition: tool, policy: { responseOnSuccess: 'auto' } },
]

export function creativeToolHandlers(runtime) {
  return {
    [CREATE_CREATIVE_DOC_TOOL_NAME]: async ({ callId, turnId, args }) => {
      try {
        const title = String(args?.title || '').trim().replace(/\.md$/i, '')
        const content = String(args?.content || '').trim()
        if (!title || !content) {
          await runtime.sendOutput(callId, { status: 'error', error: 'title 和 content 必填' }, turnId)
          return
        }
        const today = new Date().toISOString().slice(0, 10)
        const safe = title.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60) || '创作'
        const result = writeCreativeDoc(today, `${safe}.md`, content)
        await runtime.sendOutput(callId, { status: 'ok', doc: result?.name || `${safe}.md`, date: today }, turnId)
      } catch (error) {
        await runtime.sendOutput(callId, { status: 'error', error: String(error?.message || '保存失败').slice(0, 200) }, turnId)
      }
    },
  }
}

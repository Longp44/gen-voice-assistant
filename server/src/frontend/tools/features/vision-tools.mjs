// GEN-MOD: describe_image —— 让语音模型通过视觉模型识别用户上传的图片
import { fileObject, latestInputImage } from '../../../gen/gen-diary-store.mjs'
import { describeImage } from '../../../gen/gen-voice.mjs'

export const DESCRIBE_IMAGE_TOOL_NAME = 'describe_image'

const tool = {
  type: 'function',
  function: {
    name: DESCRIBE_IMAGE_TOOL_NAME,
    description: [
      '识别用户上传的图片内容（用独立视觉模型通道）。',
      '用户上传图片后问"这是什么/帮我看看/识别一下"时必须调用本工具，不要说没有识图通道。',
      '默认识别最近上传的一张图片；有多张时用 fileId 指定。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: '可选：指定文件 ID，默认最近上传的图片' },
        question: { type: 'string', description: '可选：针对图片的具体问题' },
      },
      additionalProperties: false,
    },
  },
}

export const visionToolEntries = [
  { definition: tool, policy: { responseOnSuccess: 'auto' } },
]

export function visionToolHandlers(runtime) {
  return {
    [DESCRIBE_IMAGE_TOOL_NAME]: async ({ callId, turnId, args }) => {
      try {
        let fileId = String(args?.fileId || '').trim()
        if (!fileId) {
          const latest = latestInputImage()
          fileId = latest?.id || ''
        }
        if (!fileId) {
          await runtime.sendOutput(callId, { status: 'error', error: '没有找到可识别的图片，请让用户先上传' }, turnId)
          return
        }
        const file = fileObject(fileId)
        if (!file) {
          await runtime.sendOutput(callId, { status: 'error', error: '文件不存在' }, turnId)
          return
        }
        const description = await describeImage(
          file.content,
          file.mime,
          String(args?.question || '请用简洁中文描述这张图片的内容。'),
        )
        await runtime.sendOutput(callId, { status: 'ok', fileId, name: file.name, description }, turnId)
      } catch (error) {
        await runtime.sendOutput(callId, { status: 'error', error: String(error?.message || '识别失败').slice(0, 200) }, turnId)
      }
    },
  }
}

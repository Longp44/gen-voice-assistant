// GEN-MOD: create_project —— 项目在对话中产生（讨论/立项时登记），不在日记里手写
import { addProject, listProjects } from '../../../gen/gen-diary-store.mjs'

export const CREATE_PROJECT_TOOL_NAME = 'create_project'

const createProjectTool = {
  type: 'function',
  function: {
    name: CREATE_PROJECT_TOOL_NAME,
    description: [
      '当用户在对话中提出一个新项目、立项、或给某件事起一个项目名时，调用本工具登记项目。',
      '登记后，日记会把这个项目相关的讨论与任务自动归到该项目下。',
      '参数 name 用用户给的项目名；aliases 是用户提到的其他叫法（可选）。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目名称' },
        aliases: { type: 'array', items: { type: 'string' }, description: '别名（可选）' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
}

export const projectToolEntries = [
  { definition: createProjectTool, policy: { responseOnSuccess: 'auto' } },
]

export function projectToolHandlers(runtime) {
  return {
    [CREATE_PROJECT_TOOL_NAME]: async ({ callId, turnId, args }) => {
      const name = String(args?.name || '').trim()
      if (!name) {
        await runtime.sendOutput(callId, { status: 'error', error: 'name 不能为空' }, turnId)
        return
      }
      const aliases = Array.isArray(args?.aliases) ? args.aliases.map(String).filter(Boolean) : []
      const project = addProject(name, aliases)
      const all = listProjects().map(p => p.name)
      await runtime.sendOutput(callId, { status: 'ok', project: project?.name || name, projects: all }, turnId)
    },
  }
}

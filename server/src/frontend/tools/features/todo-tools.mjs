// GEN-MOD: add_todo / list_todos —— 语音/文字直接操作"艮"的待办库（不是模型自己的记忆）
import { createTodo, listTodos } from '../../../gen/gen-diary-store.mjs'

export const ADD_TODO_TOOL_NAME = 'add_todo'
export const LIST_TODOS_TOOL_NAME = 'list_todos'

const addTodoTool = {
  type: 'function',
  function: {
    name: ADD_TODO_TOOL_NAME,
    description: [
      '把用户要做的事加入「艮」的待办清单（日历里可见）。',
      '用户说"加入待办/记个待办/提醒我做某事/别忘了…"时必须调用本工具，不要只口头答应。',
      '标题写用户要做的事本身（不要写"提醒："前缀）；能确定时间就填 dueAt（ISO8601 带 +08:00）。',
      '只有本工具返回 ok 之后，才能告诉用户"已加入待办"。',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '待办内容，例如：给客户打电话' },
        dueAt: { type: 'string', description: '截止时间，ISO8601 带时区，如 2026-11-20T15:00:00+08:00；不确定就省略' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
}

const listTodosTool = {
  type: 'function',
  function: {
    name: LIST_TODOS_TOOL_NAME,
    description: '读取「艮」的待办清单（用于回答"我有哪些待办/最近要做什么"）。用户问待办时先调用本工具，不要凭记忆回答。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最多返回多少条，默认 20' },
      },
      additionalProperties: false,
    },
  },
}

export const todoToolEntries = [
  { definition: addTodoTool, policy: { responseOnSuccess: 'auto' } },
  { definition: listTodosTool, policy: { responseOnSuccess: 'auto' } },
]

export function todoToolHandlers(runtime) {
  return {
    [ADD_TODO_TOOL_NAME]: async ({ callId, turnId, args }) => {
      const title = String(args?.title || '').trim()
      if (!title) {
        await runtime.sendOutput(callId, { status: 'error', error: 'title 不能为空' }, turnId)
        return
      }
      let dueAt = null
      if (args?.dueAt) {
        const parsed = Date.parse(args.dueAt)
        if (Number.isFinite(parsed)) dueAt = parsed
      }
      const todo = createTodo({
        title: title.slice(0, 120),
        dueAt,
        remindAt: dueAt,
        source: '语音',
      })
      await runtime.sendOutput(callId, {
        status: 'ok',
        todo: { id: todo?.id || '', title, dueAt },
        message: dueAt ? '已加入待办（含时间）' : '已加入待办（未定日期）',
      }, turnId)
    },
    [LIST_TODOS_TOOL_NAME]: async ({ callId, turnId, args }) => {
      const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 50)
      const todos = listTodos().filter(t => t.status === 'pending').slice(0, limit)
      await runtime.sendOutput(callId, {
        status: 'ok',
        count: todos.length,
        todos: todos.map(t => ({ id: t.id, title: t.title, dueAt: t.due_at })),
      }, turnId)
    },
  }
}

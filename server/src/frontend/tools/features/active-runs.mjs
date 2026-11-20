// GEN-MOD: 跟踪 ask_main_model 的一次性后台执行，供"取消"按钮终止
const activeRuns = new Map()

export function registerActiveRun(taskId, runtime) {
  if (!taskId) return
  activeRuns.set(taskId, runtime)
}

export function unregisterActiveRun(taskId) {
  activeRuns.delete(taskId)
}

export function cancelActiveRuns() {
  const entries = [...activeRuns.entries()]
  activeRuns.clear()
  for (const [taskId, runtime] of entries) {
    try {
      runtime.backendRuntime?.cancel?.(taskId, { ownerId: runtime.ownerId })
      runtime.logger?.info?.('gen.run.cancelled', { taskId })
    } catch { /* ignore */ }
  }
  return entries.length
}

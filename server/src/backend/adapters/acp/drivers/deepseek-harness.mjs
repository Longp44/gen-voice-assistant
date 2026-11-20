import { baseEnvironment, clean, processAcpConnection } from './shared.mjs'

// GEN-MOD: 主模型与推理强度（来自模型设置，经 config.env 进入进程环境）
function mainSessionConfigOptions() {
  const provider = process.env.GEN_MAIN_PROVIDER === 'kimi' ? 'kimi-coding' : 'deepseek-official'
  const model = String(process.env.GEN_MAIN_MODEL || 'deepseek-v4-flash').trim()
  const effort = String(process.env.GEN_REASONING_EFFORT || '').trim()
  const options = [{ id: 'model', value: JSON.stringify([provider, model]) }]
  if (effort) options.push({ id: 'reasoning_effort', value: effort })
  return options
}

export const deepSeekHarnessBackendDriver = {
  id: 'deepseek',
  label: 'DeepSeek',
  capabilities: {
    delegation: false,
    permissions: true,
    backendUi: false,
    nativeSessionHistory: false,
    externalMcp: true,
    nativeDelegation: false,
    sessionMcp: true,
    coordinatorMcpInstructions: false,
  },

  createProfile({ directory, cliPath }) {
    return {
      label: this.label,
      sessionConfigOptions: mainSessionConfigOptions(),
      acpConnection: processAcpConnection({
        command: clean(cliPath) || 'dsh',
        args: ['--profile', 'acp'],
        cwd: directory,
        env: baseEnvironment('deepseek'),
      }),
      // The official CLI owns ACP initialization and the user's profile.
      externalMcp: true,
      sessionMcp: true,
      nativeDelegation: false,
      delegation: false,
      nativeSessionHistory: false,
      backendUi: false,
      sessionInstructions: [
        'Complete the requested work in this Session with the available tools.',
        'Do not claim to have opened a separate Gateway-managed task Session.',
      ].join(' '),
    }
  },
}

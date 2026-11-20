// GEN-MOD: 麦克风按钮 —— 未启动时点击启动；启动后点击=静音/取消静音（不重启采集）
export default function GenMicButton({ enabled, muted, waiting, onStart, onToggleMute, onStop }) {
  const active = enabled && !muted
  const title = !enabled
    ? '点击开启麦克风'
    : muted
      ? '已静音 · 点击恢复（不会重启麦克风）'
      : '正在听 · 点击静音'
  return <button
    type="button"
    className={`gen-mic${active ? ' on' : ''}${waiting ? ' waiting' : ''}${muted ? ' muted' : ''}`}
    title={title}
    aria-label={title}
    onClick={ev => {
      ev.preventDefault()
      if (!enabled) { onStart?.(); return }
      onToggleMute?.()
    }}
    onContextMenu={ev => { ev.preventDefault(); if (enabled) onStop?.() }}
  >
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      {muted && <path d="M3 3l18 18" strokeWidth="2" />}
    </svg>
  </button>
}

// GEN-MOD: 停止/打断当前语音回复（实心方块）
export default function GenStopButton({ active, onStop }) {
  return <button
    type="button"
    className={`gen-stop${active ? '' : ' off'}`}
    title={active ? '停止当前回复/取消执行' : '当前没有正在执行的回复'}
    aria-label="停止当前回复"
    onClick={() => onStop?.()}
  >
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  </button>
}

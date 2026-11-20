import { useEffect, useRef, useState } from 'react'

// GEN-MOD: 顶部麦克风设备选择（默认 / MacBook 内置 / iPhone 等）
export default function GenMicDevice({ deviceId, onSelect }) {
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(false)
  const [devError, setDevError] = useState('')
  const [savedLabel, setSavedLabel] = useState(() => localStorage.getItem('gen-mic-device-label') || '')
  const [level, setLevel] = useState(0)
  const [testing, setTesting] = useState(false)
  const testRef = useRef(null)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = e => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])

  async function testMicrophone() {
    if (testing) {
      testRef.current?.stop?.()
      return
    }
    setTesting(true)
    setLevel(0)
    let stream = null
    let ctx = null
    let raf = 0
    const stop = () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(track => track.stop())
      ctx?.close?.()
      setTesting(false)
      setLevel(0)
      testRef.current = null
    }
    testRef.current = { stop }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
      ctx = new (window.AudioContext || window.webkitAudioContext)()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4))
        raf = requestAnimationFrame(tick)
      }
      tick()
      setTimeout(() => { if (testRef.current?.stop === stop) stop() }, 5000)
    } catch (error) {
      setDevError(`麦克风无法打开：${error?.name || 'unknown'}`)
      stop()
    }
  }

  async function refreshDevices() {
    setLoading(true)
    setDevError('')
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setDevError('浏览器不支持设备枚举')
        setDevices([])
        return
      }
      let list = await navigator.mediaDevices.enumerateDevices()
      let inputs = list.filter(d => d.kind === 'audioinput')
      // 未授权时 label 为空，先申请一次权限再枚举
      if (inputs.length === 0 || inputs.some(d => !d.label)) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          stream.getTracks().forEach(track => track.stop())
        } catch (error) {
          setDevError(
            error?.name === 'NotAllowedError'
              ? '浏览器已阻止麦克风权限：点地址栏左侧图标 → 允许麦克风'
              : `无法访问麦克风（${error?.name || 'unknown'}）`,
          )
        }
        try {
          list = await navigator.mediaDevices.enumerateDevices()
          inputs = list.filter(d => d.kind === 'audioinput')
        } catch (error) {
          setDevError(`枚举设备失败（${error?.name || 'unknown'}）`)
        }
      }
      // 过滤掉没有 deviceId 的无效项；label 为空时给出可读占位
      const seen = new Set()
      const usable = inputs
        .filter(d => d.deviceId && !seen.has(d.deviceId) && seen.add(d.deviceId))
        .map((d, i) => ({ ...d, displayLabel: d.label || `音频输入 ${i + 1}（未授权名称，点一次麦克风授权后可显示）` }))
      setDevices(usable)
      if (usable.length === 0 && !devError) setDevError('没有检测到可用的音频输入设备（请先点一次麦克风授权）')
    } catch (error) {
      setDevError(`枚举设备失败（${error?.name || 'unknown'}）`)
      setDevices([])
    }
    finally { setLoading(false) }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) void refreshDevices()
  }

  const current = devices.find(d => d.deviceId === deviceId)
  const label = deviceId ? (current?.label || savedLabel || '已选设备') : '系统默认'
  async function choose(id, name) {
    let actual = name || ''
    if (id) {
      // 实测打开一次该设备，用真实音轨名确认（顺便验证设备可用）
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } } })
        const track = stream.getAudioTracks()[0]
        actual = track?.label || actual
        stream.getTracks().forEach(t => t.stop())
      } catch (error) {
        // 设备打不开也照样选中；采集时会自动回退系统默认，不阻塞用户
        setDevError(`该设备当前打不开（${error?.name || 'unknown'}），已保留选择，采集时自动回退`)
      }
    }
    try {
      localStorage.setItem('gen-mic-device-label', actual || '')
      if (!id) localStorage.removeItem('gen-mic-device-label')
    } catch { /* ignore */ }
    setSavedLabel(actual)
    onSelect?.(id)
    setOpen(false)
  }

  return <div className="gen-micdev" ref={rootRef}>
    <button
      type="button"
      className="gen-micdev-btn"
      title={`麦克风：${label}（点击选择）`}
      onClick={toggle}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </svg>
      <span className="gen-micdev-label">{label}</span>
    </button>

    {open && <div className="gen-micdev-pop">
      <div className="gen-micdev-head">
        选择麦克风{loading ? '…' : `（${devices.length} 个输入设备）`}
        <button className="gen-micdev-refresh" onClick={() => void refreshDevices()}>刷新</button>
      </div>
      <div
        className={`gen-micdev-item${!deviceId ? ' on' : ''}`}
        onPointerDown={ev => { ev.preventDefault(); ev.stopPropagation(); choose('', '') }}
      >系统默认</div>
      {devices.map((d, index) => <div
        key={`${d.deviceId}-${index}`}
        className={`gen-micdev-item${d.deviceId === deviceId ? ' on' : ''}`}
        title={d.deviceId}
        onPointerDown={ev => { ev.preventDefault(); ev.stopPropagation(); choose(d.deviceId, d.label || '') }}
      >{d.displayLabel}</div>)}
      {devices.some(d => !d.label) && <div className="gen-micdev-empty">
        设备名未授权显示：点地址栏左侧图标 → 麦克风 → 允许，或先点输入框里的麦克风按钮授权一次
      </div>}
      {devices.length === 0 && !loading && <div className="gen-micdev-empty">{devError || '没有检测到音频输入设备'}</div>}
      <div className="gen-micdev-test">
        <button type="button" className="gen-micdev-testbtn" onClick={() => void testMicrophone()}>
          {testing ? '停止测试' : '测试麦克风'}
        </button>
        <div className="gen-micdev-level"><i style={{ width: `${Math.round(level * 100)}%` }} /></div>
      </div>
      <div className="gen-micdev-empty">
        {testing ? '对着麦克风说话，进度条有反应说明设备正常' : '平时不用打开这里：直接点输入框的麦克风就能用（首次会弹授权）'}
      </div>
    </div>}
  </div>
}

// GEN-MOD: 会议页面（列表 / 录音+实时字幕 / 详情+总结）
import { useEffect, useRef, useState } from 'react'

function fmtDur(ms = 0) {
  const total = Math.round(Number(ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(ts) {
  const d = new Date(Number(ts) || Date.now())
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const STATUS_TEXT = {
  recording: '录音中',
  uploaded: '已上传',
  transcribing: '转写中',
  transcribed: '已转写',
  summarized: '纪要已生成',
  failed: '失败',
}

export default function GenMeeting() {
  const [meetings, setMeetings] = useState([])
  const [view, setView] = useState('list')
  const [current, setCurrent] = useState(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [captions, setCaptions] = useState([])
  const [transcriptDraft, setTranscriptDraft] = useState('')
  const [summary, setSummary] = useState('')
  const [asrMode, setAsrMode] = useState(() => localStorage.getItem('gen-meeting-asr') || 'streaming')
  const [nativeRec, setNativeRec] = useState(false)
  const native = typeof window !== 'undefined' && window.GenNative ? window.GenNative : null

  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const processorRef = useRef(null)
  const asrWsRef = useRef(null)
  const timerRef = useRef(null)
  const meetingIdRef = useRef(null)
  const startedAtRef = useRef(0)

  async function load() {
    try {
      const r = await fetch('/api/gen/meetings')
      const d = await r.json()
      setMeetings(d.meetings || [])
    } catch { /* ignore */ }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => () => { void stopRecording(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 原生后台录音：每秒读取原生服务的实时转写缓冲
  useEffect(() => {
    if (!nativeRec || !recording) return undefined
    const timer = setInterval(() => {
      try {
        const live = native?.getTranscript ? native.getTranscript() : ''
        if (live) setCaptions([{ id: 'live', beginMs: 0, text: live }])
      } catch { /* ignore */ }
    }, 500)
    return () => clearInterval(timer)
  }, [nativeRec, recording])

  async function openMeeting(id) {
    setBusy('加载中…')
    try {
      const r = await fetch(`/api/gen/meetings/${id}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '加载失败')
      const m = d.meeting
      setCurrent(m)
      setTranscriptDraft(m.transcript || '')
      setSummary(m.summary_md || '')
      setView('detail')
    } catch (error) { setMsg(error.message) } finally { setBusy('') }
  }

  async function startRecording() {
    setMsg('')
    try {
      const title = ''
      const created = await fetch('/api/gen/meetings', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, asrMode }),
      }).then(r => r.json())
      const meeting = created.meeting
      meetingIdRef.current = meeting.id
      startedAtRef.current = Date.now()
      setCaptions([])
      setElapsed(0)
      setRecording(true)
      setView('record')

      // APK 原生前台服务录音（锁屏继续）
      if (native) {
        native.startRecording(meeting.id)
        setNativeRec(true)
        setRecording(true)
        timerRef.current = setInterval(() => {
          setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000))
        }, 1000)
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mime = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data?.size) chunksRef.current.push(e.data) }
      recorderRef.current = rec
      rec.start(1000)

      timerRef.current = setInterval(() => {
        setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000))
      }, 1000)

      if (asrMode === 'streaming') {
        try {
          const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/gen/asr/realtime`)
          ws.binaryType = 'arraybuffer'
          asrWsRef.current = ws
          ws.onmessage = event => {
            try {
              const data = JSON.parse(event.data)
              if (data.type === 'sentence' && data.text) {
                setCaptions(list => {
                  const next = [...list]
                  const idx = next.findIndex(item => item.id === data.id)
                  if (idx >= 0) next[idx] = data
                  else next.push(data)
                  return next
                })
              }
              if (data.type === 'error') setMsg(`实时转写失败：${data.message || ''}（结束后仍可整体转写）`)
            } catch { /* ignore */ }
          }
          // PCM16 16k 采集
          const ctx = new (window.AudioContext || window.webkitAudioContext)()
          audioCtxRef.current = ctx
          const source = ctx.createMediaStreamSource(stream)
          const processor = ctx.createScriptProcessor(4096, 1, 1)
          processorRef.current = processor
          const ratio = ctx.sampleRate / 16000
          let buffer = []
          const send = () => {
            if (!asrWsRef.current || asrWsRef.current.readyState !== 1) { buffer = []; return }
            const pcm = new Int16Array(buffer.length)
            for (let i = 0; i < buffer.length; i += 1) pcm[i] = Math.max(-1, Math.min(1, buffer[i])) * 0x7fff
            try { asrWsRef.current.send(pcm.buffer) } catch { /* ignore */ }
            buffer = []
          }
          processor.onaudioprocess = e => {
            if (!asrWsRef.current) return
            const input = e.inputBuffer.getChannelData(0)
            for (let i = 0; i < input.length; i += ratio) buffer.push(input[Math.floor(i)])
            if (buffer.length >= 1600) send()
          }
          source.connect(processor)
          processor.connect(ctx.destination)
        } catch { /* 流式不可用时降级为会后转写 */ }
      }
    } catch (error) {
      setRecording(false)
      setMsg(`录音启动失败：${error.message}`)
    }
  }

  async function stopRecording(silent = false) {
    if (nativeRec) {
      clearInterval(timerRef.current)
      timerRef.current = null
      const meetingId = meetingIdRef.current
      setRecording(false)
      setNativeRec(false)
      try { native.stopRecording() } catch { /* ignore */ }
      if (silent) return
      setBusy('保存录音…')
      try {
        let uploaded = false
        for (let i = 0; i < 30; i += 1) {
          await new Promise(r => setTimeout(r, 2000))
          const r = await fetch(`/api/gen/meetings/${meetingId}`)
          const d = await r.json()
          if (d.meeting && ['uploaded', 'transcribed', 'summarized'].includes(d.meeting.status)) { uploaded = true; break }
        }
        if (uploaded && asrMode !== 'off') {
          setBusy('转写中…')
          try { await fetch(`/api/gen/meetings/${meetingId}/transcribe`, { method: 'POST' }) } catch { /* ignore */ }
        }
        setMsg(uploaded ? '录音已保存' : '录音上传较慢，稍后会自动完成')
        await load()
        await openMeeting(meetingId)
      } catch (error) { setMsg(`保存失败：${error.message}`) } finally { setBusy('') }
      return
    }
    clearInterval(timerRef.current)
    timerRef.current = null
    const meetingId = meetingIdRef.current
    const durationMs = Date.now() - (startedAtRef.current || Date.now())
    const rec = recorderRef.current
    recorderRef.current = null
    setRecording(false)
    if (!silent) setBusy('保存录音…')
    try {
      // 关闭采集
      try { asrWsRef.current?.readyState === 1 && asrWsRef.current.send(JSON.stringify({ type: 'stop' })) } catch { /* ignore */ }
      try { asrWsRef.current?.close() } catch { /* ignore */ }
      asrWsRef.current = null
      try { processorRef.current?.disconnect(); audioCtxRef.current?.close() } catch { /* ignore */ }
      processorRef.current = null; audioCtxRef.current = null
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null

      const blob = await new Promise(resolve => {
        if (!rec) return resolve(null)
        rec.onstop = () => resolve(new Blob(chunksRef.current, { type: String(rec.mimeType || 'audio/mp4').split(';')[0] }))
        try { rec.stop() } catch { resolve(null) }
      })
      if (blob && blob.size && meetingId) {
        const dataUrl = await new Promise(resolve => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.readAsDataURL(blob)
        })
        await fetch(`/api/gen/meetings/${meetingId}/audio`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ audio: dataUrl, durationMs }),
        })
        // 分段/流式为空的场景：自动做一次会后转写
        const text = captions.map(c => c.text).join('')
        if (!text && asrMode !== 'off') {
          if (!silent) setBusy('转写中…')
          try { await fetch(`/api/gen/meetings/${meetingId}/transcribe`, { method: 'POST' }) } catch { /* ignore */ }
        }
      }
      if (!silent) {
        setMsg('已保存')
        await load()
        await openMeeting(meetingId)
      }
    } catch (error) {
      if (!silent) setMsg(`保存失败：${error.message}`)
    } finally {
      setBusy('')
    }
  }

  async function doTranscribe() {
    if (!current) return
    setBusy('转写中…（可能需要几十秒）')
    try {
      const r = await fetch(`/api/gen/meetings/${current.id}/transcribe`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '转写失败')
      setTranscriptDraft(d.transcript || '')
      setMsg('转写完成')
      await openMeeting(current.id)
    } catch (error) { setMsg(error.message) } finally { setBusy('') }
  }

  async function doSummary() {
    if (!current) return
    setBusy('生成会议总结…')
    try {
      const r = await fetch(`/api/gen/meetings/${current.id}/summary`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript: transcriptDraft }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '总结失败')
      setSummary(d.summary || '')
      setMsg(d.creative ? `总结已生成，并保存为创作：${d.creative}` : '总结已生成')
      await load()
    } catch (error) { setMsg(error.message) } finally { setBusy('') }
  }

  async function saveTranscript() {
    if (!current) return
    await fetch(`/api/gen/meetings/${current.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: transcriptDraft }),
    })
    setMsg('转写已保存')
  }

  async function renameMeeting() {
    if (!current) return
    const next = window.prompt('会议名称', current.title || '')
    if (next === null) return
    const title = String(next).trim()
    if (!title) return
    await fetch(`/api/gen/meetings/${current.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    setCurrent({ ...current, title })
    await load()
  }

  async function removeMeeting(id) {
    if (!window.confirm('删除这段会议记录？录音文件会保留在文件库')) return
    await fetch(`/api/gen/meetings/${id}`, { method: 'DELETE' })
    setView('list'); setCurrent(null)
    await load()
  }

  if (view === 'record') {
    return <div className="gd mtg">
      <div className="mtg-rec-head">
        <div>
          <b>会议录音</b>
          <span>{current?.title || '会议'}</span>
        </div>
        <button className="gd-btn" onClick={() => void stopRecording()}>结束并保存</button>
      </div>
      <div className="mtg-rec-timer">
        <span className="mtg-dot" /> {fmtDur(elapsed * 1000)}
      </div>
      <div className="mtg-captions">
        {captions.length === 0 && <div className="gd-empty">
          {nativeRec ? '正在听…（每 3 秒出一次字幕，可锁屏）' : asrMode === 'streaming' ? '正在听…（说话后 1–3 秒出现字幕）' : '录音中…（结束后统一转写）'}
        </div>}
        {captions.map(c => <div className="mtg-cap" key={c.id}>
          <span>{fmtDur(c.beginMs)}</span>
          <p>{c.text}</p>
        </div>)}
      </div>
      {msg && <div className="gen-set-msg">{msg}</div>}
    </div>
  }

  if (view === 'detail' && current) {
    const audioUrl = current.audio_file_id ? `/api/gen/files/${current.audio_file_id}` : ''
    return <div className="gd mtg">
      <div className="gd-head">
        <button className="gd-btn" onClick={() => { setView('list'); setCurrent(null) }}>← 返回</button>
        <b className="mtg-title" onClick={() => void renameMeeting()} title="点击改名">{current.title || '会议'} ✏️</b>
        <span className="gd-count">{fmtDate(current.started_at)} · {fmtDur(current.duration_ms)}</span>
        <button className="gd-btn" onClick={() => void removeMeeting(current.id)}>删除</button>
      </div>
      {audioUrl && <audio className="mtg-audio" controls src={audioUrl} />}
      <div className="mtg-sec">
        <div className="mtg-sec-head">
          <b>转写文字</b>
          {!transcriptDraft && <button className="gd-btn primary" disabled={!!busy} onClick={() => void doTranscribe()}>转写为文字</button>}
          {transcriptDraft && <button className="gd-btn" onClick={() => void saveTranscript()}>保存修改</button>}
        </div>
        <textarea rows={10} value={transcriptDraft} onChange={e => setTranscriptDraft(e.target.value)} placeholder="还没有转写文字" />
      </div>
      <div className="mtg-sec">
        <div className="mtg-sec-head">
          <b>会议总结</b>
          <button className="gd-btn primary" disabled={!!busy || !transcriptDraft} onClick={() => void doSummary()}>✦ 生成会议总结</button>
        </div>
        {summary ? <pre className="mtg-summary">{summary}</pre> : <div className="gd-empty">点上方按钮，用 DeepSeek 生成结构化纪要（约 1–2 秒）</div>}
      </div>
      {busy && <div className="gen-set-msg">{busy}</div>}
      {msg && <div className="gen-set-msg">{msg}</div>}
    </div>
  }

  return <div className="gd mtg">
    <div className="gd-head">
      <b>会议</b>
      <span className="gd-count">{meetings.length} 段</span>
    </div>
    <button className="mtg-start" onClick={() => void startRecording()}>
      <span className="mtg-start-dot" /> 开始会议录音
      <small>{asrMode === 'streaming' ? '实时转写（边录边出字）' : '录音结束后转写'}</small>
    </button>
    <div className="mtg-mode">
      <span>转写方式</span>
      <select value={asrMode} onChange={e => { setAsrMode(e.target.value); localStorage.setItem('gen-meeting-asr', e.target.value) }}>
        <option value="streaming">实时流式 · 约 ¥1–3/小时</option>
        <option value="batch">结束后转写 · 约 ¥0.3/小时</option>
      </select>
    </div>
    {meetings.length === 0 && <div className="gd-empty">还没有会议录音。点上面按钮开始。</div>}
    <div className="mtg-list">
      {meetings.map(m => <div className="mtg-item" key={m.id} onClick={() => void openMeeting(m.id)}>
        <div className="mtg-item-main">
          <b>{m.title || `会议 ${fmtDate(m.started_at)}`}</b>
          <span>{fmtDate(m.started_at)} · {fmtDur(m.duration_ms)}</span>
        </div>
        <span className={`mtg-status ${m.status}`}>{STATUS_TEXT[m.status] || m.status}</span>
      </div>)}
    </div>
    {busy && <div className="gen-set-msg">{busy}</div>}
    {msg && <div className="gen-set-msg">{msg}</div>}
  </div>
}

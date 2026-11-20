import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  buildConversationTurns,
  discardUserTranscript,
  mergeConversationHistory,
  upsertAssistantTranscript,
  upsertUserTranscript,
} from './message-order.js'
import MessageContent from './MessageContent.jsx'
import MultimodalComposer from './composer/MultimodalComposer.jsx'
import VideoCallPanel from './composer/VideoCallPanel.jsx'
import { desktopClientTools } from './desktop/client-tools.js'
import TaskArtifacts from './TaskArtifacts.jsx'
import PermissionActions from './PermissionActions.jsx'
import DesktopFluidOrb from './desktop/DesktopFluidOrb.jsx'
import DesktopSpriteOrb from './desktop/DesktopSpriteOrb.jsx'
import KnowledgeLibraryPanel from './KnowledgeLibraryPanel.jsx'
import {
  desktopOrbClassName,
  resolveOrbVisualState,
} from './desktop/orb-presentation.js'
import {
  isBuiltinOrbSkin,
} from '../../shared/orb-skin-catalog.mjs'
import { supportsComposerInput } from '../../shared/client-input-capabilities.mjs'
import { resultLabel } from './presentation.js'
import { setRuntimeLanguage, syncDocumentLanguage, t } from './i18n.js'
import GenSidebar from './gen-shell/GenSidebar.jsx'
import GenRightRail from './gen-shell/GenRightRail.jsx'
import GenRightPanel from './gen-shell/GenRightPanel.jsx'
import GenStatusBar from './gen-shell/GenStatusBar.jsx'
import GenSettings from './gen-shell/GenSettings.jsx'
import GenComposerBar from './gen-shell/GenComposerBar.jsx'
import GenMicButton from './gen-shell/GenMicButton.jsx'
import GenStopButton from './gen-shell/GenStopButton.jsx'
import GenMicDevice from './gen-shell/GenMicDevice.jsx'
import GenDiary from './gen-shell/GenDiary.jsx'
import GenCalendar from './gen-shell/GenCalendar.jsx'
import GenEmail from './gen-shell/GenEmail.jsx'
import GenMeeting from './gen-shell/GenMeeting.jsx'
import {
  removeDeliveredTask,
  removeTaskInPhase,
  taskDeliverySettled,
  taskDetail,
  taskNeedsPresentation,
  taskLabel,
  taskView,
} from './task-view.js'
import { taskHasArtifacts } from './task-artifacts.js'
import useRealtimeVoice, {
  realtimeModelStatus,
  shouldClaimReleasedVoice,
} from './realtime/useRealtimeVoice.js'
import { requestedSessionId } from './session.js'
import { initialVoiceEnabled } from './voice-defaults.js'
import {
  applyDesktopClientState,
  desktopCanFinishWaking,
  desktopCanHide,
  desktopHideDeadline,
  enterDesktopIdleSleep,
  desktopPresenceContext,
  desktopTasksActive,
  desktopWorkSettled,
  desktopTasksWorking,
  performDesktopClientAction,
} from './desktop/desktop-hide.js'
import {
  desktopTaskCards,
  desktopTaskElapsedSeconds,
} from './desktop/desktop-task-cards.js'
import {
  advanceDesktopRuntimePresentation,
  desktopBackendRuntime,
  desktopRealtimeRuntime,
  resolveDesktopRuntime,
} from './desktop/desktop-runtime.js'
import {
  spriteAnimationEventForGatewayEvent,
  spriteAnimationForEvent,
} from './desktop/sprite-orb.js'
import {
  applyDesktopClientSettings,
  initialDesktopClientSettings,
} from './desktop/desktop-client-settings.js'
import {
  gatewayClientInstanceId,
  gatewayClientLabel,
  gatewayClientType,
  gatewayFetch,
} from './gateway-transport.js'

const desktopOrbMode = (
  new URLSearchParams(window.location.search).get('desktop') === 'orb'
)
const initialDesktopSurfaceMode = (
  new URLSearchParams(window.location.search).get('surface') === 'panel'
    ? 'panel'
    : 'orb'
)
const activeClientType = gatewayClientType(desktopOrbMode ? 'desktop' : 'web')
const activeClientInstanceId = gatewayClientInstanceId()
const compactVoiceControl = desktopOrbMode || activeClientType === 'mobile'
const composerEnabled = supportsComposerInput(activeClientType)
const MODEL_INPUT_MODE_ORDER = ['text', 'image', 'video', 'audio']
const MODEL_INPUT_MODE_LABELS = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
}

function modelInputModeList(modes = []) {
  const supported = new Set(modes)
  return MODEL_INPUT_MODE_ORDER
    .filter(mode => supported.has(mode))
    .map(mode => MODEL_INPUT_MODE_LABELS[mode])
    .join(' · ')
}

function getSessionId() {
  const requested = requestedSessionId(window.location.search)
  if (requested) {
    localStorage.setItem('qwen-audio-agent.session', requested)
    return requested
  }
  const current = localStorage.getItem('qwen-audio-agent.session')
  if (current) return current
  const created = crypto.randomUUID()
  localStorage.setItem('qwen-audio-agent.session', created)
  return created
}

function labelFor(state) {
  return {
    idle: t('待命'),
    listening: t('正在听'),
    processing: t('正在处理'),
    speaking: t('正在说'),
    working: t('正在处理任务'),
    starting: t('正在启动'),
    connecting: t('正在连接语音前台'),
    occupied: t('其他入口正在使用'),
    hidden: t('已隐藏'),
    waking: t('正在显示'),
  }[state] || state
}

function frontendLabel(holder) {
  return holder?.label || {
    desktop: t('桌面端'),
    mobile: t('移动端'),
    cli: t('终端'),
    web: 'WebUI',
  }[holder?.type] || t('其他入口')
}

function OrbControlIcon({ type, muted = false, collapsed = false }) {
  if (type === 'microphone') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3m-3 0h6" />
      {muted && <path d="M4 4 20 20" />}
    </svg>
  }
  if (type === 'settings') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2 2 0 0 1-2.83 2.83l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.08 1.65V21a2 2 0 0 1-4 0v-.06A1.8 1.8 0 0 0 8.8 19.3a1.8 1.8 0 0 0-1.98.36l-.04.04a2 2 0 0 1-2.83-2.83l.04-.04a1.8 1.8 0 0 0 .36-1.98A1.8 1.8 0 0 0 2.7 13.8H2.6a2 2 0 0 1 0-4h.06A1.8 1.8 0 0 0 4.3 8.72a1.8 1.8 0 0 0-.36-1.98l-.04-.04a2 2 0 0 1 2.83-2.83l.04.04a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 9.82 2.6V2.5a2 2 0 0 1 4 0v.06A1.8 1.8 0 0 0 14.9 4.2a1.8 1.8 0 0 0 1.98-.36l.04-.04a2 2 0 0 1 2.83 2.83l-.04.04a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.08h.1a2 2 0 0 1 0 4h-.06A1.8 1.8 0 0 0 19.4 15Z" />
    </svg>
  }
  if (type === 'conversation') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14v10H9l-4 3v-13Z" />
      <path d="M8 9h8m-8 3h5" />
    </svg>
  }
  if (type === 'collapse') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 10 4 4 4-4" />
    </svg>
  }
  if (type === 'tasks') {
    return <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={collapsed ? 'm7 9 5 5 5-5' : 'm7 14 5-5 5 5'} />
    </svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
}

function upsertTask(items, taskId, update, fallback) {
  const index = items.findIndex(item => item.id === taskId)
  if (index < 0) return fallback ? [...items, fallback] : items
  const next = [...items]
  next[index] = update(next[index])
  return next
}

export default function App() {
  const [desktopClientSettings, setDesktopClientSettings] = useState(
    () => initialDesktopClientSettings(window.location.search),
  )
  const {
    orbSkinId,
    autoHideSeconds,
    wakeWordEnabled,
  } = desktopClientSettings
  // `t()` reads the module-level runtime language. Keeping a revision in
  // React state makes a language-only settings update repaint this surface
  // without replacing its Gateway WebSocket or Realtime Session.
  const [, setLanguageRevision] = useState(0)
  useEffect(() => {
    const refreshLanguage = () => {
      syncDocumentLanguage()
      setLanguageRevision(value => value + 1)
    }
    window.addEventListener('languagechange', refreshLanguage)
    return () => window.removeEventListener('languagechange', refreshLanguage)
  }, [])
  const [sessionId, setSessionId] = useState(getSessionId)
  const [voiceEnabled, setVoiceEnabled] = useState(() => initialVoiceEnabled({
    desktopOrbMode,
    clientType: activeClientType,
  }))
  const [waitingForVoice, setWaitingForVoice] = useState(false)
  // GEN-MOD: 多标签页语音互斥 —— 同一会话只允许一个标签页开麦，避免进程互踢
  const voiceTabId = useRef(`tab_${Math.random().toString(36).slice(2, 10)}`)
  const voiceOwnerKey = 'gen-voice-owner'
  const voiceEnabledRef = useRef(voiceEnabled)
  voiceEnabledRef.current = voiceEnabled
  const [videoCallOpen, setVideoCallOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [activity, setActivity] = useState(t('正在检查后台 Agent'))
  const [frontend, setFrontend] = useState({ label: 'Realtime Agent' })
  const [modelStatus, setModelStatus] = useState(() => realtimeModelStatus())
  const videoCallSupported = !compactVoiceControl
    && modelStatus.modelInputModes.includes('video')
    && modelStatus.transportInputModes.includes('video')
  useEffect(() => {
    if (!videoCallSupported) setVideoCallOpen(false)
  }, [videoCallSupported])
  const [gatewayRuntime, setGatewayRuntime] = useState('connecting')
  const [backend, setBackend] = useState({
    label: 'Agent',
    enabled: null,
    ready: false,
    status: 'starting',
    code: null,
  })
  const [agentTasks, setAgentTasks] = useState([])
  const [taskClock, setTaskClock] = useState(Date.now)
  const [desktopTasksCollapsed, setDesktopTasksCollapsed] = useState(false)
  const [showKnowledgeLibrary, setShowKnowledgeLibrary] = useState(false)
  const [genView, setGenView] = useState('chat') // GEN-MOD: chat | diary | calendar
  const [sessions, setSessions] = useState([])
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [stopTip, setStopTip] = useState('')
  const [inputDeviceId, setInputDeviceId] = useState(() => localStorage.getItem('gen-mic-device') || '')
  const [inputMuted, setInputMuted] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [genToast, setGenToast] = useState('')
  const recStream = useRef(null)
  const recRecorder = useRef(null)
  const recChunks = useRef([])
  const recTimer = useRef(null)

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recStream.current = stream
      recChunks.current = []
      const mime = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recRecorder.current = rec
      rec.ondataavailable = e => { if (e.data?.size) recChunks.current.push(e.data) }
      rec.onstop = async () => {
        const type = String(rec.mimeType || 'audio/mp4').split(';')[0]
        const blob = new Blob(recChunks.current, { type })
        stream.getTracks().forEach(t => t.stop())
        if (!blob.size) return
        const dataUrl = await new Promise(resolve => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.readAsDataURL(blob)
        })
        setGenToast('正在上传会议录音…')
        try {
          const r = await fetch('/api/gen/recordings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ audio: dataUrl }),
          })
          const d = await r.json()
          setGenToast(r.ok ? `录音已上传：${d.name}` : `上传失败：${d.error || ''}`)
        } catch (error) {
          setGenToast(`上传失败：${error.message}`)
        }
      }
      rec.start(1000)
      setRecording(true)
      setRecSeconds(0)
      recTimer.current = setInterval(() => setRecSeconds(v => v + 1), 1000)
    } catch (error) {
      setGenToast(`无法录音：${error.message}`)
    }
  }

  const stopRecording = () => {
    try { recRecorder.current?.stop() } catch { /* ignore */ }
    clearInterval(recTimer.current)
    recTimer.current = null
    setRecording(false)
  }

  useEffect(() => {
    if (!genToast) return undefined
    const timer = setTimeout(() => setGenToast(''), 4000)
    return () => clearTimeout(timer)
  }, [genToast])
  const narrowScreen = typeof window !== 'undefined' && window.innerWidth <= 640
  const [isMobile, setIsMobile] = useState(narrowScreen)
  const [sidebarMode, setSidebarMode] = useState('nav')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => narrowScreen || localStorage.getItem('gen-sidebar-collapsed') === '1')
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('gen-sidebar-width')) || 224)
  const [rightCollapsed, setRightCollapsed] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 900) || localStorage.getItem('gen-right-collapsed') === '1')
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const toggleSidebar = () => {
    setSidebarCollapsed(v => {
      const next = !v
      try { localStorage.setItem('gen-sidebar-collapsed', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }
  const toggleRight = () => {
    setRightCollapsed(v => {
      const next = !v
      try { localStorage.setItem('gen-right-collapsed', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }
  const startSidebarResize = ev => {
    ev.preventDefault()
    const startX = ev.clientX
    const startWidth = sidebarWidth
    const move = e => {
      const next = Math.min(340, Math.max(180, startWidth + (e.clientX - startX)))
      setSidebarWidth(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      try { localStorage.setItem('gen-sidebar-width', String(sidebarWidth)) } catch { /* ignore */ }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // 拖拽结束保存（用 ref 简化：每次状态变化都写）
  useEffect(() => {
    try { localStorage.setItem('gen-sidebar-width', String(sidebarWidth)) } catch { /* ignore */ }
  }, [sidebarWidth])
  const selectMicDevice = id => {
    setInputDeviceId(id || '')
    try {
      if (id) localStorage.setItem('gen-mic-device', id)
      else localStorage.removeItem('gen-mic-device')
    } catch { /* ignore */ }
  }
  const handleStopModel = () => {
    const running = agentTasks.filter(task => ['running', 'queued', 'delegated', 'finalizing'].includes(task.phase))
    const busy = orbVisualState !== 'idle' || running.length > 0
    voice.cancelModelRuns()
    for (const task of running) voice.cancelTask?.(task.id)
    setStopTip(busy ? '已取消当前执行' : '当前没有正在执行的任务')
    setTimeout(() => setStopTip(''), 1800)
  }
  const [newChatTitle, setNewChatTitle] = useState('')
  const createNewChat = async () => {
    const now = new Date()
    const fallback = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const title = newChatTitle.trim() || fallback
    try {
      const r = await fetch('/api/gen/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const d = await r.json()
      if (d.session?.id) {
        localStorage.setItem('qwen-audio-agent.session', d.session.id)
        setSessionId(d.session.id)
        setMessages([])
        setActivity(t('已新建对话'))
        loadSessions()
      }
    } finally {
      setNewChatOpen(false)
      setNewChatTitle('')
    }
  }
  const loadSessions = () => {
    fetch('/api/gen/sessions').then(r => r.json()).then(d => setSessions(d.sessions || [])).catch(() => {})
  }
  useEffect(() => { loadSessions() }, [])
  const removeSession = async (id, title) => {
    if (!window.confirm(`删除会话「${title || id}」？\n会话记录会从磁盘移除，派生的日记条目也会清理（文件保留）。`)) return
    try {
      // 先离开该会话，避免删除时 journal 又被当前连接写回
      if (id === sessionId) {
        const next = crypto.randomUUID()
        localStorage.setItem('qwen-audio-agent.session', next)
        setSessionId(next)
        setMessages([])
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      await fetch(`/api/gen/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
      loadSessions()
    } catch { /* ignore */ }
  }
  const switchSession = (id) => {
    if (!id || id === sessionId) return
    localStorage.setItem('qwen-audio-agent.session', id)
    setSessionId(id)
    setMessages([])
    setActivity(t('已切换会话'))
  }
  const [calDate, setCalDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [desktopTaskLayout, setDesktopTaskLayout] = useState({
    placement: 'below',
    orbOffsetX: 0,
  })
  const [orbDragging, setOrbDragging] = useState(false)
  const [orbDragDirection, setOrbDragDirection] = useState('')
  const [spriteAnimationCues, setSpriteAnimationCues] = useState([])
  const [spriteOrbFailed, setSpriteOrbFailed] = useState(false)
  const [desktopPresence, setDesktopPresence] = useState({ state: 'active', reason: '' })
  const desktopLifecycle = desktopPresence.state
  const setDesktopLifecycle = useCallback((state, reason) => {
    setDesktopPresence(current => ({
      state,
      reason: reason ?? (current.state === state ? current.reason : ''),
    }))
  }, [])
  const [desktopSurfaceMode, setDesktopSurfaceMode] = useState(
    initialDesktopSurfaceMode,
  )
  const [lastInteractionAt, setLastInteractionAt] = useState(Date.now)
  const activeVoiceResponse = useRef('')
  const currentTurnId = useRef('')
  const responseTurnMap = useRef(new Map())
  const agentTurnIds = useRef(new Set())
  const taskDismissTimers = useRef(new Map())
  const messagesRef = useRef(null)
  const stickToBottom = useRef(true)
  const orbDrag = useRef(null)
  const spriteAnimationCueId = useRef(0)
  const runtimeReadyAnnounced = useRef(false)
  const previousTasksActive = useRef(false)
  const workSettledAtRef = useRef(Date.now())
  const autoHideStateRef = useRef(null)
  const autoHideRequestedDeadlineRef = useRef(0)
  const lastWakeAtRef = useRef(0)
  const previousDesktopLifecycle = useRef('active')
  const gatewayCommandsRef = useRef(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const spriteAnimationCue = spriteAnimationCues[0] || null

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    const bridge = window.qwenAudioAgentDesktop
    if (typeof bridge?.onClientSettings !== 'function') return undefined
    return bridge.onClientSettings(settings => {
      setDesktopClientSettings(current => applyDesktopClientSettings(
        current,
        settings,
      ))
      if (settings.orbSkin) setSpriteOrbFailed(false)
      if (settings.language) {
        setRuntimeLanguage(settings.language)
        setLanguageRevision(value => value + 1)
      }
    })
  }, [])

  useEffect(() => {
    const persistSession = window.qwenAudioAgentDesktop?.setConversationSession
    if (!desktopOrbMode || typeof persistSession !== 'function') return
    void persistSession(sessionId).catch(() => {})
  }, [sessionId])

  const noteInteraction = useCallback(() => {
    setLastInteractionAt(Date.now())
  }, [])

  const changeDesktopSurface = useCallback(async mode => {
    const bridge = window.qwenAudioAgentDesktop
    if (!desktopOrbMode || !bridge?.setSurface) return
    try {
      const result = await bridge.setSurface(mode)
      setDesktopSurfaceMode(result?.mode === 'panel' ? 'panel' : 'orb')
      noteInteraction()
    } catch {
      // A rejected host transition leaves the current presentation intact.
    }
  }, [noteInteraction])

  const triggerSpriteAnimation = useCallback((eventName, { priority = false } = {}) => {
    if (!desktopOrbMode || isBuiltinOrbSkin(orbSkinId)) return
    const name = spriteAnimationForEvent(eventName)
    if (!name) return
    spriteAnimationCueId.current += 1
    const cue = { id: spriteAnimationCueId.current, name }
    setSpriteAnimationCues(current => (
      priority ? [cue, ...current] : [...current, cue]
    ))
  }, [orbSkinId])

  const completeSpriteAnimationCue = useCallback(id => {
    setSpriteAnimationCues(current => (
      current[0]?.id === id ? current.slice(1) : current
    ))
  }, [])

  const respondToPermission = useCallback(async (taskId, permission, decision) => {
    if (!permission?.id || permission.submitting) return
    setAgentTasks(items => upsertTask(
      items,
      taskId,
      task => ({
        ...task,
        authorization: {
          ...task.authorization,
          submitting: true,
          error: null,
        },
      }),
    ))
    try {
      await gatewayCommandsRef.current?.respondPermission(permission.id, decision)
    } catch (error) {
      if (['permission_not_found', 'task_not_found'].includes(error.code)) {
        setAgentTasks(items => upsertTask(
          items,
          taskId,
          task => ({ ...task, authorization: null }),
        ))
        return
      }
      setAgentTasks(items => upsertTask(
        items,
        taskId,
        task => ({
          ...task,
          authorization: task.authorization
            ? {
                ...task.authorization,
                submitting: false,
                error: t('没有提交成功：{message}', { message: error.message }),
              }
            : null,
        }),
      ))
    }
  }, [])

  const cancelDesktopTask = useCallback(async task => {
    if (task?.phase !== 'scheduled' || !task.id) return
    const cancelTask = gatewayCommandsRef.current?.cancelTask
    if (typeof cancelTask !== 'function') return
    setAgentTasks(items => upsertTask(
      items,
      task.id,
      current => ({ ...current, phase: 'cancelling' }),
    ))
    try {
      const cancelled = await cancelTask(task.id)
      if (!cancelled) return
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(cancelled, current),
        taskView(cancelled),
      ))
    } catch {
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => current.phase === 'cancelling'
          ? { ...current, phase: 'scheduled' }
          : current,
      ))
    }
  }, [])

  useLayoutEffect(() => {
    // The orb does not mount the message list. Opening a panel (or a new
    // session) should follow the latest message, even if history is unchanged.
    stickToBottom.current = true
  }, [desktopSurfaceMode, sessionId])

  useLayoutEffect(() => {
    const container = messagesRef.current
    if (container && stickToBottom.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, agentTasks, desktopSurfaceMode, sessionId])

  useEffect(() => () => {
    taskDismissTimers.current.forEach(timer => clearTimeout(timer))
    taskDismissTimers.current.clear()
  }, [])

  useEffect(() => {
    let cancelled = false
    let refreshTimer
    const refresh = () => gatewayFetch('api/health', { cache: 'no-store' })
      .then(async response => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return
        const gatewayReady = response.ok && payload.ok !== false
        const backendPayload = payload.backend || {}
        const backendEnabled = backendPayload.enabled !== false && Boolean(
          backendPayload.kind || backendPayload.protocol,
        )
        const label = payload.backend?.label || payload.backend?.kind || 'Agent'
        setFrontend({
          label: payload.realtimeLabel || payload.realtimeProvider || 'Realtime Agent',
        })
        setModelStatus(realtimeModelStatus(payload))
        setGatewayRuntime(gatewayReady ? 'ready' : 'failed')
        setBackend({
          label,
          enabled: backendEnabled,
          ready: gatewayReady && (
            backendEnabled ? backendPayload.ok === true : true
          ),
          status: backendPayload.status || (
            backendEnabled ? 'starting' : 'not_configured'
          ),
          code: backendPayload.code || null,
          error: backendPayload.error || '',
          url: payload.backend?.uiPath || payload.backend?.baseUrl || '',
        })
        setActivity(response.ok ? t('Gateway 已连接') : t('能力服务尚未连接'))
        if (desktopOrbMode) {
          const backendSettled = !backendEnabled || [
            'ready',
            'failed',
          ].includes(backendPayload.status)
          refreshTimer = setTimeout(refresh, backendSettled ? 3000 : 500)
        }
      })
      .catch(() => {
        if (cancelled) return
        setGatewayRuntime('failed')
        setActivity(t('qwen-audio-agent Gateway 尚未连接'))
        if (desktopOrbMode) refreshTimer = setTimeout(refresh, 1000)
      })
    refresh()
    return () => {
      cancelled = true
      clearTimeout(refreshTimer)
    }
  }, [])

  const updateUserTranscript = useCallback((event, final = false) => {
    const id = event.turnId ? `user:${event.turnId}` : crypto.randomUUID()
    setMessages(items => upsertUserTranscript(items, {
        id,
        content: event.content,
        turnId: event.turnId,
        final,
      }))
    if (final) noteInteraction()
  }, [noteInteraction])

  const updateVoiceMessage = useCallback((event, final = false) => {
    const responseId = event.responseId || activeVoiceResponse.current
    if (!responseId) return
    activeVoiceResponse.current = responseId
    const id = `voice:${responseId}`
    const trackedTurnId = responseTurnMap.current.get(responseId) || event.turnId || currentTurnId.current
    setMessages(items => upsertAssistantTranscript(items, {
      id,
      content: event.content,
      turnId: trackedTurnId,
      taskId: event.taskId,
      taskIds: event.taskIds,
      origin: event.origin,
      citations: event.citations,
      final,
    }))
  }, [])

  const onRealtimeEvent = useCallback(event => {
    const animationEvent = spriteAnimationEventForGatewayEvent(event)
    if (animationEvent) {
      triggerSpriteAnimation(animationEvent)
    }
    if (event.type === 'turn.started') {
      currentTurnId.current = event.turnId || ''
      activeVoiceResponse.current = ''
      stickToBottom.current = true
      setActivity(t('正在听你说'))
    }
    if (event.type === 'gateway.disconnected') {
      setActivity(t('qwen-audio-agent Gateway 已断开，正在重连'))
      setAgentTasks(items => items.map(task => (
        [
          'queued',
          'running',
          'delegated',
          'finalizing',
          'cancelling',
          'responding',
        ].includes(task.phase)
          ? { ...task, phase: 'disconnected' }
          : task
      )))
    }
    void applyDesktopClientState(event, {
      desktop: desktopOrbMode,
      bridge: window.qwenAudioAgentDesktop,
      onLifecycle: setDesktopLifecycle,
      lastWakeAt: lastWakeAtRef.current,
    }).catch(() => {})
    if (
      event.type === 'voice.sleep'
      && event.state === 'detected'
      && desktopOrbMode
    ) {
      window.qwenAudioAgentDesktop?.wake()
    }
    if (event.type === 'session.recovered') {
      if (sessionIdRef.current !== sessionId) return
      setMessages(items => mergeConversationHistory(items, event.messages || []))
      const serverTasks = event.tasks || []
      const byId = new Map(serverTasks.map(task => [task.id, task]))
      setAgentTasks(items => {
        const known = new Set(items.map(task => task.id))
        const reconciled = items.flatMap(task => {
          const current = byId.get(task.id)
          if (current && taskDeliverySettled(current)) return []
          if (current) return [taskView(current, task)]
          if (task.phase !== 'disconnected') return [task]
          return [{
            ...task,
            phase: 'failed',
            error: t('网关重连后未找到这次后台执行，请重新提交。'),
          }]
        })
        serverTasks
          .filter(task => taskNeedsPresentation(task) && !known.has(task.id))
          .reverse()
          .forEach(task => reconciled.push(taskView(task)))
        return reconciled
      })
    }
    if (event.type === 'voice.deactivated') {
      setVoiceEnabled(false)
      setWaitingForVoice(false)
      setActivity(t('{holder}正在使用语音', { holder: frontendLabel(event.holder) }))
    }
    if (
      event.type === 'voice.ownership'
      && event.state === 'busy'
      && voiceEnabled
    ) {
      setVoiceEnabled(false)
      setWaitingForVoice(false)
      setActivity(t('{holder}正在使用语音', { holder: frontendLabel(event.holder) }))
    }
    if (event.type === 'voice.ownership' && event.state === 'available') {
      if (shouldClaimReleasedVoice(event, waitingForVoice)) {
        setWaitingForVoice(false)
        setVoiceEnabled(true)
        setActivity(t('正在接入语音'))
      } else if (!voiceEnabled) {
        setActivity(t('待命'))
      }
    }
    if (event.type === 'voice.state') {
      if (
        event.turnId
        && event.turnId !== currentTurnId.current
        && event.origin === 'model'
      ) return
      if (event.state === 'listening') setActivity(t('正在听你说'))
      if (event.state === 'processing' && !agentTurnIds.current.has(currentTurnId.current)) {
        setActivity(t('正在处理'))
      }
      if (event.state === 'idle' && !agentTurnIds.current.has(currentTurnId.current)) {
        setActivity(t('待命'))
      }
    }
    if (event.type === 'transcript.delta' && event.role === 'user') {
      updateUserTranscript(event)
    }
    if (event.type === 'transcript.final' && event.role === 'user') {
      updateUserTranscript(event, true)
    }
    if (event.type === 'transcript.discard' && event.role === 'user') {
      setMessages(items => discardUserTranscript(items, event.turnId))
    }
    if (event.type === 'response.started') {
      activeVoiceResponse.current = event.responseId
      if (event.turnId) {
        responseTurnMap.current.set(event.responseId, event.turnId)
        if (responseTurnMap.current.size > 100) {
          responseTurnMap.current.delete(responseTurnMap.current.keys().next().value)
        }
      }
      if (
        event.turnId === currentTurnId.current
        && !agentTurnIds.current.has(event.turnId)
      ) {
        setActivity(t('正在回复'))
      }
    }
    if (event.type === 'transcript.delta' && event.role === 'assistant') updateVoiceMessage(event)
    if (event.type === 'transcript.final' && event.role === 'assistant') updateVoiceMessage(event, true)
    if (event.type === 'response.interrupted') {
      const id = `voice:${event.responseId}`
      setMessages(items => items.map(message => (
        message.id === id
          ? { ...message, interrupted: true, live: false }
          : message
      )))
    }
    if (event.type === 'task.scheduled') {
      const task = event.task
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (event.type === 'task.accepted') {
      const task = event.task
      if (task.turnId) agentTurnIds.current.add(task.turnId)
      if (!task.turnId || task.turnId === currentTurnId.current) {
        setActivity(t('正在处理'))
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (event.type === 'task.running') {
      const task = event.task
      if (task.turnId) agentTurnIds.current.add(task.turnId)
      if (!task.turnId || task.turnId === currentTurnId.current) {
        setActivity(t('正在处理'))
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => ({
          ...current,
          elapsedMs: task.elapsedMs || 0,
          phase: 'running',
        }),
        {
          id: task.id,
          kind: task.kind,
          objective: task.objective,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          elapsedMs: task.elapsedMs || 0,
          phase: 'running',
          turnId: task.turnId,
        },
      ))
    }
    if (event.type === 'task.progress') {
      const progress = event.task
      if (!progress.turnId || progress.turnId === currentTurnId.current) {
        setActivity(t('正在处理 · {seconds} 秒', { seconds: Math.round(progress.elapsedMs / 1000) }))
      }
      setAgentTasks(items => upsertTask(
        items,
        progress.id,
        task => taskView(progress, task),
        taskView(progress),
      ))
    }
    if (event.type === 'task.updated') {
      const task = event.task
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (event.type === 'task.delegated') {
      const task = event.task
      if (!task.turnId || task.turnId === currentTurnId.current) {
        setActivity(t('进行中'))
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (
      event.type === 'task.finalizing'
      || event.type === 'task.cancelling'
    ) {
      const task = event.task
      if (!task.turnId || task.turnId === currentTurnId.current) {
        setActivity(event.type === 'task.finalizing'
          ? t('正在整理项目结果')
          : t('正在取消'))
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (
      event.type === 'task.permission.requested'
      || event.type === 'task.permission.resolved'
    ) {
      const task = event.task
      if (event.type === 'task.permission.requested') {
        setActivity(t('等待你的确认'))
      } else {
        setActivity(t('正在继续处理'))
      }
      setAgentTasks(items => upsertTask(
        items,
        task.id,
        current => taskView(task, current),
        taskView(task),
      ))
    }
    if (event.type === 'task.completed') {
      const completed = event.task
      if (completed.turnId) agentTurnIds.current.delete(completed.turnId)
      if (!completed.turnId || completed.turnId === currentTurnId.current) {
        setActivity(t('正在准备回复'))
      }
      setAgentTasks(items => upsertTask(
        items,
        completed.id,
        task => taskView(completed, task),
        taskView(completed),
      ))
    }
    if (event.type === 'task.notification.delivered') {
      const delivered = event.task
      // Delivery is acknowledged after playback ends. The assistant transcript
      // may already have removed this card, so never upsert it again here.
      setAgentTasks(items => removeDeliveredTask(items, delivered.id))
    }
    if (event.type === 'task.failed') {
      const failed = event.task
      if (failed.turnId) agentTurnIds.current.delete(failed.turnId)
      if (!failed.turnId || failed.turnId === currentTurnId.current) {
        setActivity(t('后台失败：{error}', { error: failed.error }))
      }
      setAgentTasks(items => upsertTask(
        items,
        failed.id,
        task => ({ ...taskView(failed, task), phase: 'failed' }),
        { ...taskView(failed), phase: 'failed' },
      ))
    }
    if (event.type === 'task.cancelled') {
      const cancelled = event.task
      if (cancelled.turnId) agentTurnIds.current.delete(cancelled.turnId)
      if (!cancelled.turnId || cancelled.turnId === currentTurnId.current) {
        setActivity(t('已取消'))
      }
      setAgentTasks(items => upsertTask(
        items,
        cancelled.id,
        task => ({ ...taskView(cancelled, task), phase: 'cancelled' }),
        { ...taskView(cancelled), phase: 'cancelled' },
      ))
      clearTimeout(taskDismissTimers.current.get(cancelled.id))
      taskDismissTimers.current.set(cancelled.id, setTimeout(() => {
        setAgentTasks(items => removeTaskInPhase(
          items,
          cancelled.id,
          'cancelled',
        ))
        setActivity(current => current === t('已取消') ? t('待命') : current)
        taskDismissTimers.current.delete(cancelled.id)
      }, 3000))
    }
    if (event.type === 'transcript.final' && event.role === 'assistant') {
      if (event.turnId === currentTurnId.current) setActivity(t('待命'))
      const presentedTaskIds = new Set(
        event.taskIds?.length ? event.taskIds : [event.taskId].filter(Boolean),
      )
      setAgentTasks(items => items.filter(task => (
        !presentedTaskIds.has(task.id)
        || taskHasArtifacts(task)
        || !['responding', 'completed'].includes(task.phase)
      )))
    }
  }, [
    sessionId,
    updateUserTranscript,
    updateVoiceMessage,
    voiceEnabled,
    waitingForVoice,
    triggerSpriteAnimation,
    setDesktopLifecycle,
  ])

  // Keep the microphone alive while the desktop orb is hidden and the wake
  // word is enabled, even if the user has muted the realtime conversation.
  // Microphone mute leaves output playback active; wake-word detection still
  // needs a live input stream to resume on "你好千问" while hidden.
  const voiceEnabledForWakeWord = (
    desktopOrbMode
    && desktopLifecycle === 'hidden'
    && wakeWordEnabled
  )
  const voice = useRealtimeVoice({
    sessionId,
    enabled: voiceEnabled || voiceEnabledForWakeWord,
    suspended: desktopOrbMode && desktopLifecycle === 'hidden' && !wakeWordEnabled,
    outputMuted: false,
    // WebUI and desktop share one control contract: the toggle only changes
    // microphone capture and never closes or interrupts the output stream.
    inputOnlyMute: true,
    wakeWordOnly: voiceEnabledForWakeWord,
    clientType: activeClientType,
    clientLabel: gatewayClientLabel(desktopOrbMode ? t('桌面端') : 'WebUI'),
    clientInstanceId: activeClientInstanceId,
    clientStates: desktopOrbMode ? ['sleeping'] : [],
    clientTools: desktopOrbMode ? desktopClientTools : [],
    clientPresence: desktopOrbMode ? (desktopLifecycle === 'hidden' ? 'sleeping' : 'active') : undefined,
    inputDeviceId,
    inputMuted,
    onEvent: onRealtimeEvent,
    onInputError: message => {
      setVoiceEnabled(false)
      setWaitingForVoice(false)
      setActivity(message)
    },
    onClientAction: event => performDesktopClientAction(event, {
      desktop: desktopOrbMode,
      bridge: window.qwenAudioAgentDesktop,
      onLifecycle: setDesktopLifecycle,
    }),
    onWakeWordAudio: (audio, sampleRate) => {
      window.qwenAudioAgentDesktop?.acceptWakeWordAudio(audio, sampleRate)
    },
  })
  gatewayCommandsRef.current = voice
  const publishClientState = voice.publishClientState
  useEffect(() => {
    if (!desktopOrbMode) return
    const text = desktopPresenceContext(desktopLifecycle, desktopPresence.reason)
    if (text) publishClientState('desktop.presence.changed', text)
  }, [desktopLifecycle, desktopPresence.reason, publishClientState])
  const reportVisualInputState = useCallback(active => {
    publishClientState('media.visual_input.changed', active
      ? '客户端已开启实时视觉输入；仅根据实际收到的最新画面描述当前环境。'
      : '客户端已停止实时视觉输入，当前无法看到新的画面。之前收到的画面仅代表历史，不代表当前环境。')
  }, [publishClientState])
  useEffect(() => {
    if (videoCallSupported) reportVisualInputState(false)
  }, [videoCallSupported, reportVisualInputState])
  const lifecycleTransition = (
    desktopOrbMode && desktopLifecycle !== 'active'
  )
  const voiceConnectionError = (
    !lifecycleTransition && voice.connectionState === 'unavailable'
  )
  const desktopRuntime = resolveDesktopRuntime({
    gateway: gatewayRuntime,
    realtime: desktopRealtimeRuntime(voice.connectionState),
    backend: desktopBackendRuntime(backend),
  })
  const desktopHasWorkingTasks = desktopOrbMode && desktopTasksWorking(agentTasks)
  // 统一视觉状态仲裁：生命周期 → 异常 → 对话态 → 后台态。
  // 后台工作态仅在桌面悬浮球展示；等待授权由播报和任务卡片承载，
  // 不占用 Agent 动画状态。WebUI 也由任务卡片承载同类信息。
  const orbVisualState = resolveOrbVisualState({
    lifecycle: desktopLifecycle,
    runtimeState: desktopOrbMode ? desktopRuntime.overall : null,
    connectionError: !desktopOrbMode && voiceConnectionError,
    connecting: !desktopOrbMode
      && voiceEnabled
      && voice.connectionState === 'connecting',
    ownershipBusy: voice.ownership.state === 'busy',
    voiceState: voice.visualState || voice.state,
    tasksWorking: desktopHasWorkingTasks,
  })
  const authorizationTask = agentTasks.find(
    task => task.authorization?.status === 'pending',
  )

  useEffect(() => {
    if (!desktopOrbMode) return
    const current = desktopRuntime.overall
    const presentation = advanceDesktopRuntimePresentation({
      current,
      readyAnnounced: runtimeReadyAnnounced.current,
    })
    runtimeReadyAnnounced.current = presentation.readyAnnounced
    if (presentation.cue) triggerSpriteAnimation(presentation.cue)
  }, [desktopRuntime.overall, triggerSpriteAnimation])

  const desktopCards = useMemo(
    () => desktopOrbMode ? desktopTaskCards(agentTasks) : [],
    [agentTasks],
  )
  useEffect(() => {
    if (!desktopCards.length) setDesktopTasksCollapsed(false)
  }, [desktopCards.length])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    window.qwenAudioAgentDesktop?.loadSurface?.()
      .then(result => setDesktopSurfaceMode(
        result?.mode === 'panel' ? 'panel' : 'orb',
      ))
      .catch(() => {})
    return undefined
  }, [])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    return window.qwenAudioAgentDesktop?.onTaskCardPlacement?.(
      setDesktopTaskLayout,
    )
  }, [])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    window.qwenAudioAgentDesktop?.setTaskCardCount(
      desktopSurfaceMode === 'panel'
        ? desktopCards.length
        : desktopTasksCollapsed ? 0 : desktopCards.length,
    )
    return undefined
  }, [desktopCards.length, desktopSurfaceMode, desktopTasksCollapsed])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    return () => window.qwenAudioAgentDesktop?.setTaskCardCount(0)
  }, [])
  const ownershipLabel = voice.ownership.holder
    ? frontendLabel(voice.ownership.holder)
    : ''

  const workSettled = desktopWorkSettled({
    tasks: agentTasks,
    voiceState: voice.visualState || voice.state,
  })
  const tasksActive = desktopTasksActive(agentTasks)

  useEffect(() => {
    if (!tasksActive) return undefined
    const timer = setInterval(() => setTaskClock(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [tasksActive])

  useEffect(() => {
    if (!desktopOrbMode) return
    if (!tasksActive && previousTasksActive.current) {
      const settledAt = Date.now()
      workSettledAtRef.current = settledAt
    }
    previousTasksActive.current = tasksActive
  }, [tasksActive])

  useEffect(() => {
    if (!desktopOrbMode) return undefined
    const bridge = window.qwenAudioAgentDesktop
    if (!bridge) return undefined
    const applyLifecycle = lifecycle => {
      if (!lifecycle?.state) return
      if (
        lifecycle.state === 'waking'
        && previousDesktopLifecycle.current !== 'waking'
      ) {
        triggerSpriteAnimation('wake', { priority: true })
      }
      previousDesktopLifecycle.current = lifecycle.state
      setDesktopLifecycle(lifecycle.state, lifecycle.reason)
      if (lifecycle.state === 'waking') lastWakeAtRef.current = Date.now()
      if (lifecycle.reason === 'activity') noteInteraction()
      if (lifecycle.state === 'hidden') {
        // Main has already collapsed a visible conversation panel before an
        // explicit sleep. Mirror that authoritative surface transition so a
        // later wake cannot render the panel inside the compact orb window.
        setDesktopSurfaceMode('orb')
        setActivity(t('已隐藏'))
      }
      if (lifecycle.state === 'waking') setActivity(t('正在显示悬浮球'))
      if (lifecycle.state === 'active' && lifecycle.reason === 'ready') {
        setActivity(t('待命'))
        noteInteraction()
      }
    }
    const dispose = bridge.onLifecycle(applyLifecycle)
    bridge.loadLifecycle().then(applyLifecycle).catch(() => {})
    const onInteraction = () => noteInteraction()
    window.addEventListener('pointerdown', onInteraction)
    window.addEventListener('keydown', onInteraction)
    return () => {
      dispose()
      window.removeEventListener('pointerdown', onInteraction)
      window.removeEventListener('keydown', onInteraction)
    }
  }, [noteInteraction, triggerSpriteAnimation, setDesktopLifecycle])

  useEffect(() => {
    if (!desktopOrbMode || desktopLifecycle !== 'waking') return
    // Presence readiness describes whether the desktop surface can finish
    // waking, not whether microphone capture has initialized. Keeping those
    // lifecycles separate prevents a slow/denied microphone from leaving the
    // orb permanently in `waking`, which would also disable inactivity sleep.
    if (desktopCanFinishWaking(voice.connectionState)) {
      window.qwenAudioAgentDesktop?.lifecycleReady()
    }
  }, [
    desktopLifecycle,
    voice.connectionState,
  ])

  // 快捷键/托盘唤起恢复 Gateway presence；Realtime 连接在休眠期间保持。
  const wakeGateway = voice.wake
  useEffect(() => {
    if (!desktopOrbMode || desktopLifecycle !== 'waking') return
    wakeGateway()
  }, [desktopLifecycle, wakeGateway])

  autoHideStateRef.current = {
    desktopLifecycle,
    desktopSurfaceMode,
    lastInteractionAt,
    connectionState: voice.connectionState,
    visualError: voice.visualError,
    workSettled,
  }

  useEffect(() => {
    if (!desktopOrbMode || autoHideSeconds === 0) return undefined
    const check = () => {
      const current = autoHideStateRef.current
      if (!current || current.desktopSurfaceMode === 'panel') return
      if (!desktopCanHide({
        settled: current.workSettled,
        connectionState: current.connectionState,
        visualError: current.visualError,
        lifecycle: current.desktopLifecycle,
      })) return
      const deadline = desktopHideDeadline({
        lastInteractionAt: current.lastInteractionAt,
        workSettledAt: workSettledAtRef.current,
        timeoutSeconds: autoHideSeconds,
      })
      if (
        Date.now() < deadline
        || autoHideRequestedDeadlineRef.current === deadline
      ) return
      autoHideRequestedDeadlineRef.current = deadline
      enterDesktopIdleSleep({
        bridge: window.qwenAudioAgentDesktop,
        onLifecycle: setDesktopLifecycle,
      }).then(hidden => {
        if (!hidden) autoHideRequestedDeadlineRef.current = null
      }).catch(() => { autoHideRequestedDeadlineRef.current = null })
    }
    const timer = setInterval(check, 1_000)
    check()
    return () => clearInterval(timer)
  }, [autoHideSeconds, setDesktopLifecycle])

  const modelLabel = (modelStatus.label || t('模型信息不可用'))
    .replace(/\s+Realtime\b/gi, '')
    .trim()

  const resetSession = () => {
    setVideoCallOpen(false)
    taskDismissTimers.current.forEach(timer => clearTimeout(timer))
    taskDismissTimers.current.clear()
    const next = crypto.randomUUID()
    localStorage.setItem('qwen-audio-agent.session', next)
    setSessionId(next)
    setMessages([])
    loadSessions()
    setAgentTasks([])
    currentTurnId.current = ''
    activeVoiceResponse.current = ''
    responseTurnMap.current.clear()
    agentTurnIds.current.clear()
    setActivity(t('已创建新会话'))
  }

  useEffect(() => {
    const readOwner = () => {
      try { return JSON.parse(localStorage.getItem(voiceOwnerKey) || 'null') } catch { return null }
    }
    // 本窗口开麦时持续续约
    const heartbeat = setInterval(() => {
      if (!voiceEnabledRef.current) return
      try {
        const owner = readOwner()
        if (!owner || owner.id === voiceTabId.current || Date.now() - (owner.ts || 0) > 12000) {
          localStorage.setItem(voiceOwnerKey, JSON.stringify({ id: voiceTabId.current, ts: Date.now() }))
        }
      } catch { /* ignore */ }
    }, 4000)
    // 其他窗口抢走语音时，本窗口自动关闭麦克风
    const onStorage = event => {
      if (event.key !== voiceOwnerKey) return
      let owner = null
      try { owner = JSON.parse(event.newValue || 'null') } catch { return }
      if (owner?.id && owner.id !== voiceTabId.current && voiceEnabledRef.current
          && Date.now() - (owner.ts || 0) < 12000) {
        setVoiceEnabled(false)
        setWaitingForVoice(false)
        setActivity(t('语音已在另一个窗口使用，此处已静音'))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => { clearInterval(heartbeat); window.removeEventListener('storage', onStorage) }
  }, [])
  const enableVoice = () => {
    // GEN-MOD: 已有其他窗口持有语音时拒绝开麦
    try {
      const owner = JSON.parse(localStorage.getItem(voiceOwnerKey) || 'null')
      if (owner?.id && owner.id !== voiceTabId.current && Date.now() - (owner.ts || 0) < 12000) {
        setActivity(t('语音已在另一个窗口使用，请先关闭那个窗口'))
        return
      }
      localStorage.setItem(voiceOwnerKey, JSON.stringify({ id: voiceTabId.current, ts: Date.now() }))
    } catch { /* ignore */ }
    if (!voice.activateAudio()) return
    if (voice.ownership.state === 'busy') {
      setWaitingForVoice(true)
      setActivity(t('等待{holder}释放语音', { holder: ownershipLabel || t('其他入口') }))
      return
    }
    setWaitingForVoice(false)
    setVoiceEnabled(true)
  }

  const voiceControlLabel = voiceEnabled ? t('麦克风静音')
    : waitingForVoice ? t('取消等待') : t('开启麦克风')

  const disableVoice = () => {
    setWaitingForVoice(false)
    setVoiceEnabled(false)
    setActivity(t('待命'))
    // GEN-MOD: 释放语音所有权，允许其他窗口开麦
    try {
      const owner = JSON.parse(localStorage.getItem(voiceOwnerKey) || 'null')
      if (!owner || owner.id === voiceTabId.current) localStorage.removeItem(voiceOwnerKey)
    } catch { /* ignore */ }
  }

  const sendComposerInput = parts => {
    // Sending is a browser user gesture, so it is also the earliest reliable
    // point to unlock audio playback while the microphone remains muted.
    voice.activateAudio()
    return voice.sendInput(parts)
  }

  const turns = useMemo(
    () => buildConversationTurns(messages, agentTasks),
    [messages, agentTasks],
  )

  const beginOrbDrag = event => {
    const bridge = window.qwenAudioAgentDesktop
    if (!desktopOrbMode || event.button !== 0 || !bridge) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    orbDrag.current = {
      pointerId: event.pointerId,
      lastX: event.screenX,
    }
    setOrbDragging(true)
    setOrbDragDirection('')
    bridge.dragStart(event.screenX, event.screenY)
  }

  const moveOrb = event => {
    const drag = orbDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.screenX - drag.lastX
    if (Math.abs(deltaX) >= 2) {
      setOrbDragDirection(deltaX > 0 ? 'right' : 'left')
      drag.lastX = event.screenX
    }
    window.qwenAudioAgentDesktop?.dragMove(event.screenX, event.screenY)
  }

  const endOrbDrag = event => {
    const drag = orbDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    orbDrag.current = null
    setOrbDragging(false)
    setOrbDragDirection('')
    window.qwenAudioAgentDesktop?.dragEnd()
  }

  const handleVoiceOrbClick = () => {
    if (voice.state === 'speaking') {
      voice.interrupt()
      return
    }
    enableVoice()
  }

  if (desktopOrbMode && desktopSurfaceMode === 'orb') {
    return <main className={`desktop-gallery-shell${
      desktopCards.length && !desktopTasksCollapsed ? ' has-task-cards' : ''
    }${desktopTaskLayout.placement === 'above' ? ' tasks-above' : ''}`}
    style={{ '--desktop-orb-offset-x': `${desktopTaskLayout.orbOffsetX}px` }}>
      <div className="desktop-orb-anchor">
        <section
        className={desktopOrbClassName({
          state: orbVisualState,
          enabled: voiceEnabled,
          error: voice.visualError || voiceConnectionError,
          dragging: orbDragging,
          lifecycle: desktopLifecycle,
        })}
        aria-label={`Gen-Ai · ${voice.visualError || voiceConnectionError ? t('连接异常') : labelFor(orbVisualState)}`}
        title={
          desktopLifecycle === 'waking'
            ? t('正在显示悬浮球')
            : voice.error
          || (orbVisualState === 'idle' && authorizationTask
            ? taskDetail(authorizationTask)
            : orbVisualState === 'occupied' && ownershipLabel
              ? t('{holder}正在使用语音', { holder: ownershipLabel })
              : labelFor(orbVisualState))
        }
        onPointerEnter={() => triggerSpriteAnimation('hover')}
        onPointerDown={beginOrbDrag}
        onPointerMove={moveOrb}
        onPointerUp={endOrbDrag}
        onPointerCancel={endOrbDrag}
        >
        {isBuiltinOrbSkin(orbSkinId) || spriteOrbFailed
          ? (
              <DesktopFluidOrb
                style={isBuiltinOrbSkin(orbSkinId) ? orbSkinId : 'fluid'}
              />
            )
          : (
              <DesktopSpriteOrb
                skin={orbSkinId}
                state={orbVisualState}
                baseWorking={desktopHasWorkingTasks}
                dragDirection={orbDragDirection}
                cue={spriteAnimationCue}
                onCueComplete={completeSpriteAnimationCue}
                onError={() => setSpriteOrbFailed(true)}
              />
            )}
        <nav
          className="desktop-orb-controls"
          aria-label={t('语音控制')}
          onPointerDown={event => event.stopPropagation()}
        >
          <button
            className={!voiceEnabled ? 'active' : ''}
            onClick={event => {
              event.stopPropagation()
              if (voiceEnabled || waitingForVoice) {
                disableVoice()
                return
              }
              enableVoice()
            }}
            aria-label={
              voiceEnabled
                ? t('麦克风静音')
                : waitingForVoice ? t('取消等待语音') : t('开启麦克风')
            }
            title={
              voiceEnabled
                ? t('麦克风静音')
                : waitingForVoice ? t('取消等待语音') : t('开启麦克风')
            }
          >
            <OrbControlIcon type="microphone" muted={!voiceEnabled} />
          </button>
          <button
            onClick={event => {
              event.stopPropagation()
              void changeDesktopSurface('panel')
            }}
            aria-label={t('打开对话')}
            title={t('打开对话')}
          >
            <OrbControlIcon type="conversation" />
          </button>
          <button
            onClick={event => {
              event.stopPropagation()
              window.qwenAudioAgentDesktop?.openSettings()
            }}
            aria-label={t('设置')}
            title={t('设置')}
          >
            <OrbControlIcon type="settings" />
          </button>
          {desktopCards.length > 0 && <button
            onClick={event => {
              event.stopPropagation()
              setDesktopTasksCollapsed(value => !value)
            }}
            aria-label={desktopTasksCollapsed ? t('展开后台任务') : t('折叠后台任务')}
            title={desktopTasksCollapsed ? t('展开后台任务') : t('折叠后台任务')}
          >
            <OrbControlIcon type="tasks" collapsed={desktopTasksCollapsed} />
          </button>}
          <button
            className="danger"
            onClick={event => {
              event.stopPropagation()
              window.qwenAudioAgentDesktop?.quit()
            }}
            aria-label={t('退出')}
            title={t('退出')}
          >
            <OrbControlIcon type="close" />
          </button>
        </nav>
        </section>
      </div>
      {desktopCards.length > 0 && !desktopTasksCollapsed && <section
        className="desktop-task-stack"
        aria-label={t('后台任务')}
        aria-live="polite"
      >
        {desktopCards.map(task => {
          const detail = taskDetail(task)
          const title = task.delegation?.title || task.objective || taskLabel(task)
          const scheduled = task.phase === 'scheduled'
          const progress = ['completed', 'failed', 'cancelled'].includes(task.phase)
            ? taskLabel(task)
            : detail && detail !== title ? detail : taskLabel(task)
          const plan = task.activity?.findLast(item => item.kind === 'plan')
          const progressRatio = ['completed', 'failed', 'cancelled'].includes(task.phase)
            ? 1
            : plan?.total > 0 ? plan.completed / plan.total : null
          return <article
            key={task.id}
            className={`desktop-task-card ${task.phase}`}
            title={detail}
          >
            <strong>{title}</strong>
            <span className="desktop-task-state">
              <i aria-hidden="true" />
              <small>{progress}</small>
            </span>
            {scheduled && <button
              className="desktop-task-cancel"
              type="button"
              aria-label={t(task.kind === 'reminder' ? '取消提醒' : '取消计划')}
              title={t(task.kind === 'reminder' ? '取消提醒' : '取消计划')}
              onClick={event => {
                event.stopPropagation()
                void cancelDesktopTask(task)
              }}
            >×</button>}
            <span
              className={`desktop-task-progress${progressRatio == null ? '' : ' determinate'}`}
              style={progressRatio == null ? undefined : {
                '--desktop-task-progress': `${Math.max(0, Math.min(1, progressRatio)) * 100}%`,
              }}
              aria-hidden="true"
            />
          </article>
        })}
      </section>}
    </main>
  }

  const renderTask = agentTask => <aside
    key={`task:${agentTask.id}`}
    className={`agent-task ${agentTask.phase}${
      taskHasArtifacts(agentTask) ? ' has-artifacts' : ''
    }${agentTask.authorization?.status === 'pending' ? ' awaiting-permission' : ''}`}
  >
    <span className="task-spinner" aria-hidden="true" />
    <div>
      <b>{taskLabel(agentTask)}</b>
      <small>{taskDetail(agentTask)}</small>
      <TaskArtifacts artifacts={agentTask.artifacts} />
    </div>
    {!['failed', 'disconnected'].includes(agentTask.phase) && <div className="task-controls">
      {agentTask.authorization?.status === 'pending' && <PermissionActions
        authorization={agentTask.authorization}
        onRespond={decision => respondToPermission(
          agentTask.id, agentTask.authorization, decision,
        )}
      />}
      <time>{desktopTaskElapsedSeconds(agentTask, taskClock)}s</time>
    </div>}
  </aside>

  const renderMessage = message => <article
    key={message.id}
    className={`${message.role}${message.companion ? ' companion' : ''}`}
  >
    <label>{message.role === 'user'
      ? t('你')
      : message.companion ? resultLabel(message) : 'Gen-Ai'}</label>
    <MessageContent
      role={message.role}
      content={String(message.content || '').trim() === '[生成失败]'
        ? t('（语音服务本次未生成回复，请再说一次）')
        : message.content}
      live={message.live}
      citations={message.citations}
    />
    {message.interrupted && <small className="interrupted">{t('已打断')}</small>}
  </article>

  return <main className={`app gen-app${
    desktopOrbMode ? ' desktop-conversation-panel' : ''
  }`}>
    <header>
      <div className="brand" onClick={() => { if (typeof window !== 'undefined' && window.innerWidth <= 640) { setSidebarMode('nav'); toggleSidebar() } }} style={{ cursor: 'pointer' }} title="打开菜单"><span aria-hidden="true"><svg viewBox="0 0 48 48" width="20" height="20"><g fill="#04110c"><rect x="7" y="9" width="34" height="7" rx="3.5"/><rect x="7" y="20.5" width="14" height="7" rx="3.5"/><rect x="27" y="20.5" width="14" height="7" rx="3.5"/><rect x="7" y="32" width="14" height="7" rx="3.5"/><rect x="27" y="32" width="14" height="7" rx="3.5"/></g></svg></span><div>艮<small>GEN · 止而后定</small></div></div>
      <GenMicDevice
        deviceId={inputDeviceId}
        onSelect={selectMicDevice}
      />
      <div className="status" style={{ marginLeft: 'auto' }}>
        <i className={orbVisualState} /><span>{labelFor(orbVisualState)}</span>
      </div>
      {videoCallSupported && <button
        className={`video-toggle${videoCallOpen ? ' active' : ''}`}
        aria-pressed={videoCallOpen}
        onClick={() => {
          if (!videoCallOpen) voice.activateAudio()
          setVideoCallOpen(value => !value)
        }}
      >{videoCallOpen ? t('关闭视频') : t('开启视频')}</button>}
      {desktopOrbMode && <button
        className="ghost desktop-panel-collapse"
        onClick={() => void changeDesktopSurface('orb')}
        title={t('收起为悬浮球')}
      >
        <OrbControlIcon type="collapse" />
      </button>}
    </header>

    <div className="gen-body">
      {isMobile && !sidebarCollapsed && <div className="gen-drawer-mask" onClick={toggleSidebar} />}
      {sidebarCollapsed && <button className="gen-sidebar-reopen" title="展开侧栏" onClick={toggleSidebar}>›</button>}
      {!sidebarCollapsed && <GenSidebar
        width={sidebarWidth}
        onToggleCollapse={toggleSidebar}
        onStartResize={startSidebarResize}
        tasksCount={agentTasks.length}
        active={genView}
        onNavigate={setGenView}
        selectedDate={calDate}
        onSelectDate={d => { setCalDate(d); setGenView('calendar') }}
        historyOnly={sidebarMode === 'history'}
        sessions={sessions}
        activeSession={sessionId}
        onSelectSession={switchSession}
        onNewSession={() => setNewChatOpen(true)}
        onDeleteSession={removeSession}
      />}
      <div className="gen-main">
    {genView === 'settings' && <GenSettings />}
    {genView === 'diary' && <GenDiary />}
    {genView === 'calendar' && <GenCalendar selectedDate={calDate} onSelectDate={setCalDate} />}
    {genView === 'email' && <GenEmail />}
    {genView === 'meeting' && <GenMeeting />}
    {genView === 'chat' && <section className="workspace">
      {showKnowledgeLibrary && <KnowledgeLibraryPanel
        onClose={() => setShowKnowledgeLibrary(false)}
        getTask={voice.getTask}
      />}

      {recording && <div className="gen-rec-bar">
        <span className="gen-rec-dot" />
        <b>{String(Math.floor(recSeconds / 60)).padStart(2, '0')}:{String(recSeconds % 60).padStart(2, '0')}</b>
        <span>正在录音</span>
        <button type="button" onClick={stopRecording}>结束并上传</button>
      </div>}
      {isMobile && <div className="gen-chat-tools">
        <button type="button" onClick={() => setNewChatOpen(true)}>＋ 新对话</button>
        <button type="button" onClick={() => { setSidebarMode('history'); setSidebarCollapsed(false) }}>🕘 历史对话</button>
      </div>}
      <div
        className="messages"
        ref={messagesRef}
        aria-live="polite"
        onScroll={event => {
          const container = event.currentTarget
          stickToBottom.current = (
            container.scrollHeight - container.scrollTop - container.clientHeight
            < 48
          )
        }}
      >
        {!turns.length && <div className="empty">
          <b>{t('试着说')}</b>
          <span>{t('“帮我查一下今天的 AI 新闻，并整理成三点摘要。”')}</span>
        </div>}
        {turns.map(turn => <section
          key={turn.id}
          className={`conversation-turn${turn.standalone ? ' standalone' : ''}`}
        >
          {turn.beforeActivities.map(renderMessage)}
          {turn.tasks.map(renderTask)}
          {turn.afterActivities.map(renderMessage)}
        </section>)}
      </div>

      {videoCallSupported && videoCallOpen && <div className="visual-stream-dock">
        <VideoCallPanel
          available={voice.imageBufferAvailable}
          connectionState={voice.connectionState}
          onFrame={voice.sendImageFrame}
          onStop={voice.clearImageBuffer}
          onStateChange={reportVisualInputState}
          onClose={() => setVideoCallOpen(false)}
        />
      </div>}
      {stopTip && <div className="gen-stop-tip">{stopTip}</div>}
      {genToast && <div className="gen-stop-tip">{genToast}</div>}
      {composerEnabled && <MultimodalComposer
        onSend={sendComposerInput}
        compact={desktopOrbMode || isMobile}
        onStartRecording={startRecording}
        recording={recording}
        recordingSeconds={recSeconds}
        onStopRecording={stopRecording}
        onOpenHistory={() => { setSidebarMode('history'); setSidebarCollapsed(false) }}
        trailing={<GenComposerBar />}
        afterSend={<>
          <GenStopButton
            active={orbVisualState !== 'idle' || agentTasks.some(task => ['running', 'queued', 'delegated', 'finalizing', 'cancelling'].includes(task.phase))}
            onStop={handleStopModel}
          />
          <GenMicButton
            enabled={voiceEnabled}
            waiting={waitingForVoice}
            muted={inputMuted}
            onStart={() => { enableVoice(); setInputMuted(false) }}
            onToggleMute={() => setInputMuted(v => !v)}
            onStop={() => {
              disableVoice()
              setInputMuted(false)
              if (orbVisualState !== 'idle') voice.interrupt()
            }}
          />
        </>}
      />}

    </section>}
      </div>
      {isMobile && <nav className="gen-mobile-tabs">
        {[
          ['chat', '对话', 'M4 6h16M4 12h10M4 18h16'],
          ['diary', '日记', 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h4'],
          ['calendar', '日历', 'M5 6h14v14H5zM5 10h14M9 4v4M15 4v4'],
          ['email', '邮箱', 'M4 6h16v12H4zM4 7l8 6 8-6'],
          ['meeting', '会议', 'M12 3a3 3 0 013 3v5a3 3 0 11-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3'],
          ['settings', '设置', 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 3v2M12 19v2M3 12h2M19 12h2'],
        ].map(([key, label, d]) => <button
          key={key}
          className={`gen-tab${genView === key ? ' on' : ''}`}
          onClick={() => setGenView(key)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
          <span>{label}</span>
        </button>)}
      </nav>}
      {genView === 'chat' && (rightCollapsed
        ? <button className="gen-right-reopen" title="展开日历面板" onClick={toggleRight}>‹</button>
        : <GenRightPanel
            selectedDate={calDate}
            onSelectDate={d => { setCalDate(d); setGenView('calendar') }}
            onCollapse={toggleRight}
          />)}
    </div>
    {newChatOpen && <div className="gd-mask" onClick={ev => { if (ev.target === ev.currentTarget) setNewChatOpen(false) }}>
      <div className="gd-modal" style={{ width: 'min(400px, 100%)' }}>
        <h3>新建对话</h3>
        <label>
          对话名称（可留空，按时间命名）
          <input
            autoFocus
            value={newChatTitle}
            placeholder="例如：日报整理 / 客户沟通"
            onChange={e => setNewChatTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void createNewChat() }}
          />
        </label>
        <div className="gd-modal-actions">
          <button className="gd-btn" onClick={() => setNewChatOpen(false)}>取消</button>
          <button className="gd-btn primary" onClick={createNewChat}>创建</button>
        </div>
      </div>
    </div>}

  </main>
}

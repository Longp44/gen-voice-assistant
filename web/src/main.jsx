import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './gen-theme.css'
import './gen-shell.css'

// GEN-MOD: 非安全上下文（http://局域网/Tailscale IP）没有 crypto.randomUUID，
// 补一个降级实现，否则页面白屏/黑屏。麦克风仍需 HTTPS。
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = function randomUUIDFallback() {
    const bytes = new Uint8Array(16)
    if (typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes)
    else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
}

if (new URLSearchParams(window.location.search).get('desktop') === 'orb') {
  document.documentElement.dataset.desktop = 'orb'
}

// GEN-MOD: 注册 PWA Service Worker（HTTPS 下），支持"添加到主屏幕"独立窗口打开
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

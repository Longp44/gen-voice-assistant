import { t } from '../i18n.js'

export default function GenStatusBar({ backendLabel, backendReady, modelLabel, voiceLabel }) {
  const detail = [
    `${t('已连接')} · 127.0.0.1`,
    `${backendLabel}${backendReady ? ` ${t('就绪')}` : ` ${t('未就绪')}`}`,
    modelLabel,
  ].filter(Boolean).join('\n')
  return <div className="gen-statusbar">
    <span className="gen-status-min" title={detail}>
      <i className={`dotg${backendReady ? '' : ' off'}`} />{voiceLabel || t('待命')}
    </span>
  </div>
}

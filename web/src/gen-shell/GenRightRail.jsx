import { useState } from 'react'
import { t } from '../i18n.js'

const phaseLabel = {
  submitted: '已提交',
  working: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  scheduled: '定时',
  disconnected: '已断开',
  queued: '排队中',
}

export default function GenRightRail({ tasks = [] }) {
  const [tab, setTab] = useState('tasks')
  const tabs = [['tasks', '任务'], ['inbox', '收件箱'], ['kb', '知识库'], ['data', '数据']]
  return <aside className="gen-right">
    <div className="gen-tabs">
      {tabs.map(([key, label]) => <button
        key={key}
        className={tab === key ? 'on' : ''}
        onClick={() => setTab(key)}
      >{t(label)}</button>)}
    </div>
    <div className="gen-panel">
      {tab === 'tasks' && (tasks.length
        ? tasks.slice(-6).reverse().map(task => <div key={task.id} className="gen-card">
          <div className="gen-card-top">
            <span className="gen-card-name">{task.delegation?.title || task.objective || t('任务')}</span>
            <span className={`gen-tag ${task.phase}`}>{t(phaseLabel[task.phase] || task.phase)}</span>
          </div>
          {task.phase === 'working' && <div className="gen-progress"><i /></div>}
        </div>)
        : <div className="gen-empty">{t('还没有任务')}<br /><small>{t('在对话里说一句，就能派活')}</small></div>)}
      {tab !== 'tasks' && <div className="gen-empty">
        {tab === 'inbox' && <>{t('收件箱')}<br /><small>{t('微信 / 邮件 / 日历通知会自动汇总到这里（Q5 交付）')}</small></>}
        {tab === 'kb' && <>{t('知识库')}<br /><small>{t('会议记录、文档、通知摘要将在这里沉淀（Q3 交付）')}</small></>}
        {tab === 'data' && <>{t('数据')}<br /><small>{t('通话时长、任务数量、入库条数、花费（Q3 交付）')}</small></>}
      </div>}
    </div>
  </aside>
}

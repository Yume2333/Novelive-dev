import { Icon } from '../../components/Button'
import { Drawer } from '../../components/Extended'
import { EmptyState } from '../../components/Form'
import { StatusBeacon } from '../../components/Motion'
import { runRecordMock } from '../../mock/chat'
import type { ChapterStatus } from '../../mock/types'
import { MessageParts } from './MessageView'

/**
 * 一章的制作运行记录：写 → 审稿 → 演出 → 出图，四段分开看；出图段按画师分组。
 * 复用对话面板那套消息渲染；这里的确认卡、工具卡都只读。
 */
export function RunRecordDrawer({
  chapterTitle,
  chapterStatus,
  chapterStep,
  open,
  onClose,
}: {
  chapterTitle: string
  chapterStatus?: ChapterStatus
  chapterStep?: string
  open: boolean
  onClose: () => void
}) {
  const data = runRecordMock(chapterTitle, chapterStatus, chapterStep)
  const isWaiting = chapterStatus === 'waiting' || data.steps.length === 0

  return (
    <Drawer open={open} title={`运行记录 · ${chapterTitle}`} onClose={onClose} width={520}>
      {isWaiting ? (
        <EmptyState
          icon="schedule"
          title="尚未开始制作"
          desc="排到本章后，写手、审稿、演出和出图的运行记录会实时显示在这里。"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {data.steps.map((step, i) => {
            const status = step.status ?? 'done'
            return (
              <section
                key={step.title}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                  opacity: status === 'waiting' ? 0.55 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    className="glass-panel"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 'var(--radius-full)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      color: status === 'waiting' ? 'var(--color-outline)' : 'var(--color-primary)',
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 13.5,
                      fontFamily: 'var(--font-display)',
                      letterSpacing: '0.04em',
                      color: status === 'waiting' ? 'var(--color-outline)' : 'var(--color-on-surface)',
                    }}
                  >
                    {step.title}
                  </span>
                  {status === 'done' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-success)' }}>
                      <Icon name="check_circle" size={12} />
                      完成
                    </span>
                  ) : status === 'running' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-primary)' }}>
                      <StatusBeacon tone="active" active size={6} />
                      <span className="ink-shimmer">进行中</span>
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-outline)' }}>
                      <Icon name="schedule" size={12} />
                      等待中
                    </span>
                  )}
                  <span style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
                </div>
                {step.parts.length ? <MessageParts parts={step.parts} nested /> : null}
                {step.groups?.map((g) => (
                  <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <span className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', fontSize: 11 }}>{g.title}</span>
                    <MessageParts parts={g.parts} nested />
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      )}
    </Drawer>
  )
}

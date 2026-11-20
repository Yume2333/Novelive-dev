import { Icon } from '../../components/Button'
import { Drawer } from '../../components/Extended'
import { runRecordMock } from '../../mock/chat'
import { MessageParts } from './MessageView'

/**
 * 一章的制作运行记录：写 → 审稿 → 演出与出图，三段分开看。
 * 复用对话面板那套消息渲染；这里的确认卡、工具卡都只读。
 */
export function RunRecordDrawer({ chapterTitle, open, onClose }: {
  chapterTitle: string
  open: boolean
  onClose: () => void
}) {
  const data = runRecordMock(chapterTitle)
  return (
    <Drawer open={open} title={`运行记录 · ${chapterTitle}`} onClose={onClose} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {data.steps.map((step, i) => (
          <section key={step.title} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                className="neu-button"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 'var(--radius-full)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>{step.title}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-success)' }}>
                <Icon name="check_circle" size={12} />
                完成
              </span>
              <span style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
            </div>
            <MessageParts parts={step.parts} nested />
          </section>
        ))}
      </div>
    </Drawer>
  )
}

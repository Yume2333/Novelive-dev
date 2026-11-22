import { useNavigate, useParams } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Card } from '../../components/Card'
import { Tooltip } from '../../components/Extended'
import { Dropdown } from '../../components/Modal'
import { EmptyState } from '../../components/Form'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { findSeries, findVolume, findWork } from '../../mock/library'
import { firstChapterScenes as scenes } from '../../mock/confirm'


export function ConfirmFirstPage() {
  const { id } = useParams()
  const work = findWork(id)
  const navigate = useNavigate()
  const toast = useToast()

  if (!work || work.kind !== 'project') {
    return (
      <Page title="第一章成品" width={760}>
        <EmptyState icon="play_circle" title="这部作品不在这个确认点" desc="只有工程作品会停在确认点。" actions={<Button variant="primary" onClick={() => navigate('/')}>回到书库</Button>} />
      </Page>
    )
  }

  const vol = findVolume(work.volumeId)
  const ser = findSeries(work.seriesId)
  const first = work.chapters[0]

  return (
    <Page
      eyebrow={`${ser.title} · 第${vol.index}卷 · 确认点 2 / 2`}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span>{work.title} · 第一章成品</span>
          <Tooltip text="确认后其余章节在后台按卷连续做，做完一章即可游玩。">
            <Icon name="info" size={16} style={{ color: 'var(--color-outline)' }} />
          </Tooltip>
        </span>
      }
      actions={
        <>
          <Button icon="play_circle" onClick={() => navigate(`/work/${work.id}/play`)}>试玩第一章</Button>
          <Dropdown
            trigger={<Button variant="ghost" icon="more_horiz">更多</Button>}
            items={[
              { label: '进编辑器修改', icon: 'edit_note', onClick: () => navigate(`/work/${work.id}/edit`) },
            ]}
          />
          <Button
            variant="primary"
            icon="check"
            onClick={() => {
              toast('第一章已确认，其余章节进入后台按卷制作', 'check')
              navigate(`/work/${work.id}/production`)
            }}
          >
            继续制作
          </Button>
        </>
      }
    >
      <div className="label-caps label-caps-zh" style={{ color: 'var(--color-on-surface-variant)' }}>
        {`第 1 章 · ${first?.title ?? '第一章'} · ${scenes.length} 个场景`}
        <span style={{ marginLeft: 'var(--space-3)', color: 'var(--color-outline)' }}>
          {work.sourceLanguage !== work.workLanguage ? `${work.sourceLanguage} → ${work.workLanguage} · ` : ''}
          已发布，可以试玩
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
        {scenes.map((s, i) => (
          <Card key={s.title} style={{ overflow: 'hidden' }}>
            <div style={{ height: 104, background: s.art, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, bottom: 8, padding: '3px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--scrim)', color: 'var(--stage-text)', fontSize: 11, letterSpacing: '0.02em' }}>
                场景 {i + 1}
              </span>
            </div>
            <div style={{ padding: 'var(--space-4)' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</div>
              <p style={{ fontSize: 12, color: 'var(--color-on-surface-variant)', marginTop: 6, lineHeight: 1.6 }}>{s.desc}</p>
              <div style={{ fontSize: 11, color: 'var(--color-outline)', marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="image" size={13} /> {s.images}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </Page>
  )
}

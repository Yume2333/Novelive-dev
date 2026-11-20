import { useNavigate, useParams } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Card } from '../../components/Card'
import { Tooltip } from '../../components/Extended'
import { EmptyState } from '../../components/Form'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { findSeries, findVolume, findWork } from '../../mock/library'

// 第一章的占位场景缩略图：CSS 渐变，不用位图
const sceneArts = [
  'linear-gradient(180deg, #e8a87c 0%, #f2d3ac 55%, #f7ead2 100%)',
  'linear-gradient(180deg, #5a6a80 0%, #8fa0b8 60%, #d4dde8 100%)',
  'linear-gradient(160deg, #b85c48 0%, #e0926a 50%, #f2cf9e 100%)',
  'linear-gradient(180deg, #3f4a56 0%, #6d7f8e 55%, #b8c6d0 100%)',
]

const scenes = [
  { title: '放学后的旧教学楼', desc: '夕阳从走廊尽头照进来，澪背着书包站在音乐教室门口。', images: '2 张背景 · 1 张立绘' },
  { title: '音乐教室', desc: '一架旧钢琴。澪推开门，琴声停了。', images: '1 张背景 · 2 张立绘' },
  { title: '走廊', desc: '她追出去，走廊里没有人，只有蝉鸣。', images: '1 张背景 · 1 张 CG' },
  { title: '回家路上', desc: '钢琴声在身后又响起来，她没有回头。', images: '1 张背景 · 1 张 CG' },
]

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
      title={`${work.title} · 第一章成品`}
      subtitle={
        <Tooltip text="确认后其余章节在后台按卷连续做，做完一章即可游玩。">
          <Icon name="info" size={15} style={{ color: 'var(--color-outline)', verticalAlign: 'middle' }} />
        </Tooltip>
      }
      actions={
        <>
          <Button variant="neu" icon="play_circle" onClick={() => navigate(`/work/${work.id}/play`)}>试玩第一章</Button>
          <Button variant="ghost" icon="edit_note" onClick={() => navigate(`/work/${work.id}/edit`)}>进编辑器修改</Button>
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
            <div style={{ height: 104, background: sceneArts[i % sceneArts.length], position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, bottom: 8, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--scrim)', color: 'var(--color-on-primary)', fontSize: 11 }}>
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

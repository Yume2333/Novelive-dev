import { useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Card, ChapterStatusMark, ProgressBar } from '../../components/Card'
import { Banner, Checkbox, Chip, Drawer, Pagination, RadioGroup } from '../../components/Extended'
import { EmptyState } from '../../components/Form'
import { GradientCover } from '../../components/GradientCover'
import { Dropdown, Modal } from '../../components/Modal'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { findSeries, findVolume, findWork, works } from '../../mock/library'
import { useProduction } from '../../mock/production'
import type { Chapter, Work } from '../../mock/types'

/** 作品当前阶段的卡片：预览 / 两个确认点 / 制作中 / 已完成 */
function PhaseCard({ work }: { work: Work }) {
  const navigate = useNavigate()
  const { queue } = useProduction()
  const pos = queue.findIndex((w) => w.id === work.id)

  if (work.phase === 'preview' && work.previewProgress) {
    const p = work.previewProgress
    return (
      <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
        <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 'var(--space-3)' }}>
          当前阶段 · {p.stage}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="headline" style={{ fontSize: 20, marginBottom: 'var(--space-3)' }}>
              已读 {p.done} / {p.total} 章
            </h3>
            <ProgressBar value={p.done / p.total} />
          </div>
          {pos > 0 ? <Chip>排在第 {pos + 1} 位</Chip> : pos === 0 ? <Chip active>正在处理</Chip> : null}
        </div>
      </Card>
    )
  }

  if (work.phase === 'confirm-visual' || work.phase === 'confirm-first') {
    const isVisual = work.phase === 'confirm-visual'
    return (
      <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <Icon name="pending_actions" size={26} style={{ color: 'var(--color-on-error-container)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="label-caps label-caps-zh" style={{ color: 'var(--color-on-error-container)', marginBottom: 6 }}>
              待确认 · {isVisual ? '确认点 1 / 2' : '确认点 2 / 2'}
            </div>
            <h3 className="headline" style={{ fontSize: 20 }}>
              {isVisual ? '角色设定和主视觉等你选定' : '第一章做好了，先试玩'}
            </h3>
          </div>
          <Button variant="primary" icon={isVisual ? 'palette' : 'play_circle'} onClick={() => navigate(`/work/${work.id}/confirm/${isVisual ? 'visual' : 'first'}`)}>
            {isVisual ? '去确认角色设定' : '查看第一章'}
          </Button>
        </div>
      </Card>
    )
  }

  if (work.phase === 'producing') {
    const current = work.chapters.find((c) => c.status === 'producing')
    const attention = work.chapters.filter((c) => c.status === 'attention').length
    return (
      <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <Icon
            name="conveyor_belt"
            size={26}
            style={{ color: 'var(--color-primary)', flexShrink: 0, animation: pos === 0 ? 'soft-pulse 4s infinite alternate' : undefined }}
          />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 6 }}>
              制作中{pos === 0 ? ' · 正在制作' : pos > 0 ? ` · 排在第 ${pos + 1} 位` : ' · 未在队列'}
            </div>
            <h3 className="headline" style={{ fontSize: 20 }}>
              {current ? `第 ${current.index} 章 · ${current.title}` : '等待下一个章节'}
              {current?.step ? <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-on-surface-variant)' }}>（{current.step}）</span> : null}
            </h3>
            {attention ? (
              <p style={{ marginTop: 6, fontSize: 12, color: 'var(--color-on-error-container)' }}>{attention} 章需要处理</p>
            ) : null}
          </div>
          <Button variant="neu" icon="conveyor_belt" onClick={() => navigate(`/work/${work.id}/production`)}>
            打开制作面板
          </Button>
        </div>
      </Card>
    )
  }

  if (work.phase === 'done') {
    return (
      <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <Icon name="check_circle" size={26} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
          <div>
            <h3 className="headline" style={{ fontSize: 20 }}>全部章节已发布</h3>
          </div>
        </div>
      </Card>
    )
  }

  return null
}

/** 作品信息 Hero：封面 + 标题作者 + 可展开简介 + 游玩入口 */
function HeroCard({ work }: { work: Work }) {
  const [expanded, setExpanded] = useState(false)
  const ser = findSeries(work.seriesId)
  const vol = findVolume(work.volumeId)

  const isProject = work.kind === 'project'
  const long = work.synopsis.length > 40
  const clip: CSSProperties = expanded
    ? {}
    : ({ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' } as CSSProperties)

  return (
    <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
        <div style={{ width: 168, height: 224, borderRadius: 'var(--radius-md)', overflow: 'hidden', flexShrink: 0, boxShadow: 'var(--shadow-glass)' }}>
          <GradientCover work={work} />
        </div>
        <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column' }}>
          <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 'var(--space-2)' }}>
            {ser.title} · 第{vol.index}卷 · {vol.title}
          </div>
          <h2 className="display" style={{ fontSize: 26 }}>{work.title}</h2>
          <p style={{ marginTop: 'var(--space-2)', fontSize: 13, color: 'var(--color-on-surface-variant)' }}>
            {work.author}
            {work.sourceLanguage !== work.workLanguage ? ` · ${work.sourceLanguage} → ${work.workLanguage}` : ''}
            {isProject ? '' : ` · 作品包 v${work.version}`}
          </p>
          <p style={{ marginTop: 'var(--space-4)', fontSize: 14, lineHeight: 1.8, color: 'var(--color-on-surface-variant)', ...clip }}>
            {work.synopsis}
          </p>
          {long ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{ alignSelf: 'flex-start', marginTop: 'var(--space-1)', fontSize: 12, color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
            >
              {expanded ? '收起' : '展开简介'}
              <Icon name={expanded ? 'expand_less' : 'expand_more'} size={15} />
            </button>
          ) : null}
          {work.reading ? (
            <div style={{ marginTop: 'var(--space-5)', maxWidth: 340 }}>
              <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 'var(--space-2)' }}>
                读到第 {work.reading.chapter} 章 · {Math.round(work.reading.progress * 100)}%
              </div>
              <ProgressBar value={work.reading.progress} height={5} />
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

const PAGE_SIZE = 8

function ChapterRow({ work, chapter, isProject, last }: { work: Work; chapter: Chapter; isProject: boolean; last: boolean }) {
  const navigate = useNavigate()
  const playable = chapter.status === 'published'
  const readingHere = work.reading?.chapter === chapter.index ? work.reading.progress : null
  const alreadyRead = work.reading !== null && chapter.index < work.reading.chapter
  return (
    <div
      className="hover-row"
      onClick={() => playable && navigate(`/work/${work.id}/play`)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        minHeight: 52,
        padding: 'var(--space-2) var(--space-4)',
        borderBottom: last ? 'none' : '1px solid var(--divider)',
        cursor: playable ? 'pointer' : 'default',
      }}
    >
      <span className="label-caps" style={{ color: 'var(--color-outline)', width: 26, flexShrink: 0 }}>
        {String(chapter.index).padStart(2, '0')}
      </span>
      <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>{chapter.title}</span>
      {chapter.priority ? (
        <span className="label-caps label-caps-zh" style={{ color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10 }}>
          <Icon name="keyboard_double_arrow_up" size={13} /> 优先
        </span>
      ) : null}
      {alreadyRead ? <Icon name="done" size={14} style={{ color: 'var(--color-outline)' }} /> : null}
      {readingHere !== null && readingHere < 1 ? (
        <span style={{ fontSize: 11, color: 'var(--color-primary)' }}>读到 {Math.round(readingHere * 100)}%</span>
      ) : null}
      {chapter.step ? <span style={{ fontSize: 12, color: 'var(--color-primary)' }}>{chapter.step}</span> : null}
      {chapter.issue ? (
        <span style={{ fontSize: 12, color: 'var(--color-on-error-container)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {chapter.issue}
        </span>
      ) : null}
      {chapter.staleImages ? (
        <span style={{ fontSize: 11, color: 'var(--color-on-surface-variant)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <Icon name="broken_image" size={13} /> {chapter.staleImages} 张图过期
        </span>
      ) : null}
      <span style={{ flex: 1 }} />
      {isProject ? <ChapterStatusMark status={chapter.status} spin={chapter.status === 'producing'} /> : null}
      <span className="row-actions" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
        {playable ? (
          <button
            title="游玩本章"
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/work/${work.id}/play`)
            }}
            style={{ display: 'flex', padding: 6, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}
          >
            <Icon name="play_arrow" size={18} />
          </button>
        ) : null}
      </span>
    </div>
  )
}

/** 章节目录：超过 8 章分页，保持一屏一个焦点 */
function ChapterList({ work, isProject }: { work: Work; isProject: boolean }) {
  const [page, setPage] = useState(1)
  const total = Math.ceil(work.chapters.length / PAGE_SIZE)
  const slice = work.chapters.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  return (
    <>
      <Card>
        {slice.map((c, i) => (
          <ChapterRow key={c.id} work={work} chapter={c} isProject={isProject} last={i === slice.length - 1} />
        ))}
      </Card>
      {total > 1 ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-4)' }}>
          <Pagination page={page} total={total} onChange={setPage} />
        </div>
      ) : null}
    </>
  )
}

/** 作品设置抽屉：预设 + 改编要求，平时不占页面 */
function SettingsDrawer({ work, open, onClose }: { work: Work; open: boolean; onClose: () => void }) {
  const toast = useToast()
  return (
    <Drawer open={open} title="作品设置" onClose={onClose}>
      <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
        <div className="label-caps label-caps-zh" style={{ color: 'var(--color-on-surface-variant)', marginBottom: 'var(--space-3)' }}>改编预设</div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Chip>{`改编强度 · ${work.presets.strength}`}</Chip>
          <Chip>{`演出密度 · ${work.presets.density}`}</Chip>
        </div>
        <Button variant="neu" size="sm" icon="tune" style={{ marginTop: 'var(--space-4)' }} onClick={() => toast('已记录：下次制作前会再问一遍预设（演示）', 'tune')}>
          调整预设
        </Button>
      </div>
      <div className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
        <div className="label-caps label-caps-zh" style={{ color: 'var(--color-on-surface-variant)', marginBottom: 'var(--space-3)' }}>改编要求</div>
        {work.requirement ? (
          <p style={{ fontSize: 13, color: 'var(--color-on-surface-variant)', lineHeight: 1.8 }}>{work.requirement}</p>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--color-outline)' }}>没有额外要求。</p>
        )}
        <Button variant="neu" size="sm" icon="edit_note" style={{ marginTop: 'var(--space-4)' }} onClick={() => toast('已记录：改编要求稍后可在对话里补充（演示）', 'edit_note')}>
          修改要求
        </Button>
      </div>
    </Drawer>
  )
}

/** 导出 .novelive：范围 + 原文选项 + 需要处理章节提醒 + 版本号 */
function ExportModal({ work, open, onClose }: { work: Work; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [scope, setScope] = useState('work')
  const [withSource, setWithSource] = useState(false)
  const vol = findVolume(work.volumeId)
  const ser = findSeries(work.seriesId)

  const inScope =
    scope === 'work' ? [work] : scope === 'volume' ? works.filter((w) => w.volumeId === work.volumeId) : works.filter((w) => w.seriesId === work.seriesId)
  const attention = inScope.flatMap((w) => w.chapters.filter((c) => c.status === 'attention').map((c) => `《${w.title}》第 ${c.index} 章`))

  return (
    <Modal
      open={open}
      title="导出作品包"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            icon="ios_share"
            onClick={() => {
              toast(`已导出 ${work.title} · v${work.version}${withSource ? ' · 含原文' : ''}`, 'ios_share')
              onClose()
            }}
          >
            导出 .novelive
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div className="label-caps label-caps-zh" style={{ color: 'var(--color-on-surface-variant)', marginBottom: 'var(--space-3)' }}>导出范围</div>
          <RadioGroup
            value={scope}
            onChange={setScope}
            options={[
              { value: 'work', label: `单部作品 ·《${work.title}》` },
              { value: 'volume', label: `整卷 · ${vol.title}` },
              { value: 'series', label: `整个系列 · ${ser.title}` },
            ]}
          />
        </div>
        <Checkbox checked={withSource} onChange={() => setWithSource((v) => !v)} label="包含原文" />
        {attention.length ? (
          <Banner kind="warning">
            <span>
              以下章节用了占位图，导出后游玩时会显示占位，不阻止导出：
              {attention.map((t) => (
                <span key={t} style={{ display: 'block', marginTop: 4, fontWeight: 600 }}>
                  {t}
                </span>
              ))}
            </span>
          </Banner>
        ) : null}
      </div>
    </Modal>
  )
}

export function WorkPage() {
  const { id } = useParams()
  const work = findWork(id)
  const navigate = useNavigate()
  const toast = useToast()
  const [exportOpen, setExportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (!work) {
    return (
      <Page title="找不到这部作品" width={760}>
        <EmptyState icon="auto_stories" title="作品不存在" desc="回到书库另选一部。" actions={<Button variant="primary" onClick={() => navigate('/')}>回到书库</Button>} />
      </Page>
    )
  }

  const isProject = work.kind === 'project'
  const playable = work.chapters.some((c) => c.status === 'published')

  const moreItems = isProject
    ? [
        { label: '导出作品包', icon: 'ios_share', onClick: () => setExportOpen(true) },
        { label: '作品设置', icon: 'tune', onClick: () => setSettingsOpen(true) },
      ]
    : [{ label: '导入为工程', icon: 'design_services', onClick: () => toast('已把作品包导入为新工程，可以在书库里编辑', 'unarchive') }]

  return (
    <Page
      title={work.title}
      actions={
        <>
          <Dropdown
            trigger={
              <Button variant="neu" icon="more_horiz" title="更多">
                更多
              </Button>
            }
            items={moreItems}
          />
          {playable ? (
            <Button variant="primary" icon="play_arrow" onClick={() => navigate(`/work/${work.id}/play`)}>
              {work.reading && work.reading.progress < 1 ? '继续游玩' : '开始游玩'}
            </Button>
          ) : null}
        </>
      }
    >
      <HeroCard work={work} />

      {isProject ? <PhaseCard work={work} /> : null}

      <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 'var(--space-4)', marginTop: 'var(--space-7)' }}>
        章节目录 · 共 {work.chapters.length} 章
      </div>
      <ChapterList work={work} isProject={isProject} />

      {isProject ? (
        <>
          <ExportModal work={work} open={exportOpen} onClose={() => setExportOpen(false)} />
          <SettingsDrawer work={work} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </>
      ) : null}
    </Page>
  )
}

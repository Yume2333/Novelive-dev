import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Card, ChapterStatusMark, ProgressBar } from '../../components/Card'
import { Banner, Chip, ConfirmDialog, Drawer, Tooltip } from '../../components/Extended'
import { EmptyState } from '../../components/Form'
import { Dropdown } from '../../components/Modal'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { findSeries, findVolume, findWork } from '../../mock/library'
import { useProduction } from '../../mock/production'
import type { Chapter, Work } from '../../mock/types'
import { RunRecordDrawer } from '../chat/RunRecord'


// 过期图片占位（CSS 图形，无位图）：灰底 + 警示斜线，用 surface token 兜底
const staleThumb =
  'linear-gradient(135deg, transparent 46%, var(--color-on-error-container) 46%, var(--color-on-error-container) 54%, transparent 54%), linear-gradient(180deg, var(--color-surface-container-high), var(--color-surface-container-highest))'

interface StaleImage {
  id: string
  label: string
  kind: string
  /** 连带提示：重画这张图会影响到谁 */
  cascade?: string
}

function staleImagesOf(chapter: Chapter): StaleImage[] {
  const list: StaleImage[] = []
  for (let i = 0; i < (chapter.staleImages ?? 0); i++) {
    list.push({
      id: `${chapter.id}-s${i}`,
      label: i === 0 ? `第 ${chapter.index} 章 · 场景 ${i + 1} 背景` : `第 ${chapter.index} 章 · 人物立绘 ${i}`,
      kind: i === 0 ? '场景背景 · 参考图已更新' : '人物立绘 · 设定集已更新',
      cascade: i === 0 ? `重画后第 ${chapter.index} 章的 3 个场景会一起换新背景。` : undefined,
    })
  }
  return list
}

function ChapterRow({ work, chapter, last, onOpenStale, onOpenRuns }: {
  work: Work
  chapter: Chapter
  last: boolean
  onOpenStale: (c: Chapter) => void
  onOpenRuns: (c: Chapter) => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const [priority, setPriority] = useState(!!chapter.priority)
  // 三步进度：审稿是作品开关，关了只剩两步；出图按张算（"图 5/8"）
  const steps = work.reviewEnabled ? ['写', '审稿', '演出与出图'] : ['写', '演出与出图']
  // step 形如 "演出与出图 5/8"
  const stepIdx = Math.max(
    0,
    steps.findIndex((s) => chapter.step?.startsWith(s)),
  )
  const m = chapter.step?.match(/(\d+)\s*\/\s*(\d+)/)
  const frac = chapter.step ? (stepIdx + (m ? Math.min(1, Number(m[1]) / Math.max(1, Number(m[2]))) : 0)) / steps.length : 0
  return (
    <div
      className="hover-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        minHeight: 52,
        padding: 'var(--space-2) var(--space-4)',
        borderBottom: last ? 'none' : '1px solid var(--divider)',
      }}
    >
      <span className="label-caps" style={{ color: 'var(--color-outline)', width: 26, flexShrink: 0 }}>
        {String(chapter.index).padStart(2, '0')}
      </span>
      <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>{chapter.title}</span>
      {priority ? (
        <span className="label-caps label-caps-zh" style={{ color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10 }}>
          <Icon name="keyboard_double_arrow_up" size={13} /> 优先
        </span>
      ) : null}
      {chapter.step ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>
          {steps.map((s, i) => (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i > 0 ? <Icon name="chevron_right" size={11} style={{ color: 'var(--color-outline)' }} /> : null}
              <span style={i === stepIdx ? undefined : { color: 'var(--color-outline)', fontWeight: 400 }}>{s}</span>
            </span>
          ))}
          {m ? <span>· {chapter.step.slice(chapter.step.indexOf(m[0]))}</span> : null}
        </span>
      ) : null}
      {chapter.staleImages ? (
        <button
          onClick={() => onOpenStale(chapter)}
          style={{ fontSize: 11, color: 'var(--color-on-surface-variant)', display: 'inline-flex', alignItems: 'center', gap: 3, padding: 0 }}
          title="查看过期图片"
        >
          <Icon name="broken_image" size={13} /> {chapter.staleImages} 张图过期
        </button>
      ) : null}
      <span style={{ flex: 1 }} />
      {chapter.step ? (
        <span style={{ width: 72, flexShrink: 0 }}>
          <ProgressBar value={frac} height={4} />
        </span>
      ) : null}
      <span style={{ display: 'inline-flex', justifyContent: 'flex-end', width: 96, flexShrink: 0 }}>
        {chapter.issue ? (
          <Tooltip text={chapter.issue}>
            <span style={{ display: 'inline-flex' }}>
              <ChapterStatusMark status={chapter.status} spin={chapter.status === 'producing'} />
            </span>
          </Tooltip>
        ) : (
          <ChapterStatusMark status={chapter.status} spin={chapter.status === 'producing'} />
        )}
      </span>
      <span className="row-actions" style={{ display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--space-1)', minWidth: 232, flexShrink: 0 }}>
        {chapter.status === 'published' ? (
          <Button variant="ghost" icon="play_arrow" size="sm" onClick={() => navigate(`/work/${work.id}/play`)}>游玩</Button>
        ) : null}
        {chapter.status === 'attention' ? (
          <Button variant="ghost" icon="refresh" size="sm" onClick={() => toast(`已重试第 ${chapter.index} 章`, 'refresh')}>重试</Button>
        ) : null}
        {chapter.status === 'published' || chapter.status === 'attention' ? (
          <Button variant="ghost" icon="edit_note" size="sm" onClick={() => navigate(`/work/${work.id}/edit`)}>
            {chapter.status === 'attention' ? '去编辑' : '编辑'}
          </Button>
        ) : null}
        <Button variant="ghost" icon="history" size="sm" onClick={() => onOpenRuns(chapter)}>运行记录</Button>
        {chapter.status !== 'published' ? (
          <Dropdown
            trigger={
              <button
                title="更多"
                style={{ display: 'flex', padding: 5, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}
              >
                <Icon name="more_horiz" size={17} />
              </button>
            }
            items={[
              {
                label: priority ? '取消优先' : '设为优先',
                icon: 'keyboard_double_arrow_up',
                onClick: () => {
                  setPriority((v) => !v)
                  toast(priority ? `已取消第 ${chapter.index} 章优先` : `第 ${chapter.index} 章已设为优先，将在当前章之后制作`, 'keyboard_double_arrow_up')
                },
              },
            ]}
          />
        ) : null}
      </span>
    </div>
  )
}

export function ProductionPage() {
  const { id } = useParams()
  const work = findWork(id)
  const navigate = useNavigate()
  const toast = useToast()
  const { running, queue, stop, resume, crashed, simulateCrash } = useProduction()
  const [staleChapter, setStaleChapter] = useState<Chapter | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [runsChapter, setRunsChapter] = useState<Chapter | null>(null)

  if (!work || work.kind !== 'project') {
    return (
      <Page title="制作面板" width={760}>
        <EmptyState
          icon="conveyor_belt"
          title="这里只放工程的制作面板"
          desc={work ? '导入的作品只能游玩，没有制作过程。' : '作品不存在。'}
          actions={<Button variant="primary" onClick={() => navigate(work ? `/work/${work.id}` : '/')}>{work ? '回到作品' : '回到书库'}</Button>}
        />
      </Page>
    )
  }

  const vol = findVolume(work.volumeId)
  const ser = findSeries(work.seriesId)
  const pos = queue.findIndex((w) => w.id === work.id)
  const isHead = pos === 0
  const current = work.chapters.find((c) => c.status === 'producing')
  const attention = work.chapters.filter((c) => c.status === 'attention')

  // 顶栏全局控制：只有立即停止 / 继续制作，没有暂停；“更多”里放原型演示项
  const controls = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      {running ? (
        <Button variant="danger" icon="stop" onClick={() => setConfirmStop(true)}>立即停止</Button>
      ) : (
        <Button
          variant="primary"
          icon="play_arrow"
          disabled={!queue.length}
          onClick={() => {
            resume()
            toast('继续制作，被中断的任务会重做一遍', 'play_arrow')
          }}
        >
          继续制作
        </Button>
      )}
      <Dropdown
        trigger={
          <button title="更多" style={{ display: 'flex', padding: 7, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)' }}>
            <Icon name="more_vert" size={18} />
          </button>
        }
        items={[
          {
            label: '模拟异常退出',
            icon: 'warning',
            onClick: () => {
              simulateCrash()
              toast('已模拟异常退出后重新打开', 'warning')
            },
          },
        ]}
      />
    </span>
  )

  return (
    <Page
      eyebrow={`${ser.title} · 第${vol.index}卷`}
      title={`${work.title} · 制作`}
      subtitle={
        work.phase === 'preview'
          ? '全书预览与按卷综合进行中'
          : work.phase === 'done'
            ? '全部章节已发布'
            : isHead && running
              ? '这部作品正在制作'
              : pos > 0
                ? `在制作队列里排第 ${pos + 1} 位`
                : '未在队列中'
      }
      actions={controls}
    >
      {/* 崩溃恢复：异常退出后重开，制作保持停止，等创作者确认继续 */}
      {crashed ? (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <Banner
            kind="warning"
            icon="warning"
            action={
              <Button variant="primary" size="sm" icon="play_arrow" onClick={() => { resume(); toast('继续制作，被中断的任务会重做一遍', 'play_arrow') }}>
                继续制作
              </Button>
            }
          >
            上次异常退出，制作已停止
          </Banner>
        </div>
      ) : null}

      {/* 需要处理：同类问题合成一条横幅，重试在行内操作 */}
      {attention.length ? (
        <Banner
          kind="warning"
          icon="error"
          action={
            <Button variant="ghost" size="sm" icon="refresh" style={{ color: 'var(--color-on-error-container)' }} onClick={() => toast(`已重试 ${attention.length} 章`, 'refresh')}>
              全部重试
            </Button>
          }
        >
          {attention.length === 1
            ? `第 ${attention[0].index} 章「${attention[0].title}」需要处理：${attention[0].issue}`
            : `${attention.length} 章需要处理（第 ${attention.map((c) => c.index).join('、')} 章），逐章处理见下方列表`}
        </Banner>
      ) : null}

      {/* 当前状态 */}
      <Card style={{ padding: 'var(--space-5)', marginTop: attention.length && !crashed ? 'var(--space-5)' : 0 }}>
        {work.phase === 'preview' && work.previewProgress ? (
          <div>
            <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 'var(--space-3)' }}>
              当前阶段 · {work.previewProgress.stage}
            </div>
            <h3 className="headline" style={{ fontSize: 20, marginBottom: 'var(--space-3)' }}>
              已读 {work.previewProgress.done} / {work.previewProgress.total} 章
            </h3>
            <ProgressBar value={work.previewProgress.done / work.previewProgress.total} />
            <p style={{ marginTop: 'var(--space-3)', fontSize: 12, color: 'var(--color-outline)', lineHeight: 1.6 }}>
              全书预览完成后按卷综合，产出剧情骨架、设定集和术语表；第一卷理解完就可以开始制作。
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <Icon
              name={current ? 'sync' : work.phase === 'done' ? 'check_circle' : 'schedule'}
              size={24}
              style={{
                color: current ? 'var(--color-primary)' : 'var(--color-outline)',
                animation: current && running && isHead ? 'spin 4s linear infinite' : undefined,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 6 }}>当前章节</div>
              <h3 className="headline" style={{ fontSize: 20 }}>
                {work.phase === 'done' ? '全部章节已发布' : current ? `第 ${current.index} 章 · ${current.title}` : '等待下一个章节'}
                {current?.step ? <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-on-surface-variant)' }}>（{current.step}）</span> : null}
              </h3>
            </div>
            {pos > 0 ? <Chip>排在第 {pos + 1} 位</Chip> : isHead && running ? <Chip active>正在制作</Chip> : null}
          </div>
        )}
      </Card>

      {/* 章节列表（按卷分组；原型每部作品只有一卷） */}
      <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 'var(--space-4)', marginTop: 'var(--space-7)' }}>
        第{vol.index}卷 · {vol.title} · 共 {work.chapters.length} 章
      </div>
      <Card>
        {work.chapters.map((c, i) => (
          <ChapterRow
            key={c.id}
            work={work}
            chapter={c}
            last={i === work.chapters.length - 1}
            onOpenStale={setStaleChapter}
            onOpenRuns={setRunsChapter}
          />
        ))}
      </Card>

      {/* 过期图片抽屉 */}
      <Drawer open={staleChapter !== null} title={staleChapter ? `第 ${staleChapter.index} 章 · 过期图片` : ''} onClose={() => setStaleChapter(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {staleChapter
            ? staleImagesOf(staleChapter).map((img) => (
                <div key={img.id} className="glass-panel" style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                    <div style={{ width: 72, height: 72, borderRadius: 'var(--radius-md)', background: staleThumb, flexShrink: 0, border: '1px solid var(--divider)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{img.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-outline)', marginTop: 4 }}>{img.kind}</div>
                    </div>
                  </div>
                  {img.cascade ? (
                    <p style={{ marginTop: 'var(--space-3)', fontSize: 12, color: 'var(--color-on-surface-variant)', lineHeight: 1.6, display: 'flex', gap: 6 }}>
                      <Icon name="account_tree" size={15} style={{ flexShrink: 0, color: 'var(--color-outline)' }} />
                      {img.cascade}
                    </p>
                  ) : null}
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                    <Button variant="neu" size="sm" icon="refresh" onClick={() => toast(`已把「${img.label}」加入重画`, 'refresh')}>重画</Button>
                    <Button variant="ghost" size="sm" icon="keep" onClick={() => toast(`「${img.label}」保留旧图`)}>保留</Button>
                  </div>
                </div>
              ))
            : null}
        </div>
      </Drawer>

      {/* 运行记录：和 Agent 面板同一套显示（另一 Agent 实现） */}
      <RunRecordDrawer
        chapterTitle={runsChapter ? `第 ${runsChapter.index} 章 · ${runsChapter.title}` : ''}
        open={runsChapter !== null}
        onClose={() => setRunsChapter(null)}
      />

      <ConfirmDialog
        open={confirmStop}
        title="立即停止"
        message="取消排队任务并中断正在跑的请求，下次继续时重做被中断的部分。"
        confirmLabel="立即停止"
        danger
        onConfirm={() => {
          setConfirmStop(false)
          stop()
          toast('已立即停止', 'stop')
        }}
        onCancel={() => setConfirmStop(false)}
      />
    </Page>
  )
}

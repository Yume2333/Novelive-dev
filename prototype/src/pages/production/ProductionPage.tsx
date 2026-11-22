import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Card, ChapterStatusMark, ProgressBar } from '../../components/Card'
import { Banner, Chip, ConfirmDialog, Drawer, Tooltip } from '../../components/Extended'
import { EmptyState } from '../../components/Form'
import { Dropdown } from '../../components/Modal'
import { FlowRail, StatusBeacon } from '../../components/Motion'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { findSeries, findVolume, findWork } from '../../mock/library'
import { useProduction } from '../../mock/production'
import type { Chapter, ChapterStatus, Work } from '../../mock/types'
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

function ChapterRow({ work, chapter, prevChapter, isLive, remainingStale, last, onOpenStale, onOpenRuns }: {
  work: Work
  chapter: Chapter
  prevChapter?: Chapter
  isLive: boolean
  remainingStale: number
  last: boolean
  onOpenStale: (c: Chapter) => void
  onOpenRuns: (c: Chapter) => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const [priority, setPriority] = useState(!!chapter.priority)
  // 固定四步：写 → 审稿 → 演出 → 出图；写下一章时上一章在出图，两章可以同时是“制作中”；出图按张算（"出图 5/8"）
  const steps = ['写', '审稿', '演出', '出图']
  // step 形如 "出图 5/8"
  const stepIdx = Math.max(
    0,
    steps.findIndex((s) => chapter.step?.startsWith(s)),
  )
  const m = chapter.step?.match(/(\d+)\s*\/\s*(\d+)/)
  const frac = chapter.step ? (stepIdx + (m ? Math.min(1, Number(m[1]) / Math.max(1, Number(m[2]))) : 0)) / steps.length : 0
  const waitForPrev = chapter.status === 'waiting' && (priority || prevChapter?.status === 'producing')
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
        <span className="label-caps label-caps-zh" style={{ color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 10 }}>
          <Icon name="keyboard_double_arrow_up" size={13} /> 优先
        </span>
      ) : null}
      {waitForPrev ? (
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-outline)',
            background: 'var(--color-surface-container-high)',
            padding: '2px var(--space-2)',
            borderRadius: 'var(--radius-sm)',
            whiteSpace: 'nowrap',
          }}
        >
          等上一章
        </span>
      ) : null}
      {chapter.step ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 12, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>
          {steps.map((s, i) => {
            const isCurrent = i === stepIdx
            const isDone = i < stepIdx
            return (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                {i > 0 ? <Icon name="chevron_right" size={11} style={{ color: 'var(--color-outline)' }} /> : null}
                {isCurrent ? (
                  <span style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', fontWeight: 600 }}>
                    <span className={isLive ? 'ink-shimmer' : undefined} style={isLive ? undefined : { color: 'var(--color-primary)' }}>
                      {s}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: -3,
                        height: 2,
                        borderRadius: 'var(--radius-full)',
                        background: 'var(--color-primary)',
                      }}
                    />
                  </span>
                ) : (
                  <span
                    style={{
                      color: isDone ? 'var(--color-on-surface-variant)' : 'var(--color-outline)',
                      fontWeight: isDone ? 500 : 400,
                      opacity: isDone ? 1 : 0.55,
                    }}
                  >
                    {s}
                  </span>
                )}
              </span>
            )
          })}
          {m ? <span style={{ color: 'var(--color-on-surface-variant)' }}>· {chapter.step.slice(chapter.step.indexOf(m[0]))}</span> : null}
        </span>
      ) : null}
      {remainingStale > 0 ? (
        <button
          onClick={() => onOpenStale(chapter)}
          style={{ fontSize: 11, color: 'var(--color-on-surface-variant)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', padding: 0 }}
          title="查看过期图片"
        >
          <Icon name="broken_image" size={13} /> {remainingStale} 张图过期
        </button>
      ) : null}
      <span style={{ flex: 1 }} />
      {chapter.step ? (
        <span style={{ width: 72, flexShrink: 0 }}>
          <ProgressBar value={frac} height={4} active={chapter.status === 'producing' && isLive} />
        </span>
      ) : null}
      <span style={{ display: 'inline-flex', justifyContent: 'flex-end', flexShrink: 0 }}>
        {chapter.issue ? (
          <Tooltip text={chapter.issue}>
            <span style={{ display: 'inline-flex' }}>
              <ChapterStatusMark status={chapter.status} spin={chapter.status === 'producing' && isLive} attention />
            </span>
          </Tooltip>
        ) : (
          <ChapterStatusMark status={chapter.status} spin={chapter.status === 'producing' && isLive} />
        )}
      </span>
      <span className="row-actions" style={{ display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--space-1)', minWidth: 232, flexShrink: 0 }}>
        {chapter.status === 'published' ? (
          <Button variant="ghost" icon="play_arrow" size="sm" onClick={() => navigate(`/work/${work.id}/play`)}>游玩</Button>
        ) : null}
        {chapter.issue ? (
          <Button variant="ghost" icon="refresh" size="sm" onClick={() => toast(`已重试第 ${chapter.index} 章`, 'refresh')}>重试</Button>
        ) : null}
        {chapter.status === 'published' ? (
          <Button variant="ghost" icon="edit_note" size="sm" onClick={() => navigate(`/work/${work.id}/edit`)}>
            {chapter.issue ? '去编辑' : '编辑'}
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
  const [resolvedStale, setResolvedStale] = useState<Record<string, 'redrawing' | 'kept' | 'done'>>({})
  const staleTimersRef = useRef<number[]>([])
  const [confirmStop, setConfirmStop] = useState(false)
  const [runChapter, setRunChapter] = useState<{ title: string; status: ChapterStatus; step?: string } | null>(null)

  useEffect(() => () => {
    staleTimersRef.current.forEach((t) => window.clearTimeout(t))
  }, [])
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
  const writingChapter = work.chapters.find((c) => c.status === 'producing' && !c.step?.startsWith('出图'))
  const paintingChapter = work.chapters.find((c) => c.status === 'producing' && c.step?.startsWith('出图'))
  const current = writingChapter ?? paintingChapter
  const attention = work.chapters.filter((c) => c.issue)
  // 出图队列概况（假数据）：等待 9 张、正在画 5 张（上限来自设置的“同时出图数”）
  const imageQueue = { waiting: 9, painting: 5 }

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
      width={960}
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
      <Card style={{ padding: 'var(--space-5)', marginTop: attention.length && !crashed ? 'var(--space-5)' : 0, position: 'relative', overflow: 'hidden' }}>
        {work.phase === 'preview' && work.previewProgress ? (
          <div>
            <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <StatusBeacon tone={isHead && running ? 'active' : 'muted'} active={isHead && running} size={8} />
              当前阶段 · {work.previewProgress.stage}
            </div>
            <h3 className="headline" style={{ fontSize: 20, marginBottom: 'var(--space-3)' }}>
              已读 {work.previewProgress.done} / {work.previewProgress.total} 章
            </h3>
            <ProgressBar value={work.previewProgress.done / work.previewProgress.total} active={isHead && running} />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', paddingTop: 'var(--space-1)', flexShrink: 0 }}>
              <StatusBeacon
                tone={work.phase === 'done' ? 'success' : current && isHead && running ? 'active' : 'muted'}
                active={!!current && isHead && running}
                size={10}
              />
            </span>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 'var(--space-2)' }}>当前章节</div>
              {work.phase === 'done' ? (
                <h3 className="headline" style={{ fontSize: 20 }}>全部章节已发布</h3>
              ) : current ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  {paintingChapter ? (
                    <h3 className="headline" style={{ fontSize: 20 }}>
                      第 {paintingChapter.index} 章 · {paintingChapter.title}
                      <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-on-surface-variant)' }}>（{paintingChapter.step}）</span>
                    </h3>
                  ) : null}
                  {writingChapter ? (
                    <h3 className="headline" style={{ fontSize: 20 }}>
                      第 {writingChapter.index} 章 · {writingChapter.title}
                      <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-on-surface-variant)' }}>（{writingChapter.step ?? '写'}）</span>
                    </h3>
                  ) : null}
                  {paintingChapter ? (
                    <div style={{ fontSize: 12, color: 'var(--color-outline)', marginTop: 'var(--space-1)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <span>出图队列：等待 {imageQueue.waiting} 张 ·</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <StatusBeacon tone={isHead && running ? 'active' : 'muted'} active={isHead && running} size={6} />
                        <span className={isHead && running ? 'ink-shimmer' : undefined}>
                          正在画 {imageQueue.painting} 张
                        </span>
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <h3 className="headline" style={{ fontSize: 20 }}>等待下一个章节</h3>
              )}
            </div>
            {pos > 0 ? <Chip>排在第 {pos + 1} 位</Chip> : isHead && running ? <Chip active>正在制作</Chip> : null}
          </div>
        )}
        {work.phase !== 'done' ? (
          <FlowRail
            active={isHead && running}
            height={2}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: 0 }}
          />
        ) : null}
      </Card>

      {/* 章节列表（按卷分组；原型每部作品只有一卷） */}
      <div className="label-caps label-caps-zh" style={{ color: 'var(--color-outline)', marginBottom: 'var(--space-4)', marginTop: 'var(--space-7)' }}>
        第{vol.index}卷 · {vol.title} · 共 {work.chapters.length} 章
      </div>
      <Card>
        {work.chapters.map((c, i) => {
          const items = staleImagesOf(c)
          const remainingStale = items.filter((img) => resolvedStale[img.id] !== 'done' && resolvedStale[img.id] !== 'kept').length
          return (
            <ChapterRow
              key={c.id}
              work={work}
              chapter={c}
              prevChapter={i > 0 ? work.chapters[i - 1] : undefined}
              isLive={isHead && running}
              remainingStale={remainingStale}
              last={i === work.chapters.length - 1}
              onOpenStale={setStaleChapter}
              onOpenRuns={(ch) => setRunChapter({ title: `第 ${ch.index} 章 · ${ch.title}`, status: ch.status, step: ch.step })}
            />
          )
        })}
      </Card>

      {/* 过期图片抽屉 */}
      <Drawer open={staleChapter !== null} title={staleChapter ? `第 ${staleChapter.index} 章 · 过期图片` : ''} onClose={() => setStaleChapter(null)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {staleChapter
            ? staleImagesOf(staleChapter).map((img) => {
                const state = resolvedStale[img.id]
                const isRedrawing = state === 'redrawing'
                const isDone = state === 'done'
                const isKept = state === 'kept'
                return (
                  <div
                    key={img.id}
                    className="glass-panel"
                    style={{
                      borderRadius: 'var(--radius-lg)',
                      padding: 'var(--space-4)',
                      position: 'relative',
                      overflow: 'hidden',
                      opacity: isKept ? 0.68 : 1,
                      transition: 'opacity var(--dur-base) var(--ease-out)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                      <div style={{ width: 72, height: 72, borderRadius: 'var(--radius-md)', background: staleThumb, flexShrink: 0, border: '1px solid var(--divider)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{img.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-outline)', marginTop: 'var(--space-1)' }}>{img.kind}</div>
                        {isRedrawing ? (
                          <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                            <span className="ink-shimmer" style={{ fontSize: 12, fontWeight: 600 }}>重绘中…</span>
                            <FlowRail active height={2} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {img.cascade && !isDone && !isKept ? (
                      <p style={{ marginTop: 'var(--space-3)', fontSize: 12, color: 'var(--color-on-surface-variant)', lineHeight: 1.6, display: 'flex', gap: 'var(--space-2)' }}>
                        <Icon name="account_tree" size={15} style={{ flexShrink: 0, color: 'var(--color-outline)' }} />
                        {img.cascade}
                      </p>
                    ) : null}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                      {isDone ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 12, color: 'var(--color-success)', fontWeight: 600 }}>
                          <Icon name="check_circle" size={14} /> 已重画
                        </span>
                      ) : isKept ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 12, color: 'var(--color-outline)' }}>
                          <Icon name="keep" size={14} /> 已保留旧图
                        </span>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            icon="refresh"
                            loading={isRedrawing}
                            onClick={() => {
                              setResolvedStale((prev) => ({ ...prev, [img.id]: 'redrawing' }))
                              const timer = window.setTimeout(() => {
                                setResolvedStale((prev) => ({ ...prev, [img.id]: 'done' }))
                                toast(`「${img.label}」重画完成`, 'check_circle')
                              }, 1200)
                              staleTimersRef.current.push(timer)
                            }}
                          >
                            {isRedrawing ? '重绘中…' : '重画'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="keep"
                            disabled={isRedrawing}
                            onClick={() => {
                              setResolvedStale((prev) => ({ ...prev, [img.id]: 'kept' }))
                              toast(`「${img.label}」保留旧图`)
                            }}
                          >
                            保留
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })
            : null}
        </div>
      </Drawer>

      {/* 运行记录：和 Agent 面板同一套显示（另一 Agent 实现） */}
      <RunRecordDrawer
        chapterTitle={runChapter?.title ?? ''}
        chapterStatus={runChapter?.status}
        chapterStep={runChapter?.step}
        open={runChapter !== null}
        onClose={() => setRunChapter(null)}
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

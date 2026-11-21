import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Icon } from '../../components/Button'
import { Card, ProgressBar } from '../../components/Card'
import { Banner, Chip, ConfirmDialog } from '../../components/Extended'
import { EmptyState, Tabs } from '../../components/Form'
import { GradientCover } from '../../components/GradientCover'
import { Dropdown, Modal } from '../../components/Modal'
import { Page } from '../../components/Page'
import { useToast } from '../../components/Toast'
import { series, volumes, works } from '../../mock/library'
import type { Work } from '../../mock/types'

/** 每张卡只留一行短状态；详情（当前步骤）放进卡内安静的进度区 */
function statusLine(w: Work): { text: string; icon: string } {
  switch (w.phase) {
    case 'preview':
      return { text: '全书预览中', icon: 'autorenew' }
    case 'confirm-visual':
      return { text: '等你确认角色设定', icon: 'palette' }
    case 'confirm-first':
      return { text: '第一章等你过目', icon: 'rate_review' }
    case 'producing': {
      const published = w.chapters.filter((c) => c.status === 'published').length
      const attention = w.chapters.filter((c) => c.issue).length
      return { text: `已发布 ${published}/${w.chapters.length} 章${attention ? ` · ${attention} 需处理` : ''}`, icon: 'autorenew' }
    }
    case 'done':
      return { text: `全部 ${w.chapters.length} 章已发布`, icon: 'check_circle' }
    case 'imported':
      return { text: `共 ${w.chapters.length} 章`, icon: 'auto_stories' }
  }
}

const lineColor: Partial<Record<Work['phase'], string>> = {
  'confirm-visual': 'var(--color-on-error-container)',
  'confirm-first': 'var(--color-on-error-container)',
  done: 'var(--color-success)',
}

// ---- 封面 + 信息的作品卡 ----

function CoverBox({ work, badge }: { work: Work; badge?: ReactNode }) {
  return (
    <div style={{ position: 'relative', padding: 'var(--space-3)', paddingBottom: 0 }}>
      <div
        className="cover-tilt"
        style={{
          aspectRatio: '3 / 4',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--white-40)',
          boxShadow: 'var(--shadow-glass)',
        }}
      >
        <GradientCover work={work} />
      </div>
      {badge ? <div style={{ position: 'absolute', top: 20, right: 20 }}>{badge}</div> : null}
    </div>
  )
}

function CardBody({ work, menu }: { work: Work; menu?: ReactNode }) {
  const line = statusLine(work)
  const attention = work.chapters.some((c) => c.issue)
  const color = attention ? 'var(--color-on-error-container)' : lineColor[work.phase] ?? 'var(--color-on-surface-variant)'
  const published = work.chapters.filter((c) => c.status === 'published').length
  const producing = work.chapters.find((c) => c.status === 'producing')
  return (
    <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)', display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
        <div style={{ minWidth: 0 }}>
          <h4 className="headline" style={{ fontSize: 16, marginBottom: 2 }}>{work.title}</h4>
          <p style={{ fontSize: 12, color: 'var(--color-on-surface-variant)' }}>{work.author}</p>
        </div>
        {menu}
      </div>
      <div style={{ marginTop: 'auto', paddingTop: 'var(--space-4)' }}>
        <span
          className="label-caps label-caps-zh"
          style={{ display: 'flex', alignItems: 'center', gap: 6, color, fontSize: 11 }}
        >
          <Icon
            name={line.icon}
            size={14}
            style={work.phase === 'preview' || work.phase === 'producing' ? { animation: 'spin 4s linear infinite' } : undefined}
          />
          {line.text}
        </span>
        {work.phase === 'producing' ? (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <ProgressBar value={work.chapters.length ? published / work.chapters.length : 0} height={4} />
            {producing?.step ? (
              <div className="label-caps label-caps-zh" style={{ marginTop: 'var(--space-2)', fontSize: 10, color: 'var(--color-outline)' }}>
                第 {producing.index} 章 · {producing.step}
              </div>
            ) : null}
          </div>
        ) : null}
        {work.phase === 'preview' && work.previewProgress ? (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <ProgressBar value={work.previewProgress.done / work.previewProgress.total} height={4} />
            <div className="label-caps label-caps-zh" style={{ marginTop: 'var(--space-2)', fontSize: 10, color: 'var(--color-outline)' }}>
              {work.previewProgress.done}/{work.previewProgress.total} 章
            </div>
          </div>
        ) : null}
        {work.reading && work.phase !== 'producing' ? (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }} className="label-caps label-caps-zh">
              <span style={{ color: 'var(--color-on-surface-variant)', fontSize: 11 }}>
                读到第 {work.reading.chapter} 章
              </span>
              <span style={{ color: 'var(--color-primary)', fontSize: 11 }}>
                {Math.round(work.reading.progress * 100)}%
              </span>
            </div>
            <ProgressBar value={work.reading.progress} height={5} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

const menuBtn = (
  <button
    style={{ display: 'flex', padding: 5, borderRadius: 'var(--radius-full)', color: 'var(--color-on-surface-variant)', flexShrink: 0 }}
    title="更多"
  >
    <Icon name="more_horiz" size={19} />
  </button>
)

const cardGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-5)' }

// ---- 导入作品包时的检查弹窗（同一作品的新版本 → 替换） ----

interface ImportedPackage { title: string; author: string; version: number; sameId: string | null }

const demoPackage: ImportedPackage = { title: '星屑旅馆', author: '安溪', version: 4, sameId: 'xingxie' }

function ImportPackageModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const existing = demoPackage.sameId ? works.find((w) => w.id === demoPackage.sameId) : undefined
  return (
    <Modal
      open={open}
      title="导入作品包"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            icon="download"
            onClick={() => {
              onClose()
              toast(existing ? '已更新《星屑旅馆》到 v4，存档与已读记录已迁移' : '已导入《星屑旅馆》', 'download')
            }}
          >
            {existing ? '替换为 v4' : '导入'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <span className="neu-button" style={{ width: 44, height: 44, borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="deployed_code" size={21} />
          </span>
          <div>
            <div style={{ fontWeight: 700 }}>星屑旅馆.novelive</div>
            <div style={{ fontSize: 12, color: 'var(--color-on-surface-variant)' }}>
              {demoPackage.author} · 作品包 v{demoPackage.version} · 不含原文
            </div>
          </div>
        </div>
        {existing ? (
          <>
            <Banner kind="warning" icon="system_update_alt">
              书库里已有《{existing.title}》v{existing.version}，导入后会被 v{demoPackage.version} 替换。
            </Banner>
            <div style={{ fontSize: 13, color: 'var(--color-on-surface-variant)', lineHeight: 1.7 }}>
              存档和已读记录会按作品内 ID 自动迁移；对不上的旧存档会保留，在存档界面单独成组。
            </div>
          </>
        ) : (
          <Banner>检查完成：是一部新作品，可以直接导入。</Banner>
        )}
      </div>
    </Modal>
  )
}

// ---- 书库页 ----

export function LibraryPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<'projects' | 'imported'>('projects')
  const [previewEmpty, setPreviewEmpty] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [removeWork, setRemoveWork] = useState<Work | null>(null)

  const grouped = useMemo(
    () =>
      series
        .filter((s) => s.kind === 'project')
        .map((s) => ({
          s,
          vols: volumes
            .filter((v) => v.seriesId === s.id)
            .sort((a, b) => a.index - b.index)
            .map((v) => ({ v, ws: works.filter((w) => w.volumeId === v.id) })),
        })),
    [],
  )
  const imported = works.filter((w) => w.kind === 'imported')

  const emptyState = (
    <Card>
      <EmptyState
        icon="local_library"
        title="书库还是空的"
        desc="新建工程开始改编小说，或导入 .novelive 作品包直接游玩"
        actions={
          <>
            <Button variant="primary" icon="add" onClick={() => navigate('/import')}>新建工程</Button>
            <Button variant="neu" icon="upload_file" onClick={() => setImportOpen(true)}>导入作品包</Button>
          </>
        }
      />
      <div style={{ textAlign: 'center', paddingBottom: 'var(--space-6)' }}>
        <button
          className="label-caps label-caps-zh"
          style={{ color: 'var(--color-outline)', fontSize: 11 }}
          onClick={() => navigate('/welcome')}
        >
          重看首次引导 →
        </button>
      </div>
    </Card>
  )

  return (
    <Page
      title="书库"
      actions={
        <>
          <Button variant="neu" icon="upload_file" onClick={() => setImportOpen(true)}>
            导入作品包
          </Button>
          <Dropdown
            trigger={
              <Button variant="neu" icon="more_horiz" title="更多">
                更多
              </Button>
            }
            items={[
              {
                label: previewEmpty ? '关闭空书库预览' : '预览空书库',
                icon: previewEmpty ? 'visibility_off' : 'visibility',
                onClick: () => setPreviewEmpty((v) => !v),
              },
            ]}
          />
          <Button variant="primary" icon="add" onClick={() => navigate('/import')}>
            新建工程
          </Button>
        </>
      }
    >
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Tabs
          tabs={[
            { key: 'projects', label: '我的工程', icon: 'design_services' },
            { key: 'imported', label: '导入的作品', icon: 'deployed_code' },
          ]}
          active={tab}
          onChange={(k) => setTab(k as 'projects' | 'imported')}
        />
      </div>

      {previewEmpty ? (
        emptyState
      ) : tab === 'projects' ? (
        grouped.map(({ s, vols }) => (
          <section key={s.id} style={{ marginBottom: 'var(--space-7)' }}>
            <h3
              className="label-caps label-caps-zh"
              style={{ color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
            >
              <Icon name="collections_bookmark" size={15} />
              {s.title}
              <span style={{ color: 'var(--color-outline)', fontWeight: 400, textTransform: 'none', letterSpacing: 'normal' }}>· {s.folder}</span>
            </h3>
            {vols.map(({ v, ws }) => (
              <div key={v.id} style={{ marginTop: 'var(--space-5)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-on-surface-variant)', marginBottom: 'var(--space-4)' }}>
                  第 {v.index} 卷 · {v.title}
                </div>
                <div style={cardGrid}>
                  {ws.map((w) => (
                    <Card key={w.id} style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }} onClick={() => navigate(`/work/${w.id}`)}>
                      <CoverBox
                        work={w}
                        badge={
                          w.phase === 'confirm-visual' ? <Chip active>确认点 1</Chip>
                          : w.phase === 'confirm-first' ? <Chip active>确认点 2</Chip>
                          : undefined
                        }
                      />
                      <CardBody work={w} />
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      ) : (
        <div style={cardGrid}>
          {imported.map((w) => (
            <Card key={w.id} style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }} onClick={() => navigate(`/work/${w.id}`)}>
              <CoverBox
                work={w}
                badge={
                  <span
                    className="label-caps"
                    style={{
                      padding: '4px 9px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--veil-90)',
                      color: 'var(--color-primary)',
                      fontSize: 10,
                    }}
                  >
                    v{w.version}
                  </span>
                }
              />
              <CardBody
                work={w}
                menu={
                  <Dropdown
                    trigger={menuBtn}
                    items={[
                      {
                        label: '导入为工程',
                        icon: 'design_services',
                        onClick: () => toast('已作为新工程打开（演示）', 'design_services'),
                      },
                      { label: '移除', icon: 'delete', danger: true, onClick: () => setRemoveWork(w) },
                    ]}
                  />
                }
              />
            </Card>
          ))}
        </div>
      )}

      <ImportPackageModal open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={removeWork !== null}
        title="移除作品"
        message={`把《${removeWork?.title}》从书库移除？作品包文件不会被删除，之后可以重新导入。`}
        confirmLabel="移除"
        danger
        onConfirm={() => {
          toast(`已移除《${removeWork?.title}》（演示）`, 'delete')
          setRemoveWork(null)
        }}
        onCancel={() => setRemoveWork(null)}
      />
    </Page>
  )
}

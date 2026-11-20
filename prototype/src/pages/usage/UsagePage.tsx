import { useMemo, useState } from 'react'
import { Icon } from '../../components/Button'
import { Card } from '../../components/Card'
import { Tooltip } from '../../components/Extended'
import { CompactSelect, EmptyState, SectionLabel, TextInput } from '../../components/Form'
import { Page } from '../../components/Page'
import { works } from '../../mock/library'
import { listUsage, usageModels, usageRange, usageStages } from '../../mock/usage'

const fmt = new Intl.NumberFormat('zh-CN')

export function UsagePage() {
  const [workId, setWorkId] = useState('all')
  const [stage, setStage] = useState('all')
  const [model, setModel] = useState('all')
  const [byMonth, setByMonth] = useState(false)
  const range = usageRange(byMonth)
  const [from, setFrom] = useState(range.min)
  const [to, setTo] = useState(range.max)

  const data = useMemo(
    () => listUsage({ workId, stage, model, from, to, byMonth }, works),
    [workId, stage, model, from, to, byMonth],
  )

  const summary = data.totals()
  const maxDay = Math.max(1, ...data.days.map((d) => data.totals(() => true, d).calls))

  const workOptions = [{ value: 'all', label: '全部作品' }, ...works.filter((w) => w.kind === 'project').map((w) => ({ value: w.id, label: w.title }))]
  const stageOptions = [{ value: 'all', label: '全部阶段' }, ...usageStages.map((s) => ({ value: s, label: s }))]
  const modelOptions = [{ value: 'all', label: '全部模型' }, ...usageModels.map((m) => ({ value: m, label: m }))]
  const timeOptions = [
    { value: 'day', label: '按天' },
    { value: 'month', label: '按月' },
  ]

  const periodLabel = (d: string) => (byMonth ? `${d.replace('-', ' 年 ')} 月` : d.slice(5).replace('-', '/'))

  return (
    <Page
      title="用量统计"
      actions={
        <CompactSelect
          value={byMonth ? 'month' : 'day'}
          onChange={(v) => {
            const m = v === 'month'
            setByMonth(m)
            const r = usageRange(m)
            setFrom(r.min)
            setTo(r.max)
          }}
          options={timeOptions}
        />
      }
    >
      {/* 过滤：一行主条件，安静排开 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap',
          marginBottom: 'var(--space-6)',
        }}
      >
        <CompactSelect value={workId} onChange={setWorkId} options={workOptions} />
        <CompactSelect value={stage} onChange={setStage} options={stageOptions} />
        <CompactSelect value={model} onChange={setModel} options={modelOptions} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <TextInput value={from} onChange={setFrom} placeholder={byMonth ? 'YYYY-MM' : 'YYYY-MM-DD'} />
          <span style={{ color: 'var(--color-outline)', fontSize: 12 }}>到</span>
          <TextInput value={to} onChange={setTo} placeholder={byMonth ? 'YYYY-MM' : 'YYYY-MM-DD'} />
        </span>
        <Tooltip text="文本按字数，图片按张数">
          <Icon name="help" size={17} style={{ color: 'var(--color-outline)' }} />
        </Tooltip>
      </div>

      {data.days.length === 0 ? (
        <Card>
          <EmptyState icon="bar_chart" title="这段时间没有调用记录" desc="换个时间段或放宽过滤条件试试。" />
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-7)' }}>
            {[
              { label: '调用次数', value: fmt.format(summary.calls), icon: 'call_made' },
              { label: '文本量', value: `${fmt.format(Math.round(summary.chars / 1000))} 千字`, icon: 'article' },
              { label: '图片', value: `${fmt.format(summary.images)} 张`, icon: 'image' },
              {
                label: '参考金额',
                value: summary.cost !== null ? `¥ ${summary.cost.toFixed(2)}` : '没有单价',
                icon: 'payments',
                hint: summary.noPrice ? '部分调用拿不到单价，未计入' : undefined,
              },
            ].map((s) => (
              <Card key={s.label} style={{ padding: 'var(--space-5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-outline)', marginBottom: 10 }}>
                  <Icon name={s.icon} size={15} />
                  <span className="label-caps label-caps-zh">{s.label}</span>
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{s.value}</div>
                {s.hint ? <div style={{ fontSize: 11, color: 'var(--color-outline)', marginTop: 6 }}>{s.hint}</div> : null}
              </Card>
            ))}
          </div>

          {/* 图与表上下排开，各自占满宽度 */}
          <Card style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-7)' }}>
            <SectionLabel>{byMonth ? '各月调用量' : '各天调用量'}</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: byMonth ? 16 : 10, height: 180, padding: '8px 2px 0' }}>
              {data.days.map((d) => {
                const t = data.totals(() => true, d)
                return (
                  <div key={d} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--color-outline)' }}>{t.calls}</span>
                    <div style={{ width: '100%', maxWidth: 64, flex: 1, minHeight: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      <div
                        style={{
                          width: '100%',
                          height: `${Math.max(4, (t.calls / maxDay) * 100)}%`,
                          borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                          background: 'var(--color-primary)',
                          opacity: 0.9,
                        }}
                        title={`${periodLabel(d)} · ${t.calls} 次`}
                      />
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--color-outline)', whiteSpace: 'nowrap' }}>{periodLabel(d)}</span>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card style={{ padding: 'var(--space-5)' }}>
            <SectionLabel>按作品 × 阶段</SectionLabel>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--color-outline)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>作品</th>
                  {data.stages.map((s) => (
                    <th key={s} style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>{s}</th>
                  ))}
                  <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>参考金额</th>
                </tr>
              </thead>
              <tbody>
                {data.workIds.map((wid) => {
                  const rowTotal = data.totals((b) => b.workId === wid)
                  return (
                    <tr key={wid} style={{ borderTop: '1px solid var(--divider)' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 600 }}>{data.titles.get(wid)}</td>
                      {data.stages.map((s) => {
                        const cell = data.totals((b) => b.workId === wid, undefined, s)
                        return (
                          <td key={s} style={{ padding: '12px 10px', textAlign: 'right' }}>
                            {cell.calls ? (
                              <span>
                                {fmt.format(cell.calls)} 次
                                {cell.images ? ` · ${fmt.format(cell.images)} 张` : ''}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-outline)' }}>—</span>
                            )}
                          </td>
                        )
                      })}
                      <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                        {rowTotal.cost !== null ? `¥ ${rowTotal.cost.toFixed(2)}` : <span style={{ color: 'var(--color-outline)' }}>没有单价</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Page>
  )
}

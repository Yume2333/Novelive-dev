import type { CommandOutput } from '@novelive/creator/contract'
import { BarChart3, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Collapse } from '../../components/Collapse'
import { EmptyState, Page } from '../../components/Page'
import styles from './UsagePage.module.css'

export function UsagePage() {
	const [showExplanation, setShowExplanation] = useState(false)
	const [data, setData] = useState<CommandOutput<'usage.list'>>()
	const [error, setError] = useState('')
	useEffect(() => {
		let active = true
		let request:
			| ReturnType<typeof window.novelive.call<'usage.list'>>
			| undefined
		function load() {
			request?.cancel()
			request = window.novelive.call('usage.list', {})
			request.promise.then(
				(value) => {
					if (active) {
						setData(value)
						setError('')
					}
				},
				() => {
					if (active) setError('无法读取用量记录')
				},
			)
		}
		const off = window.novelive.on('creator.ready', load)
		load()
		return () => {
			active = false
			off()
			request?.cancel()
		}
	}, [])
	const text =
		data?.records
			.map(({ usage }) => usage)
			.filter((record) => record.kind === 'text') ?? []
	const images =
		data?.records
			.map(({ usage }) => usage)
			.filter((record) => record.kind === 'image') ?? []
	return (
		<Page title="用量">
			<div className={styles.content}>
				<div>
					<button
						type="button"
						className={styles.disclosure}
						aria-expanded={showExplanation}
						onClick={() => setShowExplanation((open) => !open)}
					>
						<ChevronDown size={16} aria-hidden="true" />
						用量说明
					</button>
					<Collapse open={showExplanation}>
						仅供参考，统计已发生的调用；不估算费用，不设预算或自动停机。风格变更仅提示，不自动标记图片过期。
					</Collapse>
				</div>
				{error && <p role="alert">{error}</p>}
				{!data && !error && <p role="status">正在读取用量</p>}
				{data && (
					<>
						{data.unreadableProjects.length > 0 && (
							<section role="alert" aria-label="部分项目无法读取">
								<h2>部分项目无法读取</h2>
								<p>以下项目未计入统计，其他项目的记录仍然显示。</p>
								<ul>
									{data.unreadableProjects.map((project) => (
										<li key={project.projectId}>
											{project.projectId}：{project.reason}
										</li>
									))}
								</ul>
							</section>
						)}
						<dl className={styles.totals}>
							<div>
								<dt>文本输入 tokens</dt>
								<dd>
									{text
										.reduce((n, row) => n + row.inputTokens, 0)
										.toLocaleString()}
								</dd>
							</div>
							<div>
								<dt>文本输出 tokens</dt>
								<dd>
									{text
										.reduce((n, row) => n + row.outputTokens, 0)
										.toLocaleString()}
								</dd>
							</div>
							<div>
								<dt>图片数量</dt>
								<dd>
									{images
										.reduce((n, row) => n + row.imageCount, 0)
										.toLocaleString()}
								</dd>
							</div>
						</dl>
						{!data.records.length ? (
							<EmptyState icon={BarChart3} text="暂无用量记录" />
						) : (
							<section aria-label="已发生用量" className={styles.list}>
								{data.records.map(({ id, usage: record }) => (
									<article className={styles.row} key={id}>
										<strong>{record.model}</strong>
										<span>{record.link.workId}</span>
										<span>
											{record.link.volumeId} · {record.phase}
										</span>
										<time>{new Date(record.at).toLocaleString()}</time>
										<span>
											{record.kind === 'image'
												? `${record.imageCount} 张图片`
												: `输入 ${record.inputTokens} / 输出 ${record.outputTokens} · 缓存读取 ${record.cacheReadTokens} / 写入 ${record.cacheWriteTokens}`}
										</span>
									</article>
								))}
							</section>
						)}
						<section aria-label="过期素材">
							<h2>过期素材</h2>
							{!data.staleAssets.length ? (
								<p>暂无过期素材</p>
							) : (
								<ul className={styles.list}>
									{data.staleAssets.map((asset) => (
										<li
											className={styles.row}
											key={`${asset.workId}/${asset.assetKey}`}
										>
											<span>{asset.assetKey}</span>
											<span>{asset.workId}</span>
										</li>
									))}
								</ul>
							)}
						</section>
					</>
				)}
			</div>
		</Page>
	)
}

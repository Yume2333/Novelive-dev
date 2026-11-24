import type { CommandOutput, ConfigUpdate } from '@novelive/creator/contract'
import { BookOpen, Info, PlayCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { localeNames, locales, scoped, setLocale } from '../../i18n'
import { productionRoutes } from '../../routes/production'
import markLight from '../../shell/brand/novelive-mark.svg'
import markDark from '../../shell/brand/novelive-mark-dark.svg'
import { ModelCards } from '../settings/SettingsPage'
import styles from './WelcomePage.module.css'

const t = scoped('welcome')
const steps = 3

function Dots({ current }: { current: number }) {
	return (
		<div className={styles.dots} aria-hidden="true">
			{Array.from({ length: steps }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed step list
				<span key={i} data-active={i === current} />
			))}
		</div>
	)
}

export function WelcomePage() {
	const navigate = useNavigate()
	const [step, setStep] = useState(0)
	const [path, setPath] = useState<'create' | 'play'>('create')
	const [config, setConfig] = useState<CommandOutput<'config.get'>>()
	const language = config && 'language' in config ? config.language : undefined

	useEffect(() => {
		let active = true
		const load = () =>
			void window.novelive.call('config.get', {}).promise.then(
				(saved) => {
					if (active) setConfig(saved)
				},
				() => {},
			)
		const off = window.novelive.on('creator.ready', load)
		void window.novelive.host.appState().then(
			(state) => {
				if (state.creator === 'ready') load()
			},
			() => {},
		)
		return () => {
			active = false
			off()
		}
	}, [])
	const update = useCallback(async (patch: ConfigUpdate) => {
		const saved = await window.novelive.call('config.update', patch).promise
		setConfig(saved)
		return saved
	}, [])
	const finish = () =>
		navigate(path === 'create' ? productionRoutes.import : '/')

	return (
		<main className={styles.page}>
			<div className={styles.brand}>
				<img
					className="brand-mark-light"
					src={markLight}
					alt=""
					width={28}
					height={28}
				/>
				<img
					className="brand-mark-dark"
					src={markDark}
					alt=""
					width={28}
					height={28}
				/>
				<span>NOVELIVE</span>
			</div>
			{step === 0 && (
				<section className={`glass-panel ${styles.card}`} key={0}>
					<Dots current={0} />
					<h1 className="headline">{t('欢迎使用 Novelive')}</h1>
					<fieldset className={styles.languages}>
						<legend className="label-caps label-caps-zh">
							{t('界面语言')}
						</legend>
						<div>
							{locales.map((locale) => (
								<label key={locale} className={styles.radio}>
									<input
										type="radio"
										name="language"
										checked={
											(language ?? document.documentElement.lang) === locale
										}
										onChange={() => {
											setLocale(locale)
											if (config && 'language' in config)
												void update({ language: locale }).catch(() => {})
										}}
									/>
									{localeNames[locale]}
								</label>
							))}
						</div>
					</fieldset>
					<div className={styles.footer}>
						<span />
						<Button variant="primary" onClick={() => setStep(1)}>
							{t('继续')}
						</Button>
					</div>
				</section>
			)}
			{step === 1 && (
				<section className={`glass-panel ${styles.card}`} key={1}>
					<Dots current={1} />
					<h1 className="headline">{t('创作还是游玩')}</h1>
					<div className={styles.paths}>
						{(
							[
								['create', BookOpen, t('创作'), t('导入原文，改编成视觉小说')],
								[
									'play',
									PlayCircle,
									t('游玩'),
									t('导入 .novelive 作品包直接玩'),
								],
							] as const
						).map(([key, Icon, title, desc]) => (
							<button
								key={key}
								type="button"
								aria-pressed={path === key}
								className={styles.path}
								onClick={() => setPath(key)}
							>
								<span className={`glass-panel ${styles.pathIcon}`}>
									<Icon size={19} aria-hidden="true" />
								</span>
								<strong>{title}</strong>
								<span>{desc}</span>
							</button>
						))}
					</div>
					<div className={styles.footer}>
						<Button variant="ghost" onClick={() => setStep(0)}>
							{t('上一步')}
						</Button>
						<Button variant="primary" onClick={() => setStep(2)}>
							{t('继续')}
						</Button>
					</div>
				</section>
			)}
			{step === 2 && (
				<section className={`glass-panel ${styles.card}`} key={2}>
					<Dots current={2} />
					<div className={styles.modelTitle}>
						<h1 className="headline">{t('模型配置')}</h1>
						<span title={t('Key 只保存在本机配置文件中')}>
							<Info size={15} aria-label={t('Key 只保存在本机配置文件中')} />
						</span>
					</div>
					{path === 'play' && (
						<p className={styles.banner}>
							<PlayCircle size={16} aria-hidden="true" />
							{t(
								'已选「游玩」路线：模型配置为可选项，可直接跳过前往书库导入 .novelive 作品包。',
							)}
						</p>
					)}
					{config && 'models' in config ? (
						<ModelCards models={config.models} update={update} />
					) : (
						<p role="status" className={styles.muted}>
							{t('正在读取设置…')}
						</p>
					)}
					<div className={styles.footer}>
						<Button variant="ghost" onClick={() => setStep(1)}>
							{t('上一步')}
						</Button>
						<div className={styles.footerActions}>
							<Button variant="ghost" onClick={() => navigate('/')}>
								{t('跳过')}
							</Button>
							<Button variant="primary" onClick={finish}>
								{t('完成，进入书库')}
							</Button>
						</div>
					</div>
				</section>
			)}
		</main>
	)
}

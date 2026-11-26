import type { CommandOutput, ConfigUpdate } from '@novelive/creator/contract'
import { BookOpen, Info, LibraryBig, PlayCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Banner, RadioGroup, Stepper, Tooltip } from '../../components/Extended'
import { LoadingState } from '../../components/Feedback'
import { ScrollArea } from '../../components/ScrollArea'
import { useToast } from '../../components/Toast'
import {
	type Locale,
	localeNames,
	locales,
	scoped,
	setLocale,
} from '../../i18n'
import { useAppearance } from '../../shell/appearance'
import markLight from '../../shell/brand/novelive-mark.svg'
import markDark from '../../shell/brand/novelive-mark-dark.svg'
import { WelcomeModels } from './WelcomeModels'
import styles from './WelcomePage.module.css'

const t = scoped('welcome')

function Steps({ current }: { current: number }) {
	return (
		<Stepper
			className={styles.steps}
			steps={[t('界面语言'), t('创作还是游玩'), t('模型配置')]}
			current={current}
		/>
	)
}

export function WelcomePage() {
	useTranslation('welcome')
	const navigate = useNavigate()
	const toast = useToast()
	const [step, setStep] = useState(0)
	const [path, setPath] = useState<'create' | 'play'>('create')
	const [config, setConfig] = useState<CommandOutput<'config.get'>>()
	const { language } = useAppearance(config)

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
	const finish = () => navigate(path === 'create' ? '/' : '/?tab=imported')
	const enterLibrary = () => {
		toast(t('已进入书库'), LibraryBig)
		finish()
	}

	return (
		<ScrollArea className={styles.scroll}>
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
						<Steps current={0} />
						<h1 className="headline">{t('欢迎使用 Novelive')}</h1>
						<fieldset className={styles.languages}>
							<legend className="label-caps label-caps-zh">
								{t('界面语言')}
							</legend>
							<RadioGroup
								name="language"
								value={(language ?? document.documentElement.lang) as Locale}
								options={locales.map((locale) => ({
									value: locale,
									label: localeNames[locale],
								}))}
								onChange={(locale) => {
									setLocale(locale)
									if (config && 'language' in config)
										void update({ language: locale }).catch(() => {})
								}}
							/>
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
						<Steps current={1} />
						<h1 className="headline">{t('创作还是游玩')}</h1>
						<div className={styles.paths}>
							{(
								[
									[
										'create',
										BookOpen,
										t('创作'),
										t('导入原文，改编成视觉小说'),
									],
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
										<Icon size={19} strokeWidth={1.8} aria-hidden="true" />
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
						<Steps current={2} />
						<div className={styles.modelTitle}>
							<h1 className="headline">{t('模型配置')}</h1>
							<Tooltip text={t('Key 只保存在本机配置文件中')}>
								<Info size={15} strokeWidth={1.8} aria-hidden="true" />
							</Tooltip>
						</div>
						<p className={styles.modelIntro}>
							{t(
								'文字模型负责写作、审稿与视觉分析，图片模型负责绘制场景与立绘。',
							)}
						</p>
						{path === 'play' && (
							<div className={styles.playerNotice}>
								<Banner kind="info" icon={PlayCircle}>
									{t(
										'已选「游玩」路线：模型配置为可选项，可直接跳过前往书库导入 .novelive 作品包。',
									)}
								</Banner>
							</div>
						)}
						{config && 'models' in config ? (
							<WelcomeModels
								models={config.models}
								update={update}
								onDone={enterLibrary}
							/>
						) : (
							<LoadingState text={t('正在读取设置…')} />
						)}
						<div className={styles.footer}>
							<Button variant="ghost" onClick={() => setStep(1)}>
								{t('上一步')}
							</Button>
							<div className={styles.footerActions}>
								<Button variant="ghost" onClick={finish}>
									{t('跳过')}
								</Button>
								<Button
									variant="primary"
									type="submit"
									form="welcome-model-config"
									disabled={!config || !('models' in config)}
								>
									{t('完成，进入书库')}
								</Button>
							</div>
						</div>
					</section>
				)}
			</main>
		</ScrollArea>
	)
}

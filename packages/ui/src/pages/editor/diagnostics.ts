import { formatAssetLabel } from '../../format/asset'
import { formatParagraphLabel } from '../../format/chapter'
import { scoped } from '../../i18n'
import {
	type AssetLabelInfo,
	type SpeakerNames,
	speakerDisplayName,
} from './display'

const t = scoped('editor')

export interface DiagnosticInput {
	code: string
	line: number
	col: number
	message: string
	hint?: string
}

/** `ada/uniform/neutral`、`room/dusk` 形的资产键（段内不含空白与冒号）。 */
const assetKeyPattern = /[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*){1,2}/g

/** `p0007` 形的原文段落 id。 */
const paragraphIdPattern = /\bp(\d+)\b/g

function humanizeIds(text: string): string {
	return text.replace(paragraphIdPattern, (raw, digits) => {
		const label = formatParagraphLabel(Number.parseInt(digits, 10))
		return label || raw
	})
}

/**
 * 逐条诊断的消息与提示改写。返回的 hint 为空串表示这条提示
 * 充满术语（`ID`、`as 后`）、对创作者不可操作，直接舍弃。
 */
function humanizeMessage(
	diagnostic: DiagnosticInput,
	ctx: { speakerNames: SpeakerNames; assetInfo: AssetLabelInfo },
): { message: string; hint: string } {
	const { message, code } = diagnostic
	const hint = diagnostic.hint?.trim() ?? ''
	if (code === 'E_SPEAKER') {
		const speaker = message.replace(/^设定集没有角色：/, '')
		if (speaker !== message)
			return {
				message: t('设定集没有角色：{{name}}', {
					name: speakerDisplayName(ctx.speakerNames, speaker),
				}),
				// 原提示讲「角色 ID」「as 后」的内部写法，换成创作者可操作的说法。
				hint: t(
					'改成设定集里已有的角色；要显示别的名字，请在编辑器里填显示名。',
				),
			}
	}
	if (code === 'E_STAGE') {
		const target = message.replace(/^舞台上找不到 /, '')
		if (target !== message)
			return {
				message: t('舞台上找不到 {{name}}', {
					name: speakerDisplayName(ctx.speakerNames, target),
				}),
				hint: t('先让这个角色登场，再切换造型或表情。'),
			}
	}
	if (code === 'E_ASSET') {
		const key = message.replace(/^未登记、歧义或类型错误的素材：/, '')
		if (key !== message)
			return {
				message: t('未登记、歧义或类型错误的素材：{{name}}', {
					name: formatAssetLabel(key, ctx.assetInfo),
				}),
				// 原提示讲素材登记的内部 ID，换成素材登记表的说法。
				hint: t('改用素材登记表里已有的素材。'),
			}
	}
	if (code === 'E_ID' || code === 'E_DUPLICATE_ID') {
		// `无效句子 ID：#a3f9` / `重复句子 ID：#a3f9` —— 不渲染 #hex 与「ID」。
		if (/^无效句子 ID：/.test(message))
			return {
				message: t('这一句的句末标记无效'),
				hint: t('请不要手改句末的标记；保存时会自动分配。'),
			}
		if (/^重复句子 ID：/.test(message))
			return {
				message: t('这一句的句末标记与另一句重复'),
				hint: t('请不要手改句末的标记；保存时会自动分配。'),
			}
	}
	if (code === 'E_COMMAND') {
		// `未知指令：@foo` —— 去掉 `@` 语法回声。
		const name = message.replace(/^未知指令：@/, '')
		if (name !== message)
			return {
				message: t('无法识别的指令：{{name}}', { name }),
				hint,
			}
	}
	if (code === 'E_TAG') {
		// `无效行内标签：{em}` / `标签 {em} 未关闭。` —— 去掉花括号语法回声。
		const invalid = message.replace(/^无效行内标签：\{(.+)\}$/, '$1')
		if (invalid !== message)
			return {
				message: t('无法识别的文字标记：{{name}}', { name: invalid }),
				hint,
			}
		const unclosed = message.replace(/^标签 \{(.+)\} 未关闭。$/, '$1')
		if (unclosed !== message)
			return {
				message: t('文字标记「{{name}}」没有关闭', { name: unclosed }),
				hint: t('补上对应的结束标记。'),
			}
	}
	// 其余诊断消息本身已是中文；替换其中可能出现的资产键与段落 id。
	return {
		message: humanizeIds(
			message.replace(assetKeyPattern, (key) =>
				formatAssetLabel(key, ctx.assetInfo),
			),
		),
		hint,
	}
}

/**
 * 编译诊断的人性化：一条一行，不含 `E_*` 错误码、`#` 十六进制、
 * `@指令` 与 `{标签}` 语法回声；角色 id 换成设定集角色名，资产键换成
 * 素材标签，段落 id 换成「第 N 段」；含术语的提示整条舍弃，
 * 其余提示用空格接在句末。最多 5 条，多余的用「…另有 N 条」收尾。
 */
export function humanizeDiagnostics(
	diagnostics: readonly DiagnosticInput[],
	ctx: { speakerNames: SpeakerNames; assetInfo: AssetLabelInfo },
): string {
	const lines: string[] = []
	const shown = diagnostics.slice(0, 5)
	for (const diagnostic of shown) {
		const { message, hint } = humanizeMessage(diagnostic, ctx)
		const line = humanizeIds(hint ? `${message} ${hint}` : message)
		lines.push(line)
	}
	const rest = diagnostics.length - shown.length
	if (rest > 0) lines.push(t('…另有 {{count}} 条', { count: rest }))
	return lines.join('\n')
}

/**
 * 诊断的原始文本（`第 N 行：message`），不截断、不改写；
 * 只放进折叠的「详细信息」里，供排查时对照剧本文本行号。
 */
export function rawDiagnosticsText(
	diagnostics: readonly DiagnosticInput[],
): string {
	return diagnostics
		.map((diagnostic) => {
			const base = t('第 {{line}} 行：{{message}}', {
				line: diagnostic.line,
				message: diagnostic.message,
			})
			return diagnostic.hint ? `${base} ${diagnostic.hint}` : base
		})
		.join('\n')
}

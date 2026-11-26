import type {
	CommandError,
	ImportErrorCode,
	IssueKind,
	ProjectErrorCode,
	ShareErrorCode,
} from '@novelive/creator/contract'
import { msg, scoped } from '../i18n'

const t = scoped('format')

/**
 * 后端错误（kind / code / Error）→ 创作者能看懂的一句话。
 * message 是给用户看的本地化句子；hint 是可选的恢复建议；
 * detail 是原始技术细节，只放进折叠的「详细信息」里。
 * 查不到的输入一律退回通用句子，绝不把英文原文或枚举值当正文。
 */

export interface HumanizedError {
	message: string
	hint?: string
	detail?: string
}

type AnyCode =
	| IssueKind
	| ProjectErrorCode
	| ImportErrorCode
	| ShareErrorCode
	| CommandError['code']

type Entry = { message: string; hint?: string; countMessage?: string }

// 新增 kind/code 时此处会类型报错，必须补上本地化文案。
const table: Record<AnyCode, Entry> = {
	// 模型错误（issueKinds）
	network: { message: msg('无法连接模型服务，请检查网络后重试。') },
	auth: { message: msg('无法通过模型服务的验证，请检查设置中的密钥。') },
	not_found: {
		message: msg('无法找到所选模型，请在设置中检查模型配置。'),
	},
	moderation: {
		message: msg('模型拒绝了这段内容，无法继续生成。'),
		hint: msg('调整相关文字或画面后重试。'),
	},
	invalid_config: {
		message: msg('模型请求的配置无效，请在设置中检查模型参数。'),
	},
	reasoning_limit: { message: msg('模型没能给出正文结果，请重试。') },
	cancelled: { message: msg('操作已取消。') },
	internal: { message: msg('模型返回了无法理解的回复，请重试。') },
	unknown: { message: msg('无法完成操作，请重试。') },
	// 调度错误（issueKinds）
	budget_paused: {
		message: msg('制作花费达到预算上限，已暂停。'),
		hint: msg('提高预算上限或更换模型后可继续制作。'),
	},
	portrait_framing: {
		message: msg('生成的立绘构图不符合要求，请重试出图。'),
	},
	matting_unavailable: {
		message: msg('无法把立绘处理成透明底。'),
		countMessage: msg('无法把 {{count}} 张立绘处理成透明底。'),
		hint: msg('在设置中检查图像模型后重试。'),
	},
	placeholder: {
		message: msg('无法生成图像，已先用占位图代替。'),
		countMessage: msg('无法生成 {{count}} 张图像，已先用占位图代替。'),
		hint: msg('稍后重试出图即可替换。'),
	},
	// 工程错误（projectErrorCodes）
	invalid_document: {
		message: msg('无法读取这个工程，内容不完整或已损坏。'),
	},
	unsupported_format: { message: msg('无法打开文件，格式不受支持。') },
	unsupported_reader: {
		message: msg('无法打开，这个文件需要更新版本的 Novelive。'),
		hint: msg('请升级 Novelive 后再试。'),
	},
	unsupported_database: {
		message: msg('无法打开，这个工程的数据需要更新版本的 Novelive。'),
		hint: msg('请升级 Novelive 后再试。'),
	},
	// 导入错误（importErrorCodes）
	invalid_epub: { message: msg('无法读取这份 EPUB。') },
	epub_encrypted: {
		message: msg('无法导入，这份 EPUB 有加密保护。'),
	},
	epub_limit_exceeded: {
		message: msg('这份 EPUB 太大或太复杂，无法导入。'),
	},
	epub_doctype: { message: msg('这份 EPUB 的格式不受支持，无法导入。') },
	epub_no_text: { message: msg('这份 EPUB 里没有可导入的正文。') },
	illustration_mismatch: {
		message: msg('插图与正文的对应关系不一致，无法导入。'),
	},
	invalid_docx: { message: msg('无法读取这份 DOCX，文件可能已损坏。') },
	missing_document: { message: msg('这份 DOCX 缺少正文，无法导入。') },
	invalid_xml: { message: msg('无法读取这份文件，内容结构不完整。') },
	docx_doctype: { message: msg('这份 DOCX 的格式不受支持，无法导入。') },
	no_extractable_text: { message: msg('这份文件里没有可提取的正文。') },
	invalid_pdf: { message: msg('无法读取这份 PDF，文件可能已损坏。') },
	markdown_encoding: {
		message: msg('无法按所选编码读取这份 Markdown。'),
		hint: msg('换一种编码后重试。'),
	},
	no_body_text: { message: msg('这份文件里没有可导入的正文。') },
	txt_encoding_unknown: {
		message: msg('无法识别这份文本文件的编码，请手动选择。'),
	},
	txt_decoding_failed: {
		message: msg('无法按所选编码读取这份文本文件。'),
		hint: msg('换一种编码后重试。'),
	},
	project_not_empty: {
		message: msg('无法导入，当前工程已有内容。'),
		hint: msg('请在空工程里导入文本文件。'),
	},
	invalid_layout: {
		message: msg('章节划分有问题，无法导入。'),
		hint: msg('请检查分卷与章节的设置。'),
	},
	unsupported_source_format: {
		message: msg('无法导入这种格式的原文文件。'),
	},
	unsupported_reference_format: {
		message: msg('无法使用这种格式的参考图。'),
	},
	reference_limit: { message: msg('无法导入，参考图数量超出上限。') },
	unknown_encoding: { message: msg('无法识别原文的编码。') },
	invalid_illustration_selection: {
		message: msg('无法按所选插图导入，请重新选择。'),
	},
	relayout_volume_added: {
		message: msg('无法按当前的分卷加入已有系列。'),
		hint: msg('请调整分卷设置。'),
	},
	project_folder_exists: {
		message: msg('无法创建工程文件夹，同名文件夹已存在。'),
		hint: msg('请换一个位置或作品名。'),
	},
	invalid_join_target: {
		message: msg('无法加入，所选文件夹不是有效的工程。'),
	},
	join_series_missing: {
		message: msg('无法加入，所选系列不存在，请重新选择工程。'),
	},
	join_series_invalid: {
		message: msg('无法加入，这个工程的系列数据已损坏。'),
	},
	join_target_missing: { message: msg('无法加入，找不到所选工程文件夹。') },
	join_references_unsupported: {
		message: msg('加入已有系列时不能添加参考图。'),
	},
	join_no_text: { message: msg('原文里没有正文，无法加入系列。') },
	join_empty_sections: {
		message: msg('无法加入，原文里有缺少正文的卷或章节。'),
	},
	// 作品包导出／导入错误（shareErrorCodes）
	corrupt_package: { message: msg('无法读取这个作品包，文件已损坏。') },
	write_failed: {
		message: msg('无法写入文件，请检查磁盘空间和文件夹权限。'),
	},
	stale_import: { message: msg('作品包或所选范围已变化，请重新检查。') },
	invalid_selection: {
		message: msg('无法继续，所选的作品范围无效，请重新选择。'),
	},
	// 其余命令错误码
	unsupported: { message: msg('无法完成此操作，当前版本不支持。') },
	context_limit: {
		message: msg('无法处理，这一章的内容超出了模型一次能处理的长度。'),
		hint: msg('把这章拆短一些，或在设置中换用能处理更长内容的模型。'),
	},
	stale_revision: {
		message: msg('内容刚在别处更新过，请刷新后重试。'),
	},
	creator_down: { message: msg('无法连接创作端，请重试。') },
}

const fallback: Entry = { message: msg('无法完成操作，请重试。') }

const prefixedCode = /^\[([a-z_]+)\]\s*(.*)$/i

function entryFor(code: string): Entry | undefined {
	return (table as Record<string, Entry | undefined>)[code]
}

function render(entry: Entry, detail?: string, count?: number): HumanizedError {
	const hint = entry.hint ? t(entry.hint) : undefined
	const trimmed = detail?.trim()
	const countKey =
		count !== undefined && count >= 1 ? entry.countMessage : undefined
	return {
		message: countKey ? t(countKey, { count }) : t(entry.message),
		...(hint ? { hint } : {}),
		...(trimmed ? { detail: trimmed } : {}),
	}
}

/**
 * 统一入口：接受 issue kind、错误码字符串、`{ kind, detail }`、
 * `{ code, message }`（命令错误／作品包错误／导入失败）或 Error。
 * Error 会尝试解析遗留的 `[code] …` 前缀；都不认识时退回通用文案，
 * 原始文本只进 detail。
 */
export function humanizeError(input: unknown): HumanizedError {
	if (typeof input === 'string') {
		const entry = entryFor(input)
		return entry ? render(entry) : render(fallback, input)
	}
	if (input && typeof input === 'object') {
		const record = input as {
			kind?: unknown
			code?: unknown
			detail?: unknown
			message?: unknown
			count?: unknown
		}
		const detail =
			typeof record.detail === 'string'
				? record.detail
				: typeof record.message === 'string'
					? record.message
					: undefined
		const count =
			typeof record.count === 'number' && Number.isFinite(record.count)
				? record.count
				: undefined
		if (typeof record.kind === 'string') {
			const entry = entryFor(record.kind)
			if (entry) return render(entry, detail, count)
		}
		if (typeof record.code === 'string') {
			const entry = entryFor(record.code)
			if (entry) return render(entry, detail, count)
		}
		if (input instanceof Error) {
			const match = prefixedCode.exec(input.message)
			if (match) {
				const entry = entryFor(match[1].toLowerCase())
				if (entry) return render(entry, match[2] || undefined)
			}
		}
		return render(fallback, detail)
	}
	return render(fallback)
}

/**
 * 把 message 与可选的恢复 hint 合成一句完整提示，
 * 供只能显示纯文本的场景（Tooltip、行内小字）使用。
 */
export function formatErrorText(error: HumanizedError): string {
	return error.hint ? `${error.message} ${error.hint}` : error.message
}

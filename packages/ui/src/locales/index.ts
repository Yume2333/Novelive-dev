import en_agent from './en/agent.json'
import en_bible from './en/bible.json'
import en_confirm from './en/confirm.json'
import en_editor from './en/editor.json'
import en_import from './en/import.json'
import en_library from './en/library.json'
import en_main from './en/main.json'
import en_player from './en/player.json'
import en_production from './en/production.json'
import en_settings from './en/settings.json'
import en_shell from './en/shell.json'
import en_usage from './en/usage.json'
import en_work from './en/work.json'
import ja_agent from './ja/agent.json'
import ja_bible from './ja/bible.json'
import ja_confirm from './ja/confirm.json'
import ja_editor from './ja/editor.json'
import ja_import from './ja/import.json'
import ja_library from './ja/library.json'
import ja_main from './ja/main.json'
import ja_player from './ja/player.json'
import ja_production from './ja/production.json'
import ja_settings from './ja/settings.json'
import ja_shell from './ja/shell.json'
import ja_usage from './ja/usage.json'
import ja_work from './ja/work.json'
import zhCN_agent from './zh-CN/agent.json'
import zhCN_bible from './zh-CN/bible.json'
import zhCN_confirm from './zh-CN/confirm.json'
import zhCN_editor from './zh-CN/editor.json'
import zhCN_import from './zh-CN/import.json'
import zhCN_library from './zh-CN/library.json'
import zhCN_main from './zh-CN/main.json'
import zhCN_player from './zh-CN/player.json'
import zhCN_production from './zh-CN/production.json'
import zhCN_settings from './zh-CN/settings.json'
import zhCN_shell from './zh-CN/shell.json'
import zhCN_usage from './zh-CN/usage.json'
import zhCN_work from './zh-CN/work.json'
import zhTW_agent from './zh-TW/agent.json'
import zhTW_bible from './zh-TW/bible.json'
import zhTW_confirm from './zh-TW/confirm.json'
import zhTW_editor from './zh-TW/editor.json'
import zhTW_import from './zh-TW/import.json'
import zhTW_library from './zh-TW/library.json'
import zhTW_main from './zh-TW/main.json'
import zhTW_player from './zh-TW/player.json'
import zhTW_production from './zh-TW/production.json'
import zhTW_settings from './zh-TW/settings.json'
import zhTW_shell from './zh-TW/shell.json'
import zhTW_usage from './zh-TW/usage.json'
import zhTW_work from './zh-TW/work.json'

export const locales = ['zh-CN', 'zh-TW', 'en', 'ja'] as const
export type Locale = (typeof locales)[number]
export const namespaces = [
	'agent',
	'bible',
	'confirm',
	'editor',
	'import',
	'library',
	'main',
	'player',
	'production',
	'settings',
	'shell',
	'usage',
	'work',
] as const

export const resources = {
	'zh-CN': {
		agent: zhCN_agent,
		bible: zhCN_bible,
		confirm: zhCN_confirm,
		editor: zhCN_editor,
		import: zhCN_import,
		library: zhCN_library,
		main: zhCN_main,
		player: zhCN_player,
		production: zhCN_production,
		settings: zhCN_settings,
		shell: zhCN_shell,
		usage: zhCN_usage,
		work: zhCN_work,
	},
	'zh-TW': {
		agent: zhTW_agent,
		bible: zhTW_bible,
		confirm: zhTW_confirm,
		editor: zhTW_editor,
		import: zhTW_import,
		library: zhTW_library,
		main: zhTW_main,
		player: zhTW_player,
		production: zhTW_production,
		settings: zhTW_settings,
		shell: zhTW_shell,
		usage: zhTW_usage,
		work: zhTW_work,
	},
	en: {
		agent: en_agent,
		bible: en_bible,
		confirm: en_confirm,
		editor: en_editor,
		import: en_import,
		library: en_library,
		main: en_main,
		player: en_player,
		production: en_production,
		settings: en_settings,
		shell: en_shell,
		usage: en_usage,
		work: en_work,
	},
	ja: {
		agent: ja_agent,
		bible: ja_bible,
		confirm: ja_confirm,
		editor: ja_editor,
		import: ja_import,
		library: ja_library,
		main: ja_main,
		player: ja_player,
		production: ja_production,
		settings: ja_settings,
		shell: ja_shell,
		usage: ja_usage,
		work: ja_work,
	},
}

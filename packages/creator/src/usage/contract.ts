import { arr, obj, oneOf, str } from '@earendil-works/pi-schema'
import { productionUsageSchema } from '../contract/queue'

// 用量统计里读不了的工程只报机器原因：UI 按枚举本地化，
// 后端绝不把简体中文句子写进 contract。
export const unreadableProjectReasons = ['moved', 'unreadable'] as const
export type UnreadableProjectReason = (typeof unreadableProjectReasons)[number]

export const usageCommands = {
	'usage.list': {
		input: obj({}),
		output: obj({
			records: arr(obj({ id: str(), usage: productionUsageSchema })),
			staleAssets: arr(obj({ workId: str(), assetKey: str() })),
			unreadableProjects: arr(
				obj({ projectId: str(), reason: oneOf(unreadableProjectReasons) }),
			),
		}),
	},
}

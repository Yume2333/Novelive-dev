import { arr, obj, str } from '@earendil-works/pi-schema'
import { productionUsageSchema } from '../contract/queue'

export const usageCommands = {
	'usage.list': {
		input: obj({}),
		output: obj({
			records: arr(obj({ id: str(), usage: productionUsageSchema })),
			staleAssets: arr(obj({ workId: str(), assetKey: str() })),
		}),
	},
}

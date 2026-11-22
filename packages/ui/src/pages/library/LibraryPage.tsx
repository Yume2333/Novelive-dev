import { FileUp, LibraryBig } from 'lucide-react'
import { EmptyState, Page, PageAction } from '../../components/Page'
import { productionRoutes } from '../../routes/production'

export function LibraryPage() {
	return (
		<Page
			title="书库"
			action={
				<PageAction icon={FileUp} to={productionRoutes.import}>
					导入原文
				</PageAction>
			}
		>
			<EmptyState
				icon={LibraryBig}
				title="书库还是空的"
				text="还没有作品"
				card
			/>
		</Page>
	)
}

import { LibraryBig } from 'lucide-react'
import { EmptyState, Page } from '../../components/Page'

export function LibraryPage() {
	return (
		<Page title="书库">
			<EmptyState icon={LibraryBig} text="还没有作品" card />
		</Page>
	)
}

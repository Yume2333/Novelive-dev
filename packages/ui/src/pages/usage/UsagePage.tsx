import { BarChart3 } from 'lucide-react'
import { EmptyState, Page } from '../../components/Page'

export function UsagePage() {
	return (
		<Page title="用量">
			<EmptyState icon={BarChart3} text="暂无用量记录" />
		</Page>
	)
}

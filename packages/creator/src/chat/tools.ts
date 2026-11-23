import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
	compile,
	obj,
	oneOf,
	opt,
	type Static,
	str,
} from '@earendil-works/pi-schema'
import {
	assetId,
	biblePatchSchema,
	entityId,
	glossaryPatchSchema,
	sceneId,
} from '@novelive/format/model'
import type { Proposal, RewriteProposal } from '../contract'
import { proposalSchema } from '../contract'
import type { TextConnection } from '../models/text'

const reason = str()
const schemas = {
	bible: obj({ volumeId: entityId, changes: biblePatchSchema, reason }),
	glossary: obj({ volumeId: entityId, changes: glossaryPatchSchema, reason }),
	requirements: obj({ text: str(), reason }),
	rewriteScene: obj({
		chapterId: entityId,
		sceneId,
		instruction: str(),
		reason,
	}),
	redrawImage: obj({ assetId, instruction: opt(str()), reason }),
	redoChapter: obj({ chapterId: entityId, reason }),
	resynthesizeVolume: obj({ volumeId: entityId, reason }),
}
type Kind = keyof typeof schemas
type Input<K extends Kind> = Static<(typeof schemas)[K]>
export type ProposalIntent = { [K in Kind]: { kind: K } & Input<K> }[Kind]
export type PreparedProposal = Pick<
	Proposal,
	'payload' | 'prompt' | 'chapterIds'
>
export interface ProposalActions {
	/** Read-only: validate the target, compute impact, and stamp the current revision. */
	prepare(
		intent: ProposalIntent,
		signal: AbortSignal,
	): Promise<PreparedProposal>
	/** Check expectedRevision again at the domain write boundary; use proposal.id for idempotency. */
	applyIfCurrent(
		proposal: Proposal,
		signal: AbortSignal,
	): Promise<
		{ status: 'applied'; rewrite?: RewriteProposal } | { status: 'stale' }
	>
}

const names: Record<Kind, string> = {
	bible: 'propose_bible_change',
	glossary: 'propose_glossary_change',
	requirements: 'propose_adaptation_notes',
	rewriteScene: 'propose_rewrite_scene',
	redrawImage: 'propose_redraw_image',
	redoChapter: 'propose_redo_chapter',
	resynthesizeVolume: 'propose_resynthesize_volume',
}
const proposalCheck = compile(proposalSchema)
export function checkProposal(proposal: Proposal, kind: Kind) {
	if (
		!proposalCheck.check(proposal) ||
		proposal.payload.kind !== kind ||
		(proposal.payload.kind === 'rewriteScene' &&
			proposal.payload.request.workId !== proposal.workId)
	)
		throw new Error('无效的提议快照')
}

export function toolText(text: string) {
	return { content: [{ type: 'text' as const, text }], details: undefined }
}

export function proposalTools(
	register: (toolCallId: string, intent: ProposalIntent) => Promise<Proposal>,
) {
	function tool<K extends Kind>(kind: K): AgentTool<(typeof schemas)[K]> {
		const name = names[kind]
		return {
			name,
			label: name,
			description: `Propose a ${kind} change for the creator to review. Never claim that proposing applies a change.`,
			parameters: schemas[kind],
			constrainedSampling: { type: 'json_schema', strict: 'prefer' },
			async execute(toolCallId, args) {
				const proposal = await register(toolCallId, {
					...(args as object),
					kind,
				} as ProposalIntent)
				return toolText(
					`Proposal ${proposal.id} is awaiting the creator's decision.`,
				)
			},
		}
	}
	return (Object.keys(schemas) as Kind[]).map(tool)
}

export const childRoles = [
	'organizer',
	'writer',
	'reviewer',
	'artDirector',
	'visualAuditor',
] as const
export type ChildRole = (typeof childRoles)[number]
export type ChildAgent = {
	model(): TextConnection | Promise<TextConnection>
	instructions: string
}
export type ChildAgents = Partial<Record<ChildRole, ChildAgent>>
export function spawnTool(
	children: ChildAgents,
	run: (
		id: string,
		role: ChildRole,
		task: string,
		context?: string,
	) => Promise<string>,
) {
	const roles = childRoles.filter((role) => children[role])
	if (!roles.length) return []
	const parameters = obj({
		role: oneOf(roles),
		task: str(),
		context: opt(str()),
	})
	const tool: AgentTool<typeof parameters> = {
		name: 'spawn_agent',
		label: '委派子任务',
		description:
			'Delegate a read-only task to a specialist with fresh context. Include all relevant context. DO NOT sleep, poll, or duplicate this subagent’s work.',
		parameters,
		async execute(id, { role, task, context }) {
			return toolText(await run(id, role, task, context))
		},
	}
	return [tool]
}

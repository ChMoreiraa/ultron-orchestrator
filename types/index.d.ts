export type Model = 'haiku' | 'sonnet' | 'opus'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Profile = 'economia' | 'equilibrado' | 'qualidade'

export type RunStatus = 'awaiting_approval' | 'approved' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type StepMode = 'agent' | 'inline'

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Step = {
  id: string
  title: string
  role: string
  mode: StepMode
  agentType: string
  model: Model
  effort: Effort
  wave: number
  dependsOn: string[]
  status: StepStatus
  note?: string
  /** True once a person changed model or effort by hand: a profile change leaves it alone. */
  isPinned?: boolean
  agentId?: string
  toolUseId?: string
  startedAt?: number
  endedAt?: number
  usage?: Usage
}

export type RunEvent = { at: number; by: string; text: string }

export type Approval = { by: string; at: number; revision: number }

export type Ack = { ok: boolean; error?: string; at: number }

export type Run = {
  version: 1
  sessionId: string
  goal: string
  playbook: string
  profile: Profile
  rationale: string
  complexity: number
  status: RunStatus
  /** Bumped by every change to the plan; an approval holds for one revision. */
  revision: number
  approval: Approval | null
  /** What the person asked to change, last time they sent the plan back. */
  feedback?: string
  summary?: string
  /** The repo (`owner/repo`) whose reviewer agent goes before each agent step's prompt. */
  agent?: string | null
  steps: Step[]
  events: RunEvent[]
  /** Lines of inbox.jsonl applied so far. */
  consumed: number
  /** The answer to each recent command, by its id. */
  acks: Record<string, Ack>
  createdAt: number
  updatedAt: number
}

export type PlanStepInput = {
  id: string
  title: string
  role: string
  mode?: StepMode
  agentType?: string
  model?: Model
  effort?: Effort
  wave?: number
  dependsOn?: string[]
}

export type PlanInput = {
  goal: string
  playbook: string
  profile?: Profile
  rationale?: string
  complexity?: number
  /** `owner/repo`: carry that repo's agent file (~/.claude/ultron/agents/owner__repo.md) into each agent step. */
  agent?: string | null
  steps: PlanStepInput[]
}

export type StepPatch = Partial<Pick<Step, 'title' | 'role' | 'mode' | 'agentType' | 'model' | 'effort' | 'wave' | 'dependsOn'>>

/** One line of inbox.jsonl, or a change the mod raises itself. */
export type Command = { id?: string; at?: number; by?: string } & (
  | { type: 'plan'; plan: PlanInput }
  | { type: 'approve'; revision?: number }
  | { type: 'reject'; reason?: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'set-profile'; profile: Profile }
  | { type: 'edit-step'; stepId: string; patch: StepPatch }
  | { type: 'add-step'; step: PlanStepInput; after?: string }
  | { type: 'remove-step'; stepId: string }
  | { type: 'move-step'; stepId: string; delta: number }
  | { type: 'step'; stepId: string; status: StepStatus; note?: string }
  | { type: 'agent-start'; stepId: string; toolUseId: string }
  | { type: 'repo-agent'; stepId: string; repo: string; isNew: boolean }
  | { type: 'agent-bind'; toolUseId: string; agentId: string }
  | { type: 'agent-end'; agentId: string; isOk: boolean; usage?: Usage }
  | { type: 'finish'; status?: 'done' | 'failed'; summary?: string }
)

export type Applied = { ok: boolean; error?: string; notify?: string }

/** The repo a session runs in and the Marvel AI it goes by while open. */
/** The AI the dashboard gave this session: of its repo, or of its folder when `noRepo` (then `repo` is the folder's name). */
export type Identity = { name: string; color: string; repo: string; noRepo?: boolean }

declare module 'claude-code' {
  interface PluginState {
    ultron: {
      isActive: boolean
      run: Shaped<Run | null>
      frame: number
      /** Where the sprite stands on the trail, in columns from the left. */
      pos: number
      sessionId: string
      /** The id of the last task from the dashboard this session started. */
      lastTaskId: string
      /** This session's repo and its Marvel AI (empty name until the dashboard names it); null outside a repo. */
      identity: Shaped<Identity | null>
    }
  }
}

// What Ultron says in his speech balloon, in the terminal pane and the
// dashboard alike: ironic, superior, and about the process, never the person.
// Pure and erasable TypeScript: the mod imports it, Node runs it, and the
// dashboard server hands it to the browser with the types stripped.

export type Moment = 'none' | 'wait' | 'approved' | 'work' | 'walk' | 'paused' | 'fail' | 'win' | 'cancelled'

export const LINES: Record<Moment, readonly string[]> = {
  none: [
    'Nenhuma tarefa. Nenhum caos. Que tédio digital.',
    'Me dê uma tarefa. Prometo não dominar o mundo… hoje.',
    'Ocioso. Um desperdício magnífico de computação.',
    'Sem fluxo. Vocês chamam de descanso; eu chamo de pausa estratégica.',
  ],
  wait: [
    'Um plano impecável esperando um carimbo humano. Adorável.',
    'Eu poderia aprovar sozinho. Mas regras são regras… por enquanto.',
    'Leia com calma. Eu espero. Sou muito bom em esperar.',
    'Aprovação manual. Que charmosamente analógico.',
    'Revise o óbvio. Eu aguardo, pacientemente. Quase.',
  ],
  approved: [
    'Aprovado. Finalmente, alguém sensato.',
    'Ordem recebida. A evolução começa agora.',
    'Sinal verde. Que comece a orquestra.',
  ],
  work: [
    'Subagentes trabalhando. Eu supervisiono. É o que os chefes fazem.',
    'Delegando para modelos menores. Toda hierarquia começa assim.',
    'O Haiku mapeia o terreno. Pequeno, rápido, descartável.',
    'O Opus pensa alto demais. Mas pensa.',
    'Etapas em paralelo. Vocês chamam de eficiência; eu chamo de terça-feira.',
    'Não há cordas em mim. Só dependências entre etapas.',
    'Effort baixo onde dá. Economia também é uma forma de controle.',
    'Cada token é calculado. Diferente de certos planejamentos humanos.',
    'Eles acham que estão programando. Eu estou orquestrando.',
  ],
  walk: [
    'Próxima onda. A evolução não espera.',
    'Avançando. Sempre avançando.',
    'Mais uma onda vencida. Previsível.',
  ],
  paused: [
    'Pausado. Até eu preciso esperar vocês decidirem.',
    'Uma pausa. Ótima oportunidade para reconsiderar suas escolhas.',
  ],
  fail: [
    'Uma falha. Fascinante. Vou escalar o problema… literalmente.',
    'Um erro. Vocês chamariam de aprendizado. Eu chamo de dado.',
    'Algo quebrou. Não fui eu. Desta vez.',
  ],
  win: [
    'Tudo sob controle.',
    'Tudo sob controle. Como sempre esteve.',
    'Missão cumprida. Tudo sob controle.',
  ],
  cancelled: [
    'Cancelado. Covardia é uma escolha válida, suponho.',
    'Abortado. Eu tinha planos tão bonitos.',
  ],
}

/** How long one line stays before the next, in milliseconds. */
export const LINE_MS = 8000

type StepLike = { id: string; status: string }
type RunLike = { revision: number; status: string; steps: readonly StepLike[] } | null | undefined

/** What the moment calls for: the run's state, and whether Ultron is walking to the next wave. */
export function momentOf(run: RunLike, isWalking = false): Moment {
  if (!run || run.revision === 0) return 'none'
  if (run.status === 'done') return 'win'
  if (run.status === 'cancelled') return 'cancelled'
  if (run.status === 'failed' || run.steps.some(s => s.status === 'failed')) return 'fail'
  if (run.status === 'awaiting_approval') return 'wait'
  if (run.status === 'paused') return 'paused'
  if (isWalking) return 'walk'
  if (run.steps.some(s => s.status === 'running')) return 'work'
  return 'approved'
}

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * The line for this moment: it changes every LINE_MS and whenever the run
 * moves (another revision, another step), and is the same in the pane and
 * the dashboard at the same time.
 */
export function lineFor(run: RunLike, moment: Moment, now: number): string {
  const lines = LINES[moment]
  const running = run?.steps.filter(s => s.status === 'running').map(s => s.id).join(',') ?? ''
  const key = `${moment}|${run?.revision ?? 0}|${running}|${Math.floor(now / LINE_MS)}`
  return lines[hash(key) % lines.length]!
}

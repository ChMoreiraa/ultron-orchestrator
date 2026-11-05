// Torre de controle, T1: junta presenças, sessões abertas e runs do Ultron numa lista só. Só leitura, sem dependências.
// Abre apenas <claudeDir>/agentes/*.json, <claudeDir>/sessions/<pid>.json e <ultronHome>/runs/<sessão>/{run,mod}.json.
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep, win32 } from 'node:path'

export const SEM_SINAL_MS = 2 * 60_000
export const BATIMENTO_MS = 6000 // o mesmo ALIVE_MS de bin/lib/store.mjs
/** Run do Ultron sem batimento e sem mudança há mais que isto foi abandonada (sessão fechada sem `finish`): sai da galeria. */
export const ABANDONO_MS = 24 * 60 * 60_000
export const AVATAR_MAX = 1024 * 1024
export const AVATAR_RE = /^[A-Za-z0-9._-]+\.png$/
/** Teto de leitura: presença, sessão e batimento são pequenos; a run cresce com os eventos. */
export const JSON_MAX = 256 * 1024
export const RUN_MAX = 4 * 1024 * 1024
const PROJETOS_MAX = 20
const PNG_ASSINATURA = Buffer.from('89504e470d0a1a0a', 'hex')
const ORDEM = ['aguardando', 'executando', 'pausado', 'ocioso', 'sem_sinal']
const ESTADOS_PRESENCA = ['ocioso', 'executando', 'aguardando', 'pausado']
const SESSAO_RE = /^[\w-]{1,80}$/

export const claudeDirPadrao = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

export function pidVivoPadrao(pid) {
  // 0 e negativos são grupos de processos no POSIX: kill(0, 0) sempre "acha" alguém.
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

/**
 * Lê um arquivo comum (link simbólico ou junção não) de até `max` bytes; senão null.
 * O tamanho é conferido no próprio descritor aberto, e a leitura nunca passa do teto.
 */
function lerArquivo(file, max, ate = max) {
  try {
    if (!lstatSync(file).isFile()) return null
  } catch {
    return null
  }
  let fd
  try {
    fd = openSync(file, 'r')
    const st = fstatSync(fd)
    if (!st.isFile() || st.size > max) return null
    const total = Math.min(st.size, ate)
    const buf = Buffer.alloc(total)
    let lido = 0
    while (lido < total) {
      const n = readSync(fd, buf, lido, total - lido, lido)
      if (n === 0) break
      lido += n
    }
    return { buf: buf.subarray(0, lido), mtimeMs: st.mtimeMs }
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** O JSON do arquivo e a hora em que ele mudou: { v, mtimeMs }, ou null. */
function lerJsonArq(file, max = JSON_MAX) {
  const a = lerArquivo(file, max)
  if (!a) return null
  try {
    return { v: JSON.parse(a.buf.toString('utf8')), mtimeMs: a.mtimeMs }
  } catch {
    return null
  }
}
const lerJson = (file, max) => lerJsonArq(file, max)?.v ?? null
const ehObjeto = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const listar = dir => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Texto de uma linha só, cortado em `max` caracteres; o que não for string vira null. */
export function texto(v, max = 120) {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}
const numero = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const linkSeguro = v => (typeof v === 'string' && /^https?:\/\//.test(v) ? v.replace(/\s+/g, '').slice(0, 300) : null)

/** O caminho do avatar, se o nome é seguro e cai dentro de <claudeDir>/agentes (ainda sem abrir nada). */
function caminhoAvatar(claudeDir, nome) {
  if (typeof nome !== 'string' || !AVATAR_RE.test(nome) || nome.includes('..')) return null
  const base = resolve(claudeDir, 'agentes')
  const file = resolve(base, nome)
  if (!file.startsWith(base + sep)) return null
  try {
    // Um link no caminho (ou um nome de dispositivo do Windows) apontaria para fora da pasta.
    if (!realpathSync(file).startsWith(realpathSync(base) + sep)) return null
  } catch {
    return null
  }
  return file
}

/**
 * Os bytes do avatar (ou só os `ate` primeiros): arquivo comum (sem link), dentro de <claudeDir>/agentes, até 1 MB e
 * com a assinatura de PNG. A assinatura impede que um link duro para um arquivo qualquer (credencial, .env) saia
 * como imagem.
 */
export function lerAvatar(claudeDir, nome, ate = AVATAR_MAX) {
  const file = caminhoAvatar(claudeDir, nome)
  const a = file && lerArquivo(file, AVATAR_MAX, Math.max(ate, PNG_ASSINATURA.length))
  return a && a.buf.subarray(0, PNG_ASSINATURA.length).equals(PNG_ASSINATURA) ? a.buf : null
}

// A lista só confere o cabeçalho; o arquivo inteiro sai só na rota de avatar.
const urlAvatar = (claudeDir, nome) => (lerAvatar(claudeDir, nome, PNG_ASSINATURA.length) ? `/api/torre/avatar/${nome}` : null)

function projetos(v) {
  if (!Array.isArray(v)) return []
  return v.slice(0, PROJETOS_MAX).flatMap(p => {
    const repo = ehObjeto(p) ? texto(p.repo) : null
    return repo ? [{ repo, item: texto(p.item), titulo: texto(p.titulo), estado: texto(p.estado), link: linkSeguro(p.link) }] : []
  })
}

function presencas(claudeDir, now) {
  const dir = join(claudeDir, 'agentes')
  const out = []
  for (const arq of listar(dir).sort()) {
    if (!arq.endsWith('.json') || arq.startsWith('.')) continue
    const p = lerJson(join(dir, arq))
    if (!ehObjeto(p)) continue
    const id = texto(p.id) ?? arq.slice(0, -'.json'.length)
    const atualizadoEm = numero(p.atualizadoEm)
    // Uma hora no futuro (segundos em µs, relógio errado) também é sem sinal: senão ficaria "viva" para sempre.
    const parado = atualizadoEm === null || Math.abs(now - atualizadoEm) > SEM_SINAL_MS
    const fila = numero(p.fila)
    out.push({
      id,
      tipo: 'presenca',
      nome: texto(p.nome) ?? id,
      papel: texto(p.papel),
      estado: parado ? 'sem_sinal' : ESTADOS_PRESENCA.includes(p.estado) ? p.estado : 'ocioso',
      fazendo: texto(p.fazendo),
      fila: fila === null ? null : Math.max(0, Math.floor(fila)),
      erro: texto(p.erro),
      atualizadoEm,
      avatar: urlAvatar(claudeDir, p.avatar),
      sessao: texto(p.sessao, 200),
      pasta: null,
      projetos: projetos(p.projetos),
    })
  }
  return out
}

function runsDoUltron(ultronHome, now) {
  const out = []
  const raiz = join(ultronHome, 'runs')
  for (const sid of listar(raiz).sort()) {
    if (!SESSAO_RE.test(sid)) continue
    const arq = lerJsonArq(join(raiz, sid, 'run.json'), RUN_MAX)
    const run = arq?.v
    if (!ehObjeto(run) || ['done', 'failed', 'cancelled'].includes(run.status)) continue
    const batida = lerJson(join(raiz, sid, 'mod.json'))
    const at = ehObjeto(batida) ? numero(batida.at) : null
    const vivo = at !== null && now - at < BATIMENTO_MS
    // Sessão fechada sem `finish`: a run nunca termina. Sem batimento nem mudança há 24 h, sai da galeria.
    const ultimoSinal = Math.max(at ?? 0, numero(run.updatedAt) ?? arq.mtimeMs)
    if (!vivo && now - ultimoSinal > ABANDONO_MS) continue
    const passos = Array.isArray(run.steps) ? run.steps : []
    const feitas = passos.filter(s => s?.status === 'done' || s?.status === 'skipped').length
    let estado = 'executando'
    let fazendo = `${feitas}/${passos.length} etapas · ${texto(run.goal) ?? ''}`
    if (run.status === 'awaiting_approval') {
      estado = 'aguardando'
      fazendo = 'aguarda aprovação do plano'
    } else if (run.status === 'paused') estado = 'pausado'
    if (!vivo) estado = 'sem_sinal'
    out.push({
      id: `ultron:${sid}`,
      tipo: 'ultron',
      nome: 'Ultron',
      papel: null,
      estado,
      fazendo: texto(fazendo),
      fila: null,
      erro: null,
      atualizadoEm: numero(run.updatedAt) ?? (vivo ? at : null),
      avatar: null,
      sessao: sid,
      pasta: null,
      projetos: [],
    })
  }
  return out
}

function sessoes(claudeDir, pidVivo, escondidas) {
  const dir = join(claudeDir, 'sessions')
  const out = []
  for (const arq of listar(dir).sort()) {
    if (!/^\d+\.json$/.test(arq)) continue // nunca os <pid>.<hash>.key
    const s = lerJson(join(dir, arq))
    if (!ehObjeto(s)) continue
    const pid = numero(s.pid) ?? Number(arq.slice(0, -5))
    const sid = texto(s.sessionId, 200)
    if (!sid || escondidas.has(sid)) continue
    let vivo = false
    try {
      vivo = Boolean(pidVivo(pid))
    } catch {}
    if (!vivo) continue
    const pasta = typeof s.cwd === 'string' ? texto(win32.basename(s.cwd), 80) : null
    const estado = s.status === 'busy' ? 'executando' : s.status === 'waiting' ? 'aguardando' : 'ocioso'
    out.push({
      id: `sessao:${sid}`,
      tipo: 'sessao',
      nome: texto(s.name, 80) ?? pasta ?? 'Sessão',
      papel: null,
      estado,
      fazendo: estado === 'executando' ? 'trabalhando' : estado === 'aguardando' ? 'esperando você' : null,
      fila: null,
      erro: null,
      atualizadoEm: numero(s.updatedAt),
      avatar: null,
      sessao: sid,
      pasta,
      projetos: [],
    })
  }
  return out
}

export function listarAgentes({ claudeDir = claudeDirPadrao(), ultronHome, now = Date.now(), pidVivo = pidVivoPadrao } = {}) {
  const pres = presencas(claudeDir, now)
  const runs = ultronHome ? runsDoUltron(ultronHome, now) : []
  const escondidas = new Set([...pres.map(a => a.sessao), ...runs.map(a => a.sessao)].filter(Boolean))
  const todos = [...pres, ...runs, ...sessoes(claudeDir, pidVivo, escondidas)]
  return todos.sort((a, b) => ORDEM.indexOf(a.estado) - ORDEM.indexOf(b.estado) || a.nome.localeCompare(b.nome, 'pt-BR') || a.id.localeCompare(b.id))
}

/** O corpo das rotas: { agentes, geradoEm }. */
export const corpo = opts => ({ agentes: listarAgentes(opts), geradoEm: opts?.now ?? Date.now() })

/** Resposta da rota de avatar: { status, body? }, a partir do nome já decodificado. */
export function respostaAvatar(claudeDir, nome) {
  const body = lerAvatar(claudeDir, nome)
  return body ? { status: 200, body } : { status: 404 }
}

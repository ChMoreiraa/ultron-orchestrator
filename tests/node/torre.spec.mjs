// node --test tests/node — torre de controle (T1): a lista de agentes e as rotas, sobre pastas temporárias.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { JSON_MAX, claudeDirPadrao, listarAgentes, pidVivoPadrao, respostaAvatar } from '../../torre/agentes.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOW = 1_800_000_000_000
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

/** Uma pasta de Claude e uma de Ultron novas, com atalhos para escrever nelas. */
function ambiente() {
  const raiz = mkdtempSync(join(tmpdir(), 'torre-test-'))
  const claudeDir = join(raiz, 'claude')
  const ultronHome = join(raiz, 'ultron')
  for (const d of ['agentes', 'sessions']) mkdirSync(join(claudeDir, d), { recursive: true })
  mkdirSync(join(ultronHome, 'runs'), { recursive: true })
  const j = (file, v) => writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v))
  return {
    raiz,
    claudeDir,
    ultronHome,
    presenca: (arq, v) => j(join(claudeDir, 'agentes', arq), v),
    sessao: (pid, v) => j(join(claudeDir, 'sessions', `${pid}.json`), { pid, sessionId: `s-${pid}`, cwd: 'C:\\code\\app', status: 'idle', ...v }),
    run: (sid, run, batida) => {
      mkdirSync(join(ultronHome, 'runs', sid), { recursive: true })
      j(join(ultronHome, 'runs', sid, 'run.json'), { goal: 'Objetivo', steps: [], ...run })
      if (batida !== undefined) j(join(ultronHome, 'runs', sid, 'mod.json'), { at: batida })
    },
    lista: (extra = {}) => listarAgentes({ claudeDir, ultronHome, now: NOW, pidVivo: () => true, ...extra }),
    limpa: () => rmSync(raiz, { recursive: true, force: true }),
  }
}
const com = fn => async () => {
  const a = ambiente()
  try {
    await fn(a)
  } finally {
    a.limpa()
  }
}

test('presença v1 sem id usa o nome do arquivo e fica fora do v2', com(a => {
  a.presenca('maomao.json', { nome: 'Maomao', papel: 'revisora de PRs', estado: 'ocioso', fazendo: 'vigiando · fila 0', fila: 0, paraDecidir: 0, atualizadoEm: NOW - 1000, erro: null })
  a.presenca('LEIAME.md', '# nada')
  const [ag, ...resto] = a.lista()
  assert.equal(resto.length, 0)
  assert.deepEqual(ag, { id: 'maomao', tipo: 'presenca', nome: 'Maomao', papel: 'revisora de PRs', estado: 'ocioso', fazendo: 'vigiando · fila 0', fila: 0, erro: null, atualizadoEm: NOW - 1000, avatar: null, sessao: null, pasta: null, projetos: [] })
}))

test('presença v2 completa, com avatar que existe e link http', com(a => {
  writeFileSync(join(a.claudeDir, 'agentes', 'revisora.png'), PNG)
  a.presenca('x.json', {
    id: 'revisora', nome: 'Revisora', papel: 'revisa PRs', estado: 'executando', fazendo: 'revisando\na PR #103', fila: 2, atualizadoEm: NOW - 5000, erro: null, avatar: 'revisora.png', sessao: 'c5af',
    projetos: [{ repo: 'dono/app', item: '#103', titulo: 'Corrige o login', estado: 'revisando', link: 'https://github.com/dono/app/pull/103' }],
  })
  const [ag] = a.lista()
  assert.equal(ag.id, 'revisora')
  assert.equal(ag.estado, 'executando')
  assert.equal(ag.fazendo, 'revisando a PR #103')
  assert.equal(ag.avatar, '/api/torre/avatar/revisora.png')
  assert.equal(ag.sessao, 'c5af')
  assert.deepEqual(ag.projetos, [{ repo: 'dono/app', item: '#103', titulo: 'Corrige o login', estado: 'revisando', link: 'https://github.com/dono/app/pull/103' }])
}))

test('arquivo pela metade ou inválido é ignorado', com(a => {
  a.presenca('quebrado.json', '{"nome":"Meio","estado":')
  a.presenca('lista.json', '[1,2]')
  a.presenca('ok.json', { nome: 'Ok', atualizadoEm: NOW })
  assert.deepEqual(a.lista().map(x => x.id), ['ok'])
}))

test('estado desconhecido vira ocioso; sem atualizadoEm ou parado há mais de 2 min vira sem_sinal', com(a => {
  a.presenca('a.json', { nome: 'A', estado: 'dancando', atualizadoEm: NOW })
  a.presenca('b.json', { nome: 'B', estado: 'executando' })
  a.presenca('c.json', { nome: 'C', estado: 'executando', atualizadoEm: NOW - 2 * 60_000 - 1 })
  a.presenca('d.json', { nome: 'D', estado: 'executando', atualizadoEm: NOW - 2 * 60_000 })
  const por = Object.fromEntries(a.lista().map(x => [x.id, x.estado]))
  assert.deepEqual(por, { a: 'ocioso', b: 'sem_sinal', c: 'sem_sinal', d: 'executando' })
}))

test('texto que não é string vira null, e o link só vale com http(s)', com(a => {
  a.presenca('t.json', {
    nome: 42, papel: { x: 1 }, fazendo: ['a'], erro: 7, fila: 'três', atualizadoEm: NOW, avatar: 5,
    projetos: [{ repo: 'a/b', item: 9, titulo: null, link: 'javascript:alert(1)' }, { repo: 'c/d', link: 'http://x.test/1' }, { item: '#1' }, 'texto'],
  })
  const [ag] = a.lista()
  assert.equal(ag.nome, 't')
  assert.equal(ag.papel, null)
  assert.equal(ag.fazendo, null)
  assert.equal(ag.erro, null)
  assert.equal(ag.fila, null)
  assert.equal(ag.avatar, null)
  assert.deepEqual(ag.projetos, [
    { repo: 'a/b', item: null, titulo: null, estado: null, link: null },
    { repo: 'c/d', item: null, titulo: null, estado: null, link: 'http://x.test/1' },
  ])
}))

test('fazendo é uma linha e é cortado em 120 caracteres', com(a => {
  a.presenca('l.json', { nome: 'L', atualizadoEm: NOW, fazendo: `${'x'.repeat(200)}\nfim` })
  assert.equal(a.lista()[0].fazendo.length, 120)
}))

test('avatar só aparece quando o PNG existe, e nomes perigosos nunca', com(a => {
  a.presenca('a.json', { nome: 'A', atualizadoEm: NOW, avatar: 'nao-existe.png' })
  a.presenca('b.json', { nome: 'B', atualizadoEm: NOW, avatar: '../fora.png' })
  a.presenca('c.json', { nome: 'C', atualizadoEm: NOW, avatar: 'c.jpg' })
  writeFileSync(join(a.claudeDir, 'agentes', 'c.jpg'), PNG)
  writeFileSync(join(a.claudeDir, 'fora.png'), PNG)
  writeFileSync(join(a.claudeDir, 'agentes', 'grande.png'), Buffer.alloc(1024 * 1024 + 1))
  a.presenca('d.json', { nome: 'D', atualizadoEm: NOW, avatar: 'grande.png' })
  assert.ok(a.lista().every(x => x.avatar === null))
}))

test('sessão viva aparece, morta não; status vira estado e só o nome da pasta sai', com(a => {
  a.sessao(10, { status: 'busy', name: 'Minha sessão', updatedAt: NOW - 10, socket: 'x', messagingSocketPath: '\\\\.\\pipe\\segredo', version: '9.9' })
  a.sessao(11, { status: 'waiting' })
  a.sessao(12, { status: 'idle' })
  a.sessao(13, { status: 'busy' })
  const lista = a.lista({ pidVivo: pid => pid !== 13 })
  assert.deepEqual(lista.map(x => [x.id, x.estado, x.fazendo, x.nome, x.pasta]), [
    ['sessao:s-11', 'aguardando', 'esperando você', 'app', 'app'],
    ['sessao:s-10', 'executando', 'trabalhando', 'Minha sessão', 'app'],
    ['sessao:s-12', 'ocioso', null, 'app', 'app'],
  ])
  assert.ok(!JSON.stringify(lista).match(/segredo|9\.9|code/))
  assert.equal(lista[0].tipo, 'sessao')
  assert.equal(lista[0].sessao, 's-11')
}))

test('sessão citada por uma presença ou por uma run do Ultron não aparece de novo', com(a => {
  a.sessao(10, {})
  a.sessao(11, {})
  a.sessao(12, {})
  a.presenca('p.json', { nome: 'P', atualizadoEm: NOW, sessao: 's-10' })
  a.run('s-11', { status: 'running' }, NOW)
  assert.deepEqual(a.lista().map(x => x.id).sort(), ['p', 'sessao:s-12', 'ultron:s-11'])
}))

test('Ultron: cada status, e o que terminou fica fora', com(a => {
  a.run('r1', { status: 'awaiting_approval' }, NOW - 1000)
  a.run('r2', { status: 'running', goal: 'Fazer a coisa', steps: [{ status: 'done' }, { status: 'skipped' }, { status: 'running' }, { status: 'pending' }] }, NOW - 1000)
  a.run('r3', { status: 'approved', steps: [] }, NOW - 1000)
  a.run('r4', { status: 'paused' }, NOW - 1000)
  for (const [i, s] of ['done', 'failed', 'cancelled'].entries()) a.run(`f${i}`, { status: s }, NOW - 1000)
  const por = Object.fromEntries(a.lista().map(x => [x.id, x]))
  assert.deepEqual(Object.keys(por).sort(), ['ultron:r1', 'ultron:r2', 'ultron:r3', 'ultron:r4'])
  assert.deepEqual([por['ultron:r1'].estado, por['ultron:r1'].fazendo], ['aguardando', 'aguarda aprovação do plano'])
  assert.deepEqual([por['ultron:r2'].estado, por['ultron:r2'].fazendo], ['executando', '2/4 etapas · Fazer a coisa'])
  assert.equal(por['ultron:r3'].estado, 'executando')
  assert.equal(por['ultron:r4'].estado, 'pausado')
  assert.deepEqual([por['ultron:r1'].tipo, por['ultron:r1'].nome, por['ultron:r1'].sessao], ['ultron', 'Ultron', 'r1'])
}))

test('Ultron com o batimento parado ou ausente fica sem_sinal', com(a => {
  a.run('velho', { status: 'running' }, NOW - 6000)
  a.run('semmod', { status: 'running', updatedAt: NOW - 60_000 })
  assert.deepEqual(a.lista().map(x => x.estado), ['sem_sinal', 'sem_sinal'])
}))

test('Ultron abandonado (sem batimento nem mudança há mais de 24 h) sai da galeria e não esconde a sessão', com(a => {
  const DIA = 24 * 60 * 60_000
  a.run('ontem', { status: 'running', updatedAt: NOW - DIA + 60_000 }, NOW - DIA + 60_000)
  a.run('velha', { status: 'awaiting_approval', updatedAt: NOW - DIA - 1 }, NOW - 3 * DIA)
  a.run('semdata', { status: 'running' }) // sem updatedAt: vale a hora do arquivo
  const doisDias = (NOW - 2 * DIA) / 1000
  utimesSync(join(a.ultronHome, 'runs', 'semdata', 'run.json'), doisDias, doisDias)
  a.run('viva', { status: 'running', updatedAt: NOW - 3 * DIA }, NOW - 1000) // batimento vivo vale mais que a data
  a.sessao(10, { sessionId: 'velha' })
  assert.deepEqual(a.lista().map(x => [x.id, x.estado]), [['ultron:viva', 'executando'], ['sessao:velha', 'ocioso'], ['ultron:ontem', 'sem_sinal']])
}))

test('atualizadoEm no futuro também é sem sinal', com(a => {
  a.presenca('f.json', { nome: 'F', estado: 'executando', atualizadoEm: NOW * 1000 })
  a.presenca('g.json', { nome: 'G', estado: 'executando', atualizadoEm: NOW + 1000 })
  assert.deepEqual(a.lista().map(x => [x.id, x.estado]), [['g', 'executando'], ['f', 'sem_sinal']])
}))

test('arquivo grande demais é ignorado sem ler tudo, e projetos têm teto', com(a => {
  a.presenca('enorme.json', JSON.stringify({ nome: 'Enorme', atualizadoEm: NOW, lixo: 'x'.repeat(JSON_MAX) }))
  a.presenca('p.json', { nome: 'P', atualizadoEm: NOW, projetos: Array.from({ length: 500 }, (_, i) => ({ repo: `r/${i}` })) })
  const lista = a.lista()
  assert.deepEqual(lista.map(x => x.id), ['p'])
  assert.equal(lista[0].projetos.length, 20)
}))

test('avatar que não é PNG de verdade (ex.: link duro para uma credencial) nunca sai', com(a => {
  writeFileSync(join(a.raiz, 'credencial.json'), '{"token":"segredo"}')
  linkSync(join(a.raiz, 'credencial.json'), join(a.claudeDir, 'agentes', 'duro.png'))
  writeFileSync(join(a.claudeDir, 'agentes', 'texto.png'), 'não sou png')
  a.presenca('d.json', { nome: 'D', atualizadoEm: NOW, avatar: 'duro.png' })
  a.presenca('t.json', { nome: 'T', atualizadoEm: NOW, avatar: 'texto.png' })
  assert.ok(a.lista().every(x => x.avatar === null))
  assert.equal(respostaAvatar(a.claudeDir, 'duro.png').status, 404)
  assert.equal(respostaAvatar(a.claudeDir, 'texto.png').status, 404)
  writeFileSync(join(a.claudeDir, 'agentes', 'ok.png'), PNG)
  assert.deepEqual(respostaAvatar(a.claudeDir, 'ok.png'), { status: 200, body: PNG })
}))

test('link simbólico em agentes/ nunca é seguido (presença nem avatar)', async t => {
  const a = ambiente()
  try {
    writeFileSync(join(a.raiz, 'fora.json'), JSON.stringify({ nome: 'Fora', atualizadoEm: NOW }))
    writeFileSync(join(a.raiz, 'fora.png'), PNG)
    try {
      symlinkSync(join(a.raiz, 'fora.json'), join(a.claudeDir, 'agentes', 'link.json'), 'file')
      symlinkSync(join(a.raiz, 'fora.png'), join(a.claudeDir, 'agentes', 'link.png'), 'file')
    } catch (err) {
      if (err.code === 'EPERM') return t.skip('sem permissão para criar link simbólico (Windows sem modo de desenvolvedor)')
      throw err
    }
    a.presenca('p.json', { nome: 'P', atualizadoEm: NOW, avatar: 'link.png' })
    assert.deepEqual(a.lista().map(x => [x.id, x.avatar]), [['p', null]])
    assert.equal(respostaAvatar(a.claudeDir, 'link.png').status, 404)
  } finally {
    a.limpa()
  }
})

test('junção em agentes/ não deixa sair da pasta', com(a => {
  writeFileSync(join(a.raiz, 'fora.png'), PNG)
  symlinkSync(a.raiz, join(a.claudeDir, 'agentes', 'jun'), 'junction')
  for (const nome of ['jun/fora.png', 'jun\\fora.png', 'jun']) assert.equal(respostaAvatar(a.claudeDir, nome).status, 404, nome)
}))

test('pid 0 ou negativo não conta como vivo', () => {
  for (const pid of [0, -1, 1.5, NaN]) assert.equal(pidVivoPadrao(pid), false, String(pid))
})

test('a ordem é aguardando, executando, pausado, ocioso, sem sinal, e depois por nome', com(a => {
  const p = (id, estado, atualizadoEm = NOW) => a.presenca(`${id}.json`, { nome: id, estado, atualizadoEm })
  p('z-sem', 'ocioso', 0)
  p('b-ocioso', 'ocioso')
  p('a-ocioso', 'ocioso')
  p('c-pausado', 'pausado')
  p('d-exec', 'executando')
  p('e-aguarda', 'aguardando')
  assert.deepEqual(a.lista().map(x => x.id), ['e-aguarda', 'd-exec', 'c-pausado', 'a-ocioso', 'b-ocioso', 'z-sem'])
}))

test('.key, .env e .credentials nunca são abertos, e o que quebraria o parse não atrapalha', com(a => {
  const veneno = '{"sessionId":"vaza","pid":1,"status":"busy"}'
  writeFileSync(join(a.claudeDir, 'sessions', '10.abc123.key'), veneno)
  writeFileSync(join(a.claudeDir, 'agentes', '.env'), veneno)
  writeFileSync(join(a.claudeDir, 'agentes', '.credentials.json'), veneno)
  writeFileSync(join(a.claudeDir, 'agentes', 'x.key'), veneno)
  mkdirSync(join(a.claudeDir, 'sessions', '99.json')) // diretório com cara de arquivo
  a.sessao(10, {})
  assert.deepEqual(a.lista().map(x => x.id), ['sessao:s-10'])
}))

test('pastas que não existem dão lista vazia; helpers padrão', () => {
  assert.deepEqual(listarAgentes({ claudeDir: join(tmpdir(), 'nao-existe-torre'), ultronHome: join(tmpdir(), 'nao-existe-torre-u') }), [])
  assert.equal(pidVivoPadrao(process.pid), true)
  assert.equal(pidVivoPadrao(2 ** 22 + 12345), false)
  const antes = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = 'X:\\cfg'
  assert.equal(claudeDirPadrao(), 'X:\\cfg')
  if (antes === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = antes
})

// --- servidor ---

const amb = ambiente()
const PORT = 46000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
let server
before(async () => {
  const env = { ...process.env, ULTRON_HOME: amb.ultronHome, ULTRON_PORT: String(PORT), CLAUDE_CONFIG_DIR: amb.claudeDir }
  server = spawn(process.execPath, [join(ROOT, 'dashboard', 'server.mjs')], { env, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('server did not start')
})
after(() => {
  server?.kill()
  amb.limpa()
})

/** GET com o caminho exatamente como escrito (o fetch normalizaria os `..`). */
const cru = path =>
  new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: PORT, path, headers: { host: `127.0.0.1:${PORT}` } }, res => {
      const partes = []
      res.on('data', c => partes.push(c))
      res.on('end', () => resolve({ status: res.statusCode, tipo: res.headers['content-type'], nosniff: res.headers['x-content-type-options'], corpo: Buffer.concat(partes) }))
    }).on('error', reject).end()
  })

test('servidor: um agente novo aparece só por escrever o arquivo de presença', async () => {
  const antes = await (await fetch(`${BASE}/api/torre/agentes`)).json()
  assert.deepEqual(antes.agentes, [])
  assert.equal(typeof antes.geradoEm, 'number')
  amb.presenca('novo.json', { nome: 'Novo', papel: 'teste', estado: 'executando', fazendo: 'olá', atualizadoEm: Date.now() })
  const depois = await (await fetch(`${BASE}/api/torre/agentes`)).json()
  assert.deepEqual(depois.agentes.map(a => [a.id, a.estado]), [['novo', 'executando']])
})

const config = v => writeFileSync(join(amb.ultronHome, 'config.json'), JSON.stringify(v))
const primeiroQuadro = async () => {
  const ctrl = new AbortController()
  const r = await fetch(`${BASE}/api/torre/stream`, { signal: ctrl.signal })
  const { value } = await r.body.getReader().read()
  ctrl.abort()
  return JSON.parse(new TextDecoder().decode(value).slice(6))
}

test('servidor: sessões ficam fora por padrão, no GET e no stream; presença continua', async () => {
  amb.sessao(process.pid, { sessionId: 'viva', cwd: 'C:\\segredo\\pasta-x', status: 'busy' })
  const { agentes } = await (await fetch(`${BASE}/api/torre/agentes`)).json()
  assert.ok(!agentes.some(a => a.tipo === 'sessao'))
  assert.ok(agentes.some(a => a.id === 'novo'))
  assert.ok(!(await primeiroQuadro()).agentes.some(a => a.tipo === 'sessao'))
})

test('servidor: torre.sessoes true na config traz as sessões, sem reiniciar, sem o caminho inteiro; false tira de novo', async () => {
  config({ torre: { sessoes: true } })
  const { agentes } = await (await fetch(`${BASE}/api/torre/agentes`)).json()
  const s = agentes.find(a => a.id === 'sessao:viva')
  assert.equal(s.pasta, 'pasta-x')
  assert.ok(!JSON.stringify(agentes).includes('segredo'))
  assert.ok((await primeiroQuadro()).agentes.some(a => a.id === 'sessao:viva'))
  config({ torre: { sessoes: 'sim' } }) // só true liga
  assert.ok(!(await (await fetch(`${BASE}/api/torre/agentes`)).json()).agentes.some(a => a.tipo === 'sessao'))
  config({ torre: { sessoes: false } })
  assert.ok(!(await (await fetch(`${BASE}/api/torre/agentes`)).json()).agentes.some(a => a.tipo === 'sessao'))
})

test('servidor: ligar a config com o stream aberto manda a sessão em até ~2 s', async () => {
  const ctrl = new AbortController()
  const reader = (await fetch(`${BASE}/api/torre/stream`, { signal: ctrl.signal })).body.getReader()
  try {
    await reader.read()
    config({ torre: { sessoes: true } })
    let texto = ''
    while (!texto.includes('sessao:viva')) {
      const { value, done } = await reader.read()
      assert.ok(!done, 'o stream fechou')
      texto += new TextDecoder().decode(value)
    }
  } finally {
    ctrl.abort()
    config({})
  }
})

test('servidor: o stream manda o corpo logo ao conectar', async () => {
  const ctrl = new AbortController()
  const r = await fetch(`${BASE}/api/torre/stream`, { signal: ctrl.signal })
  assert.match(r.headers.get('content-type'), /text\/event-stream/)
  const { value } = await r.body.getReader().read()
  ctrl.abort()
  const texto = new TextDecoder().decode(value)
  assert.match(texto, /^data: /)
  assert.ok(JSON.parse(texto.slice(6)).agentes.some(a => a.id === 'novo'))
})

test('servidor: pelo stream, um agente novo chega em até ~2 s só por escrever o arquivo, em todas as conexões', async () => {
  const conexoes = Array.from({ length: 3 }, () => new AbortController())
  const leitores = await Promise.all(conexoes.map(async c => (await fetch(`${BASE}/api/torre/stream`, { signal: c.signal })).body.getReader()))
  try {
    for (const l of leitores) await l.read() // o corpo inicial
    const t0 = Date.now()
    amb.presenca('pelo-stream.json', { nome: 'Pelo stream', estado: 'aguardando', atualizadoEm: Date.now() })
    for (const l of leitores) {
      let texto = ''
      while (!texto.includes('pelo-stream')) {
        const { value, done } = await l.read()
        assert.ok(!done, 'o stream fechou')
        texto += new TextDecoder().decode(value)
      }
    }
    assert.ok(Date.now() - t0 < 3000, `demorou ${Date.now() - t0} ms`)
  } finally {
    for (const c of conexoes) c.abort()
  }
})

test('servidor: avatar ok, e o resto é 404', async () => {
  writeFileSync(join(amb.claudeDir, 'agentes', 'ok.png'), PNG)
  writeFileSync(join(amb.claudeDir, 'agentes', 'grande.png'), Buffer.alloc(1024 * 1024 + 1))
  writeFileSync(join(amb.claudeDir, 'agentes', 'nota.txt'), 'x')
  writeFileSync(join(amb.claudeDir, 'fora.png'), PNG)
  const ok = await cru('/api/torre/avatar/ok.png')
  assert.equal(ok.status, 200)
  assert.equal(ok.tipo, 'image/png')
  assert.equal(ok.nosniff, 'nosniff')
  assert.deepEqual(ok.corpo, PNG)
  writeFileSync(join(amb.raiz, 'segredo.txt'), 'SEGREDO')
  linkSync(join(amb.raiz, 'segredo.txt'), join(amb.claudeDir, 'agentes', 'duro.png'))
  for (const p of ['duro.png', 'CON.png', 'NUL.png', 'ok.png:stream', 'ok.png%3Astream', 'C:%5Cx.png', 'OK.PNG', '%252e%252e%252ffora.png', '../fora.png', '%2e%2e/fora.png', '..%2Ffora.png', '%2e%2e%2ffora.png', '..%5Cfora.png', '..\\fora.png', 'ok.jpg', 'nota.txt', 'grande.png', 'nao-existe.png', 'ok.png%00', '%zz.png', '..png', 'a%2Fb.png'])
    assert.equal((await cru(`/api/torre/avatar/${p}`)).status, 404, p)
  assert.equal((await cru('/api/torre/avatar/')).status, 404)
})

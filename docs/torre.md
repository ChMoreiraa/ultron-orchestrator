# Torre de controle

> Especificação. Implementadas: T4 (custo real na run do Ultron), protocolo de presença v2 e T1 (galeria); o resto ainda não. Autor: Carlos Henrique Moreira Gonçalves.

## O que é

O Ultron orquestra **uma tarefa dentro de uma sessão** do Claude Code. A torre orquestra **a máquina inteira**:
mostra, num só lugar, todos os agentes e todas as sessões abertas, o que cada um está fazendo agora, o que já
entregou e quanto custou. O Ultron é um dos agentes que a torre enxerga.

**Para quem:** quem roda vários agentes e várias sessões do Claude Code ao mesmo tempo e perdeu a noção de quem
está fazendo o quê.

**O que ela não faz (por enquanto):** não executa nem delega trabalho, não sai da máquina (nada de nuvem nem de
várias máquinas) e não substitui o painel lateral de cada sessão.

## Onde fica

- Código em `torre/`, separado do código do Ultron. O servidor do dashboard (`dashboard/server.mjs`) só monta as
  rotas da torre; a torre não importa nada de `core/` além do que precisar para ler uma run.
- A interface é uma aba **Agentes** no mesmo dashboard (`http://127.0.0.1:4477`), ao lado da jornada da run.

## Vocabulário

| termo | o que é |
|---|---|
| **sessão** | uma aba do Claude Code aberta na máquina |
| **agente** | quem trabalha: um mod que fica ligado, uma sessão com papel fixo, um serviço local ou o próprio Ultron |
| **presença** | o arquivo em que um agente diz o próprio estado (`~/.claude/agentes/<id>.json`) |
| **run** | uma jornada do Ultron (`~/.claude/ultron/runs/<sessão>/run.json`) |
| **passo** | uma ação de uma sessão: ler, editar, rodar um comando, chamar um subagente, perguntar |

## Fontes de dados (todas locais, só leitura)

| fonte | o que dá | observação |
|---|---|---|
| `~/.claude/agentes/*.json` | quem existe, estado, o que faz, projetos | protocolo abaixo; arquivo parado há mais de 2 min = "sem sinal" |
| `~/.claude/sessions/<pid>.json` | quais sessões estão abertas, pasta, `busy`/`idle`/`waiting` e o motivo da espera | formato interno do Claude Code, sem garantia: a leitura tolera campo faltando e arquivo pela metade |
| `~/.claude/projects/<projeto>/<sessão>.jsonl` | cada pedido, cada passo, o texto do agente, o **modelo e os tokens de cada resposta** e a hora | lê só o fim do arquivo (até 512 KB) e acompanha o que é acrescentado |
| `~/.claude/ultron/runs/<sessão>/` | plano, ondas, etapas, modelo e effort por etapa, tokens por etapa | já é o formato do Ultron |

A torre **nunca** lê `.env`, `.key`, `.credentials*` nem nada fora dessas pastas.

## Protocolo de presença v2

Compatível com o v1 (os quatro primeiros campos já existem). Tudo novo é opcional.

```json
{
  "id": "revisora",
  "nome": "Revisora",
  "papel": "revisa PRs",
  "estado": "executando",
  "fazendo": "revisando a PR #103",
  "fila": 2,
  "atualizadoEm": 1798000000000,
  "erro": null,
  "avatar": "revisora.png",
  "sessao": "c5af4031-…",
  "projetos": [
    { "repo": "dono/app", "item": "#103", "titulo": "Corrige o login", "estado": "revisando", "link": "https://github.com/dono/app/pull/103" }
  ]
}
```

- `estado`: `ocioso`, `executando`, `aguardando` (espera a pessoa), `pausado`.
- `avatar`: um PNG na mesma pasta. Sem ele, a torre desenha as iniciais.
- `sessao`: liga o agente à sessão em que trabalha, para o perfil mostrar os passos ao vivo.
- `fazendo` é uma linha curta e **nunca** um comando inteiro: um comando pode carregar segredo.
- Sessão sem arquivo de presença aparece mesmo assim, como agente "sessão", com o nome da pasta e o título.
- `id` é opcional: sem ele, vale o nome do arquivo sem `.json` (é o caso de todo arquivo v1). Campos desconhecidos
  são ignorados.

## Contrato da T1

Código em `torre/agentes.mjs` (Node, sem dependências). `listarAgentes({ claudeDir, ultronHome, now, pidVivo })`
devolve a lista já ordenada; as dependências entram por parâmetro para os testes. `claudeDir` é
`CLAUDE_CONFIG_DIR` ou `~/.claude`; `ultronHome` é o `HOME` de `bin/lib/store.mjs`.

```ts
type Agente = {
  id: string            // presença: id ou nome do arquivo; sessão: "sessao:<sessionId>"; Ultron: "ultron:<sessionId>"
  tipo: 'presenca' | 'sessao' | 'ultron'
  nome: string          // presença: nome ou id; sessão: name ou pasta; Ultron: "Ultron"
  papel: string | null
  estado: 'aguardando' | 'executando' | 'pausado' | 'ocioso' | 'sem_sinal'
  fazendo: string | null // uma linha, sem quebras, cortada em 120 caracteres
  fila: number | null
  erro: string | null
  atualizadoEm: number | null
  avatar: string | null  // "/api/torre/avatar/<arquivo>.png", só se o arquivo existir
  sessao: string | null
  pasta: string | null   // só o nome da pasta (basename do cwd), nunca o caminho inteiro
  projetos: { repo: string; item: string | null; titulo: string | null; estado: string | null; link: string | null }[]
}
```

Regras:

- **Presença:** só `<claudeDir>/agentes/*.json`. Arquivo pela metade ou inválido é ignorado. `estado` fora da lista
  vira `ocioso`; `atualizadoEm` ausente ou a mais de 2 min de agora (para trás ou para a frente) vira `sem_sinal`.
  Texto que não for string vira `null`; `link` só se começar com `https://` ou `http://`; `projetos` até 20.
- **Sessões:** só `<claudeDir>/sessions/*.json`, e só as de processo vivo (`pidVivo(pid)`). `status`: `busy` →
  `executando` ("trabalhando"), `waiting` → `aguardando` ("esperando você"), o resto → `ocioso`. Sessão citada no
  `sessao` de uma presença, ou que tenha run do Ultron listada, não aparece de novo.
- **Ultron:** uma entrada por `<ultronHome>/runs/<sessão>/run.json` que não terminou (`done`, `failed` e `cancelled`
  ficam fora). `awaiting_approval` → `aguardando` ("aguarda aprovação do plano"); `approved`/`running` →
  `executando` ("<feitas>/<total> etapas · <objetivo>"); `paused` → `pausado`; batimento do mod parado → `sem_sinal`.
  **Abandono:** sem batimento e com o último sinal (o maior entre o batimento e o `updatedAt` da run, ou a hora do
  arquivo sem `updatedAt`) há mais de 24 h, a run sai da galeria (sessão fechada sem `finish` nunca termina) e deixa
  de esconder a sessão. Ela continua no seletor da aba Jornada.
- **Ordem:** aguardando, executando, pausado, ocioso, sem sinal; depois por nome.
- **Nunca** abre outro arquivo: nada de `.key`, `.env`, `.credentials*`, nem `.jsonl` nesta fase. Só arquivo comum
  (link simbólico ou junção é ignorado) e com teto de tamanho, conferido antes de ler: 256 KB para presença, sessão
  e `mod.json`, 4 MB para `run.json`. O que passar disso é ignorado.

Rotas (só `GET`, mesmas regras de loopback e `Host` do resto do servidor):

- `/api/torre/agentes` → `{ agentes: Agente[], geradoEm: number }`.
- `/api/torre/stream` → SSE; confere a cada 2 s e manda `data: <mesmo corpo>` quando algo muda (e logo ao conectar).
  Um só relógio para todas as conexões: a leitura das pastas não cresce com o número de abas.
- `/api/torre/avatar/<arquivo>.png` → só nome que case com `^[A-Za-z0-9._-]+\.png$`, sem `..`, resolvido dentro de
  `<claudeDir>/agentes/` (também depois de resolver links), arquivo comum, até 1 MB e começando com a assinatura de
  PNG (um link duro para outro arquivo não sai como imagem); `image/png` com `nosniff`. Qualquer outra coisa é 404.
  O `avatar` da lista só aponta para arquivo que passa nessas mesmas checagens, e a tela só usa em `src` o que
  começar com `/api/torre/avatar/`.

Tela (revista em 05/11/2026, pedido do Carlos): **sem abas**. Os agentes ficam numa **lista lateral à esquerda da
Jornada**, como a lista de conversas do WhatsApp: por linha, a foto (avatar ou iniciais num círculo de cor fixa por
`id`), o nome, a prévia de uma linha (`fazendo`, ou o papel quando não houver), a hora de `atualizadoEm` (HH:MM hoje,
DD/MM antes) e o ponto de estado; quem está `aguardando` ganha um selo em destaque, como mensagem não lida. A linha
aberta fica marcada.

- **Ultron** (as runs) é a "conversa" padrão: clicar abre a jornada daquela sessão, como o seletor de sessão faz.
- **Outro agente:** clicar troca o painel da direita pelo **perfil** do agente com o que a presença dá: foto grande,
  nome, papel, estado, `fazendo`, `fila`, `erro`, `projetos` (com link), sessão e "atualizado há". O perfil completo
  ao vivo (passos, linha do tempo, custo) é a T2. O perfil aberto fica na URL (`#agente=<id>`); sem ele, a jornada.
- Tela estreita (celular): a lista vira uma faixa horizontal de fotos acima do painel.

**Sessões na lista:** a config pessoal decide (`~/.claude/ultron/config.json`, `torre.sessoes`, padrão `false`).
Desligado, o servidor não devolve agentes `tipo: 'sessao'`; a presença e o Ultron aparecem sempre.

**Hashiras:** não têm mod próprio. O mod do Higuruma (fora deste repositório) escreve, a cada aviso de presença,
`~/.claude/agentes/hashira-<nome>.json` para os 10 Hashiras (M0 Rengoku … M9 Zenitsu): `nome`, `papel`
("Hashira M<n> · ouvidoria-controller"), `estado` `executando` (ou `aguardando`, se a aba pede permissão) quando uma aba
da ouvidoria está numa issue da milestone dele, senão `ocioso`; `fazendo` "#<n> <título>" ou "sem missão"; `sessao`
da aba; `avatar` `hashira-<nome>.png` quando existir. Fotos são fan art: ficam em `~/.claude/agentes/`, nunca aqui.

## Funcionalidades

### T1. Galeria de agentes

Uma grade com o avatar de cada agente, um ponto de estado (executando, aguardando, ocioso, sem sinal) e o
`fazendo` embaixo. Agentes que esperam a pessoa vêm primeiro.

**Pronto quando:** um agente novo aparece na galeria só por escrever o arquivo de presença, sem mudar código.

### T2. Perfil ao vivo

Clicar no avatar abre o perfil, com:

1. **Missão:** o pedido que a sessão recebeu, numa linha.
2. **Agora:** o passo atual em linguagem simples ("Editando `server.mjs`", "Rodando os testes",
   "⏸ Esperando você aprovar um comando"). Comando de shell aparece só pela `description` da chamada.
3. **Por quê:** a última explicação que o agente escreveu antes de agir.
4. **Progresso:** as etapas da run do Ultron, se houver; senão, a lista de tarefas da sessão.
5. **Entregas:** arquivos alterados, commits, PRs abertas e testes que passaram na sessão.
6. **Linha do tempo:** os últimos passos com hora; um clique abre o detalhe.
7. **Projetos:** o campo `projetos` da presença, com link.
8. **Custo da sessão até agora** (ver T3).

Ao vivo por *server-sent events*, como o stream da run (`/api/runs/:sessão/stream`).

**Pronto quando:** com uma sessão trabalhando, o "Agora" muda em menos de 2 s depois de cada passo.

### T3. Gasto e economia

- **Gasto:** cada resposta do transcript traz o modelo e os tokens (entrada, saída, leitura e escrita de cache).
  Gasto = tokens × preço do modelo. Somado por sessão, por agente, por projeto e por dia.
- **Economia:** só nas etapas de runs do Ultron, onde houve escolha de modelo. Economia = o que a etapa custaria
  no tier forte com os mesmos tokens − o que custou.
- **Rótulos obrigatórios na tela:**
  - "equivalente à API": num plano por assento a fatura é fixa; o número serve para comparar.
  - "estimativa" na economia: outro modelo usaria outra quantidade de tokens.
- **Preços** na config (`~/.claude/ultron/config.json`, chave `precos`, por modelo, em US$ por milhão de tokens), com
  a data em que foram conferidos na página oficial. Modelo sem preço conta tokens e mostra "sem preço".

**Pronto quando:** o total da semana bate, com diferença de até 1%, com a soma feita à mão a partir dos transcripts.

### T4. Custo real na run do Ultron

O painel "Consumo" do dashboard deixa de mostrar só o peso relativo do tier e passa a mostrar o custo de cada
etapa e da run, e a economia contra rodar tudo no tier forte. Mesma tabela de preços da T3.

**Implementada** (5/11/2026): `runCost` em `core/run-core.ts`, preços do `config.json` via servidor, painel Consumo com custo, economia e lista por etapa.

### T5. Resumo em linguagem natural (opcional, desligado por padrão)

A cada minuto, para a sessão aberta no perfil, um modelo barato lê os últimos passos e escreve duas frases sobre o
que o agente está tentando fazer e onde está. Fica desligado por padrão porque manda trechos do transcript para o
modelo. Liga por sessão e mostra o próprio custo.

## Segurança e privacidade

- Mesmo servidor e mesmas regras do dashboard: só loopback, `Host` conferido, comandos só por `POST` da própria
  página. Nesta fase a torre não tem comandos: é só leitura.
- Nenhum comando de shell inteiro na tela; nenhum arquivo de credencial lido.
- Nada sai da máquina, exceto o T5 quando ligado.
- Configuração pessoal (nomes, repositórios, avatares) fica em `~/.claude/`, nunca neste repositório.

## Ordem de entrega

1. **T4**: custo real na run (o dado já existe; menor passo com resultado visível).
2. **Protocolo v2 + T1**: galeria.
3. **T2**: perfil ao vivo.
4. **T3**: gasto e economia de todas as sessões.
5. **T5**: resumo opcional.

Cada passo com testes no padrão do repositório (`tests/node/*.spec.mjs` para servidor e cálculo, `tests/*.test.tsx` para o mod).

## Perguntas em aberto

- Economia: comparar com o tier forte no **mesmo effort** da etapa ou no effort máximo?
- Quanto histórico de gasto guardar, e onde (recalcular dos transcripts ou manter um resumo por dia)?
- O formato de `~/.claude/sessions/` é interno do Claude Code: se mudar, a torre perde as sessões sem presença.
  Vale um aviso visível quando a leitura falhar.

# Torre de controle

> Especificação. Só a T4 (custo real na run do Ultron) está implementada; o resto ainda não. Autor: Carlos Henrique Moreira Gonçalves.

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

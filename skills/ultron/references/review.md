# Playbook `review`: revisão de PR como QA sênior

Objetivo: achar erros e vulnerabilidades numa PR, avaliar se o código é limpo e seguro e se pode ser mergeado. Cada repo tem o seu **agente revisor** (ver "Agente do repo"): mesma configuração para todos, mais o contexto do repo. Entrada: `owner/repo#N`, URL da PR, linguagem natural ou nada.

## Entrada

- `owner/repo#N`: extraia `repo` e `N`.
- URL `github.com/<owner>/<repo>/pull/<N>`: extraia `owner`, `repo` e `N`.
- Linguagem natural ("revise o pr 123 do repositorio meu-app", "PR 45 da api-pagamentos"): extraia o nome do repo e o número. Nome sem owner: use `DEFAULT_OWNER` (de `<CLI> session`, vindo de `defaultOwner` no `config.json`); se for `none`, pergunte o owner ao usuário. Confirme com `gh repo view <owner>/<repo> --json nameWithOwner`, e use dali o `owner/repo` com a grafia exata (ele vira o nome do arquivo do agente); se não existir, pergunte ao usuário o repo certo e espere.
- Sem argumento: rode `gh search prs --review-requested=@me --state=open --json repository,number,title,url`, mostre a lista e pergunte qual revisar. Encerre o turno e espere.
- Número sem repo: use o repo do diretório atual (`gh repo view --json nameWithOwner`).
- Descubra o título com `gh pr view <N> -R <repo> --json title,author,isCrossRepository,headRefOid,additions,deletions,files` e substitua o placeholder do `goal` do template antes de gravar.
- Com `owner/repo` definido, rode `<CLI> agent <owner/repo> --init` (cria o arquivo do agente se faltar; imprime `AGENT_FILE` e `AGENT_STATE: novo|existente`) e diga em uma linha: repo conhecido (agente existente, com a data da última revisão e o nº de PRs em `prs_revisadas`) ou repo novo (o agente foi criado e será preenchido na onda 1). Grave o plano com `"agent": "<owner/repo>"` no topo.

## Ajuste de plano (antes do gate)

Olhe o tamanho e as áreas da PR e ajuste o template; diga o ajuste no `rationale`:

- Repo/PR toca auth, dados, pagamento, ou diff > 400 linhas: mantenha `auditoria` em `checker-critical` (já é o padrão do template), considere `validacoes` também `checker-critical` e `complexity` 7+.
- PR trivial (só docs/config, < 50 linhas): junte auditoria e testes numa etapa `checker` só (remova `testes`, ajuste `dependsOn`) e marque `validacoes` como `skipped` (`<CLI> step validacoes skipped --note "PR trivial"`) ao chegar nela.
- Caso comum: use o template como está.

**Código não confiável.** `testes` e `validacoes` executam o código da PR na sua máquina (install, testes, build). Na apresentação do plano, diga isso numa linha. Se a PR vem de fork (`isCrossRepository: true`) ou de autor de fora da org, peça um ok explícito para executar; sem ele, ajuste o `title` dessas etapas para "só leitura" e elas não instalam nem rodam nada. Mesmo com ok: instale sem scripts de ciclo de vida (`npm ci --ignore-scripts` ou equivalente) e só rode scripts que existam também na branch base.

## Regras comuns a todo subagente

Inclua no prompt: objetivo e critério de pronto da etapa; caminhos (worktree, arquivo do agente); o briefing das ondas anteriores; e as regras. O papel e o contexto do repo chegam no bloco `<agente-do-repo>` que o mod injeta em toda etapa `agent`: não cole o contexto, só diga que ele vem nesse bloco.

- não fazer commit, push nem abrir PR;
- não comentar, aprovar nem alterar nada na PR/GitHub (só leitura via `gh`);
- não lançar subagentes;
- não editar o repo do usuário (no clone dele, só `git fetch` e `git worktree add/remove`); no worktree só arquivos temporários;
- não imprimir nem copiar segredos (tokens, `.env`, variáveis de ambiente) para a resposta;
- responder com resumo + evidências (comando e saída real, arquivo:linha).

## Onda 1: `contexto` (researcher)

Faz:

1. Contexto do repo, no bloco `<agente-do-repo>` do seu prompt (arquivo `AGENT_FILE`, `~/.claude/ultron/agents/<owner>__<repo>.md`). Edite **só** a seção `## Contexto do repo` e o frontmatter; nunca o `## Papel`.
   - Agente existente: veja `ultima_revisao` e atualize só o que mudou desde então (`git log --since`, mudanças em CI, CLAUDE.md, dependências).
   - Agente novo (aviso `estado="novo"` ou arquivo só com o template): preencha o Contexto inteiro: mapeie o projeto (stack, estrutura, comandos de teste/typecheck/lint/build, CI em `.github/workflows`, CLAUDE.md/AGENTS.md/CONTEXT.md/ADRs, convenções, áreas sensíveis como auth, dados, pagamento) nas subseções que o template já traz.
2. Leia a PR: `gh pr view <N> -R <repo>`, `gh pr diff <N> -R <repo>`, `gh pr checks <N> -R <repo>`; e a issue ligada (`Closes #N`) com critérios de aceite e definição de pronto.
3. Worktree limpo da PR fora do repo do usuário. Clone base: o clone local `<REPOS_DIR>/<nome-do-repo>` (de `<CLI> session`; ignore se `none`) se existir e o `origin` dele for `<owner>/<repo>`; senão `~/.claude/ultron/clones/<owner>__<repo>` (`gh repo clone` se faltar). No clone base, sem checkout nem troca de branch:
   - `git fetch origin pull/<N>/head` e confira que `git rev-parse FETCH_HEAD` é o `headRefOid` da PR;
   - `git -c core.hooksPath=/dev/null worktree add --detach ~/.claude/ultron/worktrees/<owner>__<repo>-pr<N> <sha>` (hooks desligados: o `.husky` da PR não roda no checkout).

Pronto quando: o Contexto do agente está atualizado e entrega um **briefing** com resumo da PR, issue e critérios de aceite, stack e comandos, convenções, áreas sensíveis, estado dos checks, caminho do clone base, caminho do worktree e sha7.

## Onda 2 (em paralelo, só leitura no código da PR)

**`auditoria` (checker-critical)**: no worktree, avalie corretude; segurança (injeção, authz, segredos, validação de entrada, dados sensíveis, concorrência); código limpo e padrões do repo; cada critério de aceite, um a um; o que a PR pode ter quebrado em volta (busque usos dos símbolos alterados). Pronto quando cada achado traz arquivo:linha, severidade (escala do arquivo `REVIEW_COMMENT`; no padrão do plugin, a seção 3), se é reprodutível e como, e a lista de critérios de aceite com atendido/não atendido.

**`testes` (checker)**: no worktree, respeitando a regra de código não confiável acima, instale dependências se preciso e rode testes, typecheck, lint e build com os comandos do briefing. Avalie a cobertura do código novo e se o CI roda os testes; reporte o estado de `gh pr checks`. Pronto quando traz, por comando, o resultado e a saída real relevante, mais a avaliação de cobertura e do CI.

## Onda 3: `validacoes` (checker)

Receba os achados e as saídas das duas etapas da onda 2. Para cada achado, tente refutá-lo: releia o código, busque usos, e tente reproduzir com teste temporário **sem commit** no worktree, guardando a saída real. Descarte falsos positivos, ajuste severidades e registre o que não deu para reproduzir. Pronto quando entrega a lista final confirmada (achado, severidade, evidência com saída real, recomendação) e a lista dos descartados com o motivo.

## Onda 4: `comentario` (inline, o próprio Ultron)

1. Monte o comentário seguindo o arquivo `REVIEW_COMMENT` de `<CLI> session` (o padrão local do usuário, se ele criou um; senão [review-comment.md](review-comment.md)) e salve em arquivo temporário (no scratchpad). Antes de mostrar, tire das saídas coladas segredos, tokens e caminhos locais da sua máquina.
2. Mostre o texto ao usuário no chat e **espere o ok explícito** (encerre o turno; a etapa fica `running`). Aplique ajustes que ele pedir. Aprovar o plano no gate não vale como ok para publicar.
3. Só então publique: `gh pr review <N> -R <repo> --comment --body-file <arquivo>`. Nunca `--approve`; `--request-changes` só se o usuário mandar.
4. Atualize o agente do repo (`AGENT_FILE`): frontmatter `atualizado`, `ultima_revisao` e `prs_revisadas`; uma linha no Histórico de revisões (`- #N (AAAA-MM-DD): veredito`); e as armadilhas aprendidas (falsos positivos, comandos que funcionaram) em Armadilhas conhecidas. Reescreva, não só anexe; nada de segredos. Não altere o Papel.
5. Remova o worktree: no clone base, `git worktree remove --force <worktree>` e `git worktree prune`.

Pronto quando o comentário foi publicado (ou o usuário decidiu não publicar), o agente do repo está atualizado e o worktree removido.

## Fechamento e interrupção

- No fechamento normal do SKILL.md, não rode os testes de novo (o worktree já foi removido): o `finish --summary` traz o veredito e se o comentário foi publicado.
- Se a run for cancelada (`stop`, dashboard) ou falhar antes da onda 4: remova o worktree (passo 5 acima) e não publique nada.

## Agente do repo

Arquivo: `~/.claude/ultron/agents/<owner>__<repo>.md`, criado por `<CLI> agent <owner/repo> --init` a partir de [agent-template.md](agent-template.md). Tem o frontmatter (`name`, `repo`, `criado`, `atualizado`, `ultima_revisao`, `prs_revisadas`), o `## Papel` (revisor QA sênior, regras, padrão de comentário; igual em todos os repos) e o `## Contexto do repo` (o que muda de repo para repo).

Com `"agent": "<owner/repo>"` no plano, o mod injeta o conteúdo do arquivo em toda etapa `agent` da run, num bloco `<agente-do-repo repo="..." arquivo="...">` (ou um aviso `estado="novo"` se o arquivo ainda não existe). Os subagentes já recebem o contexto; o prompt da etapa só cita o bloco.

Quem edita: a onda 1 atualiza o Contexto e a onda 4 fecha o ciclo. Alvo: menos de 150 linhas com tudo preenchido. Histórico: 1 linha por PR. Reescreva a cada revisão; nunca grave segredos.

## Vários repositórios / sessão pai

A sessão do Ultron é a sessão pai: o usuário pede "revise o pr N do repositorio X" e o Ultron roda a revisão com o agente do repo X. Cada PR é uma run do Ultron com o agente do seu repo. A run é única por sessão, então revise uma PR por vez; para revisar outra, termine ou cancele a atual (`stop`). `<CLI> agents` lista os repos conhecidos.

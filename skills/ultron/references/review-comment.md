# Comentário de revisão de PR (QA): padrão do plugin

Este é o padrão genérico. Para usar o padrão da sua equipe (regras da organização, checks obrigatórios, tom, idioma), crie `~/.claude/ultron/review-comment.md`: quando ele existe, a skill o usa no lugar deste (`REVIEW_COMMENT` em `<CLI> session`). O que é próprio de cada repositório vai no `## Contexto do repo` do agente do repo.

## 1. Estrutura

````markdown
## Revisão de QA — <veredito>

<Abertura, 1 parágrafo: o que a PR cumpre da issue ligada (critérios, nomes em crase); o que NÃO mudou
(fluxos vizinhos que a PR poderia ter quebrado); se algo impede o merge. Se há ressalvas, termine com:
"Seguem as ressalvas, da mais importante para a menos importante.">

### 1. <Título curto do problema> (<severidade>, <recomendação>)
<Onde (`arquivo:linha`, `função`), o que acontece, qual critério ou cenário fere, quem é afetado.>

**Reproduzi** <como: teste temporário, sem commit, sobre `<sha7>`; cenário>:
```
<saída real do teste ou comando>
```
**Sugestão:** <correção em 1 frase>
```<linguagem>
<código mínimo>
```

### 2. <...> (baixa)
<Quando for óbvio, sem Reproduzi/Sugestão: 1–3 frases.>

### N. Pendência de aceite
<Critério da definição de pronto ainda em aberto (ex.: validação manual, migração aplicada) e quando
se espera que feche.>

### Como validei
- Li o diff e conferi cada critério de aceite da issue contra o código.
- Checks da PR: <quais estavam verdes>. A PR está mergeable.
- Rodei localmente, num worktree da PR (`<sha7>`):
  - `<comando de testes>`: <N arquivos, **M testes passando**>;
  - `<comando de tipos/build>`: sem erros.
- <Outras conferências: busca de usos, teste de regressão, varredura de segurança.>
````

Variações aceitas: um bloqueante em seção própria acima das ressalvas (`### Bloqueante: <título>`, com "Onde", "Reprodução", "Correção sugerida" e "Teste que peço junto"); uma tabela `| Critério | Situação |` quando a issue tem vários critérios.

## 2. Veredito e tipo da review

O veredito fica no título, depois do travessão: `sem bloqueante, com ressalvas`, `sem bloqueantes` ou `alterações solicitadas (1 bloqueante)`.

- O agente **nunca aprova nem mescla**. A review é publicada sempre como comentário (`gh pr review --comment`); quem aprova é uma pessoa. `--request-changes` só quando o usuário mandar.
- Com bloqueante, o título diz isso claramente.
- Sem emoji no título nem nas seções (um `✓`/`×` dentro de uma saída de teste colada é aceito).

## 3. Severidade e recomendação

Da mais importante para a menos importante. Formato no título: `(<severidade>, <recomendação>)`.

| Severidade | Quando | Recomendação típica |
|---|---|---|
| `bloqueante` | quebra um critério de aceite, abre falha de segurança ou regressão, impede o merge | "peço a correção antes do merge" |
| `alta` | risco real de segurança ou de dados, sem quebrar o aceite | "recomendo corrigir nesta PR" |
| `média` | falha reproduzida, de alcance limitado | "recomendo corrigir nesta PR" |
| `baixa` | CI, cobertura, higiene, documentação | "de preferência numa PR separada" |
| `informativa` | risco aceito, nota, orientação | sem ação; cite a decisão |

Prefixos para comentários curtos ou inline: `bloqueio:` (o único que trava o merge), `sugestão:`, `nit:` e `pergunta:`. Estilo nunca bloqueia; lint e formatação ficam com as ferramentas.

## 4. Tom e estilo

- Voz de colega, direta, em frases curtas e na primeira pessoa ("Li", "Rodei", "Reproduzi", "Recomendo"). Escreva no idioma do repositório; na dúvida, no idioma do usuário.
- Comece pelo que a PR cumpre e pelo que não mudou; os problemas vêm depois. Diga claramente se algo bloqueia.
- Elogio só factual ("a validação de entrada está bem fechada"), nunca por educação.
- Arquivos, funções, comandos e SHAs vão em crase, com `arquivo:linha` quando ajudar.
- Todo achado relevante traz **Reproduzi** e a saída real, com o commit curto (`sha7`). Se não deu para reproduzir, diga que é leitura de código.
- A correção é concreta: **Sugestão:** com um trecho mínimo de código ou `diff`. Num bloqueante, peça também o teste que deve vir junto.
- Seja honesto sobre o que não testou, diga se o problema já existia antes da PR e cite entre aspas o critério da issue que foi ferido.
- Revisão local sempre num worktree limpo da PR, com testes de exploração sem commit.

## 5. Exemplo curto

````markdown
## Revisão de QA — sem bloqueante, com ressalvas

A PR cumpre o que a #42 pede: o endpoint `POST /sessions` passa a recusar senhas expiradas e devolve
`401` com o código `password_expired`. O fluxo de renovação de token (`refreshSession`) e o limite de
tentativas não mudaram. Não achei nada que impeça o merge. Seguem as ressalvas, da mais importante para
a menos importante.

### 1. A data de expiração é comparada sem fuso (média, recomendo corrigir nesta PR)
Em `auth/password.ts:58`, `isExpired` compara `expiresAt` (UTC) com `new Date().toLocaleDateString()`.
Perto da meia-noite, uma senha válida pode ser recusada, o que vai contra o critério "senhas dentro do
prazo continuam aceitas".

**Reproduzi** com um teste temporário, sem commit, sobre o `a1b2c3d`:
```
✓ aceita senha que expira amanhã
× aceita senha que expira hoje às 23:30 UTC
```
**Sugestão:** comparar os instantes, sem formatar a data.
```ts
return expiresAt.getTime() <= Date.now()
```

### 2. O CI não roda os testes de integração (baixa)
`ci.yml` só roda os testes unitários. Vale incluir `npm run test:integration`, de preferência numa PR separada.

### Como validei
- Li o diff e conferi cada critério de aceite da #42 contra o código.
- Checks da PR: "build" e "lint" verdes. A PR está mergeable.
- Rodei localmente, num worktree da PR (`a1b2c3d`):
  - `npm test`: 31 arquivos, **214 testes passando**, incluindo os 5 novos;
  - `npx tsc --noEmit`: sem erros.
- A ressalva 1 foi reproduzida com o teste temporário descrito acima.
````

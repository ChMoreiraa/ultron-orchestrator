# Roteamento do Ultron

Como sair da tarefa para o plano. A tabela papel → agentType/modelo/effort vem de `<CLI> roles` (já ajustada ao perfil); aqui ficam os sinais, os playbooks e o formato do plano.

## Sinais → nota de complexidade (0–10)

Some os pontos que se aplicam:

| sinal | pontos |
|---|---|
| mexe em 1–3 arquivos de uma área | 0 |
| mexe em 4–10 arquivos ou 2+ áreas | +2 |
| mexe em 10+ arquivos, migração, refactor transversal | +4 |
| requisito ambíguo, precisa decidir arquitetura | +2 |
| risco alto: dados, auth, segurança, pagamento, produção | +2 |
| código desconhecido, precisa mapear antes | +1 |
| precisa de pesquisa externa (docs, APIs) | +1 |
| dá para dividir em partes independentes | +1 |
| sem testes para verificar | +1 |

Limite a nota a 10.

## Playbooks

Escolha o primeiro que encaixa; `review` tem precedência sobre todos (revisar uma PR nunca é `direct`, `research` nem auditoria genérica):

| playbook | quando | fluxo típico |
|---|---|---|
| `direct` | nota ≤ 2, tarefa clara | 1 etapa `inline` |
| `rescue` | algo quebrado, bug, falha de teste | scout (haiku/low) → fixer (sonnet) → checker |
| `research` | a entrega é uma resposta, não código | scouts/researchers em paralelo → síntese `inline` |
| `review` | a tarefa é revisar/auditar uma PR (achar erros e vulnerabilidades, dizer se pode mergear) | segue [review.md](review.md): contexto (via agente do repo) → auditoria + testes em paralelo → validações → comentário; template em `plans/review-pr.json` |
| `audit` | revisar/auditar muitos arquivos, só leitura | vários scouts ou checkers em paralelo, um por área → síntese `inline` |
| `scout-then-build` | nota 3–5, escopo claro | scout → builder → checker |
| `plan-build-check` | nota ≥ 6, ou ambíguo, ou risco alto | scout → planner (opus/high) → builders em paralelo por área → checker (crítico se risco alto) |

## Regras de escolha do papel

- **Builder**: `builder-simple` para mudança mecânica (renomear, ajustar config, CRUD seguindo um padrão que já existe); `builder` para o caso comum; `builder-complex` quando cruza camadas ou exige decisão de design no caminho.
- **Checker**: `checker-critical` quando o playbook ou o risco pede (dados, auth, segurança); senão `checker`.
- **Inline** (o próprio Ultron, no modelo da sessão): síntese final, integração entre etapas, decisões que precisam do contexto da conversa. Etapa inline não lança subagente.
- Prefira **menos etapas**: cada subagente começa sem contexto e paga para se orientar. Não divida o que um único builder faz bem.
- Perfil: use o de `config.json` (via `roles`), a menos que o usuário peça outro. `economia` desce um degrau, `qualidade` sobe.

## Formato do plano (`plan --file`)

```json
{
  "goal": "Adicionar endpoint /health com testes",
  "playbook": "scout-then-build",
  "profile": "equilibrado",
  "complexity": 4,
  "rationale": "Escopo claro em 2 áreas (rotas e testes); um builder sonnet dá conta, scout barato mapeia antes.",
  "steps": [
    { "id": "map", "title": "Mapear rotas e padrão de testes", "role": "scout", "wave": 1 },
    { "id": "build", "title": "Implementar /health e testes", "role": "builder", "wave": 2, "dependsOn": ["map"] },
    { "id": "check", "title": "Rodar a suíte e revisar o diff", "role": "checker", "wave": 3, "dependsOn": ["build"] }
  ]
}
```

Campos opcionais por etapa: `model`, `effort`, `agentType`, `mode` (`agent` | `inline`). Sem eles, vale o padrão do papel no perfil. `id`: minúsculas, dígitos e hífen. Uma etapa só pode depender de etapas de ondas anteriores; etapas da mesma onda rodam em paralelo.

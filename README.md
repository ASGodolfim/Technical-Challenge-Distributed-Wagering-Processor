# Distributed Wagering Processor

Motor distribuído, idempotente e resiliente para processamento de transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`, `OPENING`) e gestão de carteiras digitais com consistência contábil estrita.

Para detalhes aprofundados sobre decisões arquiteturais, locking, mapeamento ORM, taxonomia de erros e observabilidade, consulte [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Principais Garantias & Arquitetura

- **Precisão Financeira & Ledger Imutável:** Value Object `Money` operando exclusivamente em centavos inteiros (`cents`), eliminando erros de ponto flutuante. Toda movimentação de saldo gera um lançamento imutável (`CREDIT` ou `DEBIT`) em `wallet_ledger_entries`, assegurando a invariante `wallet.balance == SUM(CREDIT) - SUM(DEBIT)`.
- **Concorrência & Idempotência:** Serialização por carteira via **Pessimistic Locking (`SELECT ... FOR UPDATE`)** no PostgreSQL combinada com dupla checagem de idempotência (pré-lock e pós-lock) por `Idempotency-Key` e `(providerId, externalTransactionId)`.
- **Resiliência Assíncrona (Outbox & Inbox):**
  - **Transactional Outbox:** Eventos padronizados via `IntegrationEvent<T>` (`WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`) gravados na mesma transação SQL da operação.
  - **Worker de Reprocessamento (`PENDING_REFERENCE`):** Resolução assíncrona com backoff exponencial (`2s, 4s, 8s, 16s, 32s`) para reversões que chegam fora de ordem, marcando como `REJECTED` ao atingir o limite de tentativas.
  - **Inbox Pattern Idempotente:** Deduplicação transacional no consumidor SQS pela chave composta `(consumerName, messageId)`.
- **Observabilidade Segura:** Logs estruturados em JSON (`StructuredLogger`) com propagação automática de `correlationId`, `walletId`, `transactionId` e `providerId` via `AsyncLocalStorage`, filtrando campos monetários sensíveis.

---

## Stack Tecnológica

- **Runtime & Testes:** Bun (`bun test`)
- **Framework:** NestJS (TypeScript, arquitetura DDD em camadas)
- **Persistência & ORM:** PostgreSQL + MikroORM (migrações e `LockMode.PESSIMISTIC_WRITE`)
- **Mensageria:** AWS SQS (LocalStack via Docker Compose)

---

## Estrutura do Projeto

```text
src/
├── domain/                  # Regras financeiras puras, Money, WagerTransactionKind e IntegrationEvent<T>
├── application/             # Casos de uso transacionais (WagerService, WalletService) e DTOs
└── infrastructure/
    ├── persistence/         # Entidades MikroORM e migrações PostgreSQL
    ├── http/                # Controllers REST, AuthGuard (no-op) e decorator @Public()
    ├── messaging/           # OutboxRelayService, SqsConsumerService e PendingReferenceWorkerService
    └── observability/       # CorrelationMiddleware, AsyncLocalStorage e StructuredLogger JSON
test/
├── domain/                  # Testes unitários das regras de domínio e eventos
├── unit/                    # Testes de backoff, envelope Outbox/Inbox, AuthGuard e sanitização de logs
└── integration/             # Testes E2E com containers reais (concorrência, multi-instância e crash recovery)
```

---

## Como Executar

### 1. Pré-requisitos
- [Bun](https://bun.sh/) instalado (`v1.1+`)
- [Docker](https://www.docker.com/) e Docker Compose ativos

### 2. Instalação e Infraestrutura
```bash
# Instalar dependências
bun install

# Subir PostgreSQL e ElasticMQ (SQS local)
docker compose up -d

# Aplicar migrações no banco de dados
bunx mikro-orm migration:up
```

### 3. Iniciar a Aplicação
```bash
# Modo desenvolvimento (watch)
bun run start:dev

# Build e execução em produção
bun run build
bun run start:prod
```

---

## Endpoints da API

### Carteiras & Reconciliação
| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `POST` | `/wallets` | Cria uma carteira (`playerId` e `initialBalance` opcional; gera transação `OPENING` + `CREDIT` se `> 0`). |
| `GET` | `/wallets/:walletId` | Consulta o saldo atual e metadados da carteira. |
| `GET` | `/wallets/:walletId/ledger?cursor=...&limit=50` | Extrato paginado por cursor opaco em Base64. |
| `POST` | `/wallets/:walletId/reconciliation` | Compara `storedBalance` com a soma calculada do ledger (`consistent: boolean`). |

### Transações de Apostas (Wagering)
| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `POST` | `/wagering/transactions` | Processa `BET`, `WIN`, `LOSS`, `REFUND` ou `ROLLBACK`. Exige header `Idempotency-Key` e retorna `balance` + `idempotentReplay`. |
| `GET` | `/wagering/transactions/:transactionId` | Consulta transação pelo ID interno. |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta transação pelo identificador externo do provedor. |

### Health Checks (Públicos / `@Public()`)
| Método | Rota | Descrição |
| :--- | :--- | :--- |
| `GET` | `/health/live` | Verifica se o processo HTTP está ativo. |
| `GET` | `/health/ready` | Valida conexão ativa com PostgreSQL e fila SQS. |

---

## Suíte de Testes (`bun test`)

Com os containers do Docker ativos (`docker compose up -d`) e migrações aplicadas, execute:

```bash
bun test
```

A suíte valida:
- **Regras de Domínio & Eventos:** Aritmética de `Money`, comportamento `LOSS` sem impacto no saldo, reversões (`REFUND`/`ROLLBACK`), backoff exponencial e sanitização de logs JSON.
- **Concorrência Real (50x Burst):** 50 requisições simultâneas idênticas gerando exatamente 1 débito e 49 `idempotentReplay: true`.
- **Race Condition de Saldo:** Saldo de `R$ 100,00` disputado por duas apostas simultâneas de `R$ 80,00` (`1 PROCESSED`, `1 REJECTED` por `INSUFFICIENT_FUNDS`, saldo final `20.00`).
- **Multi-Instância:** 3 instâncias NestJS independentes disputando a mesma carteira em paralelo sem *lost updates*.
- **Crash Recovery & Invariante Contábil:** Simulação de indisponibilidade do SQS e falha do worker antes do ACK, verificando `wallet.balance == soma do ledger` ao final de todos os cenários.
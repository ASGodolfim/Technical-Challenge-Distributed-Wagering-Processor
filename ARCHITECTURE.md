# Arquitetura — Distributed Wagering Processor

Este documento detalha as decisões arquiteturais, garantias de consistência financeira, resiliência assíncrona, estratégia de autenticação, taxonomia de erros e observabilidade do processador distribuído de apostas.

---

## 1. Visão Geral & Organização em Camadas (DDD)

O serviço segue **Domain-Driven Design (DDD)** com isolamento estrito entre regras financeiras puras e detalhes de transporte/persistência:

- **`src/domain/`**: Regras financeiras determinísticas e imutáveis (`Money`, `WagerTransactionKind`, `IntegrationEvent<T>` e eventos de domínio), sem dependências de framework HTTP ou ORM.
- **`src/application/`**: Casos de uso transacionais (`WagerService`, `WalletService`) e contratos de entrada/saída (`DTOs`).
- **`src/infrastructure/`**:
  - `persistence/`: Entidades MikroORM, migrações PostgreSQL e controle de travamento transacional.
  - `http/`: Controllers REST, decorators (`@Public()`) e guarda de autenticação (`AuthGuard`).
  - `messaging/`: Relay da Transactional Outbox, consumidor SQS com Inbox Pattern e worker de reprocessamento de `PENDING_REFERENCE`.
  - `observability/`: Propagação de contexto (`AsyncLocalStorage`) e `StructuredLogger` em JSON.

---

## 2. Estratégia de Autenticação

### 2.1. Localização no Código (No-Op Guard)
- **Guard:** `src/infrastructure/http/guards/auth.guard.ts` (`AuthGuard`), registrado globalmente via `APP_GUARD` em `src/app.module.ts`.
- **Exceção de Health Check:** `src/infrastructure/http/decorators/public.decorator.ts` (`@Public()`), aplicado em `HealthController` (`src/infrastructure/http/health.controller.ts`), garantindo que sondas de infraestrutura (`/health/live` e `/health/ready`) operem sem credenciais.
- **Comportamento Atual:** O `AuthGuard` atua intencionalmente como *no-op* (`return true`) para facilitar os testes integrados automatizados sem dependências externas de KMS/Secrets Manager, mantendo o pipeline de autorização ativo.

### 2.2. Desenho Proposto para Produção (B2B Provider Integration)
Em produção, provedores de jogos (Pragmatic, Evolution, Hacksaw, etc.) comunicam-se servidor-a-servidor com a carteira. O `AuthGuard` deve validar:
1. **Assinatura HMAC-SHA256 por Provedor:** Headers `X-Provider-Id`, `X-Timestamp` (janela máxima de drift de 30s contra *replay attacks*) e `X-Signature = HMAC_SHA256(secret_do_provedor, timestamp + "." + rawBody)`.
2. **mTLS + Allowlist de IP:** Terminação TLS mútua no API Gateway / Ingress para isolar tráfego de provedores parceiros.
3. **RBAC por Escopo:** Segregação entre chaves de provedores (`wagering:write`, `wagering:read`) e chaves internas de backoffice (`wallets:create`, `wallets:reconcile`).

---

## 3. Controle de Concorrência (`Pessimistic Locking FOR UPDATE`)

### 3.1. Problema
Em sistemas de iGaming, múltiplas requisições concorrentes atingem a mesma carteira simultaneamente:
- **Rajadas idênticas (retries de rede):** O mesmo `Idempotency-Key` ou `(providerId, externalTransactionId)` chega em paralelo antes do primeiro commit.
- **Disputa de saldo (race condition):** Duas apostas distintas (ex.: R$ 80,00 cada) disputam um saldo de R$ 100,00 em instâncias diferentes da API.

### 3.2. Decisão Arquitetural e Justificativa
Adotamos **Pessimistic Locking (`SELECT ... FOR UPDATE`)** diretamente sobre o registro da `WalletEntity` dentro da transação SQL (`LockMode.PESSIMISTIC_WRITE`):

1. **Serialização por Carteira sem Contenção Global:** O lock bloqueia apenas a linha específica do `walletId` envolvido, permitindo paralelismo total entre carteiras de jogadores distintos.
2. **Prevenção de *Lost Updates* e Saldo Negativo:** A segunda transação concorrente aguarda o commit da primeira no PostgreSQL e lê o saldo já atualizado, rejeitando apostas sem saldo (`INSUFFICIENT_FUNDS`) de forma determinística.
3. **Dupla Checagem de Idempotência (Pre-Lock + Post-Lock):**
   - *Antes do lock:* Retorno rápido (`idempotentReplay: true`) para requisições já comitadas.
   - *Imediatamente após adquirir o `FOR UPDATE`:* Nova consulta por `(idempotencyKey)` ou `(providerId, externalTransactionId)` garante que rajadas simultâneas de 50+ requisições idênticas aguardem a primeira transação comitar e retornem `idempotentReplay: true` sem violar constraints `UNIQUE`.
4. **Superioridade frente a Optimistic Locking (`version`) neste domínio:** Sob alta contenção na mesma rodada de jogo, *Optimistic Locking* geraria falhas de conflito (`OptimisticLockError`) exigindo retries complexos no cliente ou na aplicação. O `FOR UPDATE` enfileira naturalmente as operações daquela carteira no banco com latência previsível.

---

## 4. Escolha do ORM (`MikroORM`) e Mapeamento de `Money`

### 4.1. Por que MikroORM?
- **Unit of Work e Identity Map por Contexto (`em.fork()`):** Garante que todas as mutações (`WalletEntity`, `WagerTransactionEntity`, `WalletLedgerEntryEntity`, `OutboxMessageEntity`) dentro de `em.transactional(...)` sejam persistidas atomicamente em um único `COMMIT` SQL.
- **Suporte Nativo a `LockMode.PESSIMISTIC_WRITE`:** Integração direta com `FOR UPDATE` do PostgreSQL sem necessidade de SQL bruto propenso a erros.
- **Migrações Determinísticas:** Controle explícito de schema e constraints compostas (`UNIQUE (provider_id, external_transaction_id)`, `UNIQUE (consumer_name, message_id)`).

### 4.2. Representação e Mapeamento do Value Object `Money`
Operações financeiras em ponto flutuante (`number` / `float` / `double`) sofrem erros de precisão binária (ex.: `0.1 + 0.2 !== 0.3`). Para eliminar qualquer divergência contábil:

- **No Domínio (`src/domain/money.ts`):** `Money` é um Value Object imutável que converte strings decimais estritas (`"25.00"`) para **inteiros em centavos (`cents: number`)** usando aritmética inteira validada (`Number.isSafeInteger`), impondo também validação de moeda (`currency`) em toda soma ou subtração.
- **Na Persistência (`DECIMAL(18, 2)` / `string`):** Os valores são armazenados no PostgreSQL como `numeric(18,2)` e hidratados no MikroORM como `string` (`"25.00"`), preservando exatidão decimal ponta-a-ponta sem conversão intermediária para `float`.
- **Invariante Contábil:** A cada movimentação (`BET`, `WIN`, `REFUND`, `ROLLBACK`, `OPENING`), um lançamento imutável (`CREDIT` ou `DEBIT`) é gravado em `wallet_ledger_entries`, garantindo que `wallet.balance == SUM(CREDIT) - SUM(DEBIT)` seja verificável a qualquer momento via `POST /wallets/:walletId/reconciliation`.

---

## 5. Taxonomia de Erros (`failureCode`)

A API distingue **erros de contrato/sintaxe HTTP** (que retornam status HTTP `400`/`409` sem gravar transação) de **rejeições de negócio idempotentes** (que retornam HTTP `200`/`201` com `status: "REJECTED"` e `failureCode` persistido na transação e publicado no evento `WagerTransactionRejected`).

| `failureCode` | Origem | Causa de Negócio | Impacto no Saldo / Ledger |
| :--- | :--- | :--- | :--- |
| `INSUFFICIENT_FUNDS` | `WagerService` (`BET`) | Saldo atual da carteira é menor que o valor da aposta solicitada. | Nenhum (`0` lançamentos no ledger). |
| `INSUFFICIENT_FUNDS_FOR_ROLLBACK` | `WagerService` / `PendingReferenceWorker` (`ROLLBACK` de `WIN`/`REFUND`) | O jogador já gastou os ganhos da transação original e o saldo atual não cobre o estorno. | Nenhum (`0` lançamentos no ledger). |
| `REFERENCE_TRANSACTION_NOT_FOUND` | `PendingReferenceWorkerService` | Uma transação `REFUND` ou `ROLLBACK` chegou fora de ordem (`PENDING_REFERENCE`), mas a transação original não chegou após o limite máximo de tentativas exponenciais (5 retries). | Nenhum (`0` lançamentos no ledger). |
| `INVALID_REFERENCE_TRANSACTION` | `PendingReferenceWorkerService` | A transação referenciada foi encontrada assincronamente, porém seu estado não é `PROCESSED`, já foi revertida anteriormente ou possui divergência de `walletId`, `playerId`, `roundId` ou `currency`. | Nenhum (`0` lançamentos no ledger). |

### Erros HTTP de Contrato e Validação (Pré-Persistência)
- **`400 Bad Request`**: Ausência do header `Idempotency-Key`, carteira inexistente, moeda inválida ou tentativa de reverter transação em estado inválido.
- **`409 Conflict`**: Reutilização de um `Idempotency-Key` existente com payload divergente.

### Algoritmo de `payloadHash` Canônico (Detecção de Conflito)
Para garantir determinismo independente da ordem das chaves enviadas pelo provedor ou de metadados de transporte, o `payloadHash` (`computeCanonicalPayloadHash` em `src/application/services/wager.service.ts`) é gerado em 4 etapas:
1. **Extração do Subconjunto de Negócio:** Seleciona exclusivamente `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money` (`amount`, `currency`) e `referenceExternalTransactionId` (`null` quando ausente). Headers HTTP (`Idempotency-Key`, `X-Correlation-Id`) e metadados de transporte (`correlationId`) são explicitamente descartados.
2. **Ordenação Recursiva:** Ordena alfabeticamente todas as chaves do objeto raiz e de objetos aninhados (`money`).
3. **Serialização Compacta:** Converte para string via `JSON.stringify` sem espaços em branco.
4. **Digest Criptográfico:** Calcula `SHA-256` em encoding hexadecimal (`64` caracteres) e compara com o valor persistido na transação original.

---

## 6. Observabilidade: Logs Estruturados JSON & Métricas

### 6.1. Logs Estruturados JSON (`src/infrastructure/observability/`)
- **Formato JSON Estruturado (`StructuredLogger`):** Cada linha emitida em `stdout`/`stderr` contém `timestamp`, `level`, `context`, `message`, `correlationId`, `walletId`, `transactionId` e `providerId`.
- **Propagação Transparente (`CorrelationMiddleware` + `AsyncLocalStorage`):** O header `X-Correlation-Id` é capturado ou gerado na borda HTTP, devolvido na resposta e mantido vivo durante toda a execução da requisição.
- **Sanitização de Dados Financeiros:** Chaves contendo valores monetários ou saldos (`amount`, `balance`, `balanceBefore`, `balanceAfter`, `money`, `cents`) são automaticamente removidas pelo `StructuredLogger` antes da serialização, prevenindo vazamento de dados financeiros sensíveis nos agregadores de logs.

### 6.2. Métricas Operacionais (`MetricsService` & `GET /metrics`)
A aplicação coleta métricas operacionais em memória via `MetricsService` (`src/infrastructure/observability/metrics.service.ts`) e as expõe em formato JSON estruturado no endpoint público `GET /metrics` (`MetricsController`):
- **Transações por status (`transactionsByStatus`):** Contadores segregados para `PROCESSED`, `REJECTED` e `PENDING_REFERENCE`.
- **Duplicatas detectadas (`duplicatesDetected`):** Contadores independentes para replays idempotentes na borda HTTP (`httpIdempotency`) e deduplicações no consumidor SQS (`sqsInbox`).
- **Retries & DLQ (`retriesTotal`, `dlqMessagesTotal`):** Quantidade de tentativas de reprocessamento de transações `PENDING_REFERENCE` e mensagens encaminhadas para Dead-Letter Queue / rejeição definitiva.
- **Contenção de Lock (`lockConflictsTotal`):** Contabiliza operações que sofreram espera relevante na aquisição do lock pessimista `FOR UPDATE` sobre a `WalletEntity`.
- **Outbox Lag (`outboxLagSeconds`):** Diferença em segundos entre o timestamp atual e o `createdAt` da mensagem não publicada mais antiga na tabela `outbox_messages`.
- **Latência de Processamento (`processingLatencyMs`):** Amostragem contínua com cálculo de média (`avg`) e percentil 95 (`p95`) em milissegundos, complementada por logs de alerta em caso de divergência na reconciliação (`reconciliationDivergencesTotal`).

---

## 7. Trade-offs e Limitações Conhecidas

1. **Pessimistic Locking (`FOR UPDATE`) vs. Hot Wallets:**
   - *Decisão:* Serializar operações por carteira no PostgreSQL garante consistência forte, zero *lost updates* e ausência de erros de conflito otimista sob rajadas concorrentes.
   - *Limitação:* Se uma única carteira (*hot wallet*, como uma conta promocional ou de torneio) receber milhares de requisições simultâneas por segundo, formará fila de espera por lock no banco. Em escala extrema, seria necessário particionar filas em memória por `walletId` (actor model / single-writer por partição) antes do banco.
2. **Transactional Outbox & Worker por Polling vs. CDC (Change Data Capture):**
   - *Decisão:* O `OutboxRelayService` e o `PendingReferenceWorkerService` utilizam polling periódico com backoff exponencial, mantendo a arquitetura simples e sem acoplamento a conectores externos.
   - *Limitação:* O polling introduz pequena latência de entrega (*outbox lag* proporcional ao intervalo do cron) e leituras periódicas no PostgreSQL. Em cenários de altíssimo throughput, a leitura direta do WAL via **CDC (Debezium / Kafka Connect)** reduziria o lag para milissegundos sem carga de polling.
3. **Ledger de Partida Simples por Carteira vs. Partidas Dobradas (Double-Entry):**
   - *Decisão:* Cada movimentação registra um lançamento imutável (`CREDIT` ou `DEBIT`) vinculado à carteira do jogador (`wallet_ledger_entries`), permitindo auditoria completa e reconciliação exata por `walletId`.
   - *Limitação:* Não modela contas contábeis de contrapartida da casa (*house/operator clearing accounts*) em partidas dobradas completas, focando estritamente na integridade do saldo do jogador.
4. **Autenticação No-Op no Ambiente de Avaliação:**
   - *Decisão:* O `AuthGuard` global e o decorator `@Public()` estão integrados no pipeline HTTP do NestJS, mas retornam `true` sem validar assinaturas HMAC/JWT neste ambiente local para permitir a execução direta da suíte automatizada sem dependências externas de IdP/KMS.
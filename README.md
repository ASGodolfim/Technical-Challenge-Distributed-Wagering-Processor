# Technical-Challenge-Distributed-Wagering-Processor

# 🎰 Distributed Wagering Processor

Processador distribuído de apostas e carteira digital de alta performance construído com **NestJS**, **TypeScript**, **MikroORM**, **PostgreSQL** e **ElasticMQ (SQS)**, projetado para suportar alta concorrência, consistência financeira rigorosa e publicação confiável de eventos.

---

## 🛠️ Tecnologias e Ferramentas

* **Runtime:** [Bun](https://bun.sh/) (Executor e Test Runner nativo)
* **Framework Backend:** NestJS + TypeScript
* **ORM & Database:** MikroORM + PostgreSQL 16
* **Mensageria:** AWS SDK (SQS Client) + ElasticMQ (Emulador SQS leve)
* **Containerização:** Docker & Docker Compose

---

## 🏗️ Arquitetura e Padrões de Projeto

O sistema adota os princípios de **Domain-Driven Design (DDD)** e **Arquitetura Hexagonal (Ports & Adapters)**:

1. **Pessimistic Locking (`LockMode.PESSIMISTIC_WRITE`):**
   Garante execução atômica sobre `WalletEntity` durante o ciclo financeiro via consulta SQL `FOR UPDATE`. Previne *race conditions* e garante isolamento em concorrência simultânea.

2. **Value Object (`Money`):**
   Encapsula e isola todas as operações matemáticas manipulando os montantes como inteiros em centavos (*integer cents*). Elimina completamente os problemas de imprecisão de ponto flutuante inerentes ao JavaScript/TypeScript.

3. **Transactional Outbox Pattern:**
   Garante a consistência eventual (*eventual consistency*) e resiliência de mensagens. O evento `WalletBalanceChangedEvent` é persistido na tabela `outbox_messages` dentro da mesma transação do banco de dados. O worker `OutboxRelayService` pesquisa assincronamente as mensagens pendentes e as despacha para a fila SQS.

4. **Inbox Pattern (Consumer Deduplication):**
   O `SqsConsumerService` consome as mensagens da fila SQS e valida seu `messageId` na tabela `inbox_messages` antes do processamento. Isso garante idempotência no consumo contra entregas duplicadas do broker (*at-least-once delivery*).

5. **Idempotência de API:**
   Chaves de idempotência dinâmicas (`idempotencyKey` e a combinação `providerId` + `externalTransactionId`) com verificação por hash de payload (SHA-256). Previne que reenvios acidentais alterem o saldo ou gerem transações duplicadas.

---

## 📂 Estrutura de Pastas

```text
src/
├── application/
│   ├── dtos/                # Data Transfer Objects
│   └── services/            # WagerService (Caso de Uso Principal)
├── domain/
│   ├── events/              # Eventos de Domínio (WalletBalanceChangedEvent)
│   └── money.ts             # Money Value Object (Precisão Decimal)
└── infrastructure/
    ├── database/            # Script de Seed e Migrações
    ├── http/                # WagerController (REST API)
    ├── messaging/           # OutboxRelayService, SqsConsumerService e cliente SQS
    └── persistence/         # Entidades do MikroORM (Wallet, Ledger, Inbox, Outbox, Tx)
```

---

## 🚀 Como Executar o Projeto

### 1. Pré-requisitos
* [Bun](https://bun.sh/) instalado (v1.1+)
* Docker e Docker Compose em execução

### 2. Clonar e Instalar Dependências
```bash
bun install
```
### 3. Entrar na pasta para a execução do projeto
```bash
cd jungle-challenge
```

### 4. Subir a Infraestrutura (PostgreSQL + ElasticMQ SQS)
```bash
docker compose up -d
```

### 5. Executar Migrações do Banco de Dados
```bash
bunx mikro-orm migration:up
```

### 6. Semear Dados Iniciais (Carteira de Teste)
```bash
bun run src/infrastructure/database/seed.ts
```

### 7. Iniciar a Aplicação NestJS
```bash
bun run start:dev
```
A API estará rodando em `http://localhost:3000`.

---

## 🧪 Suíte de Testes

### Testes Unitários (`bun test`)
Cobre as regras de domínio do `Money` Value Object:
```bash
bun test
```

### Testes End-to-End (E2E) via PowerShell
Com a aplicação em execução (`bun run start:dev`), abra uma nova janela do PowerShell e execute o script abaixo para validar todas as regras em lote (`BET`, `WIN`, `ROLLBACK`, `Idempotência` e `Saldo Insuficiente`):

```powershell
$baseUrl = "http://localhost:3000/v1/wagers"
$walletId = "22222222-2222-2222-2222-222222222222"
$playerId = "11111111-1111-1111-1111-111111111111"

# 1. BET (Débito de R$ 50.00)
$betBody = @{ providerId="pragmatic"; externalTransactionId="tx-bet-100"; idempotencyKey="idem-bet-100"; playerId=$playerId; walletId=$walletId; roundId="round-1"; gameId="game-1"; kind="BET"; amount="50.00"; currency="BRL" } | ConvertTo-Json
Invoke-RestMethod -Uri $baseUrl -Method Post -Body $betBody -ContentType "application/json"

# 2. Idempotência (Reenvio da mesma aposta)
Invoke-RestMethod -Uri $baseUrl -Method Post -Body $betBody -ContentType "application/json"

# 3. Saldo Insuficiente (Aposta de R$ 9.999.00 - Rejeição)
$insufficientBody = @{ providerId="pragmatic"; externalTransactionId="tx-bet-999"; idempotencyKey="idem-bet-999"; playerId=$playerId; walletId=$walletId; roundId="round-1"; gameId="game-1"; kind="BET"; amount="9999.00"; currency="BRL" } | ConvertTo-Json
Invoke-RestMethod -Uri $baseUrl -Method Post -Body $insufficientBody -ContentType "application/json"

# 4. WIN (Crédito de R$ 150.00)
$winBody = @{ providerId="pragmatic"; externalTransactionId="tx-win-100"; idempotencyKey="idem-win-100"; playerId=$playerId; walletId=$walletId; roundId="round-1"; gameId="game-1"; kind="WIN"; amount="150.00"; currency="BRL" } | ConvertTo-Json
Invoke-RestMethod -Uri $baseUrl -Method Post -Body $winBody -ContentType "application/json"

# 5. ROLLBACK (Estorno de R$ 50.00)
$rollbackBody = @{ providerId="pragmatic"; externalTransactionId="tx-rollback-100"; idempotencyKey="idem-rollback-100"; playerId=$playerId; walletId=$walletId; roundId="round-1"; gameId="game-1"; kind="ROLLBACK"; amount="50.00"; currency="BRL" } | ConvertTo-Json
Invoke-RestMethod -Uri $baseUrl -Method Post -Body $rollbackBody -ContentType "application/json"
```

---

## 📑 Especificação do Endpoint

### `POST /v1/wagers`

#### Exemplo de Requisição:
```json
{
  "providerId": "pragmatic",
  "externalTransactionId": "tx-bet-001",
  "idempotencyKey": "idem-bet-001",
  "playerId": "11111111-1111-1111-1111-111111111111",
  "walletId": "22222222-2222-2222-2222-222222222222",
  "roundId": "round-999",
  "gameId": "game-777",
  "kind": "BET",
  "amount": "50.00",
  "currency": "BRL"
}
```

#### Exemplo de Resposta (200 OK):
```json
{
  "transactionId": "22d935b4-bcfe-416f-9f52-cb33170b0f69",
  "status": "PROCESSED",
  "balanceAmount": "450.00",
  "currency": "BRL"
}
```
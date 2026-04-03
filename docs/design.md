# OWS OWS Hooks — Design Document

## 1. Project Overview

**OWS OWS Hooks** is an SDK + runtime that extends the Open Wallet Standard Policy Engine, enabling developers to write custom policies in TypeScript.

It wraps the OWS `executable` policy mechanism (stdin/stdout inter-process communication) and provides:

- An SDK for writing policies (type definitions, helpers, test utilities)
- Reference implementations of 4 practical policies
- An audit log that records every policy decision (SQLite, with future on-chain extension)

**Target audience**: Enterprises and developers delegating wallet operations to AI agents

**Hackathon**: OWS Hackathon (2026-04-03)

---

## 2. Why "Programmable"?

OWS has only two built-in policies: `allowed_chains` and `expires_at`.
An extension point via `executable` exists, but the raw stdin/stdout binary communication makes for a poor developer experience.

This project creates a foundation that makes it easy for anyone to write executable policies, demonstrating the extensibility of the OWS ecosystem.

---

## 3. Architecture

```
AI Agent → OWS (ows sign) → Policy Engine
                                │
                                ▼
                      ┌─────────────────────────┐
                      │  OWS Hooks     │
                      │    Runtime (Node.js)     │
                      │                          │
                      │  ┌── KYC Policy ───────┐ │
                      │  ├── AML Policy ───────┤ │
                      │  ├── ERC-8004 Policy ──┤ │
                      │  ├── Policy Chaining ──┤ │
                      │  └── (user-defined) ───┘ │
                      │                          │
                      │  ┌── Audit Logger ─────┐ │
                      │  │  SQLite (current)    │ │
                      │  │  On-chain (future)   │ │
                      │  └─────────────────────┘ │
                      └─────────────────────────┘
```

### Flow

1. OWS launches the executable and sends `PolicyContext` JSON to stdin
2. The OWS Hooks Runtime evaluates policies sequentially
3. Policy Chaining: the result of the previous policy influences the context of the next
4. Each policy decision is recorded in the audit log
5. The final result (Approve/Deny + reason) is returned to stdout within 5 seconds

---

## 4. SDK Design

### Policy Definition API

```typescript
import { definePolicy, PolicyContext, PolicyResult } from '@ows-pp/sdk';

export default definePolicy({
  name: 'kyc-check',
  description: 'Block transfers to recipients who have not completed KYC',

  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    const response = await fetch(`${KYC_API_URL}/check/${ctx.transaction.to}`);
    const { verified } = await response.json();

    if (!verified) {
      return { action: 'deny', reason: 'Recipient has not completed KYC' };
    }
    return { action: 'approve' };
  }
});
```

### Runtime API

```typescript
import { createRuntime } from '@ows-pp/sdk';
import kycPolicy from './policies/kyc-check';
import amlPolicy from './policies/aml-check';
import erc8004Policy from './policies/erc8004-agent-id';
import chainingPolicy from './policies/policy-chaining';

const runtime = createRuntime({
  policies: [kycPolicy, amlPolicy, erc8004Policy, chainingPolicy],
  auditLog: { type: 'sqlite', path: './audit.db' },
});

// Start as an OWS executable
runtime.start();
```

### What the SDK Provides

| API | Description |
|-----|-------------|
| `definePolicy()` | Type-safe policy definition |
| `PolicyContext` | Transaction info, agent ID, wallet info |
| `PolicyResult` | approve/deny + reason + metadata |
| `createRuntime()` | Runtime that executes multiple policies together |
| `testPolicy()` | Utility for testing policies locally |
| `ChainContext` | Access to previous policy results for Policy Chaining |

---

## 5. Demo Policies (4 total)

> **Implementation approach**: Policies 1 and 2 are mocks (proof of concept). Policies 3 and 4 are fully functional.

### 5.1 KYC Check — Mock

- **Overview**: Queries an external API (KYC service / proprietary API) to check whether the recipient has completed KYC
- **Deny condition**: Transfer to a recipient who has not completed KYC
- **Why Programmable**: External API calls are impossible with built-in policies
- **Implementation**: Mock KYC API server (Express). In production, replace with Sumsub, Jumio, or a proprietary API

### 5.2 AML Check — Mock

- **Overview**: Queries a sanctions list / AML database for the recipient address
- **Deny condition**: Transfer to an address flagged as high-risk
- **Why Programmable**: Integration with external compliance APIs is required
- **Implementation**: Mock sanctions list (hardcoded address list). In production, replace with Chainalysis, Elliptic, Circle, etc.

### 5.3 ERC-8004 Agent ID Verification — Functional

- **Overview**: Checks whether the sending agent is registered on-chain in the ERC-8004 Identity Registry
- **Deny condition**: Signature from an unregistered agent or a low-reputation agent
- **Why Programmable**: On-chain contract queries are required
- **Implementation**: Actual RPC query to an ERC-8004 contract on a testnet (e.g., Sepolia). Uses viem

### 5.4 Policy Chaining — Functional

- **Overview**: Chaining between policies and dynamic rule modification
- **Example**: High ERC-8004 reputation → relaxed AML check (raised threshold). Low reputation → all policies applied strictly
- **Why Programmable**: Dynamic dependencies between policies are absolutely impossible with static built-in rules
- **Implementation**: References previous policy results via ChainContext. Dynamically adjusts downstream decisions based on actual ERC-8004 reputation values

---

## 6. Audit Log

### Current (MVP): SQLite

```sql
CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT NOT NULL,
  agent_id      TEXT,
  wallet_id     TEXT NOT NULL,
  tx_to         TEXT,
  tx_amount     TEXT,
  tx_chain      TEXT,
  policy_name   TEXT NOT NULL,
  result        TEXT NOT NULL,  -- 'approve' | 'deny'
  reason        TEXT,
  context_hash  TEXT NOT NULL   -- SHA256 of full PolicyContext
);
```

### Future On-Chain Extension

```
SQLite (detailed logs)
    │
    ▼ periodic batch
Merkle Tree construction (SHA256 hashes of log entries)
    │
    ▼
Merkle Root recorded on-chain (approx. 1 tx/day)
    │
    ▼
Any audit log entry can be verified by a third party using a Merkle Proof
```

**Benefits**:
- **Cost efficiency**: No need to write all logs on-chain (1 transaction per day)
- **Tamper-proof**: Any log can be proven to have existed at a specific point in time
- **Regulatory compliance**: Serves as tamper-proof evidence for audit trail submissions to financial regulators

---

## 7. Security Design

### Threat Model

Since wallet operations are delegated to AI agents, a Zero Trust for Agents design — where the agent itself is not trusted — is essential.

| Threat | Attack Example | Mitigation |
|--------|----------------|------------|
| **Prompt injection** | Instructing the agent to "ignore policies and sign" | Policy evaluation is enforced within the OWS process. Bypass from the agent's prompt or code is impossible |
| **PolicyContext tampering** | Agent injects a fake recipient or amount into the context | PolicyContext is generated by OWS itself. The agent does not construct the context. The runtime also verifies the tx hash in the context |
| **Policy config tampering** | Agent modifies policy files or config JSON | Policy config files are outside the agent's API key scope. Protected by OS-level file permissions |
| **Timeout abuse** | Delaying external API responses to cause policy evaluation to time out | OWS deny-by-default: timeout (5 seconds) always results in Deny. Errors and malformed JSON output also result in Deny |
| **Policy order manipulation** | Skipping specific policy evaluation or reordering policies | The policy execution order is fixed at config time. Cannot be changed at runtime |
| **Audit log tampering** | Deleting past Deny log entries to erase evidence | context_hash (SHA256) allows integrity verification of each log entry. Future Merkle Root extension enables on-chain proof |

### Security Principles

1. **Deny-by-default** — If policy evaluation fails to complete for any reason, always Deny
2. **Agents don't know the policies** — Policy contents, configuration, and evaluation logic are not exposed to the agent. The agent sends a signing request and receives only an Approve/Deny result
3. **Policy evaluation is atomic** — No signing occurs until all policies have been evaluated. If even one policy Denies mid-evaluation, the entire request is immediately Denied
4. **Audit log is append-only** — DELETE/UPDATE operations are prohibited. INSERT ONLY append-only log
5. **Configuration immutability** — Policy configuration cannot be changed after runtime startup. Changes require a runtime restart

### Hackathon Implementation Scope

- [x] Deny-by-default (leveraging existing OWS behavior)
- [ ] PolicyContext integrity verification (tx hash check within runtime)
- [ ] Audit log append-only constraint (implemented via SQLite triggers)
- [ ] Policy config lock at startup
- [ ] Policy info hidden from agents (return results only)

---

## 8. Tech Stack

| Layer | Technology |
|-------|------------|
| Policy SDK | TypeScript (Node.js) |
| Runtime | Node.js (launched as an OWS executable) |
| Audit log | SQLite (better-sqlite3) |
| Testing | Vitest |
| Demo mock data | JSON files (KYC/AML) |
| ERC-8004 queries | viem (Base Sepolia testnet) |

---

## 9. Hackathon Scope

### Must Build

- [ ] Policy SDK (definePolicy, createRuntime, type definitions, ChainContext)
- [ ] stdin/stdout bridge (compliant with OWS executable specification)
- [ ] KYC check policy + mock API
- [ ] AML check policy + mock sanctions list
- [ ] ERC-8004 agent ID verification policy (mock or testnet)
- [ ] Policy Chaining implementation
- [ ] Audit log (SQLite)
- [ ] Demo script (end-to-end scenarios running with OWS)

### Talking Points for Presentation

- Tamper-proof audit trail via on-chain Merkle Root extension
- Enterprise adoption story (compliance, regulatory requirements)
- Ecosystem vision (developers publishing custom policies to npm)
- Dynamic risk management via Policy Chaining
- Human-in-the-Loop approval flow

---

## 9.5 Future: Human-in-the-Loop Approval Flow

Current policies return Approve/Deny immediately, but in production use cases, inserting human approval is essential.
Since OWS executable policies have a 5-second timeout, synchronous approval waiting is not feasible.
This is solved with an asynchronous approval flow.

### Architecture

```
Agent → OWS sign → OWS Hooks
                        │
                        ├── KYC/AML/ERC-8004 → automatic decision (current implementation)
                        │
                        └── On high-risk detection:
                            │
                            ├── 1. PolicyResult: { allow: false, reason: "pending_approval" }
                            │      → Signing is temporarily blocked
                            │
                            ├── 2. Approval request sent externally
                            │      → Slack / Email / Webhook / Dashboard
                            │      → Includes transaction details, risk reason, agent info
                            │
                            ├── 3. Human approves
                            │      → Approval token issued (signed, with expiry)
                            │      → Agent retries ows sign with the approval token
                            │
                            ├── 4. OWS Hooks validates the approval token
                            │      → Valid → Allow
                            │      → Invalid/expired → Deny
                            │
                            └── 5. Timeout (e.g., 30 minutes)
                                   → Approval token unused → Auto-expire (deny-by-default)
```

### Approval Token Design

```typescript
interface ApprovalToken {
  tx_hash: string;       // Hash of the transaction being approved
  agent_id: string;      // Agent being approved
  approved_by: string;   // ID of the approver
  approved_at: string;   // Approval timestamp (ISO 8601)
  expires_at: string;    // Expiry time
  signature: string;     // Approver's signature (tamper prevention)
}
```

### Why This Matters

1. **Regulatory requirements**: Financial institutions are legally required to have human approval for transfers above a certain amount
2. **Gradual autonomy**: Start with full approval → build trust → progressively expand the scope of automatic approval
3. **Incident response**: Humans can intervene immediately when anomalies are detected
4. **Integration with Policy Chaining**: Low ERC-8004 reputation → approval required; high reputation → automatic approval

### Proposal to OWS

The current 5-second timeout for executable policies is too short for synchronous approval.
The following extensions are proposed for the OWS core:

- Add `{ action: "pending", callback_url: "..." }` to `PolicyResult`
- When OWS receives pending, it queues the signing request and waits for approval/rejection via callback
- Auto-Deny after a configurable timeout

---

## 10. Demo Scenarios

### Scenario 1: Happy Path
1. An agent with completed KYC, clean AML status, and ERC-8004 registration sends a transfer
2. All policies Approve → signing succeeds
3. Recorded in the audit log

### Scenario 2: KYC Block
1. An agent attempts to transfer to a recipient who has not completed KYC
2. KYC policy Denies → signing rejected
3. Reason "Recipient has not completed KYC" is recorded in the log

### Scenario 3: AML Block
1. An agent attempts to transfer to a sanctioned address
2. AML policy Denies → signing rejected

### Scenario 4: Policy Chaining in Action
1. High-reputation agent → AML check threshold relaxed → approved
2. Low-reputation agent → same transfer subjected to strict checks → blocked
3. Demonstrates that the same transaction yields different results depending on the agent's trust level

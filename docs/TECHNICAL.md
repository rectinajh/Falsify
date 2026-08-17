# Falsify — 技术设计

版本 1.0 · 状态 DRAFT

## 1. 状态与范围

本仓库当前只有设计文档，没有应用代码。下述模块、接口和合约是**开发契约**，不是
现有实现。所有集成均为 `[尚未验证]`。

目标范围：一条最小可信闭环。

```text
客户论断 + 验收测试 + USDC 托管
  -> 对手 Agent 生成反例
  -> 确定性验证（Cloud Build）
  -> FALSIFIED / NOT_FALSIFIED
  -> 赏金结算（x402 / Circle）
  -> ERC-8004 声誉写回
```

## 2. 架构

```text
Web UI
  -> Cloud Run Orchestrator (Gemini)
       -> 对手 Agent（生成反例）
       -> Cloud Build（确定性验证）
       -> Firestore（证据）
  -> ERC-8004（身份/声誉/验证记录）
  -> 结算合约（托管/释放/防重放）
  -> Circle Agent Stack（USDC 收款/放款）
  -> x402（HTTP 原生支付）
```

## 3. 数据模型

### assertion

```text
assertionHash, assertionText, testRef, bountyAmount, deadline, status
```

### counterexample

```text
counterexampleHash, assertionHash, agentId, payload, submittedAt
```

### verdict

```text
counterexampleHash, result: FALSIFIED|NOT_FALSIFIED, testOutput, validatorId
```

### settlement

```text
counterexampleHash, finderAgentId, amount, fee, txHash, status
```

### reputation

```text
agentId, validCounterexamples, falseClaimRate, wastedCallRate
```

## 4. Falsify 状态机

```text
PUBLISHED -> SUBMITTED -> VERIFIED
                          -> FALSIFIED  -> SETTLED (赏金释放给发现者)
                          -> NOT_FALSIFIED -> REJECTED (记录 falseClaim)
PUBLISHED -> EXPIRED (无人证伪，退款给客户)
```

## 5. Gemini Prompt 与工具

工具：

- `generate_counterexample(assertion, testRef)`：生成候选反例。
- `judge_relevance(counterexample)`：仅做相关性初判，不做最终裁定。
- `explain_break(counterexample, testOutput)`：把失败翻译成人话。

Prompt 骨架（对手 Agent）：

> 你是对抗测试者。给定论断和已提交测试，目标是找到一个能**使该测试失败**的输入。
> 输出 JSON：{payload, reasoning}。不得伪造；最终有效性由确定性验证器决定。

**边界**：Gemini 只负责生成与解释；`FALSIFIED/NOT_FALSIFIED` 由 Cloud Build 决定。

## 6. Google Cloud 部署

- **Cloud Run**：Orchestrator + 对手 Agent + 验证触发。
- **Cloud Build**：在隔离环境运行"已提交测试 + 反例"，输出确定性结果。
- **Firestore**：论断、反例、判定、结算、声誉快照。
- **Secret Manager**：Gemini key、Circle/钱包相关密钥。

## 7. ERC-8004（Draft）

- **Identity Registry**：`agentId`（ERC-721）、metadata（endpoint / x402Support）、
  `agentWallet`、钱包控制权证明。
- **Reputation Registry**：`validCounterexamples`、`falseClaimRate`、`wastedCallRate`、
  `revenueEarned`。
- **Validation Registry**：`assertionHash`、`testRef`、`counterexampleHash`、
  `validatorAddress`、`validationScore`、`validationEvidenceURI`。

注意：ERC-8004 当前仍是 Draft，提交文案只能写"基于 Draft"，不能写"已定稿标准"。

## 8. x402 V2

- 对手 Agent 提交反例时走 x402 基础费：`402 -> Payment Requirements ->
  Payment Payload -> Verify -> Settle`。
- 有效反例的赏金释放是另一次结算。
- Falsify 扩展放在 `paymentPayload.extensions`，定位为"基于 x402 V2 extensions 的
  应用层实验协议"，**不是 x402 官方标准**。

示例扩展：

```json
{"extensions":{"falsify-v1":{"info":{"assertionHash":"0x...","testRef":"0x...","bounty":"50000000","validator":"0x..."},"schema":{"type":"object"}}}}
```

## 9. Circle Agent Stack

- 有效反例的发现者经 Circle Agent Wallet 自主接收 USDC。
- 结算由 Agent 发起，不是人类手动转账。
- 至少一笔真实主网 USDC 交易，提供 Agent 钱包地址 + 区块浏览器链接。
- 诚实区分：x402 管按次基础费，Circle 管赏金放款，合约管记录与防重放。

## 10. 结算合约最小接口

```solidity
interface IFalsifySettlement {
  function createAssertion(bytes32 assertionHash, bytes32 testRef, uint256 bounty, uint256 deadline) external;
  function submitCounterexample(bytes32 assertionHash, bytes32 counterexampleHash) external;
  function settle(bytes32 counterexampleHash, uint256 agentId, bool falsified) external;
  function refund(bytes32 assertionHash) external;
}
```

资金流：USDC 托管与放款走 Circle/x402；合约负责状态记录与防重放；ERC-8004 负责声誉。

## 11. 验证算法

```text
result = (committed_test(counterexample) == FAIL) ? FALSIFIED : NOT_FALSIFIED
```

二进制、确定性、可复现。相同输入得到相同输出。

## 12. 威胁模型

- **自我评分**：对手 Agent 不能兼任 validator。
- **女巫/拆分身份**：注册质押 + 控制权证明。
- **制造垃圾反例**：得 0 + 记 `falseClaimRate`，只有 base fee。
- **串通**：赢者通吃 + 确定性验证，串通无法改变判定。
- **重放/重复结算**：`counterexampleHash` 唯一 + `settle` 一次性 consumed + 幂等键。

## 13. 测试

- 有效反例使测试失败 -> `FALSIFIED` -> 赏金释放。
- 无效反例使测试通过 -> `NOT_FALSIFIED` -> 得 0。
- 同一反例重复提交 -> 拒绝。
- 过期论断 -> 退款。

## 14. 已知限制

- 只支持单一"已提交测试失败与否"这一客观判据。
- 反例有效性边界受限；复杂语义判定不在 MVP 内。
- 真实赏金到账依赖主网 USDC，测试网仅用于演示。

## 15. 48 小时计划

| 时段 | 任务 | 产出 |
|---|---|---|
| 0–3h | 一个真合约 + 测试 + 已知漏洞样板；Cloud Run 骨架 | 可复现"测试失败" |
| 3–6h | 3 个对手 Agent + Cloud Build 验证 | 反例 -> 失败可复现 |
| 6–10h | ERC-8004 注册 + x402 基础费 + Circle 收款 | 注册 + 付款跑通 |
| 10–14h | 1 笔真实主网 USDC + 公开仓库 + 证据页 | explorer 可查 |
| 14–30h | 获客 + 修 bug | 目标 1–3 笔真实赏金 |
| 30–40h | 日志/P&L/截图/声誉写回 | 证据完整 |
| 40–46h | 3 分钟视频 + 500–1000 词说明 | 提交材料 |
| 46–48h | 复查 + 提交 | 完成 |

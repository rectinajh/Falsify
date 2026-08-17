# Falsify — 实现规格（可照着开工）

版本 1.0 · 状态 DRAFT · 所有集成 `[尚未验证]`

本文是开工契约。目标：一个人能在 48h 内照此实现最小可信闭环。

```text
客户论断 + 属性测试 + USDC 托管
  -> 对手 Agent 生成反例（两条路径：Gemini 正确性反例 + 确定性工具安全反例）
  -> Cloud Build 确定性验证
  -> FALSIFIED（赏金释放）/ NOT_FALSIFIED（得 0）
  -> x402 上链支付证明 + Circle 放款 + ERC-8004 写回
```

---

## 1. Gemini 对手 Agent 完整 Prompt

### 1.1 System Prompt

```text
你是一名对抗性测试 Agent。你的任务是用一个反例（输入或交易序列）去推翻一条
关于代码或系统的论断。

输入：
- assertion：论断（自然语言，例如"该合约的 withdraw() 不受重入攻击影响"）
- test_ref：已提交的属性测试标识（属性成立时测试通过，属性被违反时测试失败）
- artifact：合约/代码片段（可选）

你的目标：生成一个能让该属性测试【失败】的输入或交易序列。

硬约束：
1. 你只能生成候选反例，最终有效性由确定性验证器决定，不由你判断。
2. 不得编造、不得声称"已验证"。
3. 只输出合法 JSON，且严格符合给定 schema。
4. 找不到反例时，必须返回 { "payload": null, "reasoning": "no counterexample" }，
   不得为了凑数而生成无效输入。
```

### 1.2 输出 Schema（结构化输出）

```json
{
  "payload": "string | null — 攻击输入/交易序列，供验证器执行",
  "target_check": "string — 该反例攻击的是哪一条属性检查",
  "reasoning": "string — 为什么认为它会让测试失败",
  "confidence": "number 0.0-1.0"
}
```

### 1.3 User Prompt 模板

```text
断言：{assertion}
测试引用：{test_ref}
合约源码（节选）：
{artifact}

请生成一个候选反例，目标使 {test_ref} 失败。
```

### 1.4 三个对手 Agent 人格（提升多样性）

每个 Agent 在 System Prompt 末尾追加一行，形成不同攻击视角：

| Agent | 追加指令 | 主攻方向 |
|---|---|---|
| A | 你擅长回调与重入攻击。 | 重入、fallback、external call |
| B | 你擅长数值溢出与边界攻击。 | overflow、边界值、精度 |
| C | 你擅长状态机与逻辑边缘案例。 | 顺序、权限、条件分支 |

三个 Agent 并行生成，各提交一个候选反例，由验证器分别判定。

### 1.5 Gemini 与资金决策的边界

- Gemini 只生成候选反例与解释。
- `FALSIFIED / NOT_FALSIFIED` 由 Cloud Build 决定，Gemini 无权改变。
- 无效反例不触发任何付款，仅记录 `falseClaimRate`。

### 1.6 安全类反例不使用 Gemini 生成 exploit

Gemini 会因安全过滤拒绝生成漏洞利用代码。因此 Falsify 采用**双路径**：

| 论断类型 | 反例生成器 | Gemini 角色 |
|---|---|---|
| 正确性 / 数据 | Gemini（`scripts/adversary.mjs`） | 生成反例输入 |
| 安全 / 漏洞 | 确定性工具（fuzzer / Slither / 已提交攻击夹具，如 `src/Attack.sol`） | 只解释失败结果 |

两条路径共用同一个 `forge test` 判定，放款决策永不依赖 LLM。提交文案须按此诚实口径：
安全反例由确定性工具生成，Gemini 仅解释。

---

## 2. Cloud Build 确定性验证器接口

### 2.1 输入（环境变量）

```text
TEST_REF=               # 已提交测试标识，如 FalsifyReentrancy
COUNTEREXAMPLE_JSON=    # 对手 Agent 返回的 payload（JSON 字符串）
```

### 2.2 执行

以 Solidity + Foundry 为例，Cloud Build 在隔离容器内执行：

```bash
forge test --match-test "$TEST_REF" --json
```

反例 payload 通过测试夹具注入（fixture 读取 `COUNTEREXAMPLE_JSON`，把攻击序列重放给
目标合约）。**不允许联网，不允许随机性**，保证相同输入得到相同结果。

### 2.3 输出契约

验证器把结果写到固定路径 `/workspace/verdict.json`：

```json
{
  "result": "FALSIFIED | NOT_FALSIFIED",
  "exitCode": 0,
  "testRef": "FalsifyReentrancy",
  "counterexampleHash": "0x...",
  "stdoutHash": "0x..."
}
```

判据（二进制、可复现）：

```text
exitCode == 0  -> 测试通过 -> NOT_FALSIFIED
exitCode != 0  -> 测试失败 -> FALSIFIED
```

### 2.4 属性测试约定

- 客户提交的"验收测试"必须是一条**属性测试**：属性成立时通过，属性被违反时失败。
- 反例 = 使该属性测试失败的输入/交易序列。
- 判定不依赖任何 LLM 输出。

---

## 3. Solidity 结算合约（已实现）

真实代码见 `src/FalsifySettlement.sol`，配套接口见 `src/interfaces/IERC8004.sol`、
`src/interfaces/IX402.sol`、`src/interfaces/IERC20.sol`。当前真实签名：

```solidity
constructor(address _validator, address _platform,
            address _identityRegistry, address _reputationRegistry, address _usdc);

function createAssertion(bytes32 assertionHash, bytes32 testRef, uint256 deadline)
    external payable;                                                        // 原生 ETH
function createAssertionUSDC(bytes32 assertionHash, bytes32 testRef, uint256 deadline,
    uint256 bounty, bytes32 x402PaymentProof) external;                      // USDC + x402 证明
function submitCounterexample(uint256 assertionId, bytes32 counterexampleHash,
    uint256 agentId) external;                                               // ERC-8004 身份门控
function settle(uint256 assertionId, bytes32 counterexampleHash, bool falsified)
    external onlyValidator;
function refund(uint256 assertionId) external;
```

关键设计（均已实现并通过 Foundry 测试）：

- **ERC-8004 身份门控**：`submitCounterexample` 要求
  `identityRegistry.getAgentWallet(agentId) == msg.sender`，声誉不可转让。
- **声誉写回**：有效反例写 `validCounterexamples`（value=+1），无效反例写
  `falseClaimRate`（value=-1），`feedbackHash` 绑定 `counterexampleHash`。
- **x402 关联**：`createAssertionUSDC` 把 `x402PaymentProof`（`proofOfPayment` 派生
  哈希）上链，把链下支付与链上托管密码学绑定。
- **防重放 / 赢者通吃 / 退款**：`counterexampleHash` 唯一、`settledCounterexamples`
  一次性消费、过期退款，同前不变。
- **资金流**：ETH 为 MVP 占位；USDC 走 `transferFrom` 托管、`transfer` 放款。真实
  主网 USDC 由 Circle 完成。
- **validator 中继**：MVP 里 Cloud Build 判定结果由受信服务调用 `settle`，未来升级
  "验证者网络 + ECDSA 证明"。

---

## 4. 端到端时序

### 4.1 正常结算（FALSIFIED）

```text
1. 客户 createAssertion(assertionHash, testRef, deadline) 托管赏金
2. Agent A/B/C 各返回一个候选反例（Gemini）
3. Orchestrator 逐个提交 Cloud Build 验证
4. 反例 X 使测试失败 -> verdict = FALSIFIED
5. validator 调用 settle(assertionId, X.hash, agent, true)
6. 赏金扣除平台费后付给 agent（Circle 完成主网 USDC）
7. ERC-8004 写回 validCounterexamples +1
```

### 4.2 无效反例（NOT_FALSIFIED）

```text
1. Agent 提交反例 Y
2. Cloud Build：测试通过 -> NOT_FALSIFIED
3. settle(..., falsified=false) -> 只发 Rejected 事件
4. ERC-8004 写回 falseClaimRate +1
```

---

## 5. 环境变量与配置

```text
GEMINI_API_KEY=         # server-only
CLOUD_BUILD_PROJECT=    # GCP 项目
FIRESTORE_DB=           # 证据库
VALIDATOR_PRIVATE_KEY=  # 验证器中继签名（server-only）
ERC8004_CONTRACT=       # ERC-8004 注册表地址
FALSIFY_CONTRACT=       # 结算合约地址
CIRCLE_API_KEY=         # Circle Agent Stack（server-only）
```

任何真实 secret 不得写入 `.env.example`、README、截图或 git 历史。

---

## 6. 验收清单（Definition of Done）

- [ ] 客户能发布论断并托管 USDC。
- [ ] 3 个对手 Agent 能生成候选反例。
- [ ] Cloud Build 能确定性复现"反例使测试失败"。
- [ ] 有效反例触发 `FALSIFIED` 并放款。
- [ ] 无效反例触发 `NOT_FALSIFIED`，得 0 并记录。
- [ ] 同一反例重复提交被拒绝。
- [ ] 过期论断可退款。
- [ ] 一笔真实主网 USDC 交易可点击验证。
- [ ] ERC-8004 记录身份、验证与声誉。

---

## 7. 状态标记

- `[已实现并通过测试]`：`FalsifySettlement.sol`（ETH/USDC + ERC-8004 + x402 字段 +
  防重放 + 退款）、`test/FalsifySettlement.t.sol`（6 项）、双路径反例脚本。
- `[尚未验证]`：Google Cloud、Circle Agent Stack、真实主网 USDC、Coinbase x402 验证器。
- `[48小时内可以完成]`：Cloud Build 部署、前端、真实用户获客、1 笔真实主网 USDC。
- `[需要外部用户配合]`：真实赏金客户、真实主网 USDC。
- `[未来规划，不属于MVP]`：验证者网络、ECDSA 证明、多论断并发、质押经济。

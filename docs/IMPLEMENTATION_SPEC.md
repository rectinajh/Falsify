# Falsify — 实现规格（可照着开工）

版本 1.0 · 状态 DRAFT · 所有集成 `[尚未验证]`

本文是开工契约。目标：一个人能在 48h 内照此实现最小可信闭环。

```text
客户论断 + 属性测试 + USDC 托管
  -> 3 个对手 Agent（Gemini）生成反例
  -> Cloud Build 确定性验证
  -> FALSIFIED（赏金释放）/ NOT_FALSIFIED（得 0）
  -> Circle 放款 + ERC-8004 写回
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

## 3. Solidity 结算合约字段

### 3.1 完整定义

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC8004Reputation {
    function recordValidation(
        bytes32 taskHash,
        bytes32 artifactHash,
        uint256 agentId,
        uint256 validationScore,
        string calldata evidenceURI
    ) external;
}

contract FalsifySettlement {
    struct Assertion {
        bytes32 assertionHash;   // 论断哈希
        bytes32 testRef;         // 已提交属性测试标识哈希
        address customer;        // 发布方（出赏金者）
        uint256 bounty;          // 赏金（USDC 最小单位）
        uint256 deadline;        // 截止时间
        bool settled;            // 是否已结算
        bool refunded;           // 是否已退款
    }

    struct Counterexample {
        bytes32 hash;            // counterexampleHash
        uint256 assertionId;
        address agent;           // 提交者（ERC-8004 agentId 对应钱包）
        bool falsified;          // 是否被判定为有效反例
        bool settled;            // 是否已结算
    }

    uint256 public nextAssertionId;
    mapping(uint256 => Assertion) public assertions;
    mapping(bytes32 => uint256) public counterexampleToAssertion; // 防重放
    mapping(bytes32 => bool) public settledCounterexamples;

    address public validator;    // 确定性验证器的中继地址
    IERC8004Reputation public reputation;
    address public platform;     // 平台费收款方
    uint256 public platformFeeBps = 1500; // 15%

    event AssertionCreated(uint256 indexed assertionId, address indexed customer, uint256 bounty);
    event CounterexampleSubmitted(uint256 indexed assertionId, bytes32 indexed counterexampleHash, address indexed agent);
    event Falsified(uint256 indexed assertionId, bytes32 indexed counterexampleHash, address indexed agent, uint256 payout);
    event Rejected(uint256 indexed assertionId, bytes32 indexed counterexampleHash, address indexed agent);
    event Refunded(uint256 indexed assertionId, address indexed customer);

    modifier onlyValidator() { require(msg.sender == validator, "not validator"); _; }

    function createAssertion(bytes32 assertionHash, bytes32 testRef, uint256 deadline) external payable {
        require(deadline > block.timestamp, "deadline");
        require(msg.value > 0, "no bounty");
        uint256 id = ++nextAssertionId;
        assertions[id] = Assertion(assertionHash, testRef, msg.sender, msg.value, deadline, false, false);
        emit AssertionCreated(id, msg.sender, msg.value);
    }

    function submitCounterexample(uint256 assertionId, bytes32 counterexampleHash) external {
        Assertion storage a = assertions[assertionId];
        require(a.customer != address(0), "no assertion");
        require(block.timestamp <= a.deadline, "expired");
        require(!a.settled && !a.refunded, "closed");
        require(counterexampleToAssertion[counterexampleHash] == 0, "duplicate");
        counterexampleToAssertion[counterexampleHash] = assertionId;
        emit CounterexampleSubmitted(assertionId, counterexampleHash, msg.sender);
    }

    function settle(uint256 assertionId, bytes32 counterexampleHash, address agent, bool falsified) external onlyValidator {
        Assertion storage a = assertions[assertionId];
        require(!a.settled && !a.refunded, "closed");
        require(counterexampleToAssertion[counterexampleHash] == assertionId, "unknown");
        require(!settledCounterexamples[counterexampleHash], "settled");
        settledCounterexamples[counterexampleHash] = true;

        if (falsified) {
            uint256 fee = (a.bounty * platformFeeBps) / 10000;
            uint256 payout = a.bounty - fee;
            a.settled = true;
            (bool ok1, ) = agent.call{value: payout}("");
            (bool ok2, ) = platform.call{value: fee}("");
            require(ok1 && ok2, "transfer failed");
            emit Falsified(assertionId, counterexampleHash, agent, payout);
        } else {
            emit Rejected(assertionId, counterexampleHash, agent);
        }
    }

    function refund(uint256 assertionId) external {
        Assertion storage a = assertions[assertionId];
        require(a.customer == msg.sender, "not customer");
        require(block.timestamp > a.deadline, "not expired");
        require(!a.settled && !a.refunded, "closed");
        a.refunded = true;
        (bool ok, ) = a.customer.call{value: a.bounty}("");
        require(ok, "refund failed");
        emit Refunded(assertionId, a.customer);
    }
}
```

### 3.2 关键设计说明

- **防重放**：`counterexampleHash` 唯一，`settledCounterexamples` 保证单次结算。
- **赢者通吃**：第一个有效反例触发 `FALSIFIED`，随后 `settled=true` 关闭该论断。
- **无效反例**：`settle(falsified=false)` 只发 `Rejected` 事件，不转账。
- **资金流**：托管用 ETH 作为占位（`msg.value`）；生产版换成 USDC（ERC-20），
  `msg.value` 改为 `transferFrom`。真实主网 USDC 由 Circle 完成，合约只记录与防重放。
- **validator 中继**：MVP 里 Cloud Build 的判定结果由一个受信服务签名后调用
  `settle`。未来升级为"验证者网络 + ECDSA 证明"。

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

- `[尚未验证]`：上述全部代码与集成。
- `[48小时内可以完成]`：第 1–3 节范围。
- `[需要外部用户配合]`：真实赏金客户、真实主网 USDC。
- `[未来规划，不属于MVP]`：验证者网络、ECDSA 证明、多论断并发、质押经济。

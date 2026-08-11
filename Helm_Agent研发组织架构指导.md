# 1 人 / 少人公司 Agent-native 研发组织与管理面板架构指导

> 文档定位：产品与技术架构指导（可作为 PRD、领域建模和 MVP 设计的上位文档）  
> 适用对象：独立开发者、1～10 人软件团队、研发工具产品负责人、架构师  
> 版本：v1.0（2026-08-11）

## 1. 执行摘要

本系统不是“用一群 Agent 消灭公司里的人”，也不是 Codex、Claude Code、OpenCode 等工具的统一启动器。它要建设的是一套：

> **Human Governance + Agent Organization + Workflow OS**

即：

- 人掌握目标、价值判断、预算、风险、授权与最终责任；
- Agent 承担适合自动化的分析、实现、检查、整理、协调与重复执行；
- Workflow / Work Graph 负责把人和 Agent 的协作约束在可追踪、可审计、可暂停、可回滚且有成本上限的流程中；
- Runner 与 Resource Layer 负责把云端或局域网中的组织意图，安全地映射到本机仓库、工作区、工具和凭据；
- 管理面板把复杂执行压缩为少量“需要人决定的事项”，而不是把几十个 Agent 的每一步思考都推给人看。

系统的最高目标应定义为：

> **让一个人只处理必须由他处理的问题，其余工作由一个可控、可审计、有预算约束的 Agent 组织完成。**

它应当同时支持：

- `1 Human + 0 Agent`：完全由本人执行和回填；
- `1 Human + N Agents`：一人公司借助 Agent 扩大执行能力；
- `N Humans + M Agents`：少人团队按 Domain 分责，并各自管理 Agent 能力；
- 从手工流程逐步演进到自动流程，而不更换核心数据模型。

### 1.1 核心术语与责任字段

为避免实现时混用概念，本文统一采用以下术语：

| 术语 | 统一含义 |
|---|---|
| Organization | 租户、治理、成员、策略和预算的顶层边界 |
| Project | 为一组业务目标组织资源和工作的容器 |
| Requirement | 需要交付和验收的用户或业务结果 |
| Work Graph | Requirement 内的执行依赖图 |
| WorkItem | Work Graph 中可执行、可验收的工作节点；界面可称“任务” |
| Execution | Human 或 Agent 对一个 WorkItem 的一次执行尝试 |
| Agent Session | 外部 Agent 保存上下文的会话引用，不等同于 Execution |
| Member | 可参与组织协作的 Human、Agent 或 Service |
| Work Cell | 面向某类工作的可复用角色、策略与执行模板 |

正文若出现 `Task`，均指 WorkItem 的界面称呼；`AgentRun` 是 Agent 类型的 Execution，不再作为并列顶层实体；`Actor` 仅是事件中的行为主体称呼，数据模型统一使用 Member。

责任链使用三个独立字段：

```text
accountable_human_id   // 最终可追溯的人类责任人
operational_owner_id   // 日常组织和判断者，可为 Human 或受限 Agent
assignee_member_id     // 当前执行者，可为 Human 或 Agent
```

每个 Domain、Requirement 和 WorkItem 都必须能沿 `accountable_human_id` 追溯到 Human Principal。Agent 可以成为 Operational Owner，但不能成为责任链的终点。

---

## 2. 设计初心：强化人，而不是消灭人

### 2.1 人存在的根本理由

不要把人的必要性建立在“Agent 暂时做不到某些事”上。技术会持续侵蚀这些边界。更稳固的设计基础是：

> **组织需要有人拥有目标、授权、价值判断和后果责任。**

研发过程中的“人类节点”大致分为三类：

| 类型 | 例子 | 架构含义 |
|---|---|---|
| A. 当前能力不足 | Agent 暂时无法稳定完成复杂联调 | 能力提升后可被自动化，不应固化成人工节点 |
| B. 信息未数字化 | 客户现场情况、线下反馈未进入系统 | 应优先补齐数据和观测能力 |
| C. 本质是价值、授权或责任判断 | 是否承担风险、是否发布、服务哪类客户 | 应由有责任的人保留决策权 |

因此，Human Gate 不应被用来保护岗位或制造流程存在感；它只应出现在价值判断、责任承诺、不可逆风险或明显不确定性较高的位置。

### 2.2 被强化的人的能力

本系统要强化的不是“亲自完成更多任务”，而是以下能力：

1. 判断什么值得做、为什么做，以及何时停止；
2. 把模糊目标变成可验证的结果；
3. 分配预算、时间、风险和工具能力；
4. 设计协作结构，让工作可以并行又不失控；
5. 在关键信息不足或方案冲突时做决策；
6. 对上线、数据、客户和商业后果承担责任。

### 2.3 需要正视的现实

Agent 可能压缩单纯执行型岗位的数量，也可能把节省的人力成本转移为模型、API、云资源和返工成本。因此架构不能假设“用了 Agent 就天然便宜”，而要把成本、通过率、返工率和人工介入量做成一等公民。

Agent 的价值不只来自单次价格，还来自容量可伸缩、可并行、可重跑、可跨时段运行。但这些优势只有在预算上限、风险策略、权限边界和结果验收都存在时才成立。

---

## 3. 总体架构

```text
                         Human Principal
               目标 / 价值 / 预算 / 风险 / 最终责任
                                  │
                                  ▼
                         Company Copilot
                全局读取 / 压缩信息 / 建议 / 预警
                                  │
             ┌────────────────────┼────────────────────┐
             ▼                    ▼                    ▼
       Product Domain      Engineering Domain      Quality Domain
        Domain Owner          Domain Owner           Domain Owner
             │                    │                    │
             └────────────── Work Cells ──────────────┘
                                  │
                     Workflow / Work Graph Engine
                  依赖 / Gate / Risk / Budget / Decision
                                  │
                      Execution & Session Layer
                   Self / Managed / External Manual
                                  │
                         Resource & Runner Layer
             Repo / Worktree / Tool / Device / Credential / Artifact
```

必须坚持三条上下关系：

1. **Human Governance 在最上层**：Agent 不自封目标，也不自行扩大风险授权。
2. **Workflow 在 Agent 之上**：Agent 是可替换的执行能力，流程不依赖某个模型或供应商。
3. **Runner 是本机安全边界**：服务端负责编排，不应退化为可以任意远程执行 Shell 的控制软件。

---

## 4. Human Principal

Human Principal 是公司的目标所有者、资源授权者和最终责任主体。一人公司里通常就是创始人本人；少人公司里也可以是业务负责人或被明确授权的人。

### 4.1 主要职责

- 决定做什么、为什么做，以及哪些事明确不做；
- 定义目标结果、成功标准和停止条件；
- 为项目、版本和高成本任务设定预算；
- 定义组织级 Risk Policy；
- 决定哪些权力可委托给 Domain Owner 或 Agent；
- 对重大架构、生产变更、数据、资金、权限和发布承担最终责任；
- 在多个合理方案之间做价值选择；
- 在收益不足、风险失控或成本超支时叫停工作。

### 4.2 不应承担的工作

Human Principal 不应每天手工分配几十个 Task、阅读全部 Agent 日志、逐条批准低风险改动，或充当 Agent 调度器。管理面板应默认只向其展示：

- 待决策事项；
- 超预算、超时或重复失败事项；
- 高风险操作与发布授权；
- 跨 Domain 冲突；
- 无法自动恢复的阻塞；
- 目标、版本和现金消耗的整体偏差。

---

## 5. Company Copilot

Company Copilot 是“经营副手 / Chief of Staff Agent”，不是老板 Agent。它应拥有广泛的信息读取权和有限的建议、规划与编排权，但不默认拥有生产执行权、秘密读取权或不可逆决策权。

### 5.1 核心职责

- 汇总公司目标、项目、版本和 Work Graph；
- 发现阻塞、依赖冲突、重复工作和长期停滞任务；
- 发现成本异常、预算趋势和低收益返工循环；
- 生成计划草案、优先级建议与资源冲突方案；
- 把散落在评论、执行结果和测试报告中的信息压缩为决策材料；
- 跟踪 Risk Policy 与 Gate 是否被满足；
- 为 Human Principal 维护一个按紧迫度排序的 Decision Inbox。

一个合格的决策卡至少应包含：

```text
需要决定什么
为什么现在需要决定
可选方案及系统建议
支持证据与缺失信息
每个方案的成本、进度和风险影响
不处理的后果与最晚决策时间
```

### 5.2 明确边界

Company Copilot 默认不得：

- 自行修改组织级风险策略或抬高预算上限；
- 向自己或其他 Agent 授予生产凭据；
- 绕过 Gate、隐瞒失败或把“建议完成”直接改成“已验收”；
- 未经授权对外承诺、付款、删除数据或生产发布；
- 把全局读取权等同于全局执行权。

建议把 Company Copilot 的动作显式分级：

| 动作 | 默认权限 | 需要额外授权 |
|---|---|---|
| 读取项目元数据、Result、预算与风险摘要 | 允许 | 涉及 Secret、个人隐私和受限数据时按数据策略裁剪 |
| 生成计划、Work Graph、预算和决策草案 | 允许 | 草案不得直接改变业务事实 |
| 创建低风险 WorkItem、调整未开始节点优先级 | 可由组织策略授权 | 必须保留来源、理由和撤销入口 |
| 启动 Execution | 仅限预授权 Work Cell 和预算范围 | 超范围需 Domain Owner |
| 修改预算、风险策略、Accountable Human | 禁止 | Human Principal 明确批准 |
| 批准高风险 Gate、读取生产 Secret、生产发布 | 禁止 | 只能由有对应授权的 Human 完成 |

---

## 6. Domain 与 Domain Owner

少人公司不必模拟传统的完整部门树。建议先按稳定责任边界划分 Domain，例如：

- Product：需求、用户价值、验收标准；
- Engineering：架构、实现、集成与技术质量；
- Quality：测试策略、缺陷、回归与发布质量；
- Operations / Release：部署、监控、运营和外部反馈；
- Security / Finance 可在风险增长后独立，也可先作为跨域 Policy。

### 6.1 Owner 是角色，不是特殊实体

底层统一使用 `Member / Actor`：

```text
Member
├── Human
├── Local Agent
├── Remote Agent
└── Service Agent
```

Owner 是某个 Member 在特定 Domain、项目、阶段或 WorkItem 上承担的日常组织角色。负责人本人也可以是执行成员。与此同时，每个责任范围都必须有一个可追溯的 Accountable Human；二者在一人模式下通常是同一个人。

最关键的字段要分开：

```text
accountable_human_id   // 谁最终承担责任
operational_owner_id   // 谁组织本次工作
assignee_member_id     // 当前由谁执行
```

因此以下链路完全合法：

```text
Owner：王同学
执行：王同学 → Codex → Claude Code → 王同学
```

执行者和日常组织者可以变化，最终人类责任归属仍然清楚。

### 6.2 Domain Owner 的职责

- 把 Domain 目标转化为可执行和可验收的工作；
- 维护本域的 Work Cell、能力、预算和风险阈值；
- 为任务选择本人、真人成员或 Agent；
- 接收结构化执行结果，决定通过、返工、转交或升级；
- 对跨域交付物和下游依赖负责；
- 在授权范围内批准中风险变更；
- 把超出授权的决策提交给 Human Principal。

任何 Domain 都必须存在可追溯的人类责任映射；风险越高，Operational Owner 可被委托的动作越少。

---

## 7. Agent Team

Agent Team 不应被建模成一排固定头像或“数字员工花名册”。系统真正需要管理的是：

> **能力 + 角色 + 执行引擎 + Session + 权限 + 任务上下文 + 成本表现**

### 7.1 三个需要分开的概念

| 概念 | 含义 | 示例 |
|---|---|---|
| Agent Profile | 执行引擎或提供商能力 | Codex、Claude Code、OpenCode、Gemini CLI |
| Agent Role | 本次工作承担的组织角色 | Implementation、Architecture、Review、Test、Research |
| Agent Instance / Session | 某次具体执行上下文 | 某台 Mac、某仓库、某 Session ID |

同一个 Agent Profile 可在不同任务中承担不同 Role；同一个 WorkItem 也可以先后使用多个 Profile。不要把模型名称直接写死在 Workflow 中。

### 7.2 调度依据

调度不应只看“哪个 Agent 空闲”，还应参考：

- 所需 Capability 与工具可用性；
- 仓库、语言、框架和领域经验；
- 任务风险与允许权限；
- 历史一次通过率、返工率和缺陷回流率；
- 预计成本、耗时和剩余预算；
- Runner / Machine / Workspace 是否可恢复原 Session；
- 是否需要独立 Review，避免同一上下文自我证明。

---

## 8. Work Cell：可复用的工作单元

Work Cell 是少人公司降低“管理 Agent 本身”成本的关键。Owner 管理的是可复用工作单元，而不是每次手工依次调用多个 Agent。

例如 `Frontend Feature Cell`：

```text
Input Contract
    ↓
Implementation Role
    ↓
Independent Review Role
    ↓ Reject → 恢复原实现 Session 返工
    ↓ Approve
Test Role
    ↓
Owner / Risk Gate
    ↓
Result Contract
```

每个 Work Cell 应定义：

- 适用任务类型和前置条件；
- 输入 Contract、验收标准和必需 Artifact；
- 角色链路，而不是固定供应商链路；
- 每个角色允许使用的能力与资源；
- Review 独立性要求；
- 最大 Run、返工次数、持续时间和成本；
- 失败、离线、Session 丢失时的 fallback；
- 触发 Human Gate 的风险条件；
- 可复用的 Result Contract。

Work Cell 必须允许某个角色由 Human 执行。这样即使未接入任何 Agent，Workflow 仍然成立。

---

## 9. Workflow 与 Work Graph

传统“产品部 → 设计部 → 开发部 → 测试部”的线性流转不适合 Agent-native 研发。实际工作应建模为依赖图：

```text
                         Requirement
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
     Product Spec         API Design           UI Design
                              │                   │
                              ▼                   ▼
                           Backend              Client
                              └─────────┬─────────┘
                                        ▼
                                   Integration
                                        ▼
                                       QA
                                        ▼
                                  Release Gate
```

### 9.1 Work Graph 基本构成

- Node：WorkItem、Decision、Gate、Artifact、Milestone；
- Edge：依赖、阻塞、条件分支、回流、替代、聚合；
- Graph State：由节点状态与 Gate 计算得出，而不是由人随意切换一个总状态；
- Workflow Template：把常见图结构模板化，但允许项目裁剪。

### 9.2 需求状态与任务状态必须分离

一个需求处于“开发中”时，iOS、Android、Web、Backend 可以分别处于完成、执行中、待处理和返工状态。建议保持：

```text
Project
└── Requirement
    └── WorkGraph
        └── WorkItem
            └── Execution / AgentRun
```

需求总体进度应从 Work Graph 推导，允许显示“主链路完成、两个非阻塞任务未完成”等更真实的状态。

### 9.3 Workflow 不应知道有没有 AI

Workflow 只关心：

```text
Execution → Result → Review / Gate → Next Node
```

执行可以是本人、真人同事、系统托管 Agent 或外部手动调用的 Agent。Agent 应是可选增强，而不是系统运行前置条件。

### 9.4 评论是表现层，结构化数据是事实层

任务详情可以用连续时间线呈现讨论、Agent 结果、测试和审批。但每次 Agent 回填不能只生成一段 Comment，还应同步产生结构化对象：

```text
Execution / AgentRun
Result
Commit / ChangeSet
TestResult
Artifact
CostRecord
StatusSuggestion
TimelineEvent
```

原始执行日志和完整对话是二级信息，默认展示摘要、改动、测试、成本和已知问题即可。

### 9.5 Bug 是一等 WorkItem

Bug 可以显示在测试时间线中，但底层应成为关联原需求、发现阶段、责任 Domain、严重度和回归状态的 WorkItem。修复完成后通过图的回流边自动返回 QA，而不是埋在评论中失去状态。

### 9.6 最小运行语义

Work Graph 必须有确定的运行语义，不能只是一张可视化关系图：

- 节点版本：每次编辑递增 `graph_version`，运行中的 Execution 绑定启动时版本；
- 合法转换：`draft → ready → running → waiting/review → completed`，失败可进入 `rework / failed / cancelled`；
- 前置条件：只有所有硬依赖满足且 Gate 放行后，节点才能进入 `ready`；
- 幂等：命令与事件携带 `idempotency_key`，重复投递不得产生第二次不受控执行；
- 动态增删：运行中新增节点必须声明是否阻塞主链路；删除已运行节点必须转为取消或废弃，不能抹除历史；
- 取消传播：父 Requirement 取消时，未开始节点取消，在途 Execution 收到终止请求；对不可安全终止的操作进入人工处置；
- 返工循环：通过显式回流 Edge 创建新的 Execution，保留原 Result，不覆盖历史；
- 并发写入：状态更新采用版本检查或事件序列号，冲突必须合并或重试；
- 失败恢复：区分业务失败、Agent 失败、Runner 失联、策略拒绝和预算停止，并由不同 Policy 处理；
- 补偿：对产生外部副作用的节点定义 rollback / compensation，不把“重试”当作通用恢复方案；
- 终态：Requirement 只能在必需节点完成、阻塞 Bug 关闭、强制 Gate 放行后进入完成或发布状态。

状态变化应由事件驱动并带上：

```text
event_id / event_type
organization_id / work_item_id / execution_id
actor_member_id / source
graph_version / entity_version
idempotency_key
occurred_at
payload / policy_decision_id
```

数据库中的当前状态是事件应用后的可查询投影；审计时必须能够回答“谁、依据什么策略、在什么版本上把它改成了什么”。

---

## 10. Risk Policy 与 Human Gate

Human Gate 应由风险驱动，而不是“每个阶段都必须点一次同意”。

### 10.1 风险维度

风险评分至少考虑：

- 数据：是否读取、迁移、覆盖或删除真实数据；
- 权限：是否接触密钥、用户身份、管理权限；
- 环境：本地、测试、灰度还是生产；
- 财务：是否支付、退款、调用高成本资源；
- 外部影响：是否向客户、公众或合作方发送内容；
- 可逆性：是否可回滚、回滚成本多高；
- 变更范围：单文件、单服务、跨系统或架构级；
- 不确定性：验收标准是否完整、测试覆盖是否充分；
- Agent 历史表现：同类任务是否频繁返工或产生缺陷。

### 10.2 建议风险等级

| 等级 | 典型事项 | 默认处理 |
|---|---|---|
| L0 低风险 | 文案、样式、补测试、可逆小修复 | Work Cell 自动执行与验证 |
| L1 中风险 | 接口调整、状态管理重构、查询变化 | Domain Owner 或独立 Review Gate |
| L2 高风险 | Migration、支付、权限、生产部署、重大架构 | Human Principal 明确授权 |
| L3 关键风险 | 删除生产数据、不可逆资金操作、重大外部承诺 | 强制双重确认；少人模式下至少“时间延迟 + 再确认 + 可验证备份” |

### 10.3 Human Gate 的输入必须是决策包

不要只给人一个“批准 / 拒绝”按钮。Gate 应提供：

- 决策问题与为什么需要人；
- 变更摘要和可查看的差异；
- 验收标准、测试证据和失败项；
- 风险评分及命中规则；
- 预计成本、已花成本和剩余预算；
- 影响范围与回滚计划；
- Agent 建议、替代方案与未解决问题。

### 10.4 一人模式下的 Gate 合并

当 Product Owner、Engineering Owner、QA Owner 都是同一个 Human 时，系统不应制造“自己审批自己”的点击官僚。低风险 Gate 可以自动合并；但产品、工程、QA 等关键节点仍可保留为“角色切换检查点”，帮助本人从不同视角复核。

高风险 Gate 不因一人模式而消失。二次确认和冷静期只能降低误操作，不能冒充职责分离：部分 L3 操作必须配置外部第二批准者；无法配置时，应通过限制爆炸半径、可验证备份、回滚演练和 break-glass 审计勉强放行，或在 Single Principal Mode 下直接禁止。

### 10.5 Policy 决策顺序与可复现性

Risk Policy 应按以下顺序求值：

1. **硬禁止规则**：法律、合规、数据分类、环境和组织级禁令，任何评分都不能覆盖；
2. **强制 Gate 规则**：生产、资金、删除、权限提升等命中即进入指定 Human Gate；
3. **风险评分规则**：对可量化维度计算 L0～L3，取最高风险而不是简单平均；
4. **Agent / Runner 修正**：低可信执行者、无独立验证、Session 重建等只能上调风险；
5. **例外授权**：必须绑定范围、理由、批准人、到期时间和补偿控制，不能永久降低策略；
6. **重新评估**：任务范围、代码 diff、数据分类、目标环境、预算或执行者变化时重新计算。

每次判断生成不可覆盖的 `PolicyDecision`：

```text
policy_version
input_facts_hash
matched_rules
risk_level
required_gates
grants / denials
exception_id?
decided_at
```

`break-glass` 只用于紧急恢复：最小权限、短 TTL、强审计、立即通知 Accountable Human，并要求事后复盘；它不能成为常规绕过入口。

---

## 11. Agent 成本与预算

预算必须与任务一起创建，而不是月底看到账单后才统计。

### 11.1 预算层级

```text
Organization Budget
└── Project / Goal Budget
    └── Requirement / WorkItem Budget
        └── Work Cell / Execution Budget
```

建议字段：

```text
max_tokens
max_cost
max_runs
max_rework
max_duration
max_concurrency
deadline
reserve_ratio
```

达到任一硬上限后应停止或降级，并升级给 Owner，禁止无限 `实现 → Review → 返工` 循环。

### 11.2 成本不能只看 Token 单价

应同时跟踪：

- 每个“被最终接受的 Result”总成本；
- 一次通过率与平均返工次数；
- 缺陷回流率和线上回滚率；
- 平均完成时长与等待人决策时长；
- 人工介入次数和介入耗时；
- 因 Session 丢失、Runner 离线或上下文重建造成的浪费；
- 不同 Agent Profile 在不同任务类型上的性价比。

便宜但反复返工的 Agent 可能比单次昂贵但一次通过的 Agent 更贵。调度指标应优先采用 `cost_per_accepted_result`，而不是 `cost_per_run`。

### 11.3 超预算策略

按风险和任务价值，可配置：

1. 自动停止并请求 Owner；
2. 降级为更便宜的 Agent 或缩小任务范围；
3. 改为 Human Self Execution；
4. 申请追加预算并展示预期收益；
5. 取消低价值工作并保留已完成 Artifact。

### 11.4 并发预算账本

仅设置 `max_cost` 无法阻止多个并发 Run 一起穿透预算。预算服务应采用“预留—结算—释放”的账本：

```text
启动前：reserve(estimated_max_cost)
执行中：update_inflight_estimate(actual_usage)
结束时：settle(actual_cost)
取消/失败：release(unused_reservation)
```

新 Execution 只有在 `可用余额 ≥ 预留金额` 时才能启动。账本还应记录币种、供应商价格快照、模型计费单位、Runner/云资源成本、在途估算和汇率时间。硬停止允许一个可配置的终止容差，但容差也必须计入项目风险和预算预测。

---

## 12. Agent Session 与 Execution

### 12.1 三种执行模式

| 模式 | 场景 | 系统行为 |
|---|---|---|
| Self | Owner 本人完成 | 记录执行、结果、Artifact 和验收 |
| Managed Agent | 系统通过 Runner 调用本机或专属 Agent | 自动创建/恢复 Session 并回填结果 |
| External / Manual Agent | 用户在外部手动使用 Claude Code、Codex 等 | 用户回填结果，可选关联外部 Session ID；默认标记为未验证 |

三种模式最终统一为：

```text
WorkItem → Execution → Result → Review / Gate → Complete or Rework
```

### 12.2 Session 是引用，不是系统自建聊天

管理系统不应强行把所有 Agent 的内部消息转换成自己的统一 Chat 并承担全部上下文。更轻、更稳的方式是做 Session Router：

```text
AgentSessionBinding
├── provider
├── external_session_id
├── machine_id
├── repository_id
├── workspace_path / worktree_path
├── branch
├── created_at / last_used_at
├── status
└── transcript_ref
```

Session Identity 实际上是：

> `Provider + External Session ID + Machine + Workspace`

不能只存一个裸 Session ID，也不能假设所有供应商的 Session 都能跨版本、跨机器恢复。Adapter 应提供恢复能力和 fallback：原 Session 失效时，用任务上下文、结构化 Result 和必要的对话摘要重建上下文。

### 12.3 Task、Run 与 Session 不是 1:1

一个 Task 可以先后使用多个 Session；一个 Session 也可以在多个返工 Run 中继续：

```text
Task #102
├── Run #1 → Claude Session A：初版
├── Run #2 → Claude Session A：继续修改
└── Run #3 → Codex Session B：替代重构
```

历史 Run 不应被覆盖，它们共同构成可审计时间线。

### 12.4 Execution Contract

Agent 执行前至少获得：

```text
任务目标与上下文
验收标准
Repository / Branch / Worktree
允许修改范围与禁止操作
所需工具与 Artifact
测试、构建和检查要求
风险等级与 Human Gate 条件
预算、超时和最大返工次数
期望 Result Schema
```

### 12.5 Result Contract

执行结束至少回填：

```text
summary
changed_files / changeset
commit / patch reference
tests / build result
artifacts
known_issues
needs_human_decision
session_ref
actual_cost / duration
```

### 12.6 Execution 状态

建议状态包括：

```text
queued → leased → running
                  ├── waiting_for_input
                  ├── completed
                  ├── failed
                  ├── cancelled
                  └── lost
```

Runner 断网、关机或崩溃时，租约与心跳应让系统识别 `lost`，再由 Policy 决定恢复原 Session、换 Runner、换 Agent 或请求人处理。

完整 transcript 可选择云端存储或仅保留本机引用。默认界面只展示结构化摘要；“查看 Agent 对话”是二级入口，主要用于继续任务、排查问题和必要审计。

### 12.7 Result 可信度与独立 Review

Agent 自报“测试通过”只能算声明，不能自动升级为受信证据。Result 应标记验证来源：

```text
unverified         // 外部手工回填或无法复现
agent_reported     // Agent 自报，附日志但未由受信环境复验
runner_verified    // 受控 Runner 按固定命令执行并签名
ci_verified        // 受信 CI 在确定 Commit 上完成验证
human_verified     // 有授权的人完成验收
```

Review 独立性也应分级：同一 Session 自检最低；同一 Agent Profile 的新 Session 次之；不同 Profile、只读上下文的 Review 更高；受信 CI 和 Human Gate 提供不同类型的独立证据。Risk Policy 根据风险等级规定所需最低证据与独立性，而不是看到第二个 Agent 名称就视为独立审查。

---

## 13. Git / Repo / Runner / Credential 权限模型

### 13.1 Resource Layer

Agent 不直接“拥有公司的 Git 或机器”。所有能力都通过 Resource Layer 临时授予：

```text
Resource
├── Repository
├── Workspace / Worktree
├── Runner / Machine
├── Tool / Device
├── Environment
├── Credential / Secret
└── Artifact Store
```

### 13.2 三层安全边界

```text
Server = 编排者
  只能发送结构化任务和授权请求

Runner = 本机执行与策略边界
  校验授权、准备隔离工作区、调用 Agent、收集结果

Agent = 受限执行者
  只看见本次任务允许的目录、工具、网络和凭据
```

服务端原则上不得直接取得任意 Shell 权限。它发送的是“执行 Task #123”，而不是任意命令字符串。

### 13.3 最小权限授权

每次 Execution 创建短时 `CredentialGrant / ResourceGrant`：

```text
subject          // 哪个 Runner / Agent Role
resource         // 哪个 Repo、环境或服务
actions          // read、write、test、build、deploy 等
scope            // branch、path、environment、API scope
issued_for       // execution_id
expires_at       // TTL
revocation_rule
```

执行完成、取消、超时或失联后立即撤回。凭据应保存在 macOS Keychain、Windows Credential Manager、Linux Secret Service 或专用 Secret Broker 中，禁止明文写入配置、Prompt、日志和 Artifact。

### 13.4 Git 建议

- 每个任务优先使用独立 branch / worktree；
- Agent 默认不得直接写受保护分支；
- 提交、测试、Review、合并和发布是不同权限；
- 高风险变更必须附带可验证的 diff、测试和回滚方案；
- 合并权限不因“Agent 已完成”自动获得；
- 多个 Agent 并行时，以 Worktree 隔离并在集成节点处理冲突；
- 记录 Repo、base commit、head commit、patch 和执行环境，确保结果可复现。

### 13.5 Runner 身份与连接

Runner 应使用设备注册和设备凭据，经 TLS 主动连接云端或局域网服务端；不要求本机开放入站端口。云端版、私有部署版和离线局域网版尽量使用相同协议和权限模型。

### 13.6 Runner 威胁模型与强制控制

“结构化 Task”本身不能阻止 Agent 在本机执行危险命令，必须由操作系统和 Runner 强制约束：

| 风险面 | 强制控制 |
|---|---|
| 进程权限 | 使用专用低权限身份运行；禁止继承用户完整 Shell 环境 |
| 文件系统 | 只挂载任务 Worktree 与明确只读上下文；默认看不到个人目录和其他 Repo |
| 网络 | 默认拒绝或按域名/API scope 放行出口；生产网与公共 Pool 隔离 |
| 工具/命令 | 通过 Capability Allowlist 暴露工具；危险命令需本机 Policy 或 Human Gate |
| Secret | 运行时短时注入，避免进入 Prompt/stdout；日志与 Artifact 做脱敏扫描 |
| 产物 | 对 Commit、二进制、依赖和上传 Artifact 做来源、恶意内容与 Secret 扫描 |
| 审计 | 记录进程、工具、网络、文件变更、授权和终止原因；日志防篡改 |
| 紧急控制 | 支持 kill、撤销 Grant、隔离 Runner、冻结后续调度和保全现场 |

短时 Secret 一旦被恶意进程读取，事后撤销不能消除泄漏。因此高价值 Secret 应使用代理调用或签名服务，让 Agent 获得“执行特定动作”的能力而非原始秘密；必要时使用容器、虚拟机或独立设备进一步隔离。

---

## 14. 公共 Agent Pool 的边界

公共 Agent Pool 可以共享的是“标准化能力和弹性算力”，不能共享租户上下文、长期 Session、私有凭据或责任。

### 14.1 适合进入公共 Pool 的任务

- 不含秘密的公开资料整理；
- 公共仓库或经过脱敏代码快照的静态分析；
- 在无凭据、无生产网络的临时沙箱中运行测试；
- 文档格式转换、通用代码生成、低风险批处理；
- 只输出建议、没有外部写权限的 Review。

### 14.2 默认禁止进入公共 Pool 的任务

- 持有生产、支付、客户数据或管理员凭据；
- 读取完整私有仓库、个人目录或未脱敏日志；
- 恢复个人本机 Agent 的长期 Session；
- 写主分支、执行生产部署、删除或迁移真实数据；
- 处理受监管数据或跨租户可识别信息；
- 以公共 Pool 身份对外发送消息或作出商业承诺。

### 14.3 必需隔离措施

- 租户级调度、存储、网络和密钥隔离；
- 每次任务创建一次性环境，结束后销毁；
- 无跨组织 Session 恢复、缓存复用或记忆继承；
- 任务级临时授权，默认无网络、无秘密、无写权限；
- 对模型、Runner、输入快照、输出和成本保留 provenance；
- 公共 Pool 只能提交 Result，不能自行完成高风险 Gate；
- 私有任务优先采用用户自有 Runner / BYO Agent，公共 Pool 仅承担可切割的低风险子任务。

公共 Pool 的中心层可以管理 Agent Profile、容量、健康度和价格，但实际 Repo、Secret 与 Session 的授权必须绑定单次 Execution，不能给 Pool 一个长期“公司级账号”。

### 14.4 数据与供应商治理

进入公共 Pool 前，任务必须有数据分类（公开、内部、机密、受监管）和允许的处理地域。还应明确：

- 模型供应商是否保留输入输出、是否用于训练及保留期限；
- 第三方 Runner 镜像、依赖和更新的供应链签名；
- 缓存、快照、日志和临时盘的销毁证明；
- 输出中的代码、隐私、Secret 和提示注入外泄扫描；
- 子处理商、数据地域和跨境规则；
- 发生隔离失败时的停池、通知、取证和轮换凭据流程。

机密或受监管数据默认不进入公共 Pool，除非 Policy 明确允许且隔离、合同和审计要求全部满足。

---

## 15. 1 人模式与少人模式

### 15.1 Single Principal Mode（1 人模式）

同一个人可以同时拥有：

```text
Human Principal
Product Owner
Engineering Owner
Quality Owner
Release Owner
```

系统行为：

- 默认合并低风险内部审批，减少重复点击；
- 保留真正有价值的角色切换检查点；
- 允许 Owner 直接成为 Assignee；
- 支持 `1 Human + 0 Agent` 完整跑通；
- 支持先在外部手动调用 Agent，再回填 Result；
- 只在高风险、超预算、冲突或信息不足时中断本人；
- 用备份验证、冷静期和二次确认弥补无法进行职责分离的高风险场景。

理想体验是：本人提出“下个版本增加扫码登录，今晚先做 MVP”，系统生成可审阅的 Goal、Work Graph 和预算草案；若授权后自动推进，只有二维码有效期、异常预算和生产发布等真正需要判断的问题回到 Decision Inbox。

### 15.2 Few-person Mode（少人模式）

典型结构：

```text
Human Principal × 1
Domain Owner Human × 2～5
Human / Agent Members
```

系统在一人模式基础上增加：

- Domain 级目标、预算、权限与队列；
- 跨 Domain 的交付 Contract 和 Gate；
- 高风险操作的职责分离；
- Owner 转交、代理和请假机制；
- 每个 Owner 的 Agent Team 与私有 Runner 边界；
- 跨 Domain 冲突由 Company Copilot 汇总并提交 Principal；
- 组织扩大时通过 RoleAssignment 增加人，不重写 Workflow。

---

## 16. 管理面板信息架构

管理面板不应以“Agent 在线头像墙”为首页。首页应以人的注意力分配为中心。

### 16.1 Company Cockpit

- 当前 Goal、版本、预算消耗和整体风险；
- 正常自动推进的 Work Graph 数量；
- 阻塞、超预算、重复失败和等待 Human 的数量；
- 即将到期的 Release / Gate；
- 只展示需要关注的趋势，不展示每一条执行噪声。

### 16.2 Decision Inbox

统一接收待 Principal / Owner 决策的事项，按风险、截止时间和阻塞影响排序。决策后应自动恢复对应 Workflow。

### 16.3 Work Graph View

展示需求的并行节点、依赖、关键路径、回流、Gate 和实时状态。允许从 Requirement 下钻到 WorkItem、Execution、Result 和 Artifact。

### 16.4 Domain / Work Cell View

展示各 Domain 的责任人、在制品、预算、能力缺口、Cell 健康度和 Agent 调度效果，而不是只看“谁忙谁闲”。

### 16.5 Task Timeline

默认显示：重要评论、结构化执行摘要、Commit / Artifact、测试、成本、审批和状态变化。原始日志与 Agent 对话折叠为二级内容。

### 16.6 Cost & Risk Center

展示预算预测、超支原因、每个被接受结果的成本、Risk Policy 命中情况、临时授权和异常操作。

### 16.7 Release Center

汇总版本包含的 Requirement、未关闭风险、测试证据、变更范围、回滚方案和生产 Gate；发布必须是显式授权事件。

---

## 17. 核心数据模型

### 17.1 完整领域对象

```text
Organization
├── Member
├── Team / Domain
├── RoleAssignment
├── AgentProfile / Capability
├── Policy
└── Budget

Project
├── Goal
├── Requirement
├── WorkGraph
│   ├── WorkItem
│   ├── WorkEdge
│   ├── Gate
│   └── Decision
└── Release

WorkItem
├── accountable_human_id
├── operational_owner_id
├── assignee_member_id
├── WorkCell
├── Execution / AgentRun
│   ├── AgentSessionBinding
│   ├── Result
│   ├── CostRecord
│   └── TimelineEvent
├── Review
├── Comment
└── Artifact / TestResult / Commit

Resource
├── Repository
├── Workspace / Worktree
├── Runner / Machine
├── Environment / Tool
└── CredentialGrant / ResourceGrant
```

### 17.2 MVP 最小对象集

第一阶段无需一次实现全部对象。最小闭环可收敛为：

```text
Organization
Project
Requirement
WorkGraph / WorkEdge
WorkItem
Member
RoleAssignment
Execution
Result
Comment / TimelineEvent
Review / Gate
AgentSessionBinding（可选）
Artifact
```

Phase 0 即保留最小 WorkGraph 骨架；随后再扩展并行、条件分支、动态节点和回流能力，并加入 WorkCell、Policy、Budget、CostRecord、Runner、CredentialGrant 和 Release。

### 17.3 几个必须提前守住的关系

- `Accountable Human != Operational Owner != Assignee`，但允许三者是同一个人；
- `Task : Session` 不是 1:1；
- `Comment != Result`，评论是展示，Result 是事实；
- `Requirement Status != WorkItem Status`；
- `Agent Profile != Agent Role != Agent Session`；
- `Business Fact != Workflow Runtime State`；
- `Global Read != Global Execute`；
- `Budget Limit` 和 `Risk Policy` 必须能绑定到 Execution。

---

## 18. MVP 分阶段落地建议

### Phase 0：先证明“没有 Agent 也成立”

目标：让一个人用系统完整走通一个真实需求。

实现：

- Project、Requirement、WorkItem；
- Owner / Assignee；
- 最小线性 Work Graph（节点、依赖、Gate、版本和事件），避免后续更换核心模型；
- Timeline、Comment、Manual Execution、Result；
- Approve / Reject / Rework；
- Bug WorkItem 与 QA 回流；
- 一个简单 Release Gate。

暂不做：Agent Pool、复杂报表、甘特图、OKR、自动规划、复杂权限和完整 Jira 兼容。

验收：`1 Human + 0 Agent` 能完成“需求 → 开发 → 测试 → 验收 → 发布”，过程中没有信息只能埋在评论里。

### Phase 1：最小 Agent 闭环

目标：跑通“负责人把一个真实任务交给本机 Agent，Agent 回填，负责人打回，再恢复 Session 修改”。

实现：

- 一个本机 Runner；
- 一个 Repository / Worktree 模型；
- Codex 或 Claude Code 先接一个，再增加第二个 Adapter；
- Managed Agent Execution；
- AgentSessionBinding 与 Session resume；
- Execution / Result Contract；
- 结构化摘要、Commit、测试结果和对话入口；
- 简单预算：max cost、max runs、max duration；
- Runner 主动连接、租约、心跳和失联恢复。

验收：一个前端任务可完成 `分配 → 执行 → 回填 → Reject → 原 Session 继续 → Approve`。

### Phase 2：Work Graph、Work Cell、风险与成本

目标：从单任务自动化升级为可控的多节点并行协作。

实现：

- Work Graph 与依赖计算；
- Implementation / Review / Test Work Cell；
- Risk Policy 和基于风险的 Human Gate；
- 分层预算与超预算升级；
- Agent Profile 绩效与策略路由；
- Artifact、测试、Bug 回流和 Release 汇总；
- Decision Inbox 与 Company Cockpit。

验收：一个中等需求能并行推进多个端，系统只在人类决策点、超预算和高风险操作上中断。

### Phase 3：少人团队与生产级权限

目标：支持 2～10 人多 Domain 协作。

实现：

- Domain、RoleAssignment、Owner 代理与转交；
- 多 Runner、多仓库和多环境；
- ResourceGrant / CredentialGrant 与 Secret Broker；
- 职责分离、审计、受保护分支与生产发布权限；
- Domain 预算、跨域 Gate、通知与升级路径；
- 私有部署与离线 / 局域网模式。

### Phase 4：公共 Agent Pool 与策略调度

目标：在隔离、安全和单位经济性被验证后引入弹性公共能力。

实现：

- 租户隔离与一次性沙箱；
- 公共 / 私有任务分类；
- 脱敏、网络和 Secret Policy；
- 多供应商成本路由；
- Provenance、合规审计和容量治理。

不要在 Phase 1 就构建完整公共 Pool。先证明私有 Runner 上的 Session 闭环、预算约束和风险 Gate 真正可用。

### Workflow 技术选型原则

MVP 可使用数据库状态机加 HTTP long polling / WSS。出现大量长时间等待、可靠重试、跨天恢复、复杂人工 Signal 和多 Runner 调度后，再引入 Temporal 等耐久工作流引擎。无论采用何种引擎：

- Project、Requirement、WorkItem、Comment、Result 等业务事实仍存业务数据库；
- 工作流引擎只负责过程状态、等待、重试、超时和恢复；
- 不要把整个项目管理数据模型塞进工作流运行时。

### 两条端到端验收路径

**正常路径：**

```text
Human Principal 提出 Goal
→ Company Copilot 生成 Requirement / 最小 Work Graph / 预算草案
→ Operational Owner 确认验收标准
→ PolicyDecision 判定 L1，预算账本预留执行额度
→ Frontend Work Cell 启动，Runner 创建隔离 Worktree 和短时 Grant
→ Implementation Execution 回填 Result
→ 独立 Review + 受信 CI 在确定 Commit 上验证
→ Domain Owner 通过 Gate
→ 进入 Release，L2 生产 Gate 由 Human Principal 授权
→ 发布完成，结算成本并撤销全部 Grant
```

**异常路径：**

```text
Managed Agent 执行中 Runner 失联
→ Lease 到期，Execution 标记 lost，Secret Grant 立即撤销
→ 系统尝试在原 Machine 恢复 Session，失败
→ Adapter 用 Task Contract + 历史 Result 摘要重建新 Session
→ 新 Execution 申请预算预留时发现余额不足
→ Work Graph 暂停并向 Owner 提交“缩小范围 / 换执行者 / 追加预算 / 取消”决策包
→ Owner 缩小范围后重新执行
→ diff 意外包含生产 Migration，Policy 重新评估为 L2
→ Runner 拒绝继续，隔离现场并等待 Human Gate
→ Human 选择修改方案而非 break-glass，原 Execution 保留为完整审计记录
```

MVP 验收不只要跑通正常路径，还应通过异常路径证明：状态不会永久卡死、预算不会静默穿透、Session 丢失可降级、凭据能撤销、风险变化会重新触发 Gate。

---

## 19. 关键产品原则

1. **强化人的判断与组织杠杆，不以保留人工步骤为目标。**
2. **人因目标、授权和责任而存在，不因 Agent 暂时能力不足而存在。**
3. **Agent 是可选增强；零 Agent 时系统也必须完整可用。**
4. **Workflow 高于 Agent；任何 Agent Profile 都应可替换。**
5. **Owner 是责任角色，Assignee 是当前执行者。**
6. **让人处理异常和决策，不让人管理每一次模型调用。**
7. **风险决定 Human Gate，组织图不决定 Gate 数量。**
8. **预算、成本和停止条件是一等公民。**
9. **评论是人机协作界面，结构化 Result 才是系统事实。**
10. **Session 是外部上下文引用，不能假设永远可恢复。**
11. **默认最小权限，授权绑定单次 Execution，完成即撤回。**
12. **完整日志是二级信息；首页展示结果、证据、风险与决策。**
13. **先跑通一个真实闭环，再扩展组织、流程和 Agent 数量。**
14. **所有自动化都必须可暂停、可解释、可审计、可回滚或可升级。**

---

## 20. 反模式

### 20.1 把 Agent 做成数字员工头像墙

问题：看起来有团队感，却掩盖能力、权限、Session、成本和责任。  
修正：管理 Capability、Role、Execution 和 Result，而不是只管理 Agent 名称。

### 20.2 每个节点都要求 Human Approve

问题：人变成审批机器人，自动化收益被点击成本吃掉。  
修正：用 Risk Policy 决定 Gate，低风险自动流转，高风险提供决策包。

### 20.3 为一人公司制造虚假职责分离

问题：同一个人切换五个身份重复确认。  
修正：自动合并低风险 Gate，保留视角切换与高风险二次确认。

### 20.4 Agent 完成就等于任务完成

问题：模型自报完成导致项目状态失真。  
修正：Result 必须有验收标准、测试证据，并通过对应 Review / Gate。

### 20.5 用评论代替数据模型

问题：Bug、测试、Commit、成本和状态埋在自然语言里，无法查询和自动流转。  
修正：时间线展示 Comment，底层同步生成结构化事实。

### 20.6 把 Workflow 写死到某个 Agent

问题：供应商升级、Session 变化或工具失效会拖垮流程。  
修正：Workflow 面向 Role / Contract，Adapter 处理供应商差异。

### 20.7 Task 与 Session 强制 1:1

问题：无法继续原上下文、切换 Agent 或保留历史尝试。  
修正：Task、Run、Session 分层，多对多关联并保留时间线。

### 20.8 无限 Review / Rework 循环

问题：省下的人力成本被 Token、时间和重复失败吞掉。  
修正：设置 max runs、max rework、max cost 和升级策略。

### 20.9 云端服务持有任意本机 Shell

问题：产品退化为高风险远控系统。  
修正：服务端只编排结构化任务，Runner 本地校验并执行 Task Contract。

### 20.10 给公共 Agent Pool 长期公司凭据

问题：租户串扰、凭据泄漏和责任失控。  
修正：公共 Pool 默认无秘密、无写权限；所有授权绑定单次 Execution。

### 20.11 把原始思考和日志全部推到主时间线

问题：信息噪声淹没结果，人仍被迫管理 Agent 过程。  
修正：主时间线展示重要事件和结构化摘要，完整过程按需展开。

### 20.12 一开始就复制 Jira 全家桶

问题：大量通用项目管理功能稀释真正差异。  
修正：优先证明 `Owner → Agent / Human Execution → Result → Review → Workflow` 闭环。

### 20.13 用单次 Token 价格评价 Agent

问题：忽略返工、缺陷、人工介入和等待成本。  
修正：用“每个最终被接受结果的总成本”比较调度效果。

### 20.14 让 Company Copilot 成为超级管理员

问题：全局信息压缩能力被误当成全局授权。  
修正：默认广读、窄写、无秘密、无生产权限；重大变更必须走 Policy 与 Gate。

---

## 21. 成功指标

早期不要用“创建了多少 Agent”衡量产品。更有价值的指标是：

- 从 Goal 到首个可验收 Result 的时间；
- 每个最终被接受 WorkItem 的总成本；
- 人类每天需要处理的决策数及其平均价值；
- 低风险任务自动完成率；
- 中高风险任务正确触发 Gate 的比例；
- 一次通过率、返工率、缺陷回流率与发布回滚率；
- Session 恢复成功率和上下文重建成本；
- 超预算前被系统主动停止的比例；
- 因 Runner 离线造成的永久卡死数量；
- 未授权资源访问、秘密泄漏和越权生产操作数量（目标必须为 0）；
- 人从“管理 Agent 过程”转移到“做目标、风险和产品判断”的时间比例。

---

## 22. 最终判断

这套系统的长期价值不在于证明公司可以完全没有人，而在于重新划分人的位置：

> 人不再因亲自完成每一个任务而成为组织中心；人因设定目标、组织能力、分配资源、做价值判断并承担后果而成为组织中心。

真正 Agent-native 的研发管理面板，不是让一个人盯着更多 Agent，而是让一套受 Workflow、Risk Policy、Budget 和权限模型约束的 Agent 组织持续工作，并把人的注意力只带回到必须由人承担的地方。

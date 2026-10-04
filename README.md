# Hamming(8,4) SECDED 位错误定位与纠正教学后端

纯后端离线教学服务：TypeScript + Node.js + SQLite（`node:sqlite`，无原生编译依赖），
只做 API 与 CLI，无网页、无 Docker、无外部在线服务。

## 编码规则（版本 `hamming-8-4-secded-v1`）

- 位置从 **1** 开始编号；输入字符串下标 0 即位置 1（显示顺序）。
- 位置 1、2、4 为校验位；位置 3、5、6、7 依次放数据位 d1..d4；位置 8 为整体奇偶校验位。
- 偶校验：
  - `p1 = XOR(位置 1,3,5,7)`
  - `p2 = XOR(位置 2,3,6,7)`
  - `p4 = XOR(位置 4,5,6,7)`
  - `p8 = XOR(位置 1..7)`

## 解码判定（SECDED）

重算三组校验得综合征 `S = c1 + 2*c2 + 4*c4`，结合整体奇偶 `P`：

| S | P | 判定 |
|---|---|---|
| 0 | 偶 | `NO_ERROR` 未检测到错误 |
| ≠0 | 奇 | 定位第 S 位并翻转纠正 |
| 0 | 奇 | 纠正位置 8（整体校验位） |
| ≠0 | 偶 | `DOUBLE_ERROR_DETECTED`，拒绝输出可信数据 |

解码器只接收 8 位码字与规则版本，**不读取**原始数据或故障注入记录。
纠正后重新校验并按位置 3,5,6,7 提取数据。

> 保证范围：每码字**至多 2 位错误**。3 位及以上错误可能误判或漏检；
> `NO_ERROR` 不代表任意损坏下数据都正确。

## 环境要求

- Windows 本地，Node.js ≥ 22.5（建议 ≥ 23，`node:sqlite` 无需标志）。开发环境为 Node 25。
- 无需 Docker / WSL / 付费服务 / 网络。

## 命令

```powershell
npm install        # 安装 devDependencies（typescript/tsx/@types/node）
npm run build      # 编译到 dist/
npm test           # 运行全部测试（tsx + node:test）
npm start          # 启动 API（默认尝试 8080，被占用则自动选空闲端口；PORT 环境变量可指定）
npm run demo       # 运行完整演示（编码/四类错误/反例/实验流程）
node dist/cli.js layout                 # 位布局与校验方程
node dist/cli.js encode 1011            # 编码
node dist/cli.js decode 01100010        # 解码（不入库）
node dist/cli.js verify 01100010        # 独立核验外部码字（报告入库）
node dist/cli.js flip 01100110 3 5      # 翻转位置
node dist/cli.js experiment create 1011 # 创建故障实验
node dist/cli.js experiment inject 1 6  # 注入翻转并解码（原子写入）
node dist/cli.js experiment list        # 查看实验
```

数据目录默认为项目内 `data/`（可用环境变量 `SECDED_DATA_DIR` 覆盖）。

## API（默认 `http://127.0.0.1:8080`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/layout` | 位布局与校验方程 |
| POST | `/api/encode` | `{data:"dddd"}` → 码字 |
| POST | `/api/decode` | `{codeword, ruleVersion?}` 解码（不入库） |
| POST | `/api/verify` | `{codeword}` 独立核验外部码字，报告入库 |
| POST | `/api/flip` | `{codeword, positions:[...]}` 翻转 |
| POST | `/api/experiments` | `{data}` 创建实验 |
| GET | `/api/experiments` / `/api/experiments/:id` | 查询实验 |
| POST | `/api/experiments/:id/inject` | `{positions}` 注入并解码（原子写入） |
| GET | `/api/reports` | 独立核验报告列表 |

错误返回 `{"error":{"code","message"}}`，错误码包括：
`INVALID_INPUT`（长度/字符非法）、`INVALID_POSITION`、`DUPLICATE_POSITION`、
`BATCH_LIMIT`（批量上限 256）、`UNKNOWN_RULE_VERSION`、`NOT_FOUND`、`ALREADY_DECODED`、`BAD_JSON`。

## 手工核算样例（数据 `1011`）

- 数据位：位置 3,5,6,7 = 1,0,1,1
- `p1 = 1^0^1 = 0`，`p2 = 1^1^1 = 1`，`p4 = 0^1^1 = 0` → 位 1..7 = `0110011`
- `p8 = XOR(1..7) = 0` → **码字 `01100110`**

| 场景 | 接收码字 | 结果 |
|---|---|---|
| 数据位错误（翻位置 6） | `01100010` | S=6，P 奇 → 纠正位置 6，恢复 `1011` |
| 校验位错误（翻位置 2） | `00100110` | S=2，P 奇 → 纠正位置 2 |
| 整体校验位错误（翻位置 8） | `01100111` | S=0，P 奇 → 纠正位置 8 |
| 双位错误（翻位置 3,5） | `01001110` | S=6，P 偶 → 拒绝可信输出 |
| 三位错误（翻位置 1,2,3，反例） | `10000110` | 超出保证，被误判为位置 8 错误 |

## 持久化设计

SQLite 表：`rules`（编码规则）、`experiments`（原始输入、码字、注入位置、接收码字、
报告、统计）、`standalone_reports`（外部码字核验报告，无需登记原文）。
编码结果与接收结果分开保存；纠正不改写输入证据；注入+解码在单事务中原子写入，
失败回滚不覆盖已有记录；重启后按保存的接收码字可重现相同判断。
统计（对照原数据）在解码完成后才计算，不进入判断路径。

## 测试覆盖（`npm test`，9 项全部通过）

- 16 种数据无错往返；每种码字全部 8 个单翻转恢复原码字；全部 28 个双翻转拒绝可信输出
- 三位错误反例（误判演示）
- 非法长度/字符、前导零保留、重复位置、位置越界、批量上限、未知规则版本
- 事务语义（重复注入拒绝）、重启读取一致、外部码字独立核验、统计不进入判断路径

## 限制

- 仅教学用途：单码字 4 位数据，无文件条带擦除恢复、密码学保护、网络传输或其他纠错码。
- 结论仅在每码字 ≤2 位错误内有效；≥3 位错误可能误判或漏检。
- `node:sqlite` 在 Node 25 仍打印 ExperimentalWarning，属正常现象。

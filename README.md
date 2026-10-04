# Hamming SECDED (8,4) 位错误定位与纠正教学后端

纯本地运行的扩展汉明码教学服务：TypeScript + Node.js + SQLite（`node:sqlite` 内置模块），只提供 HTTP API 与 CLI，无网页、无 Docker、无外部在线依赖。

## 编码规则（版本 `hamming-secded-8-4-even-v1`）

- 位置编号从 **1** 开始，与输入字符串从左到右的显示顺序一致（位置 i = 字符串第 i 个字符）。
- 位置 1、2、4 为校验位；位置 3、5、6、7 依次放数据位 d1..d4；位置 8 为整个码字的额外奇偶校验位。
- 全部采用**偶校验**：
  - p1 覆盖位置 {1,3,5,7}
  - p2 覆盖位置 {2,3,6,7}
  - p4 覆盖位置 {4,5,6,7}
  - p8 覆盖位置 {1..8}

## 解码判定（SECDED）

重新计算三组校验得到综合征 S（c4c2c1），结合整体奇偶：

| 综合征 S | 整体奇偶 | 判定 |
|---|---|---|
| 0 | 通过 | 未检测到错误 |
| 非零 | 失败 | 单错，翻转位置 S |
| 0 | 失败 | 单错在位置 8，翻转位置 8 |
| 非零 | 通过 | 双位错误，不可纠正，**不输出可信数据** |

纠正后重新校验通过才按位置 3、5、6、7 提取数据。解码器只接收八位码字与规则版本，不读取原始数据或故障注入记录；实验模块仅在解码完成后对照原数据统计一致性。

> **保证范围**：结论仅在每码字至多两位错误时成立。三位及以上错误可能误判或漏检（见演示反例），“未检测到错误”不代表任意损坏下数据都正确。

## 环境要求

- Windows + Node.js >= 22.5（使用内置 `node:sqlite`，本机已在 Node 25 验证）
- 无需 Docker / WSL / 付费服务 / 网络

## 命令

```powershell
npm install        # 仅安装 typescript 与 @types/node
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API（默认端口 8787，被占用时自动选空闲端口；PORT 环境变量可改）
npm run demo       # 运行四类手工样例 + 三位错误反例演示
node dist/src/cli.js <命令>   # CLI
```

数据目录默认为项目内 `data/`（可用环境变量 `SECDED_DATA_DIR` 修改），SQLite 文件为 `data/secded.sqlite`。

## CLI 用法

```
node dist/src/cli.js encode 1011                 # 编码四位数据
node dist/src/cli.js check 01100010              # 独立核验外部码字（无需登记原文）
node dist/src/cli.js experiment create 1011      # 创建故障实验
node dist/src/cli.js experiment flip 1 3 5       # 翻转实验 1 的位置 3 和 5
node dist/src/cli.js experiment decode 1         # 解码并展示校验方程与前后对照
node dist/src/cli.js experiment list             # 列出实验
node dist/src/cli.js layout                      # 查看位布局
node dist/src/cli.js demo                        # 演示
```

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/layout` | 位布局与规则版本 |
| POST | `/api/encode` | `{data:"1011"}` → 八位码字 |
| POST | `/api/check` | `{received:"01100010", ruleVersion?}` 独立核验 |
| POST | `/api/experiments` | `{data:"1011"}` 创建实验 |
| GET | `/api/experiments` / `/api/experiments/:id` | 查询实验 |
| POST | `/api/experiments/:id/flip` | `{positions:[3,5]}` 注入翻转 |
| POST | `/api/experiments/:id/decode` | 解码并原子写入报告 |

## 输入校验与错误码

- 数据/码字必须是准确长度的 0/1 字符串（4 或 8 位），保留前导零；非法字符不会自动转零 → `ERR_INVALID_BITS`
- 翻转位置必须是 1..8 的整数且不重复，单次最多 8 个 → `ERR_FLIP_POSITIONS` / `ERR_DUPLICATE_POSITION`
- 规则版本不匹配 → `ERR_RULE_VERSION`；实验不存在 → `ERR_NOT_FOUND`
- 未注入翻转就解码 → `ERR_NOT_FLIPPED`；重复解码 → `ERR_ALREADY_DECODED`（409，不覆盖已有记录）
- 单次翻转位置数量上限 8（`MAX_FLIPS_PER_CALL`），实验批量上限常量 `MAX_BATCH_EXPERIMENTS = 256`

## 持久化

SQLite 保存：编码规则、实验原始输入、注入操作、接收码字、解码报告；独立核验报告单独存表（外部码字无需登记原文）。编码结果与接收码字分开保存，纠正不改写输入证据；解码结果与状态在同一事务中原子写入，失败回滚不覆盖。重启后按保存的接收码字重新解码可得到相同判断（有测试覆盖）。

## 手工核算样例（数据 `1011` → 码字 `01100110`）

- p1 = 1^0^1 = 0，p2 = 1^1^1 = 1，p4 = 0^1^1 = 0，p8 = 0^1^1^0^0^1^1 = 0
- 数据位错误（翻位置 6）：S=6，整体失败 → 纠正位置 6
- 校验位错误（翻位置 2）：S=2，整体失败 → 纠正位置 2
- 整体校验位错误（翻位置 8）：S=0，整体失败 → 纠正位置 8
- 双位错误（翻位置 3、5）：S=6，整体通过 → 拒绝输出
- 反例：翻位置 1、2、3（三位错误）→ 被误判为位置 8 单错，输出错误数据，说明超出保证范围

## 测试覆盖

- 全部 16 种四位数据的无错往返
- 每种码字的全部 8 个单翻转：恢复原码字与原数据
- 每种码字的全部 28 个双翻转：一律判定 `double_error`，不输出可信数据
- 三位错误反例、外部码字独立核验、非法长度/字符、重复位置、事务回滚、重复解码拒绝、重启后一致判断

## 限制

- 仅实现 (8,4) 扩展汉明码，不做文件条带擦除恢复、密码学保护、网络传输或其他纠错码。
- `node:sqlite` 在 Node 中仍为实验特性（启动时有 ExperimentalWarning，不影响功能）。
- 三位及以上位翻转不在保证范围内，可能误判或漏检。

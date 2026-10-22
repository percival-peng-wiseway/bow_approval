# BOW Approval

一个用于公司报销、项目报销和项目服务采购的审批工作台。界面为英文，币种 AUD。当前为可运行的 Node.js 本地版本；尚未适配 Cloudflare Workers / D1 / R2。

## 功能

- Home 提供统一 Request 入口和待处理事项。
- Corporation 报销：金额、日期、发票；按角色进行主管、Admin 和 Finance 审批。
- Projects：按项目查看报销与服务采购，设置 PM、Director 和大额复核门槛。
- 服务采购：Director + Finance 预批 → 申请人回传报价与合同 → 双方审批 → 付款计划 → 分期上传付款材料。尾款需验收证据、Director 审批和 Finance 复核。
- 支持退回修改、撤回、转 Director 复查、取消未付款部分、附件和活动记录。
- 服务端登录、权限校验和共享数据；原演示角色切换入口已移除。
- 可选本地发票 OCR；付款功能记录实际线下支付结果，不执行银行转账。

## 启动

需要 Node.js 22+，应用本身无需安装 npm 依赖。

```sh
git clone https://github.com/percival-peng-wiseway/bow_approval.git
cd bow_approval
```

首次运行需初始化账号。以下命令在 Bash 中输入初始密码，不将密码写入代码或命令历史：

```bash
read -r -s -p "Initial password: " APPROVAL_INITIAL_PASSWORD
printf '%s' "$APPROVAL_INITIAL_PASSWORD" | node scripts/create-accounts.mjs
unset APPROVAL_INITIAL_PASSWORD
npm run dev
```

打开 <http://127.0.0.1:4185/>。后续启动直接运行 `npm run dev`；初始化脚本不会覆盖已有账号。可通过 `PORT` 设置端口，`APP_DATA_DIR` 设置私有数据目录。服务默认只监听本机回环地址。

| 登录姓名 | 角色 |
| --- | --- |
| Joe | Director |
| Jason | Director |
| Steve | Director |
| Lewis | Finance |
| Kate | Admin |
| Hassan Kassem | Project Manager |
| Nidhi Pandey | Project Manager |

姓名不区分大小写。初始化时七个账号使用输入的初始密码；仓库不包含本机已配置的密码或账号哈希。

## 数据与登录

- `.local/accounts.json`：每账号独立盐的 scrypt 密码哈希。
- `.local/workspace.json`：共享申请、项目、附件与审批记录。
- `.local/browser-import.json`：旧浏览器工作区的导入备份。
- 会话使用 HttpOnly / SameSite=Strict Cookie，有效期 12 小时；退出或服务器重启后失效。
- 服务端从会话读取身份，按业务规则验证操作。版本检查防止并发修改覆盖。
- 当前为单组织共享工作区；已登录成员可读取共享数据，写入和审批按角色及流程限制。

在旧版本的原浏览器用 Kate 登录，且服务端工作区尚为空时，会自动导入 `approval-workspace-v1`。原浏览器副本保留，不覆盖已有服务端数据。旧角色编号保留用于历史关联；Employee、PM C/D 没有新登录账号。

私有运行数据、环境文件、研究抓取材料和截图不纳入 Git。换电脑使用时，单独迁移私有数据并配置运行环境。

## 发票 OCR（可选）

报销表单内的 **Scan invoice** 可扫描 PDF、PNG、JPEG、WebP，识别金额和日期并保留原件。请核对识别结果。

需要 Python 及 `pypdf`、`pypdfium2`、`Pillow`，以及包含 `eng` 语言包的 Tesseract。通过以下环境变量指定安装位置：

```sh
INVOICE_PYTHON=/path/to/python3 INVOICE_TESSERACT=/path/to/tesseract npm run dev
```

未配置 OCR 时，仍可手工填写并上传凭证。现有默认路径针对原开发电脑，不适用于所有环境。

## 验证

```sh
npm test
```

42 项测试覆盖业务规则、认证、七个账号、越权及身份伪造、并发冲突、迁移和会话失效。测试使用临时目录及临时服务器，不修改实际工作区。

`node tests/auth-browser.mjs` 为当前登录版本的端到端验证，覆盖报销及服务审批到付款流程。该脚本使用开发电脑已有的 Chrome / Playwright 绝对路径，其他环境需调整路径。其他使用 Demo role 的浏览器脚本属于历史版本记录。

## 目录

- `app/`：界面及审批领域逻辑。
- `server.mjs`：HTTP 服务、API 和发票扫描入口。
- `server/`：账号、会话及共享数据持久化。
- `ocr/`：本地文本提取与发票解析。
- `scripts/create-accounts.mjs`：账号初始化。
- `tests/`：领域、接口和浏览器测试；发票样例均为合成测试文件。

## 部署范围

本仓库上传不等同于上线。Cloudflare 部署需要适配服务端入口，将文件数据和内存会话迁到持久化服务，迁移附件，并另外配置 OCR。当前没有接入银行、会计系统或邮件通知，也未提供多组织隔离及不可篡改审计保证。

本项目基于公开产品信息独立实现工作流，没有包含 ApprovalMax 私有源码或 API。研究证据和历史迭代记录保留在原开发工作区的 `evidence/`，不随此源码仓库上传。

# 密码管理与手机上传

## 文件清单

| 范围 | 修改或新增文件 |
| --- | --- |
| 本地后端 | `server.mjs`、`server/auth.mjs` |
| Cloudflare 后端 | `cloud/worker.mjs`、`cloud/auth.mjs` |
| 密码界面与共用校验 | `app/main.mjs`、新增 `app/password-ui.mjs`、`app/password-policy.mjs` |
| 上传与移动布局 | 新增 `app/uploads.mjs`，修改 `app/business-ui.mjs`、`app/invoice-scan.mjs`、`app/styles.css`、`app/scan.css` |
| 数据库 | 新增 `migrations/0004_password_management.sql` |
| 自动化测试 | 新增 `tests/password.test.mjs`、`tests/uploads.test.mjs`、`tests/helpers/d1.mjs`、`tests/helpers/local-request.mjs` |
| 浏览器回归 | 新增 `tests/password-upload-browser.mjs`，修改 `tests/auth-browser.mjs` |
| 文档 | `README.md`、本文件 |

## 使用

登录员工点击右上角 **Account security** 修改自己的密码。输入当前密码、新密码及确认；新密码要求 12–128 字符，大小写、数字、符号至少包含三类，不能带首尾空白或与当前密码相同。成功后当前浏览器收到新会话，原有会话全部撤销。

Admin 在同一窗口点击 **Reset an employee password**，选择其他在用员工。可以设置并确认临时密码，也可以将两个密码框均留空生成随机密码。随机密码仅在本次成功响应和窗口中显示，不写入浏览器存储或服务器明文文件。关闭前复制并通过合适渠道交给员工；遗失后需重新重置。重置会撤销该员工全部现有会话。员工使用临时密码登录后，后端仅允许查询身份、退出及改密，改密前不能读写业务数据、下载文件或调用 OCR。

## 接口（两套后端相同）

- `POST /api/auth/change-password`：`{currentPassword,newPassword,confirmPassword}`。目标始终取当前会话，忽略外部指定的账号；成功返回 `{user}` 并换发 HttpOnly 会话 cookie。
- `POST /api/admin/reset-password`：`{accountId,temporaryPassword?,confirmPassword?}`。仅 Admin、仅其他有效员工。成功返回 `{ok:true,mustChangePassword:true}`；生成随机密码时额外返回一次 `temporaryPassword`。
- `/api/auth/login` 和 `/api/auth/me` 返回的 `user` 新增 `mustChangePassword` 布尔值。受限账号访问业务接口返回 HTTP 403 和 `code: PASSWORD_CHANGE_REQUIRED`。

沿用已有 Origin 同源、JSON Content-Type、`X-Requested-With: ApprovalWorkspace` 校验、4096 字节请求上限和无缓存响应。改密与重置共享每操作账号每 15 分钟 10 次的限流；重新登录不能绕过该限流。密码继续使用随机 salt + scrypt；不返回 salt/hash。

本地 `accounts.json` 通过临时文件和 rename 原子保存，登录/改密/重置串行处理；本地会话仍驻留进程内存。D1 使用凭据版本、条件更新以及原子 batch，避免重置与正在进行的改密/登录竞争导致旧凭据重新获得会话。

## 迁移与发布前操作

新增 `migrations/0004_password_management.sql`，没有修改已有迁移：

- `accounts.must_change_password`（默认 0）。
- `accounts.credential_version`（默认 0）。
- `sessions.credential_version`（默认 0）。
- 会话账号索引 `sessions_account`。

现有账号与会话均从版本 0 开始，不会因迁移自动改密码或强制改密。本地无需 SQL 迁移，修改密码时自动保存新增标记。

部署新版 Worker **之前**，对实际目标环境执行迁移。例如：

```sh
npx wrangler d1 migrations apply DB --env QA --remote
# 确认 QA 后，对生产环境执行：
npx wrangler d1 migrations apply DB --env prod --remote
```

这些命令仅供维护者后续操作；本次没有执行远端迁移、提交 Git 或部署。正常发布时要同时更新前端静态资源；本地服务需重启以加载新代码。

## 手机上传排查与修复

静态检查确认旧代码没有强制 `capture`，也没有同步 FileReader；不能据此断言所有手机卡住都有同一个原因。已识别并处理的具体问题：

1. 所有入口只列扩展名，没有独立相册入口。统一控件为 **Files** 与 **Photos / library** 两个可见原生 file input；前者同时列 MIME 与扩展名，后者使用 `image/*`，均不设置 capture、不通过异步 `.click()` 打开。原发票控件的透明覆盖样式已移除。类型过滤遵循 [HTML 文件上传规范](https://html.spec.whatwg.org/dev/input.html#file-upload-state-(type=file))；系统选择器的具体菜单由设备决定。
2. 合同选中就自动读取并调用 ABN 检查，容易让用户将后续等待误认成选择器卡住。现在选中仅记录文件并使旧 ABN 结果失效，用户点击 **Check ABN** 才读取、上传和查询。
3. 发票扫描失败后原 input 保留相同值，重选相同文件可能不触发 change，表现为没有响应。失败后清空两个 input 并恢复可选状态；取消关闭会中止 FileReader 和网络请求。
4. 多文件并发 Data URL 读取增加内存及后续编码压力。读取前检查类型、大小、文件数；每组逐个异步读取并让出事件循环，供应商组也顺序读取，业务表单新增文件总计限制为 8 MB/20 个，原各组及发票限制继续保留。PDF/JPG 等有效文件在移动文件提供者省略 MIME 时可按扩展名补全；HEIC、空文件及不支持的格式立即给出明确提示。
5. 发票预览图片采用异步解码，多页预览延迟加载。小屏文件控件改为单列，限制宽度；身份区允许换行，主页顶栏可增高，主要操作触控高度至少 44px，弹窗使用动态视口高度并支持内部滚动。

所有附件、报销发票、供应商报价/合同、付款/验收凭据及旧请求表单复用新控件。文件与相册所选文件会合并；取消选择不清空既有文件，提供 Clear selection 显式清空。当前后端仍只接收 PDF、JPG、PNG、WebP、TXT；HEIC 需先导出 JPG，未引入设备端大图转码。

## 验证记录与限制

- 新增 `tests/password.test.mjs`：8 个用例通过，涵盖两后端路由安全校验、权限、强度、确认、换发会话、全会话撤销、强制改密、持久化、限流、并发竞争和 Customer 隔离。本地调用真实 HTTP listener、不监听端口；云端运行真实 Worker 路由和全部迁移，用内存 SQLite 实现 D1 binding，只有 OCR Container 类被替换。此测试需要 Node 24（使用 `node:sqlite` / `registerHooks`）。
- 新增 `tests/uploads.test.mjs`：3 个用例通过，涵盖双入口、格式/大小/数量校验、MIME 缺失、顺序读取和中止。
- `npm test` 已执行：12 个测试文件中 10 个通过；`auth-server.test.mjs` 和 `customer-api.test.mjs` 因当前沙箱禁止本地监听，均在启动时遇到 `listen EPERM 127.0.0.1`，未能执行断言。没有跳过或修改它们来隐藏失败。
- `npm run build`、JavaScript 语法检查和 `git diff --check` 通过。
- `npm ci` 尝试因 `registry.npmjs.org` DNS `EAI_AGAIN` 失败，未完成 Wrangler 依赖安装，因此没有验证真实 workerd/D1 环境。
- 新增可选 `tests/password-upload-browser.mjs`，覆盖手机尺寸的改密/重置/强制改密、原生选择器、文件与照片混合上传、取消、超限和扫描失败后同文件重试；同步更新 `tests/auth-browser.mjs` 的显式 Check ABN 操作。本次浏览器回归被监听端口权限阻止；单独启动 Chrome 也因沙箱 `setsockopt: Operation not permitted` 失败，未完成视觉验收。

在支持端口监听和浏览器的环境安装依赖后重跑 `npm test`，再使用已安装的 Playwright 运行：

```sh
# PLAYWRIGHT_MODULE / CHROME_PATH 可选，可指定现有安装。
node tests/password-upload-browser.mjs
```

发布前在真实 iOS Safari 与 Android Chrome 验证文件/相册两个入口、取消、同文件重选、HEIC 提示、超限提示、合同 Check ABN、软键盘和横竖屏布局。浏览器自动化不能确认手机系统文件选择器的真实行为，本次也未声称已在真机复现或验证修复。

# TripSync 本地运行指南（macOS + Miniconda）

> 基于 Julia 的本机环境编写：macOS, Conda 26.1.1, PostgreSQL 16 (Homebrew), Node.js v24

## 0. 前提条件

以下工具你已经安装好了：

| 工具 | 版本 | 安装方式 |
|------|------|---------|
| Conda | 26.1.1 | Miniconda |
| PostgreSQL | 16.13 | Homebrew |
| Node.js | v24 | - |

确认 PostgreSQL 正在运行：

```bash
pg_isready
# 输出: /tmp:5432 - accepting connections
```

如果没有运行：

```bash
brew services start postgresql@16
```

## 1. 数据库

需要两个数据库：`tripsync`（开发）和 `tripsync_test`（测试）。确认它们存在：

```bash
psql -c "SELECT datname FROM pg_database WHERE datname LIKE 'tripsync%';"
```

应该看到：

```
    datname
---------------
 tripsync
 tripsync_test
```

如果缺少，手动创建：

```bash
psql -c "CREATE DATABASE tripsync;"
psql -c "CREATE DATABASE tripsync_test;"
```

> 注：你本机 PostgreSQL 使用的是系统用户 `juliawang`，无密码认证（trust），不是 README 中默认的 `postgres:password`。后面配置 `.env` 时需要修改连接串。

## 2. 创建 Conda 虚拟环境（后端）

```bash
# 创建 Python 3.11 环境
conda create -n tripsync python=3.11 -y

# 激活环境
conda activate tripsync
```

以后每次开发前都要先 `conda activate tripsync`。

## 3. 后端配置

```bash
cd backend

# 安装 Python 依赖（用 python -m pip 确保装到当前 conda 环境）
python -m pip install -r requirements.txt
```

### 安装 WeasyPrint 系统依赖（PDF 导出功能需要）

```bash
brew install pango
```

> 如果暂时不需要 PDF 导出功能，可以跳过。

### 创建 `.env` 文件

```bash
cp .env.example .env
```

然后编辑 `backend/.env`。下面逐项说明每个变量：

```env
# ============================================================
# 数据库连接
# ============================================================
# 格式: postgresql+asyncpg://<用户名>:<密码>@<主机>:<端口>/<数据库名>
#
# .env.example 默认值:
#   postgresql+asyncpg://postgres:password@localhost:5432/tripsync
#
# 你的本机 PostgreSQL 使用系统用户 juliawang，无密码(trust 认证)，
# 所以需要把用户名改为 juliawang，去掉 :password 部分。
# 开发数据库（alembic 迁移和日常运行使用）
DATABASE_URL=postgresql+asyncpg://juliawang@localhost:5432/tripsync

# 测试数据库（pytest 使用，每次跑测试会自动清空）
TEST_DATABASE_URL=postgresql+asyncpg://juliawang@localhost:5432/tripsync_test

# ============================================================
# JWT 认证
# ============================================================
# 用于签发 JWT token 的密钥，至少 32 个字符，随便写一串即可
SECRET_KEY=my-super-secret-key-for-local-dev

# JWT 签名算法，保持默认
ALGORITHM=HS256

# access token 过期时间（分钟）
ACCESS_TOKEN_EXPIRE_MINUTES=60

# refresh token 过期时间（天）
REFRESH_TOKEN_EXPIRE_DAYS=7

# ============================================================
# 可选：第三方服务（不配也能跑，对应功能会不可用）
# ============================================================
# DeepSeek AI 聊天 — 从 https://platform.deepseek.com/api_keys 获取
DEEPSEEK_API_KEY=

# CORS 允许的前端地址，本地开发保持默认即可
FRONTEND_ORIGIN=http://localhost:3000

# AWS S3 + SES（PDF 导出和邮件发送）— 本地开发一般不需要
AWS_REGION=ap-southeast-1
S3_EXPORT_BUCKET=
```

> **如何确认 DATABASE_URL 写对了？** 在终端运行：
> ```bash
> psql "postgresql://juliawang@localhost:5432/tripsync" -c "SELECT 1;"
> ```
> 如果输出 `1` 就说明连接串正确。如果报错，检查用户名和数据库名是否匹配。

### 运行数据库迁移

```bash
# 确保在 backend/ 目录下，conda 环境已激活
alembic upgrade head
```

这会按顺序执行 `backend/alembic/versions/` 下的 5 个迁移脚本，在 `tripsync` 数据库中创建所有表：

1. `initial_schema` — 用户、文件夹、行程、天、条目等核心表
2. `add_version_history` — 版本历史表
3. `add_alternatives_table` — 协作冲突替代方案表
4. `add_map_pins_table` — 地图标记表
5. `widen_time_columns` — 时间字段类型调整

验证建表成功：

```bash
psql -d tripsync -c "\dt"
```

> 项目没有 seed 数据脚本，所有数据（用户、行程等）通过前端注册/创建操作产生。
>
> `tripsync_test` 不需要手动建表。运行 `pytest` 时，测试框架（`conftest.py`）会自动在其中 create/drop 表，跑完测试会清空，不会影响 `tripsync` 中的开发数据。

### 启动后端

```bash
uvicorn app.main:app --reload --port 8000
```

后端运行在 http://localhost:8000，API 文档在 http://localhost:8000/docs

## 4. 前端配置

打开**新的终端窗口**：

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端运行在 http://localhost:3000（Vite 会自动把 `/v1/*` 请求代理到后端 8000 端口）。

## 5. 验证一切正常

1. 打开浏览器访问 http://localhost:3000
2. 注册一个账号
3. 创建一个 itinerary，试试编辑功能

## 6. 运行测试

```bash
# 后端测试（确保 conda 环境已激活）
cd backend
python -m pytest -v

# 前端测试
cd frontend
npm test
```

## 7. 日常开发流程

```bash
# 终端 1 — 后端
conda activate tripsync
cd backend
uvicorn app.main:app --reload --port 8000

# 终端 2 — 前端
cd frontend
npm run dev
```

## 8. 可选：第三方服务配置

这些不配也能跑，只是对应功能不可用：

| 功能 | 需要的环境变量 | 获取方式 |
|------|--------------|---------|
| AI 聊天 | 后端 `DEEPSEEK_API_KEY` | [DeepSeek Platform](https://platform.deepseek.com/api_keys) |
| 地图 | 前端 `VITE_GOOGLE_MAPS_KEY`（见下方） | [Google Cloud Console](https://console.cloud.google.com/) |
| PDF 邮件发送 | 后端 `AWS_REGION`, `S3_EXPORT_BUCKET` + AWS 凭证 | AWS 账号 |

**前端环境变量：** 在 `frontend/` 目录下创建 `.env` 文件：

```bash
cp frontend/.env.example frontend/.env
```

编辑 `frontend/.env`：

```env
# Google Maps JS API Key
# 从 https://console.cloud.google.com/apis/credentials 获取
# 需要启用 "Maps JavaScript API"
VITE_GOOGLE_MAPS_KEY=你的key填这里
```

> 不配也能跑，只是地图面板不会加载。

## 常见问题

**Q: `alembic upgrade head` 报连接错误？**
检查 `.env` 中的 `DATABASE_URL` 是否用了 `juliawang@localhost`（不是 `postgres:password@localhost`）。

**Q: 前端启动后页面空白？**
确认后端已在 8000 端口运行，检查浏览器控制台是否有网络请求错误。

**Q: WeasyPrint 相关报错？**
运行 `brew install pango`，如果仍报错可参考 [WeasyPrint 安装文档](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html)。

**Q: conda 环境忘记激活？**
如果 `alembic` 或 `uvicorn` 命令找不到，先运行 `conda activate tripsync`。

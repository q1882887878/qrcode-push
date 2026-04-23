# 二维码推送系统 - 部署指南

## 快速部署到 Render.com（免费，支持 WebSocket）

### 第1步：推代码到 GitHub

1. 打开 https://github.com/new ，创建一个新仓库
   - 仓库名：`qrcode-push`
   - 选择 **Public**（公开）
   - 不要勾选 README
   - 点 **Create repository**

2. 在项目目录打开终端，执行：
```bash
cd c:/Users/Amy/WorkBuddy/20260423204017/qrcode-push
git remote add origin https://github.com/你的用户名/qrcode-push.git
git push -u origin master
```

### 第2步：在 Render 上部署

1. 打开 https://render.com ，点 **Get Started** ，用 GitHub 账号登录

2. 登录后点 **New +** → **Web Service**

3. 选择你刚创建的 `qrcode-push` 仓库

4. 填写配置：
   - **Name**: `qrcode-push` （随便起）
   - **Region**: Singapore 或 Oregon
   - **Branch**: `master`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`

5. 点 **Create Web Service** ，等待部署完成（约2-3分钟）

### 第3步：获取你的地址

部署成功后，Render 会给你一个地址，比如：
- `https://qrcode-push-xxxx.onrender.com`

**你的链接：**
- 📱 前端（客户扫码访问）：`https://qrcode-push-xxxx.onrender.com/`
- 🖥️ 后台（你自己用）：`https://qrcode-push-xxxx.onrender.com/admin`

### 第4步：生成入口二维码

把前端地址 `https://qrcode-push-xxxx.onrender.com/` 用任意二维码生成器转成二维码即可。
比如用：https://cli.im/ 或 https://www.qrcode-generator.com/

---

## 使用流程

1. 你打开后台地址：`https://你的域名/admin`
2. 客户扫二维码进入前端页面
3. 客户输入手机号注册 → 你的后台立刻看到（有提示音🔔）
4. 你在后台输入要推送的链接 → 点推送到选中/全部
5. 客户手机上立刻显示对应的二维码

---

## 注意事项

- Render 免费版会在 15 分钟无访问后休眠，首次访问需等约 30 秒唤醒
- 如需 24 小时不休眠，可升级 Render 付费版（$7/月）
- 也可以部署到 Railway.app（$5/月起，不休眠）

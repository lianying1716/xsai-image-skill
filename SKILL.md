---
name: xsai-image-skill
description: 用户要画图、生成图片、做海报、配图、设计 logo/图标/头像/封面、P 图、改图、图生图或编辑图片时使用；通过星算中转调用生图与编辑模型并下载结果。Use when the user asks to generate, draw, design, or edit any image, picture, poster, logo, icon, avatar, or cover.
---

# 星算外部生图 Skill

这是面向外部 Agent 的受限 Token 生图工具，不使用长期分组 Key，也不修改桌面端内置技能。所有真实生成都会按星算账户当前模型和分组规则计费。

## 安全边界

- 首次使用运行 `node scripts/image.mjs auth login --scope media.list_models,media.read_capabilities`，只读授权可以查看目录。
- 需要生成、编辑、上传或下载时，重新申请整套官方 Skill 权限；授权由同一个共享 Grant 管理，不再为每个 Skill 单独维护权限。
- Token 只由本地状态目录保存轮换后的 refresh token，文件权限为 `0600`；绝不把 Token 放进提示词、日志、仓库或安装脚本。
- 不接受 `--api-key`、`--group-id`、`--provider-id` 等内部路由参数；模型和分组由 relay 根据授权决定。
- 生成失败不自动换模型重试，不把上游响应、文件绝对路径或签名 URL 写入错误消息。

## 命令

```bash
node scripts/image.mjs auth login --scope media.list_models,media.read_capabilities,media.generate,media.edit,media.jobs.read,media.files.upload,media.files.download
node scripts/image.mjs auth status
node scripts/image.mjs auth logout
node scripts/image.mjs models
node scripts/image.mjs generate --prompt "..." [--model MODEL] [--n 1]
node scripts/image.mjs edit --input ./source.png --prompt "..." [--mask ./mask.png]
node scripts/image.mjs job JOB_ID
node scripts/image.mjs download JOB_ID --output ./result.png
```

所有命令输出一行稳定 JSON。`auth login` 会返回验证地址和用户码；用户在浏览器完成批准后，命令才会领取 Token。

## 模型提示词路由

先读取 `references/model-profiles.json` 和实时 `/v1/images/capabilities`，再选模型。需要可读文字、海报或精确排版优先 `gpt-image-2`；写实场景、多参考融合优先 `gemini-3.1-flash-image`；自然语言创意和风格探索可选 `grok-imagine-image-2.0`。画像是提示词建议，不是权限或价格真相。

## 费用与结果

生图请求按星算账户当前模型和分组规则计费，不在 Skill 侧重复设置确认开关。结果 URL 是短时、绑定用户和授权 Grant 的签名地址；应立即下载到用户指定目录，不要长期转发 URL。

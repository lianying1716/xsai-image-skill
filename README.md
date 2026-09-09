# xsai-image-skill

星算外部生图 Skill，作为独立 GitHub 仓库发布。仓库已经内置运行时和模型画像，克隆后不依赖 `xsai-external-skills-pack` 或其他仓库。

- 入口：`scripts/image.mjs`
- 授权：设备码/浏览器授权，状态文件仅保存受限 refresh token
- 模型：GPT、Gemini、Grok 图片模型画像与提示词策略
- 能力：模型目录、生成、编辑、任务查询、结果下载
- 计费：由星算主站/relay 的账户、模型和分组规则决定，Skill 不重复实现计费门槛

支持 Node.js 18+。发布版本使用 GitHub tag，例如 `v1.0.0`。

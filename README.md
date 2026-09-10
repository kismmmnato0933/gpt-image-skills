# GPT Images

通过 OpenAI 兼容的图片接口生成图片或编辑本地参考图。项目使用 Node.js 内置 `fetch`，不依赖第三方 npm 包。

## 环境要求

- Node.js 22 或更高版本
- 一个支持图片生成接口的网关地址和 API key

## 安装

使用 `codex-marketplace` 从 GitHub 仓库安装技能：

```bash
npx codex-marketplace add kismmmnato0933/gpt-image-skills/skills/gpt-image-skills --skill
```

## 配置

运行初始化命令，按提示输入网关地址、API key 和模型：

手动设置config文件，先cd到目录，例如：

```bash
cd ~/.agents/skills/gpt-image-skills
```

运行初始化命令：

```bash
node scripts/gpt-images.mjs config-init
```

默认配置文件为项目目录下的 `config.json`。也可以通过 `--config` 指定路径，或使用环境变量：

```bash
export GPT_IMAGES_BASE_URL="https://ylscode.com/codex/v1"
export GPT_IMAGES_API_KEY="YOUR_API_KEY"
export GPT_IMAGES_MODEL="gpt-image-2"
```

配置检查不会发起网络请求：

```bash
node scripts/gpt-images.mjs check
```

## 生成图片

```bash
node scripts/gpt-images.mjs generate \
  --prompt '一只橘猫坐在窗边，柔和晨光，水彩插画' \
  --out ./output/cat.png
```

## 编辑参考图

```bash
node scripts/gpt-images.mjs edit \
  --image ./reference.png \
  --prompt '保留产品外形与标识，将背景改为白色摄影棚' \
  --out ./output/product.png
```

局部编辑可以额外传入 PNG 蒙版：

```bash
node scripts/gpt-images.mjs edit \
  --image ./reference.png \
  --mask ./mask.png \
  --prompt '只修改蒙版区域' \
  --out ./output/edited.png
```

支持 `png`、`jpeg` 和 `webp` 输出，以及 `--size`、`--quality`、`--background`、`--moderation` 等参数。使用 `--help` 查看完整用法：

```bash
node scripts/gpt-images.mjs --help
```

输出文件不会覆盖已有文件，API key 只保存在本地配置或环境变量中。

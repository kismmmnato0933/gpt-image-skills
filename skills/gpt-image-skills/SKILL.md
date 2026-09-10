---
name: gpt-images
description: 通过配置 base_url 和 api_key 的 OpenAI 兼容图片接口生成或编辑图片。用户要求使用 gpt-images、GPT 图片网关绘图、参考图编辑，或配置此技能时使用；默认模型 gpt-image-2，使用 Node.js 内置 fetch。
---

# GPT Images 绘图

使用随技能提供的 `scripts/gpt-images.mjs` 完成文生图、参考图编辑和本地保存。需要 Node.js 22+，无需安装 npm 包。把以下命令中的 `<技能目录>` 替换成此 SKILL.md 所在目录的绝对路径，不依赖当前工作目录。

## 配置

首次运行下面的命令，交互输入 `base_url`、API key 和模型，创建权限为 `0600` 的 `config.json`；命令不会覆盖已有文件：

```bash
node "<技能目录>/scripts/gpt-images.mjs" config-init
```

默认 skills 目录可直接使用：

```bash
node ~/.agents/skills/gpt-images/scripts/gpt-images.mjs config-init
```

该命令会把配置写入 `~/.agents/skills/gpt-images/config.json`。

脚本提供三个模型选项：`gpt-image-2`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`。

配置文件格式：

```json
{
  "base_url": "https://ylscode.com/codex/v1",
  "api_key": "YOUR_API_KEY",
  "model": "gpt-image-2"
}
```

`base_url` 会直接作为 API 前缀使用，脚本只在末尾追加 `/images/generations` 或 `/images/edits`，不自动补 `/v1`。请填写供应商要求的前缀，例如 `https://api.openai.com/v1`。真实密钥只写入本地配置或通过环境变量提供，不在回复、命令参数或日志中回显。

支持 `--config /绝对路径/config.json` 指定其他配置文件；也支持 `GPT_IMAGES_BASE_URL`、`GPT_IMAGES_API_KEY`、`GPT_IMAGES_MODEL` 环境变量。优先级为 `--model` > 对应环境变量 > 配置文件 > 默认模型。`base_url` 和 `api_key` 没有默认值；缺失时只询问缺失配置，不编造地址或凭据。

直接执行 `generate` 或 `edit` 即会发起绘图请求；不要求先运行端点检查或网络探测。需要单独核对配置时才运行 `check`，它不发网络请求。

## 绘图

根据用户要求形成具体提示词；有参考图时保留用户指定的主体、布局及不变细节，明确需要修改的内容。有本地图片使用 `edit`，纯文本使用 `generate`。把附件解析为实际存在的本地路径；不要把图片 URL 当成本地路径传入。

文生图：

```bash
node "<技能目录>/scripts/gpt-images.mjs" generate \
  --prompt '一只橘猫坐在窗边，柔和晨光，水彩插画' \
  --out /绝对路径/cat.png
```

单图或多图编辑（重复 `--image` 可添加参考图）：

```bash
node "<技能目录>/scripts/gpt-images.mjs" edit \
  --image /绝对路径/reference.png \
  --prompt '保留产品外形与标识，将背景改为白色摄影棚' \
  --out /绝对路径/product.png
```

局部编辑可额外传 `--mask /绝对路径/mask.png`。蒙版使用带透明区域的 PNG，与第一张参考图尺寸一致；透明区域表示需要编辑的部分。脚本检查文件类型，调用前确认蒙版尺寸和透明通道符合要求。

可选参数：

- `--model`：显式覆盖模型；默认 `gpt-image-2`，失败时不自动换模型。
- `--size`：例如 `1024x1024`、`1536x1024`、`1024x1536` 或 `auto`；自定义尺寸是否可用取决于网关及模型。
- `--quality`：`auto`、`low`、`medium`、`high`、`xhigh` 或 `max`；具体取值由模型决定。
- `--background`：`auto`、`opaque` 或 `transparent`；透明背景要求 `png` 或 `webp` 输出。
- `--moderation`：`auto` 或 `low`，控制 GPT image 模型的内容审核级别。
- `--output-compression`：JPEG/WebP 的 0–100 整数压缩等级；默认由服务端决定。
- `--user`：可选的终端用户标识，用于滥用监测。
- `--format`：`png`、`jpeg`、`webp`；默认从输出扩展名推导，显式传入时必须与扩展名一致。
- `--prompt-file`：从 UTF-8 文件读取长提示词，与 `--prompt` 互斥。
- `--timeout`：每个网络请求的超时秒数，默认 `600`。

每次请求固定 `n=1`。输出必须带 `.png`、`.jpg`、`.jpeg` 或 `.webp` 扩展名；脚本创建父目录，拒绝覆盖已有文件。用户没指定输出位置时，在当前工作目录使用有意义且未占用的文件名。已有用户绘图授权时直接执行，无需重复确认。

## 接口与失败处理

- 所有 HTTP 请求只使用 Node.js 内置 `fetch`，编辑上传使用内置 `FormData` 和 `Blob`。不调用 SDK、curl 或 Python 发送绘图请求。
- 绘图 API 仅使用 `POST <base_url>/images/generations` 和 `POST <base_url>/images/edits`。不调用 models、responses、chat/completions、variations 或任务轮询端点，不探测或回退到其他服务。
- generations 发送 JSON；edits 发送 multipart，单图字段为 `image`，多图字段为重复的 `image[]`。让 FormData 自动生成 Content-Type 和 boundary。
- 优先解码 `data[0].b64_json`。兼容网关返回 `data[0].url` 时，仅额外 GET 成品图片地址，不携带 Bearer 密钥，也不跟随重定向。这是成品下载，不是额外的绘图 API。
- 只支持同步图片响应；遇到异步任务、HTTP 错误、网络错误或超时即停止。请求失败不代表服务端没有执行，不自动重发付费请求。
- 保存失败时区分“接口已返回结果”和“生成未确认”，不要把仅 HTTP 成功称为绘图完成。成功后报告实际保存路径；具备图片预览工具时查看成品并按用户要求交付。

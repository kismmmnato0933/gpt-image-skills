#!/usr/bin/env node
import { readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = `用法（Node.js 22+，无第三方依赖）：
  node scripts/gpt-images.mjs config-init [--config PATH]
  node scripts/gpt-images.mjs check [--config PATH]
  node scripts/gpt-images.mjs generate --prompt TEXT --out PATH
  node scripts/gpt-images.mjs edit --image PATH [--image PATH] --prompt TEXT --out PATH
参数：--config PATH --model NAME --size WIDTHxHEIGHT --quality auto|low|medium|high|xhigh|max
      --background auto|opaque|transparent --moderation auto|low
      --output-compression 0..100 --user ID --format png|jpeg|webp
      --mask PNG --timeout SECONDS --prompt-file PATH
配置：config.json 中填写 base_url、api_key；model 可选 gpt-image-2、gpt-image-2.5-flare、gpt-image-2.5-sunburst。
环境变量：GPT_IMAGES_BASE_URL、GPT_IMAGES_API_KEY、GPT_IMAGES_MODEL（优先于文件）。
check 仅检查本地配置；每次绘图请求一张，不自动重试；已有输出文件不会覆盖。`;
let secret = '';
function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`请配置 ${name}`);
  return value.trim();
}
function httpURL(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('URL 必须使用 HTTP(S)，且不能包含用户名和密码');
  }
  return url;
}
function imageFormat(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('数据不是可识别的 PNG、JPEG 或 WebP 图片');
}
async function attach(form, field, path, mask = false) {
  const bytes = await readFile(resolve(path));
  const type = imageFormat(bytes);
  if (mask && type !== 'png') throw new Error('mask 必须是 PNG 图片');
  form.append(field, new Blob([bytes], { type: `image/${type}` }), basename(path));
}
async function main() {
  const { values: opts, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, config: { type: 'string' },
    prompt: { type: 'string' }, 'prompt-file': { type: 'string' }, out: { type: 'string' },
    image: { type: 'string', multiple: true }, mask: { type: 'string' },
    model: { type: 'string' }, size: { type: 'string' }, quality: { type: 'string' },
    format: { type: 'string' }, timeout: { type: 'string' },
    background: { type: 'string' }, moderation: { type: 'string' },
    'output-compression': { type: 'string' }, user: { type: 'string' },
  }});
  if (opts.help || !positionals.length) { console.log(help); return; }
  const [command] = positionals;
  if (positionals.length !== 1 || !['config-init', 'check', 'generate', 'edit'].includes(command)) {
    throw new Error('未知命令；使用 --help 查看用法');
  }
  const configPath = resolve(opts.config || resolve(root, 'config.json'));
  if (command === 'config-init') {
    await mkdir(dirname(configPath), { recursive: true });
    const readline = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
    try {
      const base_url = (await readline.question('base_url（例如 https://api.openai.com/v1）：')).trim();
      const api_key = (await readline.question('API key：')).trim();
      const models = ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
      console.log(`模型选项：${models.map((name, index) => `${index + 1}. ${name}`).join('  ')}`);
      const choice = (await readline.question('选择模型 [1-3，默认 1]：')).trim() || '1';
      const model = models[Number(choice) - 1];
      if (!model) throw new Error('模型选择无效，请输入 1、2 或 3');
      httpURL(requireText(base_url, 'base_url'));
      requireText(api_key, 'api_key');
      await writeFile(configPath, JSON.stringify({ base_url, api_key, model }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(`已创建 ${configPath}。`);
    } finally { readline.close(); }
    return;
  }
  let config = {};
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('配置文件无法读取或不是合法 JSON');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置必须是 JSON 对象');
  secret = requireText(process.env.GPT_IMAGES_API_KEY ?? config.api_key, 'api_key');
  const base = httpURL(requireText(process.env.GPT_IMAGES_BASE_URL ?? config.base_url, 'base_url'));
  if (base.search || base.hash) throw new Error('base_url 不能包含查询参数或片段');
  base.pathname = base.pathname.replace(/\/+$/, '');
  const model = requireText(opts.model ?? process.env.GPT_IMAGES_MODEL ?? config.model ?? 'gpt-image-2', 'model');
  if (!['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(model)) throw new Error('model 必须是 gpt-image-2、gpt-image-2.5-flare 或 gpt-image-2.5-sunburst');
  if (command === 'check') {
    console.log(JSON.stringify({ config: configPath, base_url: base.href, model, api_key: '已配置（隐藏）', network_checked: false }, null, 2));
    return;
  }
  if (opts.prompt && opts['prompt-file']) throw new Error('--prompt 和 --prompt-file 只能选一个');
  const prompt = requireText(opts['prompt-file'] ? await readFile(resolve(opts['prompt-file']), 'utf8') : opts.prompt, 'prompt');
  const out = resolve(requireText(opts.out, '--out'));
  const extension = extname(out).slice(1).toLowerCase();
  const format = opts.format ?? ({ jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' })[extension];
  if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('输出路径需使用 .png、.jpg、.jpeg 或 .webp 扩展名');
  if ((extension === 'jpg' ? 'jpeg' : extension) !== format) throw new Error('--format 与输出文件扩展名不一致');
  if (opts.quality && !['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(opts.quality)) throw new Error('quality 应为 auto、low、medium、high、xhigh 或 max');
  if (opts.background && !['auto', 'opaque', 'transparent'].includes(opts.background)) throw new Error('background 应为 auto、opaque 或 transparent');
  if (opts.moderation && !['auto', 'low'].includes(opts.moderation)) throw new Error('moderation 应为 auto 或 low');
  const compression = opts['output-compression'] === undefined ? undefined : Number(opts['output-compression']);
  if (compression !== undefined && (!Number.isInteger(compression) || compression < 0 || compression > 100)) throw new Error('output-compression 应为 0 到 100 的整数');
  if (opts.size && opts.size !== 'auto' && !/^[1-9]\d*x[1-9]\d*$/.test(opts.size)) throw new Error('size 应为 auto 或 WIDTHxHEIGHT');
  const timeout = Number(opts.timeout ?? 600);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 86400) throw new Error('timeout 应大于 0 且不超过 86400 秒');
  const images = opts.image ?? [];
  if (command === 'generate' && (images.length || opts.mask)) throw new Error('参考图或蒙版请使用 edit');
  if (command === 'edit' && !images.length) throw new Error('edit 至少需要一个 --image 本地图片路径');
  const payload = { model, prompt, n: 1, output_format: format };
  if (opts.size) payload.size = opts.size;
  if (opts.quality) payload.quality = opts.quality;
  if (opts.background) payload.background = opts.background;
  if (opts.moderation) payload.moderation = opts.moderation;
  if (compression !== undefined) payload.output_compression = compression;
  if (opts.user) payload.user = opts.user;
  if (opts.background === 'transparent' && !['png', 'webp'].includes(format)) throw new Error('background=transparent 时 format 必须为 png 或 webp');
  const headers = { Authorization: `Bearer ${secret}` };
  let body;
  if (command === 'generate') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  } else {
    body = new FormData();
    for (const [key, value] of Object.entries(payload)) body.append(key, String(value));
    for (const path of images) await attach(body, images.length === 1 ? 'image' : 'image[]', path);
    if (opts.mask) await attach(body, 'mask', opts.mask, true);
  }
  await mkdir(dirname(out), { recursive: true });
  // 请求前独占输出路径，避免已有文件导致付费请求成功后无法落盘。
  const output = await open(out, 'wx', 0o600);
  let saved = false;
  let completed = false;
  try {
    const endpoint = `${base.href.replace(/\/+$/, '')}/images/${command === 'generate' ? 'generations' : 'edits'}`;
    const response = await fetch(endpoint, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(timeout * 1000) });
    if (!response.ok) throw new Error(`绘图接口返回 HTTP ${response.status}；请核对网关、密钥、模型及参数`);
    if (response.status === 202) throw new Error('网关返回异步任务；此脚本仅支持同步结果，不调用轮询端点');
    const result = await response.json();
    const item = result.data?.[0];
    if (!item) throw new Error('响应缺少 data[0] 图片结果');
    completed = true;
    let bytes;
    if (typeof item.b64_json === 'string' && item.b64_json) {
      bytes = Buffer.from(item.b64_json, 'base64');
    } else if (typeof item.url === 'string') {
      // 兼容网关返回的成品链接；下载时不携带 API Key。
      const url = httpURL(item.url);
      const download = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeout * 1000) });
      if (!download.ok) throw new Error(`成品下载返回 HTTP ${download.status}`);
      bytes = Buffer.from(await download.arrayBuffer());
    } else throw new Error('响应缺少 b64_json 或 url');
    if (imageFormat(bytes) !== format) throw new Error('返回图片格式与请求不一致');
    await output.writeFile(bytes);
    saved = true;
    console.log(JSON.stringify({ path: out, model, endpoint, bytes: bytes.length }, null, 2));
  } catch (error) {
    throw new Error(`${error.message}。${completed ? '接口已返回结果，下载或保存未完成' : '若请求已发出，服务端仍可能执行'}；未自动重试。`);
  } finally {
    await output.close();
    if (!saved) await unlink(out);
  }
}
main().catch(error => {
  const message = secret ? error.message.split(secret).join('[已隐藏]') : error.message;
  console.error(`错误：${message}`);
  process.exitCode = 1;
});

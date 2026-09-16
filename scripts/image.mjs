#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createExternalSkillRuntime } from "../runtime/runtime.mjs";

const CLIENT_ID = "xsai-external-skills";
const CONSUMER_CLIENT_ID = "xsai-image-skill";
const DEFAULT_BASE_URL = process.env.XSAI_IMAGE_BASE_URL || "https://api.xsai5.xyz";
const DEFAULT_AUTH_BASE_URL = process.env.XSAI_IMAGE_AUTH_BASE_URL || "https://xsai5.xyz";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_PATH = path.join(ROOT, "references", "model-profiles.json");
const DEFAULT_SCOPES = ["media.list_models", "media.read_capabilities"];
// 该技能真正要用到的全部权限。auth login 不带 --scope 时按这个申请,避免
// "登录成功但调用 403,还得再授权一次"的往返。
const EXECUTION_SCOPES = ["media.generate", "media.edit", "media.jobs.read", "media.files.upload", "media.files.download"];
const FULL_SCOPES = [...DEFAULT_SCOPES, ...EXECUTION_SCOPES];
const runtime = createExternalSkillRuntime({
  clientId: CLIENT_ID,
  consumerClientId: CONSUMER_CLIENT_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultAuthBaseUrl: DEFAULT_AUTH_BASE_URL,
  stateEnv: "XSAI_IMAGE_STATE_DIR",
  stateName: "xsai",
  defaultScopes: FULL_SCOPES
});
const {
  readState,
  removeState,
  tokenFromRefresh,
  apiRequest,
  downloadFile,
  login
} = runtime;

function parseImageArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i]);
    if (!token.startsWith("--")) { args._.push(token); continue; }
    const body = token.slice(2);
    if (body === "wait" || body === "no-open") { args[body] = true; continue; }
    const equal = body.indexOf("=");
    if (equal >= 0) { args[body.slice(0, equal)] = body.slice(equal + 1); continue; }
    args[body] = argv[i + 1] && !String(argv[i + 1]).startsWith("--") ? argv[++i] : true;
  }
  args.command = args._[0] || "help";
  args.subcommand = args._[1] || "";
  return args;
}

function chooseImageModel({ prompt = "", model = "" } = {}) {
  if (model) return { model: String(model), reason: "用户指定模型" };
  const text = String(prompt).toLowerCase();
  if (/(文字|文本|海报|菜单|logo|标志|排版|infographic|poster|typography|label)/i.test(text)) {
    return { model: "gpt-image-2", reason: "任务包含可读文字或精确排版" };
  }
  if (/(写实|照片|摄影|产品|人像|photoreal|photo|product|portrait|reference)/i.test(text)) {
    return { model: "gemini-3.1-flash-image", reason: "任务偏写实场景或参考融合" };
  }
  return { model: "grok-imagine-image-2.0", reason: "任务适合自然语言创意和风格探索" };
}

function profileFor(profiles, model) { return profiles.find((item) => item.model_id === model) || null; }

function promptForModel(prompt, profile) {
  const strategy = String(profile?.prompt_strategy || "").trim();
  return strategy ? `${String(prompt).trim()}\n\n模型专用制作约束：${strategy}` : String(prompt).trim();
}

function buildImageRequest(args, { profiles = [] } = {}) {
  const prompt = String(args.prompt || "").trim();
  if (!prompt) throw Object.assign(new Error("缺少 --prompt"), { code: "invalid_request" });
  if (Object.hasOwn(args, "api-key") || Object.hasOwn(args, "api_key") || Object.hasOwn(args, "group-id") || Object.hasOwn(args, "provider-id")) {
    throw Object.assign(new Error("外部 Skill 不接受内部凭据或路由参数"), { code: "unsupported_option" });
  }
  const count = Math.max(1, Math.min(8, Number(args.n || 1)));
  const choice = chooseImageModel({ prompt, model: args.model });
  const profile = profileFor(profiles, choice.model);
  const body = { model: choice.model, prompt: promptForModel(prompt, profile), n: count };
  for (const key of ["size", "quality", "background", "response_format"]) if (args[key] !== undefined) body[key] = args[key];
  return { ...body, _meta: { choice, profile: profile ? { model_id: profile.model_id, prompt_strategy: profile.prompt_strategy } : null } };
}

function normalizeImageError(error) {
  const code = String(error?.code || "image_request_failed").replace(/[^a-z0-9_\-]/gi, "_").slice(0, 64);
  const known = new Set(["auth_required", "auth_recovery_required", "auth_busy", "authorization_pending", "invalid_request", "invalid_scope", "scope_required", "unsupported_option", "model_unavailable", "not_found", "rate_limited", "timeout"]);
  const message = known.has(code) ? String(error.message || "请求失败") : "图片服务暂时不可用，请稍后重试。";
  return { code, message };
}

async function readProfiles() {
  try { return Object.entries(JSON.parse(await fs.readFile(PROFILE_PATH, "utf8"))).map(([model_id, value]) => ({ model_id, ...value })); }
  catch { return []; }
}

async function downloadJob(jobId, output, fetchImpl = globalThis.fetch) {
  const state = await readState();
  const token = await tokenFromRefresh(state, fetchImpl);
  const job = await apiRequest(`/v1/images/jobs/${encodeURIComponent(jobId)}`, { token, fetchImpl });
  const item = job?.data?.[0];
  if (!item?.url) throw Object.assign(new Error("任务尚未产生可下载结果"), { code: "not_found" });
  const target = await downloadFile(item.url, path.resolve(output || `image-${jobId}.png`), { fetchImpl });
  return { job_id: jobId, output: target };
}

async function main(argv = process.argv.slice(2), fetchImpl = globalThis.fetch) {
  const args = parseImageArgs(argv);
  if (args.command === "help") return { usage: "xsai-image auth|models|generate|edit|job|download" };
  if (args.command === "auth" && args.subcommand === "login") return login(args, fetchImpl);
  if (args.command === "auth" && args.subcommand === "status") { const state = await readState(); const scopes = Array.isArray(state?.scopes) ? state.scopes : String(state?.scopes || "").split(/\s+/).filter(Boolean); return state ? { status: "configured", scopes, base_url: state.base_url } : { status: "signed_out" }; }
  if (args.command === "auth" && args.subcommand === "logout") { await removeState(); return { status: "signed_out" }; }
  const state = await readState();
  const token = await tokenFromRefresh(state, fetchImpl);
  if (args.command === "models") {
    const payload = await apiRequest("/v1/models", { token, fetchImpl });
    const profiles = await readProfiles();
    const byId = new Map(profiles.map((profile) => [profile.model_id, profile]));
    if (Array.isArray(payload?.data)) payload.data = payload.data.map((model) => ({
      ...model,
      profile: byId.get(model.id || model.model_id) || null
    }));
    return payload;
  }
  if (args.command === "job") return apiRequest(`/v1/images/jobs/${encodeURIComponent(args._[1] || "")}`, { token, fetchImpl });
  if (args.command === "download") return downloadJob(args._[1], args.output, fetchImpl);
  const profiles = await readProfiles();
  if (args.command === "generate") {
    const request = buildImageRequest(args, { profiles }); delete request._meta;
    const capability = await apiRequest(`/v1/images/capabilities?model=${encodeURIComponent(request.model)}`, { token, fetchImpl });
    if (!Array.isArray(capability?.data) || !capability.data.some((item) => String(item?.id || "") === request.model && item.available !== false)) {
      throw Object.assign(new Error("当前授权下模型不可用"), { code: "model_unavailable" });
    }
    return apiRequest(args.async ? "/v1/images/jobs" : "/v1/images/generations", { method: "POST", token, body: request, fetchImpl });
  }
  if (args.command === "edit") {
    if (!args.input) throw Object.assign(new Error("编辑需要 --input"), { code: "invalid_request" });
    const model = args.model || "gpt-image-2";
    const profile = profileFor(profiles, model);
    const form = new FormData(); form.set("model", model); form.set("prompt", promptForModel(String(args.prompt || ""), profile));
    form.set("image", new Blob([await fs.readFile(path.resolve(args.input))]));
    if (args.mask) form.set("mask", new Blob([await fs.readFile(path.resolve(args.mask))]));
    return apiRequest("/v1/images/edits", { method: "POST", token, body: form, fetchImpl });
  }
  throw Object.assign(new Error("未知命令"), { code: "invalid_request" });
}

export { apiRequest, buildImageRequest, chooseImageModel, normalizeImageError, parseImageArgs, main };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${JSON.stringify(normalizeImageError(error))}\n`);
    process.exitCode = 1;
  });
}

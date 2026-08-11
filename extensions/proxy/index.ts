import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

interface ProxyState {
  proxy: string;
  enabled: boolean;
  showStatusbar: boolean;
}

const DEFAULT_PROXY = "http://127.0.0.1:7890";
const STATUS_KEY = "proxy-toggle";

function stateFile(): string {
  return join(getAgentDir(), "proxy-toggle.json");
}

function loadState(): ProxyState {
  try {
    const raw = readFileSync(stateFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ProxyState>;
    return {
      proxy: parsed.proxy || DEFAULT_PROXY,
      enabled: !!parsed.enabled,
      showStatusbar: parsed.showStatusbar !== false,
    };
  } catch {
    return { proxy: DEFAULT_PROXY, enabled: false, showStatusbar: true };
  }
}

function saveState(state: ProxyState) {
  writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

function currentEnvProxy(): string | undefined {
  return process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? undefined;
}

function applyEnv(state: ProxyState) {
  if (state.enabled) {
    process.env.HTTP_PROXY = state.proxy;
    process.env.HTTPS_PROXY = state.proxy;
  } else {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
  }
}

function refreshStatus(ctx: ExtensionContext) {
  if (!ctx.hasUI) return;
  const s = loadState();
  const env = currentEnvProxy();
  if (s.showStatusbar) {
    // 短文本进 footer（powerline-footer 已支持扩展状态，位于左侧优先区）
    ctx.ui.setStatus(STATUS_KEY, env ? "代理:开" : "代理:关");
  } else {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }
}

export default function (pi: ExtensionAPI) {
  const state = loadState();
  // 启动/重载时自动应用保存的状态；用户 shell 已手动设置代理时不覆盖
  if (state.enabled && !currentEnvProxy()) {
    applyEnv(state);
  }

  pi.on("session_start", (_event, ctx) => {
    refreshStatus(ctx);
  });

  pi.registerCommand("proxy", {
    description: "切换代理：/proxy on|off|status|set <url>|statusbar on|off",
    handler: async (args, ctx) => {
      const [action, ...rest] = (args ?? "").trim().split(/\s+/);
      const s = loadState();
      switch (action) {
        case "on":
          s.enabled = true;
          saveState(s);
          process.env.HTTP_PROXY = s.proxy;
          process.env.HTTPS_PROXY = s.proxy;
          refreshStatus(ctx);
          ctx.ui.notify(`代理已启用: ${s.proxy}`, "info");
          await ctx.reload();
          return;
        case "off":
          s.enabled = false;
          saveState(s);
          delete process.env.HTTP_PROXY;
          delete process.env.HTTPS_PROXY;
          refreshStatus(ctx);
          ctx.ui.notify("代理已禁用", "info");
          await ctx.reload();
          return;
        case "set":
          if (!rest[0]) {
            ctx.ui.notify(`用法: /proxy set <url>，当前: ${s.proxy}`, "warn");
            return;
          }
          s.proxy = rest.join(" ");
          saveState(s);
          refreshStatus(ctx);
          ctx.ui.notify(`代理地址已设为: ${s.proxy}`, "info");
          return;
        case "statusbar": {
          const on = rest[0] === "on";
          s.showStatusbar = on;
          saveState(s);
          refreshStatus(ctx);
          ctx.ui.notify(on ? "状态栏显示代理状态" : "状态栏隐藏代理状态", "info");
          return;
        }
        default:
          refreshStatus(ctx);
          ctx.ui.notify(
            `状态: ${s.enabled ? "启用" : "禁用"} | 代理: ${s.proxy} | 进程env: ${currentEnvProxy() ?? "未设置"}`,
            "info"
          );
          return;
      }
    },
  });
}

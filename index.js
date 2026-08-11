// 小蕾米桌宠 - lifecycle 入口
// 职责：订阅宿主 EventBus，把 Agent 会话事件归约为桌宠动作状态；
// 通过 bus handler "remielle-xiaolemi:state" 向 routes 提供当前状态。
// 附带职责：自动部署并启动桌宠本体（assets/xiaolemi-pet.exe），设开机自启。
import fs from "fs";
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

// 桌宠本体部署目标：%LOCALAPPDATA%\XiaolemiPet\xiaolemi-pet.exe（独立于 .hanako，卸载插件后桌宠仍可单独运行）
const PET_EXE = "xiaolemi-pet.exe";
const PET_DIR = join(os.homedir(), "AppData", "Local", "XiaolemiPet");

// 部署诊断日志：直接写 .hanako/logs，绕过 ctx.log 通道（插件环境日志不可见时的排查手段）
const DEPLOY_LOG = join(os.homedir(), ".hanako", "logs", "xiaolemi-deploy.log");
function deployLog(s) {
  try { fs.appendFileSync(DEPLOY_LOG, new Date().toISOString() + " " + s + "\n"); } catch (e) { /* noop */ }
}

function petIsRunning() {
  try {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq " + PET_EXE, "/FO", "CSV", "/NH"], { encoding: "utf8" });
    return out.includes(PET_EXE);
  } catch (e) {
    deployLog("petIsRunning error: " + String(e));
    return false;
  }
}

// 部署 + 启动：释放 exe（大小变化时覆盖）→ 未运行则带 --autostart 启动（设开机自启）
function deployAndStartPet(ctx) {
  deployLog("deploy begin");
  try {
    // 注意：index.js 在插件根目录，assets 与它同级，用 ./assets/（routes/ 子目录里的代码才用 ../assets/）
    const src = fileURLToPath(new URL("./assets/" + PET_EXE, import.meta.url));
    const dest = join(PET_DIR, PET_EXE);
    mkdirSync(PET_DIR, { recursive: true });
    // 覆盖判断：目标不存在 / 大小不同 / 修改时间不同 都需更新。
    // 只比大小会漏掉“构建后大小恰好不变”的更新（2026-08-11 踩坑：新旧 exe 同为 20240896 字节）
    const srcStat = statSync(src);
    let needCopy = true;
    if (existsSync(dest)) {
      const destStat = statSync(dest);
      needCopy = srcStat.size !== destStat.size || srcStat.mtimeMs !== destStat.mtimeMs;
    }
    deployLog("src=" + src + " needCopy=" + needCopy);
    if (needCopy) {
      copyFileSync(src, dest);
      deployLog("copied -> " + dest);
    }
    if (petIsRunning()) {
      deployLog("already running, skip spawn");
      return;
    }
    const child = spawn(dest, ["--autostart"], { detached: true, stdio: "ignore" });
    child.unref();
    deployLog("spawned pid=" + child.pid);
  } catch (e) {
    deployLog("deploy failed: " + String(e));
    if (ctx.log && ctx.log.warn) ctx.log.warn("xiaolemi: pet deploy failed: " + String(e));
  }
}

const HANA_BUS_SKIP = Symbol.for("hana.event-bus.skip");

// 调试日志（文件）：记录每个事件与状态变化，便于定位“幽灵工作状态”
// 默认关闭；设 XIAOLEMI_STATE_LOG 环境变量为日志路径时开启（如指向 .hanako/logs 下）
const LOG_FILE = process.env.XIAOLEMI_STATE_LOG || "";
function logLine(s) {
  if (!LOG_FILE) return;
  try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + " " + s + "\n"); } catch (e) { /* noop */ }
}

const STATES = {
  IDLE: "idle",
  RUNNING: "running",
  WAITING: "waiting",
  REVIEW: "review",
  COMPLETE: "jumping",
  FAILED: "failed",
  WAVING: "waving",
};

// 事件类型 → 动作状态（基于实际观测到的 Hana 事件流校准）
// 工作：只有工具执行；思考：对话轮开始 / LLM 推理 / 回复输出；整轮结束回待机
const EVENT_MAP = {
  tool_execution_start: STATES.RUNNING,
  tool_execution_update: STATES.RUNNING,
  turn_start: STATES.REVIEW,       // 新一轮对话开始：思考
  llm_usage: STATES.REVIEW,        // LLM 推理中：思考
  message_start: STATES.REVIEW,    // 回复输出开始：思考
  message_update: STATES.REVIEW,   // 回复输出中：思考
  turn_end: STATES.IDLE,           // 整轮结束：回待机
  // tool_execution_end 不直接映射：工具完成不等于任务完成，走 2 秒确认
};

// 对话类事件已显式映射（思考态），不再需要兜底排除
const EXCLUDE_EVENTS = [];

// 工具完成 → 小庆祝，但 10 秒内只允许一次（防止频繁闪烁）
const TOOL_END_COOLDOWN_MS = 10000;
let _lastToolEndCelebration = 0;

// 关键词兜底（尚未观测到的事件名，先按语义猜）
function inferState(event) {
  const type = String((event && event.type) || "");
  if (EVENT_MAP[type]) return EVENT_MAP[type];
  if (EXCLUDE_EVENTS.includes(type)) return null; // 对话/思考类事件不改变桌宠状态
  const t = type.toLowerCase();
  if (!t) return null;
  if (t.includes("error") || t.includes("fail") || t.includes("abort")) return STATES.FAILED;
  if (t.includes("wait") || t.includes("approval") || t.includes("permission") || t.includes("ask") || t.includes("confirm")) return STATES.WAITING;
  if (t.includes("think") || t.includes("review") || t.includes("plan")) return STATES.REVIEW;
  if (t.includes("run") || t.includes("start") || t.includes("send") || t.includes("tool") || t.includes("work")) return STATES.RUNNING;
  return null;
}

// 工具名 + 参数 → “正在做什么”文案（显示在桌宠气泡，尽量具体）
const ACTIVITY_BY_STATE = { waiting: "等你拍板哦…", review: "嗯…让我想想…", failed: "哎呀！翻车啦…", complete: "搞定啦！耶！" };
const BROWSER_ACTIONS = { navigate: "打开页面", snapshot: "查看页面", click: "点击", type: "输入文字", scroll: "滚动", evaluate: "执行脚本", screenshot: "截图", wait: "等待", select: "选择", key: "按键" };
function activityFor(toolName, args) {
  const a = args || {};
  const map = {
    web_search: "正在大海捞针…",
    web_fetch: "正在找篇…",
    browser: "东瞅瞅西瞧瞧…",
    exec_command: "嘿咻嘿咻…",
    write: "正在创造宏伟的篇…",
    edit: "修修补补…",
    read: "翻翻小本本…",
    grep: "嗅嗅代码…",
    find: "躲猫猫找文件…",
    ls: "看看有啥好玩的…",
    media_generate_image: "涂涂画画…",
    media_generate_video: "剪剪视频…",
    office_read_document: "读读小作文…",
    stage_files: "整理小窝…",
  };
  if (map[toolName]) return map[toolName];
  const t = String(toolName || "");
  if (t.includes("browser")) return "东瞅瞅西瞧瞧…";
  if (t.includes("search")) return "正在大海捞针…";
  if (t.includes("media_generate")) return "在弄点好看的…";
  if (t.includes("office_")) return "在弄文档…";
  if (t.includes("plugin_dev")) return "捣鼓小插件…";
  if (t.includes("subagent")) return "喊小伙伴来帮忙…";
  return "偷偷忙活着…";
}

// 从事件里提取文本（message_update 的回复增量，字段兼容）
function extractText(ev) {
  const o = ev || {};
  const s = (x) => (typeof x === "string" ? x : "");
  const ame = o.assistantMessageEvent;
  return (
    s(o.text_delta) || s(o.text) || s(o.content) ||
    (ame && (ame.type === "text_end" || ame.type === "text_delta" || ame.type === "text_start") && s(ame.content)) ||
    (o.delta && s(o.delta.text)) ||
    (o.partialResult && (s(o.partialResult.text) || (o.partialResult.content && o.partialResult.content[0] && s(o.partialResult.content[0].text)))) ||
    ""
  );
}

export default class Plugin {
  async onload() {
    const ctx = this.ctx;
    this.petState = {
      current: STATES.IDLE,
      since: Date.now(),
      lastEvent: null,
      seen: [], // 最近事件类型，便于调试映射
      activity: null, // “正在做什么”文案（工具名 + 参数生成）
    };
    this.unsubscribe = null;
    this._pendingCompleteTimer = null;
    this._idleWatchdog = null;
    this.msgText = ""; // 本轮回复文本累积（思考内容显示）
    this._thinkAt = 0; // 思考文案节流时间戳
    this._logThrottle = {};

    const logEvent = (type) => {
      // 每类事件最多记 3 次，避免刷日志
      this._logThrottle[type] = (this._logThrottle[type] || 0) + 1;
      if (this._logThrottle[type] <= 3 && ctx.log && ctx.log.info) {
        ctx.log.info("xiaolemi event: " + type);
      }
    };

    // 订阅宿主总线，收集带 sessionId 的事件
    if (ctx.bus && typeof ctx.bus.subscribe === "function") {
      try {
        this.unsubscribe = ctx.bus.subscribe((event) => {
          const type = event && event.type ? event.type : null;
          logEvent(type || "(unknown)");
          const state = inferState(event);
          const agentId = (event && event.agentId) || "?";
          // 本轮工具记录（任务总结用）：turn 开始清空，工具开始收集动作
          if (type === "turn_start") {
            this.msgText = "";
          }
          else if (type === "message_update") {
            const t = extractText(event);
            if (t) this.msgText = (this.msgText || "") + t;
          }
          // 事件日志节流：同类事件 30 秒内最多记 1 条（message_update 刷屏不再撑爆日志）
          const evtKey = type || "(none)";
          if (!this._evtLogAt) this._evtLogAt = {};
          const nowE = Date.now();
          if (!this._evtLogAt[evtKey] || nowE - this._evtLogAt[evtKey] >= 30000) {
            this._evtLogAt[evtKey] = nowE;
            logLine("EVENT type=" + type + " agent=" + agentId + " err=" + (!!(event && event.isError)) + " infer=" + state + " prev=" + this.petState.current);
          }
          this.petState.lastEvent = type;
          // 注意：宿主事件不带 sessionId，只有 agentId，所以不做 session 过滤
          if (state) {
            // 工具执行报错 → 失败动作（优先级最高）
            if (event && event.isError) {
              clearTimeout(this._pendingCompleteTimer);
              this.petState.current = STATES.FAILED;
            } else if (type === "tool_execution_end") {
              // 工具完成：延迟 2 秒确认（期间无新工作事件才算任务完成），
              // 避免密集工具流导致“一直工作中”
              clearTimeout(this._pendingCompleteTimer);
              logLine("END -> debounce 2s");
              this._pendingCompleteTimer = setTimeout(() => {
                const now = Date.now();
                if (now - _lastToolEndCelebration >= TOOL_END_COOLDOWN_MS) {
                  _lastToolEndCelebration = now;
                  this.petState.current = STATES.COMPLETE;
                  this.petState.activity = "搞定！";
                  logLine("CONFIRM -> COMPLETE (celebrate)");
                  this.scheduleIdleFallback();
                } else {
                  this.petState.current = STATES.IDLE;
                  this.petState.activity = null;
                  logLine("CONFIRM -> IDLE (cooldown)");
                }
              }, 2000);
            } else {
              clearTimeout(this._pendingCompleteTimer);
              this.petState.current = state;
              this.petState.since = Date.now();
              logLine("SET " + state + " (cancel pending confirm)");
                if (state === STATES.RUNNING) {
                  this.petState.activity = activityFor(event.toolName, event.args);
                  this.armIdleWatchdog();
                } else if (state === STATES.REVIEW) {
                  this.updateThinkActivity();
                  this.armIdleWatchdog();
                } else {
                  this.petState.activity = ACTIVITY_BY_STATE[state] || null;
                }
                if (this.petState.current === STATES.COMPLETE) {
                  this.scheduleIdleFallback();
                }
            }
          }
          this.petState.seen = [...(this.petState.seen || []), type].slice(-12);
        });
      } catch (e) {
        if (ctx.log && ctx.log.warn) ctx.log.warn("xiaolemi: bus subscribe failed", String(e));
      }
    }

    // 供 routes / 其他插件查询当前桌宠状态
    if (ctx.bus && ctx.bus.handle) {
      this.register(ctx.bus.handle("remielle-xiaolemi:state", (payload) => {
        if (payload && payload.pluginId && payload.pluginId !== ctx.pluginId) return HANA_BUS_SKIP;
        return { ok: true, state: this.petState };
      }));
    }

    if (ctx.log && ctx.log.info) ctx.log.info("xiaolemi pet loaded");

    // 自动部署并启动桌宠本体（幂等：已运行则跳过）
    deployAndStartPet(ctx);
  }

  // 思考文案：有回复文本则显示最新内容（1.5 秒节流，避免 message 刷屏高频刷新气泡）
  thinkActivity() {
    return "嗯…让我想想…";
  }
  updateThinkActivity() {
    const nowT = Date.now();
    if (this._thinkAt && nowT - this._thinkAt < 1500) return;
    this._thinkAt = nowT;
    this.petState.activity = this.thinkActivity();
  }

  // 空闲看门狗：running/思考 持续 15 秒无新事件 → 自动回待机。
  // 兜底场景：tool_execution_end 事件缺失/延迟（turn 结束才 flush）、
  // 或 turn_end 缺失时，桌宠不会一直停在某个状态。新事件会重置看门狗。
  armIdleWatchdog(ms) {
    clearTimeout(this._idleWatchdog);
    this._idleWatchdog = setTimeout(() => {
      if (this.petState.current === STATES.RUNNING || this.petState.current === STATES.REVIEW) {
        this.petState.current = STATES.IDLE;
        this.petState.since = Date.now();
        this.petState.activity = null;
        logLine("WATCHDOG -> IDLE (no events)");
      }
    }, ms || 15000);
  }

  // 一次性庆祝后 3 秒回落待机（同时清掉“任务完成”活动文案，否则气泡会一直挂着）
  scheduleIdleFallback() {
    clearTimeout(this._completeTimer);
    this._completeTimer = setTimeout(() => {
      if (this.petState.current === STATES.COMPLETE) {
        this.petState.current = STATES.IDLE;
        this.petState.activity = null;
      }
    }, 3000);
  }

  async onunload() {
    try {
      if (this.unsubscribe && typeof this.unsubscribe === "function") this.unsubscribe();
    } catch (e) { /* noop */ }
    if (this.ctx && this.ctx.log && this.ctx.log.info) this.ctx.log.info("xiaolemi pet unloaded");
  }
}

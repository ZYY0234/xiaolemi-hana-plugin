// 小蕾米桌宠 - 状态查询路由（唯一对外接口：桌面桌宠轮询）
// 职责：把插件 lifecycle 归约出的桌宠状态暴露为 HTTP API，供 Tauri 桌宠 1.5s 轮询。
// 历史：UI 页面（/page /widget）、对话（/api/chat）与精灵图接口已移除，
//       宿主 tab 入口已摘除（manifest 不再声明 contributes）。

const HANA_BUS_SKIP = Symbol.for("hana.event-bus.skip");

let _lastLogged = null;
let _lastLoggedAt = 0;

export default function registerPluginUiRoutes(app, ctx) {
  // 桌宠状态查询：iframe 轮询这里
  app.get("/api/pet-state", async (c) => {
    const probe = c.req.query ? c.req.query("probe") : null;
    if (probe && ctx.log && ctx.log.info) {
      ctx.log.info("xiaolemi probe: " + String(probe));
    }
    const pluginCtx = c.get && c.get("pluginCtx") ? c.get("pluginCtx") : ctx;
    let state = null;
    if (pluginCtx && pluginCtx.bus && typeof pluginCtx.bus.request === "function") {
      try {
        const res = await pluginCtx.bus.request("remielle-xiaolemi:state", {});
        if (res && res.ok && res.state) state = res.state;
      } catch (e) {
        if (pluginCtx.log && pluginCtx.log.warn) pluginCtx.log.warn("xiaolemi: state request failed " + String(e));
      }
    }
    if (!state) {
      state = { current: "idle", since: Date.now(), lastEvent: null };
    }
    // 只在状态变化时记日志，避免轮询刷屏
    const key = state.current + "|" + state.lastEvent;
    const now = Date.now();
    if (_lastLogged !== key || now - _lastLoggedAt > 20000) {
      _lastLogged = key;
      _lastLoggedAt = now;
      if (pluginCtx.log && pluginCtx.log.info) pluginCtx.log.info("xiaolemi pet-state: " + JSON.stringify({ current: state.current, lastEvent: state.lastEvent }));
    }
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true, state });
  });
}

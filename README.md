# 小蕾米桌宠 · Hana 插件

把桌宠装进 HanaAgent：插件订阅 Hana 事件总线，把 Agent 会话状态归约为桌宠动画状态；
桌宠本体（Tauri exe，见 `assets/`）由插件自动部署到 `%LOCALAPPDATA%\XiaolemiPet\` 并启动，
通过本地 API `/api/pet-state` 每 1.5 秒轮询状态。

## 安装

### 方式一：下载安装包（推荐）

从 [Releases](https://github.com/ZYY0234/xiaolemi-hana-plugin/releases) 下载
`xiaolemi-hana-plugin-v0.1.0.zip`，解压得到 `remielle-xiaolemi` 文件夹，
放到 `C:\Users\<用户名>\.hanako\plugins\`，完全退出并重启 HanaAgent 即可。

### 方式二：clone 源码

```bash
git clone https://github.com/ZYY0234/xiaolemi-hana-plugin.git
```

把 `remielle-xiaolemi` 目录复制到 `C:\Users\<用户名>\.hanako\plugins\`，
重启 HanaAgent。（仓库内 `assets/xiaolemi-pet.exe` 即桌宠本体，插件会自动部署）

桌宠会在 HanaAgent 启动时自动部署到 `%LOCALAPPDATA%\XiaolemiPet\` 并设开机自启。

要求：HanaAgent ≥ 0.159.0；桌宠本体需 WebView2 运行时（Win11 自带）。

## Release

v0.1.0 提供：

- `xiaolemi-hana-plugin-v0.1.0.zip`：插件安装包（含桌宠本体，装进 Hana）
- `xiaolemi-portable-v0.1.0.zip`：独立桌宠便携版（不依赖 Hana，解压即用）

## 架构

```
Hana 事件总线 ──> index.js（事件归约）──> bus handler ──> routes/ui.js（HTTP /api/pet-state）
                                                              ▲
                            Tauri 桌宠本体（1.5s 轮询）────────┘
```

- 事件映射：工具执行 → 工作中；思考/回复 → 思考中；出错 → 翻车；
  工具完成（2s 确认，10s 冷却）→ 庆祝；15s 无事件看门狗 → 回待机
- 无 Hana 环境时桌宠纯待机，其余功能（拖拽/缩放/画画/右键/托盘）不受影响

## 目录

| 路径 | 说明 |
|---|---|
| `index.js` | 生命周期入口：事件订阅、状态归约、自动部署桌宠 |
| `routes/ui.js` | `/api/pet-state` HTTP 接口 |
| `assets/xiaolemi-pet.exe` | 桌宠本体（Tauri 构建，随插件分发） |
| `source/` | 动画触发配置与版权声明 |

## 版权

素材为米哈游《绝区零》官方活动素材的非商业同人衍生，仅限个人学习与非商业展示。
详见 `source/NOTICE.md`。

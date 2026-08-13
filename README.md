# 小蕾米桌宠 · Hana 插件

把桌宠装进 HanaAgent：插件订阅 Hana 事件总线，把 Agent 会话状态归约为桌宠动画状态；
桌宠本体（Tauri exe，见 `assets/`）由插件自动部署到 `%LOCALAPPDATA%\XiaolemiPet\` 并启动，
通过本地 API `/api/plugins/remielle-xiaolemi/api/pet-state` 每 1.5 秒轮询状态。

当前版本 **v0.2.0**（全屏事件化 + 生命周期定案）。

## 安装

### 方式一：下载安装包（推荐）

从 [Releases](https://github.com/ZYY0234/xiaolemi-hana-plugin/releases) 下载
`小蕾米桌宠插件-v0.2.0.zip`。

- **推荐**：在 HanaAgent 设置里用「安装本地插件」直接选择 zip（自动解包，无需手动处理目录）
- 手动安装：在 `C:\Users\<用户名>\.hanako\plugins\` 下**新建 `remielle-xiaolemi` 文件夹**，
  把 zip 内容解压进去，然后完全退出并重启 HanaAgent

### 方式二：clone 源码

```bash
git clone https://github.com/ZYY0234/xiaolemi-hana-plugin.git
```

把 `remielle-xiaolemi` 目录复制到 `C:\Users\<用户名>\.hanako\plugins\`，
重启 HanaAgent。（仓库内 `assets/xiaolemi-pet.exe` 即桌宠本体，插件会自动部署）

**生命周期**：桌宠随 Hana 启动而启动、退出而退出（设计定案）。插件不再设开机自启。

要求：HanaAgent ≥ 0.159.0；桌宠本体需 WebView2 运行时（Win11 自带）。

## Release

v0.2.0 提供两个包，桌宠本体（exe）是同一份，差别只在有没有 Hana 这个“大脑”：

- `小蕾米桌宠插件-v0.2.0.zip`：**插件安装包**（含桌宠本体），装进 Hana，桌宠随 Hana 启动/退出，
  并联动 Agent 工作状态（工作/思考/庆祝/翻车）。适合已经用 HanaAgent 的人。
- `小蕾米桌宠-便携版-v0.2.0.zip`：**独立桌宠便携版**，不依赖 Hana，解压双击 exe 即用，
  纯待机无状态联动。适合不用 Hana、只想要个桌宠陪着的人。

## 架构

```
Hana 事件总线 ──> index.js（事件归约）──> bus handler ──> routes/ui.js（HTTP /api/plugins/remielle-xiaolemi/api/pet-state）
                                                              ▲
                            Tauri 桌宠本体（1.5s 轮询）────────┘
```

- 事件映射：工具执行 → 工作中；思考/回复 → 思考中；出错 → 翻车；
  整轮结束时有工具完成（10s 冷却）→ 庆祝；15s 无事件看门狗 → 回待机
- 无 Hana 环境时桌宠纯待机，其余功能（拖拽/缩放/画画/右键/托盘）不受影响
- 全屏自动让路（v0.2.0）：切到全屏应用即时沉底，退出全屏恢复，不抢焦点

## 目录

| 路径 | 说明 |
|---|---|
| `index.js` | 生命周期入口：事件订阅、状态归约、自动部署桌宠 |
| `routes/ui.js` | `/api/plugins/remielle-xiaolemi/api/pet-state` HTTP 接口（对外路径） |
| `assets/xiaolemi-pet.exe` | 桌宠本体（Tauri 构建，随插件分发） |
| `source/` | 动画触发配置与版权声明 |

## 版权

素材为米哈游《绝区零》官方活动素材的非商业同人衍生，仅限个人学习与非商业展示。
详见 `source/NOTICE.md`。

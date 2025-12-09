# Safari Vibe Ultimate

Safari Vibe Ultimate 是一个极简风格的 Firefox/Chrome 新标签页扩展，灵感来源于 Safari 的起始页设计。它集成了原生书签同步、实时浏览建议和最近关闭标签页功能。

![Screenshot](screenshot.png) ## ✨ 主要功能

* **☁️ 原生书签同步**：直接读取浏览器书签中的 "Safari Vibe" 文件夹，支持云端同步。
* **⚡️ 实时更新**：自动监听浏览记录和会话变化，实时更新“建议”和“最近关闭”列表。
* **🎨 高度可定制**：支持深色/浅色模式、自定义壁纸和自定义网站图标。
* **🔒 安全隐私**：完全使用安全 DOM API 渲染，无数据搜集。

## 📦 安装方法

### Firefox / Chrome (开发者模式)

1.  下载本仓库的 [Latest Release](https://github.com/你的用户名/仓库名/releases)。
2.  解压下载的 zip 文件。
3.  打开浏览器扩展管理页面：
    * **Firefox**: 输入 `about:debugging` -> "此 Firefox" -> "临时载入附加组件..." -> 选择 `manifest.json`。
    * **Chrome**: 输入 `chrome://extensions` -> 打开右上角"开发者模式" -> "加载已解压的扩展程序" -> 选择文件夹。

## 🛠️ 开发说明

本项目使用原生 JavaScript (ES6+) 开发，无需构建工具。

1.  克隆仓库：`git clone https://github.com/你的用户名/仓库名.git`
2.  直接在浏览器中加载文件夹即可进行调试。

## 📄 开源协议

本项目基于 [MIT 协议](LICENSE) 开源。
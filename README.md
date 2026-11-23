# qqmp3-floating-lyrics

一个面向 `qqmp3.vip` 的浏览器用户脚本（Tampermonkey），利用 **Document Picture-in-Picture** 实现**跨标签页/跨窗口置顶悬浮歌词**，支持真逐字时间轴优先匹配与丝滑句间动态切换[cite: 3]。

## 功能特性

- **跨窗口置顶悬浮**：通过 Document Picture-in-Picture 弹出独立置顶小窗，切换到其他网页或其他桌面窗口时依然可见[cite: 3]。
- **双轨歌词获取**：优先读取页面自带 `.song-lyrics .lyrics-line` 的 `data-time` 时间轴，同时尝试从在线歌词库检索匹配[cite: 3]。
- **真逐字优先 + 句间动态切换**：检测到逐字时间轴时启用单字扫光推进；未命中逐字时则使用 `requestAnimationFrame` 进行上一句/当前句/下一句平滑切换，避免生硬均分带来的卡顿与误差[cite: 3]。
- **自动切歌同步**：监听当前播放歌曲（歌名、歌手）与播放进度（优先读取 `<audio>`，兜底读取页面时间显示），切歌后自动更新歌词[cite: 3]。

## 安装与使用

1. **安装脚本管理器**：在 Chrome、Edge 等支持该 API 的浏览器中安装 **Tampermonkey** 扩展[cite: 3]。
2. **导入脚本**：新建油猴脚本，将仓库中的 `qqmp3-floating-lyrics.user.js` 内容粘贴进去并保存[cite: 3]。
3. **打开悬浮窗**：访问 `https://www.qqmp3.vip/` 并播放音乐，点击右下角的 **「🎤 置顶歌词」** 按钮即可弹出置顶歌词窗口（首次弹窗需由用户点击触发）[cite: 3]。

## 环境与已知说明

- **浏览器要求**：建议使用最新版 **Chrome** 或 **Edge**（需支持 `window.documentPictureInPicture`）[cite: 3]。
- **歌词匹配说明**：部分冷门、翻唱或新歌在外部曲库中不一定包含逐字时间轴，此时会自动回退到整句动态切换[cite: 3]。
- **页面结构依赖**：脚本依赖 `qqmp3.vip` 当前的 DOM 结构（如 `#play-song-title`、`#play-song-artist`、`.song-lyrics` 等），若站点改版可能需要同步调整选择器[cite: 3]。

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。
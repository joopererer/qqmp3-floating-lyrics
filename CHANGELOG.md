# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-23

### Added
- **Responsive Line Layout & Dynamic Spacing**: Automatically switches between compact single-line bar (`< 92px`), classic three-line view (`92px–210px`), and multi-line scrolling view (`> 210px`) on PiP window resize, with dynamic row gap calculation and preset density options (Compact / Standard / Relaxed).
- **Three Switchable Skins & Color Themes**: Added Clean Panel (`克制`), Lyricify-inspired (`Lyricify`), and Karaoke Bar (`卡拉OK`) styles alongside Cyber Cyan, Warm Gold, and Light themes.
- **Left Album Cover Fade-in**: Displays the current track's album cover (`#play-album-cover`) on the left side with a wide, soft gradient fade mask and zero text/control occlusion.
- **Hover Playback Controls & Settings Drawer**: Revealing top pill controls on hover for Previous, Play/Pause, Next, and Play Mode (`#prev-btn`, `#play-btn`, `#next-btn`, `#play-mode-btn`), plus an in-window settings drawer.
- **Manual Lyric Search & Time Offset**: Added keyword search override for custom lyric matching, `±0.2s` time-axis offset calibration, toggleable smooth/instant line transition animation, and persistent settings via `GM_setValue` / `GM_getValue`.

## [0.1.0] - 2026-11-23

### Added
- Always-on-top floating lyric window powered by the Document Picture-in-Picture API.
- Dual-source lyric acquisition: prioritizes native `.song-lyrics` DOM timestamps (`data-time`) on `qqmp3.vip` and queries LRCLIB as a fallback/upgrade source.
- True word-level (karaoke-style) lyric parser supporting `[mm:ss.xx]char(ms)`, `char<ms>`, and `<mm:ss.xx>char` formats.
- Smooth `requestAnimationFrame`-driven line transitions (previous, current, and next line preview) when only line-level timestamps are available.
- Automatic song change detection and dual playback clock sync (`<audio>` element with DOM `#current-time` fallback).
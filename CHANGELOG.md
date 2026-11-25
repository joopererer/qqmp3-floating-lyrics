# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.5] - 2026-11-25

### Changed
- **Circular Borderless Favorite Button**: Matched the standalone favorite button height (`28px`) with the Settings pill using a circular shape and removed the accented border highlight when favorited.
- **Karaoke-Style Scrolling Header & Next Track Preview**: Added smooth marquee scrolling to the top `Title — Artist` header and appended the upcoming track (`下一首：...`) when playing in sequential or repeat-one mode (hidden in shuffle mode).

## [0.3.4] - 2026-11-25

### Changed
- **Standalone Favorite Button**: Moved the favorite toggle out of the left playback control pill into a standalone button positioned right next to the Settings button.
- **Synced Favorite Icon & Color**: Synchronizes the icon class (`far`/`fas fa-heart`) and computed color from the page's `.favorite-btn` element instead of using a hardcoded pink tint.

## [0.3.3] - 2026-11-24

### Added
- **Distinct Visual Skins**: Differentiated Clean Panel (left-aligned, subtle weight, no glow), Lyricify Stage (centered, accent glow), and Karaoke Bar (left-aligned with accent indicator bar and sweep highlight).
- **Favorite Sync Toggle**: Synced favorite/unfavorite status with `#song-list-body tr.active .favorite-btn`.

## [0.3.2] - 2026-11-24

### Changed
- **Default Ambient Mode**: Switched the default background effect to `Disco` and ensured segmented control active states stay synchronized upon opening the settings drawer.
- **Minimalist Music Mascot**: Refined the bottom-right status mascot to a cleaner minimalist silhouette SVG with three playback states (singing nod, interlude sway, paused).

### Fixed
- **Play/Pause Button Sync**: Added dual-source playback detection combining `#play-btn` icon/class inspection with `<audio>` paused state so the PiP play/pause icon stays accurate.
- **Centered Track Header**: Switched the top bar layout to a symmetrical 3-column grid (`1fr auto 1fr`) so the `Title — Artist` pill stays strictly centered regardless of hover button widths.

## [0.3.1] - 2026-11-24

### Improved
- **Top Bar Track Info**: Moved the current track title, artist, and lyric mode badge into the top bar center pill to save vertical lyric space.
- **Segmented Settings UI**: Grouped mutually exclusive options (row density, skin, color theme, and background FX) into clear segmented pill controls with active highlights.
- **Enhanced Line Scroll Animation**: Increased vertical slide-in distance and opacity fade transitions when switching lyric lines.

## [0.3.0] - 2026-11-24

### Added
- **Adaptive Cover Color Extraction**: Extracts the dominant color from `#play-album-cover` once per track change (cached) to tint the PiP background with a soft frosted-glass look, falling back gracefully on cross-origin images.
- **Left-Anchored Cover Scaling**: Anchored the album cover to `left center` and scaled its width dynamically with both window width and height while preserving a wide right-side gradient fade.
- **Optional Ambient Backgrounds**: Added selectable background modes (`Off` / `Waveform` / `Disco`) that pause automatically when audio stops.
- **Music Status Mascot**: Added a toggleable three-state music status indicator (Singing / Interlude / Paused).
- **Play Mode Synchronization**: Syncs directly with the page's `#play-mode-btn` state (`Sequential` / `Repeat One` / `Shuffle`).

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
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](httpskeepachangelog.comen1.1.0),
and this project adheres to [Semantic Versioning](httpssemver.orgspecv2.0.0.html).

## [Unreleased]

### Planned
- Responsive line count (1-line  3-line  multi-line scrolling) based on PiP window height
- In-window settings drawer (font size, color themes, lyric time offset)
- Manual lyric search & multi-source priority configuration

## [0.1.0] - 2026-11-23

### Added
- Always-on-top floating lyric window powered by the Document Picture-in-Picture API.
- Dual-source lyric acquisition prioritizes native `.song-lyrics` DOM timestamps (`data-time`) on `qqmp3.vip` and queries LRCLIB as a fallbackupgrade source.
- True word-level (karaoke-style) lyric parser supporting `[mmss.xx]char(ms)`, `charms`, and `mmss.xxchar` formats.
- Smooth `requestAnimationFrame`-driven line transitions (previous, current, and next line preview) when only line-level timestamps are available.
- Automatic song change detection and dual playback clock sync (`audio` element with DOM `#current-time` fallback).
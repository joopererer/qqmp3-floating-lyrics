// ==UserScript==
// @name         QQMP3 置顶悬浮歌词 (v0.3.2 播控状态同步 + 绝对居中歌名 + 默认Disco)
// @namespace    http://tampermonkey.net/
// @version      0.3.2
// @description  修复播放暂停状态同步、顶部歌名绝对居中、默认开启Disco氛围与设置项高亮同步
// @match        *://*.qqmp3.vip/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      lrclib.net
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'qqmp3_floating_lyrics_cfg_v032';
    const defaultConfig = {
        gapScale: 1.0,
        fontSize: 23,
        skin: 'lyricify',    // 'clean' | 'lyricify' | 'karaoke'
        theme: 'cyber',      // 'cyber' | 'gold' | 'light'
        adaptiveColor: true,
        fxMode: 'disco',     // 'off' | 'wave' | 'disco'（默认 Disco）
        showMascot: true,
        smoothAnim: true,
        offsetSec: 0
    };

    function loadConfig() {
        try {
            const raw = typeof GM_getValue === 'function' ? GM_getValue(STORAGE_KEY, null) : null;
            return { ...defaultConfig, ...(raw ? JSON.parse(raw) : {}) };
        } catch (e) {
            return { ...defaultConfig };
        }
    }

    function saveConfig(cfg) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(STORAGE_KEY, JSON.stringify(cfg));
            }
        } catch (e) {}
    }

    const themes = {
        cyber: {
            bg: 'radial-gradient(circle at 18% 10%, #1c263b 0%, #0d121c 100%)',
            accent: '#56f0ff',
            soft: 'rgba(86, 240, 255, 0.18)',
            glow: 'rgba(86, 240, 255, 0.32)',
            main: '#f8fafc',
            sub: 'rgba(248, 250, 252, 0.48)',
            muted: 'rgba(248, 250, 252, 0.22)',
            drawer: 'rgba(13, 18, 28, 0.95)',
            pill: 'rgba(15, 20, 31, 0.62)',
            coverOpacity: '0.38'
        },
        gold: {
            bg: 'radial-gradient(circle at 18% 10%, #2e2217 0%, #120e0a 100%)',
            accent: '#ffd166',
            soft: 'rgba(255, 209, 102, 0.2)',
            glow: 'rgba(255, 209, 102, 0.32)',
            main: '#fffbeb',
            sub: 'rgba(255, 251, 235, 0.48)',
            muted: 'rgba(255, 251, 235, 0.22)',
            drawer: 'rgba(18, 14, 10, 0.95)',
            pill: 'rgba(20, 15, 11, 0.62)',
            coverOpacity: '0.38'
        },
        light: {
            bg: 'linear-gradient(135deg, #ffffff 0%, #edf2f7 100%)',
            accent: '#0284c7',
            soft: 'rgba(2, 132, 199, 0.14)',
            glow: 'rgba(2, 132, 199, 0.18)',
            main: '#0f172a',
            sub: 'rgba(15, 23, 42, 0.52)',
            muted: 'rgba(15, 23, 42, 0.24)',
            drawer: 'rgba(255, 255, 255, 0.96)',
            pill: 'rgba(255, 255, 255, 0.78)',
            coverOpacity: '0.26'
        }
    };

    let cfg = loadConfig();
    let pipWindow = null;
    let currentSongKey = '';
    let parsedLyrics = [];
    let currentLineIndex = -1;
    let lyricMode = 'none';

    let cachedCoverUrl = '';
    let extractedRgb = null;
    let wavePhase = 0;
    let lastWaveDraw = 0;

    function buildLineOnly(startTime, endTime, text) {
        return {
            time: startTime,
            endTime: Math.max(endTime, startTime + 0.8),
            text: (text || '').trim(),
            words: null
        };
    }

    function toSec(min, sec, msStr = '0') {
        const ms = parseInt(String(msStr).padEnd(3, '0').slice(0, 3), 10) || 0;
        return parseInt(min, 10) * 60 + parseInt(sec, 10) + ms / 1000;
    }

    function parseTrueWordLyrics(rawText) {
        if (!rawText || typeof rawText !== 'string') return null;
        const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const result = [];
        const lineStartRegex = /^\[(\d{2}):(\d{2})(?:[.:](\d{1,3}))\]\s*(.+)$/;

        for (const line of lines) {
            const m = line.match(lineStartRegex);
            if (!m) continue;
            const lineStart = toSec(m[1], m[2], m[3]);
            const body = m[4];

            const durTokens = [...body.matchAll(/([^\s(<]+|\s+)[\(<](\d+)[\)>]/g)];
            if (durTokens.length >= 2) {
                let cursor = lineStart;
                const words = [];
                let plain = '';
                for (const tk of durTokens) {
                    const ch = tk[1];
                    const durSec = Math.max(parseInt(tk[2], 10) / 1000, 0.04);
                    plain += ch;
                    words.push({ char: ch, start: cursor, end: cursor + durSec });
                    cursor += durSec;
                }
                if (words.length > 0 && plain.trim()) {
                    result.push({ time: lineStart, endTime: cursor, text: plain.trim(), words });
                }
                continue;
            }

            const tagTokens = [...body.matchAll(/<(\d{2}):(\d{2})(?:[.:](\d{1,3}))>([^<]+)/g)];
            if (tagTokens.length >= 2) {
                const words = [];
                let plain = '';
                for (let i = 0; i < tagTokens.length; i++) {
                    const tk = tagTokens[i];
                    const start = toSec(tk[1], tk[2], tk[3]);
                    const ch = tk[4];
                    const nextStart = i < tagTokens.length - 1
                        ? toSec(tagTokens[i + 1][1], tagTokens[i + 1][2], tagTokens[i + 1][3])
                        : start + 0.35;
                    plain += ch;
                    words.push({ char: ch, start, end: Math.max(nextStart, start + 0.05) });
                }
                if (words.length > 0 && plain.trim()) {
                    result.push({
                        time: words[0].start,
                        endTime: words[words.length - 1].end,
                        text: plain.trim(),
                        words
                    });
                }
            }
        }

        if (result.length >= 3 && result.length / Math.max(lines.length, 1) >= 0.25) {
            result.sort((a, b) => a.time - b.time);
            return result;
        }
        return null;
    }

    function parseLineLrc(lrcText, totalDuration) {
        const rows = lrcText.split('\n');
        const temp = [];
        const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

        for (const row of rows) {
            const matches = [...row.matchAll(timeRegex)];
            if (!matches.length) continue;
            const text = row.replace(timeRegex, '').trim();
            if (!text) continue;
            for (const m of matches) {
                temp.push({ time: toSec(m[1], m[2], m[3]), text });
            }
        }

        temp.sort((a, b) => a.time - b.time);
        return temp.map((item, idx) => {
            const nextTime = idx < temp.length - 1 ? temp[idx + 1].time : (totalDuration || item.time + 4);
            return buildLineOnly(item.time, nextTime, item.text);
        });
    }

    function parseLyricsFromDom(totalDuration) {
        const lines = [...document.querySelectorAll('.song-lyrics .lyrics-line')];
        if (!lines.length) return null;

        const raw = lines
            .map(el => ({
                time: parseFloat(el.getAttribute('data-time') || '0'),
                text: el.textContent.trim()
            }))
            .filter(item => !isNaN(item.time) && item.text.length > 0);

        if (!raw.length) return null;

        return raw.map((item, idx) => {
            const nextTime = idx < raw.length - 1 ? raw[idx + 1].time : (totalDuration || item.time + 4);
            return buildLineOnly(item.time, nextTime, item.text);
        });
    }

    function searchLyricsByQuery(queryText, totalSec, expectedKey, forceOverride = false) {
        const url = `https://lrclib.net/api/search?q=${encodeURIComponent(queryText)}`;
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            onload(res) {
                if (!forceOverride && expectedKey !== currentSongKey) return;
                try {
                    const list = JSON.parse(res.responseText);
                    if (Array.isArray(list)) {
                        for (const item of list) {
                            const candidates = [item.syncedLyrics, item.plainLyrics, item.instrumental ? '' : null].filter(Boolean);
                            for (const cand of candidates) {
                                const wordParsed = parseTrueWordLyrics(cand);
                                if (wordParsed) {
                                    parsedLyrics = wordParsed;
                                    lyricMode = 'word';
                                    currentLineIndex = -1;
                                    return;
                                }
                            }
                        }

                        if (forceOverride || lyricMode !== 'line-dom') {
                            const hit = list.find(item => item.syncedLyrics);
                            if (hit) {
                                parsedLyrics = parseLineLrc(hit.syncedLyrics, totalSec);
                                lyricMode = 'line-api';
                                currentLineIndex = -1;
                                return;
                            }
                        }
                    }
                } catch (e) {}

                if (forceOverride) {
                    parsedLyrics = [buildLineOnly(0, 9999, `♪ 未找到匹配歌词：${queryText}`)];
                    currentLineIndex = -1;
                } else if (lyricMode === 'none') {
                    parsedLyrics = [buildLineOnly(0, 9999, `♪ ${queryText}（未找到在线歌词）`)];
                    currentLineIndex = -1;
                }
            }
        });
    }

    function getPlayModeInfo() {
        const btn = document.getElementById('play-mode-btn');
        if (!btn) return { icon: '🔁', label: '顺序' };
        const title = (btn.getAttribute('title') || btn.textContent || '').trim();
        const iconHtml = btn.innerHTML || '';

        if (title.includes('单曲') || iconHtml.includes('fa-redo') || iconHtml.includes('1')) {
            return { icon: '🔂', label: '单曲' };
        }
        if (title.includes('随机') || iconHtml.includes('fa-random') || iconHtml.includes('shuffle')) {
            return { icon: '🔀', label: '随机' };
        }
        return { icon: '🔁', label: '顺序' };
    }

    // 同步读取真实播放/暂停状态（结合 #play-btn 图标/属性 与 <audio>）
    function getIsPlaying(audio) {
        const playBtn = document.getElementById('play-btn');
        if (playBtn) {
            const html = playBtn.innerHTML || '';
            const cls = playBtn.className || '';
            const title = (playBtn.getAttribute('title') || '').toLowerCase();
            if (html.includes('fa-play') || cls.includes('play') || title.includes('播放')) {
                return false;
            }
            if (html.includes('fa-pause') || cls.includes('pause') || title.includes('暂停')) {
                return true;
            }
        }
        if (audio) {
            return !audio.paused;
        }
        return false;
    }

    function getPlaybackState() {
        const titleEl = document.getElementById('play-song-title');
        const artistEl = document.getElementById('play-song-artist');
        const coverEl = document.getElementById('play-album-cover');
        const audio = document.querySelector('audio');

        const title = titleEl ? titleEl.textContent.trim() : '';
        const artist = artistEl ? artistEl.textContent.trim() : '';
        const cover = coverEl && coverEl.src ? coverEl.src : '';

        const parseTimeStr = (str) => {
            if (!str) return 0;
            const parts = str.trim().split(':').map(Number);
            if (parts.length === 2 && !parts.some(isNaN)) return parts[0] * 60 + parts[1];
            if (parts.length === 3 && !parts.some(isNaN)) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            return 0;
        };

        let currentTime = parseTimeStr(document.getElementById('current-time')?.textContent || '');
        let duration = parseTimeStr(document.getElementById('total-time')?.textContent || '');

        if (audio && !isNaN(audio.currentTime) && audio.currentTime > 0) {
            currentTime = audio.currentTime;
        }
        if (audio && !isNaN(audio.duration) && audio.duration > 0) {
            duration = audio.duration;
        }

        const isPlaying = getIsPlaying(audio);
        const playMode = getPlayModeInfo();

        return { title, artist, cover, currentTime, duration, isPlaying, playMode };
    }

    function extractCoverColorOnce(url, onDone) {
        if (!url || url === cachedCoverUrl) return;
        cachedCoverUrl = url;
        extractedRgb = null;

        try {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 16;
                    canvas.height = 16;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, 16, 16);
                    const data = ctx.getImageData(0, 0, 16, 16).data;
                    let r = 0, g = 0, b = 0, count = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i + 3] < 128) continue;
                        r += data[i];
                        g += data[i + 1];
                        b += data[i + 2];
                        count++;
                    }
                    if (count > 0) {
                        extractedRgb = [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
                        if (typeof onDone === 'function') onDone();
                    }
                } catch (e) {}
            };
            img.src = url;
        } catch (e) {}
    }

    function syncDrawerActiveStates(doc) {
        if (!doc) return;
        doc.querySelectorAll('[data-gap]').forEach(b => {
            b.classList.toggle('active', parseFloat(b.dataset.gap) === cfg.gapScale);
        });
        doc.querySelectorAll('[data-skin]').forEach(b => {
            b.classList.toggle('active', b.dataset.skin === cfg.skin);
        });
        doc.querySelectorAll('[data-theme]').forEach(b => {
            b.classList.toggle('active', b.dataset.theme === cfg.theme);
        });
        doc.querySelectorAll('[data-fx]').forEach(b => {
            b.classList.toggle('active', b.dataset.fx === cfg.fxMode);
        });
        const adBtn = doc.getElementById('pipAdaptiveBtn');
        if (adBtn) {
            adBtn.textContent = `封面取色:${cfg.adaptiveColor ? '开' : '关'}`;
            adBtn.classList.toggle('active', cfg.adaptiveColor);
        }
        const msBtn = doc.getElementById('pipMascotBtn');
        if (msBtn) {
            msBtn.textContent = `角色:${cfg.showMascot ? '开' : '关'}`;
            msBtn.classList.toggle('active', cfg.showMascot);
        }
        const anBtn = doc.getElementById('pipAnimBtn');
        if (anBtn) {
            anBtn.textContent = `切行:${cfg.smoothAnim ? '滚动' : '瞬切'}`;
            anBtn.classList.toggle('active', cfg.smoothAnim);
        }
    }

    function applyThemeAndVars(doc) {
        if (!doc) return;
        const t = themes[cfg.theme] || themes.cyber;
        const root = doc.documentElement;

        let bgSurface = t.bg;
        if (cfg.adaptiveColor && extractedRgb) {
            const [r, g, b] = extractedRgb;
            if (cfg.theme === 'light') {
                const lr = Math.min(255, Math.round(r * 0.25 + 190));
                const lg = Math.min(255, Math.round(g * 0.25 + 190));
                const lb = Math.min(255, Math.round(b * 0.25 + 190));
                bgSurface = `radial-gradient(circle at 18% 20%, rgba(${lr}, ${lg}, ${lb}, 0.96) 0%, #eef2f7 100%)`;
            } else {
                const dr = Math.max(14, Math.round(r * 0.36));
                const dg = Math.max(18, Math.round(g * 0.36));
                const db = Math.max(26, Math.round(b * 0.36));
                bgSurface = `radial-gradient(circle at 18% 20%, rgba(${dr}, ${dg}, ${db}, 0.98) 0%, #0b0f17 100%)`;
            }
        }

        root.style.setProperty('--bg-surface', bgSurface);
        root.style.setProperty('--accent', t.accent);
        root.style.setProperty('--accent-soft', t.soft);
        root.style.setProperty('--accent-glow', t.glow);
        root.style.setProperty('--text-main', t.main);
        root.style.setProperty('--text-sub', t.sub);
        root.style.setProperty('--text-muted', t.muted);
        root.style.setProperty('--drawer-bg', t.drawer);
        root.style.setProperty('--pill-bg', t.pill);
        root.style.setProperty('--cover-opacity', t.coverOpacity);
        root.style.setProperty('--font-size', `${cfg.fontSize}px`);

        const wrap = doc.getElementById('pipWrap');
        if (wrap) {
            wrap.setAttribute('data-skin', cfg.skin);
            wrap.setAttribute('data-fx', cfg.fxMode);
            wrap.classList.toggle('hide-mascot', !cfg.showMascot);
        }
        syncDrawerActiveStates(doc);
    }

    function computeWindowLayout(doc) {
        if (!doc) return { radius: 1, mode: 'triple' };
        const w = doc.documentElement.clientWidth || 640;
        const h = doc.documentElement.clientHeight || 176;

        const dynamicBase = Math.max(6, Math.min(20, Math.round((h - 70) * 0.09)));
        const finalGap = Math.round(dynamicBase * cfg.gapScale);
        doc.documentElement.style.setProperty('--row-gap', `${finalGap}px`);

        const dynamicCoverW = Math.max(200, Math.min(360, Math.round(Math.max(w * 0.42, h * 1.35))));
        doc.documentElement.style.setProperty('--cover-width', `${dynamicCoverW}px`);

        const wrap = doc.getElementById('pipWrap');
        if (h < 92) {
            if (wrap) wrap.classList.add('compact-single');
            return { mode: 'single', radius: 0 };
        }
        if (wrap) wrap.classList.remove('compact-single');
        if (h < 210) return { mode: 'triple', radius: 1 };
        return { mode: 'multi', radius: 3 };
    }

    function renderWaveCanvas(doc, isPlaying, now) {
        const canvas = doc.getElementById('pipWaveCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (cfg.fxMode !== 'wave') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        if (now - lastWaveDraw < 42) return;
        lastWaveDraw = now;

        const w = doc.documentElement.clientWidth || 640;
        const h = doc.documentElement.clientHeight || 176;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }

        ctx.clearRect(0, 0, w, h);
        if (isPlaying) {
            wavePhase += 0.14;
        }

        const bars = Math.max(24, Math.floor(w / 18));
        const barW = Math.max(3, (w / bars) * 0.45);
        const step = w / bars;
        const accent = getComputedStyle(doc.documentElement).getPropertyValue('--accent').trim() || '#56f0ff';

        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.14;

        for (let i = 0; i < bars; i++) {
            const amp = isPlaying
                ? (Math.sin(wavePhase + i * 0.45) * 0.35 + Math.cos(wavePhase * 0.7 - i * 0.25) * 0.25 + 0.5)
                : 0.12;
            const barH = Math.max(4, amp * h * 0.48);
            const x = i * step + (step - barW) * 0.5;
            const y = h - barH;
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(x, y, barW, barH, 3) : ctx.rect(x, y, barW, barH);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    async function openFloatingLyrics() {
        if (!('documentPictureInPicture' in window)) {
            alert('当前浏览器不支持 Document Picture-in-Picture，请使用最新版 Chrome 或 Edge！');
            return;
        }
        if (pipWindow && !pipWindow.closed) {
            pipWindow.focus();
            return;
        }

        pipWindow = await window.documentPictureInPicture.requestWindow({
            width: 640,
            height: 176
        });

        const doc = pipWindow.document;
        doc.body.innerHTML = `
            <style>
                :root {
                    --bg-surface: radial-gradient(circle at 18% 10%, #1c263b 0%, #0d121c 100%);
                    --accent: #56f0ff;
                    --accent-soft: rgba(86, 240, 255, 0.18);
                    --accent-glow: rgba(86, 240, 255, 0.32);
                    --text-main: #f8fafc;
                    --text-sub: rgba(248, 250, 252, 0.48);
                    --text-muted: rgba(248, 250, 252, 0.22);
                    --border-hairline: rgba(255, 255, 255, 0.12);
                    --drawer-bg: rgba(13, 18, 28, 0.95);
                    --pill-bg: rgba(15, 20, 31, 0.62);
                    --cover-opacity: 0.38;
                    --cover-width: 260px;
                    --font-size: 23px;
                    --row-gap: 10px;
                }
                * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
                body {
                    height: 100vh;
                    overflow: hidden;
                    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
                }
                .pip-wrap {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    background: var(--bg-surface);
                    color: var(--text-main);
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    padding: 36px 24px 14px;
                    overflow: hidden;
                    transition: background 0.45s ease;
                }
                .pip-wrap.compact-single {
                    padding: 8px 20px;
                }
                .glass-sheen {
                    position: absolute;
                    inset: 0;
                    background: linear-gradient(125deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 50%, rgba(0,0,0,0.12) 100%);
                    pointer-events: none;
                    z-index: 2;
                }
                .left-cover-bg {
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    left: 0;
                    width: var(--cover-width);
                    overflow: hidden;
                    opacity: var(--cover-opacity);
                    pointer-events: none;
                    z-index: 1;
                    -webkit-mask-image: linear-gradient(
                        to right,
                        rgba(0, 0, 0, 1) 0%,
                        rgba(0, 0, 0, 0.92) 48%,
                        rgba(0, 0, 0, 0.45) 78%,
                        rgba(0, 0, 0, 0) 100%
                    );
                    mask-image: linear-gradient(
                        to right,
                        rgba(0, 0, 0, 1) 0%,
                        rgba(0, 0, 0, 0.92) 48%,
                        rgba(0, 0, 0, 0.45) 78%,
                        rgba(0, 0, 0, 0) 100%
                    );
                    transition: width 0.2s ease, opacity 0.25s ease;
                }
                .left-cover-bg img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    object-position: left center;
                    display: block;
                }
                .pip-wrap.compact-single .left-cover-bg {
                    width: calc(var(--cover-width) * 0.78);
                }

                #pipWaveCanvas {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 2;
                }

                .disco-layer {
                    position: absolute;
                    inset: -35%;
                    pointer-events: none;
                    z-index: 2;
                    opacity: 0;
                    background:
                        radial-gradient(circle at 22% 30%, rgba(86, 240, 255, 0.24), transparent 44%),
                        radial-gradient(circle at 78% 68%, rgba(255, 105, 195, 0.22), transparent 46%),
                        radial-gradient(circle at 58% 22%, rgba(255, 209, 102, 0.18), transparent 42%);
                    transition: opacity 0.35s ease;
                }
                .pip-wrap[data-fx="disco"].is-playing .disco-layer {
                    opacity: 1;
                    animation: discoSpin 9s linear infinite;
                }
                .pip-wrap[data-fx="disco"]:not(.is-playing) .disco-layer {
                    opacity: 0.45;
                }
                @keyframes discoSpin {
                    0% { transform: rotate(0deg) scale(1); }
                    50% { transform: rotate(180deg) scale(1.08); }
                    100% { transform: rotate(360deg) scale(1); }
                }

                /* 三栏对称网格：保证中间歌名标题栏严格水平居中 */
                .top-bar {
                    position: absolute;
                    top: 8px;
                    left: 12px;
                    right: 12px;
                    display: grid;
                    grid-template-columns: 1fr auto 1fr;
                    align-items: center;
                    gap: 8px;
                    z-index: 20;
                }
                .left-slot {
                    justify-self: start;
                    opacity: 0;
                    transform: translateY(-3px);
                    transition: opacity 0.2s ease, transform 0.2s ease;
                    pointer-events: none;
                }
                .center-slot {
                    justify-self: center;
                    max-width: 100%;
                    overflow: hidden;
                }
                .right-slot {
                    justify-self: end;
                    opacity: 0;
                    transform: translateY(-3px);
                    transition: opacity 0.2s ease, transform 0.2s ease;
                    pointer-events: none;
                }
                .pip-wrap:hover .left-slot,
                .pip-wrap:hover .right-slot,
                .pip-wrap.drawer-open .left-slot,
                .pip-wrap.drawer-open .right-slot {
                    opacity: 1;
                    transform: translateY(0);
                    pointer-events: auto;
                }

                .title-pill {
                    font-size: 11.5px;
                    color: var(--text-sub);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    padding: 2px 6px;
                    text-align: center;
                    pointer-events: none;
                    transition: opacity 0.2s ease;
                }
                .pip-wrap.compact-single .title-pill {
                    opacity: 0;
                }
                .pill-group {
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    background: var(--pill-bg);
                    border: 1px solid var(--border-hairline);
                    border-radius: 999px;
                    padding: 2px 8px;
                }
                .icon-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-main);
                    font-size: 12px;
                    padding: 3px 7px;
                    border-radius: 999px;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 3px;
                }
                .icon-btn:hover { background: rgba(255, 255, 255, 0.14); }
                .icon-btn.active { color: var(--accent); background: var(--accent-soft); }

                .lyric-stage-wrap {
                    position: relative;
                    z-index: 5;
                    width: 100%;
                    padding-left: 36px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    overflow: hidden;
                }
                .pip-wrap.compact-single .lyric-stage-wrap { padding-left: 56px; }

                .stage {
                    display: flex;
                    flex-direction: column;
                    gap: var(--row-gap);
                    width: 100%;
                }
                .row {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    line-height: 1.35;
                    transition: opacity 0.36s ease, transform 0.36s cubic-bezier(0.16, 1, 0.3, 1), color 0.24s ease;
                }
                .row.no-anim { transition: none !important; }
                .row.sub { font-size: calc(var(--font-size) * 0.56); color: var(--text-sub); }
                .row.far { font-size: calc(var(--font-size) * 0.5); color: var(--text-muted); }
                .row.current { font-size: var(--font-size); font-weight: 800; color: var(--accent); }

                .row.current.enter-anim {
                    opacity: 0;
                    transform: translateY(22px) scale(0.96);
                }
                .row.sub.enter-anim {
                    opacity: 0.12;
                    transform: translateY(16px);
                }
                .row.far.enter-anim {
                    opacity: 0.05;
                    transform: translateY(12px);
                }

                .pip-wrap[data-skin="clean"] .lyric-stage-wrap { align-items: flex-start; text-align: left; }
                .pip-wrap[data-skin="clean"] .row.current { color: var(--text-main); }

                .pip-wrap[data-skin="lyricify"] .lyric-stage-wrap { align-items: center; text-align: center; padding-left: 0; }
                .pip-wrap[data-skin="lyricify"] .row.current {
                    color: var(--accent);
                    text-shadow: 0 0 18px var(--accent-glow);
                }

                .pip-wrap[data-skin="karaoke"] .lyric-stage-wrap { align-items: flex-start; text-align: left; }
                .k-char {
                    display: inline-block;
                    background-image: linear-gradient(
                        to right,
                        var(--accent) 0%,
                        #ffffff var(--p, 0%),
                        rgba(255, 255, 255, 0.34) var(--p, 0%)
                    );
                    -webkit-background-clip: text;
                    background-clip: text;
                    color: transparent;
                }

                /* 精简灵动小人轮廓徽章 */
                .mascot-badge {
                    position: absolute;
                    right: 16px;
                    bottom: 12px;
                    z-index: 8;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    padding: 4px 8px 4px 6px;
                    border-radius: 999px;
                    background: var(--pill-bg);
                    border: 1px solid var(--border-hairline);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
                    pointer-events: none;
                }
                .pip-wrap.hide-mascot .mascot-badge,
                .pip-wrap.compact-single .mascot-badge {
                    display: none;
                }
                .mascot-svg {
                    width: 20px;
                    height: 20px;
                    color: var(--accent);
                    transform-origin: center bottom;
                }
                .mascot-label {
                    font-size: 10px;
                    color: var(--text-sub);
                }
                .mascot-badge[data-state="singing"] .mascot-svg {
                    animation: mascotNod 0.55s ease-in-out infinite alternate;
                }
                .mascot-badge[data-state="idle"] .mascot-svg {
                    animation: mascotSway 1.8s ease-in-out infinite alternate;
                }
                .mascot-badge[data-state="paused"] {
                    opacity: 0.55;
                }
                @keyframes mascotNod {
                    0% { transform: translateY(1px) rotate(-7deg) scale(0.98); }
                    100% { transform: translateY(-3px) rotate(7deg) scale(1.04); }
                }
                @keyframes mascotSway {
                    0% { transform: rotate(-4deg) scale(0.96); }
                    100% { transform: rotate(4deg) scale(1.02); }
                }

                .settings-drawer {
                    position: absolute;
                    inset: 0;
                    background: var(--drawer-bg);
                    padding: 42px 18px 14px;
                    display: none;
                    flex-direction: column;
                    gap: 9px;
                    overflow-y: auto;
                    z-index: 15;
                    font-size: 12px;
                }
                .pip-wrap.drawer-open .settings-drawer { display: flex; }
                .setting-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    padding-bottom: 7px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                }
                .setting-row:last-child { border-bottom: none; padding-bottom: 0; }
                .setting-label { color: var(--text-sub); font-weight: 600; white-space: nowrap; }
                .setting-controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

                .seg-group {
                    display: inline-flex;
                    align-items: center;
                    background: rgba(255, 255, 255, 0.06);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 7px;
                    padding: 2px;
                    gap: 2px;
                }
                .seg-group .chip {
                    border: none;
                    background: transparent;
                    border-radius: 5px;
                    padding: 3px 8px;
                }
                .seg-group .chip.active {
                    background: var(--accent);
                    color: #09111a;
                    font-weight: 700;
                }

                .chip {
                    background: rgba(255, 255, 255, 0.08);
                    border: 1px solid transparent;
                    color: var(--text-main);
                    padding: 3px 8px;
                    border-radius: 6px;
                    font-size: 11px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }
                .chip.active {
                    border-color: var(--accent);
                    background: var(--accent-soft);
                    color: var(--accent);
                    font-weight: 600;
                }
                .search-input {
                    background: rgba(255, 255, 255, 0.1);
                    border: 1px solid rgba(255, 255, 255, 0.16);
                    color: var(--text-main);
                    border-radius: 6px;
                    padding: 4px 8px;
                    font-size: 11px;
                    width: 145px;
                    outline: none;
                }
            </style>
            <div class="pip-wrap" id="pipWrap" data-skin="${cfg.skin}" data-fx="${cfg.fxMode}">
                <div class="left-cover-bg"><img id="pipCoverImg" src="" alt="cover" /></div>
                <div class="glass-sheen"></div>
                <div class="disco-layer"></div>
                <canvas id="pipWaveCanvas"></canvas>

                <div class="top-bar">
                    <div class="left-slot">
                        <div class="pill-group">
                            <button class="icon-btn" id="pipPrev" title="上一首">⏮</button>
                            <button class="icon-btn" id="pipPlay" title="播放/暂停">▶</button>
                            <button class="icon-btn" id="pipNext" title="下一首">⏭</button>
                            <button class="icon-btn" id="pipMode" title="切换播放模式">🔁 顺序</button>
                        </div>
                    </div>
                    <div class="center-slot">
                        <div class="title-pill" id="pipMeta">等待播放...</div>
                    </div>
                    <div class="right-slot">
                        <div class="pill-group">
                            <button class="icon-btn" id="pipSettingsBtn">⚙️ 设置</button>
                        </div>
                    </div>
                </div>

                <div class="lyric-stage-wrap">
                    <div class="stage" id="pipStage"></div>
                </div>

                <!-- 极简灵动小人轮廓徽章 -->
                <div class="mascot-badge" id="pipMascot" data-state="paused">
                    <svg class="mascot-svg" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="6.5" r="2.6" stroke="currentColor" stroke-width="1.9"/>
                        <path d="M12 9.5V15.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
                        <path d="M8.5 11.8L12 13.2L15.5 11.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M12 15.5L9.2 20.5M12 15.5L14.8 20.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="mascot-label" id="pipMascotText">暂停</span>
                </div>

                <div class="settings-drawer">
                    <div class="setting-row">
                        <span class="setting-label">1. 行距与字号</span>
                        <div class="setting-controls">
                            <div class="seg-group">
                                <button class="chip" data-gap="0.75">紧凑</button>
                                <button class="chip" data-gap="1.0">标准</button>
                                <button class="chip" data-gap="1.45">宽松</button>
                            </div>
                            <button class="chip" id="pipFontDec">A-</button>
                            <button class="chip" id="pipFontInc">A+</button>
                        </div>
                    </div>
                    <div class="setting-row">
                        <span class="setting-label">2. 手动搜词</span>
                        <div class="setting-controls">
                            <input class="search-input" id="pipSearchInput" placeholder="歌名 歌手" />
                            <button class="chip active" id="pipDoSearch">搜索</button>
                        </div>
                    </div>
                    <div class="setting-row">
                        <span class="setting-label">3. 风格与底色</span>
                        <div class="setting-controls">
                            <div class="seg-group">
                                <button class="chip" data-skin="clean">克制</button>
                                <button class="chip" data-skin="lyricify">Lyricify</button>
                                <button class="chip" data-skin="karaoke">卡拉OK</button>
                            </div>
                            <div class="seg-group">
                                <button class="chip" data-theme="cyber">深海青</button>
                                <button class="chip" data-theme="gold">暖金</button>
                                <button class="chip" data-theme="light">浅色</button>
                            </div>
                            <button class="chip" id="pipAdaptiveBtn">封面取色:开</button>
                        </div>
                    </div>
                    <div class="setting-row">
                        <span class="setting-label">4. 氛围与动效</span>
                        <div class="setting-controls">
                            <div class="seg-group" title="背景氛围模式（三选一）">
                                <button class="chip" data-fx="off">无背景</button>
                                <button class="chip" data-fx="wave">波形</button>
                                <button class="chip" data-fx="disco">Disco</button>
                            </div>
                            <button class="chip" id="pipMascotBtn">角色:开</button>
                            <button class="chip" id="pipAnimBtn">切行:滚动</button>
                        </div>
                    </div>
                    <div class="setting-row">
                        <span class="setting-label">5. 时间偏移</span>
                        <div class="setting-controls">
                            <button class="chip" id="pipOffSub">-0.2s</button>
                            <span id="pipOffVal">${cfg.offsetSec >= 0 ? '+' : ''}${cfg.offsetSec.toFixed(1)}s</span>
                            <button class="chip" id="pipOffAdd">+0.2s</button>
                            <button class="chip" id="pipOffReset">归零</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        applyThemeAndVars(doc);
        computeWindowLayout(doc);

        doc.getElementById('pipPrev').onclick = () => document.getElementById('prev-btn')?.click();
        doc.getElementById('pipPlay').onclick = () => document.getElementById('play-btn')?.click();
        doc.getElementById('pipNext').onclick = () => document.getElementById('next-btn')?.click();
        doc.getElementById('pipMode').onclick = () => document.getElementById('play-mode-btn')?.click();

        const wrap = doc.getElementById('pipWrap');
        const setBtn = doc.getElementById('pipSettingsBtn');
        setBtn.onclick = () => {
            const open = wrap.classList.toggle('drawer-open');
            setBtn.classList.toggle('active', open);
            setBtn.textContent = open ? '✕ 关闭' : '⚙️ 设置';
            if (open) {
                syncDrawerActiveStates(doc);
                const { title, artist } = getPlaybackState();
                const inp = doc.getElementById('pipSearchInput');
                if (inp && !inp.value) inp.value = `${title} ${artist}`.trim();
            }
        };

        doc.querySelectorAll('[data-gap]').forEach(btn => {
            btn.onclick = () => {
                cfg.gapScale = parseFloat(btn.dataset.gap);
                saveConfig(cfg);
                syncDrawerActiveStates(doc);
                computeWindowLayout(doc);
                currentLineIndex = -1;
            };
        });

        doc.getElementById('pipFontInc').onclick = () => {
            cfg.fontSize = Math.min(cfg.fontSize + 2, 34);
            saveConfig(cfg);
            applyThemeAndVars(doc);
        };
        doc.getElementById('pipFontDec').onclick = () => {
            cfg.fontSize = Math.max(cfg.fontSize - 2, 16);
            saveConfig(cfg);
            applyThemeAndVars(doc);
        };

        doc.getElementById('pipDoSearch').onclick = () => {
            const q = doc.getElementById('pipSearchInput')?.value.trim();
            if (!q) return;
            const { duration } = getPlaybackState();
            parsedLyrics = [buildLineOnly(0, 9999, `♪ 正在搜索：${q}...`)];
            currentLineIndex = -1;
            searchLyricsByQuery(q, duration, currentSongKey, true);
            wrap.classList.remove('drawer-open');
            setBtn.textContent = '⚙️ 设置';
            setBtn.classList.remove('active');
        };

        doc.querySelectorAll('[data-skin]').forEach(btn => {
            btn.onclick = () => {
                cfg.skin = btn.dataset.skin;
                saveConfig(cfg);
                applyThemeAndVars(doc);
                currentLineIndex = -1;
            };
        });

        doc.querySelectorAll('[data-theme]').forEach(btn => {
            btn.onclick = () => {
                cfg.theme = btn.dataset.theme;
                saveConfig(cfg);
                applyThemeAndVars(doc);
            };
        });

        doc.getElementById('pipAdaptiveBtn').onclick = () => {
            cfg.adaptiveColor = !cfg.adaptiveColor;
            saveConfig(cfg);
            applyThemeAndVars(doc);
        };

        doc.querySelectorAll('[data-fx]').forEach(btn => {
            btn.onclick = () => {
                cfg.fxMode = btn.dataset.fx;
                saveConfig(cfg);
                applyThemeAndVars(doc);
            };
        });

        doc.getElementById('pipMascotBtn').onclick = () => {
            cfg.showMascot = !cfg.showMascot;
            saveConfig(cfg);
            applyThemeAndVars(doc);
        };

        doc.getElementById('pipAnimBtn').onclick = () => {
            cfg.smoothAnim = !cfg.smoothAnim;
            saveConfig(cfg);
            syncDrawerActiveStates(doc);
            currentLineIndex = -1;
        };

        const syncOffText = () => {
            const el = doc.getElementById('pipOffVal');
            if (el) el.textContent = `${cfg.offsetSec >= 0 ? '+' : ''}${cfg.offsetSec.toFixed(1)}s`;
            currentLineIndex = -1;
        };
        doc.getElementById('pipOffSub').onclick = () => { cfg.offsetSec = Math.max(-5, +(cfg.offsetSec - 0.2).toFixed(1)); saveConfig(cfg); syncOffText(); };
        doc.getElementById('pipOffAdd').onclick = () => { cfg.offsetSec = Math.min(5, +(cfg.offsetSec + 0.2).toFixed(1)); saveConfig(cfg); syncOffText(); };
        doc.getElementById('pipOffReset').onclick = () => { cfg.offsetSec = 0; saveConfig(cfg); syncOffText(); };

        pipWindow.addEventListener('resize', () => {
            computeWindowLayout(doc);
            currentLineIndex = -1;
        });
    }

    setInterval(() => {
        const { title, artist, cover, duration } = getPlaybackState();
        if (!title) return;

        if (cover && cover !== cachedCoverUrl) {
            extractCoverColorOnce(cover, () => {
                if (pipWindow && !pipWindow.closed) {
                    applyThemeAndVars(pipWindow.document);
                }
            });
        }

        const songKey = `${title}__${artist}`;
        if (songKey !== currentSongKey) {
            currentSongKey = songKey;
            parsedLyrics = [];
            currentLineIndex = -1;
            lyricMode = 'none';

            const domLyrics = parseLyricsFromDom(duration);
            if (domLyrics && domLyrics.length > 0) {
                parsedLyrics = domLyrics;
                lyricMode = 'line-dom';
            } else {
                parsedLyrics = [buildLineOnly(0, 9999, `♪ ${title}${artist ? ' - ' + artist : ''}（正在检索歌词...）`)];
            }

            searchLyricsByQuery(`${title} ${artist}`.trim(), duration, songKey, false);
        } else if (lyricMode === 'none') {
            const domLyrics = parseLyricsFromDom(duration);
            if (domLyrics && domLyrics.length > 0) {
                parsedLyrics = domLyrics;
                lyricMode = 'line-dom';
                currentLineIndex = -1;
            }
        }
    }, 400);

    function tick(now) {
        if (pipWindow && !pipWindow.closed && parsedLyrics.length > 0) {
            const { title, artist, cover, currentTime, isPlaying, playMode } = getPlaybackState();
            const doc = pipWindow.document;
            const wrap = doc.getElementById('pipWrap');
            const metaEl = doc.getElementById('pipMeta');
            const stageEl = doc.getElementById('pipStage');
            const coverImg = doc.getElementById('pipCoverImg');
            const playBtn = doc.getElementById('pipPlay');
            const modeBtn = doc.getElementById('pipMode');
            const mascotEl = doc.getElementById('pipMascot');
            const mascotText = doc.getElementById('pipMascotText');

            if (wrap) {
                wrap.classList.toggle('is-playing', isPlaying);
            }
            if (coverImg && cover && coverImg.src !== cover) {
                coverImg.src = cover;
            }
            if (playBtn) {
                const nextIcon = isPlaying ? '⏸' : '▶';
                if (playBtn.textContent !== nextIcon) {
                    playBtn.textContent = nextIcon;
                }
                playBtn.classList.toggle('active', isPlaying);
            }
            if (modeBtn && playMode) {
                const targetText = `${playMode.icon} ${playMode.label}`;
                if (modeBtn.textContent !== targetText) {
                    modeBtn.textContent = targetText;
                }
            }

            const effectiveTime = currentTime + cfg.offsetSec;

            if (metaEl && title) {
                const modeLabel =
                    lyricMode === 'word' ? '真逐字' :
                    lyricMode === 'line-dom' ? '网页原词' :
                    lyricMode === 'line-api' ? '在线歌词' : '检索中';
                const offStr = cfg.offsetSec === 0 ? '' : ` · 偏移${cfg.offsetSec > 0 ? '+' : ''}${cfg.offsetSec.toFixed(1)}s`;
                metaEl.textContent = `${title}${artist ? ' — ' + artist : ''} [${modeLabel}]${offStr}`;
            }

            let idx = 0;
            for (let i = 0; i < parsedLyrics.length; i++) {
                if (effectiveTime >= parsedLyrics[i].time - 0.1) {
                    idx = i;
                } else {
                    break;
                }
            }

            const lineObj = parsedLyrics[idx];

            if (mascotEl && mascotText) {
                let state = 'paused';
                let label = '暂停';
                if (isPlaying) {
                    const isInterlude = !lineObj || (lineObj.endTime - lineObj.time > 12 && effectiveTime - lineObj.time > 6);
                    state = isInterlude ? 'idle' : 'singing';
                    label = isInterlude ? '间奏' : '演唱中';
                }
                if (mascotEl.getAttribute('data-state') !== state) {
                    mascotEl.setAttribute('data-state', state);
                    mascotText.textContent = label;
                }
            }

            const layout = computeWindowLayout(doc);

            if (idx !== currentLineIndex && stageEl) {
                currentLineIndex = idx;
                const nodes = [];
                const animCls = cfg.smoothAnim ? '' : 'no-anim';
                const enterCls = cfg.smoothAnim ? 'enter-anim' : '';

                for (let d = -layout.radius; d <= layout.radius; d++) {
                    const targetIdx = idx + d;
                    if (targetIdx < 0 || targetIdx >= parsedLyrics.length) continue;
                    const item = parsedLyrics[targetIdx];

                    if (d === 0) {
                        if (cfg.skin === 'karaoke' && Array.isArray(item.words) && item.words.length > 0) {
                            const charsHtml = item.words.map((w, wIdx) => {
                                const ch = w.char === ' ' ? '&nbsp;' : w.char;
                                return `<span class="k-char" data-widx="${wIdx}">${ch}</span>`;
                            }).join('');
                            nodes.push(`<div class="row current ${animCls}" id="pipCurRow">${charsHtml}</div>`);
                        } else {
                            nodes.push(`<div class="row current ${animCls} ${enterCls}" id="pipCurRow">${item.text}</div>`);
                        }
                    } else {
                        const cls = Math.abs(d) > 1 ? 'far' : 'sub';
                        nodes.push(`<div class="row ${cls} ${animCls} ${enterCls}">${item.text}</div>`);
                    }
                }

                stageEl.innerHTML = nodes.join('');
                if (cfg.smoothAnim) {
                    requestAnimationFrame(() => {
                        stageEl.querySelectorAll('.enter-anim').forEach(el => el.classList.remove('enter-anim'));
                    });
                }
            }

            if (cfg.skin === 'karaoke' && lineObj && Array.isArray(lineObj.words) && lineObj.words.length > 0) {
                const curRow = doc.getElementById('pipCurRow');
                if (curRow) {
                    const spans = curRow.querySelectorAll('.k-char');
                    lineObj.words.forEach((w, i) => {
                        const sp = spans[i];
                        if (!sp) return;
                        let pct = 0;
                        if (effectiveTime >= w.end) pct = 100;
                        else if (effectiveTime > w.start) pct = ((effectiveTime - w.start) / (w.end - w.start)) * 100;
                        sp.style.setProperty('--p', `${pct.toFixed(1)}%`);
                    });
                }
            }

            renderWaveCanvas(doc, isPlaying, now || performance.now());
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    function injectTriggerButton() {
        if (document.getElementById('krc-pip-launcher')) return;
        const btn = document.createElement('button');
        btn.id = 'krc-pip-launcher';
        btn.innerText = '🎤 置顶歌词';
        Object.assign(btn.style, {
            position: 'fixed',
            right: '24px',
            bottom: '95px',
            zIndex: '999999',
            padding: '8px 14px',
            borderRadius: '20px',
            border: 'none',
            background: 'linear-gradient(135deg, #00c6ff, #0072ff)',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: '13px',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0, 114, 255, 0.4)'
        });
        btn.onclick = openFloatingLyrics;
        document.body.appendChild(btn);
    }

    setTimeout(injectTriggerButton, 1200);
})();
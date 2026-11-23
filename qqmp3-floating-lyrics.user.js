// ==UserScript==
// @name         QQMP3 置顶悬浮歌词 (v0.2.0 自适应排版 + 多风格皮肤 + 控制抽屉)
// @namespace    http://tampermonkey.net/
// @version      0.2.0
// @description  跨标签页置顶歌词小窗，支持单行/三行/多行自适应、动态行距、三套风格切换、悬停播放控制、手动搜词与时间偏移
// @match        *://*.qqmp3.vip/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      lrclib.net
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'qqmp3_floating_lyrics_cfg_v02';
    const defaultConfig = {
        gapScale: 1.0,
        fontSize: 23,
        skin: 'lyricify', // 'clean' | 'lyricify' | 'karaoke'
        theme: 'cyber',   // 'cyber' | 'gold' | 'light'
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
            bg: 'radial-gradient(circle at 20% 0%, #1c2538 0%, #0e131d 100%)',
            accent: '#56f0ff',
            soft: 'rgba(86, 240, 255, 0.16)',
            glow: 'rgba(86, 240, 255, 0.28)',
            main: '#f8fafc',
            sub: 'rgba(248, 250, 252, 0.44)',
            muted: 'rgba(248, 250, 252, 0.22)',
            drawer: 'rgba(14, 19, 29, 0.92)',
            pill: 'rgba(15, 20, 31, 0.58)',
            coverOpacity: '0.34'
        },
        gold: {
            bg: 'radial-gradient(circle at 20% 0%, #2d2218 0%, #130f0b 100%)',
            accent: '#ffd166',
            soft: 'rgba(255, 209, 102, 0.18)',
            glow: 'rgba(255, 209, 102, 0.3)',
            main: '#fffbeb',
            sub: 'rgba(255, 251, 235, 0.45)',
            muted: 'rgba(255, 251, 235, 0.22)',
            drawer: 'rgba(20, 15, 11, 0.92)',
            pill: 'rgba(20, 15, 11, 0.6)',
            coverOpacity: '0.34'
        },
        light: {
            bg: 'linear-gradient(135deg, #ffffff 0%, #eef2f6 100%)',
            accent: '#0284c7',
            soft: 'rgba(2, 132, 199, 0.12)',
            glow: 'rgba(2, 132, 199, 0.16)',
            main: '#0f172a',
            sub: 'rgba(15, 23, 42, 0.48)',
            muted: 'rgba(15, 23, 42, 0.24)',
            drawer: 'rgba(255, 255, 255, 0.94)',
            pill: 'rgba(255, 255, 255, 0.72)',
            coverOpacity: '0.24'
        }
    };

    let cfg = loadConfig();
    let pipWindow = null;
    let currentSongKey = '';
    let parsedLyrics = [];
    let currentLineIndex = -1;
    let lyricMode = 'none'; // 'word' | 'line-dom' | 'line-api' | 'none'

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

        const isPlaying = audio ? !audio.paused : true;

        return { title, artist, cover, currentTime, duration, isPlaying };
    }

    function applyThemeAndVars(doc) {
        if (!doc) return;
        const t = themes[cfg.theme] || themes.cyber;
        const root = doc.documentElement;
        root.style.setProperty('--bg-surface', t.bg);
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
        }
    }

    function computeWindowLayout(doc) {
        if (!doc) return { radius: 1, mode: 'triple' };
        const w = doc.documentElement.clientWidth || 640;
        const h = doc.documentElement.clientHeight || 176;

        const dynamicBase = Math.max(6, Math.min(20, Math.round((h - 70) * 0.09)));
        const finalGap = Math.round(dynamicBase * cfg.gapScale);
        doc.documentElement.style.setProperty('--row-gap', `${finalGap}px`);

        const dynamicCoverW = Math.max(190, Math.min(310, Math.round(w * 0.38)));
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
                    --bg-surface: radial-gradient(circle at 20% 0%, #1c2538 0%, #0e131d 100%);
                    --accent: #56f0ff;
                    --accent-soft: rgba(86, 240, 255, 0.16);
                    --accent-glow: rgba(86, 240, 255, 0.28);
                    --text-main: #f8fafc;
                    --text-sub: rgba(248, 250, 252, 0.44);
                    --text-muted: rgba(248, 250, 252, 0.22);
                    --border-hairline: rgba(255, 255, 255, 0.1);
                    --drawer-bg: rgba(14, 19, 29, 0.92);
                    --pill-bg: rgba(15, 20, 31, 0.58);
                    --cover-opacity: 0.34;
                    --cover-width: 240px;
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
                    padding: 12px 24px;
                    overflow: hidden;
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
                        rgba(0, 0, 0, 0.88) 45%,
                        rgba(0, 0, 0, 0.42) 78%,
                        rgba(0, 0, 0, 0) 100%
                    );
                    mask-image: linear-gradient(
                        to right,
                        rgba(0, 0, 0, 1) 0%,
                        rgba(0, 0, 0, 0.88) 45%,
                        rgba(0, 0, 0, 0.42) 78%,
                        rgba(0, 0, 0, 0) 100%
                    );
                    transition: width 0.2s ease, opacity 0.2s ease;
                }
                .left-cover-bg img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    display: block;
                }
                .pip-wrap.compact-single .left-cover-bg {
                    width: calc(var(--cover-width) * 0.72);
                }
                .hover-bar {
                    position: absolute;
                    top: 8px;
                    left: 12px;
                    right: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    opacity: 0;
                    transform: translateY(-4px);
                    transition: opacity 0.2s ease, transform 0.2s ease;
                    pointer-events: none;
                    z-index: 20;
                }
                .pip-wrap:hover .hover-bar,
                .pip-wrap.drawer-open .hover-bar {
                    opacity: 1;
                    transform: translateY(0);
                    pointer-events: auto;
                }
                .pill-group {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    background: var(--pill-bg);
                    border: 1px solid var(--border-hairline);
                    border-radius: 999px;
                    padding: 2px 7px;
                }
                .icon-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-main);
                    font-size: 12px;
                    padding: 3px 7px;
                    border-radius: 999px;
                    cursor: pointer;
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
                .meta-line {
                    font-size: 11px;
                    color: var(--text-sub);
                    margin-bottom: 6px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .pip-wrap.compact-single .meta-line { display: none; }

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
                    transition: opacity 0.26s ease, transform 0.26s cubic-bezier(0.22, 1, 0.36, 1), color 0.2s ease;
                }
                .row.no-anim { transition: none !important; }
                .row.sub { font-size: calc(var(--font-size) * 0.56); color: var(--text-sub); }
                .row.far { font-size: calc(var(--font-size) * 0.5); color: var(--text-muted); }
                .row.current { font-size: var(--font-size); font-weight: 800; color: var(--accent); }
                .row.current.enter-anim { opacity: 0.25; transform: translateY(7px); }

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

                .settings-drawer {
                    position: absolute;
                    inset: 0;
                    background: var(--drawer-bg);
                    padding: 38px 18px 14px;
                    display: none;
                    flex-direction: column;
                    gap: 10px;
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
                    padding-bottom: 8px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                }
                .setting-row:last-child { border-bottom: none; padding-bottom: 0; }
                .setting-label { color: var(--text-sub); font-weight: 600; white-space: nowrap; }
                .setting-controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
                .chip {
                    background: rgba(255, 255, 255, 0.08);
                    border: 1px solid transparent;
                    color: var(--text-main);
                    padding: 3px 9px;
                    border-radius: 6px;
                    font-size: 11px;
                    cursor: pointer;
                }
                .chip.active {
                    border-color: var(--accent);
                    background: var(--accent-soft);
                    color: var(--accent);
                }
                .search-input {
                    background: rgba(255, 255, 255, 0.1);
                    border: 1px solid rgba(255, 255, 255, 0.16);
                    color: var(--text-main);
                    border-radius: 6px;
                    padding: 4px 8px;
                    font-size: 11px;
                    width: 150px;
                    outline: none;
                }
            </style>
            <div class="pip-wrap" id="pipWrap" data-skin="${cfg.skin}">
                <div class="left-cover-bg"><img id="pipCoverImg" src="" alt="cover" /></div>
                <div class="hover-bar">
                    <div class="pill-group">
                        <button class="icon-btn" id="pipPrev" title="上一首">⏮</button>
                        <button class="icon-btn active" id="pipPlay" title="播放/暂停">⏸</button>
                        <button class="icon-btn" id="pipNext" title="下一首">⏭</button>
                        <button class="icon-btn" id="pipMode" title="播放模式">🔁</button>
                    </div>
                    <div class="pill-group">
                        <button class="icon-btn" id="pipSettingsBtn">⚙️ 设置</button>
                    </div>
                </div>
                <div class="lyric-stage-wrap">
                    <div class="meta-line" id="pipMeta">等待播放...</div>
                    <div class="stage" id="pipStage"></div>
                </div>
                <div class="settings-drawer">
                    <div class="setting-row">
                        <span class="setting-label">1. 行距与字号</span>
                        <div class="setting-controls">
                            <button class="chip ${cfg.gapScale === 0.75 ? 'active' : ''}" data-gap="0.75">紧凑</button>
                            <button class="chip ${cfg.gapScale === 1.0 ? 'active' : ''}" data-gap="1.0">标准</button>
                            <button class="chip ${cfg.gapScale === 1.45 ? 'active' : ''}" data-gap="1.45">宽松</button>
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
                        <span class="setting-label">3. 风格与配色</span>
                        <div class="setting-controls">
                            <button class="chip ${cfg.skin === 'clean' ? 'active' : ''}" data-skin="clean">克制</button>
                            <button class="chip ${cfg.skin === 'lyricify' ? 'active' : ''}" data-skin="lyricify">Lyricify</button>
                            <button class="chip ${cfg.skin === 'karaoke' ? 'active' : ''}" data-skin="karaoke">卡拉OK</button>
                            <button class="chip ${cfg.theme === 'cyber' ? 'active' : ''}" data-theme="cyber">深海青</button>
                            <button class="chip ${cfg.theme === 'gold' ? 'active' : ''}" data-theme="gold">暖金</button>
                            <button class="chip ${cfg.theme === 'light' ? 'active' : ''}" data-theme="light">浅色</button>
                            <button class="chip ${cfg.smoothAnim ? 'active' : ''}" id="pipAnimBtn">动画:${cfg.smoothAnim ? '柔和' : '无'}</button>
                        </div>
                    </div>
                    <div class="setting-row">
                        <span class="setting-label">4. 时间偏移</span>
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

        // 绑定播放控制（联动原网页）
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
                const { title, artist } = getPlaybackState();
                const inp = doc.getElementById('pipSearchInput');
                if (inp && !inp.value) inp.value = `${title} ${artist}`.trim();
            }
        };

        doc.querySelectorAll('[data-gap]').forEach(btn => {
            btn.onclick = () => {
                doc.querySelectorAll('[data-gap]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                cfg.gapScale = parseFloat(btn.dataset.gap);
                saveConfig(cfg);
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
                doc.querySelectorAll('[data-skin]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                cfg.skin = btn.dataset.skin;
                saveConfig(cfg);
                applyThemeAndVars(doc);
                currentLineIndex = -1;
            };
        });

        doc.querySelectorAll('[data-theme]').forEach(btn => {
            btn.onclick = () => {
                doc.querySelectorAll('[data-theme]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                cfg.theme = btn.dataset.theme;
                saveConfig(cfg);
                applyThemeAndVars(doc);
            };
        });

        doc.getElementById('pipAnimBtn').onclick = (e) => {
            cfg.smoothAnim = !cfg.smoothAnim;
            e.target.textContent = `动画:${cfg.smoothAnim ? '柔和' : '无'}`;
            e.target.classList.toggle('active', cfg.smoothAnim);
            saveConfig(cfg);
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
        const { title, artist, duration } = getPlaybackState();
        if (!title) return;

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

    function tick() {
        if (pipWindow && !pipWindow.closed && parsedLyrics.length > 0) {
            const { title, artist, cover, currentTime, isPlaying } = getPlaybackState();
            const doc = pipWindow.document;
            const metaEl = doc.getElementById('pipMeta');
            const stageEl = doc.getElementById('pipStage');
            const coverImg = doc.getElementById('pipCoverImg');
            const playBtn = doc.getElementById('pipPlay');

            if (coverImg && cover && coverImg.src !== cover) {
                coverImg.src = cover;
            }
            if (playBtn) {
                playBtn.textContent = isPlaying ? '⏸' : '▶';
                playBtn.classList.toggle('active', isPlaying);
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
            const layout = computeWindowLayout(doc);

            if (idx !== currentLineIndex && stageEl) {
                currentLineIndex = idx;
                const nodes = [];
                const animCls = cfg.smoothAnim ? '' : 'no-anim';

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
                            const enterCls = cfg.smoothAnim ? 'enter-anim' : '';
                            nodes.push(`<div class="row current ${animCls} ${enterCls}" id="pipCurRow">${item.text}</div>`);
                        }
                    } else {
                        const cls = Math.abs(d) > 1 ? 'far' : 'sub';
                        nodes.push(`<div class="row ${cls} ${animCls}">${item.text}</div>`);
                    }
                }

                stageEl.innerHTML = nodes.join('');
                if (cfg.smoothAnim) {
                    requestAnimationFrame(() => {
                        doc.getElementById('pipCurRow')?.classList.remove('enter-anim');
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
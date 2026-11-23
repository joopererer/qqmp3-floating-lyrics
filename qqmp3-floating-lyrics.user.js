// ==UserScript==
// @name         QQMP3 置顶悬浮歌词 (真逐字优先 + 句间动态切换)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  优先搜索真逐字歌词，未命中则使用网页原词/LRC进行丝滑句间动态切换，支持跨标签页置顶
// @match        *://*.qqmp3.vip/*
// @grant        GM_xmlhttpRequest
// @connect      lrclib.net
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    let pipWindow = null;
    let currentSongKey = '';
    let parsedLyrics = []; // [{ time, endTime, text, words: [{ char, start, end }] | null }]
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

    // 1. 尝试解析“真逐字”格式（支持 [mm:ss.xx]字(120) / 字<120> / <mm:ss.xx>字）
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

            // 情况 A：字后跟括号或尖括号毫秒时长，如 晴(240)天(310) 或 晴<240>天<310>
            const durTokens = [...body.matchAll(/([^\s(<]+|\s+)[\(<](\d+)[\)>]/g)];
            if (durTokens.length >= 2) {
                let cursor = lineStart;
                const words = [];
                let plain = '';

                for (const tk of durTokens) {
                    const ch = tk[1];
                    const durSec = Math.max(parseInt(tk[2], 10) / 1000, 0.04);
                    plain += ch;
                    words.push({
                        char: ch,
                        start: cursor,
                        end: cursor + durSec
                    });
                    cursor += durSec;
                }

                if (words.length > 0 && plain.trim()) {
                    result.push({
                        time: lineStart,
                        endTime: cursor,
                        text: plain.trim(),
                        words
                    });
                }
                continue;
            }

            // 情况 B：逐字带内联时间标签 <mm:ss.xx>字
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
                    words.push({
                        char: ch,
                        start,
                        end: Math.max(nextStart, start + 0.05)
                    });
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

        // 至少要有一定比例的行包含逐字信息，才算“真逐字”
        if (result.length >= 3 && result.length / Math.max(lines.length, 1) >= 0.25) {
            result.sort((a, b) => a.time - b.time);
            return result;
        }
        return null;
    }

    // 2. 解析普通 LRC 整句时间轴
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
            const nextTime = idx < temp.length - 1
                ? temp[idx + 1].time
                : (totalDuration || item.time + 4);
            return buildLineOnly(item.time, nextTime, item.text);
        });
    }

    // 3. 解析网页自带 .song-lyrics（整句时间轴）
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
            const nextTime = idx < raw.length - 1
                ? raw[idx + 1].time
                : (totalDuration || item.time + 4);
            return buildLineOnly(item.time, nextTime, item.text);
        });
    }

    // 4. 尝试搜索真逐字歌词，再降级到整句 LRC
    function searchLyrics(title, artist, totalSec, expectedKey) {
        const query = `${title} ${artist}`.trim();
        const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;

        GM_xmlhttpRequest({
            method: 'GET',
            url,
            onload(res) {
                if (expectedKey !== currentSongKey) return;
                try {
                    const list = JSON.parse(res.responseText);
                    if (Array.isArray(list)) {
                        // 先在返回结果中寻找是否包含逐字格式内容
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

                        // 没搜到真逐字，但如果当前还没有网页原词，就用整句 syncedLyrics
                        if (lyricMode !== 'line-dom') {
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

                if (lyricMode === 'none') {
                    parsedLyrics = [
                        buildLineOnly(0, 9999, `♪ ${title}${artist ? ' - ' + artist : ''}（未找到在线歌词）`)
                    ];
                    currentLineIndex = -1;
                }
            }
        });
    }

    // 5. 获取播放状态
    function getPlaybackState() {
        const titleEl = document.getElementById('play-song-title');
        const artistEl = document.getElementById('play-song-artist');
        const audio = document.querySelector('audio');

        const title = titleEl ? titleEl.textContent.trim() : '';
        const artist = artistEl ? artistEl.textContent.trim() : '';

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

        return { title, artist, currentTime, duration };
    }

    // 6. 弹出跨标签页置顶悬浮窗
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
            width: 600,
            height: 132
        });

        const doc = pipWindow.document;
        doc.body.innerHTML = `
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
                body {
                    background: radial-gradient(circle at top, #1b2438 0%, #0f141f 100%);
                    color: #ffffff;
                    font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    overflow: hidden;
                    padding: 8px 20px;
                }
                #song-header {
                    font-size: 12px;
                    color: #8fa1c2;
                    margin-bottom: 5px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 100%;
                }
                #prev-line {
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.28);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 100%;
                    margin-bottom: 3px;
                    transition: opacity 0.25s ease, transform 0.25s ease;
                }
                #current-line {
                    font-size: 24px;
                    font-weight: 800;
                    letter-spacing: 0.8px;
                    color: #4ef2ff;
                    text-shadow: 0 0 16px rgba(78, 242, 255, 0.28);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 100%;
                    margin-bottom: 5px;
                    transition: opacity 0.22s cubic-bezier(0.22, 1, 0.36, 1), transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
                }
                #current-line.enter {
                    opacity: 0.2;
                    transform: translateY(7px) scale(0.98);
                }
                .k-char {
                    display: inline-block;
                    background-image: linear-gradient(
                        to right,
                        #00f2fe 0%,
                        #4facfe var(--p, 0%),
                        rgba(255, 255, 255, 0.35) var(--p, 0%)
                    );
                    -webkit-background-clip: text;
                    background-clip: text;
                    color: transparent;
                }
                #next-line {
                    font-size: 13px;
                    color: rgba(255, 255, 255, 0.52);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 100%;
                    transition: opacity 0.25s ease, transform 0.25s ease;
                }
            </style>
            <div id="song-header">等待播放...</div>
            <div id="prev-line"></div>
            <div id="current-line">♪ 准备就绪</div>
            <div id="next-line"></div>
        `;
    }

    // 7. 切歌与歌词源协调（每 400ms 检查）
    setInterval(() => {
        const { title, artist, duration } = getPlaybackState();
        if (!title) return;

        const songKey = `${title}__${artist}`;
        if (songKey !== currentSongKey) {
            currentSongKey = songKey;
            parsedLyrics = [];
            currentLineIndex = -1;
            lyricMode = 'none';

            // 1) 优先看网页 DOM 是否已渲染出歌词
            const domLyrics = parseLyricsFromDom(duration);
            if (domLyrics && domLyrics.length > 0) {
                parsedLyrics = domLyrics;
                lyricMode = 'line-dom';
            } else {
                parsedLyrics = [buildLineOnly(0, 9999, `♪ ${title}${artist ? ' - ' + artist : ''}（正在检索歌词...）`)];
            }

            // 2) 同时去搜索是否有“真逐字”歌词（若命中会升级为 word 模式）
            searchLyrics(title, artist, duration, songKey);
        } else if (lyricMode === 'none') {
            const domLyrics = parseLyricsFromDom(duration);
            if (domLyrics && domLyrics.length > 0) {
                parsedLyrics = domLyrics;
                lyricMode = 'line-dom';
                currentLineIndex = -1;
            }
        }
    }, 400);

    // 8. 高帧率同步渲染
    function tick() {
        if (pipWindow && !pipWindow.closed && parsedLyrics.length > 0) {
            const { title, artist, currentTime } = getPlaybackState();
            const doc = pipWindow.document;
            const headerEl = doc.getElementById('song-header');
            const prevEl = doc.getElementById('prev-line');
            const curEl = doc.getElementById('current-line');
            const nextEl = doc.getElementById('next-line');

            if (headerEl && title) {
                const modeLabel =
                    lyricMode === 'word' ? '真逐字' :
                    lyricMode === 'line-dom' ? '网页原词·句间动态' :
                    lyricMode === 'line-api' ? '在线歌词·句间动态' : '检索中';
                headerEl.textContent = `${title}${artist ? ' - ' + artist : ''}  [${modeLabel}]`;
            }

            let idx = 0;
            for (let i = 0; i < parsedLyrics.length; i++) {
                if (currentTime >= parsedLyrics[i].time - 0.1) {
                    idx = i;
                } else {
                    break;
                }
            }

            const lineObj = parsedLyrics[idx];
            const prevObj = parsedLyrics[idx - 1];
            const nextObj = parsedLyrics[idx + 1];

            if (idx !== currentLineIndex && curEl && nextEl && prevEl) {
                currentLineIndex = idx;
                prevEl.textContent = prevObj ? prevObj.text : '';
                nextEl.textContent = nextObj ? nextObj.text : '';

                curEl.classList.add('enter');
                requestAnimationFrame(() => {
                    if (lyricMode === 'word' && lineObj && Array.isArray(lineObj.words)) {
                        curEl.innerHTML = lineObj.words
                            .map((w, i) => `<span class="k-char" data-idx="${i}">${w.char === ' ' ? '&nbsp;' : w.char}</span>`)
                            .join('');
                    } else {
                        curEl.textContent = lineObj ? lineObj.text : '';
                    }
                    setTimeout(() => curEl.classList.remove('enter'), 25);
                });
            }

            // 仅在真正命中“真逐字”时计算单字进度
            if (lyricMode === 'word' && lineObj && Array.isArray(lineObj.words) && curEl) {
                const spans = curEl.querySelectorAll('.k-char');
                lineObj.words.forEach((w, i) => {
                    const span = spans[i];
                    if (!span) return;
                    let pct = 0;
                    if (currentTime >= w.end) {
                        pct = 100;
                    } else if (currentTime > w.start) {
                        pct = ((currentTime - w.start) / (w.end - w.start)) * 100;
                    }
                    span.style.setProperty('--p', `${pct.toFixed(1)}%`);
                });
            }
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // 9. 注入按钮
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
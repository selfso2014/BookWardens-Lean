/**
 * lean-renderer.js — BookWardens-Lean
 *
 * TextRendererV2.js의 경량 대체 모듈.
 * 핵심 기능만 유지: 텍스트 → 줄별 div 렌더링 + lockLayout()
 *
 * 제거된 것들 (메모리/성능 개선):
 *   - TypeWriter 애니메이션 (타이핑 효과) → 텍스트를 즉시 표시
 *   - .tr-word span 수백 개 → 사용 후 즉시 제거
 *   - BoundingClientRect 캐시 객체 배열 → Float32Array 1회 캐시
 *   - cursor/impactElement → 없음 (gaze dot이 대신함)
 *   - GazeDataManager 의존성 → 없음 (PangDetector에서 직접 처리)
 *
 * 사용:
 *   const lr = new LeanRenderer('book-content');
 *   const { lineYs, lineHalfH } = await lr.render(paragraph.text);
 *   // 이후 pang 발생 시:
 *   lr.triggerInkSplash(lineIndex);
 *   // 종료 시:
 *   lr.destroy();
 */
class LeanRenderer {
    /**
     * @param {string} containerId - 텍스트를 렌더링할 컨테이너 요소 id
     */
    constructor(containerId) {
        this._containerId = containerId;
        this._lineEls = [];   // 현재 렌더링된 줄 div 목록
        this._pangCount = 0;  // 이번 지문에서 발생한 pang 수
    }

    // ─────────────────────────────────────────────────────────────────
    // PUBLIC: 지문 텍스트를 줄별 div로 렌더링
    // @param {string} text  - 렌더링할 텍스트
    // @returns {Promise<{lineYs: Float32Array, lineHalfH: number, lineCount: number}>}
    // ─────────────────────────────────────────────────────────────────
    render(text) {
        return new Promise((resolve) => {
            const container = document.getElementById(this._containerId);
            if (!container) { resolve({ lineYs: new Float32Array(0), lineHalfH: 24, lineCount: 0 }); return; }

            container.innerHTML = '';
            this._lineEls = [];
            this._pangCount = 0;

            // Step 1: 단어 span 임시 렌더
            // display:inline-block 사용: offsetTop이 컨테이너 기준으로 정확히 측정됨
            const words = text.trim().split(/\s+/).filter(Boolean);
            words.forEach(word => {
                const s = document.createElement('span');
                // inline-block: 줄 내에서 흐르되 offsetTop/offsetHeight가 신뢰성 있음
                s.style.cssText = 'display:inline-block; white-space:pre-wrap; vertical-align:top;';
                s.textContent = word + ' ';
                container.appendChild(s);
            });

            let _retryCount = 0;
            const MAX_RETRY = 8; // 최대 8회 재시도 (약 1.6초)

            const _measure = () => {
                const spans = Array.from(container.querySelectorAll('span'));

                // 컨테이너 치수 진단
                const cw = container.offsetWidth;
                const ch = container.offsetHeight;

                // offsetTop 방식: 컨테이너(position:relative) 기준 상대 좌표
                const lineMap = new Map();
                spans.forEach(s => {
                    const top = s.offsetTop; // position:relative 컨테이너 기준
                    if (!lineMap.has(top)) lineMap.set(top, []);
                    lineMap.get(top).push(s.textContent);
                });

                const allSameTop = lineMap.size <= 1 && spans.length > 3;

                if (allSameTop && _retryCount < MAX_RETRY) {
                    _retryCount++;
                    if (window.MemoryLogger) MemoryLogger.warn('RENDER',
                        `retry#${_retryCount} container=${cw}x${ch}px tops=[${[...lineMap.keys()].join(',')}]`);
                    setTimeout(_measure, 200);
                    return;
                }

                if (allSameTop) {
                    // max retry 초과: 컨테이너 너비 기반 추정 줄 수 계산
                    if (window.MemoryLogger) MemoryLogger.error('RENDER',
                        `GIVE UP after ${MAX_RETRY} retries. container=${cw}x${ch}px. Using estimated lines.`);
                    this._buildEstimatedLines(container, text, cw, resolve);
                    return;
                }

                // Step 3: 줄 div 재구성
                container.innerHTML = '';
                const sortedTops = Array.from(lineMap.keys()).sort((a, b) => a - b);

                this._lineEls = sortedTops.map(top => {
                    const div = document.createElement('div');
                    div.className = 'text-line';
                    div.textContent = lineMap.get(top).join('');
                    container.appendChild(div);
                    return div;
                });

                // Step 4: 각 줄 center Y (viewport 기준, PangDetector용)
                const n = this._lineEls.length;
                const lineYs = new Float32Array(n);
                let totalH = 0;

                this._lineEls.forEach((el, i) => {
                    const r = el.getBoundingClientRect();
                    lineYs[i] = r.top + r.height * 0.5;
                    totalH += r.height;
                });

                const avgH = n > 0 ? totalH / n : 40;
                const lineHalfH = avgH * 0.55;
                if (window.MemoryLogger) MemoryLogger.info('RENDER',
                    `${n} lines | container=${cw}x${ch}px | avgH=${avgH.toFixed(1)}px | retries=${_retryCount}`);

                resolve({ lineYs, lineHalfH, lineCount: n });
            };

            // rAF x2 → 200ms: display:flex 레이아웃 확정 후 측정
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(_measure, 200);
                });
            });
        });
    }

    // 레이아웃 측정 실패 시: 컨테이너 너비 기반 추정
    _buildEstimatedLines(container, text, containerWidth, resolve) {
        const usableWidth = Math.max(containerWidth - 40, 300); // padding 제외
        const charsPerLine = Math.floor(usableWidth / 10); // Georgia 1.1rem 평균 ~10px/char
        const words = text.trim().split(/\s+/);
        const lines = [];
        let current = '';

        words.forEach(word => {
            if ((current + word).length > charsPerLine && current.length > 0) {
                lines.push(current.trim());
                current = word + ' ';
            } else {
                current += word + ' ';
            }
        });
        if (current.trim()) lines.push(current.trim());

        container.innerHTML = '';
        this._lineEls = lines.map(lineText => {
            const div = document.createElement('div');
            div.className = 'text-line';
            div.textContent = lineText;
            container.appendChild(div);
            return div;
        });

        const n = this._lineEls.length;
        const lineYs = new Float32Array(n);
        this._lineEls.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            lineYs[i] = r.top + r.height * 0.5;
        });

        const lineHalfH = 24; // 기본값
        if (window.MemoryLogger) MemoryLogger.info('RENDER',
            `ESTIMATED ${n} lines (charsPerLine=${charsPerLine}, usableW=${usableWidth}px)`);

        resolve({ lineYs, lineHalfH, lineCount: n });
    }


    // ─────────────────────────────────────────────────────────────────
    // PUBLIC: pang 발생 시 줄 완료 시각 효과
    // CSS @keyframes만 사용 — GPU 텍스처 없음, 700ms 후 자동 DOM 제거
    // ─────────────────────────────────────────────────────────────────
    triggerInkSplash(lineIndex) {
        this._pangCount++;
        const lineEl = this._lineEls[lineIndex];
        if (!lineEl) return;

        const r = lineEl.getBoundingClientRect();

        // 1. 줄 하이라이트 효과 (잉크 색으로 0.5초 flash)
        lineEl.style.transition = 'background-color 0.3s ease';
        lineEl.style.backgroundColor = 'rgba(139, 47, 201, 0.15)';
        setTimeout(() => {
            lineEl.style.backgroundColor = '';
        }, 500);

        // 2. 잉크 스프레이 파티클 (CSS-only, 오른쪽 끝)
        const fx = document.createElement('div');
        fx.className = 'ink-splash-fx';
        fx.style.cssText =
            `position:fixed;` +
            `top:${(r.top + r.height * 0.3).toFixed(0)}px;` +
            `left:${r.right.toFixed(0)}px;` +
            `pointer-events:none;` +
            `font-size:18px;` +
            `z-index:9999;`;
        fx.textContent = '✒️';
        document.body.appendChild(fx);
        setTimeout(() => { if (fx.parentNode) fx.remove(); }, 700);
    }

    // ─────────────────────────────────────────────────────────────────
    // PUBLIC: 지문 종료 — DOM 완전 정리
    // ─────────────────────────────────────────────────────────────────
    destroy() {
        const container = document.getElementById(this._containerId);
        if (container) container.innerHTML = '';
        this._lineEls = [];
        this._pangCount = 0;
        console.log('[LeanRenderer] destroyed');
    }

    get lineCount() { return this._lineEls.length; }
    get pangCount() { return this._pangCount; }
}

window.LeanRenderer = LeanRenderer;

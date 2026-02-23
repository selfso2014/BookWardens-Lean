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

            // Step 1: 단어 span 임시 렌더 (줄 경계 감지용, DOM 1회 reflow)
            const words = text.trim().split(/\s+/).filter(Boolean);
            words.forEach(word => {
                const s = document.createElement('span');
                s.style.cssText = 'display:inline; white-space:pre-wrap;';
                s.textContent = word + '\u00A0';
                container.appendChild(s);
            });

            // Step 2: iOS 레이아웃 완료 후 줄 감지 + 재구성
            setTimeout(() => {
                const spans = Array.from(container.querySelectorAll('span'));
                const lineMap = new Map(); // offsetTop → word 배열

                spans.forEach(s => {
                    const top = s.offsetTop;
                    if (!lineMap.has(top)) lineMap.set(top, []);
                    lineMap.get(top).push(s.textContent);
                });

                // Step 3: 줄 div 재구성 (.text-line)
                container.innerHTML = '';
                const sortedTops = Array.from(lineMap.keys()).sort((a, b) => a - b);

                this._lineEls = sortedTops.map(top => {
                    const div = document.createElement('div');
                    div.className = 'text-line';
                    div.textContent = lineMap.get(top).join('');
                    container.appendChild(div);
                    return div;
                });

                // Step 4: 각 줄 center Y 측정 → Float32Array (lockLayout)
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

                console.log(`[LeanRenderer] ${n} lines | avgH=${avgH.toFixed(1)} | halfH=${lineHalfH.toFixed(1)}`);

                resolve({ lineYs, lineHalfH, lineCount: n });
            }, 150); // 150ms: iOS 레이아웃 완료 보장
        });
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

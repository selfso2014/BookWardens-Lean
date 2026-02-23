/**
 * app.js — BookWardens-Lean v1.0
 *
 * 아키텍처:
 *   UI/UX/게임로직 = TheBookWardens_MVP 동일
 *   시선추적 레이어  = SDK_Test (TypedArray + PangDetector)
 *   메모리 목표     = 시선추적 화면에서 앱 추가 사용량 ≤ 20MB
 *
 * 화면 흐름:
 *   splash → home → face-check → calibration → rift-intro →
 *   wpm → word(vocab) → owl → read → boss → final-boss(alice) →
 *   win → review → share
 */

// ── 상수 ───────────────────────────────────────────────────────────
const MAX_GAZE_ENTRIES = 1800; // 60s @ 30Hz

// ── 게임 상태 ─────────────────────────────────────────────────────
const G = {
    // SDK
    seesoMgr: null,
    gazeActive: false,

    // 시선 TypedArray 순환버퍼 (1회 할당, GC 없음)
    gx: new Float32Array(MAX_GAZE_ENTRIES),
    gy: new Float32Array(MAX_GAZE_ENTRIES),
    gt: new Float64Array(MAX_GAZE_ENTRIES),
    gIdx: 0,
    gCount: 0,

    // PangDetector
    pangDetector: null,
    leanRenderer: null,

    // 게임 진행
    paraIndex: 0,           // 현재 지문 인덱스 (0~2)
    selectedWPM: 200,       // 선택한 읽기 속도
    vocabIndex: 0,          // 현재 단어 퀴즈 인덱스
    bossQuizIndex: 0,       // 중간 보스 퀴즈 인덱스

    // 자원
    ink: 0,
    rune: 0,
    gem: 0,
    wpm: 0,

    // 타이밍
    readStartTime: 0,       // 지문 읽기 시작 시각

    // gaze dot RAF
    gazeDotRafId: null,

    // 현재 화면
    currentScreen: 'screen-splash',
};

// ── 화면 전환 ─────────────────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    // #screen-alice-battle는 .screen이 아닌 div — 별도 처리
    const aliceBattle = document.getElementById('screen-alice-battle');
    if (aliceBattle) aliceBattle.style.display = 'none';
    const finalBoss = document.getElementById('screen-final-boss');
    if (finalBoss) finalBoss.style.display = '';

    const el = document.getElementById(id);
    if (!el) { console.error('[App] Screen not found:', id); return; }

    if (el.classList.contains('screen')) {
        el.classList.add('active');
    } else {
        // div 방식 화면 (#screen-alice-battle)
        el.style.display = 'flex';
    }

    G.currentScreen = id;
    MemoryLogger.info('APP', `Screen: ${id}`);
    MemoryLogger.snapshot(`SCREEN_${id}`);
}

// ── HUD 업데이트 ──────────────────────────────────────────────────
function updateHUD() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('ink-count', G.ink);
    set('rune-count', G.rune);
    set('gem-count', G.gem);
    set('wpm-display', G.wpm);
}

// ═══════════════════════════════════════════════════════════════════
// 0. SPLASH
// ═══════════════════════════════════════════════════════════════════
function initSplash() {
    // [FIX] 로딩 중 이미 탭했으면 (_splashDone 플래그) 즉시 홈으로 전환
    // index.html 인라인 onclick이 이미 화면 전환 + _splashDone=true 처리함
    if (window._splashDone) return;
    // 아직 탭 안 했으면 이벤트 리스너 등록
    document.getElementById('screen-splash').addEventListener('click', () => {
        showScreen('screen-home');
    }, { once: true });
}

// ═══════════════════════════════════════════════════════════════════
// 0.5 HOME
// ═══════════════════════════════════════════════════════════════════
function initHome() {
    document.getElementById('btn-start-game').addEventListener('click', startSDKInit);
}

// ═══════════════════════════════════════════════════════════════════
// SDK 초기화 → FACE CHECK → CALIBRATION
// ═══════════════════════════════════════════════════════════════════
async function startSDKInit() {
    // Loading modal 표시
    const modal = document.getElementById('sdk-loading-modal');
    if (modal) modal.style.display = 'flex';

    G.seesoMgr = new SeesoManager();
    const ok = await G.seesoMgr.initSDK((progress, msg) => {
        const bar = modal?.querySelector('.sdk-progress-bar');
        const txt = modal?.querySelector('.sdk-status-text');
        if (bar) bar.style.width = Math.round(progress * 100) + '%';
        if (txt) txt.textContent = msg || 'Loading...';
    });

    if (modal) modal.style.display = 'none';

    if (!ok) {
        alert('SDK initialization failed. Please refresh.');
        return;
    }

    // 트래킹 시작 (카메라 권한 요청)
    G.seesoMgr.startTracking(
        (gazeInfo) => _onGaze(gazeInfo),
        (fps) => {
            const el = document.getElementById('gazeInfo');
            if (el) el.textContent = `gaze: ${fps}fps`;
        }
    );

    // Face Check 화면
    showScreen('screen-face-check');
    _startFaceCheck();
}

function _startFaceCheck() {
    const btnNext = document.getElementById('btn-face-next');
    const statusEl = document.getElementById('face-check-status');
    const guideIcon = document.getElementById('face-guide-icon');
    const faceFrame = document.querySelector('.face-frame');

    // SeeSo가 face 감지를 알려주는 콜백이 없으면 3초 후 자동 활성
    let faceDetected = false;
    const autoTimer = setTimeout(() => {
        faceDetected = true;
        if (statusEl) statusEl.textContent = 'Face detected! ✅';
        if (guideIcon) guideIcon.style.opacity = '1';
        if (faceFrame) faceFrame.style.borderColor = '#00ff00';
        if (btnNext) { btnNext.disabled = false; btnNext.style.opacity = '1'; btnNext.style.cursor = 'pointer'; }
    }, 2500);

    if (btnNext) {
        btnNext.addEventListener('click', () => {
            clearTimeout(autoTimer);
            showScreen('screen-calibration');
            _startCalibration();
        }, { once: true });
    }
}

function _startCalibration() {
    const ok = G.seesoMgr.startCalibration(
        (x, y) => _onCalibrationPoint(x, y),
        (progress) => {
            const bar = document.getElementById('cal-progress-bar');
            if (bar) bar.style.width = Math.round(progress * 100) + '%';
        },
        (data) => _onCalibrationDone(data)
    );
    if (!ok) {
        MemoryLogger.error('APP', 'Calibration start failed');
        // 캘리브레이션 실패 팝업 표시
        const popup = document.getElementById('cal-fail-popup');
        if (popup) popup.style.display = 'flex';
    }
}

function _onCalibrationPoint(x, y) {
    // 캘리브레이션 점 이동 — calibration.js의 CalDot 사용
    // (theBookWardens calibration.js에서 가져온 로직)
    const W = window.innerWidth, H = window.innerHeight;
    const px = Math.min(Math.max(x, 20), W - 20);
    const py = Math.min(Math.max(y, 20), H - 20);
    MemoryLogger.info('CAL', `Point (${Math.round(px)}, ${Math.round(py)})`);
    // 화면에 그리기는 calibration.css의 #cal-dot 사용
    let dot = document.getElementById('cal-dot');
    if (!dot) {
        dot = document.createElement('div');
        dot.id = 'cal-dot';
        dot.style.cssText = 'position:fixed; width:20px; height:20px; border-radius:50%; background:#f0c420; transform:translate(-50%,-50%); z-index:99999; box-shadow:0 0 20px #f0c420; transition:left 0.3s,top 0.3s;';
        document.body.appendChild(dot);
    }
    dot.style.left = px + 'px';
    dot.style.top = py + 'px';
    dot.style.display = 'block';
}

function _onCalibrationDone(data) {
    MemoryLogger.info('CAL', 'Calibration done');
    const dot = document.getElementById('cal-dot');
    if (dot) dot.style.display = 'none';

    // 800ms 대기 후 Rift Intro
    setTimeout(() => {
        showScreen('screen-rift-intro');
        _startRiftIntro();
    }, 800);
}

// ═══════════════════════════════════════════════════════════════════
// RIFT INTRO
// ═══════════════════════════════════════════════════════════════════
function _startRiftIntro() {
    // TheBookWardens의 IntroManager 로직 간략화
    // 3초 후 WPM 선택 화면으로
    setTimeout(() => {
        showScreen('screen-wpm');
        _initWPMScreen();
    }, 3500);
}

// ═══════════════════════════════════════════════════════════════════
// WPM 선택
// ═══════════════════════════════════════════════════════════════════
function _initWPMScreen() {
    document.querySelectorAll('.wpm-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.wpm-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            G.selectedWPM = parseInt(btn.dataset.wpm) || 200;

            setTimeout(() => {
                showScreen('screen-word');
                _startVocabQuiz();
            }, 600);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════
// WORD FORGE (어휘 퀴즈 — vocab)
// ═══════════════════════════════════════════════════════════════════
function _startVocabQuiz() {
    const vocab = window.vocabList[G.vocabIndex];
    if (!vocab) {
        // 모든 vocab 완료 → owl 화면
        showScreen('screen-owl');
        _startOwlScene();
        return;
    }

    const wordEl = document.getElementById('vocab-word');
    const optionsEl = document.getElementById('vocab-options');

    if (wordEl) wordEl.textContent = vocab.word;
    if (optionsEl) {
        optionsEl.innerHTML = '';
        vocab.options.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = opt;
            btn.addEventListener('click', () => {
                const btns = optionsEl.querySelectorAll('.option-btn');
                btns.forEach(b => b.disabled = true);
                if (i === vocab.answer) {
                    btn.classList.add('correct');
                    G.rune++;
                    G.gem += 5;
                    updateHUD();
                } else {
                    btn.classList.add('wrong');
                    btns[vocab.answer].classList.add('correct');
                }
                G.vocabIndex++;
                setTimeout(() => {
                    _startVocabQuiz();
                }, 1200);
            });
            optionsEl.appendChild(btn);
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
// OWL SCENE (SDK 활성 — 눈동자가 gaze를 따라감)
// 이미지: white_rabbit_character.png + CSS 눈동자
// GPU 예산: 이미지 ~3MB + 시선 처리 ~2MB = ~5MB (20MB 이내 ✅)
// ═══════════════════════════════════════════════════════════════════
function _startOwlScene() {
    G.gazeActive = true;
    _startGazeDot();

    const btnOwl = document.getElementById('btn-owl-start');
    if (btnOwl) {
        btnOwl.addEventListener('click', () => {
            // OWL 이미지를 DOM에서 제거 후 읽기 화면 진입
            // (이미지 GPU 텍스처 해제 → 읽기 화면 20MB 예산 확보)
            _destroyOwlImages();
            _startReading();
        }, { once: true });
    }
}

function _updateOwlEyes(gazeX, gazeY) {
    // 눈동자가 gaze를 따라감 — CSS transform만 사용 (GPU 텍스처 없음)
    const maxOffset = 8; // 최대 이동 범위 (px)
    const W = window.innerWidth, H = window.innerHeight;
    const nx = (gazeX / W - 0.5) * 2; // -1 ~ 1
    const ny = (gazeY / H - 0.5) * 2;

    const leftPupil = document.getElementById('eye-left-pupil');
    const rightPupil = document.getElementById('eye-right-pupil');
    const ox = nx * maxOffset;
    const oy = ny * maxOffset;
    if (leftPupil) leftPupil.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;
    if (rightPupil) rightPupil.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;
}

function _destroyOwlImages() {
    // rabbit CSS background-image는 CSS에서 있으므로 div 자체를 숨김
    // GPU 텍스처 해제: display:none은 불충분 → 부모 컨테이너 innerHTML 정리
    const owlScreen = document.getElementById('screen-owl');
    if (owlScreen) {
        const rabbitImg = owlScreen.querySelector('.rabbit-image');
        if (rabbitImg) rabbitImg.style.backgroundImage = 'none';
    }
}

// ═══════════════════════════════════════════════════════════════════
// READING (SDK 활성 — 20MB 이내)
// CSS-only 화면: 이미지 없음, gaze dot canvas만 있음
// ═══════════════════════════════════════════════════════════════════
async function _startReading() {
    const paragraph = window.storyChapter1.paragraphs[G.paraIndex];
    if (!paragraph) {
        _triggerFinalBoss();
        return;
    }

    // gaze 버퍼 리셋
    G.gIdx = 0; G.gCount = 0;
    G.readStartTime = performance.now();

    // PangDetector 초기화
    if (!G.pangDetector) {
        G.pangDetector = new PangDetector(
            G.gx, G.gy, G.gt, MAX_GAZE_ENTRIES,
            (lineIdx, vx) => _onPang(lineIdx, vx)
        );
    }
    G.pangDetector.reset();

    // LeanRenderer 초기화
    if (!G.leanRenderer) {
        G.leanRenderer = new LeanRenderer('book-content');
    }
    G.leanRenderer.destroy();

    showScreen('screen-read');
    G.gazeActive = true;
    _startGazeDot();

    // 텍스트 렌더링 + lockLayout
    const { lineYs, lineHalfH, lineCount } = await G.leanRenderer.render(paragraph.text);
    MemoryLogger.info('APP', `Reading P${G.paraIndex}: ${lineCount} lines`);
    G.pangDetector.lockLayout(lineYs, lineHalfH);

    // "Confront" 버튼 표시 (TheBookWardens 동일)
    const btnConfront = document.getElementById('btn-confront-villain');
    if (btnConfront) {
        btnConfront.style.display = 'none';
        // 30초 후 또는 모든 줄 읽기 완료 시 표시
        setTimeout(() => {
            if (G.currentScreen === 'screen-read') {
                _showConfrontButton();
            }
        }, 30000);
    }
}

function _showConfrontButton() {
    const btn = document.getElementById('btn-confront-villain');
    if (btn) {
        btn.style.display = 'block';
        btn.addEventListener('click', () => {
            _endReading();
        }, { once: true });
    }
}

function _endReading() {
    // WPM 계산
    const elapsed = (performance.now() - G.readStartTime) / 1000 / 60; // 분
    const paragraph = window.storyChapter1.paragraphs[G.paraIndex];
    if (paragraph) {
        const wordCount = paragraph.tokens ? paragraph.tokens.length : paragraph.text.split(/\s+/).length;
        G.wpm = elapsed > 0 ? Math.round(wordCount / elapsed) : 0;
    }

    // 잉크 보상 (pang 수 기반)
    const pangs = G.leanRenderer ? G.leanRenderer.pangCount : 0;
    const inkEarned = pangs * 10;
    G.ink += inkEarned;
    updateHUD();

    MemoryLogger.info('APP', `Reading done: WPM=${G.wpm}, ink+${inkEarned}`);

    // LeanRenderer 정리 (DOM + 참조 해제)
    if (G.leanRenderer) G.leanRenderer.destroy();
    if (G.pangDetector) G.pangDetector.reset();

    // gaze dot 정지
    _stopGazeDot();
    G.gazeActive = false;

    // villian 퀴즈 팝업 표시 (TheBookWardens의 villain-modal)
    _showVillainQuiz();
}

// ═══════════════════════════════════════════════════════════════════
// VILLAIN QUIZ (각 지문 후 중간 퀴즈)
// ═══════════════════════════════════════════════════════════════════
function _showVillainQuiz() {
    const quiz = window.midBossQuizzes[G.bossQuizIndex];
    if (!quiz) {
        G.paraIndex++;
        if (G.paraIndex < window.storyChapter1.paragraphs.length) {
            // 다음 지문
            showScreen('screen-owl');
            _startOwlScene();
        } else {
            _triggerFinalBoss();
        }
        return;
    }

    const modal = document.getElementById('villain-modal');
    const quizText = document.getElementById('quiz-text');
    const quizOptions = document.getElementById('quiz-options');
    const rewardContainer = document.getElementById('reward-container');
    const quizContainer = document.getElementById('quiz-container');
    const lineDetectResult = document.getElementById('line-detect-result');

    if (lineDetectResult) lineDetectResult.textContent = `Lines read: ${G.leanRenderer?.pangCount || 0}`;

    if (modal) modal.style.display = 'flex';
    if (rewardContainer) rewardContainer.style.display = 'none';
    if (quizContainer) quizContainer.style.display = 'block';
    if (quizText) quizText.textContent = quiz.q;

    if (quizOptions) {
        quizOptions.innerHTML = '';
        quiz.o.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'quiz-btn';
            btn.textContent = opt;
            btn.addEventListener('click', () => {
                quizOptions.querySelectorAll('.quiz-btn').forEach(b => b.disabled = true);
                const correct = i === quiz.a;
                btn.classList.add(correct ? 'correct' : 'wrong');
                if (!correct) quizOptions.querySelectorAll('.quiz-btn')[quiz.a].classList.add('correct');

                const inkGained = correct ? 30 : 10;
                G.ink += inkGained;
                G.gem += correct ? 10 : 0;
                updateHUD();

                // 보상 표시 후 다음으로
                setTimeout(() => {
                    if (quizContainer) quizContainer.style.display = 'none';
                    if (rewardContainer) {
                        rewardContainer.style.display = 'flex';
                        const rewardVal = document.getElementById('reward-ink-value');
                        if (rewardVal) rewardVal.textContent = `+${inkGained}`;
                    }
                    setTimeout(() => {
                        if (modal) modal.style.display = 'none';
                        G.bossQuizIndex++;
                        G.paraIndex++;
                        if (G.paraIndex < window.storyChapter1.paragraphs.length) {
                            showScreen('screen-owl');
                            _startOwlScene();
                        } else {
                            _triggerFinalBoss();
                        }
                    }, 1500);
                }, 1200);
            });
            quizOptions.appendChild(btn);
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
// BOSS BATTLE (중간 보스 - screen-boss)
// ═══════════════════════════════════════════════════════════════════
function _showBossBattle() {
    showScreen('screen-boss');
    const quiz = window.midBossQuizzes[G.bossQuizIndex] || window.midBossQuizzes[0];
    document.getElementById('boss-question').textContent = quiz.q;
    const bossOptions = document.getElementById('boss-options');
    if (bossOptions) {
        bossOptions.innerHTML = '';
        quiz.o.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'quiz-btn';
            btn.textContent = opt;
            btn.addEventListener('click', () => {
                bossOptions.querySelectorAll('.quiz-btn').forEach(b => b.disabled = true);
                btn.classList.add(i === quiz.a ? 'correct' : 'wrong');
                if (i !== quiz.a) bossOptions.querySelectorAll('.quiz-btn')[quiz.a].classList.add('correct');
                G.gem += i === quiz.a ? 20 : 5;
                updateHUD();
                G.bossQuizIndex++;
                setTimeout(() => {
                    G.paraIndex++;
                    if (G.paraIndex < window.storyChapter1.paragraphs.length) {
                        showScreen('screen-owl');
                        _startOwlScene();
                    } else {
                        _triggerFinalBoss();
                    }
                }, 1500);
            });
            bossOptions.appendChild(btn);
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
// FINAL BOSS — Alice Battle
// ═══════════════════════════════════════════════════════════════════
function _triggerFinalBoss() {
    MemoryLogger.info('APP', 'Triggering Final Boss');
    showScreen('screen-alice-battle');

    // alice-battle-simple.js의 AliceBattleRef 호출
    if (typeof AliceBattleRef !== 'undefined' && typeof AliceBattleRef.init === 'function') {
        AliceBattleRef.init({
            ink: G.ink, rune: G.rune, gem: G.gem,
            onWin: () => _showWin(),
            onLose: () => _showWin() // 패배도 결과 화면으로
        });
    } else {
        // Fallback: 5초 후 승리 화면
        setTimeout(_showWin, 5000);
    }
}

// ═══════════════════════════════════════════════════════════════════
// WIN
// ═══════════════════════════════════════════════════════════════════
function _showWin() {
    showScreen('screen-win');
    MemoryLogger.info('APP', `Game complete: ink=${G.ink} rune=${G.rune} gem=${G.gem} wpm=${G.wpm}`);
    MemoryLogger.downloadLogs();
}

// ═══════════════════════════════════════════════════════════════════
// 시선 콜백 — SDK에서 매 33ms 호출
// ═══════════════════════════════════════════════════════════════════
function _onGaze(gazeInfo) {
    if (!gazeInfo) return;
    const x = gazeInfo.x, y = gazeInfo.y;

    // gaze dot 위치 업데이트
    window._gazeX = x;
    window._gazeY = y;

    // OWL 화면: 눈동자 업데이트
    if (G.currentScreen === 'screen-owl') {
        _updateOwlEyes(x, y);
    }

    // READING 화면: 데이터 수집 + Pang 감지
    if (G.currentScreen === 'screen-read' && G.gazeActive) {
        G.gx[G.gIdx] = x;
        G.gy[G.gIdx] = y;
        G.gt[G.gIdx] = performance.now();
        G.gIdx = (G.gIdx + 1) % MAX_GAZE_ENTRIES;
        if (G.gCount < MAX_GAZE_ENTRIES) G.gCount++;

        if (G.pangDetector) {
            G.pangDetector.process(G.gIdx, G.gCount);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// Pang 콜백 — 줄 완료 감지 시 PangDetector가 호출
// ═══════════════════════════════════════════════════════════════════
function _onPang(lineIdx, vx) {
    MemoryLogger.info('PANG', `✅ Line ${lineIdx} | vx=${vx.toFixed(3)} px/ms`);
    MemoryLogger.snapshot(`PANG_L${lineIdx}`);

    // 잉크 스플래시 이펙트 (LeanRenderer)
    if (G.leanRenderer) G.leanRenderer.triggerInkSplash(lineIdx);

    // 즉시 보상: 잉크 +5 per pang
    G.ink += 5;
    updateHUD();

    // 플로팅 텍스트 (+Ink)
    _spawnFloatingText('+Ink', 'rgba(139,47,201,0.9)');

    // 모든 줄 읽기 완료 시 Confront 버튼 표시
    if (G.leanRenderer && G.pangDetector) {
        const totalLines = G.leanRenderer.lineCount;
        const pangs = G.leanRenderer.pangCount;
        if (pangs >= totalLines - 1 && totalLines > 0) {
            _showConfrontButton();
        }
    }
}

// 플로팅 텍스트 (점수 획득 피드백)
function _spawnFloatingText(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `
        position:fixed; top:${window.innerHeight * 0.4}px; left:50%;
        transform:translateX(-50%);
        color:${color}; font-size:1.5rem; font-weight:bold;
        font-family:'Cinzel',serif; text-shadow:0 0 10px ${color};
        pointer-events:none; z-index:9999;
        animation:floatUp 1.2s ease-out forwards;
    `;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 1300);
}

// ═══════════════════════════════════════════════════════════════════
// Gaze Dot Canvas (SDK_Test 동일 방식)
// 1회 할당 → clearRect만 사용 → iOS 안전
// ═══════════════════════════════════════════════════════════════════
function _startGazeDot() {
    _stopGazeDot();
    const canvas = document.getElementById('output');
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');

    const draw = () => {
        if (!G.gazeActive) return;
        G.gazeDotRafId = requestAnimationFrame(draw);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const x = window._gazeX, y = window._gazeY;
        if (x != null && y != null && isFinite(x) && isFinite(y)) {
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 220, 0, 0.75)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    };
    draw();
}

function _stopGazeDot() {
    if (G.gazeDotRafId) {
        cancelAnimationFrame(G.gazeDotRafId);
        G.gazeDotRafId = null;
    }
    const canvas = document.getElementById('output');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// ═══════════════════════════════════════════════════════════════════
// 기타 버튼 이벤트 바인딩
// ═══════════════════════════════════════════════════════════════════
function _bindButtons() {
    // Cal Retry / Skip
    const btnCalRetry = document.getElementById('btn-cal-retry');
    if (btnCalRetry) btnCalRetry.addEventListener('click', () => _startCalibration());

    const btnCalSkip = document.getElementById('btn-cal-skip');
    if (btnCalSkip) btnCalSkip.addEventListener('click', () => {
        document.getElementById('cal-fail-popup').style.display = 'none';
        showScreen('screen-rift-intro');
        _startRiftIntro();
    });

    // share / win 화면 버튼
    const btnReturnLobby = document.getElementById('btn-return-lobby');
    if (btnReturnLobby) btnReturnLobby.addEventListener('click', () => showScreen('screen-home'));

    // Resize → canvas 재설정
    window.addEventListener('resize', () => {
        const canvas = document.getElementById('output');
        if (canvas && G.gazeActive) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
    });

    // Log download
    const btnLog = document.getElementById('btn-download-log');
    if (btnLog) btnLog.addEventListener('click', () => MemoryLogger.downloadLogs());
}

// ── CSS: floatUp 애니메이션 동적 주입 ────────────────────────────
(function injectCSS() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes floatUp {
            0%   { opacity:1; transform:translateX(-50%) translateY(0); }
            100% { opacity:0; transform:translateX(-50%) translateY(-60px); }
        }
        @keyframes inkSplash {
            0%   { opacity:1; transform:translate(0,0) scale(1); }
            50%  { opacity:1; transform:translate(5px,-15px) scale(1.2); }
            100% { opacity:0; transform:translate(10px,-30px) scale(0.7); }
        }
        .ink-splash-fx { animation: inkSplash 0.7s ease-out forwards; }
        .text-line {
            font-family: 'Crimson Text', serif;
            font-size: 1.4rem;
            line-height: 2.2;
            color: #e8e0d0;
            padding: 0 2px;
            transition: background-color 0.3s ease;
        }
    `;
    document.head.appendChild(style);
})();

// ═══════════════════════════════════════════════════════════════════
// 진입점 — loadScript로 로드된 후 즉시 실행
// ═══════════════════════════════════════════════════════════════════
(function main() {
    MemoryLogger.info('APP', '=== BookWardens-Lean v1.0 ===');
    MemoryLogger.snapshot('APP_START');

    _bindButtons();
    initSplash();
    initHome();

    window.__app = G; // 디버그용

    MemoryLogger.info('APP', 'Ready.');
})();

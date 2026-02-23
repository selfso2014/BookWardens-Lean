/**
 * easy-seeso.js — BookWardens-Lean 호환 버전
 *
 * 원본은 ES module (import 문 사용) → loadScript()로 로드 불가.
 * 이 파일은 동적 import()를 사용해 seeso.min.js를 로드한 뒤
 * window.EasySeeso로 클래스를 노출한다.
 *
 * 사용 측에서:
 *   await window.__easySeesoPending;  // SDK 로드 완료 대기
 *   const s = new EasySeeso();
 */
(function () {
  // seeso.min.js 경로: 이 파일 기준 ./dist/seeso.min.js
  const sdkPath = (function () {
    const scripts = document.querySelectorAll('script[src]');
    for (let s of scripts) {
      if (s.src && s.src.includes('easy-seeso.js')) {
        return s.src.replace('easy-seeso.js', 'dist/seeso.min.js');
      }
    }
    // fallback: document.currentScript (구형 브라우저 미지원 시)
    return './seeso/dist/seeso.min.js';
  })();

  window.__easySeesoPending = import(sdkPath).then((module) => {
    const Seeso = module.default;
    const InitializationErrorType = module.InitializationErrorType;
    const CalibrationAccuracyCriteria = module.CalibrationAccuracyCriteria;

    class EasySeeso {
      constructor() {
        this.seeso = new Seeso();
        this.onGaze = null;
        this.onFace = null;
        this.onDebug = null;
        this.onCalibrationNextPoint = null;
        this.onCalibrationProgress = null;
        this.onCalibrationFinished = null;
        this.onAttention = null;
        this.onBlink = null;
        this.onDrowsiness = null;
        this.onGazeBind = null;
        this.onCalibrationFinishedBind = null;
      }

      async init(licenseKey, afterInitialized, afterFailed, userStatusOption) {
        await this.seeso.initialize(licenseKey, userStatusOption).then(function (errCode) {
          if (errCode === InitializationErrorType.ERROR_NONE) {
            afterInitialized();
            this.onCalibrationFinishedBind = this.onCalibrationFinished_.bind(this);
            this.seeso.addCalibrationFinishCallback(this.onCalibrationFinishedBind);
            this.onGazeBind = this.onGaze_.bind(this);
            this.seeso.addGazeCallback(this.onGazeBind);
          } else {
            afterFailed();
          }
        }.bind(this));
      }

      deinit() {
        this.removeUserStatusCallback();
        this.seeso.removeGazeCallback(this.onGazeBind);
        this.seeso.removeCalibrationFinishCallback(this.onCalibrationFinishedBind);
        this.seeso.removeDebugCallback(this.onDebug);
        this.seeso.deinitialize();
      }

      async startTracking(onGaze, onDebug, existingStream) {
        const stream = existingStream || await navigator.mediaDevices.getUserMedia({ 'video': true });
        this.stream = stream;
        this.seeso.addDebugCallback(onDebug);
        if (this.seeso.startTracking(stream)) {
          this.onGaze = onGaze;
          this.onDebug = onDebug;
          return true;
        } else {
          this.seeso.removeDebugCallback(this.onDebug);
          return false;
        }
      }

      stopTracking() {
        this.seeso.stopTracking();
        this.seeso.removeDebugCallback(this.onDebug);
        this.onGaze = null;
        this.onDebug = null;
      }

      setFaceCallback(onFace) {
        this.seeso.addFaceCallback(onFace);
        this.onFace = onFace;
      }

      removeFaceCallbck(onFace) {
        this.seeso.removeFaceCallbck(onFace);
      }

      setScreenSize(widthMm, heightMm) {
        if (widthMm && widthMm > 0 && heightMm && heightMm > 0) {
          this.seeso.setScreenSize(widthMm, heightMm);
        }
      }

      setUserStatusCallback(onAttention, onBlink, onDrowsiness) {
        this.seeso.addAttentionCallback(onAttention);
        this.seeso.addBlinkCallback(onBlink);
        this.seeso.addDrowsinessCallback(onDrowsiness);
        this.onAttention = onAttention;
        this.onBlink = onBlink;
        this.onDrowsiness = onDrowsiness;
      }

      removeUserStatusCallback() {
        this.seeso.removeAttentionCallback(this.onAttention);
        this.seeso.removeBlinkCallback(this.onBlink);
        this.seeso.removeDrowsinessCallback(this.onDrowsiness);
      }

      startCalibration(onCalibrationNextPoint, onCalibrationProgress, onCalibrationFinished, calibrationPoints = 5) {
        this.seeso.addCalibrationNextPointCallback(onCalibrationNextPoint);
        this.seeso.addCalibrationProgressCallback(onCalibrationProgress);
        const isStart = this.seeso.startCalibration(calibrationPoints, CalibrationAccuracyCriteria.Default);
        if (isStart) {
          this.onCalibrationNextPoint = onCalibrationNextPoint;
          this.onCalibrationProgress = onCalibrationProgress;
          this.onCalibrationFinished = onCalibrationFinished;
        } else {
          this.seeso.removeCalibrationNextPointCallback(this.onCalibrationNextPoint);
          this.seeso.removeCalibrationProgressCallback(this.onCalibrationProgress);
        }
        return isStart;
      }

      stopCalibration() {
        return this.seeso.stopCalibration();
      }

      setTrackingFps(fps) {
        this.seeso.setTrackingFps(fps);
      }

      async fetchCalibrationData(userId) {
        return this.seeso.fetchCalibrationData(userId);
      }

      async uploadCalibrationData(userId) {
        return this.seeso.uploadCalibrationData(userId);
      }

      showImage() { this.seeso.showImage(); }
      hideImage() { this.seeso.hideImage(); }
      startCollectSamples() { this.seeso.startCollectSamples(); }
      checkMobile() { return this.seeso.checkMobile(); }
      setMonitorSize(monitorInch) { this.seeso.setMonitorSize(monitorInch); }
      setFaceDistance(faceDistance) { this.seeso.setFaceDistance(faceDistance); }
      setCameraPosition(cameraX, cameraOnTop) { this.seeso.setCameraPosition(cameraX, cameraOnTop); }
      setCameraConfiguration(cameraConfig) { this.seeso.setCameraConfiguration(cameraConfig); }
      getCameraConfiguration() { this.seeso.getCameraConfiguration(); }
      getCameraPosition() { return this.seeso.getCameraPosition(); }
      getFaceDistance() { return this.seeso.getFaceDistance(); }
      getMonitorSize() { return this.seeso.getMonitorSize(); }

      async setCalibrationData(calibrationDataString) {
        await this.seeso.setCalibrationData(calibrationDataString);
      }

      static openCalibrationPage(licenseKey, userId, redirectUrl, calibrationPoint) {
        Seeso.openCalibrationPage(licenseKey, userId, redirectUrl, calibrationPoint);
      }

      static openCalibrationPageQuickStart(licenseKey, userId, redirectUrl, calibrationPoint) {
        Seeso.openCalibrationPageQuickStart(licenseKey, userId, redirectUrl, calibrationPoint);
      }

      setAttentionInterval(interval) { this.seeso.setAttentionInterval(interval); }
      getAttentionScore() { return this.seeso.getAttentionScore(); }

      static getVersionName() { return Seeso.getVersionName(); }

      /** @private */
      onGaze_(gazeInfo) {
        if (this.onGaze) this.onGaze(gazeInfo);
      }

      /** @private */
      onCalibrationFinished_(calibrationData) {
        if (this.onCalibrationFinished) {
          this.onCalibrationFinished(calibrationData);
        }
        this.seeso.removeCalibrationNextPointCallback(this.onCalibrationNextPoint);
        this.seeso.removeCalibrationProgressCallback(this.onCalibrationProgress);
        this.onCalibrationFinished = null;
        this.onCalibrationProgress = null;
        this.onCalibrationNextPoint = null;
      }
    }

    window.EasySeeso = EasySeeso;
    console.log('[EasySeeso] ✅ Loaded via dynamic import');
    return EasySeeso;
  }).catch((e) => {
    console.error('[EasySeeso] ❌ Failed to load seeso.min.js:', e.message);
    throw e;
  });
})();

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { primaryMonitor } from "@tauri-apps/api/window";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  RECORDING_OVERLAY_ACTION_EVENT,
  RECORDING_OVERLAY_UPDATE_EVENT,
  RECORDING_OVERLAY_WINDOW_LABEL,
  type OverlayRecordingState,
  type RecordingOverlayActionPayload,
  type RecordingOverlayUpdatePayload,
} from "../recordingOverlay";
import "./Record.css";

type RecordState = OverlayRecordingState;
type AutoZoomTriggerMode = "single-click" | "multi-click-window" | "ctrl-click";
type RecordingQuality = "low" | "balanced" | "high";
type RecordingFps = 30 | 60;
type RecordingAudioMode =
  | "no-audio"
  | "system-only"
  | "microphone-only"
  | "microphone-and-system";

interface StartRecordingOptions {
  autoZoomTriggerMode: AutoZoomTriggerMode;
  quality: RecordingQuality;
  targetFps: RecordingFps;
  audioCaptureMode: RecordingAudioMode;
  microphoneDevice?: string;
}

interface NativePreviewFrame {
  dataUrl: string;
  width: number;
  height: number;
  sequence: number;
}

interface RecordScreenProps {
  isActive: boolean;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

async function waitForWebviewWindowCreated(webviewWindow: WebviewWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (cb: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cb();
    };

    void webviewWindow.once("tauri://created", () => finish(resolve));
    void webviewWindow.once("tauri://error", (event) =>
      finish(() => reject(new Error(String(event.payload))))
    );

    // В некоторых случаях окно может быть создано ещё до присоединения слушателей.
    setTimeout(() => finish(resolve), 1200);
  });
}

export default function RecordScreen({ isActive }: RecordScreenProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<RecordState>("idle");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [autoZoomTriggerMode, setAutoZoomTriggerMode] = useState<AutoZoomTriggerMode>("single-click");
  const [recordingQuality, setRecordingQuality] = useState<RecordingQuality>("high");
  const [recordingFps, setRecordingFps] = useState<RecordingFps>(60);
  const [audioCaptureMode, setAudioCaptureMode] = useState<RecordingAudioMode>("no-audio");
  const [microphoneDevices, setMicrophoneDevices] = useState<string[]>([]);
  const [selectedMicrophoneDevice, setSelectedMicrophoneDevice] = useState("");
  const [isLoadingMicrophones, setIsLoadingMicrophones] = useState(false);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [isWindowFocused, setIsWindowFocused] = useState(true);

  const tickerRef = useRef<number | null>(null);
  const elapsedBeforePauseMsRef = useRef(0);
  const resumedAtMsRef = useRef<number | null>(null);
  const stateRef = useRef<RecordState>("idle");
  const previewPollRef = useRef<number | null>(null);
  const previewRequestInFlightRef = useRef(false);
  const previewSequenceRef = useRef(0);
  const isPreviewLoadingRef = useRef(false);
  const ctrlPollRef = useRef<number | null>(null);
  const ctrlRequestInFlightRef = useRef(false);
  const overlayWindowRef = useRef<WebviewWindow | null>(null);
  const overlayHiddenRef = useRef<boolean | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const stopTicker = useCallback(() => {
    if (tickerRef.current !== null) {
      cancelAnimationFrame(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  const updateDurationFromClock = useCallback((now: number) => {
    let elapsedMs = elapsedBeforePauseMsRef.current;
    if (stateRef.current === "recording" && resumedAtMsRef.current !== null) {
      elapsedMs += now - resumedAtMsRef.current;
    }
    const elapsedSec = Math.floor(elapsedMs / 1000);
    setDuration((current) => (current === elapsedSec ? current : elapsedSec));
  }, []);

  const startTicker = useCallback(() => {
    stopTicker();
    const tick = () => {
      updateDurationFromClock(performance.now());
      tickerRef.current = requestAnimationFrame(tick);
    };
    tickerRef.current = requestAnimationFrame(tick);
  }, [stopTicker, updateDurationFromClock]);

  const closeOverlayWindow = useCallback(async () => {
    try {
      const overlayWindow =
        overlayWindowRef.current ??
        (await WebviewWindow.getByLabel(RECORDING_OVERLAY_WINDOW_LABEL));
      if (overlayWindow) {
        await overlayWindow.close();
      }
    } catch {
      // Окно могло быть уже закрыто.
    } finally {
      overlayWindowRef.current = null;
      overlayHiddenRef.current = null;
    }
  }, []);

  const ensureOverlayWindow = useCallback(async (): Promise<WebviewWindow> => {
    if (overlayWindowRef.current) {
      return overlayWindowRef.current;
    }

    const existing = await WebviewWindow.getByLabel(RECORDING_OVERLAY_WINDOW_LABEL);
    if (existing) {
      overlayWindowRef.current = existing;
      return existing;
    }

    const monitor = await primaryMonitor();
    const overlayWidth = 320;
    const overlayHeight = 60;
    const bottomGap = 24;
    const scaleFactor = monitor?.scaleFactor ?? 1;

    const monitorLogicalWidth = monitor
      ? monitor.size.width / scaleFactor
      : window.innerWidth;
    const monitorLogicalHeight = monitor
      ? monitor.size.height / scaleFactor
      : window.innerHeight;
    const monitorLogicalX = monitor ? monitor.position.x / scaleFactor : 0;
    const monitorLogicalY = monitor ? monitor.position.y / scaleFactor : 0;

    const x = Math.round(
      monitorLogicalX + (monitorLogicalWidth - overlayWidth) / 2
    );
    const y = Math.round(
      monitorLogicalY + monitorLogicalHeight - overlayHeight - bottomGap
    );

    const overlayWindow = new WebviewWindow(RECORDING_OVERLAY_WINDOW_LABEL, {
      title: "Recording Controls",
      width: overlayWidth,
      height: overlayHeight,
      x,
      y,
      decorations: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      focus: false,
      shadow: false,
      contentProtected: true,
    });

    await waitForWebviewWindowCreated(overlayWindow);
    overlayWindowRef.current = overlayWindow;
    return overlayWindow;
  }, []);

  const emitOverlayUpdate = useCallback(
    async (
      nextState: RecordState,
      nextDuration: number,
      nextRecordingId: string | null,
      hidden: boolean
    ) => {
      if (nextState === "idle") {
        await closeOverlayWindow();
        return;
      }

      if (hidden) {
        if (overlayHiddenRef.current !== true) {
          await closeOverlayWindow();
          overlayHiddenRef.current = true;
        }
        return;
      }

      const overlayWindow = await ensureOverlayWindow();
      try {
        await overlayWindow.setIgnoreCursorEvents(false);
      } catch {
        // Игнорируем если переключение клик-через не поддерживается.
      }
      overlayHiddenRef.current = false;

      const payload: RecordingOverlayUpdatePayload = {
        recordingId: nextRecordingId,
        state: nextState,
        duration: nextDuration,
        hidden,
      };
      await getCurrentWebviewWindow().emitTo(
        overlayWindow.label,
        RECORDING_OVERLAY_UPDATE_EVENT,
        payload
      );
    },
    [closeOverlayWindow, ensureOverlayWindow]
  );

  const stopCtrlPolling = useCallback(() => {
    if (ctrlPollRef.current !== null) {
      window.clearInterval(ctrlPollRef.current);
      ctrlPollRef.current = null;
    }
    ctrlRequestInFlightRef.current = false;
  }, []);

  const pullCtrlState = useCallback(async () => {
    if (ctrlRequestInFlightRef.current) {
      return;
    }
    ctrlRequestInFlightRef.current = true;
    try {
      const pressed = await invoke<boolean>("is_ctrl_pressed");
      setIsCtrlPressed((current) => (current === pressed ? current : pressed));
    } catch {
      // Скрытие контролей по Ctrl — на основе лучших усилий.
    } finally {
      ctrlRequestInFlightRef.current = false;
    }
  }, []);

  const stopPreviewPolling = useCallback(() => {
    if (previewPollRef.current !== null) {
      clearInterval(previewPollRef.current);
      previewPollRef.current = null;
    }
  }, []);

  const fetchPreviewFrame = useCallback(async () => {
    if (previewRequestInFlightRef.current) {
      return;
    }
    previewRequestInFlightRef.current = true;

    try {
      const frame = await invoke<NativePreviewFrame | null>("get_native_preview_frame");
      if (frame && frame.sequence !== previewSequenceRef.current) {
        previewSequenceRef.current = frame.sequence;
        setPreviewImageSrc(frame.dataUrl);
        setPreviewError(null);
      }
    } catch (err) {
      setPreviewError(String(err));
    }
    previewRequestInFlightRef.current = false;
  }, []);

  const startPreviewPollingWithFps = useCallback((fps: number) => {
    stopPreviewPolling();
    const interval = 1000 / fps;
    previewPollRef.current = window.setInterval(() => {
      void fetchPreviewFrame();
    }, interval);
  }, [stopPreviewPolling, fetchPreviewFrame]);

  const stopPreview = useCallback(async () => {
    stopPreviewPolling();
    previewRequestInFlightRef.current = false;
    previewSequenceRef.current = 0;
    isPreviewLoadingRef.current = false;
    setIsPreviewLoading(false);
    setPreviewImageSrc(null);
    try {
      await invoke("stop_native_preview");
    } catch {
      // Предпросмотр — на основе лучших усилий; игнорируем ошибки остановки.
    }
  }, [stopPreviewPolling]);

  const startPreview = useCallback(async () => {
    if (stateRef.current !== "idle" || isPreviewLoadingRef.current) {
      return;
    }

    isPreviewLoadingRef.current = true;
    setIsPreviewLoading(true);
    setPreviewError(null);
    try {
      await invoke("start_native_preview", { monitorIndex: 0 });
      await fetchPreviewFrame();
      const fps = isPreviewVisible && isWindowFocused ? 60 : 12;
      startPreviewPollingWithFps(fps);
    } catch (err) {
      setPreviewError(String(err));
      await stopPreview();
    } finally {
      isPreviewLoadingRef.current = false;
      setIsPreviewLoading(false);
    }
  }, [fetchPreviewFrame, stopPreview, isPreviewVisible, isWindowFocused, startPreviewPollingWithFps]);

  useEffect(() => {
    if (!isActive || state !== "idle") {
      void stopPreview();
      return;
    }

    const timer = window.setTimeout(() => {
      void startPreview();
    }, 140);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isActive, startPreview, state, stopPreview]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let cancelled = false;
    const loadMicrophones = async () => {
      setIsLoadingMicrophones(true);
      setMicrophoneError(null);
      try {
        const devices = await invoke<string[]>("list_audio_input_devices");
        if (cancelled) {
          return;
        }
        setMicrophoneDevices(devices);
        setSelectedMicrophoneDevice((current) => {
          if (current && devices.includes(current)) {
            return current;
          }
          return devices[0] ?? "";
        });
      } catch (err) {
        if (!cancelled) {
          setMicrophoneError(String(err));
          setMicrophoneDevices([]);
          setSelectedMicrophoneDevice("");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMicrophones(false);
        }
      }
    };

    void loadMicrophones();
    return () => {
      cancelled = true;
    };
  }, [isActive]);

  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!previewShellRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsPreviewVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    observer.observe(previewShellRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (previewPollRef.current === null) return;

    const fps = isPreviewVisible && isWindowFocused ? 60 : 12;
    startPreviewPollingWithFps(fps);
  }, [isPreviewVisible, isWindowFocused, startPreviewPollingWithFps]);

  useEffect(() => {
    if (state === "idle") {
      stopCtrlPolling();
      setIsCtrlPressed(false);
      return;
    }

    void pullCtrlState();
    stopCtrlPolling();
    ctrlPollRef.current = window.setInterval(() => {
      void pullCtrlState();
    }, 80);

    return () => {
      stopCtrlPolling();
    };
  }, [pullCtrlState, state, stopCtrlPolling]);

  useEffect(() => {
    void emitOverlayUpdate(state, duration, recordingId, isCtrlPressed).catch(() => {
      // Оверлей опционален; игнорируем ошибки доставки.
    });
  }, [duration, emitOverlayUpdate, isCtrlPressed, recordingId, state]);

  useEffect(() => {
    return () => {
      stopTicker();
      stopCtrlPolling();
      void stopPreview();
      void closeOverlayWindow();
    };
  }, [closeOverlayWindow, stopCtrlPolling, stopPreview, stopTicker]);

  const finalizeElapsedBeforePause = useCallback(() => {
    if (resumedAtMsRef.current !== null) {
      const now = performance.now();
      elapsedBeforePauseMsRef.current += now - resumedAtMsRef.current;
      resumedAtMsRef.current = null;
    }
    updateDurationFromClock(performance.now());
  }, [updateDurationFromClock]);

  const handleStart = useCallback(async () => {
    setError(null);
    finalizeElapsedBeforePause();
    setDuration(0);
    elapsedBeforePauseMsRef.current = 0;
    resumedAtMsRef.current = null;
    const requiresMicrophone =
      audioCaptureMode === "microphone-only" || audioCaptureMode === "microphone-and-system";
    const microphoneDeviceForStart = requiresMicrophone && selectedMicrophoneDevice
      ? selectedMicrophoneDevice
      : undefined;

    if (requiresMicrophone && !microphoneDeviceForStart) {
      setError("Select microphone device before recording.");
      return;
    }

    try {
      await stopPreview();
      const options: StartRecordingOptions = {
        autoZoomTriggerMode,
        quality: recordingQuality,
        targetFps: recordingFps,
        audioCaptureMode,
        microphoneDevice: microphoneDeviceForStart,
      };
      const id = await invoke<string>("start_recording", { monitorIndex: 0, options });
      setRecordingId(id);
      resumedAtMsRef.current = performance.now();
      setState("recording");
      startTicker();
      try {
        await getCurrentWebviewWindow().minimize();
      } catch {
        // Запись должна продолжиться даже если свернуть окно невозможно.
      }
    } catch (err) {
      setState("idle");
      setError(String(err));
    }
  }, [
    autoZoomTriggerMode,
    audioCaptureMode,
    finalizeElapsedBeforePause,
    recordingFps,
    recordingQuality,
    selectedMicrophoneDevice,
    stopPreview,
    startTicker,
  ]);

  const handlePause = useCallback(async () => {
    if (!recordingId || state !== "recording") {
      return;
    }
    setError(null);

    try {
      await invoke("pause_recording", { recordingId });
      finalizeElapsedBeforePause();
      setState("paused");
    } catch (err) {
      setError(String(err));
    }
  }, [finalizeElapsedBeforePause, recordingId, state]);

  const handleResume = useCallback(async () => {
    if (!recordingId || state !== "paused") {
      return;
    }
    setError(null);

    try {
      await invoke("resume_recording", { recordingId });
      resumedAtMsRef.current = performance.now();
      setState("recording");
    } catch (err) {
      setError(String(err));
    }
  }, [recordingId, state]);

  const handleStop = useCallback(async () => {
    if (!recordingId || state === "stopping") {
      return;
    }
    setState("stopping");
    finalizeElapsedBeforePause();
    stopTicker();

    try {
      await invoke("stop_recording", { recordingId });
      setRecordingId(null);
      setState("idle");
      elapsedBeforePauseMsRef.current = 0;
      resumedAtMsRef.current = null;
      setDuration(0);
    } catch (err) {
      setState("idle");
      setError(String(err));
    }
  }, [finalizeElapsedBeforePause, recordingId, state, stopTicker]);

  useEffect(() => {
    const appWindow = getCurrentWebviewWindow();
    const unlistenPromise = appWindow.listen<RecordingOverlayActionPayload>(
      RECORDING_OVERLAY_ACTION_EVENT,
      (event) => {
        if (event.payload.action === "pause") {
          void handlePause();
          return;
        }
        if (event.payload.action === "resume") {
          void handleResume();
          return;
        }
        if (event.payload.action === "stop") {
          void handleStop();
        }
      }
    );

    return () => {
      void unlistenPromise.then((unlisten) => {
        unlisten();
      });
    };
  }, [handlePause, handleResume, handleStop]);

  const isIdle = state === "idle";
  const microphoneSelectionVisible =
    audioCaptureMode === "microphone-only" || audioCaptureMode === "microphone-and-system";
  const statusText =
    state === "idle"
      ? t("record.readyToRecord")
      : state === "recording"
      ? `${t("record.recording")} ${formatDuration(duration)}`
      : state === "paused"
      ? `${t("record.paused")} ${formatDuration(duration)}`
      : t("record.saving");

  return (
    <div className="record-screen">
      <div className="record-workspace">
        <aside className="record-settings">
          <header className="record-settings-header">
            <h2>{t("record.captureSetup")}</h2>
            <p>{t("record.setupDescription")}</p>
          </header>

          <section className="record-settings-group">
            <label className="record-field">
              <span className="record-field-label">{t("record.autoZoomTrigger")}</span>
              <select
                 value={autoZoomTriggerMode}
                 onChange={(event) => setAutoZoomTriggerMode(event.target.value as AutoZoomTriggerMode)}
                 disabled={!isIdle}
               >
                 <option value="single-click">{t("record.triggerSingleClick")}</option>
                 <option value="multi-click-window">{t("record.triggerMultiClick")}</option>
                 <option value="ctrl-click">{t("record.triggerCtrlClick")}</option>
               </select>
              </label>

              <label className="record-field">
               <span className="record-field-label">{t("record.recordingQuality")}</span>
               <select
                 value={recordingQuality}
                 onChange={(event) => setRecordingQuality(event.target.value as RecordingQuality)}
                 disabled={!isIdle}
               >
                 <option value="low">{t("record.qualityLow")}</option>
                 <option value="balanced">{t("record.qualityBalanced")}</option>
                 <option value="high">{t("record.qualityHigh")}</option>
               </select>
              </label>

              <label className="record-field">
               <span className="record-field-label">{t("record.audioSource")}</span>
               <select
                 value={audioCaptureMode}
                 onChange={(event) => setAudioCaptureMode(event.target.value as RecordingAudioMode)}
                 disabled={!isIdle}
               >
                 <option value="system-only">{t("record.audioSystemOnly")}</option>
                 <option value="microphone-only">{t("record.audioMicrophoneOnly")}</option>
                 <option value="microphone-and-system">{t("record.audioMicrophoneAndSystem")}</option>
                 <option value="no-audio">{t("record.audioNoAudio")}</option>
               </select>
              </label>

            {microphoneSelectionVisible && (
              <label className="record-field">
                <span className="record-field-label">{t("record.microphoneDevice")}</span>
                <select
                  value={selectedMicrophoneDevice}
                  onChange={(event) => setSelectedMicrophoneDevice(event.target.value)}
                  disabled={!isIdle || isLoadingMicrophones || microphoneDevices.length === 0}
                >
                  {microphoneDevices.length === 0 ? (
                    <option value="">
                      {isLoadingMicrophones ? t("record.loadingDevices") : t("record.noMicrophoneDevices")}
                    </option>
                  ) : (
                    microphoneDevices.map((device) => (
                      <option key={device} value={device}>
                        {device}
                      </option>
                    ))
                  )}
                </select>
                {microphoneError && <small className="record-field-error">{microphoneError}</small>}
              </label>
            )}
          </section>

          <section className="record-settings-group">
            <div className="record-field record-field--fps">
              <span className="record-field-label">{t("record.captureFps")}</span>
              <div className="record-fps-options">
                <button
                  type="button"
                  className={`record-fps-btn ${recordingFps === 30 ? "record-fps-btn--active" : ""}`}
                  data-active={recordingFps === 30}
                  onClick={() => setRecordingFps(30)}
                  disabled={!isIdle}
                >
                  {t("record.fps30")}
                </button>
                <button
                  type="button"
                  className={`record-fps-btn ${recordingFps === 60 ? "record-fps-btn--active" : ""}`}
                  data-active={recordingFps === 60}
                  onClick={() => setRecordingFps(60)}
                  disabled={!isIdle}
                >
                  {t("record.fps60")}
                </button>
              </div>
              <small className="record-fps-current">{t("record.selected")}: {recordingFps} FPS</small>
            </div>
          </section>

          <div className="record-settings-footnote">
            <span className="record-chip">{t("record.defaultTrigger")}</span>
            <span className="record-chip">{t("record.holdCtrlToHide")}</span>
          </div>
        </aside>

        <section className="record-stage">
          <header className="record-stage-header">
            <div className="record-stage-title-wrap">
              <h1>{t("record.screenCapture")}</h1>
              <p>{t("record.screenCaptureDescription")}</p>
            </div>
            <div className={`record-status ${state === "recording" ? "record-status--active" : ""}`}>
              <div className="record-indicator" />
              <span>{statusText}</span>
            </div>
          </header>

          <div className="record-stage-toolbar">
            <div className="record-stage-controls">
              {state === "idle" && (
                <button className="btn-action record-btn" onClick={handleStart}>
                  {t("record.startRecording")}
                </button>
              )}
              {state === "recording" && (
                <>
                  <button className="btn-ghost record-btn" onClick={handlePause}>
                    {t("record.pause")}
                  </button>
                  <button className="btn-danger record-btn" onClick={handleStop}>
                    {t("record.stop")}
                  </button>
                </>
              )}
              {state === "paused" && (
                <>
                  <button className="btn-primary record-btn" onClick={handleResume}>
                    {t("record.resume")}
                  </button>
                  <button className="btn-danger record-btn" onClick={handleStop}>
                    {t("record.stop")}
                  </button>
                </>
              )}
              {state === "stopping" && (
                <button className="btn-ghost record-btn" disabled>
                  {t("record.saving2")}
                </button>
              )}
            </div>

            <div className="record-stage-meta">
              <span className="record-meta-label">{t("record.session")}</span>
              <span className="record-meta-value mono">
                {recordingId ? recordingId.slice(0, 8).toUpperCase() : t("record.notStarted")}
              </span>
            </div>
          </div>

          <div className="record-preview-shell" ref={previewShellRef}>
            {previewImageSrc ? (
              <img src={previewImageSrc} className="record-preview-video" alt="Screen preview" />
            ) : (
              <div className="record-preview-placeholder">
                <strong>{t("record.screenPreview")}</strong>
                <p>
                  {previewError
                    ? previewError
                    : isPreviewLoading
                    ? t("record.connectingToPreview")
                    : t("record.previewDisabled")}
                </p>
                <button className="btn-ghost" onClick={() => void startPreview()} disabled={isPreviewLoading || !isIdle}>
                  {t("record.enablePreview")}
                </button>
              </div>
            )}
          </div>

          <footer className="record-stage-footer">
            <span className="record-footer-item">
              {isCtrlPressed
                ? t("record.overlayHidden")
                : t("record.holdCtrlHint")}
            </span>
            <span className="record-footer-item mono">{t("record.elapsed")} {formatDuration(duration)}</span>
          </footer>

          {error && (
            <div className="record-error">
              <strong>{t("record.error")}:</strong> {error}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

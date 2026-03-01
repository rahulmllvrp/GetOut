"use client";

/**
 * Home (page.tsx)
 *
 * Main game interface. Wires together:
 *   useThreeScene     – 3D Gaussian splat scene
 *   useImageEnhancer  – overlay image (hidden POV / enhance)
 *   useLocationNav    – camera navigation to named locations
 *   useGameSession    – game state, chat with Game Master, voice I/O
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useThreeScene } from "./hooks/useThreeScene";
import { useImageEnhancer } from "./hooks/useImageEnhancer";
import { useLocationNav } from "./hooks/useLocationNav";
import { useGameSession } from "./hooks/useGameSession";
import { Win98Intro } from "./components/Win98Intro";

// easeOutQuart: fast initial burst then dramatically slows — ink hitting paper.
function easeOutQuart(t: number) {
  return 1 - Math.pow(1 - t, 4);
}

// Greenish-tinted film grain, generated once and reused across renders.
let _noiseCanvas: HTMLCanvasElement | null = null;
function getNoiseCanvas(): HTMLCanvasElement {
  if (_noiseCanvas) return _noiseCanvas;
  const nc = document.createElement("canvas");
  nc.width = 256;
  nc.height = 256;
  const nctx = nc.getContext("2d")!;
  const id = nctx.createImageData(256, 256);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = (Math.random() * 210) | 0;
    id.data[i] = (v * 0.72) | 0;
    id.data[i + 1] = v;
    id.data[i + 2] = (v * 0.55) | 0;
    id.data[i + 3] = (Math.random() * 65 + 8) | 0;
  }
  nctx.putImageData(id, 0, 0);
  _noiseCanvas = nc;
  return nc;
}

// Ink-on-rough-paper reveal: splotches burst outward with satellite blobs and
// tendrils, then the image gets a barely-there green cast, grain, and vignette.
// Clicking the canvas fires the optional onClick (e.g. dismissOverlay).
function SplotchReveal({
  src,
  visible,
  onClick,
}: {
  src: string;
  visible: boolean;
  onClick?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (!visible) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (W === 0 || H === 0) return;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const maxDim = Math.max(W, H);

    // 24 ink splotches — each has a main blob, irregular satellite blobs, and tendrils.
    const splotches = Array.from({ length: 24 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      maxR: maxDim * (0.14 + Math.random() * 0.3),
      delay: Math.random() * 0.65,
      dur: 0.22 + Math.random() * 1.1,
      sats: Array.from({ length: 4 + Math.floor(Math.random() * 6) }, () => ({
        a: Math.random() * Math.PI * 2,
        d: 0.4 + Math.random() * 0.75,
        r: 0.18 + Math.random() * 0.42,
      })),
      tendrils: Array.from(
        { length: 2 + Math.floor(Math.random() * 4) },
        () => ({
          a: Math.random() * Math.PI * 2,
          len: 0.65 + Math.random() * 1.0,
          w: 0.05 + Math.random() * 0.09,
        }),
      ),
    }));

    const noise = getNoiseCanvas();

    const img = new Image();
    img.onload = () => {
      const start = Date.now();
      const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const iw = img.naturalWidth * scale;
      const ih = img.naturalHeight * scale;
      const ix = (W - iw) / 2;
      const iy = (H - ih) / 2;
      const noisePattern = ctx.createPattern(noise, "repeat")!;

      const frame = () => {
        const elapsed = (Date.now() - start) / 1000;
        ctx.clearRect(0, 0, W, H);

        // Step 1: Draw ink mask — blurry white blobs (main + satellites + tendrils).
        ctx.globalCompositeOperation = "source-over";
        ctx.filter = "blur(9px)";
        ctx.fillStyle = "white";
        ctx.strokeStyle = "white";
        let done = true;

        for (const s of splotches) {
          const t = Math.max(0, Math.min(1, (elapsed - s.delay) / s.dur));
          if (t < 1) done = false;
          const r = easeOutQuart(t) * s.maxR;
          if (r <= 0) continue;

          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();

          for (const sat of s.sats) {
            ctx.beginPath();
            ctx.arc(
              s.x + Math.cos(sat.a) * r * sat.d,
              s.y + Math.sin(sat.a) * r * sat.d,
              r * sat.r,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }

          for (const td of s.tendrils) {
            ctx.beginPath();
            ctx.moveTo(
              s.x + Math.cos(td.a) * r * 0.25,
              s.y + Math.sin(td.a) * r * 0.25,
            );
            ctx.lineTo(
              s.x + Math.cos(td.a) * r * td.len,
              s.y + Math.sin(td.a) * r * td.len,
            );
            ctx.lineWidth = r * td.w;
            ctx.stroke();
          }
        }
        ctx.filter = "none";

        // Step 2: Clip the actual image through the ink mask.
        ctx.globalCompositeOperation = "source-in";
        ctx.drawImage(img, ix, iy, iw, ih);

        // Step 3: Very subtle green cast — barely-there, just a whisper of colour.
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = "rgba(28, 62, 12, 0.10)";
        ctx.fillRect(0, 0, W, H);

        // Step 4: Paper grain over the revealed areas.
        ctx.globalCompositeOperation = "source-atop";
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = noisePattern;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;

        // Step 5: Dark vignette — edges choke to near-black for unease.
        ctx.globalCompositeOperation = "source-atop";
        const vg = ctx.createRadialGradient(
          W / 2,
          H / 2,
          H * 0.12,
          W / 2,
          H / 2,
          H * 0.88,
        );
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,6,0,0.62)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);

        if (!done) animRef.current = requestAnimationFrame(frame);
      };
      animRef.current = requestAnimationFrame(frame);
    };
    img.src = src;

    return () => cancelAnimationFrame(animRef.current);
  }, [src, visible]);

  return (
    <canvas
      ref={canvasRef}
      onClick={onClick}
      className={`absolute inset-0 z-[1] h-full w-full transition-opacity duration-300 ${
        onClick ? "cursor-pointer" : "pointer-events-none"
      } ${visible ? "opacity-100" : "opacity-0"}`}
    />
  );
}

export default function Home() {
  const [textInput, setTextInput] = useState("");
  const [showIntro, setShowIntro] = useState(true);
  const [showGameOver, setShowGameOver] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ---- Three.js scene ----
  const {
    containerRef,
    captureCanvas,
    cameraTargetRef,
    rotationTargetRef,
    frameCallbackRef,
    cameraPositionRef,
  } = useThreeScene();

  // ---- Image enhancer (hidden POV overlays) ----
  const {
    enhancedImageUrl,
    overlayVisible,
    isEnhancing,
    showHiddenPov,
    enhanceForLocation,
    dismissOverlay,
  } = useImageEnhancer(captureCanvas);

  // ---- Location navigation ----
  const { moveTo } = useLocationNav({
    cameraTargetRef,
    cameraPositionRef,
    rotationTargetRef,
    frameCallbackRef,
    onArrival: enhanceForLocation,
    onNavigate: dismissOverlay,
  });

  // ---- Game session ----
  // We need to define the `onMove` callback that moveTo's the camera.
  // We also need to generate hidden POV when a clue is revealed.
  const handleMove = useCallback(
    (locationId: string) => {
      // Always dismiss any existing overlay when moving to prevent wrong location images
      dismissOverlay();
      moveTo(locationId);
    },
    [moveTo, dismissOverlay],
  );

  // Track the current clue-reveal description so we can generate the image
  // after the camera arrives. We use a ref so the arrival callback reads the latest value.
  const pendingPovDescriptionRef = useRef<string | null>(null);
  const pendingPovLocationRef = useRef<string | null>(null);

  const handleClueRevealed = useCallback(
    (description: string) => {
      // Store description — we'll generate the image after a short delay
      // to let the camera settle at the new location
      pendingPovDescriptionRef.current = description;
      pendingPovLocationRef.current = description; // use description as cache key
      setTimeout(() => {
        const desc = pendingPovDescriptionRef.current;
        const key = pendingPovLocationRef.current;
        if (desc && key) {
          showHiddenPov(key, desc);
          pendingPovDescriptionRef.current = null;
          pendingPovLocationRef.current = null;
        }
      }, 2000); // wait 2s for camera to arrive
    },
    [showHiddenPov],
  );

  const handleGameOver = useCallback(() => {
    setShowGameOver(true);
  }, []);

  const {
    gameState,
    messages,
    isLoading,
    isGenerating,
    isRecording,
    isTranscribing,
    isSpeaking,
    error,
    sendMessage,
    startRecording,
    stopRecording,
    stopSpeaking,
    resetGame,
    generateNewGame,
    playIntro,
  } = useGameSession({
    onMove: handleMove,
    onClueRevealed: handleClueRevealed,
    onGameOver: handleGameOver,
  });

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Derive intro visibility from messages
  const shouldShowIntro = showIntro && messages.length === 0;

  // Handle text submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      sendMessage(textInput.trim());
      setTextInput("");
    }
  };

  // Handle voice button (press to start, release to stop)
  const handleVoiceDown = () => {
    startRecording();
  };
  const handleVoiceUp = () => {
    stopRecording();
  };

  const handleReset = async () => {
    setShowGameOver(false);
    setShowIntro(true);
    dismissOverlay();
    await resetGame();
  };

  // Status text for the badge
  const statusText = isRecording
    ? "🎙️ Recording..."
    : isTranscribing
      ? "📝 Transcribing..."
      : isLoading
        ? "🤔 Kyle is thinking..."
        : isSpeaking
          ? "🔊 Kyle is speaking..."
          : isEnhancing
            ? "🔍 Generating view..."
            : null;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Three.js canvas */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Enhanced image overlay */}
      {enhancedImageUrl && (
        <SplotchReveal
          src={enhancedImageUrl}
          visible={overlayVisible}
          onClick={dismissOverlay}
        />
      )}

      {/* Intro splash — Windows 98 style */}
      {shouldShowIntro && gameState && (
        <Win98Intro
          roomDescription={gameState.roomDescription}
          onStart={() => {
            setShowIntro(false);
            playIntro();
          }}
          onGenerate={generateNewGame}
          isGenerating={isGenerating}
        />
      )}

      {/* Game Over screen */}
      {showGameOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80">
          <div className="max-w-md rounded-xl border border-green-500/30 bg-black/90 p-8 text-center">
            <h1 className="mb-2 text-3xl font-bold text-green-400">
              🎉 ESCAPED!
            </h1>
            <p className="mb-6 text-sm text-white/70">
              Kyle made it out. You solved all the riddles.
            </p>
            <button
              onClick={handleReset}
              className="rounded-lg bg-green-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500"
            >
              Play Again
            </button>
          </div>
        </div>
      )}

      {/* HUD: top-left game info */}
      {gameState && !shouldShowIntro && (
        <div className="absolute left-3 top-3 z-10 rounded-lg bg-black/70 px-3 py-2 text-xs text-white/70 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <span>
              🧩 {gameState.riddlesSolved}/{gameState.totalRiddles}
            </span>
            <span>📍 {gameState.currentLocation.replace(/_/g, " ")}</span>
            <button
              onClick={handleReset}
              disabled={isLoading}
              className="ml-1 rounded px-1.5 py-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/70 disabled:opacity-30"
              title="Reset game"
            >
              ↺
            </button>
          </div>
        </div>
      )}

      {/* Status badge */}
      {statusText && !shouldShowIntro && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs text-white/80 backdrop-blur-sm">
          {statusText}
        </div>
      )}

      {/* Error badge */}
      {error && !shouldShowIntro && (
        <div className="absolute right-3 top-3 z-10 rounded-lg bg-red-900/80 px-3 py-2 text-xs text-red-200 backdrop-blur-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Chat panel + input */}
      {!shouldShowIntro && (
        <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col">
          {/* Chat messages */}
          <div className="mx-auto w-full max-w-2xl">
            <div className="max-h-[40vh] overflow-y-auto px-4 pb-2 scrollbar-thin">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`mb-2 flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-blue-600/80 text-white"
                        : "bg-white/10 text-white/90 backdrop-blur-sm"
                    }`}
                  >
                    {msg.role === "assistant" && (
                      <span className="mr-1 text-xs font-semibold text-red-400">
                        Kyle:
                      </span>
                    )}
                    {msg.content}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Input bar */}
          <div className="bg-black/80 px-4 py-3 backdrop-blur-md">
            <div className="mx-auto flex max-w-2xl items-center gap-2">
              {/* Voice button */}
              <button
                onMouseDown={handleVoiceDown}
                onMouseUp={handleVoiceUp}
                onTouchStart={handleVoiceDown}
                onTouchEnd={handleVoiceUp}
                disabled={isLoading || isTranscribing}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg transition-colors ${
                  isRecording
                    ? "animate-pulse bg-red-600 text-white"
                    : "bg-white/10 text-white/60 hover:bg-white/20"
                } disabled:opacity-40`}
                title="Hold to speak"
              >
                🎤
              </button>

              {/* Text input */}
              <form onSubmit={handleSubmit} className="flex flex-1 gap-2">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Tell Kyle what to do..."
                  disabled={isLoading || isRecording || isTranscribing}
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/30 disabled:opacity-40"
                />
                <button
                  type="submit"
                  disabled={
                    isLoading ||
                    !textInput.trim() ||
                    isRecording ||
                    isTranscribing
                  }
                  className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/20 disabled:opacity-40"
                >
                  Send
                </button>
              </form>

              {/* Stop speaking button */}
              {isSpeaking && (
                <button
                  onClick={stopSpeaking}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg text-white/60 transition-colors hover:bg-white/20"
                  title="Stop speaking"
                >
                  ⏹️
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

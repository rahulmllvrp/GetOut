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
    dismissOverlay,
  } = useImageEnhancer(captureCanvas);

  // ---- Location navigation ----
  const { moveTo } = useLocationNav({
    cameraTargetRef,
    cameraPositionRef,
    rotationTargetRef,
    frameCallbackRef,
    onArrival: () => {}, // arrival is handled by game session now
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
    isRecording,
    isTranscribing,
    isSpeaking,
    error,
    sendMessage,
    startRecording,
    stopRecording,
    stopSpeaking,
    resetGame,
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
    dismissOverlay();
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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={enhancedImageUrl}
          alt="Hidden POV"
          onClick={dismissOverlay}
          className={`absolute inset-0 z-1 h-full w-full cursor-pointer object-cover transition-opacity duration-500 ${
            overlayVisible ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {/* Intro splash */}
      {shouldShowIntro && gameState && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80">
          <div className="max-w-lg rounded-xl border border-white/10 bg-black/90 p-8 text-center">
            <h1 className="mb-2 text-3xl font-bold text-red-500">GET OUT</h1>
            <p className="mb-4 text-sm text-white/60">An AI Escape Room</p>
            <p className="mb-6 text-sm leading-relaxed text-white/80">
              {gameState.roomDescription}
            </p>
            <p className="mb-6 text-xs text-white/50">
              Kyle is trapped in this room. Talk to him — help him escape.
            </p>
            <button
              onClick={() => setShowIntro(false)}
              className="rounded-lg bg-red-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
            >
              Start
            </button>
          </div>
        </div>
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

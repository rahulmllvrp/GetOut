"use client";

/**
 * useGameSession
 *
 * Core game orchestration hook. Manages:
 *   - Game state (loaded from /api/game/init)
 *   - Player messages (text + voice)
 *   - Mistral chat calls (via /api/game/chat)
 *   - Voice recording (browser MediaRecorder → /api/game/stt)
 *   - TTS playback (/api/game/tts → Audio element)
 *
 * Exposes everything the UI needs to render the game and a moveTo
 * callback so the 3D scene can animate Kyle's movement on each turn.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types (mirror server-side ClientGameState / ChatResponse)
// ---------------------------------------------------------------------------

export type ClientGameState = {
  roomDescription: string;
  winCondition: string;
  currentLocation: string;
  visitHistory: string[];
  riddlesSolved: number;
  totalRiddles: number;
  gameOver: boolean;
  allLocationIds: string[];
  gameTreeLocationIds: string[];
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
};

export type ChatResponse = {
  kyle_response: string;
  did_move: boolean;
  move_to: string | null;
  clue_revealed: boolean;
  riddle_solved: boolean;
  game_over: boolean;
  current_location: string;
  riddles_solved: number;
  total_riddles: number;
  hidden_pov_description: string | null;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseGameSessionOptions {
  /** Called when Kyle moves — drives the 3D camera. */
  onMove?: (locationId: string) => void;
  /** Called when a clue is revealed — show hidden POV overlay. */
  onClueRevealed?: (description: string) => void;
  /** Called when the game ends. */
  onGameOver?: () => void;
}

export function useGameSession(options: UseGameSessionOptions = {}) {
  const { onMove, onClueRevealed, onGameOver } = options;

  // ---- Game state ----
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastResponse, setLastResponse] = useState<ChatResponse | null>(null);

  // ---- Loading / status flags ----
  const [isLoading, setIsLoading] = useState(false); // waiting for Mistral
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Refs for voice recording ----
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Keep latest callbacks in refs to avoid stale closures
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onClueRevealedRef = useRef(onClueRevealed);
  onClueRevealedRef.current = onClueRevealed;
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  // ------------------------------------------------------------------
  // Init game
  // ------------------------------------------------------------------

  const initGame = useCallback(async (reset = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Init failed");
      }
      const data: ClientGameState = await res.json();
      setGameState(data);
      setMessages(data.conversationHistory);
      setLastResponse(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load game on mount
  useEffect(() => {
    initGame();
  }, [initGame]);

  // ------------------------------------------------------------------
  // Send text message to Game Master
  // ------------------------------------------------------------------

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      // Optimistically add user message to chat
      const userMsg: ChatMessage = { role: "user", content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/game/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text.trim() }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Chat failed");
        }
        const data: ChatResponse = await res.json();
        setLastResponse(data);

        // Add Kyle's response to chat
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: data.kyle_response,
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // Update local game state
        setGameState((prev) =>
          prev
            ? {
                ...prev,
                currentLocation: data.current_location,
                riddlesSolved: data.riddles_solved,
                totalRiddles: data.total_riddles,
                gameOver: data.game_over,
                visitHistory:
                  data.did_move && data.move_to
                    ? prev.visitHistory.includes(data.move_to)
                      ? prev.visitHistory
                      : [...prev.visitHistory, data.move_to]
                    : prev.visitHistory,
              }
            : prev,
        );

        // Fire callbacks
        if (data.did_move && data.move_to) {
          onMoveRef.current?.(data.move_to);
        }
        if (data.clue_revealed && data.hidden_pov_description) {
          onClueRevealedRef.current?.(data.hidden_pov_description);
        }
        if (data.game_over) {
          onGameOverRef.current?.();
        }

        // Play Kyle's voice
        await playTTS(data.kyle_response);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLoading],
  );

  // ------------------------------------------------------------------
  // TTS playback
  // ------------------------------------------------------------------

  const playTTS = useCallback(async (text: string) => {
    setIsSpeaking(true);
    try {
      const res = await fetch("/api/game/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        console.error("[TTS] failed:", res.statusText);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioElementRef.current = audio;

      await new Promise<void>((resolve) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.play().catch(() => resolve());
      });
    } catch (e) {
      console.error("[TTS] error:", e);
    } finally {
      setIsSpeaking(false);
    }
  }, []);

  // ------------------------------------------------------------------
  // Stop TTS playback
  // ------------------------------------------------------------------

  const stopSpeaking = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
      setIsSpeaking(false);
    }
  }, []);

  // ------------------------------------------------------------------
  // Voice recording (browser MediaRecorder)
  // ------------------------------------------------------------------

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (e) {
      console.error("[Recording] error:", e);
      setError("Microphone access denied");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        setIsRecording(false);

        // Stop all tracks to release the microphone
        recorder.stream.getTracks().forEach((t) => t.stop());

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType,
        });
        audioChunksRef.current = [];

        // Transcribe
        setIsTranscribing(true);
        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");

          const res = await fetch("/api/game/stt", {
            method: "POST",
            body: formData,
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error ?? "STT failed");
          }
          const { text } = await res.json();
          if (text) {
            await sendMessage(text);
          }
        } catch (e: unknown) {
          console.error("[STT] error:", e);
          setError(e instanceof Error ? e.message : "STT failed");
        } finally {
          setIsTranscribing(false);
        }
        resolve();
      };

      recorder.stop();
    });
  }, [sendMessage]);

  // ------------------------------------------------------------------
  // Reset game
  // ------------------------------------------------------------------

  const resetGame = useCallback(async () => {
    stopSpeaking();
    setMessages([]);
    setLastResponse(null);
    await initGame(true);
  }, [initGame, stopSpeaking]);

  return {
    // State
    gameState,
    messages,
    lastResponse,

    // Status
    isLoading,
    isRecording,
    isTranscribing,
    isSpeaking,
    error,

    // Actions
    sendMessage,
    startRecording,
    stopRecording,
    stopSpeaking,
    resetGame,
    initGame,
  };
}

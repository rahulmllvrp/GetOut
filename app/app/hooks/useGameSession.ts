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

export type GameMode = "normal" | "brainrot" | "nsfw";

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
// Kyle intro lines per game mode (hardcoded — warms up TTS route on game start)
// ---------------------------------------------------------------------------

const KYLE_INTROS: Record<GameMode, string> = {
  normal:
    "Hello? Can anyone hear me? I... I think I'm locked in some kind of room. " +
    "It's dark in here, smells like stale coffee and there's this weird ticking sound. " +
    "Please, if you can hear me, what do i do!",

  brainrot:
    "Yo? Yoooo? Can anyone hear me fr fr? I'm lowkey locked in some room and it's giving " +
    "straight-up ohio energy no cap. It's mad dark in here, smells like expired sigma grindset, " +
    "and there's this sus ticking sound that's NOT bussin. Bruh I'm cooked. " +
    "Please, if you got any rizz at all, tell me what to do ong!",

  nsfw:
    "Hello?! Can anyone fucking hear me?! I... I think I'm locked in some shithole of a room. " +
    "It's dark as hell in here, smells like ass and stale coffee, and there's this goddamn ticking sound " +
    "that's driving me absolutely batshit. I swear this place looks like where bad decisions go to die. " +
    "Please, if you can hear me, tell me what the fuck to do!",
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseGameSessionOptions {
  /** Called when Kyle moves — drives the 3D camera. */
  onMove?: (locationId: string) => void;
  /** Called when a clue is revealed — show hidden POV overlay. */
  onClueRevealed?: (description: string, locationKey: string) => void;
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
  const [isGenerating, setIsGenerating] = useState(false); // generating new game
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Refs for voice recording ----
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const fillerAudioRef = useRef<HTMLAudioElement | null>(null);

  // ---- Filler audio (pre-recorded static files in /public/fillers/) ----
  const FILLER_COUNT = 5;

  const fillerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playFiller = useCallback(() => {
    fillerTimeoutRef.current = setTimeout(() => {
      const index = Math.floor(Math.random() * FILLER_COUNT);
      const audio = new Audio(`/fillers/filler_${index}.mp3`);
      fillerAudioRef.current = audio;
      audio.play().catch(() => {});
      fillerTimeoutRef.current = null;
    }, 500);
  }, []);

  const stopFiller = useCallback(() => {
    if (fillerTimeoutRef.current) {
      clearTimeout(fillerTimeoutRef.current);
      fillerTimeoutRef.current = null;
    }
    if (fillerAudioRef.current) {
      fillerAudioRef.current.pause();
      fillerAudioRef.current = null;
    }
  }, []);

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

  const initGame = useCallback(async (reset = false, mode?: GameMode) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/game/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset, mode }),
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

      const timing: Record<string, number> = {};

      try {
        const t0 = performance.now();
        const res = await fetch("/api/game/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text.trim() }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Chat failed");
        }
        timing.chat = Math.round(performance.now() - t0);
        // Extract server-side timing from header
        const serverTiming = res.headers.get("Server-Timing");
        if (serverTiming) {
          const match = serverTiming.match(/dur=(\d+)/);
          if (match) timing.chat_server = Number(match[1]);
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
            : prev
        );

        // Fire callbacks
        if (data.did_move && data.move_to) {
          onMoveRef.current?.(data.move_to);
        }
        if (data.clue_revealed && data.hidden_pov_description) {
          onClueRevealedRef.current?.(data.hidden_pov_description, data.current_location);
        }
        if (data.game_over) {
          onGameOverRef.current?.();
        }

        // Play Kyle's voice
        const ttsTimings = await playTTS(data.kyle_response);
        timing.tts_fetch = ttsTimings.fetch;
        timing.tts_playback = ttsTimings.playback;

        // Log timing breakdown
        console.table(timing);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLoading]
  );

  // ------------------------------------------------------------------
  // TTS playback
  // ------------------------------------------------------------------

  const playTTS = useCallback(
    async (text: string): Promise<{ fetch: number; playback: number }> => {
      // Stop any filler audio before playing the real response
      stopFiller();
      setIsSpeaking(true);
      try {
        const t0 = performance.now();
        const res = await fetch("/api/game/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          console.error("[TTS] failed:", res.statusText);
          return { fetch: Math.round(performance.now() - t0), playback: 0 };
        }
        const blob = await res.blob();
        const fetchMs = Math.round(performance.now() - t0);

        // Log server-side timing if available
        const serverTiming = res.headers.get("Server-Timing");
        if (serverTiming) {
          const match = serverTiming.match(/dur=(\d+)/);
          if (match)
            console.log(
              `[TTS] server: ${match[1]}ms, fetch round-trip: ${fetchMs}ms`
            );
        }

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioElementRef.current = audio;

        const t1 = performance.now();
        await new Promise<void>((resolve) => {
          audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onpause = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.play().catch(() => resolve());
        });
        const playbackMs = Math.round(performance.now() - t1);

        return { fetch: fetchMs, playback: playbackMs };
      } catch (e) {
        console.error("[TTS] error:", e);
        return { fetch: 0, playback: 0 };
      } finally {
        setIsSpeaking(false);
      }
    },
    [stopFiller]
  );

  // ------------------------------------------------------------------
  // Play Kyle's intro line (must be called from a user gesture)
  // ------------------------------------------------------------------

  const playIntro = useCallback(
    (mode: GameMode = "normal") => {
      playTTS(KYLE_INTROS[mode]);
    },
    [playTTS]
  );

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
    // Stop Kyle if he's still talking — player is interrupting
    stopSpeaking();
    stopFiller();

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
  }, [stopSpeaking, stopFiller]);

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

        // Play a filler line while we wait for STT → chat → TTS
        playFiller();

        // Transcribe
        setIsTranscribing(true);
        const timing: Record<string, number> = {};
        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");

          const t0 = performance.now();
          const res = await fetch("/api/game/stt", {
            method: "POST",
            body: formData,
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error ?? "STT failed");
          }
          timing.stt = Math.round(performance.now() - t0);
          // Extract server-side timing from header
          const serverTiming = res.headers.get("Server-Timing");
          if (serverTiming) {
            const match = serverTiming.match(/dur=(\d+)/);
            if (match) timing.stt_server = Number(match[1]);
          }

          const { text } = await res.json();
          if (text) {
            console.log(
              `[STT] "${text}" (${timing.stt}ms, server: ${
                timing.stt_server ?? "?"
              }ms)`
            );
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
  }, [sendMessage, playFiller]);

  // ------------------------------------------------------------------
  // Generate a brand-new game (calls Mistral to create new puzzles)
  // ------------------------------------------------------------------

  const generateNewGame = useCallback(
    async (mode?: GameMode) => {
      stopSpeaking();
      setIsGenerating(true);
      setError(null);
      setMessages([]);
      setLastResponse(null);
      try {
        const res = await fetch("/api/game/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Game generation failed");
        }
        const data: ClientGameState = await res.json();
        setGameState(data);
        setMessages(data.conversationHistory);
        setLastResponse(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsGenerating(false);
      }
    },
    [stopSpeaking]
  );

  // ------------------------------------------------------------------
  // Reset game
  // ------------------------------------------------------------------

  const resetGame = useCallback(
    async (mode?: GameMode) => {
      stopSpeaking();
      setMessages([]);
      setLastResponse(null);
      await initGame(true, mode);
    },
    [initGame, stopSpeaking]
  );

  return {
    // State
    gameState,
    messages,
    lastResponse,

    // Status
    isLoading,
    isGenerating,
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
    generateNewGame,
    playIntro,
    initGame,
  };
}

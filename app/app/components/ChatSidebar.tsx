"use client";

import { useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  messages: Message[];
  textInput: string;
  setTextInput: (value: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  isSpeaking: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  stopSpeaking: () => void;
}

export function ChatSidebar({
  isOpen,
  onClose,
  messages,
  textInput,
  setTextInput,
  handleSubmit,
  isLoading,
  isRecording,
  isTranscribing,
  isSpeaking,
  startRecording,
  stopRecording,
  stopSpeaking,
}: ChatSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close sidebar on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-10" onClick={onClose}></div>}
      <div
        ref={sidebarRef}
        className={`fixed top-0 right-0 h-full bg-black/80 backdrop-blur-md z-20 w-full max-w-md transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-white/10 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Chat</h2>
            <button onClick={onClose} className="text-white/60 hover:text-white">&times;</button>
          </div>

          {/* Chat messages */}
          <div className="flex-grow overflow-y-auto p-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`mb-3 flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-white/10 text-white/90"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <span className="mr-1.5 text-xs font-semibold text-red-400">
                      Kyle:
                    </span>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div className="flex-shrink-0 p-4 border-t border-white/10">
            <div className="flex items-center gap-2">
              {/* Voice button */}
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
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
      </div>
    </>
  );
}

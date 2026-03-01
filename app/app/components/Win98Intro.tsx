"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

// ─── Win98 style primitives ───────────────────────────────────────────────────

const WIN_BG = "#d4d0c8";
const WIN_FONT: CSSProperties = {
  fontFamily: '"MS Sans Serif", "Pixelated MS Sans Serif", Arial, sans-serif',
  fontSize: "11px",
};

const raised: CSSProperties = {
  border: "2px solid",
  borderColor: "#ffffff #808080 #808080 #ffffff",
  boxShadow: "inset 1px 1px 0 #dfdfdf, inset -1px -1px 0 #404040",
};

const sunken: CSSProperties = {
  border: "2px solid",
  borderColor: "#808080 #ffffff #ffffff #808080",
  boxShadow: "inset 1px 1px 0 #404040, inset -1px -1px 0 #dfdfdf",
};

const btn: CSSProperties = {
  ...WIN_FONT,
  background: WIN_BG,
  ...raised,
  padding: "4px 18px",
  minWidth: "90px",
  cursor: "pointer",
  outline: "none",
  textAlign: "center",
  userSelect: "none",
  color: "#000",
};

// ─── Desktop icon ─────────────────────────────────────────────────────────────

function DesktopIcon({ emoji, label }: { emoji: string; label: string }) {
  const [selected, setSelected] = useState(false);
  return (
    <div
      onClick={() => setSelected((s) => !s)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        width: "64px",
        cursor: "default",
        userSelect: "none",
        padding: "4px",
      }}
    >
      <span style={{ fontSize: "32px" }}>{emoji}</span>
      <span
        style={{
          ...WIN_FONT,
          color: "#fff",
          textAlign: "center",
          background: selected ? "#000080" : "rgba(0,0,0,0.35)",
          padding: "1px 3px",
          lineHeight: "1.3",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Flashing danger alert ────────────────────────────────────────────────────

function DangerAlert() {
  const [lit, setLit] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setLit((v) => !v), 550);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      style={{
        background: lit ? "#cc0000" : "#8b0000",
        color: "#ffffff",
        fontWeight: "bold",
        fontSize: "12px",
        fontFamily: '"MS Sans Serif", Arial, sans-serif',
        padding: "7px 12px",
        letterSpacing: "0.05em",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        userSelect: "none",
        transition: "background 0.1s",
      }}
    >
      <span style={{ fontSize: "14px" }}>⚠</span>
      GET OUT NOW
      <span style={{ fontSize: "14px", marginLeft: "auto" }}>⚠</span>
    </div>
  );
}

// ─── Live clock ───────────────────────────────────────────────────────────────

function Clock() {
  const [t, setT] = useState("");
  useEffect(() => {
    const tick = () =>
      setT(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <>{t}</>;
}

// ─── Win98 progress bar ───────────────────────────────────────────────────────

function Win98ProgressBar({ label }: { label: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Simulated progress: fast start, slows in the middle, never reaches 100
    // (the component unmounts when generation completes)
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p < 30) return p + 2.5;
        if (p < 60) return p + 1.2;
        if (p < 85) return p + 0.4;
        if (p < 95) return p + 0.1;
        return p;
      });
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const blocks = Math.floor(progress / 5); // 20 blocks total at 100%

  return (
    <div style={{ width: "100%" }}>
      <p
        style={{
          ...WIN_FONT,
          color: "#000",
          marginBottom: "6px",
          fontSize: "11px",
        }}
      >
        {label}
      </p>
      <div
        style={{
          ...sunken,
          background: "#ffffff",
          padding: "3px",
          height: "22px",
          position: "relative",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background:
              "repeating-linear-gradient(90deg, #000080 0px, #000080 8px, #ffffff 8px, #ffffff 10px)",
            transition: "width 0.2s linear",
          }}
        />
      </div>
      <p
        style={{
          ...WIN_FONT,
          color: "#555",
          marginTop: "4px",
          fontSize: "11px",
          textAlign: "center",
        }}
      >
        {Math.round(progress)}% — Generating escape room with AI...
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Win98IntroProps {
  roomDescription: string;
  onStart: () => void;
  onGenerate?: () => void;
  isGenerating?: boolean;
}

export function Win98Intro({
  roomDescription,
  onStart,
  onGenerate,
  isGenerating,
}: Win98IntroProps) {
  const chromBtn: CSSProperties = {
    background: WIN_BG,
    border: "1.5px solid",
    borderColor: "#ffffff #404040 #404040 #ffffff",
    width: "16px",
    height: "14px",
    fontSize: "8px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    color: "#000",
    fontFamily: "Arial, sans-serif",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        background: "#008080",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        ...WIN_FONT,
        paddingBottom: "28px",
      }}
    >
      {/* Massive background title — sits behind the window */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          userSelect: "none",
          zIndex: 0,
        }}
      >
        <span
          style={{
            fontFamily: "Impact, 'Arial Narrow', Arial, sans-serif",
            fontSize: "clamp(10rem, 30vw, 32rem)",
            fontWeight: "900",
            color: "rgba(0, 0, 0, 0.55)",
            letterSpacing: "-0.02em",
            lineHeight: 1,
            textTransform: "uppercase",
          }}
        >
          GET OUT
        </span>
      </div>

      {/* Desktop icons — left side */}
      <div
        style={{
          position: "fixed",
          top: "12px",
          left: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <DesktopIcon emoji="🚪" label="Room_Escape" />
        <DesktopIcon emoji="💀" label="GETOUT.EXE" />
        <DesktopIcon emoji="🗑️" label="Recycle Bin" />
      </div>

      {/* Window — sits in front of the background text */}
      <div
        style={{
          position: "relative",
          zIndex: 5,
          background: WIN_BG,
          border: "2px solid",
          borderColor: "#ffffff #808080 #808080 #ffffff",
          boxShadow: "3px 3px 0 #404040",
          width: "460px",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            background: "linear-gradient(to right, #000080, #1084d0)",
            color: "#fff",
            padding: "3px 4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontWeight: "bold",
            fontSize: "11px",
            fontFamily: '"MS Sans Serif", Arial, sans-serif',
            userSelect: "none",
            gap: "6px",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ fontSize: "13px" }}>💀</span>
            GETOUT.EXE — Escape Room v1.0
          </span>
          <div style={{ display: "flex", gap: "2px" }}>
            <button style={chromBtn}>─</button>
            <button style={chromBtn}>□</button>
            <button style={chromBtn}>✕</button>
          </div>
        </div>

        {/* Menu bar */}
        <div style={{ display: "flex", borderBottom: "1px solid #808080" }}>
          {["File", "Edit", "View", "Help"].map((item) => (
            <button
              key={item}
              style={{
                ...WIN_FONT,
                background: "transparent",
                border: "none",
                padding: "2px 8px",
                cursor: "pointer",
                outline: "none",
                color: "#000",
              }}
            >
              {item}
            </button>
          ))}
        </div>

        {/* Flashing danger banner */}
        <DangerAlert />

        {/* Body */}
        <div style={{ padding: "16px 16px 12px" }}>
          {/* Room description in sunken white box */}
          <div
            style={{
              ...sunken,
              background: "#ffffff",
              padding: "12px 14px",
              marginBottom: "14px",
              lineHeight: "1.75",
              color: "#000",
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            <p
              style={{
                fontWeight: "bold",
                marginBottom: "8px",
                fontSize: "12px",
              }}
            >
              ⚠&nbsp; SYSTEM ALERT — Civilian in danger
            </p>
            <p style={{ marginBottom: "8px" }}>{roomDescription}</p>
            <p style={{ color: "#555" }}>
              Kyle is trapped. Talk to him — help him escape.
            </p>
          </div>

          {/* Divider */}
          <div
            style={{
              borderTop: "1px solid #808080",
              borderBottom: "1px solid #fff",
              margin: "0 0 12px",
            }}
          />

          {/* Progress bar (shown during generation) */}
          {isGenerating && (
            <div style={{ marginBottom: "12px" }}>
              <Win98ProgressBar label="Contacting Game Master..." />
            </div>
          )}

          {/* Buttons */}
          <div
            style={{ display: "flex", justifyContent: "center", gap: "8px" }}
          >
            <button
              onClick={onStart}
              disabled={isGenerating}
              style={{
                ...btn,
                fontWeight: "bold",
                outline: "1px solid #000",
                outlineOffset: "-4px",
                opacity: isGenerating ? 0.5 : 1,
                cursor: isGenerating ? "wait" : "pointer",
              }}
            >
              Begin Rescue
            </button>
            {onGenerate && (
              <button
                onClick={onGenerate}
                disabled={isGenerating}
                style={{
                  ...btn,
                  opacity: isGenerating ? 0.5 : 1,
                  cursor: isGenerating ? "wait" : "pointer",
                }}
              >
                {isGenerating ? "Generating..." : "Generate New Game"}
              </button>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div
          style={{
            borderTop: "1px solid #808080",
            display: "flex",
            padding: "2px 4px",
            gap: "2px",
          }}
        >
          <div style={{ ...sunken, padding: "1px 6px", flex: 1 }}>
            Kyle Status: TRAPPED
          </div>
          <div
            style={{
              ...sunken,
              padding: "1px 6px",
              width: "50px",
              textAlign: "center",
            }}
          >
            v1.0
          </div>
        </div>
      </div>

      {/* Taskbar */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "28px",
          background: WIN_BG,
          borderTop: "2px solid #ffffff",
          boxShadow: "0 -1px 0 #808080",
          display: "flex",
          alignItems: "center",
          padding: "2px",
          gap: "4px",
          zIndex: 100,
        }}
      >
        <button
          style={{
            ...WIN_FONT,
            background: WIN_BG,
            ...raised,
            padding: "1px 8px",
            fontWeight: "bold",
            height: "22px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            outline: "none",
            color: "#000",
          }}
        >
          <span style={{ fontSize: "13px" }}>⊞</span> Start
        </button>
        <div
          style={{
            width: "1px",
            height: "22px",
            borderLeft: "1px solid #808080",
            borderRight: "1px solid #ffffff",
            margin: "0 2px",
          }}
        />
        <div
          style={{
            ...WIN_FONT,
            background: WIN_BG,
            ...sunken,
            padding: "1px 10px",
            height: "22px",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            color: "#000",
          }}
        >
          <span>💀</span> GETOUT.EXE
        </div>
        <div
          style={{
            ...WIN_FONT,
            marginLeft: "auto",
            ...sunken,
            padding: "2px 10px",
            height: "22px",
            display: "flex",
            alignItems: "center",
            color: "#000",
          }}
        >
          <Clock />
        </div>
      </div>
    </div>
  );
}

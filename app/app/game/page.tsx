"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black flex flex-col items-center justify-center select-none">

      {/* Film grain */}
      <div className="grain-overlay" aria-hidden="true" />

      {/* CRT scanlines */}
      <div className="scanlines-overlay" aria-hidden="true" />

      {/* Radial vignette — darkens the edges */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.75) 100%)",
        }}
        aria-hidden="true"
      />

      {/* Ambient red glow behind the title */}
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0"
        style={{
          width: "70vw",
          height: "50vh",
          background:
            "radial-gradient(ellipse at center, rgba(120, 0, 0, 0.18) 0%, transparent 70%)",
          filter: "blur(48px)",
        }}
        aria-hidden="true"
      />

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="relative z-20 flex flex-col items-center text-center px-6">

        {/* Classification badge */}
        <p
          className="font-mono text-red-950 text-xs tracking-[0.6em] uppercase"
          style={{ animation: "fade-in-up 0.8s ease 0.15s both" }}
        >
          INCIDENT REPORT ████&nbsp;&nbsp;·&nbsp;&nbsp;RESTRICTED ACCESS
        </p>

        {/* Title */}
        <h1
          className="font-mono font-black text-white leading-none uppercase mt-4"
          style={{
            fontSize: "clamp(5.5rem, 19vw, 21rem)",
            letterSpacing: "-0.03em",
            animation:
              "fade-in-up 1s ease 0.5s both, flicker 9s ease-in-out 4s infinite, glitch 7s ease-in-out 5s infinite",
          }}
        >
          GET OUT
        </h1>

        {/* Hairline separator */}
        <div
          className="w-48 h-px mt-5"
          style={{
            background:
              "linear-gradient(to right, transparent, rgba(153,27,27,0.8), transparent)",
            animation: "fade-in-up 0.8s ease 0.9s both",
          }}
        />

        {/* Tagline */}
        <p
          className="font-mono text-red-700 text-xs md:text-sm tracking-[0.45em] uppercase mt-5"
          style={{ animation: "fade-in-up 0.8s ease 1.1s both" }}
        >
          No story.&nbsp;&nbsp;No plot armour.&nbsp;&nbsp;No guarantee.
        </p>

        {/* Description */}
        <div
          className="mt-6 font-mono text-zinc-600 text-sm leading-loose space-y-0.5"
          style={{ animation: "fade-in-up 0.8s ease 1.4s both" }}
        >
          <p>Kyle is trapped inside. You are his only hope.</p>
          <p>Speak. He listens. Guide him to safety.</p>
          <p>Every choice reshapes the world. Every playthrough is different.</p>
        </div>

        {/* CTA button */}
        <Link href="/" className="mt-10">
          <button
            className="font-mono text-xs tracking-[0.5em] uppercase border border-red-900 text-red-600 px-14 py-4 transition-all duration-500 hover:bg-red-950/60 hover:text-white hover:border-red-700 hover:tracking-[0.6em] active:scale-95"
            style={{
              animation:
                "fade-in-up 0.8s ease 1.8s both, pulse-glow 3s ease-in-out 2.8s infinite",
            }}
          >
            ENTER THE ROOM &rarr;
          </button>
        </Link>

        {/* Footer */}
        <p
          className="mt-10 font-mono text-zinc-800 text-xs tracking-widest uppercase"
          style={{ animation: "fade-in-up 0.8s ease 2.2s both" }}
        >
          ⚠&nbsp;&nbsp;No known survivors have been documented
        </p>
      </div>
    </main>
  );
}

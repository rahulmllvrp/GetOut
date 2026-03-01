"use client";

/**
 * useImageEnhancer
 *
 * Manages the full lifecycle of capturing, enhancing, and displaying an
 * AI-generated overlay image when the player arrives at a location.
 *
 * Cache layers (checked in order):
 *   1. In-memory (useRef Map)  — instant, lives for the session.
 *   2. Disk (public/enhanced-cache/{key}.png) — survives server restarts.
 *   3. Gemini API — called only on a full cache miss.
 *
 * Flow on first visit to a location:
 *   1. captureCanvas() grabs a PNG of the current Three.js frame.
 *   2. The PNG is POSTed to /api/enhance-image (which calls the Gemini API).
 *   3. The server writes the result to public/enhanced-cache/{key}.png.
 *   4. The returned enhanced image URL is stored in the in-memory cache.
 *   5. The overlay fades in over the 3D scene.
 *
 * Flow on repeat visits (same session):
 *   - In-memory cache hit → overlay shows immediately, no network call.
 *
 * Flow on repeat visits (after restart):
 *   - HEAD /enhanced-cache/{key}.png returns 200 → use the static file URL,
 *     populate in-memory cache, show overlay. No Gemini call.
 *
 * Dismissal:
 *   - dismissOverlay() starts a CSS opacity transition to 0, then clears the
 *     image URL after 500 ms so the <img> is removed from the DOM once hidden.
 */

import { useRef, useState } from "react";

export function useImageEnhancer(captureCanvas: () => string) {
  // Whether the Gemini API call is in flight. Drives the "Enhancing..." badge.
  const [isEnhancing, setIsEnhancing] = useState(false);

  // The data URL (or static path) of the enhanced image, or null when no overlay is active.
  const [enhancedImageUrl, setEnhancedImageUrl] = useState<string | null>(null);

  // Controls the CSS opacity transition. Separated from enhancedImageUrl so we
  // can trigger the fade-out before clearing the URL (gives the animation time
  // to finish before the <img> is unmounted).
  const [overlayVisible, setOverlayVisible] = useState(false);

  // Per-location cache: locationKey → enhanced image URL (data URL or static path).
  // Stored in a ref so it persists across renders without triggering re-renders.
  const imageCache = useRef<Map<string, string>>(new Map());

  // Ref mirror of isEnhancing — lets the async function check for in-flight
  // requests without stale closure issues (state reads inside async fns can be
  // stale; refs are always current).
  const isEnhancingRef = useRef(false);

  // Start the overlay fade-out, then remove the image from the DOM after the
  // CSS transition (500 ms) completes.
  const dismissOverlay = () => {
    setOverlayVisible(false);
    setTimeout(() => setEnhancedImageUrl(null), 500);
  };

  const showImage = (url: string) => {
    setEnhancedImageUrl(url);
    // requestAnimationFrame defers the opacity change by one paint cycle,
    // which is required for the CSS transition to fire (the element must be
    // rendered at opacity-0 before we flip to opacity-100).
    requestAnimationFrame(() => setOverlayVisible(true));
  };

  // Called when the camera arrives at a location (via useLocationNav's onArrival).
  // locationKey matches the keys in locations.json (e.g. "kitchen", "hallway").
  const enhanceForLocation = async (locationKey: string) => {
    // Don't stack multiple enhancement calls.
    if (isEnhancingRef.current) return;

    // L1 — In-memory cache: show immediately, no network call.
    if (imageCache.current.has(locationKey)) {
      showImage(imageCache.current.get(locationKey)!);
      return;
    }

    // L2 — Disk cache: check if the file was saved from a previous session.
    const diskUrl = `/enhanced-cache/${locationKey}.png`;
    const diskCheck = await fetch(diskUrl, { method: "HEAD" });
    if (diskCheck.ok) {
      imageCache.current.set(locationKey, diskUrl);
      showImage(diskUrl);
      return;
    }

    // L3 — Full miss: capture the frame, call Gemini, persist to disk.
    const dataUrl = captureCanvas();
    if (!dataUrl) return;

    isEnhancingRef.current = true;
    setIsEnhancing(true);
    try {
      const res = await fetch("/api/enhance-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl, locationKey }),
      });
      const { imageDataUrl } = await res.json();
      imageCache.current.set(locationKey, imageDataUrl);
      showImage(imageDataUrl);
    } finally {
      // Always clear the in-flight flag, even if the request failed.
      isEnhancingRef.current = false;
      setIsEnhancing(false);
    }
  };

  return {
    enhancedImageUrl,   // URL to pass to <img src>, or null
    overlayVisible,     // drives the opacity class (true = opacity-100)
    isEnhancing,        // true while the API call is in flight
    enhanceForLocation, // call with a location key to trigger the flow
    dismissOverlay,     // fade out and remove the overlay
  };
}

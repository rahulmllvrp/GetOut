"use client";

/**
 * useImageEnhancer
 *
 * Manages the full lifecycle of capturing, enhancing, and displaying an
 * AI-generated overlay image when the player arrives at a location.
 *
 * Flow on first visit to a location:
 *   1. captureCanvas() grabs a PNG of the current Three.js frame.
 *   2. The PNG is POSTed to /api/enhance-image (which calls the Gemini API).
 *   3. The returned enhanced image URL is stored in the in-memory cache.
 *   4. The overlay fades in over the 3D scene.
 *
 * Flow on repeat visits:
 *   - The cache is checked first. If a URL exists for that location key,
 *     the overlay shows immediately with no network call.
 *
 * Dismissal:
 *   - dismissOverlay() starts a CSS opacity transition to 0, then clears the
 *     image URL after 500 ms so the <img> is removed from the DOM once hidden.
 */

import { useRef, useState } from "react";

export function useImageEnhancer(captureCanvas: () => string) {
  // Whether the Gemini API call is in flight. Drives the "Enhancing..." badge.
  const [isEnhancing, setIsEnhancing] = useState(false);

  // The data URL of the enhanced image, or null when no overlay is active.
  const [enhancedImageUrl, setEnhancedImageUrl] = useState<string | null>(null);

  // Controls the CSS opacity transition. Separated from enhancedImageUrl so we
  // can trigger the fade-out before clearing the URL (gives the animation time
  // to finish before the <img> is unmounted).
  const [overlayVisible, setOverlayVisible] = useState(false);

  // Per-location cache: locationKey → enhanced image data URL.
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

  // Called when the camera arrives at a location (via useLocationNav's onArrival).
  // locationKey matches the keys in locations.json (e.g. "kitchen", "hallway").
  const enhanceForLocation = async (locationKey: string) => {
    // Don't stack multiple enhancement calls.
    if (isEnhancingRef.current) return;

    // Cache hit: show the stored image immediately, no API call needed.
    if (imageCache.current.has(locationKey)) {
      setEnhancedImageUrl(imageCache.current.get(locationKey)!);
      // requestAnimationFrame defers the opacity change by one paint cycle,
      // which is required for the CSS transition to fire (the element must be
      // rendered at opacity-0 before we flip to opacity-100).
      requestAnimationFrame(() => setOverlayVisible(true));
      return;
    }

    // Capture the current frame before we start the async work.
    // Returns "" if the renderer isn't ready, in which case we bail out.
    const dataUrl = captureCanvas();
    if (!dataUrl) return;

    isEnhancingRef.current = true;
    setIsEnhancing(true);
    try {
      const res = await fetch("/api/enhance-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
      });
      const { imageDataUrl } = await res.json();
      imageCache.current.set(locationKey, imageDataUrl); // populate cache
      setEnhancedImageUrl(imageDataUrl);
      requestAnimationFrame(() => setOverlayVisible(true));
    } finally {
      // Always clear the in-flight flag, even if the request failed.
      isEnhancingRef.current = false;
      setIsEnhancing(false);
    }
  };

  return {
    enhancedImageUrl,   // data URL to pass to <img src>, or null
    overlayVisible,     // drives the opacity class (true = opacity-100)
    isEnhancing,        // true while the API call is in flight
    enhanceForLocation, // call with a location key to trigger the flow
    dismissOverlay,     // fade out and remove the overlay
  };
}

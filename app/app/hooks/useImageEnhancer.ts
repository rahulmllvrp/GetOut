"use client";

/**
 * useImageEnhancer
 *
 * Manages the full lifecycle of generating and displaying overlay images.
 *
 * Two modes:
 *   1. **Canvas capture mode** (original): captureCanvas() → Gemini enhance → overlay
 *   2. **Hidden POV mode** (game): description text → Gemini generate → overlay
 *
 * Both modes share the same cache, overlay, and dismissal logic.
 */

import { useRef, useState } from "react";

export function useImageEnhancer(captureCanvas: () => string) {
  // Whether the Gemini API call is in flight.
  const [isEnhancing, setIsEnhancing] = useState(false);

  // The data URL of the enhanced image, or null when no overlay is active.
  const [enhancedImageUrl, setEnhancedImageUrl] = useState<string | null>(null);

  // Controls the CSS opacity transition.
  const [overlayVisible, setOverlayVisible] = useState(false);

  // Per-key cache: key → image data URL.
  const imageCache = useRef<Map<string, string>>(new Map());

  // Ref mirror of isEnhancing.
  const isEnhancingRef = useRef(false);

  // Start the overlay fade-out, then remove the image from the DOM.
  const dismissOverlay = () => {
    setOverlayVisible(false);
    setTimeout(() => setEnhancedImageUrl(null), 500);
  };

  // Mode 1: Capture canvas → Gemini enhance (original flow)
  const enhanceForLocation = async (locationKey: string) => {
    if (isEnhancingRef.current) return;

    if (imageCache.current.has(locationKey)) {
      setEnhancedImageUrl(imageCache.current.get(locationKey)!);
      requestAnimationFrame(() => setOverlayVisible(true));
      return;
    }

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
      imageCache.current.set(locationKey, imageDataUrl);
      setEnhancedImageUrl(imageDataUrl);
      requestAnimationFrame(() => setOverlayVisible(true));
    } finally {
      isEnhancingRef.current = false;
      setIsEnhancing(false);
    }
  };

  // Mode 2: Generate hidden POV image from a text description (game mode).
  // Uses the canvas capture as a reference image + the hidden area description.
  const showHiddenPov = async (cacheKey: string, description: string) => {
    if (isEnhancingRef.current) return;

    // Cache hit
    if (imageCache.current.has(cacheKey)) {
      setEnhancedImageUrl(imageCache.current.get(cacheKey)!);
      requestAnimationFrame(() => setOverlayVisible(true));
      return;
    }

    // Capture current 3D view as reference
    const dataUrl = captureCanvas();
    if (!dataUrl) return;

    isEnhancingRef.current = true;
    setIsEnhancing(true);
    try {
      const res = await fetch("/api/enhance-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: dataUrl,
          hiddenPovDescription: description,
        }),
      });
      const { imageDataUrl } = await res.json();
      imageCache.current.set(cacheKey, imageDataUrl);
      setEnhancedImageUrl(imageDataUrl);
      requestAnimationFrame(() => setOverlayVisible(true));
    } finally {
      isEnhancingRef.current = false;
      setIsEnhancing(false);
    }
  };

  return {
    enhancedImageUrl,
    overlayVisible,
    isEnhancing,
    enhanceForLocation, // mode 1: canvas capture enhance
    showHiddenPov, // mode 2: hidden POV from description
    dismissOverlay,
  };
}

"use client";

/**
 * usePrewarm
 *
 * Silently pre-warms the enhanced-image disk cache for all locations while the
 * Win98 intro splash is shown. For each location that has no image_filepath set
 * in initGameState.json it:
 *   1. Moves the camera directly (bypassing moveTo so onArrival never fires)
 *   2. Waits for the camera to physically arrive at the target
 *   3. Captures a canvas snapshot
 *   4. POSTs to /api/enhance-image — which saves the PNG and writes image_filepath
 *      back into initGameState.json and gameState.json
 *
 * This means the first real visit to any location shows the enhanced image
 * instantly instead of waiting 3–8 s for Gemini.
 */

import { useCallback, useEffect, useRef } from "react";

type Vec3 = { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
type Euler = { x: number; y: number; z: number };
type Pos = { x: number; y: number; z: number };

interface LocationData {
  key: string;
  pos: { x: number; y: number; z: number };
  rot: { x: number; y: number; z?: number };
  imageFilepath: string | null;
  hiddenAreaDescription: string | null;
  hiddenPovImagePath: string | null;
}

interface UsePrewarmProps {
  cameraTargetRef: React.RefObject<Vec3 | null>;
  cameraPositionRef: React.RefObject<Pos | null>;
  rotationTargetRef: React.RefObject<Euler | null>;
  captureCanvas: () => string;
}

const ARRIVAL_THRESHOLD = 0.15;
const ARRIVAL_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 50;

export function usePrewarm({
  cameraTargetRef,
  cameraPositionRef,
  rotationTargetRef,
  captureCanvas,
}: UsePrewarmProps): { startPrewarm: () => void } {
  const runningRef = useRef(false);

  // Keep a ref to the latest captureCanvas so startPrewarm (stable callback)
  // always calls the most recent version without needing it as a dep.
  const captureCanvasRef = useRef(captureCanvas);
  useEffect(() => {
    captureCanvasRef.current = captureCanvas;
  }, [captureCanvas]);

  const startPrewarm = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    // 1. Fetch locations from initGameState.json (via API route).
    //    The response includes image_filepath so we can skip already-enhanced locations.
    let locations: LocationData[];
    try {
      const res = await fetch("/api/game/locations");
      locations = await res.json();
    } catch {
      runningRef.current = false;
      return;
    }

    // 2. Split work:
    //   - needsEnhance: no enhanced image yet  (move camera → capture → enhance → POV)
    //   - needsPovOnly: enhanced image exists but hidden POV still missing (fetch disk image → POV)
    const needsEnhance = locations.filter((loc) => loc.imageFilepath === null);
    const needsPovOnly = locations.filter(
      (loc) =>
        loc.imageFilepath !== null &&
        loc.hiddenAreaDescription &&
        !loc.hiddenPovImagePath,
    );

    // 3. Visit each uncached location sequentially.
    for (const loc of needsEnhance) {
      const target = cameraTargetRef.current;
      const rot = rotationTargetRef.current;
      if (!target || !rot) continue;

      // Move camera directly — bypasses moveTo() so pendingCaptureLocationRef
      // in useLocationNav stays null and onArrival never fires.
      target.set(loc.pos.x, loc.pos.y, loc.pos.z);
      rot.x = loc.rot.x;
      rot.y = loc.rot.y;
      rot.z = loc.rot.z ?? 0;

      // Wait for the animation loop to lerp the camera close enough.
      const arrived = await new Promise<boolean>((resolve) => {
        const deadline = setTimeout(() => resolve(false), ARRIVAL_TIMEOUT_MS);
        const poll = setInterval(() => {
          const pos = cameraPositionRef.current;
          if (!pos) return;
          const dx = pos.x - loc.pos.x;
          const dy = pos.y - loc.pos.y;
          const dz = pos.z - loc.pos.z;
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) < ARRIVAL_THRESHOLD) {
            clearTimeout(deadline);
            clearInterval(poll);
            resolve(true);
          }
        }, POLL_INTERVAL_MS);
      });

      if (!arrived) continue;

      // Snapshot the current frame (camera is now at the right angle).
      const imageDataUrl = captureCanvasRef.current();
      if (!imageDataUrl) continue;

      // POST to enhance-image — API saves PNG and writes image_filepath back to JSON.
      let enhancedUrl: string | null = null;
      try {
        const enhanceRes = await fetch("/api/enhance-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageDataUrl, locationKey: loc.key }),
        });
        const enhanceData = await enhanceRes.json();
        enhancedUrl = enhanceData.imageDataUrl ?? null;
        console.log(`[prewarm] enhanced: /enhanced-cache/${loc.key}.png`);
      } catch {
        // Best-effort — a miss here just means a cold cache on first visit
      }

      // Pre-generate hidden POV if this location has one and it's not yet cached.
      if (loc.hiddenAreaDescription && !loc.hiddenPovImagePath && enhancedUrl) {
        try {
          await fetch("/api/enhance-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageDataUrl: enhancedUrl,
              locationKey: loc.key,
              hiddenPovDescription: loc.hiddenAreaDescription,
            }),
          });
          console.log(`[prewarm] hidden POV: /enhanced-cache/pov-${loc.key}.png`);
        } catch {
          // Best-effort
        }
      }
    }

    // 4. Second pass: locations that already have an enhanced image but no hidden POV.
    //    Fetch the existing disk image and pass it straight to Gemini — no camera move needed.
    for (const loc of needsPovOnly) {
      try {
        const imgRes = await fetch(loc.imageFilepath!);
        const blob = await imgRes.blob();
        const enhancedUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        await fetch("/api/enhance-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageDataUrl: enhancedUrl,
            locationKey: loc.key,
            hiddenPovDescription: loc.hiddenAreaDescription,
          }),
        });
        console.log(`[prewarm] hidden POV: /enhanced-cache/pov-${loc.key}.png`);
      } catch {
        // Best-effort
      }
    }

    runningRef.current = false;
  }, [cameraTargetRef, cameraPositionRef, rotationTargetRef]);

  return { startPrewarm };
}

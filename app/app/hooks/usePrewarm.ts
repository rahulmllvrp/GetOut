"use client";

/**
 * usePrewarm
 *
 * Silently pre-warms the enhanced-image disk cache for all locations while the
 * Win98 intro splash is shown. For each uncached location it:
 *   1. Moves the camera directly (bypassing moveTo so onArrival never fires)
 *   2. Waits for the camera to physically arrive at the target
 *   3. Captures a canvas snapshot
 *   4. POSTs to /api/enhance-image — which auto-saves the PNG to disk
 *
 * This means the first real visit to any location shows the enhanced image
 * instantly instead of waiting 3–8 s for Gemini.
 */

import { useCallback, useEffect, useRef } from "react";

type Vec3 = { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
type Euler = { x: number; y: number; z: number };
type Pos = { x: number; y: number; z: number };

interface LocationEntry {
  pos: { x: number; y: number; z: number };
  rot: { x: number; y: number; z?: number };
}

interface UsePrewarmProps {
  cameraTargetRef: React.RefObject<Vec3 | null>;
  cameraPositionRef: React.RefObject<Pos | null>;
  rotationTargetRef: React.RefObject<Euler | null>;
  captureCanvas: () => string;
}

const ARRIVAL_THRESHOLD = 0.15; // units — slightly looser than nav (0.05) for speed
const ARRIVAL_TIMEOUT_MS = 8000; // bail if a location takes too long
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

    // 1. Fetch all locations (same source-of-truth as useLocationNav)
    let locations: Record<string, LocationEntry>;
    try {
      const res = await fetch("/locations.json");
      locations = await res.json();
    } catch {
      runningRef.current = false;
      return;
    }

    const keys = Object.keys(locations);

    // 2. Check which locations are already cached — skip those
    const uncached = (
      await Promise.all(
        keys.map(async (key) => {
          try {
            const res = await fetch(`/enhanced-cache/${key}.png`, { method: "HEAD" });
            return res.status === 200 ? null : key;
          } catch {
            return key;
          }
        })
      )
    ).filter((k): k is string => k !== null);

    if (uncached.length === 0) {
      runningRef.current = false;
      return;
    }

    // 3. Visit each uncached location sequentially
    for (const key of uncached) {
      const loc = locations[key];
      if (!loc) continue;

      const target = cameraTargetRef.current;
      const rot = rotationTargetRef.current;
      if (!target || !rot) continue;

      // Move camera directly — bypasses moveTo() so pendingCaptureLocationRef
      // in useLocationNav stays null and onArrival never fires.
      target.set(loc.pos.x, loc.pos.y, loc.pos.z);
      rot.x = loc.rot.x;
      rot.y = loc.rot.y;
      rot.z = loc.rot.z ?? 0;

      // Wait for the animation loop to lerp the camera close enough
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

      // Snapshot the current frame (camera is now at the right angle)
      const imageDataUrl = captureCanvasRef.current();
      if (!imageDataUrl) continue;

      // POST to enhance-image — API saves the result to /public/enhanced-cache/{key}.png
      try {
        await fetch("/api/enhance-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageDataUrl, locationKey: key }),
        });
      } catch {
        // Best-effort — a miss here just means a cold cache on first visit
      }
    }

    runningRef.current = false;
  }, [cameraTargetRef, cameraPositionRef, rotationTargetRef]);

  return { startPrewarm };
}

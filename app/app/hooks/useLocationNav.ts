"use client";

/**
 * useLocationNav
 *
 * Loads named locations from /locations.json and handles navigating between
 * them. "Navigation" means writing new target values into the refs that
 * useThreeScene's animation loop reads — the actual smooth movement happens
 * there, not here.
 *
 * Arrival detection works via frameCallbackRef, an escape hatch exposed by
 * useThreeScene that lets us inject a function into the animation loop without
 * useThreeScene needing to know anything about locations. On mount, this hook
 * registers a distance-check closure that runs every frame. When the camera is
 * within 0.05 units of its target, it considers the journey complete and fires
 * onArrival(locationKey) — which triggers image enhancement.
 *
 * Data flow for a "Go to X" click:
 *   1. moveTo(key) called → onNavigate() dismisses any open overlay
 *   2. pendingCaptureLocationRef is set to key (tells the frame callback to watch)
 *   3. cameraTargetRef and rotationTargetRef are updated (camera starts lerping)
 *   4. Frame callback runs each tick; once distance < 0.05, fires onArrival(key)
 *   5. onArrival = enhanceForLocation → captures frame and calls Gemini API
 */

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";

type LocationData = {
  pos: { x: number; y: number; z: number };
  rot: { x?: number; y: number; z?: number }; // x and z are optional (default 0)
};

interface UseLocationNavProps {
  /** The camera's destination (write .set(x,y,z) to change it). */
  cameraTargetRef: RefObject<{ set: (x: number, y: number, z: number) => void; x: number; y: number; z: number } | null>;
  /** Live reference to camera.position — read-only, updated by Three.js each frame. */
  cameraPositionRef: RefObject<{ x: number; y: number; z: number } | null>;
  /** The camera's rotation destination (write .x/.y/.z directly). */
  rotationTargetRef: RefObject<{ x: number; y: number; z: number } | null>;
  /** Animation loop escape hatch — set .current to a function to run it every frame. */
  frameCallbackRef: MutableRefObject<(() => void) | null>;
  /** Called once the camera has settled at a location. Receives the location key. */
  onArrival: (key: string) => void;
  /** Called at the start of every moveTo (use to dismiss any open overlay). */
  onNavigate: () => void;
}

export function useLocationNav({
  cameraTargetRef,
  cameraPositionRef,
  rotationTargetRef,
  frameCallbackRef,
  onArrival,
  onNavigate,
}: UseLocationNavProps) {
  // Loaded from /locations.json. Keys are location names (e.g. "kitchen").
  const [locations, setLocations] = useState<Record<string, LocationData>>({});

  // The key of the location we're currently travelling to, or null if idle.
  // The frame callback watches this — when it's set, it measures distance each
  // frame and clears it (and fires onArrival) once close enough.
  const pendingCaptureLocationRef = useRef<string | null>(null);

  // We store onArrival in a ref so the frame callback closure (set up once on
  // mount) always calls the latest version of the function, even if the parent
  // re-renders and passes a new reference. Without this, the closure would
  // capture a stale onArrival from the first render.
  const onArrivalRef = useRef(onArrival);
  onArrivalRef.current = onArrival;

  // Fetch location definitions once on mount.
  useEffect(() => {
    fetch("/locations.json")
      .then((res) => res.json())
      .then((data) => setLocations(data))
      .catch((err) => console.log("No locations.json found:", err));
  }, []);

  // Register the per-frame arrival checker into the animation loop seam.
  // This runs once on mount because the ref objects are stable across renders.
  useEffect(() => {
    frameCallbackRef.current = () => {
      // Nothing to check if we're not travelling anywhere.
      if (!pendingCaptureLocationRef.current) return;

      const pos = cameraPositionRef.current;    // where the camera is NOW
      const target = cameraTargetRef.current;   // where it's heading TO
      if (!pos || !target) return;

      // Manual Euclidean distance (avoids importing Three.js just for this).
      const dx = pos.x - target.x;
      const dy = pos.y - target.y;
      const dz = pos.z - target.z;

      // 0.05 units is close enough to consider "arrived" — small enough to be
      // imperceptible to the player but large enough to trigger reliably given
      // the 0.02 lerp alpha (camera never reaches exact target with lerp).
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.15) {
        const key = pendingCaptureLocationRef.current;
        pendingCaptureLocationRef.current = null; // stop watching
        onArrivalRef.current(key);
      }
    };
  }, [cameraTargetRef, cameraPositionRef, frameCallbackRef]);

  // Navigate the camera to a named location.
  // The actual movement is done by updating the target refs — useThreeScene's
  // animation loop does the lerping.
  const moveTo = (key: string) => {
    onNavigate(); // dismiss any open overlay before we start moving
    pendingCaptureLocationRef.current = key; // arm the arrival checker
    const location = locations[key];
    if (!location || !cameraTargetRef.current || !rotationTargetRef.current) return;
    cameraTargetRef.current.set(location.pos.x, location.pos.y, location.pos.z);
    rotationTargetRef.current.x = location.rot.x ?? 0;
    rotationTargetRef.current.y = location.rot.y;
    rotationTargetRef.current.z = location.rot.z ?? 0;
  };

  return {
    locations, // rendered as "Go to X" buttons in page.tsx
    moveTo,    // called when a location button is clicked
  };
}

"use client";

/**
 * Home (page.tsx)
 *
 * Thin orchestration layer — wires three focused hooks together and renders
 * the UI shell. No Three.js, no fetch calls, no image logic lives here.
 *
 * Hook responsibilities:
 *   useThreeScene     – 3D scene, camera, renderer, animation loop
 *   useImageEnhancer  – capture → Gemini API → overlay image lifecycle
 *   useLocationNav    – loads locations.json, drives camera to named spots,
 *                       fires enhanceForLocation when the camera arrives
 *
 * Data flow:
 *   captureCanvas (from useThreeScene) ──► useImageEnhancer
 *   cameraTargetRef / frameCallbackRef  ──► useLocationNav
 *   enhanceForLocation                  ──► useLocationNav (onArrival callback)
 *   dismissOverlay                      ──► useLocationNav (onNavigate callback)
 */

import { useState } from "react";
import { useThreeScene } from "./hooks/useThreeScene";
import { useImageEnhancer } from "./hooks/useImageEnhancer";
import { useLocationNav } from "./hooks/useLocationNav";

export default function Home() {
  // X/Y/Z inputs — used by the manual "Move Camera" and "Move Object" buttons.
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("-3");

  // Three.js scene management. Exposes stable refs for camera/object targets
  // so we can write new positions without triggering React re-renders.
  const {
    containerRef,      // <div> that Three.js mounts its canvas into
    captureCanvas,     // () => PNG data URL of the current frame
    cameraTargetRef,   // write .set(x,y,z) to move camera
    rotationTargetRef, // write .x/.y/.z to rotate camera
    objectTargetRef,   // write .set(x,y,z) to move the splat mesh
    frameCallbackRef,  // runs a function every animation frame (for arrival check)
    cameraPositionRef, // live read of camera.position (for arrival check)
  } = useThreeScene();

  // Image enhancement lifecycle. Takes captureCanvas so it can snapshot the
  // renderer at the right moment without needing a direct renderer reference.
  const { enhancedImageUrl, overlayVisible, isEnhancing, enhanceForLocation, dismissOverlay } =
    useImageEnhancer(captureCanvas);

  // Location loading and navigation. Wires the arrival callback so the overlay
  // appears automatically when the camera reaches a destination.
  const { locations, moveTo } = useLocationNav({
    cameraTargetRef,
    cameraPositionRef,
    rotationTargetRef,
    frameCallbackRef,
    onArrival: enhanceForLocation,  // fires when camera settles at a location
    onNavigate: dismissOverlay,     // clears overlay when a new journey starts
  });

  // Manual camera move from the X/Y/Z inputs. Also clears any open overlay.
  const moveCamera = () => {
    dismissOverlay();
    cameraTargetRef.current?.set(parseFloat(x) || 0, parseFloat(y) || 0, parseFloat(z) || 0);
  };

  // Move the splat mesh itself (independent of camera).
  const moveObject = () => {
    objectTargetRef.current?.set(parseFloat(x) || 0, parseFloat(y) || 0, parseFloat(z) || 0);
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {/* Debug / navigation controls overlay */}
      <div
        className="absolute left-2.5 top-2.5 z-10 rounded bg-black/70 p-2.5 text-white"
        style={{ fontFamily: "sans-serif" }}
      >
        {/* Manual position inputs */}
        <label>
          X:
          <input
            type="number"
            step="0.1"
            value={x}
            onChange={(e) => setX(e.target.value)}
            className="mx-1.5 w-[60px] rounded border border-white/30 bg-black/40 px-1"
          />
        </label>
        <label>
          Y:
          <input
            type="number"
            step="0.1"
            value={y}
            onChange={(e) => setY(e.target.value)}
            className="mx-1.5 w-[60px] rounded border border-white/30 bg-black/40 px-1"
          />
        </label>
        <label>
          Z:
          <input
            type="number"
            step="0.1"
            value={z}
            onChange={(e) => setZ(e.target.value)}
            className="mx-1.5 w-[60px] rounded border border-white/30 bg-black/40 px-1"
          />
        </label>

        <button
          onClick={moveCamera}
          className="ml-1.5 rounded border border-white/30 bg-white/10 px-2 py-1"
        >
          Move Camera
        </button>
        <button
          onClick={moveObject}
          className="ml-1.5 rounded border border-white/30 bg-white/10 px-2 py-1"
        >
          Move Object
        </button>

        {/* Visible while Gemini API call is in flight */}
        <span
          className={`ml-1.5 rounded border border-white/30 px-2 py-1 text-sm transition-opacity duration-300 ${isEnhancing ? "bg-green-600/40 opacity-100" : "opacity-0"}`}
        >
          Enhancing...
        </span>

        {/* One button per location from locations.json */}
        <div className="mt-2">
          {Object.keys(locations).map((key) => (
            <button
              key={key}
              onClick={() => moveTo(key)}
              className="mr-1.5 mt-1 rounded border border-white/30 bg-blue-600/20 px-2 py-1 text-xs"
            >
              Go to {key}
            </button>
          ))}
        </div>
      </div>

      {/* Three.js mounts its <canvas> into this div */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Enhanced image overlay — fades in/out via CSS transition on opacity.
          The <img> is only in the DOM while enhancedImageUrl is set, which
          prevents a flash of the previous image during navigation. */}
      {enhancedImageUrl && (
        <img
          src={enhancedImageUrl}
          alt="Enhanced view"
          className={`pointer-events-none absolute inset-0 z-[1] h-full w-full object-cover transition-opacity duration-500 ${overlayVisible ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </main>
  );
}

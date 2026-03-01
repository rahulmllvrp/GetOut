"use client";

/**
 * useThreeScene
 *
 * Owns the entire Three.js lifecycle for the Gaussian splat viewer:
 *   - Scene, camera, and WebGL renderer setup
 *   - Splat mesh loading from /room.ply
 *   - Per-frame animation loop (lerp-based smooth movement)
 *   - Resize handling
 *   - Raycaster (click on splat → logs camera pos/rot to console, useful for
 *     recording new locations to add to locations.json)
 *   - Cleanup on unmount
 *
 * Movement works via "target refs": external code writes a new destination into
 * cameraTargetRef / rotationTargetRef / objectTargetRef, and the animation loop
 * smoothly lerps toward it every frame. Nothing here knows about locations or
 * images — it just moves things.
 *
 * The frameCallbackRef is an intentional escape hatch: whatever function is
 * stored there gets called once per frame (after lerping, before render). This
 * lets useLocationNav inject an arrival distance check without this hook needing
 * to know anything about navigation logic.
 */

import { useEffect, useRef } from "react";
import type { Object3D } from "three";

// Minimal shape we need from Three.js Vector3 / Euler — avoids importing the
// full three types at the module level (THREE is loaded dynamically at runtime).
type Vec3 = { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
type Euler = { x: number; y: number; z: number };

export function useThreeScene() {
  // Attached to the <div> in JSX — Three.js appends its <canvas> here.
  const containerRef = useRef<HTMLDivElement | null>(null);

  // WHERE the camera should travel to. External code calls .set(x,y,z) to
  // update the destination; the animation loop lerps camera.position toward it.
  const cameraTargetRef = useRef<Vec3 | null>(null);

  // WHERE the camera should rotate to. External code writes .x / .y / .z
  // directly; the animation loop lerps camera.rotation toward those values.
  const rotationTargetRef = useRef<Euler | null>(null);

  // WHERE the splat mesh should move to. Same lerp pattern as camera.
  const objectTargetRef = useRef<{ set: (x: number, y: number, z: number) => void } | null>(null);

  // Hook for per-frame logic injected by other hooks (see useLocationNav).
  // Called after every lerp step, before renderer.render().
  const frameCallbackRef = useRef<(() => void) | null>(null);

  // Kept internal — only used for the raycaster click handler.
  const rendererRef = useRef<import("three").WebGLRenderer | null>(null);

  // Points at camera.position (the live, mutable Three.js Vector3). Because
  // camera.position is mutated in place by the lerp, this ref always reflects
  // the camera's actual current position — used by useLocationNav to measure
  // arrival distance without needing a direct reference to the camera object.
  const cameraPositionRef = useRef<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    // cleanup is defined inside init() once we have things to tear down.
    let cleanup: (() => void) | undefined;

    const init = async () => {
      // Dynamic imports keep Three.js and Spark out of the initial bundle.
      const THREE = await import("three");
      const { SplatMesh } = await import("@sparkjsdev/spark");

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        60,                                    // vertical FOV (degrees)
        window.innerWidth / window.innerHeight, // aspect ratio
        0.1,                                   // near clip
        1000,                                  // far clip
      );

      // preserveDrawingBuffer keeps the last rendered frame readable as an
      // image, which is what captureCanvas() relies on.
      const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
      rendererRef.current = renderer;
      renderer.setSize(window.innerWidth, window.innerHeight);

      const mount = containerRef.current;
      if (!mount) return;
      mount.appendChild(renderer.domElement);

      // SplatMesh doesn't ship full TypeScript types, so we cast to the
      // minimal shape we actually need.
      const splatMesh = new SplatMesh({ url: "/room.ply" }) as {
        quaternion: {
          set: (x: number, y: number, z: number, w: number) => void;
        };
        position: {
          clone: () => {
            set: (x: number, y: number, z: number) => void;
            lerp: (v: unknown, alpha: number) => void;
          };
          set: (x: number, y: number, z: number) => void;
          lerp: (v: unknown, alpha: number) => void;
        };
      };

      // Identity quaternion = no rotation applied to the splat.
      splatMesh.quaternion.set(1, 0, 0, 0);
      // Start splat 3 units in front of the camera.
      splatMesh.position.set(0, 0, -3);
      scene.add(splatMesh as unknown as Object3D);

      // Camera starts at the world origin.
      camera.position.set(0, 0, 0);

      // cameraTarget is a separate Vector3 that acts as the destination.
      // Writing to cameraTargetRef.current.set(...) moves this object, and the
      // animation loop lerps camera.position toward it each frame.
      const cameraTarget = camera.position.clone();
      cameraTargetRef.current = cameraTarget;
      rotationTargetRef.current = camera.rotation.clone();
      objectTargetRef.current = splatMesh.position.clone();

      // Expose the camera's live position vector so useLocationNav can read it
      // from inside the frameCallbackRef closure (same object, mutated in place).
      cameraPositionRef.current = camera.position;

      // --- Raycaster: click the splat to log camera position + rotation ---
      // Useful for authoring new entries in locations.json.
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      const onSplatClick = (event: MouseEvent) => {
        // Convert screen coords to NDC (-1..+1 range).
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(splatMesh as unknown as Object3D);
        if (intersects.length > 0) {
          // Log a ready-to-paste locations.json entry.
          const entry = {
            label: "NEW_OBJECT",
            pos: {
              x: parseFloat(camera.position.x.toFixed(3)),
              y: parseFloat(camera.position.y.toFixed(3)),
              z: parseFloat(camera.position.z.toFixed(3)),
            },
            rot: {
              x: parseFloat(camera.rotation.x.toFixed(3)),
              y: parseFloat(camera.rotation.y.toFixed(3)),
              z: parseFloat(camera.rotation.z.toFixed(3)),
            },
          };
          console.log("Camera Position & Rotation:", JSON.stringify(entry, null, 2));
        }
      };
      renderer.domElement.addEventListener("click", onSplatClick);

      // Keep renderer/camera in sync with the window size.
      const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener("resize", onResize);

      // --- Animation loop ---
      // Runs at the display refresh rate (typically 60 fps).
      // The 0.02 / 0.05 alpha values control how snappy the movement feels:
      // lower = smoother/slower, higher = snappier/faster.
      renderer.setAnimationLoop(() => {
        // Smoothly walk the camera toward its target position and rotation.
        camera.position.lerp(cameraTarget, 0.02);
        camera.rotation.x = THREE.MathUtils.lerp(camera.rotation.x, rotationTargetRef.current!.x, 0.02);
        camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, rotationTargetRef.current!.y, 0.02);
        camera.rotation.z = THREE.MathUtils.lerp(camera.rotation.z, rotationTargetRef.current!.z, 0.02);

        // Smoothly move the splat mesh toward its target position.
        splatMesh.position.lerp(objectTargetRef.current, 0.05);

        // Give other hooks a chance to run per-frame logic (e.g. arrival check).
        frameCallbackRef.current?.();

        renderer.render(scene, camera);
      });

      cleanup = () => {
        renderer.setAnimationLoop(null);
        renderer.domElement.removeEventListener("click", onSplatClick);
        window.removeEventListener("resize", onResize);
        renderer.dispose();
        if (mount.contains(renderer.domElement)) {
          mount.removeChild(renderer.domElement);
        }
      };
    };

    void init();

    return () => {
      cleanup?.();
    };
  }, []);

  // Snapshot the current frame as a PNG data URL.
  // Returns "" if the renderer isn't ready yet (e.g. called before init finishes).
  const captureCanvas = () =>
    rendererRef.current?.domElement.toDataURL("image/png") ?? "";

  return {
    containerRef,    // attach to the wrapper <div> in JSX
    captureCanvas,   // grab a PNG of the current frame
    cameraTargetRef, // write .set(x,y,z) to move the camera
    rotationTargetRef, // write .x/.y/.z to rotate the camera
    objectTargetRef, // write .set(x,y,z) to move the splat mesh
    frameCallbackRef,  // set to a function to run it every frame
    cameraPositionRef, // read-only: live camera position (for arrival checks)
  };
}

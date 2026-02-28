"use client";

import { useEffect, useRef, useState } from "react";
import type { Object3D } from "three";

export default function Home() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("-3");
  const cameraTargetRef = useRef<{
    set: (x: number, y: number, z: number) => void;
  } | null>(null);
  const objectTargetRef = useRef<{
    set: (x: number, y: number, z: number) => void;
  } | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const init = async () => {
      const THREE = await import("three");
      const { SplatMesh } = await import("@sparkjsdev/spark");

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        1000,
      );

      const renderer = new THREE.WebGLRenderer();
      renderer.setSize(window.innerWidth, window.innerHeight);

      const mount = containerRef.current;
      if (!mount) return;
      mount.appendChild(renderer.domElement);

      const splatURL = "/room.ply";
      const splatMesh = new SplatMesh({ url: splatURL }) as {
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

      splatMesh.quaternion.set(1, 0, 0, 0);
      splatMesh.position.set(0, 0, -3);
      scene.add(splatMesh as unknown as Object3D);

      const cameraTarget = camera.position.clone();
      const objectTarget = splatMesh.position.clone();
      cameraTargetRef.current = cameraTarget;
      objectTargetRef.current = objectTarget;

      const animationSpeed = 0.05;

      const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };

      window.addEventListener("resize", onResize);

      renderer.setAnimationLoop(() => {
        camera.position.lerp(cameraTarget, animationSpeed);
        splatMesh.position.lerp(objectTarget, animationSpeed);
        renderer.render(scene, camera);
      });

      cleanup = () => {
        renderer.setAnimationLoop(null);
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

  const currentVector = () => ({
    x: Number.parseFloat(x) || 0,
    y: Number.parseFloat(y) || 0,
    z: Number.parseFloat(z) || 0,
  });

  const moveCamera = () => {
    const v = currentVector();
    cameraTargetRef.current?.set(v.x, v.y, v.z);
  };

  const moveObject = () => {
    const v = currentVector();
    objectTargetRef.current?.set(v.x, v.y, v.z);
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <div
        className="absolute left-2.5 top-2.5 z-10 rounded bg-black/70 p-2.5 text-white"
        style={{ fontFamily: "sans-serif" }}
      >
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
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </main>
  );
}

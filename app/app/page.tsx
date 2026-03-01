"use client";

import { useEffect, useRef, useState } from "react";
import type { Object3D } from "three";
import gsap from "gsap";

export default function Home() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("-3");
  const [locations, setLocations] = useState<Record<string, {
    pos: { x: number; y: number; z: number };
    rot: { x?: number; y: number; z?: number }
  }>>({});
  const cameraRef = useRef<any>(null);
  const rotationTargetRef = useRef<any>(null);
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

      // Start camera at origin
      camera.position.set(0, 0, 0);
      cameraRef.current = camera;

      const cameraTarget = camera.position.clone();
      const rotationTarget = camera.rotation.clone();
      cameraTargetRef.current = cameraTarget;
      rotationTargetRef.current = rotationTarget;
      objectTargetRef.current = splatMesh.position.clone();

      // Raycaster for click-to-identify
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      const onSplatClick = (event: MouseEvent) => {
        // Calculate mouse position in normalized device coordinates (-1 to +1)
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        // Update the raycaster with the camera and mouse position
        raycaster.setFromCamera(mouse, camera);

        // Calculate objects intersecting the picking ray
        const intersects = raycaster.intersectObject(splatMesh as unknown as Object3D);

        if (intersects.length > 0) {
          const point = intersects[0].point;

          // Create a dictionary entry with current camera position and rotation
          const entry = {
            label: "NEW_OBJECT",
            pos: {
              x: parseFloat(camera.position.x.toFixed(3)),
              y: parseFloat(camera.position.y.toFixed(3)),
              z: parseFloat(camera.position.z.toFixed(3))
            },
            rot: {
              x: parseFloat(camera.rotation.x.toFixed(3)),
              y: parseFloat(camera.rotation.y.toFixed(3)),
              z: parseFloat(camera.rotation.z.toFixed(3))
            }
          };

          console.log("Camera Position & Rotation:", JSON.stringify(entry, null, 2));
        }
      };

      renderer.domElement.addEventListener('click', onSplatClick);


      const animationSpeed = 0.05;

      const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };

      window.addEventListener("resize", onResize);

      renderer.setAnimationLoop(() => {
        // Slow smooth camera movement
        camera.position.lerp(cameraTarget, 0.02);
        camera.rotation.x = THREE.MathUtils.lerp(camera.rotation.x, rotationTargetRef.current.x, 0.02);
        camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, rotationTargetRef.current.y, 0.02);
        camera.rotation.z = THREE.MathUtils.lerp(camera.rotation.z, rotationTargetRef.current.z, 0.02);

        splatMesh.position.lerp(objectTargetRef.current, 0.05);
        renderer.render(scene, camera);
      });

      cleanup = () => {
        renderer.setAnimationLoop(null);
        renderer.domElement.removeEventListener('click', onSplatClick);
        window.removeEventListener("resize", onResize);
        renderer.dispose();
        if (mount.contains(renderer.domElement)) {
          mount.removeChild(renderer.domElement);
        }
      };
    };

    void init();

    // Load locations.json
    fetch('/locations.json')
      .then(res => res.json())
      .then(data => setLocations(data))
      .catch(err => console.log('No locations.json found:', err));

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

  // Walking moveTo function
  const moveTo = (key: string) => {
    const location = locations[key];
    if (!location || !cameraTargetRef.current || !rotationTargetRef.current) return;

    const targetPos = location.pos;

    // Set target position for smooth walking movement
    cameraTargetRef.current.set(targetPos.x, targetPos.y, targetPos.z);

    // Set target rotation for smooth turning
    rotationTargetRef.current.x = location.rot.x || 0;
    rotationTargetRef.current.y = location.rot.y;
    rotationTargetRef.current.z = location.rot.z || 0;
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
      <div ref={containerRef} className="h-full w-full" />
    </main>
  );
}

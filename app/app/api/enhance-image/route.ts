import { NextRequest, NextResponse } from "next/server";
import { generateImageFromBase64 } from "@/app/utils/gemini";
import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";

export async function POST(req: NextRequest) {
  const { imageDataUrl, locationKey, hiddenPovDescription, clueDiscovery, clueRiddle } = await req.json();
  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");

  // Hidden POV mode: generate a discovery image from a description.
  // Regular mode: enhance the blurry 3D capture.
  let prompt: string;
  if (hiddenPovDescription) {
    const parts = [
      `Generate a first-person POV image of what someone would see when they discover this hidden area in the room shown above.`,
      `The hidden area is: ${hiddenPovDescription}.`,
    ];
    if (clueDiscovery) parts.push(`What Kyle discovers here: ${clueDiscovery}.`);
    if (clueRiddle) parts.push(`The riddle this clue is tied to: "${clueRiddle}".`);
    parts.push(
      `The image should feel like a close-up, intimate view of the discovery — as if someone is crouching down or reaching into the hidden spot.`,
      `Keep the art style and lighting consistent with the reference image.`,
    );
    prompt = parts.join(" ");
  } else {
    prompt = "This image is blurry. Can you please clear it up? Make it feel a bit darker and gloomier.";
  }

  const t0 = performance.now();
  const result = await generateImageFromBase64(base64, prompt);
  const geminiMs = Math.round(performance.now() - t0);

  // Persist named-location images to disk so the cache survives server restarts.
  if (locationKey && result.imageDataUrl) {
    const imgBase64 = result.imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(imgBase64, "base64");
    const cacheDir = join(process.cwd(), "public", "enhanced-cache");
    await mkdir(cacheDir, { recursive: true });

    if (hiddenPovDescription) {
      // Hidden POV pre-generation: save as pov-{key}.png and write hiddenPovImagePath back.
      await writeFile(join(cacheDir, `pov-${locationKey}.png`), buffer);
      const webPath = `/enhanced-cache/pov-${locationKey}.png`;
      for (const filename of ["initGameState.json", "gameState.json"]) {
        try {
          const filePath = join(process.cwd(), "data", filename);
          const state = JSON.parse(await readFile(filePath, "utf-8"));
          for (const list of [state.allLocations ?? [], state.gameTree ?? []]) {
            for (const entry of list) {
              if (entry.frame?.frame === locationKey && entry.clue) {
                entry.clue.hiddenPovImagePath = webPath;
              }
            }
          }
          await writeFile(filePath, JSON.stringify(state, null, 2));
        } catch {
          // Non-fatal
        }
      }
    } else {
      // Regular enhance: save as {key}.png and write image_filepath back.
      await writeFile(join(cacheDir, `${locationKey}.png`), buffer);
      const webPath = `/enhanced-cache/${locationKey}.png`;
      for (const filename of ["initGameState.json", "gameState.json"]) {
        try {
          const filePath = join(process.cwd(), "data", filename);
          const state = JSON.parse(await readFile(filePath, "utf-8"));
          for (const list of [state.allLocations ?? [], state.gameTree ?? []]) {
            for (const entry of list) {
              if (entry.frame?.frame === locationKey) {
                entry.frame.image_filepath = webPath;
              }
            }
          }
          await writeFile(filePath, JSON.stringify(state, null, 2));
        } catch {
          // Non-fatal — gameState.json may not exist yet on first run
        }
      }
    }
  }

  return NextResponse.json({ imageDataUrl: result.imageDataUrl }, {
    headers: { "Server-Timing": `gemini-image;dur=${geminiMs}` },
  });
}

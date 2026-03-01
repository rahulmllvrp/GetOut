import { NextRequest, NextResponse } from "next/server";
import { generateImageFromBase64 } from "@/app/utils/gemini";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export async function POST(req: NextRequest) {
  const { imageDataUrl, locationKey, hiddenPovDescription } = await req.json();
  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");

  // Hidden POV mode: generate a discovery image from a description.
  // Regular mode: enhance the blurry 3D capture.
  const prompt = hiddenPovDescription
    ? `Generate a first-person POV image of what someone would see when they discover this hidden area in the room shown above. The hidden area is: ${hiddenPovDescription}. The image should feel like a close-up, intimate view of the discovery — as if someone is crouching down or reaching into the hidden spot. Keep the art style and lighting consistent with the reference image. Do NOT include any text or UI elements in the image.`
    : "This image is blurry. Can you please clear it up? Make it feel a bit darker and gloomier.";

  const t0 = performance.now();
  const result = await generateImageFromBase64(base64, prompt);
  const geminiMs = Math.round(performance.now() - t0);

  // Persist named-location images to disk so the cache survives server restarts.
  // Hidden POV images are dynamic per session so we skip caching them.
  if (locationKey && !hiddenPovDescription && result.imageDataUrl) {
    const imgBase64 = result.imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(imgBase64, "base64");
    const cacheDir = join(process.cwd(), "public", "enhanced-cache");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${locationKey}.png`), buffer);
  }

  return NextResponse.json({ imageDataUrl: result.imageDataUrl }, {
    headers: { "Server-Timing": `gemini-image;dur=${geminiMs}` },
  });
}

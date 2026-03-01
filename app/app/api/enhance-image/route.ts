import { NextRequest, NextResponse } from "next/server";
import { generateImageFromBase64 } from "@/app/utils/gemini";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export async function POST(req: NextRequest) {
  const { imageDataUrl, locationKey } = await req.json();
  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const result = await generateImageFromBase64(
    base64,
    "This image is blurry. Can you please clear it up? Make it feel a bit darker and gloomier.",
  );

  // Persist to disk so the cache survives server restarts.
  if (locationKey && result.imageDataUrl) {
    const imgBase64 = result.imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(imgBase64, "base64");
    const cacheDir = join(process.cwd(), "public", "enhanced-cache");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${locationKey}.png`), buffer);
  }

  return NextResponse.json({ imageDataUrl: result.imageDataUrl });
}

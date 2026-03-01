import { NextRequest, NextResponse } from "next/server";
import { generateImageFromBase64 } from "@/app/utils/gemini";

export async function POST(req: NextRequest) {
  const { imageDataUrl } = await req.json();
  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const result = await generateImageFromBase64(
    base64,
    "This image is blurry. Can you please clear it up? Make it feel a bit darker and gloomier.",
  );
  return NextResponse.json({ imageDataUrl: result.imageDataUrl });
}

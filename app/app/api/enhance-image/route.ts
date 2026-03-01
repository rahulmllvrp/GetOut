import { NextRequest, NextResponse } from "next/server";
import { generateImageFromBase64 } from "@/app/utils/gemini";

export async function POST(req: NextRequest) {
  const { imageDataUrl, hiddenPovDescription } = await req.json();
  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");

  // If a hidden POV description is provided, generate a discovery image instead
  const prompt = hiddenPovDescription
    ? `Generate a first-person POV image of what someone would see when they discover this hidden area in the room shown above. The hidden area is: ${hiddenPovDescription}. The image should feel like a close-up, intimate view of the discovery — as if someone is crouching down or reaching into the hidden spot. Keep the art style and lighting consistent with the reference image. Do NOT include any text or UI elements in the image.`
    : "This image is blurry. Can you please clear it up? Make it feel a bit darker and gloomier.";

  const result = await generateImageFromBase64(base64, prompt);
  return NextResponse.json({ imageDataUrl: result.imageDataUrl });
}

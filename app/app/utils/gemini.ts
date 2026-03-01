import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export type GenerateImageResult = {
  imageDataUrl: string; // data:image/png;base64,... — drop into <img src> directly
  text: string | null;  // any accompanying text Gemini returned, or null
};

/**
 * Generate an image from a text description using gemini-2.5-flash-image.
 * Server-side only (requires GEMINI_API_KEY env var).
 */
export async function generateImage(description: string): Promise<GenerateImageResult> {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: description,
  });

  let imageDataUrl = "";
  let text: string | null = null;

  for (const part of response.candidates![0].content.parts) {
    if (part.text) {
      text = part.text;
    } else if (part.inlineData) {
      imageDataUrl = `data:image/png;base64,${part.inlineData.data!}`;
    }
  }

  if (!imageDataUrl) {
    throw new Error("Gemini returned no image data");
  }

  return { imageDataUrl, text };
}

/**
 * Generate an image from an existing image (base64) + text prompt using gemini-2.5-flash-image.
 * Server-side only (requires GEMINI_API_KEY env var).
 */
export async function generateImageFromBase64(
  imageBase64: string,
  prompt: string,
  mimeType: string = "image/png",
): Promise<GenerateImageResult> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{
      role: "user",
      parts: [
        { text: "This is the source image:" },
        { inlineData: { mimeType, data: imageBase64 } },
        { text: prompt },
      ],
    }],
  });

  let imageDataUrl = "";
  let text: string | null = null;

  for (const part of response.candidates![0].content.parts) {
    if (part.text) {
      text = part.text;
    } else if (part.inlineData) {
      imageDataUrl = `data:image/png;base64,${part.inlineData.data!}`;
    }
  }

  if (!imageDataUrl) {
    throw new Error("Gemini returned no image data");
  }

  return { imageDataUrl, text };
}

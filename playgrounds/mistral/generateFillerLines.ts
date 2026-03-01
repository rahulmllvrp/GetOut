/**
 * generateFillerLines.ts
 *
 * Generates 5 short Kyle filler voice lines using ElevenLabs TTS.
 * Uses the exact same voice, model, and output format as the app's
 * /api/game/tts route.
 *
 * Usage:  cd playgrounds && bun run mistral/generateFillerLines.ts
 * Output: ../app/public/fillers/filler_0.mp3 … filler_4.mp3
 */

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// ---- Same config as app/app/api/game/tts/route.ts ----
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});
const VOICE_ID = "8xUIoXhbwVdLFdpsGXe6";
const MODEL_ID = "eleven_v3";
const OUTPUT_FORMAT = "mp3_44100_128";

// ---- Filler lines (short, panicky, in-character for Kyle) ----
const FILLER_LINES = [
  "Uhh... hold on, let me look around...",
  "Wait wait wait, give me a second...",
  "Okay okay, I'm checking...",
  "Hmm, let me see here...",
  "One sec, one sec...",
];

const OUTPUT_DIR = path.resolve(import.meta.dir, "../../app/public/fillers");

async function generateFiller(text: string, index: number): Promise<void> {
  console.log(`  [${index}] Generating: "${text}"`);

  const audioStream = await elevenlabs.textToSpeech.convert(VOICE_ID, {
    text,
    modelId: MODEL_ID,
    outputFormat: OUTPUT_FORMAT,
  });

  // Collect stream into buffer — same approach as the app's TTS route
  const chunks: Uint8Array[] = [];
  const reader = (audioStream as ReadableStream<Uint8Array>).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);

  const outputPath = path.join(OUTPUT_DIR, `filler_${index}.mp3`);
  await Bun.write(outputPath, buffer);
  console.log(`  [${index}] Saved: ${outputPath} (${buffer.length} bytes)`);
}

async function main() {
  console.log("Kyle Filler Line Generator");
  console.log(`Output: ${OUTPUT_DIR}\n`);

  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }

  // Generate all 5 in parallel
  await Promise.all(FILLER_LINES.map((line, i) => generateFiller(line, i)));

  console.log("\nDone! Generated 5 filler lines.");
}

main().catch(console.error);

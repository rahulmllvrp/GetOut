/**
 * generateFillerLines.ts
 *
 * Generates 5 short Kyle filler voice lines per game mode using ElevenLabs TTS.
 * Uses the exact same voice, model, and output format as the app's
 * /api/game/tts route.
 *
 * Usage:  cd playgrounds && bun run mistral/generateFillerLines.ts
 * Output: ../app/public/fillers/{normal,brainrot,nsfw}/filler_0.mp3 … filler_4.mp3
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

// ---- Game modes ----
type GameMode = "normal" | "brainrot" | "nsfw";
const ALL_MODES: GameMode[] = ["normal", "brainrot", "nsfw"];

// ---- Filler lines per mode (short, panicky, in-character for Kyle) ----
const FILLER_LINES: Record<GameMode, string[]> = {
  normal: [
    "Uhh... hold on, let me look around...",
    "Wait wait wait, give me a second...",
    "Okay okay, I'm checking...",
    "Hmm, let me see here...",
    "One sec, one sec...",
  ],
  brainrot: [
    "Yooo hold up, let me rizz around real quick...",
    "Bruh wait wait, one sec fr fr...",
    "Okay okay lowkey checking no cap...",
    "Hmm let me sigma grindset this real quick...",
    "Aight aight give me a sec on god...",
  ],
  nsfw: [
    "Hold the fuck on, let me look around...",
    "Shit shit shit, gimme a damn second...",
    "Okay okay, I'm fucking checking...",
    "Hmm, let me see what the hell is here...",
    "One goddamn sec, one sec...",
  ],
};

const BASE_OUTPUT_DIR = path.resolve(
  import.meta.dir,
  "../../app/public/fillers",
);

async function generateFiller(
  text: string,
  index: number,
  mode: GameMode,
): Promise<void> {
  console.log(`  [${mode}/${index}] Generating: "${text}"`);

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

  const modeDir = path.join(BASE_OUTPUT_DIR, mode);
  const outputPath = path.join(modeDir, `filler_${index}.mp3`);
  await Bun.write(outputPath, buffer);
  console.log(
    `  [${mode}/${index}] Saved: ${outputPath} (${buffer.length} bytes)`,
  );
}

async function main() {
  console.log("Kyle Filler Line Generator (all modes)");
  console.log(`Output: ${BASE_OUTPUT_DIR}/{normal,brainrot,nsfw}/\n`);

  // Ensure output dirs exist for each mode
  for (const mode of ALL_MODES) {
    const modeDir = path.join(BASE_OUTPUT_DIR, mode);
    if (!existsSync(modeDir)) {
      await mkdir(modeDir, { recursive: true });
    }
  }

  // Generate all modes × 5 lines in parallel
  const jobs = ALL_MODES.flatMap((mode) =>
    FILLER_LINES[mode].map((line, i) => generateFiller(line, i, mode)),
  );
  await Promise.all(jobs);

  console.log(
    `\nDone! Generated ${jobs.length} filler lines across ${ALL_MODES.length} modes.`,
  );
}

main().catch(console.error);

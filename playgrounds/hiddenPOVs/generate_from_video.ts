/*
"""
Purpose: This script asks for a video path, extracts 10 evenly spaced frames with ffmpeg, then sends those overlapping room frames to Google GenAI.
It generates one shared, detailed room description plus per-frame descriptions that include a POV-specific angle/visibility note, and saves results to frame_descriptions.json.
"""
*/

import { createInterface } from "readline";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});
const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

function runCommand(cmd: string[], label: string) {
  const result = Bun.spawnSync(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = Buffer.from(result.stderr).toString("utf8").trim();
    throw new Error(`${label} failed${stderr ? `: ${stderr}` : ""}`);
  }

  return {
    stdout: Buffer.from(result.stdout).toString("utf8").trim(),
  };
}

function ensureToolAvailable(tool: "ffmpeg" | "ffprobe") {
  try {
    runCommand([tool, "-version"], tool);
  } catch {
    throw new Error(`${tool} is not installed or not in PATH`);
  }
}

function formatTimestamp(value: number): string {
  return value.toFixed(3);
}

function videoNameFromPath(videoPath: string): string {
  const fileName = videoPath.split("/").pop() ?? videoPath;
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return baseName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getDirname(path: string): string {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex >= 0 ? path.slice(0, slashIndex) : ".";
}

function mimeType(path: string): string {
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return trimmed;
}

type FrameDescription = {
  frame: string;
  description: string;
  pov: string;
};

type FrameAnalysis = {
  commonRoomDescription: string;
  frames: FrameDescription[];
};

function isFrameAnalysis(value: unknown): value is FrameAnalysis {
  if (typeof value !== "object" || value === null) return false;

  const maybe = value as { commonRoomDescription?: unknown; frames?: unknown };
  if (typeof maybe.commonRoomDescription !== "string") return false;
  if (!Array.isArray(maybe.frames)) return false;

  return maybe.frames.every((frame) => {
    if (typeof frame !== "object" || frame === null) return false;
    const item = frame as {
      frame?: unknown;
      description?: unknown;
      pov?: unknown;
    };
    return (
      typeof item.frame === "string" &&
      typeof item.description === "string" &&
      typeof item.pov === "string"
    );
  });
}

async function describeFrames(framePaths: string[]): Promise<FrameAnalysis> {
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  for (const [index, framePath] of framePaths.entries()) {
    parts.push({
      text: `Frame ${index + 1} (${framePath.split("/").pop() ?? framePath})`,
    });
    const bytes = await Bun.file(framePath).arrayBuffer();
    parts.push({
      inlineData: {
        mimeType: mimeType(framePath),
        data: Buffer.from(bytes).toString("base64"),
      },
    });
  }

  parts.push({
    text: 'Analyze these 10 overlapping frames of the same room from nearby viewpoints. Return JSON only with this exact schema: {"commonRoomDescription": string, "frames": [{"frame": string, "description": string, "pov": string}]}. Requirements: commonRoomDescription should be a rich, detailed description shared across all frames. For each frame, keep description consistent with the same room while allowing small visual differences. For pov, explain that specific frame\'s camera angle/position and what becomes more/less visible from that viewpoint. Use frame values frame_1 to frame_10 in order.',
  });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts }],
  });

  const responseParts = (response.candidates?.[0]?.content?.parts ??
    []) as Array<{ text?: string }>;
  const text = responseParts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Gemini returned no text response for frame descriptions");
  }

  const parsed = JSON.parse(extractJson(text)) as unknown;
  if (!isFrameAnalysis(parsed)) {
    throw new Error(
      "Gemini response did not match expected frame description schema",
    );
  }

  if (parsed.frames.length !== framePaths.length) {
    throw new Error(
      `Gemini returned ${parsed.frames.length} frame descriptions, expected ${framePaths.length}`,
    );
  }

  return parsed;
}

async function extractTenFrames(
  videoPath: string,
): Promise<{ framePaths: string[]; outputDir: string }> {
  ensureToolAvailable("ffmpeg");
  ensureToolAvailable("ffprobe");

  if (!(await Bun.file(videoPath).exists())) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const durationOutput = runCommand(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    "ffprobe duration lookup",
  ).stdout;

  const duration = Number.parseFloat(durationOutput);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Unable to determine valid duration for: ${videoPath}`);
  }

  const videoName = videoNameFromPath(videoPath);
  const outputDir = `${import.meta.dir}/frames_${videoName}`;
  await Bun.$`mkdir -p ${outputDir}`;

  const framePaths: string[] = [];
  const totalFrames = 10;
  const interval = duration / totalFrames;

  for (let i = 0; i < totalFrames; i++) {
    const timestamp = interval * i;
    const outputPath = `${outputDir}/frame_${i + 1}.png`;

    runCommand(
      [
        "ffmpeg",
        "-y",
        "-ss",
        formatTimestamp(timestamp),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        outputPath,
      ],
      `ffmpeg frame extraction (${i + 1}/${totalFrames})`,
    );

    framePaths.push(outputPath);
  }

  return { framePaths, outputDir };
}

async function main() {
  console.log("Video → 10 Frames + Scene Descriptions\n");

  try {
    const videoPath = (await ask("→ Path to video: ")).trim();
    if (!videoPath) {
      console.log("  [error] no video path provided");
      return;
    }

    console.log("  [extracting 10 frames...]");
    const { framePaths: frames, outputDir } = await extractTenFrames(videoPath);
    console.log("  [done] saved frames:");
    for (const frame of frames) {
      console.log(`   - ${frame}`);
    }

    console.log("  [describing frames with Gemini...]");
    const analysis = await describeFrames(frames);
    const descriptionsPath = `${outputDir}/frame_descriptions.json`;
    await Bun.write(descriptionsPath, JSON.stringify(analysis, null, 2));
    console.log(`  [done] saved descriptions: ${descriptionsPath}`);

    console.log("  [summary]");
    console.log(
      `   - shared room description length: ${analysis.commonRoomDescription.length} chars`,
    );
    console.log(`   - frame POV descriptions: ${analysis.frames.length}`);
  } catch (error) {
    console.error("  [error]", error);
  } finally {
    rl.close();
  }
}

main().catch(console.error);

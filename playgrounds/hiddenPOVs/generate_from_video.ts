/*
"""
Purpose: This script reads final.mp4 from the project root, extracts 10 evenly spaced frames with ffmpeg, then sends those overlapping room frames to Google GenAI.
It generates per-frame scene descriptions and POV notes, then saves frame_descriptions.json as a list of FrameNode objects.
"""
*/

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});

type FrameNode = {
  frame: string;
  description: string;
  pov: string;
  coordinates: [number, number, number];
  image_filepath: string;
};

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

function isFrameNodeBase(
  value: unknown,
): value is Omit<FrameNode, "image_filepath" | "coordinates"> {
  if (typeof value !== "object" || value === null) return false;

  const item = value as {
    frame?: unknown;
    description?: unknown;
    pov?: unknown;
  };

  return (
    typeof item.frame === "string" &&
    typeof item.description === "string" &&
    typeof item.pov === "string"
  );
}

function normalizeFrameNodes(
  value: unknown,
  framePaths: string[],
): FrameNode[] {
  if (!Array.isArray(value)) {
    throw new Error("Gemini response was not an array of frame nodes");
  }

  if (value.length !== framePaths.length) {
    throw new Error(
      `Gemini returned ${value.length} frame descriptions, expected ${framePaths.length}`,
    );
  }

  const frameNodes: FrameNode[] = value.map((node, index) => {
    if (!isFrameNodeBase(node)) {
      throw new Error(
        "Gemini response did not match expected FrameNode schema",
      );
    }

    return {
      frame: node.frame,
      description: node.description,
      pov: node.pov,
      coordinates: [0, 0, 0],
      image_filepath: framePaths[index]!,
    };
  });

  return frameNodes;
}

async function describeFrames(framePaths: string[]): Promise<FrameNode[]> {
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
    text: 'Analyze these 10 overlapping frames of the same room from nearby viewpoints. Return JSON only as an array where each item has this schema: {"frame": string, "description": string, "pov": string}. Keep descriptions consistent as the same room while allowing small visual differences per frame. The pov field must describe that frame\'s camera angle/position and what becomes more or less visible from that viewpoint. Use frame values frame_1 to frame_10 in order.',
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
  return normalizeFrameNodes(parsed, framePaths);
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
    const videoPath = `${import.meta.dir}/../../final.mp4`;
    console.log(`  [input] ${videoPath}`);

    console.log("  [extracting 10 frames...]");
    const { framePaths: frames, outputDir } = await extractTenFrames(videoPath);
    console.log("  [done] saved frames:");
    for (const frame of frames) {
      console.log(`   - ${frame}`);
    }

    console.log("  [describing frames with Gemini...]");
    const frameNodes = await describeFrames(frames);
    const descriptionsPath = `${outputDir}/frame_descriptions.json`;
    await Bun.write(descriptionsPath, JSON.stringify(frameNodes, null, 2));
    console.log(`  [done] saved descriptions: ${descriptionsPath}`);

    console.log("  [summary]");
    console.log(`   - frame nodes: ${frameNodes.length}`);
    console.log(
      `   - first node image path: ${frameNodes[0]?.image_filepath ?? "n/a"}`,
    );
  } catch (error) {
    console.error("  [error]", error);
  }
}

main().catch(console.error);

/**
 * generateGameState.ts
 *
 * Server-side game state generator. Ported from playgrounds/mistral/initGameState.ts.
 *
 * Pipeline:
 *   1. Load frame_descriptions.json from public/
 *   2. Send all text descriptions to Mistral Large (structured output) →
 *      generates roomDescription, winCondition, loseCondition, and an ordered
 *      game tree of 3-5 ClueNodes.
 *   3. Assemble the full GameState and write to disk as both
 *      initGameState.json and gameState.json.
 */

import { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { FrameNode, ClueNode, GameNode, GameState } from "./gameEngine";

// ---------------------------------------------------------------------------
// Mistral client
// ---------------------------------------------------------------------------

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const MISTRAL_MODEL = "mistral-large-latest";

// ---------------------------------------------------------------------------
// Frame descriptions loader
// ---------------------------------------------------------------------------

type FrameDescriptionsFile = {
  commonRoomDescription: string;
  frames: Array<{
    frame: string;
    description: string;
    pov: string;
    coordinates: {
      pos: { x: number; y: number; z: number };
      rot: { x: number; y: number };
    };
    image_filepath: string;
  }>;
};

async function loadFrameDescriptions(): Promise<{
  commonRoomDescription: string;
  frames: FrameNode[];
}> {
  const filePath = path.join(
    process.cwd(),
    "public",
    "frame_descriptions.json",
  );

  if (!existsSync(filePath)) {
    throw new Error(
      "frame_descriptions.json not found in public/. Copy it from playgrounds/hiddenPOVs/frames_final/.",
    );
  }

  const raw = await readFile(filePath, "utf-8");
  const file: FrameDescriptionsFile = JSON.parse(raw);

  const frames: FrameNode[] = file.frames.map((f) => ({
    frame: f.frame,
    description: f.description,
    pov: f.pov,
    coordinates: f.coordinates ?? {
      pos: { x: 0, y: 0, z: 0 },
      rot: { x: 0, y: 0 },
    },
    image_filepath: f.image_filepath ?? null,
  }));

  return { commonRoomDescription: file.commonRoomDescription, frames };
}

// ---------------------------------------------------------------------------
// Mistral structured output schema (Zod + JSON schema for constrained decoding)
// ---------------------------------------------------------------------------

const MistralGameTreeSchema = z.object({
  roomDescription: z
    .string()
    .describe(
      "A concise 2-3 sentence summary of the room, suitable as a game intro.",
    ),
  winCondition: z
    .string()
    .describe(
      "A description of what the player must do to win, e.g. 'Find the hidden key behind the fireplace and use it on the locked archway to escape.'",
    ),
  loseCondition: z
    .string()
    .nullable()
    .describe(
      "Optional lose condition, e.g. 'Kyle panics and collapses after 20 failed attempts.' or null if no lose state.",
    ),
  gameTree: z
    .array(
      z.object({
        frameId: z
          .string()
          .describe(
            "The object location ID this clue is attached to (e.g. 'whiteboard', 'bookshelf', 'laptop'). Must be one of the provided object locations — NOT a panoramic frame (frame_*).",
          ),
        clueId: z.string().describe("A unique short ID for this clue node."),
        discovery: z
          .string()
          .describe(
            "What Kyle finds when the player arrives at this location at the right time. Written in third person as narration.",
          ),
        premature_discovery: z
          .string()
          .describe(
            "What Kyle finds if the player visits this location before solving the previous clue. Should feel natural — something is locked, stuck, or incomplete.",
          ),
        riddle: z
          .string()
          .nullable()
          .describe(
            "The riddle the player must solve. null for the final exit node.",
          ),
        answer: z
          .string()
          .nullable()
          .describe(
            "The keyword answer to the riddle. null for the final exit node.",
          ),
        hiddenAreaDescription: z
          .string()
          .describe(
            "A vivid description of the hidden area that Kyle discovers (e.g. 'inside a dusty drawer with a crumpled note among old quills'). Used to generate a POV image later.",
          ),
      }),
    )
    .describe(
      "Ordered array of 3-5 clue nodes forming the puzzle chain. The last node must be the exit (riddle: null, answer: null).",
    ),
});

type MistralGameTreeResponse = z.infer<typeof MistralGameTreeSchema>;

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildInitPrompt(
  commonRoomDescription: string,
  frames: FrameNode[],
): string {
  const objectFrames = frames.filter((f) => !f.frame.startsWith("frame_"));
  const panoramicFrames = frames.filter((f) => f.frame.startsWith("frame_"));

  const objectDescriptions = objectFrames
    .map(
      (f, i) =>
        `Object ${i + 1} — "${f.frame}":\n  Description: ${f.description}\n  POV: ${f.pov}`,
    )
    .join("\n\n");

  const panoramicDescriptions = panoramicFrames
    .map(
      (f, i) =>
        `Viewpoint ${i + 1} — "${f.frame}":\n  Description: ${f.description}\n  POV: ${f.pov}`,
    )
    .join("\n\n");

  return `
You are a Game Master designing an escape room puzzle set in the following room.

## Room Overview
${commonRoomDescription}

## Interactable Objects (${objectFrames.length} — clue nodes MUST use these)
${objectDescriptions}

## Panoramic Viewpoints (${panoramicFrames.length} — for context only, do NOT attach clues to these)
${panoramicDescriptions}

## Your Task
Design a compelling escape room scenario using these locations. You must:

1. **Room Description**: Write a concise 2-3 sentence atmospheric summary of the room from the perspective of someone trapped inside.

2. **Win Condition**: Choose one of these escape scenarios:
   - The player finds a **hidden door** in one of the hidden places and walks through it to escape.
   - The player finds a **hidden key** that unlocks a **visible door** (already visible from the start, but locked).
   - Both the **key and the door are hidden** — the player must discover both.
   Pick whichever feels most natural for this room.

3. **Lose Condition**: Optionally define a lose condition (e.g. Kyle panics after too many wrong answers), or set null.

4. **Game Tree**: Select 3-5 of the ${objectFrames.length} object locations as puzzle locations and create an ordered chain of clue nodes:
   - **IMPORTANT: You MUST only use object locations** (${objectFrames
     .map((f) => `"${f.frame}"`)
     .join(", ")}). Do NOT use panoramic viewpoints (frame_*).
   - Each node is attached to a specific object by its ID (e.g. "whiteboard", "bookshelf", "laptop").
   - Each node has a discovery (what Kyle finds), a premature_discovery (what he finds if he goes too early), a riddle, an answer keyword, and a hiddenAreaDescription for generating a visual.
   - **The riddles must be solvable.** Each riddle answer should be a single word or short phrase that can be spoken aloud.
   - **The riddle answers should guide the player to the next location.** For example, if the answer is "bookshelf", the player should naturally think to go to the bookshelf next.
   - **The last node must be the exit node** with riddle: null and answer: null. Its discovery should describe Kyle escaping.
   - Make the premature discoveries feel natural — something is locked, stuck, sealed, or incomplete.
   - The hiddenAreaDescription should be vivid and specific enough to generate a realistic first-person POV image of that hidden spot.

5. **Consistency**: All clue text must be consistent with the room's visual descriptions. Don't reference objects that aren't described in the locations.

Return ONLY the structured JSON output matching the required schema.
`.trim();
}

// ---------------------------------------------------------------------------
// Explicit JSON schema for Mistral's server-side constrained decoding
// ---------------------------------------------------------------------------

const GAME_TREE_JSON_SCHEMA = {
  type: "object",
  required: ["roomDescription", "winCondition", "loseCondition", "gameTree"],
  additionalProperties: false,
  properties: {
    roomDescription: {
      type: "string",
      description:
        "A concise 2-3 sentence summary of the room, suitable as a game intro.",
    },
    winCondition: {
      type: "string",
      description:
        "A description of what the player must do to win, e.g. 'Find the hidden key behind the fireplace and use it on the locked archway to escape.'",
    },
    loseCondition: {
      type: ["string", "null"],
      description:
        "Optional lose condition, e.g. 'Kyle panics and collapses after 20 failed attempts.' or null if no lose state.",
    },
    gameTree: {
      type: "array",
      description:
        "Ordered array of 3-5 clue nodes forming the puzzle chain. The last node must be the exit (riddle: null, answer: null).",
      items: {
        type: "object",
        required: [
          "frameId",
          "clueId",
          "discovery",
          "premature_discovery",
          "riddle",
          "answer",
          "hiddenAreaDescription",
        ],
        additionalProperties: false,
        properties: {
          frameId: {
            type: "string",
            description:
              "The object location ID this clue is attached to (e.g. 'whiteboard', 'bookshelf', 'laptop'). Must be one of the provided object locations — NOT a panoramic frame (frame_*).",
          },
          clueId: {
            type: "string",
            description: "A unique short ID for this clue node.",
          },
          discovery: {
            type: "string",
            description:
              "What Kyle finds when the player arrives at this location at the right time. Written in third person as narration.",
          },
          premature_discovery: {
            type: "string",
            description:
              "What Kyle finds if the player visits this location before solving the previous clue. Should feel natural — something is locked, stuck, or incomplete.",
          },
          riddle: {
            type: ["string", "null"],
            description:
              "The riddle the player must solve. null for the final exit node.",
          },
          answer: {
            type: ["string", "null"],
            description:
              "The keyword answer to the riddle. null for the final exit node.",
          },
          hiddenAreaDescription: {
            type: "string",
            description:
              "A vivid description of the hidden area that Kyle discovers (e.g. 'inside a dusty drawer with a crumpled note among old quills'). Used to generate a POV image later.",
          },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Stage 2: Mistral — Generate game tree (structured output)
// ---------------------------------------------------------------------------

async function generateGameTree(
  commonRoomDescription: string,
  frames: FrameNode[],
): Promise<MistralGameTreeResponse> {
  const prompt = buildInitPrompt(commonRoomDescription, frames);

  console.log("  [mistral] Generating game tree...");
  const response = await mistral.chat.complete({
    model: MISTRAL_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an expert game designer. You generate structured JSON for escape room scenarios. Always respond with a complete, valid JSON object matching the required schema. Never return an empty object.",
      },
      { role: "user", content: prompt },
    ],
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "game_tree",
        schemaDefinition: GAME_TREE_JSON_SCHEMA,
        strict: true,
      },
    },
    temperature: 0.7,
    maxTokens: 4096,
  });
  console.log("  [mistral] Done.");

  const rawContent = response.choices?.[0]?.message?.content;
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("Mistral returned no content in the response.");
  }

  console.log(
    `  [debug] Raw content (first 300 chars): ${rawContent.slice(0, 300)}`,
  );

  const rawObj = JSON.parse(rawContent);
  const parsed = MistralGameTreeSchema.parse(rawObj);
  console.log("  [mistral] Parsed successfully.");

  // Validate that all frameIds reference actual object locations
  const validFrameIds = new Set(frames.map((f) => f.frame));
  const objectOnlyIds = new Set(
    frames.filter((f) => !f.frame.startsWith("frame_")).map((f) => f.frame),
  );
  for (const node of parsed.gameTree) {
    if (!validFrameIds.has(node.frameId)) {
      throw new Error(
        `Game tree references unknown location "${node.frameId}". Valid locations: ${[...validFrameIds].join(", ")}`,
      );
    }
    if (node.frameId.startsWith("frame_")) {
      throw new Error(
        `Game tree node "${node.clueId}" is attached to panoramic viewpoint "${node.frameId}", but clues can only be attached to object locations: ${[...objectOnlyIds].join(", ")}`,
      );
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Main: assemble and persist the full GameState
// ---------------------------------------------------------------------------

export async function generateAndSaveGameState(): Promise<GameState> {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   GENERATE GAME STATE                ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ── Stage 1: Load frame descriptions ──
  console.log("[Stage 1] Loading frame descriptions...");
  const { commonRoomDescription, frames } = await loadFrameDescriptions();
  console.log(`  Loaded ${frames.length} frames.`);
  console.log(`  Room: ${commonRoomDescription.slice(0, 80)}...\n`);

  // ── Stage 2: Generate game tree with Mistral ──
  console.log("[Stage 2] Generating game tree with Mistral...");
  const mistralResult = await generateGameTree(commonRoomDescription, frames);
  console.log(
    `  Room description: ${mistralResult.roomDescription.slice(0, 80)}...`,
  );
  console.log(`  Win condition: ${mistralResult.winCondition}`);
  console.log(`  Lose condition: ${mistralResult.loseCondition ?? "none"}`);
  console.log(`  Game tree nodes: ${mistralResult.gameTree.length}`);
  for (const node of mistralResult.gameTree) {
    console.log(
      `    - ${node.clueId} @ ${node.frameId}: ${node.riddle ?? "[EXIT]"}`,
    );
  }
  console.log();

  // ── Build frame lookup ──
  const frameMap = new Map(frames.map((f) => [f.frame, f]));

  // ── Build ClueNodes ──
  const clueNodes: ClueNode[] = mistralResult.gameTree.map((node) => ({
    id: node.clueId,
    discovery: node.discovery,
    premature_discovery: node.premature_discovery,
    riddle: node.riddle,
    answer: node.answer,
    hiddenAreaDescription: node.hiddenAreaDescription,
    hiddenPovImagePath: null,
  }));

  // ── Build GameTree (ordered puzzle chain) ──
  const gameTree: GameNode[] = mistralResult.gameTree.map((node, i) => ({
    frame: frameMap.get(node.frameId)!,
    clue: clueNodes[i] ?? null,
  }));

  // ── Build allLocations (all frames/objects, with clue attached if applicable) ──
  const clueByFrameId = new Map(
    mistralResult.gameTree.map((n, i) => [n.frameId, clueNodes[i]]),
  );

  const allLocations: GameNode[] = frames.map((frame) => ({
    frame,
    clue: clueByFrameId.get(frame.frame) ?? null,
  }));

  // ── Assemble GameState ──
  const state: GameState = {
    roomDescription: mistralResult.roomDescription,
    gameMasterPrompt: "",
    winCondition: mistralResult.winCondition,
    loseCondition: mistralResult.loseCondition,
    gameTree,
    allLocations,
    currentLocation: frames[0]?.frame ?? "frame_1",
    currentClueIndex: 0,
    visitHistory: [],
    riddlesSolved: 0,
    conversationHistory: [],
    gameOver: false,
  };

  // ── Save to disk (both initGameState.json and gameState.json) ──
  const dataDir = path.join(process.cwd(), "data");
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  const serializable = {
    ...state,
    gameMasterPrompt: "[rebuilt each turn — see buildGameMasterPrompt()]",
  };
  const json = JSON.stringify(serializable, null, 2);

  const initPath = path.join(dataDir, "initGameState.json");
  const livePath = path.join(dataDir, "gameState.json");

  await writeFile(initPath, json);
  await writeFile(livePath, json);

  console.log(`[Done] GameState saved to:`);
  console.log(`  - ${initPath} (pristine copy)`);
  console.log(`  - ${livePath} (live save)`);
  console.log(
    `  Game tree: ${gameTree.map((n) => `${n.clue!.id}(${n.frame.frame})`).join(" → ")}`,
  );
  console.log(`  All locations: ${allLocations.length} frames`);
  console.log(
    `  Puzzle locations: ${gameTree.length} | Environmental: ${allLocations.length - gameTree.length}`,
  );

  return state;
}

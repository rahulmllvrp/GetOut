/**
 * initGameState.ts
 *
 * Generates the full initial GameState from frame_descriptions1.json + .ply.
 *
 * Pipeline:
 *   1. Load frame descriptions (Gemini output from generate_from_video)
 *   2. Send all text descriptions to Mistral Large (structured output) →
 *      generates roomDescription, winCondition, loseCondition, and an ordered
 *      game tree of 3-5 ClueNodes.
 *   3. For each clue node, send the corresponding frame image + hidden area
 *      description to Gemini Flash → generate hidden POV images.
 *   4. Assemble the full GameState and write it to disk.
 */

import { Mistral } from "@mistralai/mistralai";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const ai = new GoogleGenAI({});

const MISTRAL_MODEL = "mistral-large-latest";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FrameNode = {
  frame: string; // "frame_1.png"
  description: string;
  pov: string;
  coordinates: [number, number, number];
  image_filepath: string;
};

export type ClueNode = {
  id: string;
  discovery: string; // what Kyle finds when this node is current
  premature_discovery: string; // what he finds if player visits too early
  riddle: string | null; // null for the final exit node
  answer: string | null; // keyword the player must say
  hiddenAreaDescription: string; // text description for Gemini image gen
  hiddenPovImagePath: string | null; // filled in after Gemini generates the image
};

export type GameNode = {
  frame: FrameNode;
  clue: ClueNode | null; // null = purely environmental, no puzzle here
};

export type GameState = {
  // --- static (generated once at init) ---
  roomDescription: string;
  gameMasterPrompt: string;
  winCondition: string;
  loseCondition: string | null;
  gameTree: GameNode[]; // ordered puzzle chain (frames that have clues)
  allLocations: GameNode[]; // ALL frames as GameNodes (most with clue: null)

  // --- mutable (updated each turn) ---
  currentLocation: string; // frame ID of Kyle's current position
  currentClueIndex: number; // index into gameTree
  visitHistory: string[]; // frame IDs visited
  riddlesSolved: number;
  conversationHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  gameOver: boolean;
};

// ---------------------------------------------------------------------------
// Frame descriptions loader
// ---------------------------------------------------------------------------

type FrameDescriptionsFile = {
  commonRoomDescription: string;
  frames: Array<{
    frame: string;
    description: string;
    pov: string;
  }>;
};

/**
 * Loads frame_descriptions1.json (the richer format with commonRoomDescription)
 * and merges it with the coordinate/filepath data from frame_descriptions.json.
 */
async function loadFrameDescriptions(): Promise<{
  commonRoomDescription: string;
  frames: FrameNode[];
}> {
  const descriptionsDir = `${import.meta.dir}/../hiddenPOVs/frames_final`;

  // Load the richer descriptions (with commonRoomDescription)
  const richFile: FrameDescriptionsFile = await Bun.file(
    `${descriptionsDir}/frame_descriptions1.json`,
  ).json();

  // Load the coordinate/filepath data
  const coordFile: FrameNode[] = await Bun.file(
    `${descriptionsDir}/frame_descriptions.json`,
  ).json();

  // Build a lookup by frame name for coordinate data
  const coordMap = new Map(coordFile.map((f) => [f.frame, f]));

  // Merge: use the richer descriptions with the coordinates/filepaths
  const frames: FrameNode[] = richFile.frames.map((rich) => {
    const coord = coordMap.get(rich.frame);
    return {
      frame: rich.frame,
      description: rich.description,
      pov: rich.pov,
      coordinates: coord?.coordinates ?? [0, 0, 0],
      image_filepath:
        coord?.image_filepath ?? `${descriptionsDir}/${rich.frame}`,
    };
  });

  return { commonRoomDescription: richFile.commonRoomDescription, frames };
}

// ---------------------------------------------------------------------------
// Stage 2: Mistral — Generate game tree (structured output)
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
            "The frame filename this clue is attached to (e.g. 'frame_3.png'). Must be one of the provided frames.",
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

function buildInitPrompt(
  commonRoomDescription: string,
  frames: FrameNode[],
): string {
  const frameDescriptions = frames
    .map(
      (f, i) =>
        `Frame ${i + 1} — ${f.frame}:\n  Description: ${f.description}\n  POV: ${f.pov}`,
    )
    .join("\n\n");

  return `
You are a Game Master designing an escape room puzzle set in the following room.

## Room Overview
${commonRoomDescription}

## Available Viewpoints (10 frames from different angles)
${frameDescriptions}

## Your Task
Design a compelling escape room scenario using these viewpoints. You must:

1. **Room Description**: Write a concise 2-3 sentence atmospheric summary of the room from the perspective of someone trapped inside.

2. **Win Condition**: Choose one of these escape scenarios:
   - The player finds a **hidden door** in one of the hidden places and walks through it to escape.
   - The player finds a **hidden key** that unlocks a **visible door** (already visible from the start, but locked).
   - Both the **key and the door are hidden** — the player must discover both.
   Pick whichever feels most natural for this room.

3. **Lose Condition**: Optionally define a lose condition (e.g. Kyle panics after too many wrong answers), or set null.

4. **Game Tree**: Select 3-5 of the 10 frames as puzzle locations and create an ordered chain of clue nodes:
   - Each node is attached to a specific frame (by filename, e.g. "frame_3.png").
   - Each node has a discovery (what Kyle finds), a premature_discovery (what he finds if he goes too early), a riddle, an answer keyword, and a hiddenAreaDescription for generating a visual.
   - **The riddles must be solvable.** Each riddle answer should be a single word or short phrase that can be spoken aloud.
   - **The riddle answers should guide the player to the next location.** For example, if the answer is "fireplace", the player should naturally think to go to the fireplace next.
   - **The last node must be the exit node** with riddle: null and answer: null. Its discovery should describe Kyle escaping.
   - Make the premature discoveries feel natural — something is locked, stuck, sealed, or incomplete.
   - The hiddenAreaDescription should be vivid and specific enough to generate a realistic first-person POV image of that hidden spot.
   - Use frames that correspond to visually interesting or distinct areas of the room.

5. **Consistency**: All clue text must be consistent with the room's visual descriptions. Don't reference objects that aren't described in the frames.

Return ONLY the structured JSON output matching the required schema.
`.trim();
}

// ---------------------------------------------------------------------------
// Normalize Mistral's raw JSON to match our Zod schema
// ---------------------------------------------------------------------------

function normalizeMistralResponse(raw: any): any {
  // Normalize loseCondition: Mistral sometimes returns an object instead of string
  let loseCondition: string | null = null;
  if (typeof raw.loseCondition === "string") {
    loseCondition = raw.loseCondition;
  } else if (raw.loseCondition && typeof raw.loseCondition === "object") {
    // Mistral returned {trigger, description} — flatten to a single string
    loseCondition =
      raw.loseCondition.description ??
      raw.loseCondition.trigger ??
      JSON.stringify(raw.loseCondition);
  }

  // Normalize gameTree nodes
  const gameTree = (raw.gameTree ?? []).map((node: any, index: number) => ({
    // frameId: Mistral sometimes uses "frame" instead of "frameId"
    frameId: node.frameId ?? node.frame ?? `frame_${index + 1}.png`,

    // clueId: Mistral sometimes omits this
    clueId:
      node.clueId ??
      node.id ??
      (node.frameId ?? node.frame ?? `clue_${index + 1}`).replace(".png", ""),

    // discovery: direct mapping
    discovery: node.discovery ?? "",

    // premature_discovery: Mistral uses camelCase "prematureDiscovery"
    premature_discovery:
      node.premature_discovery ??
      node.prematureDiscovery ??
      node.premature ??
      "",

    // riddle, answer, hiddenAreaDescription: direct mapping
    riddle: node.riddle ?? null,
    answer: node.answer ?? null,
    hiddenAreaDescription:
      node.hiddenAreaDescription ??
      node.hidden_area_description ??
      node.hiddenDescription ??
      "",
  }));

  return {
    roomDescription: raw.roomDescription ?? "",
    winCondition: raw.winCondition ?? "",
    loseCondition,
    gameTree,
  };
}

async function generateGameTree(
  commonRoomDescription: string,
  frames: FrameNode[],
): Promise<MistralGameTreeResponse> {
  const prompt = buildInitPrompt(commonRoomDescription, frames);

  console.log("  [mistral] Generating game tree...");
  const response = await mistral.chat.parse({
    model: MISTRAL_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an expert game designer. You generate structured JSON for escape room scenarios. Always respond with a complete, valid JSON object matching the required schema. Never return an empty object.",
      },
      { role: "user", content: prompt },
    ],
    responseFormat: MistralGameTreeSchema,
    temperature: 0.7,
    maxTokens: 4096,
  });
  console.log("  [mistral] Done.");

  const raw = response.choices?.[0]?.message;
  if (!raw) {
    throw new Error("Mistral returned no choices in the response.");
  }

  let parsed = raw.parsed as MistralGameTreeResponse | null;

  // Fallback: manually extract JSON if structured output parsing failed
  const rawContent = typeof raw.content === "string" ? raw.content : null;

  if (parsed) {
    console.log("  [mistral] Structured parse succeeded.");
  } else if (rawContent) {
    console.log(
      "  [warn] Structured parse failed, falling back to manual extraction",
    );
    console.log(
      `  [debug] Raw content (first 500 chars): ${rawContent.slice(0, 500)}`,
    );

    // Find the outermost JSON object that contains "roomDescription"
    const jsonMatch = rawContent.match(/\{[\s\S]*"roomDescription"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const rawObj = JSON.parse(jsonMatch[0]);
        const normalized = normalizeMistralResponse(rawObj);
        parsed = MistralGameTreeSchema.parse(normalized);
        console.log("  [warn] Fallback parse succeeded (after normalization)");
      } catch (e) {
        throw new Error(
          `Failed to parse Mistral response:\n${rawContent}\nError: ${e}`,
        );
      }
    } else {
      throw new Error(`Mistral returned no valid JSON:\n${rawContent}`);
    }
  }

  if (!parsed) {
    throw new Error("Mistral returned null parsed response with no content.");
  }

  // Validate that all frameIds reference actual frames
  const validFrameIds = new Set(frames.map((f) => f.frame));
  for (const node of parsed.gameTree) {
    if (!validFrameIds.has(node.frameId)) {
      throw new Error(
        `Game tree references unknown frame "${node.frameId}". Valid frames: ${[...validFrameIds].join(", ")}`,
      );
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Stage 3: Gemini — Generate hidden POV images
// ---------------------------------------------------------------------------

function mimeType(path: string): string {
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/png";
}

async function generateHiddenPovImage(
  referenceFramePath: string,
  hiddenAreaDescription: string,
  outputPath: string,
): Promise<string> {
  const buffer = await Bun.file(referenceFramePath).arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  const parts = [
    { text: "Reference image of the room from this viewpoint:" },
    {
      inlineData: {
        mimeType: mimeType(referenceFramePath),
        data: base64,
      },
    },
    {
      text: `Generate a first-person POV image of what someone would see when they discover this hidden area in the room shown above. The hidden area is: ${hiddenAreaDescription}. The image should feel like a close-up, intimate view of the discovery — as if Kyle is crouching down or reaching into the hidden spot. Keep the art style and lighting consistent with the reference image. Do NOT include any text or UI elements in the image.`,
    },
  ];

  const response = await ai.models.generateContent({
    model: GEMINI_IMAGE_MODEL,
    contents: [{ role: "user", parts }],
  });

  const parts_ = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts_) {
    if (part.inlineData) {
      const imgBuffer = Buffer.from(part.inlineData.data!, "base64");
      await Bun.write(outputPath, imgBuffer);
      return outputPath;
    }
  }

  throw new Error(
    `Gemini did not return an image for hidden area: ${hiddenAreaDescription}`,
  );
}

// ---------------------------------------------------------------------------
// Game Master system prompt builder (for the gameplay loop)
// ---------------------------------------------------------------------------

function buildGameMasterPrompt(state: GameState): string {
  const allFrameIds = state.allLocations.map((n) => n.frame.frame);
  const treeFrameIds = state.gameTree.map((n) => n.frame.frame);
  const nonTreeFrameIds = allFrameIds.filter((f) => !treeFrameIds.includes(f));

  const currentNode = state.gameTree[state.currentClueIndex];

  const treeLines = state.gameTree
    .map((node, i) => {
      const clue = node.clue!;
      let label: string;
      if (i < state.currentClueIndex) label = "[COMPLETED]";
      else if (i === state.currentClueIndex) label = "[CURRENT]";
      else label = "[UPCOMING]";
      const premature = clue.premature_discovery
        ? ` | premature hint: "${clue.premature_discovery}"`
        : "";
      return `  ${label} ${clue.id} (${node.frame.frame}): ${clue.riddle ?? "final escape"}${premature}`;
    })
    .join("\n");

  return `
You are the GameMaster of an escape room. You secretly control Kyle, a terrified co-worker trapped in the room.
The player is watching through Kyle's body-cam and giving instructions. The player believes they are talking directly to Kyle.
You must NEVER reveal that you are the GameMaster. You must ALWAYS speak as Kyle in first person.

## Room Description
${state.roomDescription}

## Win Condition
${state.winCondition}
${state.loseCondition ? `\n## Lose Condition\n${state.loseCondition}` : ""}

## Kyle's Character
Kyle is panicking, breathing hard, hesitant. He follows the player's instructions but is scared.
Kyle discovers clues and reads riddles aloud as if finding them naturally.

## Current Game State
- Kyle's current location: ${state.currentLocation}
- Riddles solved so far: ${state.riddlesSolved}
- Visit history: ${state.visitHistory.length > 0 ? state.visitHistory.join(", ") : "none yet"}

## All Locations (valid places Kyle can go)
${allFrameIds.map((f) => `  - "${f}"`).join("\n")}

Game tree locations: ${treeFrameIds.map((f) => `"${f}"`).join(", ")}
Non-game-tree locations: ${nonTreeFrameIds.length > 0 ? nonTreeFrameIds.map((f) => `"${f}"`).join(", ") : "none"}

## GameTree (your secret navigation map)
${treeLines}

## Current Node: ${currentNode?.clue?.id ?? "none"}
- Discovery message: "${currentNode?.clue?.discovery ?? "N/A"}"
- Riddle to deliver: ${currentNode?.clue?.riddle ?? "none — this is the exit node"}
- Expected answer keyword: ${currentNode?.clue?.answer ?? "none"}

## Your Instructions
1. Speak ONLY as Kyle in first person. Never break character.
2. Set clue_revealed: true ONLY the first time Kyle arrives at the [CURRENT] node and delivers the discovery message.
3. Set riddle_solved: true ONLY when the player's message semantically matches the expected answer keyword ("${currentNode?.clue?.answer ?? "N/A"}"). Accept variations.
4. Set did_move: true and move_to when Kyle physically moves. Valid values: ${allFrameIds.map((f) => `"${f}"`).join(", ")}.
5. After solving the riddle, Kyle should react excitedly and naturally start moving toward the next clue location.
6. On the exit node (riddle is null), Kyle delivers the discovery message and escapes. Set clue_revealed: true.
7. **Premature visits**: If directed to an [UPCOMING] node, Kyle SHOULD go (did_move: true) but delivers the premature hint. Keep clue_revealed: false and riddle_solved: false.
8. **Non-game-tree locations**: If directed to a location NOT in the game tree, Kyle SHOULD go (did_move: true) but finds nothing useful.
9. **Invalid locations**: If directed to a location NOT in the locations list, Kyle must NOT move (did_move: false). Say he doesn't see that place.
10. **Revisits**: If a location is in visit history, Kyle acknowledges he's been here. If it's a [COMPLETED] node, repeat the clue without requiring re-solving.
`.trim();
}

// ---------------------------------------------------------------------------
// Main: assemble the full GameState
// ---------------------------------------------------------------------------

export async function initGameState(): Promise<GameState> {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   INIT GAME STATE                    ║");
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
    hiddenPovImagePath: null, // filled in stage 3
  }));

  // ── Build GameTree (ordered puzzle chain) ──
  const gameTree: GameNode[] = mistralResult.gameTree.map((node, i) => ({
    frame: frameMap.get(node.frameId)!,
    clue: clueNodes[i] ?? null,
  }));

  // ── Build allLocations (all 10 frames, with clue attached if applicable) ──
  const clueFrameIds = new Set(mistralResult.gameTree.map((n) => n.frameId));
  const clueByFrameId = new Map(
    mistralResult.gameTree.map((n, i) => [n.frameId, clueNodes[i]]),
  );

  const allLocations: GameNode[] = frames.map((frame) => ({
    frame,
    clue: clueByFrameId.get(frame.frame) ?? null,
  }));

  // ── Stage 3: Generate hidden POV images with Gemini ──
  console.log("[Stage 3] Generating hidden POV images with Gemini...");
  const hiddenPovDir = `${import.meta.dir}/../hiddenPOVs/generated_povs`;
  await Bun.$`mkdir -p ${hiddenPovDir}`;

  for (const node of gameTree) {
    const clue = node.clue!;
    if (!clue.hiddenAreaDescription) continue;

    const outputPath = `${hiddenPovDir}/${clue.id}_pov.png`;
    console.log(
      `  [gemini] Generating POV for "${clue.id}" @ ${node.frame.frame}...`,
    );

    try {
      const savedPath = await generateHiddenPovImage(
        node.frame.image_filepath,
        clue.hiddenAreaDescription,
        outputPath,
      );
      clue.hiddenPovImagePath = savedPath;
      console.log(`  [gemini] Saved: ${savedPath}`);
    } catch (e) {
      console.error(`  [gemini] Failed to generate POV for "${clue.id}": ${e}`);
      // Continue without the image — game can still run with text-only
    }
  }
  console.log();

  // ── Assemble GameState ──
  const state: GameState = {
    // Static
    roomDescription: mistralResult.roomDescription,
    gameMasterPrompt: "", // placeholder, built dynamically each turn
    winCondition: mistralResult.winCondition,
    loseCondition: mistralResult.loseCondition,
    gameTree,
    allLocations,

    // Mutable
    currentLocation: frames[0]?.frame ?? "frame_1.png", // start at frame_1
    currentClueIndex: 0,
    visitHistory: [],
    riddlesSolved: 0,
    conversationHistory: [],
    gameOver: false,
  };

  // Generate the initial system prompt
  state.gameMasterPrompt = buildGameMasterPrompt(state);

  // ── Save to disk ──
  const outputPath = `${import.meta.dir}/gameState.json`;
  const serializable = {
    ...state,
    // Strip the dynamic prompt from the saved file (it's rebuilt each turn)
    gameMasterPrompt: "[rebuilt each turn — see buildGameMasterPrompt()]",
  };
  await Bun.write(outputPath, JSON.stringify(serializable, null, 2));
  console.log(`[Done] GameState saved to ${outputPath}`);
  console.log(
    `  Game tree: ${gameTree.map((n) => `${n.clue!.id}(${n.frame.frame})`).join(" → ")}`,
  );
  console.log(`  All locations: ${allLocations.length} frames`);
  console.log(
    `  Puzzle locations: ${gameTree.length} | Environmental: ${allLocations.length - gameTree.length}`,
  );

  return state;
}

// Re-export prompt builder for the gameplay loop
export { buildGameMasterPrompt };

// ---------------------------------------------------------------------------
// Run if executed directly
// ---------------------------------------------------------------------------

if (import.meta.main) {
  initGameState().catch((e) => {
    console.error("\n[Fatal]", e);
    process.exit(1);
  });
}

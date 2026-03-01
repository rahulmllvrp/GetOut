/**
 * gameEngine.ts
 *
 * Server-side game logic extracted from the playground CLI loop.
 * Handles: types, prompt building, Mistral chat, state I/O.
 *
 * This file runs ONLY on the server (API routes). Never import from client components.
 */

import { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types (shared with client via separate types file)
// ---------------------------------------------------------------------------

export type FrameNode = {
  frame: string;
  description: string;
  pov: string;
  coordinates: {
    pos: { x: number; y: number; z: number };
    rot: { x: number; y: number };
  };
  image_filepath: string | null;
};

export type ClueNode = {
  id: string;
  discovery: string;
  premature_discovery: string;
  riddle: string | null;
  answer: string | null;
  hiddenAreaDescription: string;
  hiddenPovImagePath: string | null;
};

export type GameNode = {
  frame: FrameNode;
  clue: ClueNode | null;
};

export type GameState = {
  roomDescription: string;
  gameMasterPrompt: string;
  winCondition: string;
  loseCondition: string | null;
  gameTree: GameNode[];
  allLocations: GameNode[];

  currentLocation: string;
  currentClueIndex: number;
  visitHistory: string[];
  riddlesSolved: number;
  conversationHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  gameOver: boolean;
};

/** What the client receives — no secret data (answers, upcoming clues stripped) */
export type ClientGameState = {
  roomDescription: string;
  winCondition: string;
  currentLocation: string;
  visitHistory: string[];
  riddlesSolved: number;
  totalRiddles: number;
  gameOver: boolean;
  allLocationIds: string[];
  gameTreeLocationIds: string[];
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
};

/** What /api/game/chat returns */
export type ChatResponse = {
  kyle_response: string;
  did_move: boolean;
  move_to: string | null;
  clue_revealed: boolean;
  riddle_solved: boolean;
  game_over: boolean;
  current_location: string;
  riddles_solved: number;
  total_riddles: number;
  hidden_pov_description: string | null; // sent when clue_revealed, for on-demand image gen
};

// ---------------------------------------------------------------------------
// Mistral client
// ---------------------------------------------------------------------------

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const MODEL = "mistral-large-latest";

// ---------------------------------------------------------------------------
// State file path
// ---------------------------------------------------------------------------

function getGameStatePath(): string {
  return path.join(process.cwd(), "data", "gameState.json");
}

// ---------------------------------------------------------------------------
// Load game state from disk
// ---------------------------------------------------------------------------

export async function loadGameState(): Promise<GameState> {
  const filePath = getGameStatePath();
  if (!existsSync(filePath)) {
    throw new Error(
      "No gameState.json found. Run the init pipeline first (playgrounds/mistral/initGameState.ts).",
    );
  }
  const raw = await readFile(filePath, "utf-8");
  const saved = JSON.parse(raw);
  saved.gameMasterPrompt = "";
  return saved as GameState;
}

// ---------------------------------------------------------------------------
// Save game state to disk
// ---------------------------------------------------------------------------

export async function saveGameState(state: GameState): Promise<void> {
  const filePath = getGameStatePath();
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const serializable = {
    ...state,
    gameMasterPrompt: "[rebuilt each turn — see buildGameMasterPrompt()]",
  };
  await writeFile(filePath, JSON.stringify(serializable, null, 2));
}

// ---------------------------------------------------------------------------
// Build system prompt (refreshed every turn)
// ---------------------------------------------------------------------------

export function buildGameMasterPrompt(state: GameState): string {
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
// Build structured output schema (dynamic from state)
// ---------------------------------------------------------------------------

function buildResponseSchema(state: GameState) {
  const allFrameIds = state.allLocations.map((n) => n.frame.frame);

  return z.object({
    kyle_response: z.string(),
    did_move: z.boolean(),
    move_to: z.enum(allFrameIds as [string, ...string[]]).nullable(),
    clue_revealed: z.boolean(),
    riddle_solved: z.boolean(),
  });
}

type GameMasterResponse = z.infer<ReturnType<typeof buildResponseSchema>>;

// ---------------------------------------------------------------------------
// Chat: send player message to Mistral, update state, return result
// ---------------------------------------------------------------------------

export async function chat(
  playerMessage: string,
  state: GameState,
): Promise<ChatResponse> {
  // Rebuild conversation messages array from state
  const messages: Array<{ role: string; content: string }> =
    state.conversationHistory.length > 0
      ? [...state.conversationHistory]
      : [{ role: "system", content: "" }];

  // Add the new player message
  messages.push({ role: "user", content: playerMessage });

  // Refresh system prompt every turn
  state.gameMasterPrompt = buildGameMasterPrompt(state);
  messages[0] = { role: "system", content: state.gameMasterPrompt };

  const responseSchema = buildResponseSchema(state);

  const response = await mistral.chat.parse({
    model: MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: messages as any,
    responseFormat: responseSchema,
    temperature: 0.7,
    maxTokens: 2048,
  });

  const raw = response.choices?.[0]?.message;
  if (!raw) throw new Error("Mistral returned no choices.");

  let parsed: GameMasterResponse | null =
    (raw.parsed as GameMasterResponse) ?? null;

  const rawContent = typeof raw.content === "string" ? raw.content : null;

  // Fallback: manually extract JSON if structured output parsing failed
  if (!parsed && rawContent) {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        if (!obj.kyle_response) {
          const alt = obj.message ?? obj.response ?? obj.output;
          if (alt) obj.kyle_response = alt;
        }
        if (!obj.move_to && obj.move_to_location) {
          obj.move_to = obj.move_to_location;
        }
        parsed = responseSchema.parse(obj);
      } catch {
        throw new Error(`Model returned unparseable content:\n${rawContent}`);
      }
    } else {
      throw new Error(`Model returned no JSON:\n${rawContent}`);
    }
  }

  if (!parsed)
    throw new Error("Model returned null parsed response with no content.");

  // --- Update game state ---

  const gameTree = state.gameTree;

  // Update location and visit history
  if (parsed.did_move && parsed.move_to) {
    state.currentLocation = parsed.move_to;
    const isRevisit = state.visitHistory.includes(parsed.move_to);
    if (!isRevisit) {
      state.visitHistory.push(parsed.move_to);
    }
  }

  // Advance GameTree when riddle solved
  const currentNode = gameTree[state.currentClueIndex];
  if (parsed.riddle_solved && currentNode?.clue?.answer !== null) {
    state.riddlesSolved += 1;
    const nextIndex = state.currentClueIndex + 1;
    if (nextIndex < gameTree.length) {
      state.currentClueIndex = nextIndex;
    } else {
      state.gameOver = true;
    }
  }

  // Set game_over when exit node discovery fires
  const newNode = gameTree[state.currentClueIndex];
  if (newNode?.clue?.riddle === null && parsed.clue_revealed) {
    state.gameOver = true;
  }

  // Store conversation
  messages.push({
    role: "assistant",
    content: rawContent ?? parsed.kyle_response,
  });
  state.conversationHistory = messages.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content:
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));

  // Determine hidden POV description (for on-demand image generation)
  let hiddenPovDescription: string | null = null;
  if (parsed.clue_revealed) {
    const activeNode = parsed.riddle_solved
      ? gameTree[state.currentClueIndex - 1] // just advanced, look back
      : gameTree[state.currentClueIndex];
    hiddenPovDescription = activeNode?.clue?.hiddenAreaDescription ?? null;
  }

  // Save state
  await saveGameState(state);

  return {
    kyle_response: parsed.kyle_response,
    did_move: parsed.did_move,
    move_to: parsed.move_to,
    clue_revealed: parsed.clue_revealed,
    riddle_solved: parsed.riddle_solved,
    game_over: state.gameOver,
    current_location: state.currentLocation,
    riddles_solved: state.riddlesSolved,
    total_riddles: gameTree.filter((n) => n.clue?.answer).length,
    hidden_pov_description: hiddenPovDescription,
  };
}

// ---------------------------------------------------------------------------
// Strip secrets for client consumption
// ---------------------------------------------------------------------------

export function toClientState(state: GameState): ClientGameState {
  return {
    roomDescription: state.roomDescription,
    winCondition: state.winCondition,
    currentLocation: state.currentLocation,
    visitHistory: state.visitHistory,
    riddlesSolved: state.riddlesSolved,
    totalRiddles: state.gameTree.filter((n) => n.clue?.answer).length,
    gameOver: state.gameOver,
    allLocationIds: state.allLocations.map((n) => n.frame.frame),
    gameTreeLocationIds: state.gameTree.map((n) => n.frame.frame),
    conversationHistory: state.conversationHistory
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        // For assistant messages, try to extract kyle_response from JSON
        if (m.role === "assistant") {
          try {
            const obj = JSON.parse(m.content);
            return {
              role: "assistant" as const,
              content:
                obj.kyle_response ?? obj.message ?? obj.response ?? m.content,
            };
          } catch {
            return { role: "assistant" as const, content: m.content };
          }
        }
        return { role: m.role as "user", content: m.content };
      }),
  };
}

// ---------------------------------------------------------------------------
// Reset game state (start fresh)
// ---------------------------------------------------------------------------

export async function resetGameState(): Promise<GameState> {
  const state = await loadGameState();
  state.currentLocation = state.allLocations[0]?.frame.frame ?? "frame_1";
  state.currentClueIndex = 0;
  state.visitHistory = [];
  state.riddlesSolved = 0;
  state.conversationHistory = [];
  state.gameOver = false;
  state.gameMasterPrompt = "";
  await saveGameState(state);
  return state;
}

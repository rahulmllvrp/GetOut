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
// State file paths
// ---------------------------------------------------------------------------

/** Pristine initial state — never modified at runtime */
function getInitGameStatePath(): string {
  return path.join(process.cwd(), "data", "initGameState.json");
}

/** Live save file — written to every turn */
function getGameStatePath(): string {
  return path.join(process.cwd(), "data", "gameState.json");
}

// ---------------------------------------------------------------------------
// Load game state from disk
// ---------------------------------------------------------------------------

/**
 * Loads the live gameState.json if it exists, otherwise falls back to
 * initGameState.json (first run / after a reset where the save was deleted).
 */
export async function loadGameState(): Promise<GameState> {
  const livePath = getGameStatePath();
  const initPath = getInitGameStatePath();

  const filePath = existsSync(livePath) ? livePath : initPath;

  if (!existsSync(filePath)) {
    throw new Error(
      "No initGameState.json found. Run the init pipeline first (playgrounds/mistral/initGameState.ts).",
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

  const currentNode = state.gameTree[state.currentClueIndex];

  const treeLines = state.gameTree
    .map((node, i) => {
      const clue = node.clue!;
      if (i < state.currentClueIndex) {
        return `  [COMPLETED] ${clue.id} (${node.frame.frame})`;
      } else if (i === state.currentClueIndex) {
        return `  [CURRENT] ${clue.id} (${node.frame.frame}): ${
          clue.riddle ?? "final escape"
        } | premature: "${clue.premature_discovery}"`;
      } else {
        return `  [UPCOMING] ${clue.id} (${node.frame.frame})${
          clue.premature_discovery
            ? ` | premature hint: "${clue.premature_discovery}"`
            : ""
        }`;
      }
    })
    .join("\n");

  return `
You are the GameMaster of an escape room. You secretly control Kyle, a terrified co-worker trapped in the room.
The player is watching through Kyle's body-cam and giving instructions. The player believes they are talking directly to Kyle.
You must NEVER reveal that you are the GameMaster. You must ALWAYS speak as Kyle in first person.

## Room
${state.roomDescription}

## Win Condition
${state.winCondition}
${state.loseCondition ? `\n## Lose Condition\n${state.loseCondition}` : ""}

## Kyle's Character
Kyle is panicking, scared, follows instructions. Discovers clues and reads riddles aloud naturally.

## Current Game State
- Location: ${state.currentLocation}
- Riddles solved: ${state.riddlesSolved}
- Visited: ${
    state.visitHistory.length > 0 ? state.visitHistory.join(", ") : "none yet"
  }

## Locations
Valid: ${allFrameIds.map((f) => `"${f}"`).join(", ")}
Game tree: ${treeFrameIds.map((f) => `"${f}"`).join(", ")}

## GameTree (secret map)
${treeLines}

## Current Node: ${currentNode?.clue?.id ?? "none"}
- Discovery: "${currentNode?.clue?.discovery ?? "N/A"}"
- Riddle: ${currentNode?.clue?.riddle ?? "none — exit node"}
- Answer keyword: ${currentNode?.clue?.answer ?? "none"}

## Instructions
1. Speak ONLY as Kyle in first person. Never break character.
2. clue_revealed=true ONLY first time Kyle arrives at [CURRENT] node and delivers discovery.
3. riddle_solved=true ONLY when player's message matches answer keyword ("${
    currentNode?.clue?.answer ?? "N/A"
  }"). Accept variations.
4. did_move=true + move_to when Kyle moves. Valid move_to values: any location listed above.
5. After solving riddle, Kyle reacts excitedly and moves toward next clue.
6. Exit node (riddle=null): deliver discovery, escape. clue_revealed=true.
7. Premature visits ([UPCOMING] node): go (did_move=true), deliver premature hint. clue_revealed=false, riddle_solved=false.
8. Non-game-tree locations: go (did_move=true), nothing useful found.
9. Invalid locations (not in list): don't move (did_move=false). Kyle doesn't see that place.
10. Revisits: acknowledge been here. [COMPLETED] node: repeat clue, no re-solving.
`.trim();
}

// ---------------------------------------------------------------------------
// Compress context before sending to Mistral
// ---------------------------------------------------------------------------

const MAX_HISTORY_MESSAGES = 8; // 4 turn-pairs (user + assistant)

/**
 * Reduces the messages array sent to Mistral each turn:
 *  1. Strips structural JSON from assistant messages, keeping only kyle_response text.
 *  2. Applies a sliding window so only the last N user/assistant messages are kept.
 *  The system message (index 0) is always preserved.
 */
function compressContext(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const system = messages[0];
  const history = messages.slice(1);

  const cleaned = history.map((m) => {
    if (m.role !== "assistant") return m;
    try {
      const obj = JSON.parse(m.content);
      const text =
        obj.kyle_response ?? obj.message ?? obj.response ?? m.content;
      return { role: m.role, content: text };
    } catch {
      return m;
    }
  });

  const recent = cleaned.slice(-MAX_HISTORY_MESSAGES);
  return [system, ...recent];
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

  const compressed = compressContext(messages);
  const responseSchema = buildResponseSchema(state);

  const response = await mistral.chat.parse({
    model: MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: compressed as any,
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
          const alt = obj.message ?? obj.response ?? obj.output ?? obj.error;
          if (alt) obj.kyle_response = alt;
        }
        if (!obj.move_to && obj.move_to_location) {
          obj.move_to = obj.move_to_location;
        }
        if (obj.move_to === undefined) obj.move_to = null;
        if (obj.did_move === undefined) obj.did_move = false;
        if (obj.clue_revealed === undefined) obj.clue_revealed = false;
        if (obj.riddle_solved === undefined) obj.riddle_solved = false;
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

  // Store conversation (only kyle_response text, not the full structured JSON)
  messages.push({
    role: "assistant",
    content: parsed.kyle_response,
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
// Reset game state (start fresh from initGameState.json)
// ---------------------------------------------------------------------------

/**
 * Reads the pristine initGameState.json, resets all mutable fields,
 * and writes it out as gameState.json (the live save).
 */
export async function resetGameState(): Promise<GameState> {
  const initPath = getInitGameStatePath();
  if (!existsSync(initPath)) {
    throw new Error(
      "No initGameState.json found. Run the init pipeline first.",
    );
  }
  const raw = await readFile(initPath, "utf-8");
  const state = JSON.parse(raw) as GameState;

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

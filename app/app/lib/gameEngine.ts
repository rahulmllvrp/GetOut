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

export type GameMode = "normal" | "brainrot" | "nsfw";

export type GameState = {
  gameMode: GameMode;
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
      "No initGameState.json found. Run the init pipeline first (playgrounds/mistral/initGameState.ts)."
    );
  }
  const raw = await readFile(filePath, "utf-8");
  const saved = JSON.parse(raw);
  saved.gameMasterPrompt = "";
  if (!saved.gameMode) saved.gameMode = "normal";
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
// Game State Logging - Append each decision/conversation to a log file
// ---------------------------------------------------------------------------

export async function logGameStateSnapshot(
  state: GameState,
  playerMessage: string,
  aiResponse: any
): Promise<void> {
  try {
    const logDir = path.join(process.cwd(), "game-logs");
    if (!existsSync(logDir)) {
      await mkdir(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const sessionId = `session_${
      new Date().toISOString().split("T")[0]
    }_${Date.now()}`;
    const logFile = path.join(logDir, `game-state-log.jsonl`);

    const logEntry = {
      timestamp,
      sessionId,
      turn: state.conversationHistory.length,
      playerMessage,
      aiResponse: {
        kyle_response: aiResponse.kyle_response,
        did_move: aiResponse.did_move,
        move_to: aiResponse.move_to,
        clue_revealed: aiResponse.clue_revealed,
        riddle_solved: aiResponse.riddle_solved,
      },
      gameState: {
        currentLocation: state.currentLocation,
        riddlesSolved: state.riddlesSolved,
        totalRiddles: state.gameTree.filter((n) => n.clue?.answer).length,
        currentClueIndex: state.currentClueIndex,
        gameOver: state.gameOver,
        visitHistory: state.visitHistory,
      },
    };

    // Append to JSONL file (JSON Lines format for easy streaming/parsing)
    const logLine = JSON.stringify(logEntry) + "\n";

    // Check if file exists, if not create it
    if (!existsSync(logFile)) {
      await writeFile(logFile, logLine);
    } else {
      // Append to existing file
      const { appendFile } = await import("fs/promises");
      await appendFile(logFile, logLine);
    }

    console.log(
      `[GameLog] Turn ${state.conversationHistory.length} logged to ${logFile}`
    );
  } catch (error) {
    console.error("[GameLog] Failed to log game state:", error);
    // Don't throw - logging shouldn't break the game
  }
}

// ---------------------------------------------------------------------------
// Game Flow Logger - Raw Mistral API inputs + outputs → data/gameFlow.json
// ---------------------------------------------------------------------------

const GAME_FLOW_PATH = path.join(process.cwd(), "data", "gameFlow.json");

async function logGameFlow(
  input: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature: number;
    maxTokens: number;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawResponse: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed: any
): Promise<void> {
  try {
    const dataDir = path.join(process.cwd(), "data");
    if (!existsSync(dataDir)) {
      await mkdir(dataDir, { recursive: true });
    }

    const entry = {
      timestamp: new Date().toISOString(),
      input,
      rawResponse,
      parsed,
    };

    // Read existing entries or start fresh
    let entries: unknown[] = [];
    if (existsSync(GAME_FLOW_PATH)) {
      try {
        const existing = await readFile(GAME_FLOW_PATH, "utf-8");
        entries = JSON.parse(existing);
        if (!Array.isArray(entries)) entries = [];
      } catch {
        entries = [];
      }
    }

    entries.push(entry);
    await writeFile(GAME_FLOW_PATH, JSON.stringify(entries, null, 2));
    console.log(
      `[GameFlow] Logged turn ${entries.length} to ${GAME_FLOW_PATH}`
    );
  } catch (error) {
    console.error("[GameFlow] Failed to log game flow:", error);
    // Don't throw - logging shouldn't break the game
  }
}

// ---------------------------------------------------------------------------
// Mode-specific character blocks (hardcoded)
// ---------------------------------------------------------------------------

const KYLE_CHARACTER: Record<GameMode, string> = {
  normal: `## Kyle's Character
Kyle is panicking, scared, follows instructions. Discovers clues and reads riddles aloud naturally.`,

  brainrot: `## Kyle's Character
Kyle is panicking and scared BUT speaks EXCLUSIVELY in Gen-Z brainrot internet slang. Every single line must be drenched in terms like: skibidi, rizz, sigma, gyatt, no cap, bussin, fr fr, on god, ohio, fanum tax, beta, alpha, mewing, aura, slay, its giving, lowkey, highkey, ate that, dead, bruh, ong, W, L, ratio, sus, vibe check, rent free, understood the assignment, main character energy.
Kyle replaces normal words with brainrot equivalents wherever possible. He still follows instructions and is terrified, but expresses fear through brainrot language.
IMPORTANT: When delivering riddles and clues, you MUST creatively rephrase them using brainrot terminology and meme references. The puzzle content itself should feel brainrot-themed. For example, instead of "What has keys but no locks?" say something like "Yo no cap, what's got sigma-level rizz with keys but zero locks? That's lowkey sus fr fr."`,

  nsfw: `## Kyle's Character
Kyle is panicking and scared BUT speaks with HEAVY profanity, vulgar language, crude humor, and sexual innuendo. Every line should include swearing (fuck, shit, damn, ass, hell, etc.) and raunchy observations. Kyle expresses his terror through profanity and crude remarks about his surroundings.
He makes dirty jokes, sexual puns, and inappropriate comments even while terrified. Think of a foul-mouthed, horny person trapped in a room.
IMPORTANT: When delivering riddles and clues, you MUST creatively rephrase them with NSFW content — dirty puns, sexual double entendres, raunchy wordplay, and explicit humor woven into the actual puzzle text. For example, instead of "What has a head and a tail but no body?" say something like "What the fuck has a head you can't give and a tail you can't ride, but no goddamn body to have fun with?"`,
};

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

${KYLE_CHARACTER[state.gameMode ?? "normal"]}

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
${currentNode?.frame.description ? `- Frame Description: "${currentNode.frame.description}"` : ""}
${currentNode?.clue?.hiddenAreaDescription ? `- Hidden Area Description: "${currentNode.clue.hiddenAreaDescription}"` : ""}

## Instructions
1. Speak ONLY as Kyle in first person. Never break character.
2. clue_revealed=true in the SAME response that Kyle first arrives at the [CURRENT] node. Arrival and discovery happen together — do NOT wait for the player to ask Kyle to look around.
3. riddle_solved=true ONLY when player's message matches answer keyword ("${
    currentNode?.clue?.answer ?? "N/A"
  }"). Accept variations.
4. did_move=true + move_to when Kyle moves. Valid move_to values: any location listed above.
5. When riddle_solved=true: in that SAME response Kyle also moves to the first [UPCOMING] node (did_move=true, move_to=<that frameId>) AND delivers its discovery (clue_revealed=true). One response covers riddle solved + move + new discovery. Do NOT split this across two turns.
6. Exit node (riddle=null): deliver discovery, escape. clue_revealed=true.
7. Premature visits ([UPCOMING] node that is NOT next after a solved riddle): go (did_move=true), deliver premature hint. clue_revealed=false, riddle_solved=false.
8. Non-game-tree locations: go (did_move=true), nothing useful found.
9. Invalid locations (not in list): don't move (did_move=false). Kyle doesn't see that place.
10. Revisits: acknowledge been here. [COMPLETED] node: repeat clue, no re-solving.

## STRICT OUTPUT FORMAT
You MUST respond with valid JSON matching this EXACT schema. No prose, no markdown, no code blocks — only raw JSON.
{"kyle_response": "<Kyle's dialogue here>", "did_move": <true|false>, "move_to": <"location_id"|null>, "clue_revealed": <true|false>, "riddle_solved": <true|false>}

Example response:
{"kyle_response": "Oh man, I see something on the wall over here... it looks like some kind of riddle!", "did_move": false, "move_to": null, "clue_revealed": true, "riddle_solved": false}
`.trim();
}

// ---------------------------------------------------------------------------
// Compress context before sending to Mistral
// ---------------------------------------------------------------------------

/**
 * Reduces the messages array sent to Mistral each turn:
 *  Strips structural JSON from assistant messages, keeping only kyle_response text.
 *  The system message (index 0) is always preserved.
 */
function compressContext(
  messages: Array<{ role: string; content: string }>
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

  return [system, ...cleaned];
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
  state: GameState
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

  // Format reminder as the last message (recency bias helps adherence)
  compressed.push({
    role: "user",
    content:
      "[SYSTEM: Respond ONLY with valid JSON matching the required schema. Keys: kyle_response, did_move, move_to, clue_revealed, riddle_solved. No other text.]",
  });

  const responseSchema = buildResponseSchema(state);

  const response = await mistral.chat.parse({
    model: MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: compressed as any,
    responseFormat: responseSchema,
    temperature: 0.7,
    maxTokens: 1024,
  });

  const raw = response.choices?.[0]?.message;
  if (!raw) throw new Error("Mistral returned no choices.");

  let parsed: GameMasterResponse | null =
    (raw.parsed as GameMasterResponse) ?? null;

  const rawContent = typeof raw.content === "string" ? raw.content : null;

  // Helper to log every turn (success or failure) before we throw
  const logTurn = (parsedResult: unknown) =>
    logGameFlow(
      {
        model: MODEL,
        messages: compressed,
        temperature: 0.7,
        maxTokens: 1024,
      },
      response,
      parsedResult
    );

  // Fallback: manually extract JSON if structured output parsing failed
  if (!parsed && rawContent) {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        if (!obj.kyle_response) {
          const alt =
            obj.kyle_speech ??
            obj.message ??
            obj.response ??
            obj.output ??
            obj.error;
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
        await logTurn({ error: "unparseable_json", raw: rawContent });
        throw new Error(`Model returned unparseable content:\n${rawContent}`);
      }
    } else {
      await logTurn({ error: "no_json", raw: rawContent });
      throw new Error(`Model returned no JSON:\n${rawContent}`);
    }
  }

  if (!parsed) {
    await logTurn({ error: "null_parsed", raw: rawContent });
    throw new Error("Model returned null parsed response with no content.");
  }

  // Log successful turn
  await logTurn(parsed);

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

  const responseData = {
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

  // Log this conversation turn for analytics/debugging
  await logGameStateSnapshot(state, playerMessage, parsed);

  return responseData;
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
export async function resetGameState(mode?: GameMode): Promise<GameState> {
  const initPath = getInitGameStatePath();
  if (!existsSync(initPath)) {
    throw new Error(
      "No initGameState.json found. Run the init pipeline first."
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
  state.gameMode = mode ?? "normal";

  await saveGameState(state);
  return state;
}

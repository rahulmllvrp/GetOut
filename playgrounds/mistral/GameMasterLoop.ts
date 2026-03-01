import { Mistral } from "@mistralai/mistralai";
import { createInterface } from "readline";
import { z } from "zod";
import { recordAudio, speechToText, speak } from "./elevenlabs";
import {
  type GameState,
  buildGameMasterPrompt,
  initGameState,
} from "./initGameState";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const MODEL = "mistral-large-latest";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) =>
  new Promise<string>((resolve) => rl.question(q, resolve));
const waitForEnter = (q: string) =>
  new Promise<void>((resolve) => rl.question(q, () => resolve()));

// ---------------------------------------------------------------------------
// State file path
// ---------------------------------------------------------------------------

const GAME_STATE_PATH = `${import.meta.dir}/gameState.json`;

// ---------------------------------------------------------------------------
// Load or init game state
// ---------------------------------------------------------------------------

async function loadOrInitGameState(): Promise<GameState> {
  const file = Bun.file(GAME_STATE_PATH);
  if (await file.exists()) {
    console.log("  [init] Loading existing game state...");
    const saved = await file.json();
    // Restore the dynamic prompt placeholder
    saved.gameMasterPrompt = "";
    return saved as GameState;
  }
  console.log("  [init] No game state found. Running init...\n");
  return await initGameState();
}

// ---------------------------------------------------------------------------
// Save game state to disk after each turn
// ---------------------------------------------------------------------------

async function saveGameState(state: GameState): Promise<void> {
  const serializable = {
    ...state,
    gameMasterPrompt: "[rebuilt each turn — see buildGameMasterPrompt()]",
  };
  await Bun.write(GAME_STATE_PATH, JSON.stringify(serializable, null, 2));
}

// ---------------------------------------------------------------------------
// Structured output schema (built dynamically from game state)
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
// Compress context before sending to Mistral
// ---------------------------------------------------------------------------

const MAX_HISTORY_MESSAGES = 8;

function compressContext(messages: any[]): any[] {
  const system = messages[0];
  const history = messages.slice(1);

  const cleaned = history.map((m: any) => {
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
// Chat
// ---------------------------------------------------------------------------

async function chat(
  messages: any[],
  state: GameState
): Promise<GameMasterResponse> {
  // Refresh system prompt every turn so model always knows current state
  state.gameMasterPrompt = buildGameMasterPrompt(state);
  messages[0] = { role: "system", content: state.gameMasterPrompt };

  const compressed = compressContext(messages);
  const responseSchema = buildResponseSchema(state);

  process.stdout.write("  [mistral] thinking...");
  const response = await mistral.chat.parse({
    model: MODEL,
    messages: compressed,
    responseFormat: responseSchema,
    temperature: 0.7,
    maxTokens: 2048,
  });
  process.stdout.write(" done\n");

  const raw = response.choices?.[0]?.message;
  if (!raw) throw new Error("Mistral returned no choices.");

  let parsed: GameMasterResponse | null =
    (raw.parsed as GameMasterResponse) ?? null;

  // Fallback: manually extract JSON if structured output parsing silently failed
  const rawContent = typeof raw.content === "string" ? raw.content : null;
  if (!parsed && rawContent) {
    console.log(
      "  [warn] structured parse failed, falling back to manual JSON extract"
    );
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        // Normalize common field name variations
        if (!obj.kyle_response) {
          const alt = obj.message ?? obj.response ?? obj.output;
          if (alt) obj.kyle_response = alt;
        }
        if (!obj.move_to && obj.move_to_location) {
          obj.move_to = obj.move_to_location;
        }
        parsed = responseSchema.parse(obj);
        console.log("  [warn] fallback parse succeeded");
      } catch (e) {
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
    const prev = state.currentLocation;
    state.currentLocation = parsed.move_to;
    const isRevisit = state.visitHistory.includes(parsed.move_to);
    if (!isRevisit) {
      state.visitHistory.push(parsed.move_to);
      console.log(`  [move] ${prev} → ${state.currentLocation} (first visit)`);
    } else {
      console.log(`  [move] ${prev} → ${state.currentLocation} (revisit)`);
    }
  }

  // Advance GameTree when riddle solved (host-authoritative)
  const currentNode = gameTree[state.currentClueIndex];
  if (parsed.riddle_solved && currentNode?.clue?.answer !== null) {
    state.riddlesSolved += 1;
    const nextIndex = state.currentClueIndex + 1;
    if (nextIndex < gameTree.length) {
      state.currentClueIndex = nextIndex;
      console.log(
        `  [tree] riddle solved ✓  advancing to node: ${
          gameTree[state.currentClueIndex]!.clue!.id
        }`
      );
    } else {
      state.gameOver = true;
      console.log("  [tree] riddle solved ✓  no next node — game over");
    }
  }

  // Set game_over when exit node discovery fires
  const newNode = gameTree[state.currentClueIndex];
  if (newNode?.clue?.riddle === null && parsed.clue_revealed) {
    state.gameOver = true;
    console.log("  [tree] exit node revealed — game over");
  }

  // Store conversation (only kyle_response text, not the full structured JSON)
  messages.push({
    role: "assistant",
    content: parsed.kyle_response,
  });
  state.conversationHistory = messages.map((m: any) => ({
    role: m.role,
    content:
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));

  return parsed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHiddenPovForCurrentClue(state: GameState): string | null {
  const node = state.gameTree[state.currentClueIndex];
  return node?.clue?.hiddenPovImagePath ?? null;
}

function getTotalRiddles(state: GameState): number {
  return state.gameTree.filter((n) => n.clue?.answer).length;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
  console.log("╔══════════════════════════════╗");
  console.log("║   ESCAPE ROOM  — body-cam    ║");
  console.log("╚══════════════════════════════╝");

  const state = await loadOrInitGameState();

  const treeNodeIds = state.gameTree.map((n) => n.clue?.id ?? "?");
  console.log(`nodes : ${treeNodeIds.join(" → ")}`);
  console.log(`start : ${state.currentLocation}`);
  console.log(`win   : ${state.winCondition}`);
  if (state.loseCondition) console.log(`lose  : ${state.loseCondition}`);
  console.log(`mode  : voice (type 'text' to switch, 'quit' to exit)\n`);

  // Restore conversation history or start fresh
  const messages: any[] =
    state.conversationHistory.length > 0
      ? [...state.conversationHistory]
      : [{ role: "system", content: buildGameMasterPrompt(state) }];

  let voiceMode = true;

  while (true) {
    let playerInput: string;

    if (voiceMode) {
      const cmd = (
        await ask("→ Press ENTER to speak (or type 'text'/'quit'): ")
      )
        .trim()
        .toLowerCase();
      if (cmd === "quit") break;
      if (cmd === "text") {
        voiceMode = false;
        console.log("  Switched to keyboard.\n");
        continue;
      }

      console.log("  [recording] speak now...");
      const wavPath = await recordAudio(waitForEnter);

      console.log("  [transcribing...]");
      try {
        playerInput = await speechToText(wavPath);
      } catch (e) {
        console.error(`  [STT error] ${e}\n`);
        continue;
      } finally {
        await Bun.$`rm -f ${wavPath}`.quiet();
      }
      console.log(`  You said: ${playerInput}`);
    } else {
      playerInput = (await ask("You: ")).trim();
      if (["quit", "exit"].includes(playerInput.toLowerCase())) break;
      if (playerInput.toLowerCase() === "voice") {
        voiceMode = true;
        console.log("  Switched to voice.\n");
        continue;
      }
      if (!playerInput) continue;
    }

    messages.push({ role: "user", content: playerInput });
    console.log();
    const result = await chat(messages, state);

    const node = state.gameTree[state.currentClueIndex];
    console.log(
      `  [flags]  clue_revealed=${result.clue_revealed}  riddle_solved=${result.riddle_solved}  did_move=${result.did_move}  move_to=${result.move_to}`
    );
    console.log(
      `  [state]  loc="${state.currentLocation}"  node=${
        node?.clue?.id ?? "?"
      }  riddles=${state.riddlesSolved}/${getTotalRiddles(state)}`
    );

    // Show hidden POV path when a clue is revealed (frontend would display this image)
    if (result.clue_revealed) {
      const povPath = getHiddenPovForCurrentClue(state);
      if (povPath) {
        console.log(`  [pov]    hidden POV image: ${povPath}`);
      }
    }

    console.log(`\nKyle: ${result.kyle_response}\n`);

    console.log("  [speaking...]");
    try {
      await speak(result.kyle_response);
    } catch (e) {
      console.error(`  [TTS error] ${e}`);
    }

    // Persist state after every turn
    await saveGameState(state);

    if (state.gameOver) {
      console.log("\n  🎉 Game Over! Kyle has escaped!");
      break;
    }
  }

  // Final save
  await saveGameState(state);
  console.log("Transmission ended.");
  rl.close();
}

main().catch(console.error);

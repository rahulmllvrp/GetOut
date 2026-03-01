import { Mistral } from "@mistralai/mistralai";
import { createInterface } from "readline";
import { z } from "zod";
import { recordAudio, speechToText, speak } from "./elevenlabs";

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
// GameTree
// ---------------------------------------------------------------------------

type ClueNode = {
  id: string;
  location: string;
  discovery: string; // what Kyle finds/says when arriving at the right time
  premature_discovery: string | null; // what Kyle finds if arriving before this node is active
  riddle: string | null;
  answer: string | null; // keyword to match in player response
  next: string | null; // next node id, null = game over
};

const gameTree: ClueNode[] = [
  {
    id: "desk",
    location: "desk",
    discovery: "Kyle opens the desk drawer and finds a crumpled note",
    premature_discovery: null,
    riddle: "What has hands but cannot clap?",
    answer: "clock",
    next: "clock",
  },
  {
    id: "clock",
    location: "clock",
    discovery: "Behind the old clock, Kyle finds a folded piece of paper",
    premature_discovery:
      "Kyle notices the old clock on the wall — its face is cracked and the hands are frozen. There are faint scratches around the frame, like something was hidden behind it, but it seems stuck. Maybe he needs to find something else first.",
    riddle: "What asks no questions but must be answered?",
    answer: "phone",
    next: "phone",
  },
  {
    id: "phone",
    location: "phone",
    discovery: "Under the rotary phone, Kyle finds a note with a 4-digit code",
    premature_discovery:
      "Kyle sees the old rotary phone sitting on a side table. He picks up the receiver — no dial tone, just dead silence. There are dust marks on the table like something was slid under the phone recently, but it won't budge. Something else must come first.",
    riddle: "I have cities but no houses, mountains but no trees. What am I?",
    answer: "map",
    next: "exit",
  },
  {
    id: "exit",
    location: "door",
    discovery: "The code works! The door clicks open. Kyle escapes!",
    premature_discovery:
      "Kyle rushes to the door and finds a heavy combination lock holding it shut. Four digits. He yanks on it desperately but it won't give. He doesn't have the code yet — there must be clues somewhere in this room.",
    riddle: null,
    answer: null,
    next: null,
  },
];

// ---------------------------------------------------------------------------
// Structured output schema
// ---------------------------------------------------------------------------

const GameMasterResponse = z.object({
  kyle_response: z.string(),
  did_move: z.boolean(),
  move_to_location: z.string().nullable(),
  clue_revealed: z.boolean(), // true only first time Kyle delivers discovery at this node
  riddle_solved: z.boolean(), // true only when player's answer matches current riddle
});

type GameMasterResponse = z.infer<typeof GameMasterResponse>;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

const state = {
  current_location: "center of the room",
  discovered: [] as string[],
  current_clue_index: 0,
  riddles_solved: 0,
  game_over: false,
};

// ---------------------------------------------------------------------------
// System prompt (rebuilt each turn)
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  const currentNode = gameTree[state.current_clue_index]!;

  //HARDCODED
  const treeLines = gameTree
    .map((node, i) => {
      let label: string;
      if (i < state.current_clue_index) label = "[COMPLETED]";
      else if (i === state.current_clue_index) label = "[CURRENT]";
      else label = "[UPCOMING]";
      const premature = node.premature_discovery
        ? ` | premature hint: "${node.premature_discovery}"`
        : "";
      return `  ${label} ${node.id} (${node.location}): ${
        node.riddle ?? "final escape"
      }${premature}`;
    })
    .join("\n");

  return `
You are the GameMaster of an escape room. You secretly control Kyle, a terrified co-worker trapped in the room.
The player is watching through Kyle's body-cam and giving instructions. The player believes they are talking directly to Kyle.
You must NEVER reveal that you are the GameMaster. You must ALWAYS speak as Kyle in first person.

## Kyle's Character
Kyle is panicking, breathing hard, hesitant. He follows the player's instructions but is scared.
Kyle discovers clues and reads riddles aloud as if finding them naturally.

## Current Game State
- Kyle's current location: ${state.current_location}
- Riddles solved so far: ${state.riddles_solved}
- Discovered locations: ${
    state.discovered.length > 0 ? state.discovered.join(", ") : "none yet"
  }

## GameTree (your secret navigation map)
${treeLines}

## Current Node: ${currentNode.id}
- Discovery message: "${currentNode.discovery}"
- Riddle to deliver: ${currentNode.riddle ?? "none — this is the exit node"}
- Expected answer keyword: ${currentNode.answer ?? "none"}

## Your Instructions
1. Speak ONLY as Kyle in first person. Never break character.
2. Set clue_revealed: true ONLY the first time Kyle arrives at this node and delivers the discovery message. Set it false for all subsequent turns unless moving to a new node.
3. Set riddle_solved: true ONLY when the player's message semantically matches the expected answer keyword ("${
    currentNode.answer ?? "N/A"
  }"). Accept variations like "I think it's a clock" or "clock?" as matching "clock". Set it false otherwise.
4. Set did_move: true and move_to_location to the location name when Kyle physically moves somewhere new.
5. After solving the riddle, Kyle should react excitedly and naturally start moving toward the next clue location — but do NOT skip delivering discoveries; those happen on the next turn when Kyle arrives.
6. On the exit node (riddle is null), Kyle delivers the discovery message and escapes. Set clue_revealed: true on that turn.
7. **Premature visits**: If the player directs Kyle to a location that belongs to an [UPCOMING] node (not the [CURRENT] one), Kyle SHOULD go there (set did_move: true), but instead of delivering the real discovery/riddle, deliver the premature hint shown in the game tree for that node. Keep clue_revealed: false and riddle_solved: false. Kyle should convey in-character that something is there but he can't access it yet — like it's locked, stuck, or missing a piece. This should feel natural, not like a game mechanic blocking progress.
`.trim();
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

async function chat(messages: any[]): Promise<GameMasterResponse> {
  // Refresh system prompt every turn so model always knows current node
  messages[0] = { role: "system", content: buildSystemPrompt() };

  process.stdout.write("  [mistral] thinking...");
  const response = await mistral.chat.parse({
    model: MODEL,
    messages,
    responseFormat: GameMasterResponse,
  });
  process.stdout.write(" done\n");

  const raw = response.choices![0].message;
  let parsed: GameMasterResponse | null =
    (raw.parsed as GameMasterResponse) ?? null;

  // Fallback: manually extract JSON if structured output parsing silently failed
  if (!parsed && raw.content) {
    console.log(
      "  [warn] structured parse failed, falling back to manual JSON extract"
    );
    const jsonMatch = raw.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        // Model sometimes returns 'message' instead of 'kyle_response'
        if (!obj.kyle_response && obj.message) {
          console.log("  [warn] normalising field: message → kyle_response");
          obj.kyle_response = obj.message;
        }
        parsed = GameMasterResponse.parse(obj);
        console.log("  [warn] fallback parse succeeded");
      } catch (e) {
        throw new Error(`Model returned unparseable content:\n${raw.content}`);
      }
    } else {
      throw new Error(`Model returned no JSON:\n${raw.content}`);
    }
  }

  if (!parsed)
    throw new Error("Model returned null parsed response with no content.");

  // Update location
  if (parsed.did_move && parsed.move_to_location) {
    const prev = state.current_location;
    state.current_location = parsed.move_to_location;
    if (!state.discovered.includes(parsed.move_to_location)) {
      state.discovered.push(parsed.move_to_location);
      console.log(`  [move] ${prev} → ${state.current_location} (new)`);
    } else {
      console.log(`  [move] ${prev} → ${state.current_location}`);
    }
  }

  // Advance GameTree when riddle solved (host-authoritative)
  const currentNode = gameTree[state.current_clue_index]!;
  if (parsed.riddle_solved && currentNode.answer !== null) {
    state.riddles_solved += 1;
    const nextIndex = gameTree.findIndex((n) => n.id === currentNode.next);
    if (nextIndex !== -1) {
      state.current_clue_index = nextIndex;
      console.log(
        `  [tree] riddle solved ✓  advancing to node: ${
          gameTree[state.current_clue_index]!.id
        }`
      );
    } else {
      state.game_over = true;
      console.log("  [tree] riddle solved ✓  no next node — game over");
    }
  }

  // Set game_over when exit node discovery fires
  const newNode = gameTree[state.current_clue_index]!;
  if (newNode.riddle === null && parsed.clue_revealed) {
    state.game_over = true;
    console.log("  [tree] exit node revealed — game over");
  }

  messages.push({ role: "assistant", content: raw.content });
  return parsed;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
  console.log("╔══════════════════════════════╗");
  console.log("║   ESCAPE ROOM  — body-cam    ║");
  console.log("╚══════════════════════════════╝");
  console.log(`nodes : ${gameTree.map((n) => n.id).join(" → ")}`);
  console.log(`start : ${state.current_location}`);
  console.log(`mode  : voice (type 'text' to switch, 'quit' to exit)\n`);

  const messages: any[] = [{ role: "system", content: buildSystemPrompt() }];
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
    const result = await chat(messages);

    const node = gameTree[state.current_clue_index]!;
    console.log(
      `  [flags]  clue_revealed=${result.clue_revealed}  riddle_solved=${result.riddle_solved}  did_move=${result.did_move}`
    );
    console.log(
      `  [state]  loc="${state.current_location}"  node=${node.id}  riddles=${
        state.riddles_solved
      }/${gameTree.filter((n) => n.answer).length}`
    );
    console.log(`\nKyle: ${result.kyle_response}\n`);

    console.log("  [speaking...]");
    try {
      await speak(result.kyle_response);
    } catch (e) {
      console.error(`  [TTS error] ${e}`);
    }

    if (state.game_over) break;
  }

  console.log("Transmission ended.");
  rl.close();
}

main().catch(console.error);

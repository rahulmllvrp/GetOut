import { Mistral } from '@mistralai/mistralai';
import { createInterface } from 'readline';
import { z } from 'zod';
import { recordAudio, speechToText, speak } from './elevenlabs';

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const MODEL = 'mistral-large-latest';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));
const waitForEnter = (q: string) => new Promise<void>((resolve) => rl.question(q, () => resolve()));

// ---------------------------------------------------------------------------
// Structured output schema
// ---------------------------------------------------------------------------

const KyleResponse = z.object({
  kyle_response: z.string(),
  did_move: z.boolean(),
  move_to_location: z.string().nullable(),
});

type KyleResponse = z.infer<typeof KyleResponse>;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

const state = { current_location: 'center of the room', discovered: [] as string[] };

const systemPrompt = `
You are Kyle, a terrified co-worker trapped in an escape room.
The player is watching through your body-cam and giving you instructions.
Stay in character: panicking, breathing hard, hesitant.

For every player message, respond with:
- kyle_response: your in-character spoken response
- did_move: true if you moved to a new location, false otherwise
- move_to_location: the location you moved to, or null if you didn't move
`;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

async function chat(messages: any[]): Promise<KyleResponse> {
  const response = await mistral.chat.parse({
    model: MODEL,
    messages,
    responseFormat: KyleResponse,
  });

  const parsed = response.choices![0].message.parsed!;

  // Update state from structured output
  if (parsed.did_move && parsed.move_to_location) {
    state.current_location = parsed.move_to_location;
    if (!state.discovered.includes(parsed.move_to_location)) {
      state.discovered.push(parsed.move_to_location);
    }
  }

  // Append assistant message to history as JSON so model has full context
  messages.push({ role: 'assistant', content: response.choices![0].message.content });

  return parsed;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Escape Room Body-Cam ===');
  console.log(`Starting location: ${state.current_location}`);
  console.log("Press ENTER to speak. Type 'text' to switch to keyboard. Type 'quit' to exit.\n");

  const messages: any[] = [{ role: 'system', content: systemPrompt }];
  let voiceMode = true;

  while (true) {
    let playerInput: string;

    if (voiceMode) {
      const cmd = (await ask("→ Press ENTER to speak (or type 'text'/'quit'): ")).trim().toLowerCase();
      if (cmd === 'quit') break;
      if (cmd === 'text') { voiceMode = false; console.log('  Switched to keyboard.\n'); continue; }

      console.log('  [recording] speak now...');
      const wavPath = await recordAudio(waitForEnter);

      console.log('  [transcribing...]');
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
      playerInput = (await ask('You: ')).trim();
      if (['quit', 'exit'].includes(playerInput.toLowerCase())) break;
      if (playerInput.toLowerCase() === 'voice') { voiceMode = true; console.log('  Switched to voice.\n'); continue; }
      if (!playerInput) continue;
    }

    messages.push({ role: 'user', content: playerInput });
    const result = await chat(messages);

    console.log('\n[Agent Response]', JSON.stringify(result, null, 2));
    console.log(`[did_move] ${result.did_move} | [move_to_location] ${result.move_to_location ?? 'none'}`);
    console.log(`[State] Location: ${state.current_location} | Discovered: ${JSON.stringify(state.discovered)}\n`);

    console.log('  [speaking...]');
    try {
      await speak(result.kyle_response);
    } catch (e) {
      console.error(`  [TTS error] ${e}`);
    }
  }

  console.log('Transmission ended.');
  rl.close();
}

main().catch(console.error);

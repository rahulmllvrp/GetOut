import { NextResponse } from "next/server";
import { generateAndSaveGameState } from "@/app/lib/generateGameState";
import { toClientState, type GameMode } from "@/app/lib/gameEngine";

/**
 * POST /api/game/generate
 *
 * Generates a brand-new game state from scratch using Mistral.
 * Reads frame_descriptions.json from public/, calls Mistral to create the
 * game tree, and writes both initGameState.json and gameState.json.
 *
 * This replaces the manual workflow of running
 * `bun run playgrounds/mistral/initGameState.ts` and copying the output.
 *
 * Takes ~10-20s depending on Mistral latency.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const mode = (body?.mode as GameMode) ?? "normal";

    console.log("[/api/game/generate] Starting game generation...");
    const t0 = performance.now();

    const state = await generateAndSaveGameState(mode);
    const clientState = toClientState(state);

    const elapsed = Math.round(performance.now() - t0);
    console.log(`[/api/game/generate] Done in ${elapsed}ms`);

    return NextResponse.json(clientState, {
      headers: { "Server-Timing": `generate;dur=${elapsed}` },
    });
  } catch (error: unknown) {
    console.error("[/api/game/generate]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate game state",
      },
      { status: 500 }
    );
  }
}

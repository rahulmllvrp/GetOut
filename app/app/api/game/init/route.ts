import { NextResponse } from "next/server";
import {
  loadGameState,
  toClientState,
  resetGameState,
} from "@/app/lib/gameEngine";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const reset = body?.reset === true;

    const state = reset ? await resetGameState() : await loadGameState();
    const clientState = toClientState(state);

    return NextResponse.json(clientState);
  } catch (error: any) {
    console.error("[/api/game/init]", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to initialize game" },
      { status: 500 },
    );
  }
}

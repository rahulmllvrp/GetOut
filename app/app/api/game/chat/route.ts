import { NextResponse } from "next/server";
import { loadGameState, chat } from "@/app/lib/gameEngine";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Missing 'message' field" },
        { status: 400 },
      );
    }

    const state = await loadGameState();

    if (state.gameOver) {
      return NextResponse.json(
        { error: "Game is already over. Reset to play again." },
        { status: 400 },
      );
    }

    const t0 = performance.now();
    const result = await chat(message, state);
    const chatMs = Math.round(performance.now() - t0);

    return NextResponse.json(result, {
      headers: { "Server-Timing": `mistral-chat;dur=${chatMs}` },
    });
  } catch (error: any) {
    console.error("[/api/game/chat]", error);
    return NextResponse.json(
      { error: error.message ?? "Chat failed" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

type LocationEntry = {
  frame: {
    frame: string;
    coordinates: {
      pos: { x: number; y: number; z: number };
      rot: { x: number; y: number; z?: number };
    };
    image_filepath: string | null;
  };
  clue?: {
    hiddenAreaDescription?: string | null;
    hiddenPovImagePath?: string | null;
  } | null;
};

export async function GET() {
  const raw = await readFile(join(process.cwd(), "data", "initGameState.json"), "utf-8");
  const state = JSON.parse(raw);

  // allLocations is the canonical list — deduplicate by key since some locations
  // (e.g. whiteboard) appear in both gameTree and allLocations.
  const seen = new Set<string>();
  const locations = (state.allLocations as LocationEntry[])
    .filter((entry) => {
      const key = entry.frame.frame;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      key: entry.frame.frame,
      pos: entry.frame.coordinates.pos,
      rot: entry.frame.coordinates.rot,
      imageFilepath: entry.frame.image_filepath,
      hiddenAreaDescription: entry.clue?.hiddenAreaDescription ?? null,
      hiddenPovImagePath: entry.clue?.hiddenPovImagePath ?? null,
    }));

  return NextResponse.json(locations);
}

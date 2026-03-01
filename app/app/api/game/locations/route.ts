import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

/** Resolve a web path like /enhanced-cache/foo.png to an absolute disk path. */
function webPathToDisk(webPath: string): string {
  return join(process.cwd(), "public", webPath);
}

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
    discovery?: string | null;
    riddle?: string | null;
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
    .map((entry) => {
      const rawImagePath = entry.frame.image_filepath;
      const imageFilepath =
        rawImagePath && existsSync(webPathToDisk(rawImagePath))
          ? rawImagePath
          : null;

      const rawPovPath = entry.clue?.hiddenPovImagePath ?? null;
      const hiddenPovImagePath =
        rawPovPath && existsSync(webPathToDisk(rawPovPath))
          ? rawPovPath
          : null;

      return {
        key: entry.frame.frame,
        pos: entry.frame.coordinates.pos,
        rot: entry.frame.coordinates.rot,
        imageFilepath,
        hiddenAreaDescription: entry.clue?.hiddenAreaDescription ?? null,
        clueDiscovery: entry.clue?.discovery ?? null,
        clueRiddle: entry.clue?.riddle ?? null,
        hiddenPovImagePath,
      };
    });

  return NextResponse.json(locations);
}

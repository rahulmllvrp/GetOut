import { GoogleGenAI } from '@google/genai';
import { createInterface } from 'readline';

const ai = new GoogleGenAI({});

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

function mimeType(path: string): string {
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

type ImageRef = { label: string; path: string };

async function generate(prompt: string, images: ImageRef[]) {
  // Build parts: for each image, a label text part followed by the image part, then the final prompt
  const parts: object[] = [];

  for (const img of images) {
    parts.push({ text: img.label });
    const buffer = await Bun.file(img.path).arrayBuffer();
    parts.push({
      inlineData: {
        mimeType: mimeType(img.path),
        data: Buffer.from(buffer).toString('base64'),
      },
    });
  }

  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ role: 'user', parts }],
  });

  for (const part of response.candidates![0].content.parts) {
    if (part.text) {
      console.log(`  ${part.text}`);
    } else if (part.inlineData) {
      const filename = `output_${Date.now()}.png`;
      await Bun.write(
        `hiddenPOVs/${filename}`,
        Buffer.from(part.inlineData.data!, 'base64')
      );
      console.log(`  [saved] hiddenPOVs/${filename}`);
    }
  }
}

async function main() {
  console.log('Gemini Grounded Image Generation (multi-image + text)\n');

  while (true) {
    // Collect reference images
    const images: ImageRef[] = [];
    const countStr = await ask('→ How many reference images? ');
    const count = parseInt(countStr);

    if (isNaN(count) || count < 0) {
      console.log('  [error] invalid number\n');
      continue;
    }

    let valid = true;
    for (let i = 0; i < count; i++) {
      const label = await ask(`→ Label for image ${i + 1} (e.g. "This is my cat"): `);
      const path = (await ask(`→ Path to image ${i + 1}: `)).trim();

      if (!(await Bun.file(path).exists())) {
        console.log(`  [error] file not found: ${path}\n`);
        valid = false;
        break;
      }

      images.push({ label, path });
    }

    if (!valid) continue;

    const prompt = await ask('→ What should be generated? ');
    if (!prompt.trim()) continue;

    console.log('  [generating...]');
    try {
      await generate(prompt.trim(), images);
    } catch (e) {
      console.error('  [error]', e);
    }
    console.log();
  }
}

main().catch(console.error);

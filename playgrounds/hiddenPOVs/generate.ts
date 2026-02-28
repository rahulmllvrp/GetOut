import { GoogleGenAI } from '@google/genai';
import { createInterface } from 'readline';

const ai = new GoogleGenAI({});

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt(q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function generate(description: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: description,
  });

  for (const part of response.candidates![0].content.parts) {
    if (part.text) {
      console.log(`  ${part.text}`);
    } else if (part.inlineData) {
      const buffer = Buffer.from(part.inlineData.data!, 'base64');
      const filename = `output_${Date.now()}.png`;
      await Bun.write(`hiddenPOVs/${filename}`, buffer);
      console.log(`  [saved] hiddenPOVs/${filename}`);
    }
  }
}

async function main() {
  console.log('Gemini Image Generator\n');

  while (true) {
    const description = await prompt('→ ');
    if (!description.trim()) continue;
    console.log('  [generating...]');
    try {
      await generate(description);
    } catch (e) {
      console.error('  [error]', e);
    }
    console.log();
  }
}

main().catch(console.error);

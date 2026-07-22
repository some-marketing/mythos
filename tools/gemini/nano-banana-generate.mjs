#!/usr/bin/env node
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, basename } from 'path';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY not set. See creds.config.json / env.example in this directory for how to seed it.');
  process.exit(1);
}

const [,, promptFile, outDir, ...refImages] = process.argv;
if (!promptFile || !outDir) {
  console.error('usage: nano-banana-generate.mjs <prompt-file> <out-dir> [ref-image...]');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const prompt = readFileSync(promptFile, 'utf8');

const parts = [{ text: prompt }];
for (const img of refImages) {
  const data = readFileSync(img);
  parts.push({
    inlineData: {
      mimeType: img.endsWith('.png') ? 'image/png' : 'image/jpeg',
      data: data.toString('base64'),
    },
  });
}

const ai = new GoogleGenAI({ apiKey });
const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';
console.log(`→ ${model} | prompt:${promptFile} | refs:${refImages.length}`);

try {
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
  });

  const tag = basename(promptFile, '.txt').replace(/\W+/g, '-');
  let idx = 0, saved = 0;
  for (const cand of res.candidates || []) {
    for (const part of cand.content?.parts || []) {
      if (part.inlineData?.data) {
        const out = resolve(outDir, `${tag}-${++idx}.png`);
        writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'));
        console.log(`  saved ${out}`);
        saved++;
      } else if (part.text) {
        console.log(`  text: ${part.text.slice(0, 200)}`);
      }
    }
  }

  if (saved === 0) {
    console.error('no images returned');
    // console.error(JSON.stringify(res, null, 2).slice(0, 2000));
    process.exit(2);
  }
} catch (error) {
  console.error('API Error:', error);
  process.exit(3);
}

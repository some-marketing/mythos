import { GoogleGenAI } from '@google/genai';
const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });
const models = await ai.models.list();
console.log(JSON.stringify(models, null, 2));

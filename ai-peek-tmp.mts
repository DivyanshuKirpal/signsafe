// Throwaway calibration (not committed): prints raw Gemini answers for one fixture and the validator result.
process.loadEnvFile(".env.local");
import { analyzeTransaction } from "./app/lib/analyze";
import { buildExplanationContext } from "./app/lib/ai/facts";
import { generateExplanationText } from "./app/lib/ai/gemini";
import { buildUserPrompt, SYSTEM_INSTRUCTION } from "./app/lib/ai/prompt";
import { parseAnswer, validateExplanation } from "./app/lib/ai/validate";
import { loadFixture, replayFixture } from "./tests/helpers/fake-rpc";
const name = process.argv[2] ?? "s2-unlimited-approval";
const runs = Number(process.argv[3] ?? 3);
const f = loadFixture(name, "tests/fixtures/scenarios");
const a = await analyzeTransaction(f.txBase64, { rpc: replayFixture(f) });
const ctx = buildExplanationContext(a);
for (let i = 0; i < runs; i++) {
  const r = await generateExplanationText(
    { apiKey: process.env.GEMINI_API_KEY!, model: process.env.GEMINI_MODEL!, fallbackModel: process.env.GEMINI_FALLBACK_MODEL, log: (m) => console.log("  " + m) },
    { system: SYSTEM_INSTRUCTION, user: buildUserPrompt(ctx.facts) },
    Date.now() + 30_000,
  );
  if (!r.ok) { console.log(`run ${i}: failure ${r.failure}`); continue; }
  let verdict = "";
  try { const v = validateExplanation(parseAnswer(r.text), ctx.meta); verdict = v.ok ? "ACCEPTED" : `REJECTED ${v.code}: ${v.detail}`; } catch { verdict = "REJECTED INVALID_JSON"; }
  console.log(`run ${i} (${r.modelVersion}): ${verdict}\n${r.text.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[key]")}\n`);
  await new Promise((res) => setTimeout(res, 1500));
}

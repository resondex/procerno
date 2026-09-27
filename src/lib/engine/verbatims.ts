import { openaiClient } from "./providers";
import { VERBATIM_MODEL } from "./models";

export interface VerbatimExplanation {
  quote: string | null;
  interpretation: string | null;
}

/** How one answer criticizes a brand: one verbatim negative sentence and a
 * plain reading of it. Throws on API or parse failure; callers decide the
 * fallback. Exported so evals run the byte-identical request. */
export async function explainNegativeVerbatim(
  display: string,
  answerText: string
): Promise<VerbatimExplanation> {
  const res = await openaiClient().chat.completions.create({
    model: VERBATIM_MODEL,
    messages: [
      {
        role: "system",
        content:
          `From the answer, extract how "${display}" is criticized. Return ` +
          "quote: ONE verbatim sentence (max 200 chars) that frames it " +
          "negatively, and interpretation: one plain sentence on the criticism.",
      },
      { role: "user", content: answerText },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "verbatim",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            quote: { type: ["string", "null"] },
            interpretation: { type: ["string", "null"] },
          },
          required: ["quote", "interpretation"],
        },
      },
    },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
  return { quote: parsed.quote ?? null, interpretation: parsed.interpretation ?? null };
}

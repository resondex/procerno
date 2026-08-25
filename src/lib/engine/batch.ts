import { toFile } from "openai";
import { store } from "../store";
import type { RunBatch } from "../types";
import {
  CoderUnavailableError,
  anthropicClient,
  extractCodingConsensus,
  getEngine,
  openaiClient,
} from "./providers";

/**
 * The batch pipeline: the same (prompt × repeat × engine) tasks a live run
 * collects, submitted to the vendors' batch APIs at their 50% discount.
 * OpenAI and Anthropic engines are batchable - including the search
 * variants (verified: web_search runs inside both vendors' batches).
 * Gemini/Perplexity/Grok tasks stay on the live path.
 *
 * Flow: submitRunBatches() at run creation → the live driver collects the
 * non-batchable engines and then reports "waiting" → pollRunBatches()
 * (cron-driven) ingests finished vendor batches, coding each answer with
 * the same fixed coder as the live path → once every batch is terminal the
 * ordinary driver mops up anything missing live and finalizes.
 */

const INGEST_CONCURRENCY = 32;

export function batchableEngine(id: string): boolean {
  const e = getEngine(id);
  if (!e || !process.env[e.keyEnv]) return false;
  if (e.sdk === "anthropic") return true;
  return e.vendor === "OpenAI" && !e.baseURL;
}

interface BatchTask {
  promptId: string;
  repeatIdx: number;
  engine: string;
  text: string;
}

/** Pending batchable tasks: the run's full grid minus stored responses. */
async function pendingTasks(runId: string): Promise<BatchTask[]> {
  const run = await store.getRun(runId);
  if (!run) return [];
  const project = await store.getProject(run.project_id);
  if (!project) return [];
  const prompts = (await store.listPrompts(project.id)).filter((p) => !p.retired);
  const done = new Set(
    (await store.listResponses(runId)).map(
      (r) => `${r.prompt_id}:${r.repeat_idx}:${r.model}`
    )
  );
  const engines = run.models.filter(batchableEngine);
  const tasks: BatchTask[] = [];
  for (const p of prompts) {
    for (let r = 0; r < run.repeats; r++) {
      for (const engine of engines) {
        if (!done.has(`${p.id}:${r}:${engine}`)) {
          tasks.push({ promptId: p.id, repeatIdx: r, engine, text: p.text });
        }
      }
    }
  }
  return tasks;
}

/** Submit every batchable task to its vendor; one provider batch per
 * (vendor, endpoint) group. Returns the number of batches submitted. */
export async function submitRunBatches(runId: string): Promise<number> {
  const tasks = await pendingTasks(runId);
  if (tasks.length === 0) return 0;

  const groups: Record<string, BatchTask[]> = {};
  for (const t of tasks) {
    const e = getEngine(t.engine)!;
    const key =
      e.sdk === "anthropic"
        ? "anthropic"
        : e.mode === "search"
          ? "openai:/v1/responses"
          : "openai:/v1/chat/completions";
    (groups[key] ??= []).push(t);
  }

  let submitted = 0;
  for (const [key, group] of Object.entries(groups)) {
    const manifest = group.map(({ promptId, repeatIdx, engine }) => ({
      promptId,
      repeatIdx,
      engine,
    }));
    if (key === "anthropic") {
      const a = await anthropicClient();
      const batch = await a.messages.batches.create({
        requests: group.map((t, i) => {
          const e = getEngine(t.engine)!;
          return {
            custom_id: `i${i}`,
            params: {
              model: e.apiModel ?? e.id,
              max_tokens: 4096,
              messages: [{ role: "user" as const, content: t.text }],
              ...(e.mode === "search"
                ? {
                    tools: [
                      {
                        type: "web_search_20250305" as const,
                        name: "web_search" as const,
                        max_uses: 3,
                      },
                    ],
                  }
                : {}),
            },
          };
        }),
      });
      await store.insertRunBatch({
        runId,
        vendor: "anthropic",
        endpoint: "messages",
        providerBatchId: batch.id,
        manifest,
      });
    } else {
      const endpoint = key.split(":")[1] as "/v1/responses" | "/v1/chat/completions";
      const lines = group
        .map((t, i) => {
          const e = getEngine(t.engine)!;
          const model = e.apiModel ?? e.id;
          const body =
            endpoint === "/v1/responses"
              ? { model, input: t.text, tools: [{ type: "web_search" }] }
              : { model, messages: [{ role: "user", content: t.text }] };
          return JSON.stringify({ custom_id: `i${i}`, method: "POST", url: endpoint, body });
        })
        .join("\n");
      const client = openaiClient();
      const file = await client.files.create({
        file: await toFile(Buffer.from(lines + "\n"), "run_batch.jsonl"),
        purpose: "batch",
      });
      const batch = await client.batches.create({
        input_file_id: file.id,
        endpoint,
        completion_window: "24h",
      });
      await store.insertRunBatch({
        runId,
        vendor: "openai",
        endpoint,
        providerBatchId: batch.id,
        manifest,
      });
    }
    submitted++;
  }
  return submitted;
}

interface Extracted {
  text: string;
  finishReason: string | null;
  citations: string[] | null;
  searchCount: number | null;
}

/* Mirror the live parsers in providers.ts, applied to batch result bodies. */

function extractOpenAiChat(body: Record<string, unknown>): Extracted {
  const choices = body.choices as
    | { message?: { content?: string }; finish_reason?: string }[]
    | undefined;
  return {
    text: choices?.[0]?.message?.content ?? "",
    finishReason: choices?.[0]?.finish_reason ?? null,
    citations: null,
    searchCount: null,
  };
}

function extractOpenAiResponses(body: Record<string, unknown>): Extracted {
  const output = (body.output ?? []) as {
    type: string;
    content?: { type: string; text?: string; annotations?: { type: string; url?: string }[] }[];
  }[];
  const searches = output.filter((i) => i.type === "web_search_call").length;
  const urls = new Set<string>();
  const parts: string[] = [];
  for (const item of output) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) parts.push(part.text);
      for (const ann of part.annotations ?? []) {
        if (ann.type === "url_citation" && ann.url) urls.add(ann.url);
      }
    }
  }
  const b = body as { output_text?: string; status?: string; incomplete_details?: { reason?: string } };
  return {
    text: b.output_text ?? parts.join("\n"),
    finishReason:
      b.incomplete_details?.reason ?? (b.status === "completed" ? "stop" : b.status ?? null),
    citations: urls.size > 0 ? [...urls] : null,
    searchCount: searches,
  };
}

function extractAnthropic(message: Record<string, unknown>, searchMode: boolean): Extracted {
  const content = (message.content ?? []) as {
    type: string;
    text?: string;
    citations?: { url?: string }[];
  }[];
  const urls = new Set<string>();
  for (const b of content) {
    if (b.type !== "text") continue;
    for (const c of b.citations ?? []) if (c.url) urls.add(c.url);
  }
  const usage = message.usage as
    | { server_tool_use?: { web_search_requests?: number } }
    | undefined;
  return {
    text: content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n"),
    finishReason: (message.stop_reason as string | null) ?? null,
    citations: urls.size > 0 ? [...urls] : null,
    searchCount: searchMode ? usage?.server_tool_use?.web_search_requests ?? 0 : null,
  };
}

/** Code and store one vendor batch's answers - the same coder, the same
 * response rows, as the live path. Already-stored triples are skipped so a
 * poll interrupted mid-ingest resumes cleanly. */
async function ingest(
  runId: string,
  batch: RunBatch,
  results: Map<string, Extracted>
): Promise<void> {
  const run = await store.getRun(runId);
  const project = run ? await store.getProject(run.project_id) : null;
  if (!run || !project) return;
  const ctx = {
    targetBrand: project.brand,
    knownBrands: [project.brand, ...project.competitors],
    reasonCodes: project.reason_taxonomy,
  };
  const done = new Set(
    (await store.listResponses(runId)).map(
      (r) => `${r.prompt_id}:${r.repeat_idx}:${r.model}`
    )
  );
  const entries = [...results.entries()]
    .map(([customId, ex]) => {
      const idx = Number(customId.slice(1));
      const task = batch.manifest[idx];
      return task ? { task, ex } : null;
    })
    .filter((x): x is { task: RunBatch["manifest"][number]; ex: Extracted } => x !== null)
    .filter(
      ({ task }) => !done.has(`${task.promptId}:${task.repeatIdx}:${task.engine}`)
    )
    .filter(({ ex }) => ex.text.trim().length > 0);

  let cursor = 0;
  const outage: { err: CoderUnavailableError | null } = { err: null };
  async function worker(): Promise<void> {
    while (cursor < entries.length && !outage.err) {
      const { task, ex } = entries[cursor++];
      try {
        const coding = await extractCodingConsensus(ex.text, ctx);
        await store.insertResponse({
          runId,
          promptId: task.promptId,
          repeatIdx: task.repeatIdx,
          model: task.engine,
          finishReason: ex.finishReason,
          citations: ex.citations,
          coderModel: coding.coderProvenance,
          searchCount: ex.searchCount,
          text: ex.text,
          mentions: coding.mentions,
          coding,
        });
      } catch (err) {
        if (err instanceof CoderUnavailableError) {
          outage.err = err;
          return;
        }
        console.error(`batch ingest task failed for run ${runId}:`, err);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(INGEST_CONCURRENCY, entries.length) }, worker)
  );
  if (outage.err) throw outage.err;
}

/**
 * Check every open vendor batch for a run; ingest the finished ones.
 * Returns how many are still open. A vendor-side failure marks the row
 * failed - those tasks are mopped up live by the ordinary driver once no
 * batches remain open.
 */
export async function pollRunBatches(runId: string): Promise<{ open: number }> {
  const rows = (await store.listRunBatches(runId)).filter(
    (b) => b.status === "submitted"
  );
  let open = 0;
  for (const row of rows) {
    try {
      if (row.vendor === "openai") {
        const client = openaiClient();
        const b = await client.batches.retrieve(row.provider_batch_id);
        if (b.status === "completed" && b.output_file_id) {
          const content = await (await client.files.content(b.output_file_id)).text();
          const results = new Map<string, Extracted>();
          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as {
                custom_id: string;
                response?: { status_code?: number; body?: Record<string, unknown> };
              };
              if (parsed.response?.status_code !== 200 || !parsed.response.body) continue;
              results.set(
                parsed.custom_id,
                row.endpoint === "/v1/responses"
                  ? extractOpenAiResponses(parsed.response.body)
                  : extractOpenAiChat(parsed.response.body)
              );
            } catch {
              /* one bad line loses one answer, not the batch */
            }
          }
          await ingest(runId, row, results);
          await store.updateRunBatchStatus(row.id, "ingested");
        } else if (["failed", "expired", "cancelled"].includes(b.status ?? "")) {
          await store.updateRunBatchStatus(row.id, "failed");
        } else {
          open++;
        }
      } else {
        const a = await anthropicClient();
        const b = await a.messages.batches.retrieve(row.provider_batch_id);
        if (b.processing_status === "ended") {
          const results = new Map<string, Extracted>();
          for await (const entry of await a.messages.batches.results(row.provider_batch_id)) {
            if (entry.result.type !== "succeeded") continue;
            const idx = Number(entry.custom_id.slice(1));
            const task = row.manifest[idx];
            const searchMode = task
              ? getEngine(task.engine)?.mode === "search"
              : false;
            results.set(
              entry.custom_id,
              extractAnthropic(
                entry.result.message as unknown as Record<string, unknown>,
                searchMode
              )
            );
          }
          await ingest(runId, row, results);
          await store.updateRunBatchStatus(row.id, "ingested");
        } else {
          open++;
        }
      }
    } catch (err) {
      if (err instanceof CoderUnavailableError) {
        // Leave the row submitted: results are safe at the vendor; the next
        // poll retries the ingest once the coder is back.
        console.error(`batch ingest paused for run ${runId}: ${err.message}`);
        open++;
      } else {
        console.error(`batch poll failed for run ${runId} (${row.provider_batch_id}):`, err);
        open++;
      }
    }
  }
  return { open };
}

/** Whether a run still has vendor batches outstanding. */
export async function hasOpenBatches(runId: string): Promise<boolean> {
  return (await store.listRunBatches(runId)).some((b) => b.status === "submitted");
}

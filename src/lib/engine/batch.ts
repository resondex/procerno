import OpenAI, { toFile } from "openai";
import { store } from "../store";
import { logCost, tagCosts } from "../cost_log";
import type { RunBatch } from "../types";
import { SEARCH_CAP, anthropicClient, getEngine, openaiClient } from "./providers";
import { loadRunPrompts } from "./surfaces";
import {
  type BilledUsage,
  fromAnthropicUsage,
  fromChatUsage,
  fromResponsesBody,
  totalInput,
} from "./usage";

/**
 * The batch pipeline: the same (prompt × repeat × engine) tasks a live run
 * collects, submitted to the vendors' batch APIs at their 50% discount.
 * OpenAI, Anthropic and Gemini engines are batchable - including the
 * search variants (verified: web_search runs inside both vendors' batches).
 * Grok stays live (xAI's batch API rejects grok-4.6: "not supported for
 * batch processing", probe 2026-10-10) and so does Perplexity (no batch
 * API).
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
  if (e.vendor === "Google") return true;
  return e.vendor === "OpenAI" && !e.baseURL;
}

/* Gemini batch: the OpenAI-compatibility layer creates and tracks batches,
 * but file upload and download are native Gemini Files API calls (the
 * compatibility layer does not support them). Results come back in OpenAI
 * output format. Probe-verified 2026-10-10. */
const GEMINI_BASE = "https://generativelanguage.googleapis.com";

function geminiCompat(): OpenAI {
  return new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: `${GEMINI_BASE}/v1beta/openai/`,
    timeout: 150_000,
    maxRetries: 1,
  });
}

async function geminiUpload(jsonl: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY ?? "";
  const bytes = Buffer.from(jsonl);
  const start = await fetch(`${GEMINI_BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": "application/jsonl",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "procerno_run_batch" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error(`gemini upload start failed: ${start.status}`);
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Length": String(bytes.length),
    },
    body: bytes,
  });
  const j = (await up.json()) as { file?: { name?: string } };
  if (!j.file?.name) throw new Error(`gemini upload failed: ${up.status}`);
  return j.file.name;
}

async function geminiDownload(fileName: string): Promise<string> {
  const res = await fetch(`${GEMINI_BASE}/download/v1beta/${fileName}:download?alt=media`, {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
  });
  if (!res.ok) throw new Error(`gemini download failed: ${res.status}`);
  return res.text();
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
  const prompts = await loadRunPrompts(run);
  const done = new Set(
    (await store.listResponseMeta(runId)).map((r) => `${r.prompt_id}:${r.repeat_idx}:${r.model}`),
  );
  // Tasks riding in a still-open batch are not pending: submitRunBatches
  // must be safely re-callable after a partial failure (one vendor's batch
  // rejected, another's still processing) without double-submitting.
  for (const b of await store.listRunBatches(runId)) {
    if (b.status !== "submitted") continue;
    for (const m of b.manifest) done.add(`${m.promptId}:${m.repeatIdx}:${m.engine}`);
  }
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
    // OpenAI validates that a batch holds a SINGLE model (learned on the
    // AmEx shakedown: gpt-5 + gpt-5-mini in one file -> the whole batch
    // rejected as mismatched_model). Anthropic accepts mixed models.
    const key =
      e.sdk === "anthropic"
        ? "anthropic"
        : e.vendor === "Google"
          ? `google:/v1/chat/completions:${e.apiModel ?? e.id}`
          : `openai:${e.mode === "search" ? "/v1/responses" : "/v1/chat/completions"}:${e.apiModel ?? e.id}`;
    (groups[key] ??= []).push(t);
  }

  // One vendor group failing must not strand the others: each group
  // submits on its own, and failures are reported together at the end.
  // An unsubmitted group's tasks wait for the open batches, then the live
  // mop-up collects them (at list price).
  let submitted = 0;
  const failures: string[] = [];
  for (const [key, group] of Object.entries(groups)) {
    const manifest = group.map(({ promptId, repeatIdx, engine }) => ({
      promptId,
      repeatIdx,
      engine,
    }));
    try {
      if (key === "anthropic") {
        const a = await anthropicClient();
        const batch = await a.messages.batches.create({
          requests: group.map((t, i) => {
            const e = getEngine(t.engine)!;
            return {
              custom_id: `i${i}`,
              params: {
                model: e.apiModel ?? e.id,
                // Mirrors the live path's cap (see completeWithEngine): 4096
                // truncated 18/1,040 Anthropic answers on the jira battery.
                max_tokens: 8192,
                messages: [{ role: "user" as const, content: t.text }],
                ...(e.mode === "search"
                  ? {
                      tools: [
                        {
                          type: "web_search_20250305" as const,
                          name: "web_search" as const,
                          max_uses: SEARCH_CAP,
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
      } else if (key.startsWith("google:")) {
        // One model per batch, OpenAI-format request lines.
        const lines = group
          .map((t, i) => {
            const e = getEngine(t.engine)!;
            return JSON.stringify({
              custom_id: `i${i}`,
              method: "POST",
              url: "/v1/chat/completions",
              body: {
                model: e.apiModel ?? e.id,
                messages: [{ role: "user", content: t.text }],
              },
            });
          })
          .join("\n");
        const fileName = await geminiUpload(lines + "\n");
        const batch = await geminiCompat().batches.create({
          input_file_id: fileName,
          endpoint: "/v1/chat/completions",
          completion_window: "24h",
        });
        await store.insertRunBatch({
          runId,
          vendor: "google",
          endpoint: "/v1/chat/completions",
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
                ? {
                    model,
                    input: t.text,
                    tools: [{ type: "web_search" }],
                    max_tool_calls: SEARCH_CAP,
                  }
                : { model, messages: [{ role: "user", content: t.text }] };
            return JSON.stringify({
              custom_id: `i${i}`,
              method: "POST",
              url: endpoint,
              body,
            });
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
    } catch (err) {
      console.error(`batch submission failed for run ${runId} group ${key}:`, err);
      failures.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `batch submission failed for ${failures.length} group(s): ${failures.join("; ")}`,
    );
  }
  return submitted;
}

interface Extracted {
  text: string;
  finishReason: string | null;
  citations: string[] | null;
  searchCount: number | null;
  /** Billed usage from the vendor's batch-result body (lib/engine/usage). */
  usage: BilledUsage;
}

/* Mirror the live parsers in providers.ts, applied to batch result bodies. */

function extractOpenAiChat(body: Record<string, unknown>): Extracted {
  const choices = body.choices as
    | { message?: { content?: string }; finish_reason?: string; finishReason?: string }[]
    | undefined;
  return {
    text: choices?.[0]?.message?.content ?? "",
    // Gemini batch output spells it finishReason.
    finishReason: choices?.[0]?.finish_reason ?? choices?.[0]?.finishReason ?? null,
    citations: null,
    searchCount: null,
    // Same normalizer as live: Gemini's thinking tokens sit outside
    // completion_tokens and only show in total_tokens.
    usage: fromChatUsage(body.usage),
  };
}

function extractOpenAiResponses(body: Record<string, unknown>): Extracted {
  const output = (body.output ?? []) as {
    type: string;
    content?: {
      type: string;
      text?: string;
      annotations?: { type: string; url?: string }[];
    }[];
  }[];
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
  const b = body as {
    output_text?: string;
    status?: string;
    incomplete_details?: { reason?: string };
  };
  const usage = fromResponsesBody(body);
  return {
    text: b.output_text ?? parts.join("\n"),
    finishReason:
      b.incomplete_details?.reason ?? (b.status === "completed" ? "stop" : (b.status ?? null)),
    citations: urls.size > 0 ? [...urls] : null,
    // Billed searches (tool_usage.web_search.num_requests): with
    // max_tool_calls 3 the output can hold 4 "search" actions billed as 3.
    searchCount: usage.searches,
    usage,
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
  const usage = fromAnthropicUsage(message.usage);
  return {
    text: content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n"),
    finishReason: (message.stop_reason as string | null) ?? null,
    citations: urls.size > 0 ? [...urls] : null,
    searchCount: searchMode ? usage.searches : null,
    usage,
  };
}

/** Code and store one vendor batch's answers - the same response rows as
 * the live path. Every BILLED result is ledgered, including empty answers
 * that will be re-collected live (the vendor charged for them). Already-
 * stored triples are skipped so a poll interrupted mid-ingest resumes
 * cleanly. */
async function ingest(
  runId: string,
  batch: RunBatch,
  results: Map<string, Extracted>,
): Promise<void> {
  const run = await store.getRun(runId);
  const project = run ? await store.getProject(run.project_id) : null;
  if (!run || !project) return;
  tagCosts({ projectId: project.id, runId });
  const done = new Set(
    (await store.listResponseMeta(runId)).map((r) => `${r.prompt_id}:${r.repeat_idx}:${r.model}`),
  );
  const entries = [...results.entries()]
    .map(([customId, ex]) => {
      const idx = Number(customId.slice(1));
      const task = batch.manifest[idx];
      return task ? { task, ex } : null;
    })
    .filter((x): x is { task: RunBatch["manifest"][number]; ex: Extracted } => x !== null)
    .filter(({ task }) => !done.has(`${task.promptId}:${task.repeatIdx}:${task.engine}`));

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < entries.length) {
      const { task, ex } = entries[cursor++];
      try {
        // Batch answers never touch the live clients, so their usage is
        // ledgered here, from the vendor's own batch-result accounting,
        // under the ENGINE id (search variants share an API model).
        const engine = getEngine(task.engine);
        logCost({
          model: engine?.apiModel ?? task.engine,
          engine: task.engine,
          batch: true,
          usage: ex.usage,
          purpose: "run:answer_batch",
        });
        // An empty answer is a failed collection: the live mop-up re-asks.
        if (!ex.text.trim()) continue;
        // Stored uncoded, like live collection: the coding wave picks these
        // up once every batch is terminal.
        await store.insertResponse({
          runId,
          promptId: task.promptId,
          repeatIdx: task.repeatIdx,
          model: task.engine,
          finishReason: ex.finishReason,
          citations: ex.citations,
          coderModel: null,
          searchCount: ex.searchCount,
          inputTokens: totalInput(ex.usage),
          outputTokens: ex.usage.outputTokens,
          text: ex.text,
          mentions: [],
          coding: null,
        });
      } catch (err) {
        console.error(`batch ingest task failed for run ${runId}:`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(INGEST_CONCURRENCY, entries.length) }, worker));
}

/** Parse an OpenAI-format batch output file (OpenAI and Gemini). */
function parseOpenAiFormat(content: string, endpoint: string): Map<string, Extracted> {
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
        endpoint === "/v1/responses"
          ? extractOpenAiResponses(parsed.response.body)
          : extractOpenAiChat(parsed.response.body),
      );
    } catch {
      /* one bad line loses one answer, not the batch */
    }
  }
  return results;
}

const TERMINAL_FAILED = ["failed", "expired", "cancelled"];

/**
 * Check every open vendor batch for a run; ingest the finished ones.
 * Returns how many are still open. A vendor-side failure marks the row
 * failed - after ingesting any partial output the vendor did return (an
 * expired batch keeps its finished lines, and they were billed) - and the
 * rest is mopped up live by the ordinary driver once no batches remain
 * open.
 */
export async function pollRunBatches(runId: string): Promise<{ open: number }> {
  const rows = (await store.listRunBatches(runId)).filter((b) => b.status === "submitted");
  let open = 0;
  for (const row of rows) {
    try {
      if (row.vendor === "openai" || row.vendor === "google") {
        const google = row.vendor === "google";
        const client = google ? geminiCompat() : openaiClient();
        const b = await client.batches.retrieve(row.provider_batch_id);
        const status = b.status ?? "";
        const terminalFailed = TERMINAL_FAILED.includes(status);
        if ((status === "completed" || terminalFailed) && b.output_file_id) {
          const content = google
            ? await geminiDownload(b.output_file_id)
            : await (await client.files.content(b.output_file_id)).text();
          await ingest(runId, row, parseOpenAiFormat(content, row.endpoint));
          await store.updateRunBatchStatus(row.id, terminalFailed ? "failed" : "ingested");
        } else if (terminalFailed || status === "completed") {
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
            const searchMode = task ? getEngine(task.engine)?.mode === "search" : false;
            results.set(
              entry.custom_id,
              extractAnthropic(
                entry.result.message as unknown as Record<string, unknown>,
                searchMode,
              ),
            );
          }
          await ingest(runId, row, results);
          await store.updateRunBatchStatus(row.id, "ingested");
        } else {
          open++;
        }
      }
    } catch (err) {
      console.error(`batch poll failed for run ${runId} (${row.provider_batch_id}):`, err);
      open++;
    }
  }
  return { open };
}

/** Whether a run still has vendor batches outstanding. */
export async function hasOpenBatches(runId: string): Promise<boolean> {
  return (await store.listRunBatches(runId)).some((b) => b.status === "submitted");
}

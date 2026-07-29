import {
  env,
  ModelRegistry,
  pipeline,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
import { CONDITION_CARDS, MODEL_ID } from "./core.js";

env.useBrowserCache = true;
env.useWasmCache = true;

let extractor;
let cardVectors;
let runtime;

function dot(first, second) {
  return first.reduce(
    (sum, value, index) => sum + value * second[index],
    0,
  );
}

async function loadExtractor() {
  if (extractor) return extractor;

  runtime = {
    device: "wasm",
    dtype: "q8",
  };

  let totalBytes = null;
  try {
    const files = await ModelRegistry.get_pipeline_files(
      "feature-extraction",
      MODEL_ID,
      runtime,
    );
    totalBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  } catch {
    // File introspection is helpful but must not prevent model loading.
  }

  self.postMessage({ type: "loading", runtime, totalBytes });
  const started = performance.now();
  extractor = await pipeline(
    "feature-extraction",
    MODEL_ID,
    {
      ...runtime,
      progress_callback: (event) => {
        if (event.status === "progress_total") {
          self.postMessage({
            type: "progress",
            progress: event.progress,
          });
        }
      },
    },
  );
  const cardOutput = await extractor(
    CONDITION_CARDS.map(
      (card) => `${card.label}: ${card.description}`,
    ),
    { pooling: "mean", normalize: true },
  );
  cardVectors = cardOutput.tolist();
  self.postMessage({
    type: "ready",
    runtime,
    loadMs: Math.round(performance.now() - started),
    totalBytes,
  });
  return extractor;
}

self.addEventListener("message", async (event) => {
  if (event.data?.type !== "analyze") return;

  try {
    const pipe = await loadExtractor();
    const started = performance.now();
    const queryOutput = await pipe(event.data.text, {
      pooling: "mean",
      normalize: true,
    });
    const query = queryOutput.tolist()[0];
    const ranked = CONDITION_CARDS.map((card, index) => ({
      label: card.label,
      score: dot(query, cardVectors[index]),
    })).sort((first, second) => second.score - first.score);
    const result = {
      labels: ranked.map((row) => row.label),
      scores: ranked.map((row) => row.score),
    };
    self.postMessage({
      type: "result",
      requestId: event.data.requestId,
      result,
      runtime,
      inferenceMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: event.data.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

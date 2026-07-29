import {
  MODEL_ID,
  compareRankings,
  findRedFlags,
  normalizeInput,
  rankRows,
  reorderSymptoms,
  runsToCsv,
} from "./core.js";

const worker = new Worker("./src/worker.js", { type: "module" });
const runs = [];
const pending = new Map();
let requestCounter = 0;
let loadInfo = null;

const form = document.querySelector("#analysis-form");
const input = document.querySelector("#symptoms");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const compareButton = document.querySelector("#compare");
const downloadButton = document.querySelector("#download");
const redFlags = document.querySelector("#red-flags");
const runtime = document.querySelector("#runtime");

function setStatus(message, kind = "") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function formatBytes(bytes) {
  if (!bytes) return "size unavailable";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderRows(rows) {
  results.innerHTML = rows
    .map(
      (row) => `
        <li>
          <span class="rank">${row.rank}</span>
          <span>${row.label}</span>
          <span class="score">${(row.score * 100).toFixed(1)}</span>
        </li>`,
    )
    .join("");
}

function showRedFlags(text) {
  const flags = findRedFlags(text);
  redFlags.hidden = flags.length === 0;
  redFlags.textContent = flags.length
    ? `Safety phrase detected (${flags.join(", ")}). This experiment cannot triage emergencies. Seek qualified medical help.`
    : "";
}

function analyze(text, variant) {
  return new Promise((resolve, reject) => {
    const requestId = ++requestCounter;
    pending.set(requestId, { resolve, reject, text, variant });
    worker.postMessage({ type: "analyze", requestId, text });
  });
}

worker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "loading") {
    runtime.textContent = `${MODEL_ID} · ${message.runtime.device} · ${message.runtime.dtype} · ${formatBytes(message.totalBytes)}`;
    setStatus("Downloading and loading the model. The first run may take a minute.");
    return;
  }
  if (message.type === "progress") {
    setStatus(`Loading model: ${Math.round(message.progress)}%`);
    return;
  }
  if (message.type === "ready") {
    loadInfo = message;
    runtime.textContent = `${MODEL_ID} · ${message.runtime.device} · ${message.runtime.dtype} · loaded in ${(message.loadMs / 1000).toFixed(1)} s`;
    return;
  }

  const request = pending.get(message.requestId);
  if (!request) return;
  pending.delete(message.requestId);

  if (message.type === "error") {
    request.reject(new Error(message.message));
    return;
  }

  const rows = rankRows(message.result);
  const run = {
    timestamp: new Date().toISOString(),
    input: request.text,
    variant: request.variant,
    modelId: MODEL_ID,
    device: message.runtime.device,
    dtype: message.runtime.dtype,
    inferenceMs: message.inferenceMs,
    loadMs: loadInfo?.loadMs ?? null,
    results: rows,
  };
  runs.push(run);
  downloadButton.disabled = false;
  request.resolve(run);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = normalizeInput(input.value);
  if (!text) return;

  showRedFlags(text);
  form.querySelector("button").disabled = true;
  compareButton.disabled = true;
  setStatus("Analyzing locally…");
  try {
    const run = await analyze(text, "original");
    renderRows(run.results);
    setStatus(
      `Complete in ${(run.inferenceMs / 1000).toFixed(1)} s. Scores are model signals, not medical probabilities.`,
      "success",
    );
    compareButton.disabled = false;
  } catch (error) {
    setStatus(`Could not run the model: ${error.message}`, "error");
  } finally {
    form.querySelector("button").disabled = false;
  }
});

compareButton.addEventListener("click", async () => {
  const originalText = normalizeInput(input.value);
  const reorderedText = reorderSymptoms(originalText);
  if (!reorderedText || reorderedText === originalText) {
    setStatus("Enter at least two comma-, period-, semicolon-, or line-separated symptoms.");
    return;
  }

  compareButton.disabled = true;
  setStatus(`Testing reordered input: ${reorderedText}`);
  try {
    const original =
      [...runs].reverse().find(
        (run) => run.variant === "original" && run.input === originalText,
      ) ?? (await analyze(originalText, "original"));
    const reordered = await analyze(reorderedText, "reordered");
    const comparison = compareRankings(original.results, reordered.results);
    const changed = comparison.filter((row) => row.shift !== 0).length;
    renderRows(reordered.results);
    setStatus(
      `Reordered test complete: ${changed} of the original top-five labels changed rank. Download the run log to inspect both versions.`,
      "success",
    );
  } catch (error) {
    setStatus(`Could not run the comparison: ${error.message}`, "error");
  } finally {
    compareButton.disabled = false;
  }
});

downloadButton.addEventListener("click", () => {
  const blob = new Blob([runsToCsv(runs)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `symptom-pattern-runs-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

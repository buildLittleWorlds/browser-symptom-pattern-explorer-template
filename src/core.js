export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

export const CONDITION_CARDS = [
  {
    label: "common cold",
    description:
      "runny or stuffy nose, sneezing, sore throat, cough, mild headache, and usually little or no fever",
  },
  {
    label: "influenza",
    description:
      "sudden fever, dry cough, fatigue, body aches, headache, chills, and sometimes sore throat",
  },
  {
    label: "COVID-19",
    description:
      "fever, cough, fatigue, sore throat, congestion, headache, body aches, and possible loss of taste or smell",
  },
  {
    label: "seasonal allergies",
    description:
      "sneezing, itchy or watery eyes, clear runny nose, nasal congestion, and usually no fever",
  },
  {
    label: "strep throat",
    description:
      "sudden sore throat, pain when swallowing, fever, red swollen tonsils, and usually no cough",
  },
  {
    label: "migraine",
    description:
      "moderate or severe throbbing headache, often one-sided, nausea, and sensitivity to light or sound",
  },
  {
    label: "tension headache",
    description:
      "mild or moderate pressure or tightness around the head, scalp tenderness, and no nausea",
  },
  {
    label: "gastroenteritis",
    description:
      "watery diarrhea, abdominal cramps, nausea or vomiting, and sometimes fever",
  },
  {
    label: "urinary tract infection",
    description:
      "burning or pain during urination, frequent urination, urgent urination, and pelvic pressure",
  },
  {
    label: "pneumonia",
    description:
      "cough, fever, chills, difficulty breathing, chest pain with breathing or coughing, and fatigue",
  },
];

export const RED_FLAG_PHRASES = [
  "chest pain",
  "difficulty breathing",
  "trouble breathing",
  "shortness of breath",
  "fainting",
  "confusion",
  "blue lips",
  "one-sided weakness",
  "stiff neck",
  "coughing blood",
];

export function normalizeInput(text) {
  return text.trim().replace(/\s+/g, " ");
}

export function splitSymptoms(text) {
  return text
    .split(/\n|,|;|\.(?:\s|$)/)
    .map(normalizeInput)
    .filter(Boolean);
}

export function reorderSymptoms(text) {
  return splitSymptoms(text).reverse().join(", ");
}

export function findRedFlags(text) {
  const normalized = normalizeInput(text).toLowerCase();
  return RED_FLAG_PHRASES.filter((phrase) => normalized.includes(phrase));
}

export function rankRows(result, limit = 5) {
  return result.labels.slice(0, limit).map((label, index) => ({
    rank: index + 1,
    label,
    score: result.scores[index],
  }));
}

export function compareRankings(first, second) {
  const secondRanks = new Map(second.map((row) => [row.label, row.rank]));
  return first.map((row) => ({
    label: row.label,
    originalRank: row.rank,
    reorderedRank: secondRanks.get(row.label) ?? null,
    shift:
      secondRanks.has(row.label) ? row.rank - secondRanks.get(row.label) : null,
  }));
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function runsToCsv(runs) {
  const header = [
    "timestamp",
    "input",
    "variant",
    "rank",
    "condition",
    "model_score",
    "model_id",
    "device",
    "dtype",
    "inference_ms",
  ];
  const rows = runs.flatMap((run) =>
    run.results.map((result) => [
      run.timestamp,
      run.input,
      run.variant,
      result.rank,
      result.label,
      result.score,
      run.modelId,
      run.device,
      run.dtype,
      run.inferenceMs,
    ]),
  );
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

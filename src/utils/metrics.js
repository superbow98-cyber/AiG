// AiG — metrics.js
// Evaluation metrics for pre-excavation material prediction (PhD RQ4:
// "accuracy and reliability of pre-excavation material prediction").
//
// Works on an array of pairs:  [{ predicted, actual, confidence? }]
//   predicted — the material AiG predicted from the GPR pattern
//   actual    — the ground-truth material (confirmed by pXRF / excavation)
//   confidence— optional 0..1 model confidence (for calibration)
//
// Pure functions, no DOM — unit-testable in Node.

// Distinct sorted label set across predicted + actual.
export function collectLabels(pairs) {
  const set = new Set();
  for (const p of pairs) {
    if (p.predicted != null) set.add(String(p.predicted));
    if (p.actual != null) set.add(String(p.actual));
  }
  return [...set].sort();
}

// Overall accuracy = correct / total.
export function accuracy(pairs) {
  const valid = pairs.filter((p) => p.predicted != null && p.actual != null);
  if (!valid.length) return 0;
  const correct = valid.filter((p) => String(p.predicted) === String(p.actual)).length;
  return correct / valid.length;
}

// Confusion matrix. Rows = actual, columns = predicted.
// Returns { labels, matrix } where matrix[i][j] = count(actual=labels[i], predicted=labels[j]).
export function confusionMatrix(pairs, labels = null) {
  const L = labels ?? collectLabels(pairs);
  const idx = Object.fromEntries(L.map((l, i) => [l, i]));
  const m = L.map(() => L.map(() => 0));
  for (const p of pairs) {
    if (p.predicted == null || p.actual == null) continue;
    const a = idx[String(p.actual)];
    const pr = idx[String(p.predicted)];
    if (a != null && pr != null) m[a][pr] += 1;
  }
  return { labels: L, matrix: m };
}

// Per-class precision / recall / F1 + support, plus macro & weighted averages.
export function classMetrics(pairs, labels = null) {
  const L = labels ?? collectLabels(pairs);
  const valid = pairs.filter((p) => p.predicted != null && p.actual != null);
  const rows = L.map((label) => {
    let tp = 0, fp = 0, fn = 0;
    for (const p of valid) {
      const isActual = String(p.actual) === label;
      const isPred = String(p.predicted) === label;
      if (isPred && isActual) tp += 1;
      else if (isPred && !isActual) fp += 1;
      else if (!isPred && isActual) fn += 1;
    }
    const support = tp + fn;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = support > 0 ? tp / support : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { label, precision, recall, f1, support, tp, fp, fn };
  });

  const totalSupport = rows.reduce((s, r) => s + r.support, 0) || 1;
  const macro = {
    precision: avg(rows.map((r) => r.precision)),
    recall: avg(rows.map((r) => r.recall)),
    f1: avg(rows.map((r) => r.f1)),
  };
  const weighted = {
    precision: rows.reduce((s, r) => s + r.precision * r.support, 0) / totalSupport,
    recall: rows.reduce((s, r) => s + r.recall * r.support, 0) / totalSupport,
    f1: rows.reduce((s, r) => s + r.f1 * r.support, 0) / totalSupport,
  };
  return { rows, macro, weighted, total: valid.length };
}

// Confidence calibration: bucket predictions by confidence and compare the
// model's average confidence to its actual accuracy in each bucket.
// A well-calibrated model has accuracy ≈ confidence in every bucket.
export function calibration(pairs, nBuckets = 5) {
  const valid = pairs.filter(
    (p) => p.predicted != null && p.actual != null && typeof p.confidence === 'number'
  );
  const buckets = Array.from({ length: nBuckets }, (_, i) => ({
    from: i / nBuckets,
    to: (i + 1) / nBuckets,
    count: 0,
    correct: 0,
    confSum: 0,
  }));
  for (const p of valid) {
    let b = Math.min(nBuckets - 1, Math.floor(p.confidence * nBuckets));
    if (b < 0) b = 0;
    buckets[b].count += 1;
    buckets[b].confSum += p.confidence;
    if (String(p.predicted) === String(p.actual)) buckets[b].correct += 1;
  }
  return buckets.map((b) => ({
    range: `${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%`,
    count: b.count,
    avgConfidence: b.count ? b.confSum / b.count : 0,
    accuracy: b.count ? b.correct / b.count : 0,
  }));
}

// One-call summary for the Validation page.
// canonicalLabels (optional) — pass MATERIAL_CLASSES so every official
// material class shows up in the confusion matrix / per-material table even
// with zero records, instead of only the materials that happen to already
// have a validated pair. Any label present in the data but NOT in
// canonicalLabels (e.g. a legacy value) is still appended, so real data is
// never hidden — this only ever adds rows/columns, never removes them.
export function evaluate(pairs, canonicalLabels = null) {
  const dataLabels = collectLabels(pairs);
  const labels = canonicalLabels
    ? [...new Set([...canonicalLabels, ...dataLabels])]
    : dataLabels;
  return {
    n: pairs.filter((p) => p.predicted != null && p.actual != null).length,
    labels,
    accuracy: accuracy(pairs),
    confusion: confusionMatrix(pairs, labels),
    perClass: classMetrics(pairs, labels),
    calibration: calibration(pairs),
  };
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

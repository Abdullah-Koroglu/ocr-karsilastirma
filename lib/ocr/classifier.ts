import "server-only";

export type DetectedDocType = "ruhsat" | "uygunluk" | "ehliyet" | "unknown";

type Candidate = { type: DetectedDocType; score: number };

const STRONG_SIGNALS = {
  ruhsat: [
    /ARAC\s+TESCIL/u,
    /TESCIL\s+BELGESI/u,
    /PLAKA/u,
    /SASE\s*NO|SASI\s*NO/u,
    /MOTOR\s*NO/u,
    /BELGE\s+SERI/u,
  ],
  uygunluk: [
    /UYGUNLUK\s+BELGESI/u,
    /TIP\s+ONAY/u,
    /AT\s+ARAC\s+UYGUNLUK/u,
    /YURUR\s+VAZIYETTE/u,
  ],
  ehliyet: [
    /SURUCU\s+BELGESI/u,
    /DRIVING\s+LICEN[CS]E/u,
    /KISITLAMA/u,
    /SINIF/u,
    /KAN\s+GRUBU/u,
  ],
};

const WEAK_SIGNALS = {
  ruhsat: [/FIILI\s+KUTLE/u, /MARKASI/u, /TICARI\s+ADI/u],
  uygunluk: [/KUTLE/u, /TEKNIK\s+BELGE/u],
  ehliyet: [/\b4A\b/u, /\b4B\b/u, /\b4C\b/u, /\bKOD\b/u],
};

function normalizeText(raw: string) {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .toUpperCase();
}

export function classifyDocumentText(rawText: string): Candidate {
  const text = normalizeText(rawText);

  const strongCounts = {
    ruhsat: STRONG_SIGNALS.ruhsat.filter((pattern) => pattern.test(text)).length,
    uygunluk: STRONG_SIGNALS.uygunluk.filter((pattern) => pattern.test(text)).length,
    ehliyet: STRONG_SIGNALS.ehliyet.filter((pattern) => pattern.test(text)).length,
  };

  const weakCounts = {
    ruhsat: WEAK_SIGNALS.ruhsat.filter((pattern) => pattern.test(text)).length,
    uygunluk: WEAK_SIGNALS.uygunluk.filter((pattern) => pattern.test(text)).length,
    ehliyet: WEAK_SIGNALS.ehliyet.filter((pattern) => pattern.test(text)).length,
  };

  const scoreFor = (type: "ruhsat" | "uygunluk" | "ehliyet") => {
    const strong = strongCounts[type] * 4;
    const weak = weakCounts[type];
    const crossPenalty =
      type === "ehliyet"
        ? strongCounts.ruhsat * 3 + strongCounts.uygunluk * 2
        : type === "ruhsat"
          ? strongCounts.ehliyet * 2
          : strongCounts.ehliyet;

    return strong + weak - crossPenalty;
  };

  const scored: Candidate[] = [
    {
      type: "ruhsat",
      score: scoreFor("ruhsat"),
    },
    {
      type: "uygunluk",
      score: scoreFor("uygunluk"),
    },
    {
      type: "ehliyet",
      score: scoreFor("ehliyet"),
    },
  ];

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  if (!winner || winner.score < 4) {
    return { type: "unknown", score: 0 };
  }

  if (runnerUp && winner.score - runnerUp.score < 2) {
    return { type: "unknown", score: winner.score };
  }

  if (winner.type === "ehliyet" && strongCounts.ehliyet < 2) {
    return { type: "unknown", score: 0 };
  }

  return winner;
}

export function isLikelyEhliyetBack(rawText: string) {
  const text = normalizeText(rawText);
  return /\bKOD\b|\bKISITLAMA\b|\b12\b|\b4C\b/.test(text);
}

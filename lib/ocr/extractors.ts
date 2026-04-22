import "server-only";

export type RuhsatExtract = {
  plaka: string | null;
  sasiNo: string | null;
  motorNo: string | null;
  tckn: string | null;
  tescilSiraNo: string | null;
  ruhsatSeriNo: string | null;
  netAgirlik: string | null;
  azamiYukluAgirlik: string | null;
  katarAgirligi: string | null;
  romorkAzamiYukluAgirligi: string | null;
  modelYili: string | null;
  tipi: string | null;
  markasi: string | null;
  ticariAdi: string | null;
  cinsi: string | null;
};

export type UygunlukExtract = {
  yururVaziyetteKutle: string | null;
};

export type EhliyetExtract = {
  isimSoyisim: string | null;
  tckn: string | null;
  kodlar: string[];
};

function normalize(raw: string) {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .toUpperCase();
}

function firstMatch(text: string, regex: RegExp) {
  const found = text.match(regex);
  return found?.[1] ?? null;
}

function findTckn(text: string) {
  const candidates = text.match(/\b[1-9]\d{10}\b/g) ?? [];
  return candidates[0] ?? null;
}

function findTescilSiraNo(text: string) {
  const toValidTescilSiraNo = (value: string | null) => {
    if (!value) {
      return null;
    }

    const digits = value.replace(/\D/g, "");
    return digits.length >= 15 ? digits : null;
  };

  const directLabelMatch =
    firstMatch(text, /TESCIL\s*SIRA\s*NO\s*[:\-]?\s*([^\n\r]{1,40})/) ??
    firstMatch(text, /Y\.2\)?\s*TESCIL\s*SIRA\s*NO\s*[:\-]?\s*([^\n\r]{1,40})/);

  const directCandidate = toValidTescilSiraNo(directLabelMatch);

  if (directCandidate) {
    return directCandidate;
  }

  if (!/TESCIL\s*SIRA\s*NO|Y\.2\)/.test(text)) {
    return null;
  }

  const candidates = text.match(/\b\d{15,}\b/g) ?? [];
  return candidates[0] ?? null;
}

function normalizeWeight(value: string | null) {
  if (!value) {
    return null;
  }

  return value.replace(/\s+/g, "").replace(/,/g, ".");
}

function normalizeBelgeSeriNo(value: string | null) {
  if (!value) {
    return null;
  }

  const compact = value.replace(/\s+/g, "").toUpperCase();
  const matched = compact.match(/^([A-Z]{2})(?:N|NO)?(\d{6})$/);

  if (matched) {
    return `${matched[1]}${matched[2]}`;
  }

  return value.replace(/\s+/g, " ").trim();
}

function extractByLabel(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*[:\\-]?\\s*([^\\n\\r]{1,60})`);
  const found = text.match(regex)?.[1]?.trim() ?? null;

  if (!found) {
    return null;
  }

  return found.replace(/\s{2,}/g, " ");
}

function extractEhliyetNumericCodes(text: string) {
  const matches = text.match(/\b\d{2,3}(?:\.\d{1,2})?\b/g) ?? [];
  return [...new Set(matches)].slice(0, 80);
}

function extractEhliyetName(text: string) {
  const directName = firstMatch(
    text,
    /(?:ADI\s*SOYADI|SURUCU\s*ADI\s*SOYADI|ISIM\s*SOYISIM)\s*[:\-]?\s*([A-Z\s]{5,60})/,
  );

  if (directName) {
    return directName;
  }

  const surname = firstMatch(text, /1\.\s*SOYADI\s*[:\-]?\s*([A-Z\s]{2,30})/);
  const name = firstMatch(text, /2\.\s*ADI\s*[:\-]?\s*([A-Z\s]{2,30})/);

  if (surname && name) {
    return `${name} ${surname}`;
  }

  return null;
}

export function extractRuhsat(rawText: string): RuhsatExtract {
  const text = normalize(rawText);

  const sasiNoFromLabel = extractByLabel(text, "SASE NO");
  const motorNoFromLabel = extractByLabel(text, "MOTOR NO");
  const plakaFromLabel = extractByLabel(text, "PLAKA");
  const belgeSeriFromLabel = extractByLabel(text, "BELGE SERI");
  const netAgirlikFromLabel = extractByLabel(text, "NET AGIRLIK");
  const azamiYukluAgirlikFromLabel = extractByLabel(text, "AZAMI YUKLU AGIRLIGI");
  const katarAgirligiFromLabel = extractByLabel(text, "KATAR AGIRLIGI");
  const romorkAzamiYukluAgirligiFromLabel = extractByLabel(text, "ROMORK AZAMI YUKLU AGIRLIGI");
  const modelYiliFromLabel = extractByLabel(text, "MODEL YILI");
  const tipiFromLabel = extractByLabel(text, "TIPI");
  const markasiFromLabel = extractByLabel(text, "MARKASI");
  const ticariAdiFromLabel = extractByLabel(text, "TICARI ADI");
  const cinsiFromLabel = extractByLabel(text, "CINSI");

  return {
    plaka: plakaFromLabel?.replace(/\s/g, "") ?? null,
    sasiNo: sasiNoFromLabel,
    motorNo: motorNoFromLabel,
    tckn: findTckn(text),
    tescilSiraNo: findTescilSiraNo(text),
    ruhsatSeriNo: normalizeBelgeSeriNo(belgeSeriFromLabel),
    netAgirlik: normalizeWeight(netAgirlikFromLabel),
    azamiYukluAgirlik: normalizeWeight(azamiYukluAgirlikFromLabel),
    katarAgirligi: normalizeWeight(katarAgirligiFromLabel),
    romorkAzamiYukluAgirligi: normalizeWeight(romorkAzamiYukluAgirligiFromLabel),
    modelYili: modelYiliFromLabel,
    tipi: tipiFromLabel,
    markasi: markasiFromLabel,
    ticariAdi: ticariAdiFromLabel,
    cinsi: cinsiFromLabel,
  };
}

export function extractUygunluk(rawText: string): UygunlukExtract {
  const text = normalize(rawText);

  const yururVaziyetteKutle = normalizeWeight(
    firstMatch(text, /YURUR\s*VAZIYETTE\s*KUTLE\s*[:\-]?\s*(\d{2,5}(?:[\.,]\d{1,2})?)/) ??
      firstMatch(text, /YURUR\s*KUTLE\s*[:\-]?\s*(\d{2,5}(?:[\.,]\d{1,2})?)/),
  );

  return { yururVaziyetteKutle };
}

export function extractEhliyet(rawText: string): EhliyetExtract {
  const text = normalize(rawText);
  const kodlar = extractEhliyetNumericCodes(text).slice(0, 40);

  return {
    isimSoyisim: extractEhliyetName(text)?.replace(/\s+/g, " ").trim() ?? null,
    tckn: findTckn(text),
    kodlar,
  };
}

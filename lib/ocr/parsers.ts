import "server-only";

import type { DocKind, ExtractedFields, ParsedDocument } from "@/lib/ocr/types";

const TCKN_REGEX = /\b[1-9]\d{10}\b/g;
const CHASSIS_REGEX = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const PLATE_REGEX = /\b\d{2}\s?[A-Z]{1,3}\s?\d{2,4}\b/g;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function latinizeUpper(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .toUpperCase();
}

function normalizeDocText(raw: string) {
  return latinizeUpper(raw)
    .replace(/[\t\r]+/g, "\n")
    .replace(/[|]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isValidTckn(tckn: string) {
  if (!/^[1-9]\d{10}$/.test(tckn)) {
    return false;
  }

  const digits = tckn.split("").map(Number);
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  const tenth = ((odd * 7 - even) % 10 + 10) % 10;
  const eleventh =
    (digits[0] +
      digits[1] +
      digits[2] +
      digits[3] +
      digits[4] +
      digits[5] +
      digits[6] +
      digits[7] +
      digits[8] +
      digits[9]) %
    10;

  return digits[9] === tenth && digits[10] === eleventh;
}

function firstValidMatch(regex: RegExp, text: string, validator?: (value: string) => boolean) {
  const matches = text.match(regex) ?? [];

  for (const match of matches) {
    const normalized = normalizeWhitespace(match).replace(/\s/g, "");
    if (!validator || validator(normalized)) {
      return normalized;
    }
  }

  return null;
}

function extractNameByLabeledField(text: string) {
  const patterns = [
    /(?:ADI\s*SOYADI|ADI\s*SOYAD|AD\s*SOYAD|SURUCU\s*ADI\s*SOYADI|ISIM\s*SOYISIM|SAHIBI)\s*[:\-]?\s*([A-Z\s]{5,60})/i,
    /(?:ADI\s*[:\-]\s*)([A-Z\s]{2,30})\s+(?:SOYADI\s*[:\-]\s*)([A-Z\s]{2,30})/i,
  ];

  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found?.[1]) {
      const maybeName = normalizeWhitespace(found.slice(1).join(" "));
      if (maybeName.split(" ").length >= 2) {
        return maybeName;
      }
    }
  }

  return null;
}

function extractNameByLineFallback(text: string) {
  const lines = text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (const line of lines) {
    if (line.length < 6 || line.length > 60) {
      continue;
    }

    if (/(TURKIYE|CUMHURIYETI|KARAYOLLARI|BELGESI|RUHSAT|PLAKA|SASI|NO|TESCIL|TC)/.test(line)) {
      continue;
    }

    if (/^[A-Z]{2,}(?:\s+[A-Z]{2,}){1,3}$/.test(line)) {
      return line;
    }
  }

  return null;
}

export function extractCriticalFields(rawText: string): ExtractedFields {
  const normalized = normalizeDocText(rawText);

  const tckn = firstValidMatch(TCKN_REGEX, normalized, isValidTckn);
  const chassisNo = firstValidMatch(CHASSIS_REGEX, normalized);
  const plate = firstValidMatch(PLATE_REGEX, normalized)?.replace(/\s/g, "");
  const fullName = extractNameByLabeledField(normalized) ?? extractNameByLineFallback(normalized);

  return {
    fullName,
    tckn,
    chassisNo,
    plate,
  };
}

export function parseDocument(kind: DocKind, rawText: string): ParsedDocument {
  return {
    kind,
    rawText,
    extracted: extractCriticalFields(rawText),
  };
}

export function normalizeForComparison(value: string | null) {
  if (!value) {
    return null;
  }

  return latinizeUpper(value).replace(/[^A-Z0-9]/g, "");
}

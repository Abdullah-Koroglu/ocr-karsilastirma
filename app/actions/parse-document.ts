"use server";

import OpenAI from "openai";

export type MissingValue = "Bulunamadı";

export type ParsedDocumentData = {
  plaka: string | MissingValue;
  sasiNo: string | MissingValue;
  motorNo: string | MissingValue;
  tckn: string | MissingValue;
  isimSoyisim: string | MissingValue;
  tescilSiraNo: string | MissingValue;
  belgeSeriNo: string | MissingValue;
  netAgirlik: number | MissingValue;
  azamiYukluAgirlik: number | MissingValue;
  katarAgirligi: number | MissingValue;
  romorkAzamiYukluAgirligi: number | MissingValue;
  modelYili: string | MissingValue;
  tipi: string | MissingValue;
  markasi: string | MissingValue;
  ticariAdi: string | MissingValue;
  cinsi: string | MissingValue;
};

const SYSTEM_PROMPT =
  "Sen bir arac ruhsati veri ayiklama uzmansin. Sana verilen karmasik OCR metninden ilgili alanlari bul. Eger bir alan metinde yoksa 'Bulunamadı' yaz. Rakamlari temizle ve sadece sayisal olmasi gereken alanlari (agirlik gibi) sayiya cevir. Belge seri no 2 harf ve 6 rakamdan olusur; arada gecen N veya No varsa kaldir. Tescil sira no sadece rakamlardan olusur ve en az 15 hanedir.";

const OUTPUT_SCHEMA = {
  name: "vehicle_registration_fields",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      plaka: {
        type: "string",
      },
      sasiNo: {
        anyOf: [
          { type: "string", minLength: 17, maxLength: 17 },
          { type: "string", const: "Bulunamadı" },
        ],
      },
      motorNo: {
        type: "string",
      },
      tckn: {
        anyOf: [
          { type: "string", minLength: 11, maxLength: 11 },
          { type: "string", const: "Bulunamadı" },
        ],
      },
      isimSoyisim: {
        type: "string",
      },
      tescilSiraNo: {
        anyOf: [
          { type: "string", pattern: "^\\d{15,}$" },
          { type: "string", const: "Bulunamadı" },
        ],
      },
      belgeSeriNo: {
        type: "string",
      },
      netAgirlik: {
        anyOf: [{ type: "number" }, { type: "string", const: "Bulunamadı" }],
      },
      azamiYukluAgirlik: {
        anyOf: [{ type: "number" }, { type: "string", const: "Bulunamadı" }],
      },
      katarAgirligi: {
        anyOf: [{ type: "number" }, { type: "string", const: "Bulunamadı" }],
      },
      romorkAzamiYukluAgirligi: {
        anyOf: [{ type: "number" }, { type: "string", const: "Bulunamadı" }],
      },
      modelYili: {
        type: "string",
      },
      tipi: {
        type: "string",
      },
      markasi: {
        type: "string",
      },
      ticariAdi: {
        type: "string",
      },
      cinsi: {
        type: "string",
      },
    },
    required: [
      "plaka",
      "sasiNo",
      "motorNo",
      "tckn",
      "isimSoyisim",
      "tescilSiraNo",
      "belgeSeriNo",
      "netAgirlik",
      "azamiYukluAgirlik",
      "katarAgirligi",
      "romorkAzamiYukluAgirligi",
      "modelYili",
      "tipi",
      "markasi",
      "ticariAdi",
      "cinsi",
    ],
  },
} as const;

function normalizeBelgeSeriNo(value: string | MissingValue) {
  if (value === "Bulunamadı") {
    return value;
  }

  const compact = value.replace(/\s+/g, "").toUpperCase();
  const matched = compact.match(/^([A-Z]{2})(?:N|NO)?(\d{6})$/);

  if (matched) {
    return `${matched[1]}${matched[2]}`;
  }

  return value.trim();
}

function normalizeTescilSiraNo(value: string | MissingValue) {
  if (value === "Bulunamadı") {
    return value;
  }

  const digits = value.replace(/\D/g, "");
  return digits.length >= 15 ? digits : "Bulunamadı";
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY .env.local dosyasinda tanimli degil.");
  }

  return new OpenAI({ apiKey });
}

export async function parseDocumentAction(rawText: string): Promise<ParsedDocumentData> {
  if (!rawText?.trim()) {
    throw new Error("OCR ham metni bos olamaz.");
  }

  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `OCR Ham Metni:\n\n${rawText}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: OUTPUT_SCHEMA,
    },
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error("Modelden gecerli JSON cevabi alinamadi.");
  }

  const parsed = JSON.parse(content) as ParsedDocumentData;

  return {
    ...parsed,
    tescilSiraNo: normalizeTescilSiraNo(parsed.tescilSiraNo),
    belgeSeriNo: normalizeBelgeSeriNo(parsed.belgeSeriNo),
  };
}

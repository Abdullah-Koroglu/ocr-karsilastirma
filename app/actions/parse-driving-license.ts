"use server";

import OpenAI from "openai";

export type MissingValue = "Bulunamadı";

export type ParsedDrivingLicenseData = {
  isimSoyisim: string | MissingValue;
  tckn: string | MissingValue;
  arkaYuzKodlari: string[];
};

const SYSTEM_PROMPT =
  "Sen bir surucu belgesi veri ayiklama uzmansin. Sana verilen OCR metninden isim soyisim, TCKN ve ehliyetin arka yuzundeki tum sayisal kodlari bul. Eger isim soyisim veya TCKN metinde yoksa 'Bulunamadı' yaz. Kodlar icin sadece sayisal degerleri don. Icinde harf olan degerleri alma. Kod yoksa bos dizi don.";

const OUTPUT_SCHEMA = {
  name: "driving_license_fields",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      isimSoyisim: {
        type: "string",
      },
      tckn: {
        anyOf: [
          { type: "string", minLength: 11, maxLength: 11 },
          { type: "string", const: "Bulunamadı" },
        ],
      },
      arkaYuzKodlari: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: ["isimSoyisim", "tckn", "arkaYuzKodlari"],
  },
} as const;

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY .env.local dosyasinda tanimli degil.");
  }

  return new OpenAI({ apiKey });
}

function normalizeRearCodes(values: string[]) {
  const collected = values.flatMap((value) => {
    if (/[A-Z]/i.test(value)) {
      return [];
    }

    return value.match(/\b\d{2,3}(?:\.\d{1,2})?\b/g) ?? [];
  });

  return [...new Set(collected)];
}

export async function parseDrivingLicenseAction(
  rawText: string,
): Promise<ParsedDrivingLicenseData> {
  if (!rawText?.trim()) {
    throw new Error("Ehliyet OCR ham metni bos olamaz.");
  }

  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Ehliyet OCR Ham Metni:\n\n${rawText}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: OUTPUT_SCHEMA,
    },
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error("Modelden gecerli ehliyet JSON cevabi alinamadi.");
  }

  const parsed = JSON.parse(content) as ParsedDrivingLicenseData;

  return {
    ...parsed,
    arkaYuzKodlari: normalizeRearCodes(parsed.arkaYuzKodlari),
  };
}

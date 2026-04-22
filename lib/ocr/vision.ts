import "server-only";

const DEFAULT_OCR_API_URL = "http://127.0.0.1:8000/ocr";
const OCR_FETCH_TIMEOUT_MS = 30000;

type OcrPageResult = {
  page: number;
  rawText: string;
};

type LooseRecord = Record<string, unknown>;

function getOcrApiUrl() {
  return process.env.OCR_API_URL?.trim() || DEFAULT_OCR_API_URL;
}

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function extractPaddleLikeText(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  const entries = Object.entries(payload)
    .flatMap(([key, value]) => {
      if (!/^\d+$/.test(key) || !isRecord(value) || typeof value.rec_txt !== "string") {
        return [] as Array<{ index: number; text: string }>;
      }

      return [{ index: Number(key), text: value.rec_txt.trim() }];
    })
    .sort((a, b) => a.index - b.index);

  if (!entries.length) {
    return "";
  }

  const lines = entries.map((entry) => entry.text).filter(Boolean);

  return lines.join("\n");
}

function extractTextFromPayload(payload: unknown): string {
  const paddleLikeText = extractPaddleLikeText(payload);
  if (paddleLikeText) {
    console.log(`[OCR] Paddle format algilandi, satir sayisi: ${paddleLikeText.split("\n").length}`);
    return paddleLikeText;
  }

  if (typeof payload === "string") {
    return payload.trim();
  }

  if (Array.isArray(payload)) {
    return payload
      .map((item) => extractTextFromPayload(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const prioritizedKeys = [
    "rec_txt",
    "raw_text",
    "rawText",
    "text",
    "ocr_text",
    "ocrText",
    "full_text",
    "fullText",
    "description",
    "content",
    "result",
    "data",
  ];

  for (const key of prioritizedKeys) {
    if (key in record) {
      const text = extractTextFromPayload(record[key]);
      if (text) {
        return text;
      }
    }
  }

  const allTexts = Object.values(record)
    .map((value) => extractTextFromPayload(value))
    .filter(Boolean);

  if (allTexts.length) {
    return allTexts.join("\n").trim();
  }

  return "";
}

function extractPageResults(payload: unknown): OcrPageResult[] {
  const asArray = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? [
          (payload as Record<string, unknown>).pages,
          (payload as Record<string, unknown>).results,
          (payload as Record<string, unknown>).data,
        ].find(Array.isArray)
      : undefined;

  if (!Array.isArray(asArray)) {
    return [];
  }

  return asArray.map((item, index) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const pageCandidate =
      typeof record.page === "number"
        ? record.page
        : typeof record.page_no === "number"
          ? record.page_no
          : typeof record.index === "number"
            ? record.index + 1
            : index + 1;

    return {
      page: pageCandidate,
      rawText: extractTextFromPayload(item),
    };
  });
}

async function postToOcrApi(file: File): Promise<unknown> {
  const formData = new FormData();
  formData.append("image_file", file, file.name);
  formData.append("use_det", "true");
  formData.append("use_cls", "true");
  formData.append("use_rec", "true");

  console.log(`[OCR] API istegi baslatildi: ${file.name} (${file.size} bytes)`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(`OCR API zaman asimi (${OCR_FETCH_TIMEOUT_MS} ms)`);
  }, OCR_FETCH_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(getOcrApiUrl(), {
      method: "POST",
      body: formData,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OCR API baglantisi kurulurken bilinmeyen hata olustu.";
    console.error(`[OCR] API erisim hatasi: ${message}`);
    throw new Error(`OCR API erisilemedi: ${message}. URL: ${getOcrApiUrl()}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OCR API hatasi (${response.status}): ${body.slice(0, 300)}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  console.log(`[OCR] API yanitlandi: status=${response.status}, contentType=${contentType}`);

  if (contentType.includes("application/json")) {
    const json = (await response.json()) as unknown;
    if (isRecord(json)) {
      console.log(`[OCR] JSON anahtar sayisi: ${Object.keys(json).length}`);
    }
    return json;
  }

  const text = await response.text();
  console.log(`[OCR] Text yanit uzunlugu: ${text.length}`);
  return text;
}

export async function runOcrForFile(file: File): Promise<OcrPageResult[]> {
  const payload = await postToOcrApi(file);
  const pageResults = extractPageResults(payload).filter((item) => item.rawText);

  console.log(`[OCR] Cikarilan sayfa sonucu: ${pageResults.length}`);

  if (pageResults.length) {
    return pageResults;
  }

  const rawText = extractTextFromPayload(payload);
  console.log(`[OCR] Fallback text uzunlugu: ${rawText.length}`);

  return [{ page: 1, rawText }];
}

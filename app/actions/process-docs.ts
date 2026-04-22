"use server";

import "server-only";

import { parseDocumentAction } from "@/app/actions/parse-document";
import { parseDrivingLicenseAction } from "@/app/actions/parse-driving-license";
import { classifyDocumentText, isLikelyEhliyetBack } from "@/lib/ocr/classifier";
import { extractEhliyet, extractRuhsat, extractUygunluk } from "@/lib/ocr/extractors";
import { runOcrForFile } from "@/lib/ocr/vision";
import type { ProcessDocsState } from "@/lib/ocr/types";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

async function validateFile(file: File) {
  if (!file || file.size === 0) {
    throw new Error("Yuklenen dosyalardan biri bos.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`${file.name} dosyasi 10 MB sinirini asiyor.`);
  }
}

export async function processDocsAction(
  _prevState: ProcessDocsState,
  formData: FormData,
): Promise<ProcessDocsState> {
  try {
    const files = formData.getAll("documents") as File[];

    if (!files.length) {
      return {
        success: false,
        message: "Lutfen en az bir dosya yukleyin.",
      };
    }

    const pages: Array<{
      fileName: string;
      page: number;
      rawText: string;
      detected: "ruhsat" | "uygunluk" | "ehliyet" | "unknown";
      isEhliyetBack: boolean;
    }> = [];

    for (const file of files) {
      await validateFile(file);
      const filePages = await runOcrForFile(file);

      for (const page of filePages) {
        const classified = classifyDocumentText(page.rawText);
        pages.push({
          fileName: file.name,
          page: page.page,
          rawText: page.rawText,
          detected: classified.type,
          isEhliyetBack: classified.type === "ehliyet" && isLikelyEhliyetBack(page.rawText),
        });
      }
    }

    const ruhsatText = pages
      .filter((p) => p.detected === "ruhsat")
      .map((p) => p.rawText)
      .join("\n\n");
    const uygunlukText = pages
      .filter((p) => p.detected === "uygunluk")
      .map((p) => p.rawText)
      .join("\n\n");
    const ehliyetText = pages
      .filter((p) => p.detected === "ehliyet")
      .map((p) => p.rawText)
      .join("\n\n");

    const ehliyetBackText = pages
      .filter((p) => p.detected === "ehliyet" && p.isEhliyetBack)
      .map((p) => p.rawText)
      .join("\n\n");

    const ruhsatFallback = extractRuhsat(ruhsatText);
    let ruhsat = ruhsatFallback;

    if (ruhsatText.trim()) {
      try {
        const parsedRuhsat = await parseDocumentAction(ruhsatText);
        ruhsat = {
          plaka: parsedRuhsat.plaka === "Bulunamadı" ? null : parsedRuhsat.plaka,
          sasiNo: parsedRuhsat.sasiNo === "Bulunamadı" ? null : parsedRuhsat.sasiNo,
          motorNo: parsedRuhsat.motorNo === "Bulunamadı" ? null : parsedRuhsat.motorNo,
          ruhsatSeriNo: parsedRuhsat.belgeSeriNo === "Bulunamadı" ? null : parsedRuhsat.belgeSeriNo,
          netAgirlik:
            parsedRuhsat.netAgirlik === "Bulunamadı" ? null : String(parsedRuhsat.netAgirlik),
          azamiYukluAgirlik:
            parsedRuhsat.azamiYukluAgirlik === "Bulunamadı"
              ? null
              : String(parsedRuhsat.azamiYukluAgirlik),
          katarAgirligi:
            parsedRuhsat.katarAgirligi === "Bulunamadı" ? null : String(parsedRuhsat.katarAgirligi),
          romorkAzamiYukluAgirligi:
            parsedRuhsat.romorkAzamiYukluAgirligi === "Bulunamadı"
              ? null
              : String(parsedRuhsat.romorkAzamiYukluAgirligi),
          modelYili: parsedRuhsat.modelYili === "Bulunamadı" ? null : parsedRuhsat.modelYili,
          tipi: parsedRuhsat.tipi === "Bulunamadı" ? null : parsedRuhsat.tipi,
          markasi: parsedRuhsat.markasi === "Bulunamadı" ? null : parsedRuhsat.markasi,
          ticariAdi: parsedRuhsat.ticariAdi === "Bulunamadı" ? null : parsedRuhsat.ticariAdi,
          cinsi: parsedRuhsat.cinsi === "Bulunamadı" ? null : parsedRuhsat.cinsi,
        };
      } catch {
        ruhsat = ruhsatFallback;
      }
    }

    const uygunluk = extractUygunluk(uygunlukText);
    const ehliyetFallback = extractEhliyet(ehliyetText);
    const ehliyetBackFallback = extractEhliyet(ehliyetBackText || ehliyetText);
    let ehliyet = ehliyetFallback;
    let ehliyetBack = ehliyetBackFallback;

    if (ehliyetText.trim()) {
      try {
        const parsedEhliyet = await parseDrivingLicenseAction(ehliyetText);
        ehliyet = {
          isimSoyisim:
            parsedEhliyet.isimSoyisim === "Bulunamadı" ? null : parsedEhliyet.isimSoyisim,
          tckn: parsedEhliyet.tckn === "Bulunamadı" ? null : parsedEhliyet.tckn,
          kodlar: parsedEhliyet.arkaYuzKodlari,
        };
      } catch {
        ehliyet = ehliyetFallback;
      }
    }

    if ((ehliyetBackText || ehliyetText).trim()) {
      try {
        const parsedEhliyetBack = await parseDrivingLicenseAction(ehliyetBackText || ehliyetText);
        ehliyetBack = {
          isimSoyisim:
            parsedEhliyetBack.isimSoyisim === "Bulunamadı" ? null : parsedEhliyetBack.isimSoyisim,
          tckn: parsedEhliyetBack.tckn === "Bulunamadı" ? null : parsedEhliyetBack.tckn,
          kodlar: parsedEhliyetBack.arkaYuzKodlari,
        };
      } catch {
        ehliyetBack = ehliyetBackFallback;
      }
    }

    const textReport = [
      "=== OCR METIN RAPORU ===",
      "",
      "[RUHSAT]",
      `Plaka: ${ruhsat.plaka ?? "Bulunamadi"}`,
      `Sasi No: ${ruhsat.sasiNo ?? "Bulunamadi"}`,
      `Motor No: ${ruhsat.motorNo ?? "Bulunamadi"}`,
      `Ruhsat Seri No: ${ruhsat.ruhsatSeriNo ?? "Bulunamadi"}`,
      `Net Agirlik: ${ruhsat.netAgirlik ?? "Bulunamadi"}`,
      `Azami Yuklu Agirligi: ${ruhsat.azamiYukluAgirlik ?? "Bulunamadi"}`,
      `Katar Agirligi: ${ruhsat.katarAgirligi ?? "Bulunamadi"}`,
      `Romork Azami Yuklu Agirligi: ${ruhsat.romorkAzamiYukluAgirligi ?? "Bulunamadi"}`,
      `Model Yili: ${ruhsat.modelYili ?? "Bulunamadi"}`,
      `Tipi: ${ruhsat.tipi ?? "Bulunamadi"}`,
      `Markasi: ${ruhsat.markasi ?? "Bulunamadi"}`,
      `Ticari Adi: ${ruhsat.ticariAdi ?? "Bulunamadi"}`,
      `Cinsi: ${ruhsat.cinsi ?? "Bulunamadi"}`,
      "",
      "[UYGUNLUK BELGESI]",
      `Yurur Vaziyette Kutle: ${uygunluk.yururVaziyetteKutle ?? "Bulunamadi"}`,
      "",
      "[EHLIYET]",
      `Isim Soyisim: ${ehliyet.isimSoyisim ?? "Bulunamadi"}`,
      `TCKN: ${ehliyet.tckn ?? "Bulunamadi"}`,
      `Arka Sayfa Kodlari: ${ehliyetBack.kodlar.length ? ehliyetBack.kodlar.join(", ") : "Bulunamadi"}`,
    ].join("\n");

    return {
      success: true,
      message: "Dosyalar tek seferde analiz edildi. Belge tipleri otomatik tespit edildi.",
      textReport,
      summary: {
        totalFiles: files.length,
        totalPages: pages.length,
        detected: {
          ruhsatPages: pages.filter((p) => p.detected === "ruhsat").length,
          uygunlukPages: pages.filter((p) => p.detected === "uygunluk").length,
          ehliyetPages: pages.filter((p) => p.detected === "ehliyet").length,
          unknownPages: pages.filter((p) => p.detected === "unknown").length,
          ehliyetBackPages: pages.filter((p) => p.detected === "ehliyet" && p.isEhliyetBack).length,
        },
      },
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "OCR islemi sirasinda bilinmeyen bir hata olustu.";

    return {
      success: false,
      message,
    };
  }
}

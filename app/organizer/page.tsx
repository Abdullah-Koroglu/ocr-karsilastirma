"use client";

import { PDFDocument } from "pdf-lib";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  version?: string;
  getDocument: (source: { data: Uint8Array }) => {
    promise: Promise<{
      getPage: (pageNumber: number) => Promise<{
        getViewport: (params: { scale: number }) => { width: number; height: number };
        render: (params: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
      }>;
    }>;
  };
};

type OCRBox = [number, number][];

type RotationDirection = "none" | "cw" | "ccw";

type OrientationMetrics = {
  boxCount: number;
  verticalRatio: number;
};

const MIN_BOX_COUNT_FOR_ROTATION = 8;
const MIN_VERTICAL_RATIO_TO_TRY_ROTATION = 0.75;
const MIN_VERTICAL_RATIO_IMPROVEMENT = 0.2;

type OrganizerDoc = {
  id: string;
  originalName: string;
  previewUrl: string;
  correctedBlob: Blob;
  isSelected: boolean;
  status: "processing" | "ready" | "error";
  statusLabel: string;
  errorMessage?: string;
};

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function distance(a: [number, number], b: [number, number]) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function parseBoxesFromOcrPayload(payload: unknown): OCRBox[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const records = Object.values(payload as Record<string, unknown>);
  const boxes: OCRBox[] = [];

  for (const entry of records) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const dtBoxes = (entry as Record<string, unknown>).dt_boxes;
    if (!Array.isArray(dtBoxes) || dtBoxes.length < 4) {
      continue;
    }

    const mapped = dtBoxes
      .filter((point): point is [number, number] => {
        return (
          Array.isArray(point) &&
          point.length >= 2 &&
          typeof point[0] === "number" &&
          typeof point[1] === "number"
        );
      })
      .map((point) => [point[0], point[1]] as [number, number]);

    if (mapped.length >= 4) {
      boxes.push(mapped);
    }
  }

  return boxes;
}

function shouldRotateFromBoxes(boxes: OCRBox[]) {
  if (!boxes.length) {
    return false;
  }

  const verticalCount = boxes.reduce((count, box) => {
    const width = distance(box[0], box[1]);
    const height = distance(box[1], box[2]);
    return height > width ? count + 1 : count;
  }, 0);

  return verticalCount / boxes.length >= 0.6;
}

function getOrientationMetrics(boxes: OCRBox[]): OrientationMetrics {
  if (!boxes.length) {
    return { boxCount: 0, verticalRatio: 0 };
  }

  const verticalCount = boxes.reduce((count, box) => {
    const width = distance(box[0], box[1]);
    const height = distance(box[1], box[2]);
    return height > width ? count + 1 : count;
  }, 0);

  return {
    boxCount: boxes.length,
    verticalRatio: verticalCount / boxes.length,
  };
}

async function loadPdfJs(): Promise<PdfJsModule> {
  const pdfjs = (await import("pdfjs-dist")) as unknown as PdfJsModule;
  pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
  return pdfjs;
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas gorsel cikisi olusturulamadi."));
          return;
        }

        resolve(blob);
      },
      "image/jpeg",
      0.96,
    );
  });
}

async function convertPdfPageToJpegBlobs(file: File): Promise<Array<{ name: string; blob: Blob }>> {
  const pdfBytes = new Uint8Array(await file.arrayBuffer());
  const pdfLibDoc = await PDFDocument.load(pdfBytes);
  const pageCount = pdfLibDoc.getPageCount();
  const pdfjs = await loadPdfJs();
  const rendered: Array<{ name: string; blob: Blob }> = [];
  const pdfjsDoc = await pdfjs.getDocument({ data: pdfBytes }).promise;
  const baseName = file.name.replace(/\.pdf$/i, "");

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdfjsDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("PDF canvas context olusturulamadi.");
    }

    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await canvasToJpegBlob(canvas);
    rendered.push({
      name: `${baseName}-page-${pageNumber}.jpg`,
      blob,
    });
  }

  return rendered;
}

async function rotateBlob90Degrees(blob: Blob, direction: Exclude<RotationDirection, "none">): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Rotasyon icin canvas context olusturulamadi.");
  }

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(direction === "cw" ? Math.PI / 2 : -Math.PI / 2);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);

  return canvasToJpegBlob(canvas);
}

async function fetchOcrPayload(blob: Blob, fileName: string): Promise<unknown> {
  const formData = new FormData();
  formData.append("image_file", new File([blob], fileName, { type: blob.type || "image/jpeg" }), fileName);
  formData.append("use_det", "true");
  formData.append("use_cls", "true");
  formData.append("use_rec", "true");

  const response = await fetch("/api/ocr-proxy", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OCR analiz hatasi: ${detail.slice(0, 300)}`);
  }

  return (await response.json()) as unknown;
}

async function decideRotation(blob: Blob, fileName: string): Promise<RotationDirection> {
  const originalPayload = await fetchOcrPayload(blob, fileName);
  const originalBoxes = parseBoxesFromOcrPayload(originalPayload);
  const originalMetrics = getOrientationMetrics(originalBoxes);

  if (!shouldRotateFromBoxes(originalBoxes)) {
    return "none";
  }

  if (originalMetrics.boxCount < MIN_BOX_COUNT_FOR_ROTATION) {
    return "none";
  }

  if (originalMetrics.verticalRatio < MIN_VERTICAL_RATIO_TO_TRY_ROTATION) {
    return "none";
  }

  const cwBlob = await rotateBlob90Degrees(blob, "cw");
  const ccwBlob = await rotateBlob90Degrees(blob, "ccw");

  const [cwPayload, ccwPayload] = await Promise.all([
    fetchOcrPayload(cwBlob, `${fileName}-cw`),
    fetchOcrPayload(ccwBlob, `${fileName}-ccw`),
  ]);

  const cwMetrics = getOrientationMetrics(parseBoxesFromOcrPayload(cwPayload));
  const ccwMetrics = getOrientationMetrics(parseBoxesFromOcrPayload(ccwPayload));

  const candidates: Array<{ direction: RotationDirection; metrics: OrientationMetrics }> = [
    { direction: "none", metrics: originalMetrics },
    { direction: "cw", metrics: cwMetrics },
    { direction: "ccw", metrics: ccwMetrics },
  ];

  candidates.sort((a, b) => {
    if (a.metrics.verticalRatio !== b.metrics.verticalRatio) {
      return a.metrics.verticalRatio - b.metrics.verticalRatio;
    }

    return b.metrics.boxCount - a.metrics.boxCount;
  });

  const winner = candidates[0];

  if (winner.direction === "none") {
    return "none";
  }

  const ratioImprovement = originalMetrics.verticalRatio - winner.metrics.verticalRatio;
  if (ratioImprovement < MIN_VERTICAL_RATIO_IMPROVEMENT) {
    return "none";
  }

  if (winner.metrics.boxCount < Math.max(6, Math.floor(originalMetrics.boxCount * 0.6))) {
    return "none";
  }

  if (Math.abs(cwMetrics.verticalRatio - ccwMetrics.verticalRatio) < 0.08) {
    return "none";
  }

  return winner.direction;
}

async function blobToPdfBytes(blob: Blob): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const image = blob.type.includes("png") ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  const page = pdfDoc.addPage([image.width, image.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });

  return pdfDoc.save();
}

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function DocumentOrganizerPage() {
  const [documents, setDocuments] = useState<OrganizerDoc[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const documentsRef = useRef<OrganizerDoc[]>([]);
  const incomingFilesHandlerRef = useRef<(files: File[]) => Promise<void>>(async () => {});

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    return () => {
      for (const doc of documentsRef.current) {
        URL.revokeObjectURL(doc.previewUrl);
      }
    };
  }, []);

  const selectedDocs = useMemo(() => documents.filter((doc) => doc.isSelected), [documents]);

  const updateDoc = useCallback((id: string, updater: (doc: OrganizerDoc) => OrganizerDoc) => {
    setDocuments((prev) => prev.map((doc) => (doc.id === id ? updater(doc) : doc)));
  }, []);

  const processBlobAsDocument = useCallback(async (blob: Blob, originalName: string) => {
    const id = createId();
    const initialPreview = URL.createObjectURL(blob);

    setDocuments((prev) => [
      ...prev,
      {
        id,
        originalName,
        previewUrl: initialPreview,
        correctedBlob: blob,
        isSelected: false,
        status: "processing",
        statusLabel: "OCR Analiz Ediliyor...",
      },
    ]);

    try {
      const rotation = await decideRotation(blob, originalName);
      if (rotation !== "none") {
        updateDoc(id, (doc) => ({ ...doc, statusLabel: "Donus duzeltiliyor..." }));
        const rotatedBlob = await rotateBlob90Degrees(blob, rotation);
        const rotatedPreview = URL.createObjectURL(rotatedBlob);

        updateDoc(id, (doc) => {
          URL.revokeObjectURL(doc.previewUrl);
          return {
            ...doc,
            correctedBlob: rotatedBlob,
            previewUrl: rotatedPreview,
            status: "ready",
            statusLabel: "Hazir",
          };
        });
        return;
      }

      updateDoc(id, (doc) => ({ ...doc, status: "ready", statusLabel: "Hazir" }));
    } catch (error) {
      updateDoc(id, (doc) => ({
        ...doc,
        status: "error",
        statusLabel: "Hata",
        errorMessage: error instanceof Error ? error.message : "Belge islenemedi.",
      }));
    }
  }, [updateDoc]);

  function normalizeFileName(file: File, index: number) {
    if (file.name?.trim()) {
      return file;
    }

    return new File([file], `pasted-image-${Date.now()}-${index}.png`, {
      type: file.type || "image/png",
    });
  }

  function pickSupportedFiles(files: File[]) {
    return files.filter((file) => {
      const name = file.name.toLowerCase();
      return file.type.startsWith("image/") || file.type === "application/pdf" || name.endsWith(".pdf");
    });
  }

  const handleIncomingFiles = useCallback(async (inputFiles: File[]) => {
    if (!inputFiles.length || isBatchProcessing) {
      return;
    }

    const supported = pickSupportedFiles(inputFiles).map((file, index) => normalizeFileName(file, index));
    if (!supported.length) {
      return;
    }

    setIsBatchProcessing(true);

    try {
      for (const file of supported) {
        if (isPdfFile(file)) {
          const pages = await convertPdfPageToJpegBlobs(file);
          for (const page of pages) {
            await processBlobAsDocument(page.blob, page.name);
          }
          continue;
        }

        await processBlobAsDocument(file, file.name);
      }
    } finally {
      setIsBatchProcessing(false);
    }
  }, [isBatchProcessing, processBlobAsDocument]);

  useEffect(() => {
    incomingFilesHandlerRef.current = handleIncomingFiles;
  }, [handleIncomingFiles]);

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const clipboardItems = Array.from(event.clipboardData?.items ?? []);
      const files = clipboardItems
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file);

      if (!files.length) {
        return;
      }

      event.preventDefault();
      void incomingFilesHandlerRef.current(files);
    }

    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  async function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const inputFiles = Array.from(event.target.files ?? []);
    await handleIncomingFiles(inputFiles);
    event.target.value = "";
  }

  async function handleDownloadSinglePdf(doc: OrganizerDoc) {
    const bytes = await blobToPdfBytes(doc.correctedBlob);
    const outName = doc.originalName.replace(/\.(png|jpg|jpeg|webp)$/i, "") + ".pdf";
    downloadBytes(bytes, outName, "application/pdf");
  }

  async function handleMergeSelected() {
    if (!selectedDocs.length) {
      return;
    }

    const pdfDoc = await PDFDocument.create();

    for (const doc of selectedDocs) {
      const bytes = new Uint8Array(await doc.correctedBlob.arrayBuffer());
      const image = doc.correctedBlob.type.includes("png")
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }

    const mergedBytes = await pdfDoc.save();
    downloadBytes(mergedBytes, `merged-${Date.now()}.pdf`, "application/pdf");
  }

  function handleClearSelection() {
    setDocuments((prev) => prev.map((doc) => ({ ...doc, isSelected: false })));
  }

  function handleDeleteSelected() {
    setDocuments((prev) => {
      const toRemove = prev.filter((doc) => doc.isSelected);
      for (const doc of toRemove) {
        URL.revokeObjectURL(doc.previewUrl);
      }
      return prev.filter((doc) => !doc.isSelected);
    });
  }

  async function handleManualRotate(id: string, direction: Exclude<RotationDirection, "none">) {
    const current = documentsRef.current.find((doc) => doc.id === id);
    if (!current) {
      return;
    }

    updateDoc(id, (doc) => ({ ...doc, status: "processing", statusLabel: "Elle donduruluyor..." }));

    try {
      const rotatedBlob = await rotateBlob90Degrees(current.correctedBlob, direction);
      const rotatedPreview = URL.createObjectURL(rotatedBlob);

      updateDoc(id, (doc) => {
        URL.revokeObjectURL(doc.previewUrl);
        return {
          ...doc,
          correctedBlob: rotatedBlob,
          previewUrl: rotatedPreview,
          status: "ready",
          statusLabel: "Hazir",
          errorMessage: undefined,
        };
      });
    } catch (error) {
      updateDoc(id, (doc) => ({
        ...doc,
        status: "error",
        statusLabel: "Hata",
        errorMessage: error instanceof Error ? error.message : "Elle dondurme basarisiz oldu.",
      }));
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,#dbeafe_0%,transparent_35%),radial-gradient(circle_at_100%_0%,#fef3c7_0%,transparent_40%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Document Organizer</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Belge Duzenleyici</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 sm:text-base">
            JPG, PNG ve PDF dosyalarini yukleyin. PDF sayfalari gorsellere donusturulur, OCR analizi ile yon
            kontrol edilir ve gerekirse otomatik 90 derece duzeltilir.
          </p>

          <div
            className={`mt-5 rounded-2xl border-2 border-dashed p-4 transition ${
              isDragActive ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-slate-50"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setIsDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragActive(false);
              const droppedFiles = Array.from(event.dataTransfer.files ?? []);
              void handleIncomingFiles(droppedFiles);
            }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
                Belgeleri Sec
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,application/pdf"
                  multiple
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={handleMergeSelected}
                disabled={!selectedDocs.length}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Secilenleri Birlestir
              </button>

              <button
                type="button"
                onClick={handleClearSelection}
                disabled={!selectedDocs.length}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Secimi Kaldir
              </button>

              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={!selectedDocs.length}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Secilenleri Sil
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Surukle-birak veya Ctrl+V ile ekran goruntusu yapistir.
            </p>
          </div>

          <p className="mt-3 text-sm text-slate-600">
            {isBatchProcessing
              ? "Belgeler isleniyor..."
              : `${documents.length} belge var, ${selectedDocs.length} belge secili.`}
          </p>
        </section>

        <section>
          {documents.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-10 text-center text-slate-500">
              Henuz belge yuklenmedi.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map((doc) => (
                <article key={doc.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="relative h-56 bg-slate-100">
                    <Image
                      src={doc.previewUrl}
                      alt={doc.originalName}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-contain"
                      unoptimized
                    />
                    <label className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-slate-800">
                      <input
                        type="checkbox"
                        checked={doc.isSelected}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          updateDoc(doc.id, (current) => ({ ...current, isSelected: checked }));
                        }}
                      />
                      Sec
                    </label>
                  </div>

                  <div className="space-y-3 p-4">
                    <p className="line-clamp-2 text-sm font-semibold text-slate-900">{doc.originalName}</p>
                    <p
                      className={`text-xs font-semibold ${
                        doc.status === "error"
                          ? "text-red-600"
                          : doc.status === "ready"
                            ? "text-emerald-600"
                            : "text-amber-600"
                      }`}
                    >
                      {doc.statusLabel}
                    </p>

                    {doc.errorMessage ? <p className="text-xs text-red-600">{doc.errorMessage}</p> : null}

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleManualRotate(doc.id, "ccw")}
                        disabled={doc.status !== "ready"}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Sola Dondur
                      </button>
                      <button
                        type="button"
                        onClick={() => handleManualRotate(doc.id, "cw")}
                        disabled={doc.status !== "ready"}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Saga Dondur
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDownloadSinglePdf(doc)}
                      disabled={doc.status !== "ready"}
                      className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      PDF Indir
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

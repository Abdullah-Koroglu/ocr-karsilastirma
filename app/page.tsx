"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { processDocsAction } from "@/app/actions/process-docs";
import type { ProcessDocsState } from "@/lib/ocr/types";

const initialProcessDocsState: ProcessDocsState = {
  success: false,
  message: "Belgeleri yukleyip OCR analizini baslatin.",
};

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (source: { data: Uint8Array }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getViewport: (params: { scale: number }) => { width: number; height: number };
        render: (params: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
      }>;
    }>;
  };
  version?: string;
};

function SubmitButton({ pending, isConvertingPdf }: { pending: boolean; isConvertingPdf: boolean }) {
  const disabled = pending || isConvertingPdf;
  const label = isConvertingPdf ? "Donusturuluyor..." : pending ? "OCR isleniyor..." : "Dosyalari Analiz Et";

  return (
    <button
      type="submit"
      className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#0f766e] px-4 text-sm font-semibold text-white transition hover:bg-[#0d665f] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
    >
      {label}
    </button>
  );
}

export default function Home() {
  const [state, setState] = useState<ProcessDocsState>(initialProcessDocsState);
  const [pending, setPending] = useState(false);
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const addFilesToSelectionRef = useRef<(incoming: File[]) => void>(() => {});

  const displayedProgress = useMemo(() => {
    if (isConvertingPdf) {
      return 20;
    }

    if (pending) {
      return progress;
    }

    return state.success ? 100 : 0;
  }, [isConvertingPdf, pending, progress, state.success]);

  const statusText = useMemo(() => {
    if (isConvertingPdf) {
      return "PDF donusturuluyor...";
    }

    if (pending) {
      return `Yukleme ve OCR isleniyor (%${displayedProgress})`;
    }

    return "Hazir";
  }, [displayedProgress, isConvertingPdf, pending]);

  async function loadPdfJs(): Promise<PdfJsModule> {
    const pdfjs = (await import("pdfjs-dist")) as unknown as PdfJsModule;
    // const version = pdfjs.version ?? "5.6.205";
    pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
    return pdfjs;
  }

  async function convertCanvasToJpegFile(canvas: HTMLCanvasElement, outputName: string): Promise<File> {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (generatedBlob) => {
          if (!generatedBlob) {
            reject(new Error("PDF sayfasi JPEG'e donusturulemedi."));
            return;
          }

          resolve(generatedBlob);
        },
        "image/jpeg",
        0.95,
      );
    });

    return new File([blob], outputName, { type: "image/jpeg" });
  }

  async function convertPdfToImageFiles(pdfFile: File): Promise<File[]> {
    const pdfjs = await loadPdfJs();
    const pdfBuffer = await pdfFile.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) });
    const pdf = await loadingTask.promise;
    const baseName = pdfFile.name.replace(/\.pdf$/i, "");
    const renderedPages: File[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("PDF donusumu icin canvas context olusturulamadi.");
      }

      await page.render({ canvasContext: context, viewport }).promise;

      const pageFile = await convertCanvasToJpegFile(canvas, `${baseName}-page-${pageNumber}.jpg`);
      renderedPages.push(pageFile);
    }

    return renderedPages;
  }

  async function normalizeUploadFiles(files: File[]): Promise<File[]> {
    const normalized: File[] = [];

    for (const file of files) {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

      if (!isPdf) {
        normalized.push(file);
        continue;
      }

      const convertedPages = await convertPdfToImageFiles(file);
      normalized.push(...convertedPages);
    }

    return normalized;
  }

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

  const addFilesToSelection = useCallback((incoming: File[]) => {
    const supported = pickSupportedFiles(incoming).map((file, index) => normalizeFileName(file, index));
    if (!supported.length) {
      return;
    }

    setSelectedFiles((prev) => [...prev, ...supported]);
    setState((prev) => ({
      ...prev,
      message: `${prev.message} (${supported.length} dosya eklendi)`,
    }));
  }, []);

  useEffect(() => {
    addFilesToSelectionRef.current = addFilesToSelection;
  }, [addFilesToSelection]);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFiles.length) {
      setState({ success: false, message: "Lutfen en az bir dosya secin." });
      return;
    }

    try {
      setState({ success: false, message: "Dosyalar hazirlaniyor..." });
      setIsConvertingPdf(true);
      const preparedFiles = await normalizeUploadFiles(selectedFiles);
      setIsConvertingPdf(false);

      const formData = new FormData();
      for (const file of preparedFiles) {
        formData.append("documents", file, file.name);
      }

      setPending(true);
      const result = await processDocsAction(initialProcessDocsState, formData);
      setState(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "PDF donusumu veya yukleme sirasinda hata olustu.";
      setState({ success: false, message });
    } finally {
      setIsConvertingPdf(false);
      setPending(false);
    }
  }

  useEffect(() => {
    if (!pending) {
      return;
    }

    const startTimer = window.setTimeout(() => {
      setProgress(8);
    }, 0);

    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 90) {
          return current;
        }

        const next = current + Math.floor(Math.random() * 9) + 4;
        return Math.min(next, 90);
      });
    }, 300);

    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(timer);
    };
  }, [pending]);

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
      addFilesToSelectionRef.current(files);
    }

    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_20%_10%,#cffafe_0%,transparent_32%),radial-gradient(circle_at_80%_0%,#e0f2fe_0%,transparent_30%),linear-gradient(180deg,#f8fafc_0%,#ecfeff_100%)] px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="rounded-3xl border border-cyan-100 bg-white/90 p-6 shadow-lg backdrop-blur sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700">FastAPI OCR</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">
            Otomatik Belge Tespiti ve OCR
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
            PDF ve resimleri tek seferde yükleyin. Uygulama sayfa bazında belgenin Ruhsat, Uygunluk
            Belgesi veya Ehliyet olduğunu otomatik tespit eder ve gerekli alanları metin raporu olarak çıkarır.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <form onSubmit={handleUpload} className="space-y-5">
              <div
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
                  addFilesToSelection(droppedFiles);
                }}
                className={`rounded-2xl border-2 border-dashed p-4 transition ${
                  isDragActive ? "border-cyan-500 bg-cyan-50" : "border-slate-300 bg-slate-50"
                }`}
              >
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Belgeleri Toplu Yukle</span>
                  <input
                    type="file"
                    name="documents"
                    multiple
                    onChange={(event) => {
                      addFilesToSelection(Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                    className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-700"
                    accept="image/*,application/pdf"
                  />
                </label>
                <p className="mt-2 text-xs text-slate-600">
                  Surukle-birak veya Ctrl+V ile ekran goruntusu yapistir. Secili dosya: {selectedFiles.length}
                </p>
              </div>

              <div className="space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-500 transition-all duration-300"
                    style={{ width: `${displayedProgress}%` }}
                  />
                </div>
                <p className="text-xs text-slate-600">
                  {statusText}
                </p>
              </div>

              <SubmitButton pending={pending} isConvertingPdf={isConvertingPdf} />
            </form>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <h2 className="text-lg font-semibold text-slate-900">Analiz Ozeti</h2>
            <p className={`mt-2 text-sm ${state.success ? "text-emerald-700" : "text-slate-600"}`}>
              {state.message}
            </p>

            {state.summary ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-700">
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Dosya Sayisi</dt>
                  <dd className="font-semibold">{state.summary.totalFiles}</dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Sayfa Sayisi</dt>
                  <dd className="font-semibold">{state.summary.totalPages}</dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Ruhsat Sayfasi</dt>
                  <dd className="font-semibold">{state.summary.detected.ruhsatPages}</dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Uygunluk Sayfasi</dt>
                  <dd className="font-semibold">{state.summary.detected.uygunlukPages}</dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Ehliyet Sayfasi</dt>
                  <dd className="font-semibold">{state.summary.detected.ehliyetPages}</dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Ehliyet Arka</dt>
                  <dd className="font-semibold">{state.summary.detected.ehliyetBackPages}</dd>
                </div>
              </dl>
            ) : null}
          </div>
        </section>

        {state.textReport ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
            <h2 className="text-lg font-semibold text-slate-900">Metin Ciktisi</h2>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-900 p-4 text-xs leading-6 text-slate-100 sm:text-sm">
              {state.textReport}
            </pre>
          </section>
        ) : null}
      </main>
    </div>
  );
}

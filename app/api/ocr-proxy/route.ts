import { NextResponse } from "next/server";

const DEFAULT_OCR_API_URL = "http://127.0.0.1:8000/ocr";

function getOcrApiUrl() {
  return process.env.OCR_API_URL?.trim() || DEFAULT_OCR_API_URL;
}

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const imageFile = incoming.get("image_file");

    if (!(imageFile instanceof File)) {
      return NextResponse.json({ detail: "image_file zorunludur." }, { status: 400 });
    }

    const formData = new FormData();
    formData.append("image_file", imageFile, imageFile.name);
    formData.append("use_det", String(incoming.get("use_det") ?? "true"));
    formData.append("use_cls", String(incoming.get("use_cls") ?? "true"));
    formData.append("use_rec", String(incoming.get("use_rec") ?? "true"));

    const response = await fetch(getOcrApiUrl(), {
      method: "POST",
      body: formData,
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type") ?? "application/json";

    if (contentType.includes("application/json")) {
      const payload = await response.json();
      return NextResponse.json(payload, { status: response.status });
    }

    const textBody = await response.text();
    return new NextResponse(textBody, {
      status: response.status,
      headers: {
        "content-type": contentType,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OCR proxy islemi sirasinda beklenmeyen hata olustu.";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

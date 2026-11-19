import type { PhotoChoice } from "./profile-photo";

// Lazy local inference: neither the source image nor its pixels leave this device.
export async function removePortraitBackground(
  source: Blob,
): Promise<PhotoChoice & { kind: "custom" }> {
  const image = await createImageBitmap(source);
  let engine: import("@mediapipe/tasks-vision").ImageSegmenter | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const setup = (async () => {
      const { FilesetResolver, ImageSegmenter } =
        await import("@mediapipe/tasks-vision");
      const files = await FilesetResolver.forVisionTasks("/portrait-engine");
      const result = await ImageSegmenter.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/models/selfie_segmenter.tflite",
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      if (expired) {
        result.close();
        throw new Error("PHOTO_CUTOUT");
      }
      return result;
    })();
    engine = await Promise.race([
      setup,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error("PHOTO_CUTOUT"));
        }, 45000);
      }),
    ]);
    clearTimeout(timer);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PHOTO_CUTOUT");
    ctx.drawImage(image, 0, 0);
    engine.segment(image, (result) => {
      const mask = result.confidenceMasks?.[1] ?? result.confidenceMasks?.[0];
      if (!mask) throw new Error("PHOTO_CUTOUT");
      const values = mask.getAsFloat32Array();
      const matte = document.createElement("canvas");
      matte.width = mask.width;
      matte.height = mask.height;
      const mctx = matte.getContext("2d")!;
      const pixels = mctx.createImageData(mask.width, mask.height);
      for (let i = 0; i < values.length; i++) {
        const a = Math.max(0, Math.min(1, (values[i] - 0.35) / 0.4));
        pixels.data[i * 4] =
          pixels.data[i * 4 + 1] =
          pixels.data[i * 4 + 2] =
            255;
        pixels.data[i * 4 + 3] = Math.round(a * a * (3 - 2 * a) * 255);
      }
      mctx.putImageData(pixels, 0, 0);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(matte, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
    });
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width,
      top = canvas.height,
      right = 0,
      bottom = 0,
      count = 0;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] > 48) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          count++;
        }
      }
    const coverage = count / (canvas.width * canvas.height);
    if (coverage < 0.015 || coverage > 0.985)
      throw new Error("PHOTO_NO_PERSON");
    // Fit the detected person into a centered portrait with transparent breathing room.
    const out = document.createElement("canvas");
    out.width = 512;
    out.height = 640;
    const octx = out.getContext("2d")!;
    const w = right - left + 1,
      h = bottom - top + 1,
      scale = Math.min(480 / w, 608 / h);
    octx.drawImage(
      canvas,
      left,
      top,
      w,
      h,
      (512 - w * scale) / 2,
      640 - h * scale,
      w * scale,
      h * scale,
    );
    let blob = await png(out);
    if (blob.size > 1048576) {
      const smaller = document.createElement("canvas");
      smaller.width = 384;
      smaller.height = 480;
      smaller.getContext("2d")!.drawImage(out, 0, 0, 384, 480);
      blob = await png(smaller);
    }
    if (blob.size > 1048576) throw new Error("PHOTO_SIZE");
    return {
      kind: "custom",
      file: blob,
      preview: URL.createObjectURL(blob),
      operation: crypto.randomUUID(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      ["PHOTO_SIZE", "PHOTO_NO_PERSON"].includes(error.message)
    )
      throw error;
    throw new Error("PHOTO_CUTOUT");
  } finally {
    clearTimeout(timer);
    engine?.close();
    image.close();
  }
}
function png(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PHOTO_CUTOUT"))),
      "image/png",
    ),
  );
}

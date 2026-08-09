/**
 * Shrinking a phone photo in the browser before it is uploaded.
 *
 * A modern phone camera produces 3-12MB per shot, and a rep on a roof
 * takes a dozen. Sending those untouched is slow on site cellular, costs
 * storage for detail nobody looks at, and used to fail outright against
 * the old 1.5MB ceiling.
 *
 * 2000px on the long edge is comfortably more than anyone needs to see a
 * cracked joist or a water stain, and lands around 400-800KB.
 *
 * Deliberately never throws: if anything here fails -- an odd format, a
 * browser without canvas, a HEIC the decoder refuses -- the original
 * file is returned and the upload carries on. A failed resize must not
 * become a failed upload.
 */

const MAX_EDGE = 2000;
const QUALITY = 0.82;
/** Below this, re-encoding usually makes the file bigger, not smaller. */
const SKIP_UNDER_BYTES = 600 * 1024;

export function isResizableImage(file: File): boolean {
  // HEIC is excluded on purpose: most browsers cannot decode it, and a
  // failed decode would silently produce a blank canvas.
  return /^image\/(jpeg|png|webp)$/i.test(file.type);
}

export async function downscaleImage(file: File): Promise<File> {
  if (!isResizableImage(file) || file.size <= SKIP_UNDER_BYTES) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  try {
    // createImageBitmap honours EXIF orientation, so photos taken
    // sideways do not come out rotated.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_EDGE) {
      bitmap.close?.();
      return file;
    }

    const scale = MAX_EDGE / longest;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.(png|webp|jpeg)$/i, ".jpg");
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

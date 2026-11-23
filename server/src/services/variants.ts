import sharp from "sharp";
import { env } from "../config/env.js";
import { sha256 } from "../lib/checksum.js";

export type VariantKind = "thumb" | "medium" | "large";

export type RenderedVariant = {
  kind: VariantKind;
  width: number;
  height: number;
  bytes: number;
  checksum: string;
  buffer: Buffer;
};

const KIND_ORDER: VariantKind[] = ["thumb", "medium", "large"];

export function planVariantWidths(masterWidth: number): number[] {
  if (!Number.isFinite(masterWidth) || masterWidth <= 0) return [];
  const configured = [...new Set(env.VARIANT_WIDTHS)].sort((a, b) => a - b);
  const widths = configured.filter((width) => width < masterWidth);

  if (widths.length === 0) {
    return [masterWidth];
  }

  if (widths.length < 3 && masterWidth > widths[widths.length - 1]) {
    widths.push(masterWidth);
  }

  return [...new Set(widths)].sort((a, b) => a - b).slice(0, 3);
}

export function variantKind(index: number): VariantKind {
  return KIND_ORDER[Math.min(index, KIND_ORDER.length - 1)];
}

export function variantKey(
  photoId: string,
  version: number,
  kind: VariantKind,
  width: number,
): string {
  return `photos/${photoId}/v${version}/${kind}-${width}w.webp`;
}

export function masterKey(photoId: string): string {
  return `photos/${photoId}/master.webp`;
}

export function versionPrefix(photoId: string, version: number): string {
  return `photos/${photoId}/v${version}/`;
}

export function photoPrefix(photoId: string): string {
  return `photos/${photoId}/`;
}

export async function normalizeMaster(input: Buffer): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
  checksum: string;
}> {
  const { data, info } = await sharp(input, {
    limitInputPixels: env.MAX_PIXELS,
    failOn: "error",
    sequentialRead: true,
  })
    .rotate()
    .toColourspace("srgb")
    .webp({ quality: 95, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    bytes: data.length,
    checksum: sha256(data),
  };
}

export async function renderVariants(
  source: Buffer,
  widths: number[],
): Promise<RenderedVariant[]> {
  const variants: RenderedVariant[] = [];
  for (let index = 0; index < widths.length; index += 1) {
    const width = widths[index];
    const { data, info } = await sharp(source, {
      limitInputPixels: env.MAX_PIXELS,
      failOn: "error",
      sequentialRead: true,
    })
      .resize({ width, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    variants.push({
      kind: variantKind(index),
      width: info.width,
      height: info.height,
      bytes: data.length,
      checksum: sha256(data),
      buffer: data,
    });
  }
  return variants;
}

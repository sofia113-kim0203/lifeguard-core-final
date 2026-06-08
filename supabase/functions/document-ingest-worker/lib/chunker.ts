export const CHUNK_TARGET_SIZE = 600;
export const CHUNK_MIN_SIZE = 300;
export const CHUNK_OVERLAP = 100;

const CHUNK_STEP = CHUNK_TARGET_SIZE - CHUNK_OVERLAP;

export type TextChunk = {
  content: string;
  chunk_index: number;
};

function isNonEmptyChunk(content: string): boolean {
  return content.trim().length > 0;
}

/**
 * Split OCR text into ordered chunks for RAG indexing.
 * Target 600 chars, 100-char overlap, minimum 300 chars per chunk when splittable.
 */
export function splitTextIntoChunks(text: string): TextChunk[] {
  if (!text || !text.trim()) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_TARGET_SIZE, text.length);
    const isLast = end >= text.length;

    if (!isLast) {
      const nextStart = start + CHUNK_STEP;
      const tailLength = text.length - nextStart;
      if (tailLength > 0 && tailLength < CHUNK_MIN_SIZE) {
        const merged = text.slice(start);
        if (isNonEmptyChunk(merged)) {
          chunks.push({ content: merged, chunk_index: chunks.length });
        }
        break;
      }
    }

    const slice = text.slice(start, end);
    if (isNonEmptyChunk(slice)) {
      chunks.push({ content: slice, chunk_index: chunks.length });
    }

    if (isLast) {
      break;
    }

    start += CHUNK_STEP;
  }

  return chunks;
}

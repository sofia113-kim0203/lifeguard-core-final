/**
 * Multi-file selection helpers for customer upload UI.
 * Preserves selection order. Does not dedupe or merge identical picks.
 */

/** Normalize File / FileList / array into an ordered file list (no dedupe). */
export function listSelectedUploadFiles(input = null) {
  if (input == null) return [];
  if (Array.isArray(input)) {
    return input.filter((f) => f != null);
  }
  // FileList (or FileList-like): has length + item()
  if (
    typeof input === "object" &&
    typeof input.length === "number" &&
    typeof input.item === "function"
  ) {
    return Array.from(input).filter((f) => f != null);
  }
  // Array-like without item()
  if (
    typeof input === "object" &&
    typeof input.length === "number" &&
    input.length >= 0 &&
    (input.length === 0 || input[0] !== undefined)
  ) {
    return Array.from(input).filter((f) => f != null);
  }
  // Single File / Blob-like
  if (typeof input === "object" && (input.name != null || input.size != null)) {
    return [input];
  }
  return [];
}

/**
 * Call an existing single-file processor once per selected file, in order.
 * Does not skip later files when an earlier processor resolves.
 */
export async function processSelectedUploadFiles(input, processor) {
  if (typeof processor !== "function") {
    throw new Error("processor_required");
  }
  const files = listSelectedUploadFiles(input);
  const results = [];
  for (let index = 0; index < files.length; index += 1) {
    const result = await processor(files[index], index, files);
    results.push(result);
  }
  return { files, results };
}

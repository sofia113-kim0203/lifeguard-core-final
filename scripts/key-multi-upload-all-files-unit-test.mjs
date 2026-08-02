/**
 * Multi-file upload selection — process all selected files in order (no dedupe).
 */
import assert from "node:assert/strict";
import {
  listSelectedUploadFiles,
  processSelectedUploadFiles,
} from "../src/lib/customerMultiFileUpload.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function fakeFile(name, extra = {}) {
  return { name, size: extra.size ?? 10, type: extra.type ?? "application/pdf", ...extra };
}

function fakeFileList(files) {
  const list = {
    length: files.length,
    item(i) {
      return files[i] ?? null;
    },
    [Symbol.iterator]: function* () {
      for (const f of files) yield f;
    },
  };
  files.forEach((f, i) => {
    list[i] = f;
  });
  return list;
}

console.log("key-multi-upload-all-files-unit-test");

// Reproduce: files?.[0] keeps only the first
{
  const files = [fakeFile("a.pdf"), fakeFile("b.pdf"), fakeFile("c.pdf")];
  const fileList = fakeFileList(files);
  const firstOnly = fileList?.[0] ?? null;
  assert.equal(firstOnly?.name, "a.pdf");
  assert.notEqual(listSelectedUploadFiles(fileList).length, 1, "bug: first-only drops later files");
  assert.equal(listSelectedUploadFiles(fileList).length, 3);
}

// 1 file → same as before
{
  const one = fakeFile("only.pdf");
  assert.deepEqual(
    listSelectedUploadFiles(one).map((f) => f.name),
    ["only.pdf"],
  );
  const calls = [];
  await processSelectedUploadFiles(one, async (file, index) => {
    calls.push({ name: file.name, index });
    return { ok: true };
  });
  assert.deepEqual(calls, [{ name: "only.pdf", index: 0 }]);
}

// 2 files → both processed in order
{
  const files = [fakeFile("one.pdf"), fakeFile("two.jpg", { type: "image/jpeg" })];
  const calls = [];
  const { results } = await processSelectedUploadFiles(files, async (file, index, all) => {
    calls.push(file.name);
    assert.equal(all.length, 2);
    return { ok: true, index };
  });
  assert.deepEqual(calls, ["one.pdf", "two.jpg"]);
  assert.equal(results.length, 2);
}

// 3 files → all processed
{
  const files = [fakeFile("a.pdf"), fakeFile("b.pdf"), fakeFile("c.pdf")];
  const names = [];
  await processSelectedUploadFiles(fakeFileList(files), async (file) => {
    names.push(file.name);
  });
  assert.deepEqual(names, ["a.pdf", "b.pdf", "c.pdf"]);
}

// Duplicate selection — no arbitrary merge/dedupe in this slice
{
  const dup = fakeFile("same.pdf");
  const files = [dup, dup, fakeFile("same.pdf")];
  const listed = listSelectedUploadFiles(files);
  assert.equal(listed.length, 3, "duplicate picks must remain 3 entries");
  const names = [];
  await processSelectedUploadFiles(files, async (file) => {
    names.push(file.name);
  });
  assert.deepEqual(names, ["same.pdf", "same.pdf", "same.pdf"]);
}

// Order preserved
{
  const files = [fakeFile("z.pdf"), fakeFile("a.pdf"), fakeFile("m.pdf")];
  assert.deepEqual(
    listSelectedUploadFiles(files).map((f) => f.name),
    ["z.pdf", "a.pdf", "m.pdf"],
  );
}

// Per-file processor (auth/validation stand-in) applied to each file equally
{
  const files = [fakeFile("ok.pdf"), fakeFile("bad.exe", { type: "application/octet-stream" }), fakeFile("ok2.pdf")];
  const seen = [];
  await processSelectedUploadFiles(files, async (file) => {
    const allowed = String(file.type || "").includes("pdf") || String(file.name).endsWith(".pdf");
    seen.push({ name: file.name, allowed });
    return { ok: allowed };
  });
  assert.deepEqual(seen, [
    { name: "ok.pdf", allowed: true },
    { name: "bad.exe", allowed: false },
    { name: "ok2.pdf", allowed: true },
  ]);
  assert.equal(seen.length, 3, "later files still processed after a rejected file");
}

// UI sources no longer hard-take files?.[0] only
{
  const chatSrc = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
  const flowSrc = readFileSync(join(ROOT, "src/components/CustomerDocumentUploadFlow.jsx"), "utf8");
  assert.match(chatSrc, /multiple/);
  assert.match(flowSrc, /multiple/);
  assert.doesNotMatch(
    chatSrc,
    /e\.target\.files\?\.\[0\]/,
    "chat attach must not keep first-file-only selection",
  );
  assert.doesNotMatch(
    flowSrc,
    /files\?\.\[0\]/,
    "document upload flow must not keep first-file-only selection",
  );
  assert.match(chatSrc, /processSelectedUploadFiles/);
  // STAGE 5C: vault store → transit cleanup / one-shot pending delivery (no composer File keep).
  assert.match(chatSrc, /planUploadTransitCleanupAfterDocumentStore/);
  assert.match(chatSrc, /discardComposerUploadTransit/);
  assert.match(chatSrc, /chatAttachments/);
  assert.match(chatSrc, /AttachmentTray/);
  assert.match(chatSrc, /snapshotChatComposerAttachments/);
  assert.match(
    readFileSync(join(ROOT, "src/hooks/useCustomerDocumentUpload.js"), "utf8"),
    /processSelectedUploadFiles/,
  );
}

console.log("PASS");

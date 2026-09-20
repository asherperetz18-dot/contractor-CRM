import { test } from "node:test";
import assert from "node:assert/strict";
import {
  previewKind,
  driveFileId,
  receiptDriveId,
  peekSrc,
  fullPreview,
} from "./preview.ts";

/**
 * These helpers decide what a hover shows and what a click opens for
 * every stored file in the CRM, so the edges tested here are the ones
 * that used to go wrong on screen: a PDF drawn as a broken <img>, a
 * Drive viewer page framed as if it were pixels, and a browser that
 * lied about content_type at upload.
 */

test("content type decides the kind when it is honest", () => {
  assert.equal(previewKind("image/jpeg", "photo.bin"), "image");
  assert.equal(previewKind("video/mp4", "clip.bin"), "video");
  assert.equal(previewKind("application/pdf", "plan"), "pdf");
});

test("a lying content type falls back to the file extension", () => {
  // Some browsers upload a perfectly ordinary PDF as octet-stream.
  assert.equal(previewKind("application/octet-stream", "permit.PDF"), "pdf");
  assert.equal(previewKind(null, "roof.JPG"), "image");
  assert.equal(previewKind(null, "walkthrough.mov"), "video");
  assert.equal(previewKind(null, "estimate.docx"), "other");
  assert.equal(previewKind(null, null), "other");
});

test("drive ids come out of both storage shapes, and only those", () => {
  // Lead files: storage_provider + file_path.
  assert.equal(driveFileId({ storage_provider: "google_drive", file_path: "abc123" }), "abc123");
  assert.equal(driveFileId({ storage_provider: "supabase", file_path: "leads/x/y.jpg" }), null);
  assert.equal(driveFileId({ storage_provider: "google_drive", file_path: null }), null);
  assert.equal(driveFileId({}), null);
  // Receipts: the "drive:<id>" path convention.
  assert.equal(receiptDriveId("drive:abc123"), "abc123");
  assert.equal(receiptDriveId("receipts/job/1-inv.pdf"), null);
  assert.equal(receiptDriveId(null), null);
});

test("hover peek: Drive thumbnails cover images AND pdf page one; a bucket pdf has none", () => {
  const drivePdf = { url: "https://drive.google.com/file/d/abc/view", driveId: "abc", name: "permit.pdf", contentType: "application/pdf" };
  assert.equal(peekSrc(drivePdf), "https://drive.google.com/thumbnail?id=abc&sz=w400");
  const bucketImg = { url: "https://x.supabase.co/storage/v1/object/public/leads/a.jpg", name: "a.jpg", contentType: "image/jpeg" };
  assert.equal(peekSrc(bucketImg), bucketImg.url);
  const bucketPdf = { url: "https://x.supabase.co/storage/v1/object/public/leads/plan.pdf", name: "plan.pdf", contentType: "application/pdf" };
  assert.equal(peekSrc(bucketPdf), null);
});

test("hover peek falls back to the URL's extension when the name says nothing", () => {
  // Receipts store no file name; the upload path keeps the original one.
  assert.equal(
    peekSrc({ url: "https://x.supabase.co/storage/v1/object/public/receipts/j/1-fuel.jpg" }),
    "https://x.supabase.co/storage/v1/object/public/receipts/j/1-fuel.jpg"
  );
  assert.equal(peekSrc({ url: "https://x.supabase.co/storage/v1/object/public/receipts/j/1-inv.pdf" }), null);
  // A display-only name ("Receipt") must not hide what the URL knows.
  const labeled = { url: "https://x.supabase.co/receipts/j/1-fuel.jpg", name: "Receipt" };
  assert.equal(peekSrc(labeled), labeled.url);
  assert.equal(fullPreview(labeled).mode, "image");
});

test("drive ids are URL-encoded into both endpoints", () => {
  const f = { url: "https://drive.google.com/x", driveId: "a b/c" };
  assert.match(peekSrc(f) ?? "", /id=a%20b%2Fc/);
  const full = fullPreview(f);
  assert.equal(full.mode, "frame");
  assert.match(full.src ?? "", /\/file\/d\/a%20b%2Fc\/preview$/);
});

test("full preview: Drive files frame the Drive viewer, never the raw file_url", () => {
  // A Drive file's file_url is the viewer PAGE (HTML, not pixels), and
  // it refuses to be framed -- /preview is the embeddable form.
  const f = { url: "https://drive.google.com/file/d/abc/view", driveId: "abc", name: "roof.jpg", contentType: "image/jpeg" };
  assert.deepEqual(fullPreview(f), { mode: "frame", src: "https://drive.google.com/file/d/abc/preview" });
});

test("full preview: bucket files open as themselves — image, framed pdf, playable video", () => {
  const img = { url: "https://x.supabase.co/a.jpg", name: "a.jpg", contentType: "image/jpeg" };
  assert.deepEqual(fullPreview(img), { mode: "image", src: img.url });
  const pdf = { url: "https://x.supabase.co/plan.pdf", name: "plan.pdf", contentType: "application/pdf" };
  assert.deepEqual(fullPreview(pdf), { mode: "frame", src: pdf.url });
  const vid = { url: "https://x.supabase.co/walk.mp4", name: "walk.mp4", contentType: "video/mp4" };
  assert.deepEqual(fullPreview(vid), { mode: "video", src: vid.url });
});

test("full preview: a type nothing can draw gets no preview, not a broken frame", () => {
  const doc = { url: "https://x.supabase.co/spec.docx", name: "spec.docx", contentType: null };
  assert.deepEqual(fullPreview(doc), { mode: "none", src: null });
  assert.deepEqual(fullPreview({ url: "" }), { mode: "none", src: null });
});

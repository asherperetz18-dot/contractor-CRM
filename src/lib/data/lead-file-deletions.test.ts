import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deletePhotoConfirm,
  deletionRecord,
  describeDeletion,
  photoDeletionsForJob,
  type LeadFileDeletion,
} from "./lead-file-deletions.ts";

const CO = "11111111-1111-1111-1111-111111111111";
const ME = "22222222-2222-2222-2222-222222222222";
const JOB = "33333333-3333-3333-3333-333333333333";
const OTHER_JOB = "44444444-4444-4444-4444-444444444444";

const deletedRow = {
  id: "f1",
  lead_id: "lead1",
  estimate_id: JOB,
  file_name: "kitchen.jpg",
  content_type: "image/jpeg",
  storage_provider: "google_drive",
  uploaded_by: "55555555-5555-5555-5555-555555555555",
  created_at: "2026-09-01T10:00:00Z",
};

test("the history row snapshots the file as it was, credited to whoever deleted it", () => {
  assert.deepEqual(deletionRecord(deletedRow, CO, ME), {
    company_id: CO,
    lead_id: "lead1",
    estimate_id: JOB,
    file_id: "f1",
    file_name: "kitchen.jpg",
    content_type: "image/jpeg",
    storage_provider: "google_drive",
    uploaded_by: "55555555-5555-5555-5555-555555555555",
    uploaded_at: "2026-09-01T10:00:00Z",
    deleted_by: ME,
  });
});

test("an unfiled file keeps its null job, and a missing provider stays null", () => {
  const rec = deletionRecord(
    { ...deletedRow, estimate_id: null, storage_provider: undefined, uploaded_by: null },
    CO,
    ME
  );
  assert.equal(rec.estimate_id, null);
  assert.equal(rec.storage_provider, null);
  assert.equal(rec.uploaded_by, null);
});

function entry(over: Partial<LeadFileDeletion>): LeadFileDeletion {
  return {
    id: "d1",
    estimate_id: JOB,
    file_name: "kitchen.jpg",
    content_type: "image/jpeg",
    deleted_by: ME,
    deleted_at: "2026-09-25T18:00:00Z",
    ...over,
  };
}

test("a job's photo history is what its popup could have shown: this job's and unfiled photos", () => {
  const list = [
    entry({ id: "mine" }),
    entry({ id: "unfiled", estimate_id: null }),
    entry({ id: "other", estimate_id: OTHER_JOB }),
    entry({ id: "pdf", content_type: "application/pdf" }),
    entry({ id: "unknown", content_type: null }),
  ];
  assert.deepEqual(
    photoDeletionsForJob(list, JOB).map((d) => d.id),
    ["mine", "unfiled"]
  );
});

test("a deletion reads as the file, who deleted it, and where it was filed", () => {
  const names = (id: string) => (id === ME ? "Asher Peretz" : "Unnamed");
  assert.equal(
    describeDeletion(entry({}), names, JOB),
    "kitchen.jpg — deleted by Asher Peretz · was filed under this job"
  );
  assert.equal(
    describeDeletion(entry({ estimate_id: null }), names, JOB),
    "kitchen.jpg — deleted by Asher Peretz · was not filed to a job"
  );
});

test("a deleter whose profile is gone reads as someone, never blank", () => {
  assert.equal(
    describeDeletion(entry({ deleted_by: null }), () => "x", JOB),
    "kitchen.jpg — deleted by a removed user · was filed under this job"
  );
});

test("the delete confirm warns it is everywhere, not just this job", () => {
  const msg = deletePhotoConfirm("kitchen.jpg", "supabase");
  assert.match(msg, /kitchen\.jpg/);
  assert.match(msg, /everywhere/);
  assert.match(msg, /Remove from job/);
  assert.doesNotMatch(msg, /Drive/);
});

test("a Drive photo's confirm says it can be recovered from Drive's trash", () => {
  assert.match(deletePhotoConfirm("kitchen.jpg", "google_drive"), /Google Drive trash for 30 days/);
});

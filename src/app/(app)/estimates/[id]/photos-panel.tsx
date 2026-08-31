"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { downscaleImage } from "@/lib/images/downscale";
import { createLeadFileUploadUrl, recordLeadFile } from "@/lib/actions/lead-files";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { attachmentIsImage } from "@/lib/data/types";
import {
  attachEstimatePhoto,
  detachEstimatePhoto,
  getEstimatePhotos,
  getLeadPhotos,
  updateEstimatePhoto,
} from "@/lib/actions/estimate-files";
import { leadPhotoThumbUrl, type EstimateItem, type EstimatePhoto, type LeadPhoto } from "@/lib/data/types";

/**
 * The tile for one attachment in this panel.
 *
 * A PDF has no thumbnail, so it gets its name and an icon rather than an
 * <img> pointed at a file no browser will draw -- which is a broken
 * image on the screen a rep uses to decide what the customer sees.
 */
function Thumb({
  url,
  name,
  type,
}: {
  url: string;
  name: string;
  type: string | null;
}) {
  if (attachmentIsImage(type, name)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" />;
  }
  return (
    <span className="estdoc-photo-file" title={name}>
      <span aria-hidden>📄</span>
      <span className="estdoc-photo-file-name">{name}</span>
    </span>
  );
}

/**
 * Photos and documents on the paper the customer signs.
 *
 * Attaching is what makes a job file customer-visible -- files on the
 * contact stay internal until somebody puts one here on purpose. That is
 * a simpler rule than a visibility checkbox per file, and there is no way
 * to tick it wrong.
 *
 * An attachment can sit under the line it justifies or under the document
 * as a whole. On a change order the first is the point: "Dry rot repair,
 * $4,200" with the picture of the rot directly beneath it is a different
 * conversation from a gallery at the end that the customer has to match
 * up themselves.
 */
export function PhotosPanel({
  estimateId,
  leadId,
  items,
  locked,
  kind,
}: {
  estimateId: string;
  leadId: string;
  items: EstimateItem[];
  locked: boolean;
  kind: string;
}) {
  const [photos, setPhotos] = useState<EstimatePhoto[] | null>(null);
  const [available, setAvailable] = useState<LeadPhoto[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, lib] = await Promise.all([getEstimatePhotos(estimateId), getLeadPhotos(leadId)]);
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setPhotos(res.photos ?? []);
      setAvailable(lib.photos ?? []);
      setError("");
    })();
    return () => {
      cancelled = true;
    };
  }, [estimateId, leadId, reloadKey]);

  if (error && !photos) return <p className="error-note">{error}</p>;
  if (!photos) return null;

  const attachedIds = new Set(photos.map((p) => p.lead_file_id));
  const unattached = available.filter((a) => !attachedIds.has(a.id));

  function attach(leadFileId: string) {
    setError("");
    startTransition(async () => {
      const res = await attachEstimatePhoto({ estimateId, leadFileId });
      if (res.error) return setError(res.error);
      setPicking(false);
      setReloadKey((k) => k + 1);
    });
  }

  /**
   * Uploads to the job, then attaches. Two steps on purpose: a photo
   * taken for a proposal is a job photo, and burying it inside one
   * document would hide it from the contact it belongs to.
   */
  function uploadAndAttach(chosen: File) {
    setError("");
    startTransition(async () => {
      // Shrunk in the browser first. A phone photo is 3-12MB, and ten of
      // them is a proposal a homeowner on mobile data closes before it
      // loads. A PDF is passed through untouched -- downscaleImage only
      // touches jpeg/png/webp and returns everything else as it came.
      const file = await downscaleImage(chosen);

      // Straight to storage rather than through a server action. A set of
      // plans is routinely bigger than the ~4.5MB body Vercel will accept,
      // and that limit rejects the request before any of our own checks
      // get a say.
      const signed = await createLeadFileUploadUrl(leadId, file.name, file.size);
      if (signed.error || !signed.path || !signed.token) {
        return setError(signed.error ?? "Could not start that upload.");
      }
      const storage = createBrowserClient();
      const { error: uploadError } = await storage.storage
        .from("lead-files")
        .uploadToSignedUrl(signed.path, signed.token, file, {
          contentType: file.type || undefined,
        });
      if (uploadError) {
        return setError(
          /exceeded the maximum allowed size/i.test(uploadError.message)
            ? "That file is larger than the storage limit on this project."
            : uploadError.message
        );
      }
      const up = await recordLeadFile(
        leadId,
        signed.path,
        file.name,
        file.size,
        file.type || null
      );
      if (up.error) return setError(up.error);

      const lib = await getLeadPhotos(leadId);
      const newest = (lib.photos ?? []).find((p) => !attachedIds.has(p.id));
      if (!newest) return setError("Uploaded, but it couldn't be attached — try picking it.");
      const res = await attachEstimatePhoto({ estimateId, leadFileId: newest.id });
      if (res.error) return setError(res.error);
      setReloadKey((k) => k + 1);
    });
  }

  const noun = kind === "change_order" ? "change order" : "estimate";

  return (
    <section className="est-pay">
      <div className="est-pay-head">
        <div>
          <h2 className="est-pay-title">Photos &amp; documents</h2>
          <p className="est-pay-sub">
            Shown to the customer on this {noun}. Photos and PDFs &mdash; plans, permits, spec
            sheets. Put one under the line it pays for and it stops being an attachment and
            starts being the reason for the price.
          </p>
        </div>
        {!locked && (
          <div className="est-pay-actions">
            <button
              className="btn-ghost"
              onClick={() => setPicking((p) => !p)}
              disabled={pending || unattached.length === 0}
            >
              {unattached.length === 0
                ? "No unused job files"
                : `Add from job files (${unattached.length})`}
            </button>
            <button
              className="btn-ghost"
              onClick={() => fileInput.current?.click()}
              disabled={pending}
            >
              {pending ? "Working…" : "Upload file"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,application/pdf,.pdf"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) uploadAndAttach(f);
              }}
            />
          </div>
        )}
      </div>

      {locked && photos.length > 0 && (
        <p className="hint-note">
          Signed — these photos are part of what the customer agreed to and can no longer be
          changed.
        </p>
      )}

      {picking && unattached.length > 0 && (
        <div className="est-pay-balance" style={{ display: "block" }}>
          <p className="est-tax-note" style={{ marginBottom: 8 }}>
            Photos already on this job. Picking one puts it on the customer&rsquo;s copy.
          </p>
          <div className="estdoc-photo-grid">
            {unattached.map((a) => (
              <button
                key={a.id}
                className="estdoc-photo-pick"
                disabled={pending}
                onClick={() => attach(a.id)}
                title={a.file_name}
              >
                <Thumb url={leadPhotoThumbUrl(a)} name={a.file_name} type={a.content_type} />
              </button>
            ))}
          </div>
        </div>
      )}

      {photos.length === 0 ? (
        <p className="empty-hint">
          No photos on this {noun}. Nothing on the contact is shown to the customer until it is
          added here.
        </p>
      ) : (
        <div className="estdoc-photo-grid">
          {photos.map((p) => (
            <div key={p.id} className="estdoc-photo-edit">
              <Thumb url={leadPhotoThumbUrl(p)} name={p.file_name} type={p.content_type} />
              {locked ? (
                <>
                  <div className="est-tax-note">{p.caption || "No caption"}</div>
                  <div className="est-tax-note">
                    {items.find((i) => i.id === p.estimate_item_id)?.name ?? "Whole document"}
                  </div>
                </>
              ) : (
                <>
                  <input
                    className="est-item-desc"
                    placeholder="What this shows, and when"
                    defaultValue={p.caption ?? ""}
                    disabled={pending}
                    onBlur={(e) => {
                      if (e.target.value === (p.caption ?? "")) return;
                      startTransition(async () => {
                        const res = await updateEstimatePhoto(p.id, { caption: e.target.value });
                        if (res.error) return setError(res.error);
                        setReloadKey((k) => k + 1);
                      });
                    }}
                  />
                  <select
                    value={p.estimate_item_id ?? ""}
                    disabled={pending}
                    onChange={(e) =>
                      startTransition(async () => {
                        const res = await updateEstimatePhoto(p.id, {
                          estimateItemId: e.target.value || null,
                        });
                        if (res.error) return setError(res.error);
                        setReloadKey((k) => k + 1);
                      })
                    }
                  >
                    <option value="">Whole document</option>
                    {items
                      .filter((i) => i.name)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                  </select>
                  <button
                    className="btn-ghost small"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await detachEstimatePhoto(p.id);
                        if (res.error) return setError(res.error);
                        setReloadKey((k) => k + 1);
                      })
                    }
                  >
                    {/* "Remove" not "Delete" -- the photo stays on the job. */}
                    Remove from {noun}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="error-note">{error}</p>}
    </section>
  );
}

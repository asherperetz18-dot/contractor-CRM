"use client";

import { useState } from "react";
import { daysSince, leadDisplayName, mapsUrl, stageColor, type PipelineStageRow } from "@/lib/data/types";
import { dialNumberOf } from "@/lib/data/phone-match";
import type { BoardCard } from "@/lib/pipeline-board-types";
import { leadCardMeta, pickPhoneStage } from "@/lib/phone-leads";
import { MobileIcon } from "../mobile-icon";
import type { LeadEstimateIndex } from "@/lib/data/lead-estimate-index";
import { financingChip } from "@/lib/financing";

/**
 * The Leads page at phone width (DECISIONS #091): the board's columns
 * become stage chips, and the picked stage's leads a list of cards with
 * Call, Text and Directions under a thumb. Same data as the board (its
 * windows, counts and filters), so nothing extra is fetched; wider
 * screens never see it (globals.css).
 */
export function PhoneLeadList({
  groups,
  stages,
  repById,
  byLead,
  onOpenLead,
  onLoadMore,
  onNewContact,
}: {
  groups: { stage: string; items: BoardCard[]; count: number }[];
  stages: PipelineStageRow[];
  repById: Map<string, string>;
  /** Each lead's estimates, with where its financing stands (#165). */
  byLead: LeadEstimateIndex["byLead"];
  onOpenLead: (card: BoardCard, tab?: "Texts") => void;
  onLoadMore: (stage: string) => void;
  /** Null for someone who may not add contacts: no button. */
  onNewContact: (() => void) | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const stage = pickPhoneStage(groups, picked);
  const group = groups.find((g) => g.stage === stage);
  const remaining = group ? Math.max(0, group.count - group.items.length) : 0;

  return (
    <section className="phone-leads" aria-label="Contacts" data-mtone="dispatch">
      <div className="pl-chips" role="group" aria-label="Stage">
        {groups.map((g) => (
          <button
            key={g.stage}
            type="button"
            className={"pl-chip" + (g.stage === stage ? " is-on" : "")}
            aria-pressed={g.stage === stage}
            onClick={() => setPicked(g.stage)}
          >
            <span className="pl-dot" style={{ background: stageColor(stages, g.stage) }} aria-hidden="true" />
            {g.stage}
            <span className="pl-chip-count mono">{g.count.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {group && group.items.length === 0 ? (
        <p className="pl-empty">No contacts in {group.stage}.</p>
      ) : (
        group?.items.map((c) => {
          const name = leadDisplayName(c);
          const phone = dialNumberOf(c);
          const meta = leadCardMeta(c, daysSince(c.date_received));
          const fin = byLead[c.id]?.financing;
          const chip = fin ? financingChip(fin, daysSince(fin.at)) : null;
          return (
            <article key={c.id} className="pl-card">
              <div className="pl-top">
                <button type="button" className="pl-open" onClick={() => onOpenLead(c)}>
                  <span className="pl-name">{name}</span>
                  {c.address && <span className="pl-addr">{c.address}</span>}
                  {chip && (
                    <span className={`pl-fin lead-card-financing-${chip.tone}`} title={chip.title}>
                      {chip.text}
                    </span>
                  )}
                </button>
                <span className="pl-rep">{(c.assigned_to && repById.get(c.assigned_to)) || "Unassigned"}</span>
              </div>
              <div className="pl-bottom">
                <span className={"pl-meta" + (meta.stale ? " is-stale" : "")}>{meta.text}</span>
                {phone && (
                  <button
                    type="button"
                    className="pl-round"
                    aria-label={`Call ${name}`}
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent("crm:call", { detail: { phone, leadId: c.id } }))
                    }
                  >
                    <MobileIcon name="dialer" size={19} />
                  </button>
                )}
                {phone && (
                  <button
                    type="button"
                    className="pl-round"
                    aria-label={`Text ${name}`}
                    onClick={() => onOpenLead(c, "Texts")}
                  >
                    <MobileIcon name="texts" size={19} />
                  </button>
                )}
                {c.address && (
                  <a
                    className="pl-round"
                    href={mapsUrl(c.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Directions to ${name}`}
                  >
                    <MobileIcon name="navigate" size={19} />
                  </a>
                )}
              </div>
            </article>
          );
        })
      )}

      {group && remaining > 0 && (
        <button type="button" className="pl-more" onClick={() => onLoadMore(group.stage)}>
          Show more · {remaining.toLocaleString()} left
        </button>
      )}

      {onNewContact && (
        <button type="button" className="pl-fab" onClick={onNewContact}>
          <MobileIcon name="plus" size={20} />
          New contact
        </button>
      )}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/field";
import { saveCompanyWords, type CompanyWordsSettings } from "@/lib/actions/settings";
import {
  LIVE_WORD_KEYS,
  WORD_CHOICES,
  WORD_LABELS,
  WORD_WHERE,
  readCompanyWords,
  wordProblem,
  type WordForm,
  type WordKey,
} from "@/lib/company-words";
import { documentSendSms } from "@/lib/estimate-email-copy";
import { documentLabels } from "@/lib/document-words";

const OWN = "own";

type Row = { choice: string; own: WordForm };

function rowFor(key: WordKey, form: WordForm): Row {
  const index = WORD_CHOICES[key].findIndex((c) => c.one === form.one && c.many === form.many);
  return index >= 0 ? { choice: String(index), own: { one: "", many: "" } } : { choice: OWN, own: form };
}

function formOf(key: WordKey, row: Row): WordForm {
  return row.choice === OWN ? row.own : WORD_CHOICES[key][Number(row.choice)];
}

/**
 * Settings › Company Words (DECISIONS #121): each word as a choice of the
 * usual ones or the company's own, with an example of a text a customer
 * would get. Shows only the words customers already see (LIVE_WORD_KEYS).
 */
export function CompanyWordsForm({ initial }: { initial: CompanyWordsSettings }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(LIVE_WORD_KEYS.map((key) => [key, rowFor(key, initial.words[key])]))
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = Object.fromEntries(LIVE_WORD_KEYS.map((key) => [key, formOf(key, rows[key])])) as Partial<
    Record<WordKey, WordForm>
  >;
  const problem = LIVE_WORD_KEYS.map((key) => {
    const p = wordProblem(chosen[key] ?? {});
    return p ? `${WORD_LABELS[key]}: ${p}` : null;
  }).find(Boolean);
  // The example reads whatever is valid so far, the standard word otherwise.
  const preview = readCompanyWords({ ...initial.words, ...chosen });

  function update(key: WordKey, next: Partial<Row>) {
    setRows((r) => ({ ...r, [key]: { ...r[key], ...next } }));
    setSaved(false);
    setError(null);
  }

  async function handleSave() {
    setPending(true);
    const res = await saveCompanyWords({ ...initial.words, ...chosen });
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div className="cp-card">
      {!initial.ready && (
        <p className="error-note">
          Company words need a database update before they can be saved (0196_company_wording.sql). Until
          then your customers see the standard words.
        </p>
      )}
      {LIVE_WORD_KEYS.map((key) => {
        const row = rows[key];
        return (
          <div key={key} className="words-row">
            <Field label={WORD_LABELS[key]}>
              <select
                value={row.choice}
                onChange={(e) => update(key, { choice: e.target.value })}
                aria-label={`${WORD_LABELS[key]} word`}
              >
                {WORD_CHOICES[key].map((c, i) => (
                  <option key={c.one} value={String(i)}>
                    {c.one}
                    {i === 0 ? " (standard)" : ""}
                  </option>
                ))}
                <option value={OWN}>Your own word…</option>
              </select>
            </Field>
            {row.choice === OWN && (
              <div className="words-own">
                <Field label="Singular">
                  <input
                    value={row.own.one}
                    maxLength={30}
                    placeholder={WORD_CHOICES[key][0].one}
                    onChange={(e) => update(key, { own: { ...row.own, one: e.target.value } })}
                  />
                </Field>
                <Field label="Plural">
                  <input
                    value={row.own.many}
                    maxLength={30}
                    placeholder={WORD_CHOICES[key][0].many}
                    onChange={(e) => update(key, { own: { ...row.own, many: e.target.value } })}
                  />
                </Field>
              </div>
            )}
            <p className="cp-hint">{WORD_WHERE[key]}</p>
          </div>
        );
      })}

      <div className="words-example">
        <div className="words-example-label">A customer would get:</div>
        <p>
          {documentSendSms({
            companyName: initial.companyName,
            docNumber: "EST-1012",
            kind: "contract",
            words: preview,
            link: "(link)",
          }).split("\n")[0]}
        </p>
        <p>
          {documentSendSms({
            companyName: initial.companyName,
            docNumber: "EST-1012-CO1",
            kind: "change_order",
            words: preview,
            link: "(link)",
          }).split("\n")[0]}
        </p>
        <div className="words-example-label">And on the document:</div>
        <p>
          {(() => {
            const l = documentLabels("contract", preview);
            return `${l.forLabel}: Kitchen Remodel · ${l.deposit}, ${l.depositDue.toLowerCase()} · signed by the ${l.customerParty.toLowerCase()}`;
          })()}
        </p>
      </div>

      <div className="modal-actions">
        <div>
          {saved && <span className="cp-saved">✓ Saved</span>}
          {(error || problem) && <span className="error-note">{error || problem}</span>}
        </div>
        <div>
          <button className="btn-primary" onClick={handleSave} disabled={pending || !!problem || !initial.ready}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

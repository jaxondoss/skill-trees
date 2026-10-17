"use client";

import { useState, useTransition } from "react";
import { saveIdentity } from "@/app/todo-actions";

/** The skill's identity line, edited in place: click, type, Enter or click away to save. */
export function IdentityLine({ skillId, skillName, initial }: { skillId: string; skillName: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const save = () => {
    setEditing(false);
    if (value.trim() === saved.trim()) return;
    start(async () => {
      const r = await saveIdentity(skillId, value);
      if (r.ok) {
        setSaved(value);
        setStatus("Saved.");
      } else setStatus(r.error);
    });
  };
  if (!editing)
    return (
      <div className="mt-1.5 max-w-[640px]">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`-ml-1 block w-full rounded-md px-1 py-0.5 text-left text-sm hover:bg-white/[0.03] ${value ? "text-muted" : "text-label"}`}
          aria-label={value ? `Identity: ${value}. Edit` : `Write who you are becoming in ${skillName}`}
        >
          <span aria-hidden={!value}>{value || `Write who you are becoming in ${skillName}.`}</span>
        </button>
        {(pending || status) && (
          <span role="status" className="text-[11px] text-label">
            {pending ? "Saving…" : status}
          </span>
        )}
      </div>
    );
  return (
    <div className="mt-1.5 max-w-[640px]">
      <label htmlFor={`identity-${skillId}`} className="sr-only">
        Who you are becoming in {skillName}
      </label>
      <input
        id={`identity-${skillId}`}
        value={value}
        maxLength={200}
        autoFocus
        placeholder={`Write who you are becoming in ${skillName}.`}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus(null);
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(saved);
            setEditing(false);
          }
        }}
        className="-ml-1 w-full rounded-md bg-transparent px-1 py-0.5 text-sm text-muted outline-none placeholder:text-label hover:bg-white/[0.03] focus:bg-sunk focus:text-text focus:shadow-[0_0_0_1px_var(--border-strong)]"
      />
      {(pending || status) && (
        <span role="status" className="text-[11px] text-label">
          {pending ? "Saving…" : status}
        </span>
      )}
    </div>
  );
}

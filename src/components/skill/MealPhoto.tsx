"use client";

import { Camera, X } from "lucide-react";
import { useState } from "react";
import { addMeal, analyzeMealPhoto } from "@/app/tracker-actions";
import type { MealAnalysis } from "@/lib/claude-prompts";
import { useAction } from "./useAction";

const SCALES = [0.5, 1, 1.5, 2];

/** Photo to nutrition table (spec 12.10). Portions are confirmed here before anything is saved. */
export function MealPhoto() {
  const [items, setItems] = useState<(MealAnalysis["items"][number] & { scale: number })[] | null>(null);
  const [notes, setNotes] = useState("");
  const { pending, run, runData, line } = useAction();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.set("photo", await downscale(file));
    runData(
      () => analyzeMealPhoto(form),
      (data) => {
        setItems(data.items.map((i) => ({ ...i, scale: 1 })));
        setNotes(data.notes);
      },
    );
  };

  if (!items) {
    return (
      <div className="space-y-1">
        <label className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border text-sm ${pending ? "opacity-50" : ""}`}>
          <Camera className="size-4" aria-hidden />
          {pending ? "Reading the photo" : "Log a meal from a photo"}
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={pending} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {line}
      </div>
    );
  }

  const total = (k: "calories" | "proteinG" | "fiberG") => items.reduce((s, i) => s + i[k] * i.scale, 0);
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="text-xs text-muted">Check each portion. Nothing is saved until you confirm. {notes}</p>
      <ul className="space-y-3">
        {items.map((item, idx) => (
          <li key={idx} className="space-y-1.5">
            <div className="flex items-start justify-between gap-2 text-sm">
              <span>
                {item.name} <span className="text-muted">({item.portion})</span>
              </span>
              <button type="button" aria-label={`Remove ${item.name}`} onClick={() => setItems(items.filter((_, i) => i !== idx))} className="grid size-11 shrink-0 place-items-center text-muted">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex gap-1.5" role="group" aria-label={`Portion of ${item.name}`}>
              {SCALES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={item.scale === s}
                  onClick={() => setItems(items.map((it, i) => (i === idx ? { ...it, scale: s } : it)))}
                  className={`num min-h-11 flex-1 rounded-lg border text-xs ${item.scale === s ? "border-gold/60 bg-gold/10 text-gold" : "border-border"}`}
                >
                  {s}x
                </button>
              ))}
            </div>
            <p className="num text-[11px] text-muted">
              {Math.round(item.calories * item.scale)} kcal, {Math.round(item.proteinG * item.scale)} g protein, {Math.round(item.fiberG * item.scale)} g fiber
            </p>
          </li>
        ))}
      </ul>
      <p className="num text-sm">
        Total: {Math.round(total("calories"))} kcal, {Math.round(total("proteinG"))} g protein, {Math.round(total("fiberG"))} g fiber
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => setItems(null)} className="min-h-11 flex-1 rounded-xl border border-border text-sm">
          Discard
        </button>
        <button
          type="button"
          disabled={pending || items.length === 0}
          onClick={() =>
            run(
              () => addMeal({ calories: Math.round(total("calories")), proteinG: Math.round(total("proteinG")), fiberG: Math.round(total("fiberG")) }),
              "Meal added.",
              () => setItems(null),
            )
          }
          className="min-h-11 flex-[2] rounded-xl bg-gold text-sm font-medium text-bg disabled:opacity-50"
        >
          Save meal
        </button>
      </div>
      {line}
    </div>
  );
}

/** Phone photos are large; a 1280px JPEG is plenty for food recognition and keeps the upload small. */
async function downscale(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], "meal.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

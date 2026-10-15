"use client";

import { useEffect, useState } from "react";
import { generateReadingPassage, saveReadingTest } from "@/app/tracker-actions";
import { passageById, PASSAGES, scoreReading, wordCount } from "@/content/reading-passages";
import { shortDate } from "@/engine/time";
import type { Tracker } from "@/lib/data/skill";
import { useAction } from "./useAction";

type Test = { id: string | null; title: string; text: string; questions: { question: string; options: string[]; answerIndex: number }[] };
type Stage = { name: "intro" } | { name: "reading"; startedAt: number } | { name: "questions"; seconds: number } | { name: "result"; seconds: number; correct: number };

const button = "min-h-11 rounded-xl border border-border px-4 text-sm disabled:opacity-40";
const primary = "min-h-12 w-full rounded-xl bg-gold font-medium text-bg disabled:opacity-50";

/** Timed reading test (spec 12.4): read, answer from memory, save an effective rate. */
export function ReadingTest({ t }: { t: Extract<Tracker, { kind: "reading" }> }) {
  const [test, setTest] = useState<Test>(() => fromPassage(t.passageId));
  const [stage, setStage] = useState<Stage>({ name: "intro" });
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [topic, setTopic] = useState("");
  const { pending, run, line, runData } = useAction();

  const words = wordCount(test.text);
  const reset = () => {
    setStage({ name: "intro" });
    setAnswers([]);
  };

  if (stage.name === "reading") {
    return (
      <div className="space-y-4">
        <Stopwatch startedAt={stage.startedAt} />
        <article className="space-y-3 text-[15px] leading-relaxed">
          <h3 className="font-display text-xl">{test.title}</h3>
          {test.text.split(/\n\s*\n/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </article>
        <button
          type="button"
          className={primary}
          onClick={() => {
            setAnswers(test.questions.map(() => null));
            setStage({ name: "questions", seconds: (performance.now() - stage.startedAt) / 1000 });
          }}
        >
          Done reading
        </button>
      </div>
    );
  }

  if (stage.name === "questions") {
    const complete = answers.every((a) => a !== null);
    return (
      <div className="space-y-4">
        <p className="text-xs text-muted">Answer from memory. The passage stays hidden.</p>
        {test.questions.map((q, qi) => (
          <fieldset key={qi} className="space-y-2">
            <legend className="text-sm">
              <span className="num text-muted">{qi + 1}.</span> {q.question}
            </legend>
            {q.options.map((o, oi) => (
              <label key={oi} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm ${answers[qi] === oi ? "border-gold/60 bg-gold/10" : "border-border"}`}>
                <input type="radio" name={`q${qi}`} className="accent-[var(--gold)]" checked={answers[qi] === oi} onChange={() => setAnswers(answers.map((a, i) => (i === qi ? oi : a)))} />
                {o}
              </label>
            ))}
          </fieldset>
        ))}
        <button
          type="button"
          disabled={!complete}
          className={primary}
          onClick={() => setStage({ name: "result", seconds: stage.seconds, correct: test.questions.filter((q, i) => answers[i] === q.answerIndex).length })}
        >
          Check answers
        </button>
      </div>
    );
  }

  if (stage.name === "result") {
    const s = scoreReading(words, stage.seconds, stage.correct, test.questions.length);
    return (
      <div className="space-y-3">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Speed" value={`${Math.round(s.wpm)}`} unit="wpm" />
          <Stat label="Comprehension" value={`${Math.round(s.comprehensionPct)}`} unit="%" />
          <Stat label="Effective" value={`${Math.round(s.effectiveRate)}`} unit="wpm" />
        </dl>
        <p className="text-xs text-muted">
          <span className="num">{stage.correct}</span> of <span className="num">{test.questions.length}</span> right in <span className="num">{Math.round(stage.seconds)}</span> seconds.
          {t.tests.length === 0 && " This first test is your baseline."}
        </p>
        <button
          type="button"
          disabled={pending}
          className={primary}
          onClick={() =>
            run(() => saveReadingTest({ passageId: test.id, words, seconds: stage.seconds, correct: stage.correct, total: test.questions.length }), "Saved. Next test in two weeks.", reset)
          }
        >
          Save result
        </button>
        <button type="button" onClick={reset} className={`${button} w-full`}>
          Discard
        </button>
        {line}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {t.due ? "A reading test is due." : `Next test ${t.nextDue ? shortDate(t.nextDue) : "now"}.`}{" "}
        <span className="text-muted">
          Read <span className="num">{words}</span> words at your normal pace, then answer <span className="num">{test.questions.length}</span> questions.
        </span>
      </p>
      <label className="block space-y-1 text-xs text-muted">
        Passage
        <select
          value={test.id ?? "generated"}
          onChange={(e) => e.target.value !== "generated" && setTest(fromPassage(e.target.value))}
          className="h-11 w-full rounded-xl border border-border bg-black/30 px-3 text-sm text-text"
        >
          {PASSAGES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
          {!test.id && <option value="generated">{test.title}</option>}
        </select>
      </label>
      <button type="button" className={primary} onClick={() => setStage({ name: "reading", startedAt: performance.now() })}>
        Start the clock
      </button>
      {t.claude && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runData(() => generateReadingPassage(topic), (data) => setTest({ id: null, title: data.title, text: data.passage, questions: data.questions }));
          }}
        >
          <input aria-label="Topic for a new passage" placeholder="Topic for a new passage" value={topic} onChange={(e) => setTopic(e.target.value)} className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-black/30 px-3 text-sm" />
          <button type="submit" disabled={pending || !topic.trim()} className={button}>
            {pending ? "Writing" : "Generate"}
          </button>
        </form>
      )}
      {line}
      {t.tests.length > 0 && (
        <table className="w-full text-xs">
          <caption className="sr-only">Past reading tests</caption>
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-normal">Date</th>
              <th className="text-right font-normal">wpm</th>
              <th className="text-right font-normal">Comp.</th>
              <th className="text-right font-normal">Effective</th>
            </tr>
          </thead>
          <tbody className="num">
            {t.tests.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1.5">{shortDate(r.day)}</td>
                <td className="text-right">{r.wpm ?? ""}</td>
                <td className="text-right">{r.comprehensionPct != null ? `${r.comprehensionPct}%` : ""}</td>
                <td className="text-right">{Math.round(r.effectiveRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function fromPassage(id: string): Test {
  const p = passageById(id) ?? PASSAGES[0]!;
  return { id: p.id, title: p.title, text: p.text, questions: p.questions };
}

function Stopwatch({ startedAt }: { startedAt: number }) {
  const [s, setS] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setS(Math.floor((performance.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <p className="num sticky top-2 z-10 ml-auto w-fit rounded-full border border-border bg-bg/90 px-3 py-1 text-sm" aria-label="Elapsed time">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </p>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-xl border border-border p-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="num font-display text-2xl">
        {value}
        <span className="ml-0.5 text-xs text-muted">{unit}</span>
      </dd>
    </div>
  );
}

/**
 * One precise visualization per skill (spec v2 r2, 6). Each builder takes the skill's data and a width and
 * returns escaped SVG markup, a one-sentence reading, and a legend. One scale per chart, direct labels, a
 * tooltip (data-tip) on every mark. Builders return svg: null when there is nothing to draw yet.
 */
import { addDays, daysBetween, weekStart } from "@/engine/time";
import type { VizData } from "@/lib/data/skill";

export type Legend = { k: string; l: string; t?: "line" | "dash" | "dot" | "diamond" };
export type Built = { title: string; reading: string; svg: string | null; legend: Legend[]; empty: string };

const MUTED = "#5d6072",
  OFF = "#4a4d5e",
  GRID = "rgba(255,255,255,.06)";
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const comma = (n: number) => Math.round(n).toLocaleString("en-US");
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const avg = (a: number[]) => (a.length ? sum(a) / a.length : 0);
const lin = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
const dt = (day: string) => new Date(`${day}T12:00:00Z`);
const md = (day: string) => dt(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const wd = (day: string) => dt(day).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const svg = (w: number, h: number, label: string, inner: string) =>
  `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
const gridY = (x0: number, x1: number, y: (v: number) => number, ticks: number[], fmt: (v: number) => string = String) =>
  ticks.map((t) => `<line x1="${x0}" x2="${x1}" y1="${y(t)}" y2="${y(t)}" stroke="${GRID}"/><text x="${x0 - 8}" y="${y(t) + 3.5}" text-anchor="end">${esc(fmt(t))}</text>`).join("");
const topBar = (x: number, y: number, w: number, h: number, r = 3) => {
  if (h <= 0 || w <= 0) return "";
  r = Math.min(r, h, w / 2);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
};
const hit = (x: number, y: number, w: number, h: number, tip: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent" data-tip="${esc(tip)}"/>`;
const diamond = (x: number, y: number, s: number) => `M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z`;
const lab = (x: number, y: number, text: string, fill = "var(--text)", anchor = "start", extra = "") =>
  `<text class="lab" x="${x}" y="${y}" text-anchor="${anchor}" style="fill:${fill}" ${extra}>${esc(text)}</text>`;
const label = (x: number, y: number, text: string) => `<text x="${x}" y="${y}" style="font-family:var(--font-sans);font-weight:700;letter-spacing:.14em;font-size:10px">${esc(text.toUpperCase())}</text>`;

/** Weekly buckets ending this week: [{start, values}] oldest first. */
function weeks(today: string, n: number) {
  const thisWeek = weekStart(today);
  return Array.from({ length: n }, (_, i) => addDays(thisWeek, -(n - 1 - i) * 7));
}
const inWeek = (day: string, start: string) => day >= start && day < addDays(start, 7);

// ───────────────────────────── builders

function aiBuilding(d: VizData, w: number): Built {
  const ships = (d.series.ship ?? []).map((s) => ({ day: s.day, title: String(s.meta?.title ?? "Shipped") }));
  const n = 26,
    starts = weeks(d.today, n),
    byDay = new Map(d.goalDays.map((g) => [g.day, g]));
  const recent = d.goalDays.filter((g) => g.result && g.day >= addDays(d.today, -56));
  const base: Omit<Built, "svg" | "reading"> = {
    title: "Ship log",
    empty: "Log a build session or a ship to start the log.",
    legend: [
      { k: "rgba(200,133,14,.35)", l: "Under 30 min" },
      { k: "rgba(200,133,14,.65)", l: "30 to 60 min" },
      { k: "var(--business)", l: "Over 60 min" },
      { k: "var(--gold)", l: "Shipped", t: "diamond" },
    ],
  };
  if (!ships.length && !d.goalDays.some((g) => g.result)) return { ...base, svg: null, reading: base.empty };
  const gap = 3,
    gx = 34,
    gy = 22,
    cs = Math.max(8, Math.min(24, Math.floor((w - gx - 8) / n) - gap));
  let out = "";
  starts.forEach((start, i) => {
    if (dt(start).getUTCDate() <= 7 || i === 0) out += `<text x="${gx + i * (cs + gap)}" y="12">${esc(dt(start).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }))}</text>`;
    for (let j = 0; j < 7; j++) {
      const day = addDays(start, j);
      if (day > d.today) continue;
      const g = byDay.get(day),
        m = g?.result ? Math.max(g.minutes, 1) : 0;
      const op = m === 0 ? 1 : m < 30 ? 0.35 : m < 60 ? 0.65 : 1;
      out += `<rect x="${gx + i * (cs + gap)}" y="${gy + j * (cs + gap)}" width="${cs}" height="${cs}" rx="3" fill="${m ? "var(--c)" : "rgba(255,255,255,.045)"}" fill-opacity="${op}" data-tip="${esc(`${wd(day)} ${md(day)}: ${m ? `${g!.minutes} min` : "no session"}`)}"/>`;
    }
  });
  ["M", "", "W", "", "F", "", ""].forEach((l, j) => l && (out += `<text x="${gx - 10}" y="${gy + j * (cs + gap) + cs / 2 + 3.5}" text-anchor="end">${l}</text>`));
  const ty = gy + 7 * (cs + gap) + 26,
    x1 = gx + n * (cs + gap) - gap;
  out += `<line x1="${gx}" x2="${x1}" y1="${ty}" y2="${ty}" stroke="rgba(255,255,255,.12)"/>`;
  ships
    .filter((s) => s.day >= starts[0]!)
    .forEach((s, k) => {
      const wi = Math.min(n - 1, Math.floor(daysBetween(starts[0]!, s.day) / 7)),
        x = gx + wi * (cs + gap) + cs / 2,
        ly = ty + (k % 2 ? 36 : 22);
      const anchor = x < 80 ? "start" : x > w - 80 ? "end" : "middle";
      out += `<line x1="${x}" x2="${x}" y1="${gy + 7 * (cs + gap) - 2}" y2="${ty}" stroke="rgba(212,175,55,.35)" stroke-dasharray="2 3"/><path d="${diamond(x, ty, 9)}" fill="rgba(212,175,55,.18)"/><path d="${diamond(x, ty, 5)}" fill="var(--gold)" data-tip="${esc(`${md(s.day)}: ${s.title}`)}"/>${lab(x, ly, s.title, "var(--text)", anchor)}`;
    });
  const hours = sum(recent.map((g) => g.minutes)) / 60;
  return {
    ...base,
    svg: svg(w, ty + 46, `Build sessions over 26 weeks and ${ships.length} shipped`, out),
    reading: `<b>${ships.length} thing${ships.length === 1 ? "" : "s"} shipped</b>${ships.length ? ` (latest: ${esc(ships.at(-1)!.title)})` : ""}. <b>${recent.length} build sessions</b> in the last 8 weeks, ${f1(hours)} hours.`,
  };
}

function dropshipping(d: VizData, w: number): Built {
  const starts = weeks(d.today, 12);
  const wk = (key: string) => starts.map((s) => sum((d.series[key] ?? []).filter((e) => inWeek(e.day, s)).map((e) => e.value)));
  const rev = wk("revenue_week_usd"),
    ad = wk("ad_spend_week_usd"),
    orders = wk("orders_week");
  const prof = rev.map((r, i) => Math.round(r * (1 - d.costShare) - ad[i]!));
  const base = {
    title: "Unit economics",
    empty: "Enter a week of revenue and ad spend to see what the store really makes.",
    legend: [
      { k: "var(--business)", l: "Revenue" },
      { k: MUTED, l: "Ad spend" },
      { k: "var(--text)", l: `Profit after ads and product cost (${Math.round(d.costShare * 100)}%)`, t: "line" as const },
    ],
  };
  if (!rev.some(Boolean) && !ad.some(Boolean)) return { ...base, svg: null, reading: base.empty };
  const h = 250,
    P = { l: 52, r: 96, t: 16, b: 26 },
    n = 12;
  const top = Math.max(200, Math.ceil(Math.max(...rev, ...ad) / 200) * 200),
    bot = Math.min(0, Math.floor(Math.min(...prof) / 100) * 100);
  const y = lin(bot, top, h - P.b, P.t),
    bw = (w - P.l - P.r) / n;
  let out = gridY(P.l, w - P.r, y, [...new Set([bot, 0, top / 2, top])], (v) => `$${comma(v)}`);
  rev.forEach((r, i) => {
    const x = P.l + i * bw;
    out += `<path d="${topBar(x + bw * 0.16, y(r), bw * 0.32, y(0) - y(r))}" fill="var(--c)"/><path d="${topBar(x + bw * 0.52, y(ad[i]!), bw * 0.32, y(0) - y(ad[i]!))}" fill="${MUTED}"/>`;
    out += hit(x, P.t, bw, h - P.t - P.b, `Week of ${md(starts[i]!)}: revenue $${comma(r)}, ads $${comma(ad[i]!)}, profit $${comma(prof[i]!)}, ${orders[i]} orders`);
  });
  const pts = prof.map((p, i) => [P.l + i * bw + bw / 2, y(p)] as const);
  out += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("")}" fill="none" stroke="var(--text)" stroke-width="2"/>${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="var(--text)"/>`).join("")}`;
  const L = pts.at(-1)!;
  out += lab(L[0] + 12, L[1] + 4, `Profit $${comma(prof.at(-1)!)}`) + lab(P.l + (n - 1) * bw + bw * 0.32, y(rev.at(-1)!) - 8, `$${comma(rev.at(-1)!)}`, "var(--ct)", "middle");
  out += `<text x="${P.l}" y="${h - 6}">12 weeks ago</text><text x="${w - P.r}" y="${h - 6}" text-anchor="end">This week</text>`;
  const i = n - 1;
  return {
    ...base,
    svg: svg(w, h, "Weekly revenue, ad spend and profit for 12 weeks", out),
    reading: `<b>$${comma(rev[i]!)} revenue</b> this week on $${comma(ad[i]!)} in ads${ad[i] ? `, a return of <b>${f1(rev[i]! / ad[i]!)}x</b>` : ""}. Profit after ads and product cost: <b>$${comma(prof[i]!)}</b>.`,
  };
}

const letter = (p: number) => (p >= 93 ? "A" : p >= 90 ? "A-" : p >= 87 ? "B+" : p >= 83 ? "B" : p >= 80 ? "B-" : p >= 70 ? "C" : "D");
function academics(d: VizData, w: number): Built {
  const latest = new Map<string, { grade: number; target: number }>();
  for (const e of d.series.course_grade ?? []) {
    const c = String(e.meta?.course ?? "Course");
    latest.set(c, { grade: e.value, target: Number(e.meta?.target ?? latest.get(c)?.target ?? 93) });
  }
  const courses = [...latest.entries()].map(([code, v]) => ({ code, ...v }));
  const due = [...d.due].sort((a, b) => a.inDays - b.inDays);
  const base = {
    title: "Course board",
    empty: "Add a grade for each course. Due dates come from Canvas or your own list.",
    legend: [
      { k: "var(--school)", l: "Current grade" },
      { k: "var(--text)", l: "Your target", t: "line" as const },
      { k: "var(--school-text)", l: "Due within 48 h", t: "dot" as const },
    ],
  };
  if (!courses.length && !due.length) return { ...base, svg: null, reading: base.empty };
  const rowH = 34,
    lw = Math.min(160, w * 0.24),
    gw = 74,
    lo = Math.min(60, Math.floor(Math.min(100, ...courses.map((c) => c.grade)) / 10) * 10),
    x = lin(lo, 100, lw, w - gw);
  let out = "";
  if (courses.length) {
    for (let t = lo; t <= 100; t += 10) out += `<line x1="${x(t)}" x2="${x(t)}" y1="4" y2="${courses.length * rowH}" stroke="${GRID}"/><text x="${x(t)}" y="${courses.length * rowH + 14}" text-anchor="middle">${t}</text>`;
    courses.forEach((c, i) => {
      const yy = 8 + i * rowH;
      out += `${lab(0, yy + 13, c.code)}<rect x="${lw}" y="${yy + 6}" width="${w - gw - lw}" height="8" rx="4" fill="rgba(255,255,255,.05)"/><rect x="${lw}" y="${yy + 6}" width="${Math.max(0, x(c.grade) - lw)}" height="8" rx="4" fill="var(--c)" data-tip="${esc(`${c.code}: ${f1(c.grade)}%, target ${c.target}%`)}"/><line x1="${x(c.target)}" x2="${x(c.target)}" y1="${yy + 1}" y2="${yy + 19}" stroke="var(--text)" stroke-width="2"/><text x="${w}" y="${yy + 14}" text-anchor="end" style="font-size:12px;font-weight:600;fill:${c.grade >= c.target ? "var(--text)" : "var(--text-muted)"}">${f1(c.grade)} ${letter(c.grade)}</text>`;
    });
  }
  const y0 = courses.length * rowH + (courses.length ? 52 : 24),
    tx = lin(0, 14, lw, w - gw);
  out += `${label(0, y0 + 4, "Next 14 days")}<line x1="${lw}" x2="${w - gw}" y1="${y0}" y2="${y0}" stroke="rgba(255,255,255,.14)"/>`;
  for (let k = 0; k <= 14; k += 2) {
    const day = addDays(d.today, k);
    out += `<line x1="${tx(k)}" x2="${tx(k)}" y1="${y0 - 3}" y2="${y0 + 3}" stroke="rgba(255,255,255,.2)"/><text x="${tx(k)}" y="${y0 + 46}" text-anchor="middle">${k === 0 ? "Today" : `${wd(day)} ${dt(day).getUTCDate()}`}</text>`;
  }
  due.forEach((it, k) => {
    const soon = it.inDays <= 2,
      xx = tx(it.inDays),
      ly = y0 + (k % 2 ? 30 : -12);
    out += `<circle cx="${xx}" cy="${y0}" r="${soon ? 6 : 4.5}" fill="${soon ? "var(--ct)" : "var(--text-muted)"}" data-tip="${esc(`${it.course ? `${it.course}: ` : ""}${it.name}`)}"/>${lab(xx, ly, it.name, soon ? "var(--ct)" : "var(--text-muted)", "middle")}`;
  });
  const ok = courses.filter((c) => c.grade >= c.target),
    worst = courses.filter((c) => c.grade < c.target).sort((a, b) => a.grade - a.target - (b.grade - b.target))[0],
    next = due[0];
  return {
    ...base,
    svg: svg(w, y0 + 56, "Grade in each course against your target, and deadlines in the next 14 days", out),
    reading: `${courses.length ? `<b>${ok.length} of ${courses.length} courses</b> at or above target.${worst ? ` ${esc(worst.code)} is ${f1(worst.target - worst.grade)} points under.` : ""}` : "No grades yet."} ${next ? `<b>${esc(next.name)}</b> is due in ${next.inDays < 2 ? `${Math.round(next.inDays * 24)} h` : `${Math.round(next.inDays)} days`}.` : "Nothing due in the next 14 days."}`,
  };
}

function reading(d: VizData, w: number): Built {
  const books = new Map<string, { total: number; read: number }>();
  for (const e of d.series.book_pages ?? []) {
    const t = String(e.meta?.title ?? "Book");
    const b = books.get(t) ?? { total: 0, read: 0 };
    b.read += e.value;
    if (Number(e.meta?.total)) b.total = Number(e.meta?.total);
    books.set(t, b);
  }
  const shelf = [...books.entries()].map(([t, b]) => ({ t, p: Math.max(b.total, b.read, 1), r: b.read })).slice(-7);
  const tests = (d.series.reading_effective_rate ?? []).slice(-8);
  const base = {
    title: "Shelf and rate",
    empty: "Log pages from the book you are reading, and take the reading test.",
    legend: [
      { k: "var(--school)", l: "Pages read" },
      { k: "var(--gold)", l: "Finished", t: "line" as const },
      { k: "var(--school-text)", l: "Effective rate (wpm times comprehension)", t: "line" as const },
    ],
  };
  if (!shelf.length && !tests.length) return { ...base, svg: null, reading: base.empty };
  const h = 260,
    baseY = h - 30,
    sw = shelf.length ? Math.min(w * 0.44, 340) : 0;
  let out = "";
  if (shelf.length) {
    const spw = Math.min(46, (sw - 20) / shelf.length - 8),
      maxP = Math.max(...shelf.map((b) => b.p));
    out += `<rect x="0" y="${baseY}" width="${sw}" height="6" rx="2" fill="#1d1e29"/>`;
    shelf.forEach((b, i) => {
      const bh = 100 + (b.p / maxP) * 110,
        x = 10 + i * (spw + 8),
        y = baseY - bh,
        rh = (bh * Math.min(b.r, b.p)) / b.p,
        done = b.r >= b.p;
      out += `<rect x="${x}" y="${y}" width="${spw}" height="${bh}" rx="3" fill="#101018" stroke="rgba(255,255,255,.12)"/>`;
      if (rh) out += `<rect x="${x}" y="${baseY - rh}" width="${spw}" height="${rh}" rx="3" fill="var(--c)" fill-opacity="${done ? 0.9 : 0.6}"/>`;
      if (done) out += `<rect x="${x}" y="${y}" width="${spw}" height="4" rx="2" fill="var(--gold)"/>`;
      out += `<text x="${x + spw / 2 + 4}" y="${baseY - 10}" transform="rotate(-90 ${x + spw / 2 + 4} ${baseY - 10})" style="font-family:var(--font-sans);font-weight:700;font-size:11px;fill:${rh > bh * 0.5 ? "#0b0b13" : "var(--text-muted)"}">${esc(b.t.slice(0, 26))}</text>${hit(x, y, spw, bh, `${b.t}: ${Math.round(b.r)} of ${b.p} pages`)}`;
    });
  }
  if (tests.length) {
    const x0 = sw ? sw + 70 : 50,
      x1 = w - 40,
      vals = tests.map((t) => t.value),
      lo = Math.floor((Math.min(...vals) - 20) / 50) * 50,
      hi = Math.ceil((Math.max(...vals) + 20) / 50) * 50;
    const y = lin(lo, hi, baseY, 20),
      x = lin(0, Math.max(1, tests.length - 1), x0, x1);
    out += gridY(x0, x1, y, [lo, (lo + hi) / 2, hi]);
    out += `<line x1="${x0}" x2="${x1}" y1="${y(vals[0]!)}" y2="${y(vals[0]!)}" stroke="${MUTED}" stroke-dasharray="4 4"/><text x="${x1}" y="${y(vals[0]!) + 16}" text-anchor="end">Baseline ${Math.round(vals[0]!)}</text>`;
    out += `<path d="${tests.map((t, i) => `${i ? "L" : "M"}${x(i)} ${y(t.value)}`).join("")}" fill="none" stroke="var(--ct)" stroke-width="2.5"/>`;
    tests.forEach((t, i) => (out += `<circle cx="${x(i)}" cy="${y(t.value)}" r="4" fill="var(--ct)" data-tip="${esc(`${md(t.day)}: ${Math.round(t.value)} wpm`)}"/>${lab(x(i), y(t.value) - 10, String(Math.round(t.value)), "var(--text)", "middle")}<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${md(t.day)}</text>`));
  }
  const done = shelf.filter((b) => b.r >= b.p),
    cur = shelf.filter((b) => b.r < b.p).at(-1),
    t0 = tests[0]?.value,
    t1 = tests.at(-1)?.value;
  return {
    ...base,
    svg: svg(w, h, "Books on the shelf by pages read, and effective reading rate over time", out),
    reading: `<b>${done.length} book${done.length === 1 ? "" : "s"} finished</b>${cur ? `, ${esc(cur.t)} at ${Math.round((100 * cur.r) / cur.p)}%` : ""}.${t1 ? ` Effective rate <b>${Math.round(t1)} wpm</b>${t0 && tests.length > 1 ? `, ${t1 >= t0 ? "+" : ""}${Math.round((100 * (t1 - t0)) / t0)}% over your baseline` : ""}.` : " Take the reading test for a rate."}`,
  };
}

const WHERE = ["Classes", "Clubs", "Dorm", "Professors"];
function collegeIntegration(d: VizData, w: number): Built {
  const people = new Map<string, { where: string; m: number; last: string }>();
  for (const e of d.series.conversation ?? []) {
    const who = String(e.meta?.who ?? "Someone"),
      key = who.toLowerCase();
    const p = people.get(key) ?? { where: String(e.meta?.where ?? "Classes"), m: 0, last: e.day };
    p.m += 1;
    if (e.day > p.last) p.last = e.day;
    people.set(key, { ...p, where: WHERE.includes(String(e.meta?.where)) ? String(e.meta?.where) : p.where });
  }
  const list = [...people.entries()].map(([k, p]) => ({ who: (d.series.conversation ?? []).find((e) => String(e.meta?.who ?? "").toLowerCase() === k)?.meta?.who as string, ...p, ago: daysBetween(p.last, d.today) }));
  const starts = weeks(d.today, 8);
  const perWeek = starts.map((s) => (d.series.conversation ?? []).filter((e) => inWeek(e.day, s)).length);
  const hours = starts.map((s) => (d.series.conversation ?? []).some((e) => inWeek(e.day, s) && e.meta?.where === "Professors"));
  const base = {
    title: "Your people",
    empty: "Log the people you meet. The map fills in by where you met them.",
    legend: [
      { k: "var(--school)", l: "Bigger means more conversations, closer means more recent", t: "dot" as const },
      { k: "var(--gold)", l: "Office hours that week", t: "dot" as const },
    ],
  };
  if (!list.length) return { ...base, svg: null, reading: base.empty };
  const h = 300,
    lw = Math.min(w * 0.56, 560),
    cx = lw / 2,
    cy = h / 2,
    R = Math.min(lw / 2 - 30, 130);
  const quad: Record<string, [number, number]> = { Classes: [-180, -90], Clubs: [-90, 0], Dorm: [90, 180], Professors: [0, 90] };
  let out = [0.33, 0.66, 1].map((k) => `<circle cx="${cx}" cy="${cy}" r="${R * k}" fill="none" stroke="${GRID}" stroke-dasharray="3 5"/>`).join("");
  out += `<line x1="${cx - R - 10}" x2="${cx + R + 10}" y1="${cy}" y2="${cy}" stroke="${GRID}"/><line x1="${cx}" x2="${cx}" y1="${cy - R - 10}" y2="${cy + R + 10}" stroke="${GRID}"/>`;
  out += lab(cx - R - 12, cy - R + 4, "Classes", "var(--text-muted)") + lab(cx + R + 12, cy - R + 4, "Clubs", "var(--text-muted)", "end") + lab(cx - R - 12, cy + R + 4, "Dorm", "var(--text-muted)") + lab(cx + R + 12, cy + R + 4, "Professors", "var(--text-muted)", "end");
  for (const [where, [a0, a1]] of Object.entries(quad)) {
    const group = list.filter((p) => p.where === where).slice(0, 10);
    group.forEach((p, i) => {
      const a = ((a0 + ((i + 1) * (a1 - a0)) / (group.length + 1)) * Math.PI) / 180,
        r = 26 + (Math.min(p.ago, 21) / 21) * (R - 26);
      const x = cx + r * Math.cos(a),
        y = cy + r * Math.sin(a),
        size = 3.5 + Math.sqrt(p.m) * 2.2;
      out += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--c)" stroke-opacity=".18"/><circle cx="${x}" cy="${y}" r="${size}" fill="var(--c)" fill-opacity="${(1 - Math.min(p.ago, 21) / 30).toFixed(2)}" data-tip="${esc(`${p.who}: ${p.m} conversation${p.m === 1 ? "" : "s"}, last ${p.ago ? `${p.ago} days ago` : "today"}`)}"/>`;
      if (p.m >= 3 || group.length <= 3) out += `<text x="${x + (Math.cos(a) > 0 ? size + 5 : -size - 5)}" y="${y + 3.5}" text-anchor="${Math.cos(a) > 0 ? "start" : "end"}" style="font-family:var(--font-sans);font-weight:600">${esc(p.who)}</text>`;
    });
  }
  out += `<circle cx="${cx}" cy="${cy}" r="16" fill="#1d1e29" stroke="rgba(255,255,255,.2)"/>${lab(cx, cy + 4, "You", "var(--text)", "middle")}`;
  const x0 = lw + 50,
    x1 = w - 10,
    top = Math.max(...perWeek, 1) + 1,
    y = lin(0, top, h - 30, 40),
    bw = (x1 - x0) / 8;
  out += label(x0, 20, "Conversations per week") + gridY(x0, x1, y, [0, Math.round(top / 2), top]);
  perWeek.forEach((v, i) => {
    const x = x0 + i * bw;
    out += `<path d="${topBar(x + bw * 0.2, y(v), bw * 0.6, y(0) - y(v))}" fill="var(--c)" fill-opacity="${i === 7 ? 1 : 0.7}" data-tip="${esc(`Week of ${md(starts[i]!)}: ${v} conversations${hours[i] ? ", office hours" : ""}`)}"/>`;
    if (hours[i]) out += `<circle cx="${x + bw / 2}" cy="${y(v) - 9}" r="3.5" fill="var(--gold)"/>`;
  });
  out += `<text x="${x0}" y="${h - 8}">8 weeks ago</text><text x="${x1}" y="${h - 8}" text-anchor="end">This week</text>`;
  const week = list.filter((p) => p.ago <= 6).length,
    profs = list.filter((p) => p.where === "Professors").length;
  return { ...base, svg: svg(w, h, "People you know by where you met and recency, and conversations per week", out), reading: `<b>${list.length} ${list.length === 1 ? "person" : "people"}</b> you know by name, <b>${week} seen this week</b>. ${profs ? `Office hours with ${profs} professor${profs === 1 ? "" : "s"}.` : "No office hours logged yet."}` };
}

function timeBlocking(d: VizData, w: number): Built {
  const days = Array.from({ length: 14 }, (_, i) => addDays(d.today, i - 13));
  const adh = new Map((d.series.block_adherence_pct ?? []).map((e) => [e.day, e.value]));
  const planned = new Map(d.goalDays.map((g) => [g.day, !!g.result]));
  const base = { title: "Plan versus day", empty: "Plan tomorrow tonight and rate how the day went. The two weeks draw themselves.", legend: [{ k: "var(--mind)", l: "Blocks kept" }, { k: "var(--gold)", l: "Planned the night before", t: "dot" as const }] };
  if (!adh.size && !d.goalDays.some((g) => g.result)) return { ...base, svg: null, reading: base.empty };
  const h = 230,
    P = { l: 44, r: 12, t: 26, b: 30 },
    y = lin(0, 100, h - P.b, P.t),
    bw = (w - P.l - P.r) / 14;
  let out = gridY(P.l, w - P.r, y, [0, 50, 100], (v) => `${v}%`);
  days.forEach((day, i) => {
    const x = P.l + i * bw,
      v = adh.get(day),
      prev = planned.get(addDays(day, -1));
    if (v !== undefined) out += `<path d="${topBar(x + bw * 0.18, y(v), bw * 0.64, y(0) - y(v))}" fill="var(--c)" fill-opacity="${day === d.today ? 1 : 0.8}"/>`;
    else out += `<rect x="${x + bw * 0.18}" y="${y(0) - 2}" width="${bw * 0.64}" height="2" fill="rgba(255,255,255,.12)"/>`;
    if (prev) out += `<circle cx="${x + bw / 2}" cy="${P.t - 12}" r="3.5" fill="var(--gold)"/>`;
    out += hit(x, P.t - 20, bw, h - P.t - P.b + 20, `${wd(day)} ${md(day)}: ${v === undefined ? "not rated" : `${v}% of blocks kept`}${prev ? ", planned the night before" : ""}`);
    if (i % 2 === 1 || i === 13) out += `<text x="${x + bw / 2}" y="${h - 10}" text-anchor="middle">${i === 13 ? "Today" : wd(day)}</text>`;
  });
  const rated = days.map((x) => adh.get(x)).filter((v): v is number => v !== undefined);
  const plannedNights = days.slice(-7).filter((x) => planned.get(addDays(x, -1))).length;
  return { ...base, svg: svg(w, h, "Share of blocks kept each day for 14 days, with planned nights", out), reading: `Planned <b>${plannedNights} of 7</b> nights this week. ${rated.length ? `Kept <b>${Math.round(avg(rated))}%</b> of blocks on the ${rated.length} days you rated.` : "Rate a day to see adherence."}` };
}

function chess(d: VizData, w: number): Built {
  const all = d.series.chess_rating ?? [],
    pts = all.slice(-60);
  const last = pts.at(-1)?.value;
  const next = d.targets.filter((t) => t.key === "chess_rating" && !t.claimed && (last === undefined || t.value > last)).sort((a, b) => a.value - b.value)[0]?.value;
  const base = { title: "Rating", empty: "Connect Chess.com or Lichess by username, or enter your rating.", legend: [{ k: "var(--mind)", l: "Rating", t: "line" as const }, { k: "var(--gold)", l: "Next rating step on your list", t: "dash" as const }] };
  if (!pts.length) return { ...base, svg: null, reading: base.empty };
  const h = 230,
    P = { l: 48, r: 60, t: 18, b: 28 },
    vals = pts.map((p) => p.value);
  const lo = Math.floor((Math.min(...vals) - 20) / 50) * 50,
    hi = Math.max(next ? next + 20 : 0, Math.ceil((Math.max(...vals) + 20) / 50) * 50);
  const y = lin(lo, hi, h - P.b, P.t),
    x = lin(0, Math.max(1, pts.length - 1), P.l, w - P.r);
  let out = gridY(P.l, w - P.r, y, Array.from({ length: Math.floor((hi - lo) / 50) + 1 }, (_, k) => lo + k * 50));
  if (next) out += `<line x1="${P.l}" x2="${w - P.r}" y1="${y(next)}" y2="${y(next)}" stroke="var(--gold)" stroke-dasharray="5 5" stroke-opacity=".8"/>${lab(P.l + 6, y(next) - 7, `Next step ${next}`, "var(--gold)")}`;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
  out += `<path d="${line}L${x(pts.length - 1)} ${h - P.b}L${x(0)} ${h - P.b}Z" fill="var(--c)" fill-opacity=".1"/><path d="${line}" fill="none" stroke="var(--ct)" stroke-width="2.2" stroke-linejoin="round"/>`;
  out += `<circle cx="${x(pts.length - 1)}" cy="${y(last!)}" r="5" fill="var(--ct)"/>${lab(x(pts.length - 1) + 10, y(last!) + 4, String(Math.round(last!)))}`;
  out += pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.value)}" r="6" fill="transparent" data-tip="${esc(`${md(p.day)}: ${Math.round(p.value)}`)}"/>`).join("");
  out += `<text x="${P.l}" y="${h - 6}">${md(pts[0]!.day)}</text><text x="${w - P.r}" y="${h - 6}" text-anchor="end">${md(pts.at(-1)!.day)}</text>`;
  const first = pts[0]!.value,
    span = daysBetween(pts[0]!.day, pts.at(-1)!.day);
  return { ...base, svg: svg(w, h, `Chess rating over ${span} days`, out), reading: `Rating <b>${Math.round(last!)}</b>${pts.length > 1 ? `, ${last! >= first ? "+" : ""}${Math.round(last! - first)} since ${md(pts[0]!.day)}` : ""}.${next ? ` <b>${next}</b> is ${Math.round(next - last!)} points away.` : ""}` };
}

function meditation(d: VizData, w: number): Built {
  const n = 30,
    days = Array.from({ length: n }, (_, i) => addDays(d.today, i - n + 1)),
    by = new Map(d.goalDays.map((g) => [g.day, g]));
  const mins = days.map((day) => (by.get(day)?.result ? Math.max(1, by.get(day)!.minutes) : 0));
  const base = { title: "Thirty sits", empty: "Sit for three minutes. The first spoke goes in at the top.", legend: [{ k: "var(--mind)", l: "Minutes that day", t: "line" as const }, { k: "rgba(255,255,255,.35)", l: "10 minute ring", t: "dash" as const }] };
  if (!mins.some(Boolean)) return { ...base, svg: null, reading: base.empty };
  const h = 280,
    cx = Math.min(150, w * 0.25),
    cy = h / 2,
    r0 = 38,
    r1 = 122,
    sc = (m: number) => r0 + (Math.min(m, 25) / 25) * (r1 - r0);
  let out = `<circle cx="${cx}" cy="${cy}" r="${sc(10)}" fill="none" stroke="rgba(255,255,255,.3)" stroke-dasharray="3 4"/><text x="${cx + sc(10) * 0.72 + 4}" y="${cy - sc(10) * 0.72 - 4}">10 min</text><circle cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke="${GRID}"/>`;
  mins.forEach((m, i) => {
    const a = ((-90 + (i * 360) / n) * Math.PI) / 180,
      last = i === n - 1;
    const x0 = cx + (r0 + 2) * Math.cos(a),
      y0 = cy + (r0 + 2) * Math.sin(a);
    out += m
      ? `<line x1="${x0}" y1="${y0}" x2="${cx + sc(m) * Math.cos(a)}" y2="${cy + sc(m) * Math.sin(a)}" stroke="var(--ct)" stroke-width="5" stroke-linecap="round" stroke-opacity=".9"/>`
      : `<circle cx="${x0}" cy="${y0}" r="2" fill="${last ? "var(--text)" : MUTED}"/>`;
    out += `<line x1="${cx}" y1="${cy}" x2="${cx + r1 * Math.cos(a)}" y2="${cy + r1 * Math.sin(a)}" stroke="transparent" stroke-width="10" data-tip="${esc(`${md(days[i]!)}: ${m ? `${m} min` : last ? "open" : "missed"}`)}"/>`;
  });
  out += `<text x="${cx}" y="${cy + 2}" text-anchor="middle" style="font-size:20px;font-weight:700;fill:var(--text)">${f1(sum(mins) / 60)} h</text><text x="${cx}" y="${cy + 18}" text-anchor="middle">30 days</text><text x="${cx}" y="${cy - r1 - 8}" text-anchor="middle">${md(days[0]!)}, then clockwise</text>`;
  const x0 = cx * 2 + 60,
    x1 = w - 60,
    wk = [0, 1, 2, 3].map((k) => sum(mins.slice(Math.max(0, n - 7 * (k + 1)), n - 7 * k))),
    x = lin(0, Math.max(...wk, 70), x0 + 90, x1);
  if (x1 - x0 > 160) {
    out += label(x0, 58, "Minutes per week");
    ["This week", "Last week", "2 weeks ago", "3 weeks ago"].forEach((l, k) => {
      const y = 84 + k * 42;
      out += `${lab(x0, y + 9, l, "var(--text-muted)")}<rect x="${x0 + 90}" y="${y}" width="${x1 - x0 - 90}" height="12" rx="4" fill="rgba(255,255,255,.05)"/><rect x="${x0 + 90}" y="${y}" width="${Math.max(0, x(wk[k]!) - x0 - 90)}" height="12" rx="4" fill="var(--c)" fill-opacity="${k ? 0.6 : 1}"/><text x="${x(wk[k]!) + 8}" y="${y + 10}" style="font-size:12px;font-weight:600;fill:var(--text)">${wk[k]}</text>`;
    });
  }
  const sat = mins.filter(Boolean);
  let streak = 0;
  for (let i = n - 2; i >= 0 && mins[i]; i--) streak++;
  if (mins[n - 1]) streak++;
  return { ...base, svg: svg(w, h, "Minutes meditated on each of the last 30 days, and minutes per week", out), reading: `Sat <b>${sat.length} of 30</b> days, <b>${Math.round(avg(sat))} min</b> on average. Streak <b>${streak}</b>.` };
}

function visualization(d: VizData, w: number): Built {
  const n = 30,
    days = Array.from({ length: n }, (_, i) => addDays(d.today, i - n + 1));
  const viv = new Map((d.series.vividness ?? []).map((e) => [e.day, e.value]));
  const did = new Map(d.goalDays.map((g) => [g.day, !!g.result]));
  const vals = days.map((day) => (viv.has(day) ? viv.get(day)! : did.get(day) ? 0 : null));
  const rewrites = (d.series.vision_rewrites ?? []).filter((e) => e.day >= days[0]!);
  const base = { title: "Vividness", empty: "Do one session and rate how vivid it was.", legend: [{ k: "var(--mind)", l: "Session vividness, 1 to 5 (bottom row: done but unrated, hollow: missed)", t: "dot" as const }, { k: "var(--text)", l: "7 day average", t: "line" as const }, { k: "var(--gold)", l: "Vision rewritten", t: "diamond" as const }] };
  if (!vals.some((v) => v !== null)) return { ...base, svg: null, reading: base.empty };
  const h = 240,
    P = { l: 70, r: 24, t: 24, b: 32 },
    x = lin(0, n - 1, P.l, w - P.r),
    y = lin(1, 5, h - P.b - 18, P.t);
  let out = [1, 2, 3, 4, 5].map((v) => `<line x1="${P.l}" x2="${w - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}"/><text x="${P.l - 10}" y="${y(v) + 3.5}" text-anchor="end">${v === 1 ? "1 faint" : v === 5 ? "5 vivid" : v}</text>`).join("");
  const rated = vals.map((v) => (v && v > 0 ? v : null));
  const roll = rated.map((_, i) => {
    const win = rated.slice(Math.max(0, i - 6), i + 1).filter((v): v is number => v !== null);
    return win.length ? avg(win) : null;
  });
  out += `<path d="${roll.map((v, i) => (v === null ? "" : `${i && roll[i - 1] !== null ? "L" : "M"}${x(i)} ${y(v)}`)).join("")}" fill="none" stroke="var(--text)" stroke-width="2.2"/>`;
  vals.forEach((v, i) => {
    out += v && v > 0
      ? `<circle cx="${x(i)}" cy="${y(v)}" r="4.5" fill="var(--ct)" data-tip="${esc(`${md(days[i]!)}: ${v} of 5`)}"/>`
      : v === 0
        ? `<circle cx="${x(i)}" cy="${h - P.b - 2}" r="3.5" fill="var(--ct)" data-tip="${esc(`${md(days[i]!)}: done, not rated`)}"/>`
        : `<circle cx="${x(i)}" cy="${h - P.b - 2}" r="3" fill="none" stroke="${MUTED}" data-tip="${esc(`${md(days[i]!)}: ${i === n - 1 ? "open" : "missed"}`)}"/>`;
  });
  out += `<text x="${P.l - 10}" y="${h - P.b + 1}" text-anchor="end">Unrated</text>`;
  rewrites.forEach((r) => {
    const rx = x(daysBetween(days[0]!, r.day));
    out += `<path d="${diamond(rx, P.t - 10, 6)}" fill="var(--gold)"/>${lab(rx + 10, P.t - 6, "Vision rewritten", "var(--gold)")}`;
  });
  out += `<text x="${P.l}" y="${h - 6}">${md(days[0]!)}</text><text x="${w - P.r}" y="${h - 6}" text-anchor="end">Today</text>`;
  const done = vals.filter((v) => v !== null).length,
    first = rated.slice(0, 7).filter((v): v is number => v !== null),
    lastWk = rated.slice(-7).filter((v): v is number => v !== null);
  return { ...base, svg: svg(w, h, "Visualization sessions and vividness over 30 days", out), reading: `<b>${done} of 30</b> days.${lastWk.length ? ` Vividness averages <b>${f1(avg(lastWk))}</b> this week${first.length && rated.length > 7 ? `, ${avg(lastWk) >= avg(first) ? "up" : "down"} from ${f1(avg(first))}` : ""}.` : " Rate a session to track vividness."}` };
}

const LIFTS: [string, string][] = [
  ["bench_1rm", "Bench"],
  ["squat_1rm", "Squat"],
  ["deadlift_1rm", "Deadlift"],
];
function strength(d: VizData, w: number, focus = "bench_1rm"): Built {
  const n = 12,
    starts = weeks(d.today, n);
  const lines = LIFTS.map(([k, name]) => {
    let carry: number | null = null;
    const v = starts.map((s) => {
      const inW = (d.series[k] ?? []).filter((e) => inWeek(e.day, s)).map((e) => e.value);
      if (inW.length) carry = Math.max(...inW);
      return carry;
    });
    const before = (d.series[k] ?? []).filter((e) => e.day < starts[0]!).map((e) => e.value);
    return { k, name, v: v.map((x) => x ?? (before.length ? Math.max(...before) : null)) };
  }).filter((l) => l.v.some((x) => x !== null));
  const base = { title: "Lifts", empty: "Log a top set, or connect Lyfta. Each lift gets its own line.", legend: [{ k: "var(--athletics)", l: "Selected lift, estimated 1 rep max", t: "line" as const }, { k: MUTED, l: "Other lifts", t: "line" as const }, { k: "var(--gold)", l: "A step on your list, or a PR", t: "dash" as const }] };
  if (!lines.length) return { ...base, svg: null, reading: base.empty };
  const sel = lines.find((l) => l.k === focus) ?? lines[0]!;
  const selBest = Math.max(...sel.v.filter((p): p is number => p !== null));
  // The last target reached and the next two ahead; more rules than that crowd the chart.
  const allGoals = d.targets.filter((t) => t.key === sel.k).sort((a, b) => a.value - b.value);
  const goals = [...allGoals.filter((g) => g.value <= selBest).slice(-1), ...allGoals.filter((g) => g.value > selBest).slice(0, 2)];
  const h = 270,
    P = { l: 48, r: 110, t: 18, b: 30 };
  const all = lines.flatMap((l) => l.v.filter((x): x is number => x !== null)).concat(goals.map((g) => g.value));
  const lo = Math.floor((Math.min(...all) - 15) / 50) * 50,
    hi = Math.ceil((Math.max(...all) + 10) / 50) * 50;
  const y = lin(lo, hi, h - P.b, P.t),
    x = lin(0, n - 1, P.l, w - P.r);
  let out = gridY(P.l, w - P.r, y, Array.from({ length: (hi - lo) / 50 + 1 }, (_, k) => lo + k * 50));
  const path = (v: (number | null)[]) => v.map((p, i) => (p === null ? "" : `${i && v[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`)).join("");
  for (const l of lines) {
    if (l === sel) continue;
    const lv = l.v.at(-1);
    out += `<path d="${path(l.v)}" fill="none" stroke="${MUTED}" stroke-width="1.6"/>`;
    if (lv != null) out += lab(x(n - 1) + 10, y(lv) + 4, `${l.name} ${Math.round(lv)}`, "var(--text-muted)");
  }
  const best = Math.max(...sel.v.filter((p): p is number => p !== null));
  for (const g of goals) {
    const reached = best >= g.value;
    out += `<line x1="${P.l}" x2="${w - P.r}" y1="${y(g.value)}" y2="${y(g.value)}" stroke="var(--gold)" stroke-dasharray="5 5" stroke-opacity="${reached ? 0.45 : 0.85}"/>${lab(P.l + 6, y(g.value) - 6, `${sel.name} ${g.value}${reached ? ", reached" : ""}`, "var(--gold)")}`;
  }
  out += `<path d="${path(sel.v)}" fill="none" stroke="var(--ct)" stroke-width="2.6" stroke-linejoin="round"/>`;
  let top = 0;
  sel.v.forEach((p, i) => {
    if (p === null) return;
    const pr = p > top && i > 0 && top > 0;
    top = Math.max(top, p);
    out += `<circle cx="${x(i)}" cy="${y(p)}" r="${pr ? 4.5 : 3}" fill="${pr ? "var(--gold)" : "var(--ct)"}" data-tip="${esc(`Week of ${md(starts[i]!)}: ${sel.name} ${Math.round(p)}${pr ? ", PR" : ""}`)}"/>`;
  });
  const lastSel = sel.v.at(-1);
  if (lastSel != null) out += lab(x(n - 1) + 10, y(lastSel) + 4, `${sel.name} ${Math.round(lastSel)}`, "var(--ct)", "start", 'style="font-size:13px;fill:var(--ct)"');
  out += `<text x="${P.l}" y="${h - 8}">12 weeks ago</text><text x="${w - P.r}" y="${h - 8}" text-anchor="end">This week</text>`;
  const nextGoal = goals.filter((g) => g.value > best).sort((a, b) => a.value - b.value)[0];
  const reachedGoal = goals.filter((g) => g.value <= best).sort((a, b) => b.value - a.value)[0];
  return {
    ...base,
    svg: svg(w, h, `${sel.name} estimated one rep max over 12 weeks`, out),
    reading: `${sel.name} <b>${Math.round(best)}</b> estimated max${reachedGoal ? `, ${Math.round(best - reachedGoal.value)} past ${reachedGoal.value}` : ""}${nextGoal ? ` and ${Math.round(nextGoal.value - best)} from ${nextGoal.value}` : ""}.${lines
      .filter((l) => l !== sel)
      .map((l) => ` ${l.name} ${Math.round(Math.max(...l.v.filter((p): p is number => p !== null)))}.`)
      .join("")}`,
  };
}

function running(d: VizData, w: number): Built {
  const past = 8,
    starts = weeks(d.today, past);
  const miles = starts.map((s) => sum((d.series.run_mi ?? []).filter((e) => inWeek(e.day, s)).map((e) => e.value)));
  const longs = starts.map((s) => {
    const r = (d.series.long_run_mi ?? []).concat(d.series.run_mi ?? []).filter((e) => inWeek(e.day, s)).map((e) => e.value);
    return r.length ? Math.max(...r) : 0;
  });
  const raceWeeks = d.race ? Math.max(0, Math.ceil(daysBetween(d.today, d.race.date) / 7)) : 0;
  const ahead = Math.min(raceWeeks, 16);
  // Suggested ramp: 10% a week from this week's miles to a peak three weeks out, then a taper.
  const baseMi = Math.max(miles.at(-1) ?? 0, 8);
  const plan = Array.from({ length: ahead }, (_, i) => {
    const toPeak = ahead - 3;
    if (i < toPeak) return Math.round(baseMi * Math.pow(1.1, i + 1) * 10) / 10;
    const peak = baseMi * Math.pow(1.1, Math.max(0, toPeak));
    return Math.round(peak * (i === ahead - 1 ? 0.5 : 0.75) * 10) / 10;
  });
  const base = { title: d.race ? `Build to ${md(d.race.date)}` : "Weekly miles", empty: "Log a run. The weeks fill in, and a race date in Settings draws the build ahead.", legend: [{ k: "var(--athletics)", l: "Miles run" }, { k: "rgba(255,255,255,.18)", l: "Suggested ramp, 10% a week" }, { k: "var(--text)", l: "Longest run", t: "line" as const }, ...(d.race ? [{ k: "var(--gold)", l: "Race", t: "diamond" as const }] : [])] };
  if (!miles.some(Boolean) && !longs.some(Boolean)) return { ...base, svg: null, reading: base.empty };
  const n = past + ahead,
    h = 260,
    P = { l: 44, r: 20, t: 30, b: 30 },
    top = Math.max(10, Math.ceil((Math.max(...miles, ...plan, 13.1) + 4) / 5) * 5);
  const y = lin(0, top, h - P.b, P.t),
    bw = (w - P.l - P.r) / n,
    cur = past - 1;
  let out = gridY(P.l, w - P.r, y, [0, Math.round(top / 2), top], (v) => `${v} mi`);
  miles.forEach((m, i) => (out += `<path d="${topBar(P.l + i * bw + bw * 0.16, y(m), bw * 0.68, y(0) - y(m))}" fill="var(--c)" fill-opacity="${i === cur ? 1 : 0.75}" data-tip="${esc(`Week of ${md(starts[i]!)}: ${f1(m)} mi, longest ${f1(longs[i]!)}`)}"/>`));
  plan.forEach((p, k) => {
    const i = past + k,
      race = k === ahead - 1 && d.race;
    out += `<path d="${topBar(P.l + i * bw + bw * 0.16 + 0.5, y(p), bw * 0.68 - 1, y(0) - y(p))}" fill="${race ? "rgba(212,175,55,.08)" : "rgba(255,255,255,.035)"}" stroke="${race ? "var(--gold)" : "rgba(255,255,255,.18)"}" stroke-dasharray="${race ? 0 : "3 3"}" data-tip="${esc(`Week of ${md(addDays(starts[cur]!, (k + 1) * 7))}: ${f1(p)} mi suggested`)}"/>`;
  });
  const lx = (i: number) => P.l + i * bw + bw / 2;
  out += `<path d="${longs.map((v, i) => `${i ? "L" : "M"}${lx(i)} ${y(v)}`).join("")}" fill="none" stroke="var(--text)" stroke-width="2"/>${longs.map((v, i) => `<circle cx="${lx(i)}" cy="${y(v)}" r="3" fill="var(--text)"/>`).join("")}`;
  if (d.race && ahead) out += `<path d="${diamond(lx(n - 1), P.t - 14, 6)}" fill="var(--gold)"/>${lab(lx(n - 1), P.t - 22, d.race.label, "var(--gold)", "end")}`;
  out += lab(lx(cur), y(miles[cur]!) - 10, f1(miles[cur]!), "var(--ct)", "middle");
  out += `<text x="${P.l}" y="${h - 8}">${md(starts[0]!)}</text><text x="${lx(cur)}" y="${h - 8}" text-anchor="middle">This week</text>${ahead ? `<text x="${w - P.r}" y="${h - 8}" text-anchor="end">${md(d.race!.date)}</text>` : ""}`;
  return { ...base, svg: svg(w, h, "Weekly miles, longest run, and a suggested ramp to race day", out), reading: `<b>${f1(miles[cur]!)} mi</b> this week, longest run ${f1(longs[cur]!)} mi.${d.race ? ` <b>${raceWeeks} weeks</b> to ${esc(d.race.label)}.` : " Add the race date in Settings to see the build ahead."}` };
}

const hm = (m: number) => {
  m = (((m + 720) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
};
function sleep(d: VizData, w: number): Built {
  const nights = d.nights;
  const base = { title: "Sleep window", empty: "Tap Going to sleep tonight and Awake in the morning. Each night becomes a bar.", legend: [{ k: "var(--athletics)", l: "In bed, inside the window" }, { k: OFF, l: "In bed, outside the window" }, { k: "var(--gold)", l: "Lights-out anchor", t: "line" as const }] };
  if (!nights.length) return { ...base, svg: null, reading: base.empty };
  const rowH = 20,
    lw = 62,
    rw = 54,
    x = lin(540, 1440, lw, w - rw),
    h = nights.length * rowH + 36;
  let out = [540, 720, 900, 1080, 1260, 1440].map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${nights.length * rowH}" stroke="${GRID}"/><text x="${x(t)}" y="${h - 10}" text-anchor="middle">${hm(t)}</text>`).join("");
  nights.forEach((n, i) => {
    const y = i * rowH + 4,
      wake = n.bedtime + n.hours * 60;
    out += `<text x="0" y="${y + 9}" style="font-family:var(--font-sans);font-weight:600;fill:${i === nights.length - 1 ? "var(--text)" : "var(--text-muted)"}">${esc(`${wd(n.day)} ${dt(n.day).getUTCDate()}`)}</text>`;
    out += `<rect x="${x(Math.max(540, n.bedtime))}" y="${y}" width="${Math.max(2, x(Math.min(1440, wake)) - x(Math.max(540, n.bedtime)))}" height="12" rx="4" fill="${n.inWindow ? "var(--c)" : OFF}" data-tip="${esc(`Night of ${md(n.day)}: ${hm(n.bedtime)} to ${hm(wake)}, ${f1(n.hours)} h${n.inWindow ? "" : ", outside the window"}`)}"/>`;
    out += `<line x1="${x(n.anchor)}" x2="${x(n.anchor)}" y1="${y - 3}" y2="${y + 15}" stroke="var(--gold)" stroke-width="2"/><text x="${w}" y="${y + 10}" text-anchor="end" style="font-size:12px;font-weight:600;fill:var(--text)">${f1(n.hours)} h</text>`;
  });
  const ok = nights.filter((n) => n.inWindow).length;
  return { ...base, svg: svg(w, h, `Bedtime and wake time for ${nights.length} nights against the lights-out anchor`, out), reading: `<b>${f1(avg(nights.map((n) => n.hours)))} h</b> on average over ${nights.length} night${nights.length === 1 ? "" : "s"}. In window <b>${ok} of ${nights.length}</b>. Tonight's anchor is <b>${hm(nights.at(-1)!.anchor)}</b>.` };
}

function triathlon(d: VizData, w: number): Built {
  const starts = weeks(d.today, 12);
  const wk = (key: string, f = 1) => starts.map((s) => sum((d.series[key] ?? []).filter((e) => inWeek(e.day, s)).map((e) => e.value)) * f);
  const swim = wk("swim_min"),
    bike = wk("bike_min"),
    run = wk("run_mi", 9.5);
  const base = { title: "Three disciplines", empty: "Log a swim, ride or run. Runs count from Running at about 9.5 minutes a mile.", legend: [{ k: "var(--athletics)", l: "Run (estimated from miles)" }, { k: "rgba(242,95,102,.5)", l: "Ride" }, { k: "rgba(255,255,255,.4)", l: "Swim" }] };
  if (![...swim, ...bike, ...run].some(Boolean)) return { ...base, svg: null, reading: base.empty };
  const h = 220,
    P = { l: 48, r: 16, t: 14, b: 28 },
    top = Math.max(60, Math.ceil(Math.max(...starts.map((_, i) => swim[i]! + bike[i]! + run[i]!)) / 60) * 60);
  const y = lin(0, top, h - P.b, P.t),
    bw = (w - P.l - P.r) / 12;
  let out = gridY(P.l, w - P.r, y, [0, top / 2, top], (v) => `${v} m`);
  starts.forEach((s, i) => {
    const x = P.l + i * bw + bw * 0.2;
    let acc = 0;
    for (const [v, c] of [
      [swim[i]!, "rgba(255,255,255,.4)"],
      [bike[i]!, "rgba(242,95,102,.5)"],
      [run[i]!, "var(--c)"],
    ] as const) {
      if (!v) continue;
      out += `<rect x="${x}" y="${y(acc + v)}" width="${bw * 0.6}" height="${y(acc) - y(acc + v)}" fill="${c}"/>`;
      acc += v;
    }
    out += hit(x, P.t, bw * 0.6, h - P.t - P.b, `Week of ${md(s)}: swim ${Math.round(swim[i]!)}, ride ${Math.round(bike[i]!)}, run about ${Math.round(run[i]!)} min`);
  });
  out += `<text x="${P.l}" y="${h - 8}">12 weeks ago</text><text x="${w - P.r}" y="${h - 8}" text-anchor="end">This week</text>`;
  return { ...base, svg: svg(w, h, "Weekly minutes by discipline for 12 weeks", out), reading: `This week: swim <b>${Math.round(swim[11]!)}</b>, ride <b>${Math.round(bike[11]!)}</b>, run about <b>${Math.round(run[11]!)}</b> minutes.` };
}

function food(d: VizData, w: number): Built {
  const f = d.food;
  const base = { title: "Fuel", empty: "Snap a meal or enter calories and protein. Fourteen days draw against your targets.", legend: [{ k: "var(--nutrition)", l: "On target" }, { k: OFF, l: "Off target" }, { k: "rgba(255,255,255,.08)", l: "Calorie range" }, { k: "var(--text)", l: "Protein target", t: "dash" as const }] };
  if (!f || !f.days.length) return { ...base, svg: null, reading: base.empty };
  const days = Array.from({ length: 14 }, (_, i) => addDays(d.today, i - 13)),
    by = new Map(f.days.map((x) => [x.day, x]));
  const cal = days.map((x) => by.get(x)?.calories ?? null),
    pro = days.map((x) => by.get(x)?.protein ?? null);
  const lo = f.calories * (1 - f.tolerancePct / 100),
    hiC = f.calories * (1 + f.tolerancePct / 100);
  const P = { l: 60, r: 16 },
    n = 14,
    bw = (w - P.l - P.r) / n,
    cx = (i: number) => P.l + i * bw + bw / 2;
  const cmax = Math.max(hiC * 1.15, ...cal.filter((c): c is number => c !== null)),
    y1 = lin(0, cmax, 120, 16);
  let out = label(0, 10, "Calories") + gridY(P.l, w - P.r, y1, [0, Math.round(cmax / 2 / 100) * 100, Math.round(cmax / 100) * 100], comma);
  out += `<rect x="${P.l}" y="${y1(hiC)}" width="${w - P.l - P.r}" height="${y1(lo) - y1(hiC)}" fill="rgba(255,255,255,.06)"/><text x="${w - P.r - 4}" y="${y1(hiC) - 5}" text-anchor="end">Range ${comma(lo)} to ${comma(hiC)}</text>`;
  out += `<path d="${cal.map((c, i) => (c === null ? "" : `${i && cal[i - 1] !== null ? "L" : "M"}${cx(i)} ${y1(c)}`)).join("")}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.5"/>`;
  cal.forEach((c, i) => {
    if (c === null) return;
    const ok = c >= lo && c <= hiC,
      today = i === n - 1;
    out += `<circle cx="${cx(i)}" cy="${y1(c)}" r="4.5" fill="${today ? "none" : ok ? "var(--c)" : OFF}" stroke="${today ? "var(--text)" : "none"}" stroke-dasharray="${today ? "2 2" : 0}" data-tip="${esc(`${md(days[i]!)}: ${comma(c)} kcal${today ? " so far" : ""}`)}"/>`;
  });
  const t2 = 150,
    pmax = Math.max(f.proteinG * 1.25, ...pro.filter((p): p is number => p !== null)),
    y2 = lin(0, pmax, t2 + 100, t2 + 6);
  out += label(0, t2, "Protein") + gridY(P.l, w - P.r, y2, [0, Math.round(pmax / 2), Math.round(pmax)], (v) => `${v} g`);
  pro.forEach((p, i) => {
    if (p === null) return;
    const today = i === n - 1;
    out += `<path d="${topBar(P.l + i * bw + bw * 0.2, y2(p), bw * 0.6, y2(0) - y2(p))}" fill="${today ? "rgba(255,255,255,.14)" : p >= f.proteinG ? "var(--c)" : OFF}" data-tip="${esc(`${md(days[i]!)}: ${Math.round(p)} g${today ? " so far" : ""}`)}"/>`;
  });
  out += `<line x1="${P.l}" x2="${w - P.r}" y1="${y2(f.proteinG)}" y2="${y2(f.proteinG)}" stroke="var(--text)" stroke-dasharray="4 4"/><text x="${w - P.r - 4}" y="${y2(f.proteinG) - 5}" text-anchor="end" style="fill:var(--text)">${f.proteinG} g</text>`;
  out += `<text x="${P.l}" y="${t2 + 120}">${md(days[0]!)}</text><text x="${w - P.r}" y="${t2 + 120}" text-anchor="end">Today</text>`;
  const closed = days.slice(0, -1).map((x) => by.get(x)).filter((x): x is NonNullable<typeof x> => !!x);
  const pOk = closed.filter((x) => x.protein >= f.proteinG).length,
    cOk = closed.filter((x) => x.calories >= lo && x.calories <= hiC).length,
    td = by.get(d.today);
  return { ...base, svg: svg(w, t2 + 126, "Calories against the range and protein against the target for 14 days", out), reading: `Protein hit <b>${pOk} of ${closed.length}</b> logged days, calories in range <b>${cOk} of ${closed.length}</b>.${td ? ` Today so far: ${comma(td.calories)} kcal and ${Math.round(td.protein)} g protein.` : ""}` };
}

function gutHealth(d: VizData, w: number): Built {
  const n = 28,
    days = Array.from({ length: n }, (_, i) => addDays(d.today, i - n + 1));
  const kept = new Set((d.series.gut_habit ?? []).map((e) => `${e.day}|${String(e.meta?.habit ?? "")}`));
  const rating = new Map((d.series.gut_rating ?? []).map((e) => [e.day, e.value]));
  const habits = d.habits;
  const base = { title: "Habit grid", empty: "Check off today's habits below. The grid fills in a day at a time.", legend: [{ k: "var(--nutrition)", l: "Done" }, { k: "rgba(255,255,255,.05)", l: "Not done" }, { k: "rgba(47,199,121,.45)", l: "Gut rating, brighter is better" }] };
  if (!kept.size && !rating.size) return { ...base, svg: null, reading: base.empty };
  const lw = 120,
    rw = 64,
    gap = 3,
    wk = 8,
    cs = Math.max(10, Math.min(26, Math.floor((w - lw - rw - wk * 3) / n) - gap));
  const cx = (i: number) => lw + i * (cs + gap) + Math.floor(i / 7) * wk;
  const rows = [...habits.map((hb) => ({ name: hb, kind: "habit" as const })), { name: "Gut rating", kind: "rating" as const }];
  let out = "";
  rows.forEach((row, r) => {
    const y = r * (cs + 8);
    out += lab(0, y + cs / 2 + 4, row.name, "var(--text-muted)");
    let count = 0;
    days.forEach((day, i) => {
      if (row.kind === "habit") {
        const on = kept.has(`${day}|${row.name}`);
        if (on) count++;
        out += `<rect x="${cx(i)}" y="${y}" width="${cs}" height="${cs}" rx="4" fill="${on ? "var(--c)" : "rgba(255,255,255,.05)"}" fill-opacity="${on ? 0.9 : 1}" data-tip="${esc(`${md(day)}, ${row.name}: ${on ? "done" : "not done"}`)}"/>`;
      } else {
        const v = rating.get(day);
        if (v !== undefined) count++;
        out += `<rect x="${cx(i)}" y="${y}" width="${cs}" height="${cs}" rx="4" fill="${v === undefined ? "rgba(255,255,255,.05)" : "var(--c)"}" fill-opacity="${v === undefined ? 1 : (0.15 + (v / 5) * 0.75).toFixed(2)}" data-tip="${esc(`${md(day)}: ${v === undefined ? "no rating" : `rated ${v} of 5`}`)}"/>`;
      }
    });
    out += `<text x="${w}" y="${y + cs / 2 + 4}" text-anchor="end" style="font-size:12px;font-weight:600;fill:var(--text)">${count}/${n}</text>`;
  });
  const by = rows.length * (cs + 8) + 12;
  [0, 7, 14, 21].forEach((i) => (out += `<text x="${cx(i)}" y="${by}">${md(days[i]!)}</text>`));
  const totals = habits.map((hb) => days.filter((day) => kept.has(`${day}|${hb}`)).length);
  const best = totals.indexOf(Math.max(...totals)),
    worst = totals.indexOf(Math.min(...totals));
  return { ...base, svg: svg(w, by + 6, "Gut habits and rating over 28 days", out), reading: kept.size ? `${esc(habits[best])} is steady, <b>${totals[best]} of 28</b>. ${esc(habits[worst])} is the gap, <b>${totals[worst]} of 28</b>.` : `Rated <b>${rating.size}</b> days. Check off habits to see which ones hold.` };
}

const BUILDERS: Record<string, (d: VizData, w: number, focus?: string) => Built> = {
  "ai-building": aiBuilding,
  dropshipping,
  academics,
  reading,
  "college-integration": collegeIntegration,
  "time-blocking": timeBlocking,
  chess,
  meditation,
  visualization,
  strength,
  running,
  sleep,
  triathlon,
  food,
  "gut-health": gutHealth,
};

export function buildViz(d: VizData, w: number, focus?: string): Built | null {
  const b = BUILDERS[d.slug];
  return b ? b(d, w, focus) : null;
}
export const LIFT_KEYS = LIFTS;

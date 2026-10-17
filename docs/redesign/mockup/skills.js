/* FORGE mockup: categories, skills, sample month, and one precise visualization per skill.
   Every chart uses one scale, labels its marks directly, and states its reading in one line above it. */
(() => {
  function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const rnd = mulberry32(17102026);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const comma = (n) => Math.round(n).toLocaleString("en-US");
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : 0);
  const MUTED = "#5d6072", GRID = "rgba(255,255,255,.06)", INK = "var(--ink)";
  const TODAY = new Date(2026, 9, 17); // Saturday 17 October 2026, the 4 AM day
  const day = (offset) => { const d = new Date(TODAY); d.setDate(d.getDate() + offset); return d; };
  const md = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const wd = (d) => d.toLocaleDateString("en-US", { weekday: "short" });
  const svg = (w, h, label, inner) => `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
  const gridY = (x0, x1, y, ticks, fmt = (v) => v) => ticks.map((t) => `<line x1="${x0}" x2="${x1}" y1="${y(t)}" y2="${y(t)}" stroke="${GRID}"/><text x="${x0 - 8}" y="${y(t) + 3.5}" text-anchor="end">${fmt(t)}</text>`).join("");
  const topBar = (x, y, w, h, r = 3) => { if (h <= 0) return ""; r = Math.min(r, h, w / 2); return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`; };
  const hit = (x, y, w, h, tip) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent" data-tip="${esc(tip)}"/>`;
  const diamond = (x, y, s) => `M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z`;

  // ---------------------------------------------------------------- icons (Lucide, 24 grid)
  const ICONS = {
    business: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    school: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    athletics: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
    mind: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
    nutrition: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    "ai-building": '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    dropshipping: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    academics: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    reading: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    "college-integration": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    "time-blocking": '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h3M8 18h6"/>',
    chess: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zM5 20h14"/>',
    meditation: '<path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z"/>',
    visualization: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    strength: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
    running: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    sleep: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    triathlon: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2"/>',
    food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    "gut-health": '<path d="M7 20c-2.2 0-4-1.8-4-4 0-3 3-4 3-7a3 3 0 0 1 6 0c0 2-2 2.5-2 4.5a2.5 2.5 0 0 0 5 0V9a4 4 0 0 1 8 0v7a4 4 0 0 1-4 4Z"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    home: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    review: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    journal: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ICONS.target}</svg>`;

  // ---------------------------------------------------------------- categories and the statue
  // Fixed chart order: Business, School, Athletics, Mind, Nutrition (School and Mind never touch).
  const CATS = [
    { id: "business", name: "Business", port: [0.335, 0.33], regions: ["larm"] },
    { id: "school", name: "School", port: [0.665, 0.33], regions: ["rarm"] },
    { id: "athletics", name: "Athletics", port: [0.445, 0.64], regions: ["core", "lleg"] },
    { id: "mind", name: "Mind", port: [0.5, 0.1], regions: ["head"] },
    { id: "nutrition", name: "Nutrition", port: [0.555, 0.64], regions: ["chest", "rleg"] },
  ];
  const REGIONS = {
    head: [[0.38, 0], [0.62, 0], [0.62, 0.215], [0.38, 0.215]],
    larm: [[0.18, 0.2], [0.405, 0.2], [0.405, 0.3], [0.39, 0.45], [0.37, 0.64], [0.18, 0.64]],
    rarm: [[0.595, 0.2], [0.82, 0.2], [0.82, 0.64], [0.63, 0.64], [0.61, 0.45], [0.595, 0.3]],
    chest: [[0.405, 0.2], [0.595, 0.2], [0.595, 0.3], [0.6, 0.37], [0.4, 0.37], [0.405, 0.3]],
    core: [[0.4, 0.37], [0.6, 0.37], [0.63, 0.53], [0.37, 0.53]],
    lleg: [[0.28, 0.53], [0.5, 0.53], [0.5, 1], [0.28, 1]],
    rleg: [[0.5, 0.53], [0.72, 0.53], [0.72, 1], [0.5, 1]],
  };
  const TIERS = [
    { n: 1, num: "I", name: "Raw", reach: 0, aura: 0.12, at: 0 },
    { n: 2, num: "II", name: "Awakened", reach: 30, aura: 0.3, at: 20 },
    { n: 3, num: "III", name: "Forged", reach: 58, aura: 0.5, at: 40 },
    { n: 4, num: "IV", name: "Ascendant", reach: 92, aura: 0.75, at: 60 },
    { n: 5, num: "V", name: "Sovereign", reach: 160, aura: 1, at: 80 },
  ];

  // ---------------------------------------------------------------- goals and steps (sample month)
  const g = (title, standard, o = {}) => ({ title, standard, floor: o.floor || "", stretch: o.stretch || "", mins: o.mins || null, days: o.days || [0, 1, 2, 3, 4, 5, 6], today: o.today || null, result: o.result || null, progress: o.progress, note: o.note || "" });
  const s = (title, size, done, note = "") => ({ title, size, done, note });
  const SKILLS = [
    { slug: "ai-building", name: "AI Building", cat: "business", score: 41, rack: false,
      identity: "I build real products with AI, fast.",
      goals: [g("Build session", "45 min ending in a commit", { floor: "15 min, one small change", stretch: "90 min ending in a deploy", mins: { floor: 15, standard: 45, stretch: 90 }, days: [1, 2, 3, 4, 5] })],
      steps: [s("Finish CS50P and the UPenn AI certificate", "M", true), s("Deploy a project publicly", "M", true), s("Use FORGE 14 days straight", "M", false, "Day 6 of 14"), s("AI product-research pipeline that scores products", "L", false), s("An AI-built product earns its first dollar", "L", false)] },
    { slug: "dropshipping", name: "Dropshipping", cat: "business", score: 52, rack: true,
      identity: "I run a store that makes money.",
      goals: [g("Store work", "40 min on the store", { floor: "10 min, one teardown or product idea", stretch: "Launch or test one product", mins: { floor: 10, standard: 40, stretch: 60 }, today: "Rack", progress: 25 })],
      steps: [s("One-page model: margins, ad cost per sale, returns", "S", true), s("10 store teardowns logged", "S", true, "10 of 10"), s("Niche picked, 5 products validated", "M", true), s("Store live with 3 products", "M", true), s("First ad test with tracked results", "M", false), s("$1,000 total revenue", "L", false, "$2,965 so far, auto-claims at $1,000")] },
    { slug: "academics", name: "Academics", cat: "school", score: 40, rack: true,
      identity: "I do the work early and walk into exams ready.",
      goals: [g("Deep study block", "75 min on the hardest open assignment", { floor: "20 min started", stretch: "Assignment finished", mins: { floor: 20, standard: 75, stretch: 120 }, today: "Rack", result: "floor", note: "Today: MATH 1210 Problem set 6" })],
      steps: [s("Every syllabus read, all dates in FORGE", "S", true), s("Two weeks with nothing late or last-minute", "M", false, "Day 9 of 14"), s("First semester GPA 3.7 or higher", "L", false)] },
    { slug: "reading", name: "Reading", cat: "school", score: 30, rack: false,
      identity: "I read every day and remember what I read.",
      goals: [g("Read", "25 pages", { floor: "5 pages", stretch: "50 pages", days: [0, 1, 2, 3, 4, 5, 6] })],
      steps: [s("Baseline reading test", "S", true), s("5 books finished", "M", false, "2 of 5"), s("Effective rate +10% over baseline", "M", true), s("Effective rate +20%", "L", false, "+16% now")] },
    { slug: "college-integration", name: "College Integration", cat: "school", score: 35, rack: false,
      identity: "I know people in every room I walk into.",
      goals: [g("Connect", "One real conversation outside class", { floor: "Say hi to someone new", stretch: "Office hours or a club event", days: [1, 2, 3, 4, 5] })],
      steps: [s("Office hours with every professor once", "M", false, "2 of 3"), s("Join two organizations", "S", true), s("3 conversations outside class with one professor", "L", false)] },
    { slug: "time-blocking", name: "Time Blocking", cat: "mind", score: 49, rack: true,
      identity: "My day is planned before it starts.",
      goals: [g("Plan tomorrow", "Tomorrow fully blocked before bed", { floor: "Top three tasks written", stretch: "Blocked, plus one fix from today", mins: { floor: 5, standard: 10, stretch: 15 }, today: "Rack" })],
      steps: [s("7 nights in a row planned", "M", true), s("14 days at 70% adherence", "M", false, "Day 11 of 14"), s("30 nights planned at 85%", "L", false)] },
    { slug: "chess", name: "Chess", cat: "mind", score: 41, rack: false,
      identity: "I calculate before I move.",
      goals: [g("Chess training", "20 min of puzzles or one reviewed game", { floor: "10 puzzles", stretch: "A rated game, reviewed", days: [0, 2, 4, 6] })],
      steps: [s("Baseline rating recorded", "S", true), s("Rapid 1100", "M", false, "1086 now"), s("Rapid 1200", "M", false), s("Rapid 1300", "L", false)] },
    { slug: "meditation", name: "Meditation", cat: "mind", score: 51, rack: false,
      identity: "I can sit with my own head.",
      goals: [g("Sit", "10 min", { floor: "3 min", stretch: "20 min" })],
      steps: [s("First 7 days", "M", true), s("30 days at 85%", "M", false, "26 of 30"), s("60 days at 85%", "L", false)] },
    { slug: "visualization", name: "Visualization", cat: "mind", score: 33, rack: false,
      identity: "I have already seen the day go well.",
      goals: [g("Visualize", "5 min on the vision, rate vividness", { floor: "1 min", stretch: "10 min plus one written line" })],
      steps: [s("First 7 days", "M", true), s("30 days at 85%", "M", false, "21 of 30"), s("Rewrite the vision for the quarter", "S", false)] },
    { slug: "strength", name: "Strength", cat: "athletics", score: 58, rack: true,
      identity: "I train like an athlete, six days a week.",
      goals: [g("Training session", "Full planned session logged", { floor: "Main lift plus one accessory", stretch: "Full session plus a PR attempt", mins: { floor: 25, standard: 75, stretch: 90 }, days: [1, 2, 3, 4, 5, 6], today: "Rack", result: "standard" }),
        g("PR attempt", "Bench single at 250", { days: [6], today: "Stretch" })],
      steps: [s("Bench 225", "M", true), s("Squat 315", "M", false, "305 e1RM"), s("4 straight weeks of 6 sessions", "S", false, "Week 3 of 4"), s("Bench 255", "M", false), s("190 lb lean bodyweight", "M", false, "184.2 now")] },
    { slug: "running", name: "Running", cat: "athletics", score: 49, rack: true,
      identity: "I run the half marathon on January 9 and finish strong.",
      goals: [g("Planned run", "The run on the plan", { floor: "20 min easy", stretch: "Plan plus strides", days: [2, 4, 6], today: "Rack", result: "standard", note: "Today: long run, 7 mi easy" })],
      steps: [s("First 10 mile week", "S", true), s("Long run 10 mi", "M", false, "7 mi so far"), s("Finish the half marathon", "L", false), s("Half marathon under 1:50", "L", false)] },
    { slug: "sleep", name: "Sleep and Recovery", cat: "athletics", score: 57, rack: false,
      identity: "I protect sleep like training.",
      goals: [g("Sleep window", "Screens off and in bed at the anchor", { floor: "In bed within 30 min of the anchor", stretch: "Anchor kept, 8 h in bed", today: "Balance" })],
      steps: [s("Anchor reached 1:30", "M", true), s("14 nights in window", "M", false, "9 of 14"), s("Anchor reached 00:45", "L", false)] },
    { slug: "triathlon", name: "Triathlon", cat: "athletics", score: null, rack: false, dormant: true,
      identity: "",
      goals: [], steps: [s("Swim 1,500 m continuous", "M", false), s("First sprint triathlon", "L", false)] },
    { slug: "food", name: "Food", cat: "nutrition", score: 42, rack: false,
      identity: "I eat like I train.",
      goals: [g("Fuel", "Hit protein, calories in range", { floor: "Protein at every meal", stretch: "All meals logged by photo" })],
      steps: [s("Two weeks of every meal logged", "M", true), s("Protein target 10 days in a row", "M", false, "6 in a row"), s("Bodyweight 190 lean", "L", false)] },
    { slug: "gut-health", name: "Gut Health", cat: "nutrition", score: 29, rack: false,
      identity: "My gut is an asset, not a problem.",
      goals: [g("Gut habits", "38 g fiber, one fermented food, water 3 L", { floor: "Water 3 L", stretch: "All of it, plus no late snack", today: "Balance", result: "standard" })],
      steps: [s("Find the trigger foods", "M", false, "2 found"), s("Fermented food 5 days a week for a month", "M", false)] },
  ];
  const SIZE_PTS = { S: 5, M: 10, L: 20 };

  // ---------------------------------------------------------------- the visualizations
  const VIZ = {};

  VIZ["ai-building"] = {
    title: "Ship log", sample() {
      const mins = Array.from({ length: 26 }, (_, i) => Array.from({ length: 7 }, (_, j) => {
        if (i === 25 && j > 5) return null; // Sunday has not happened yet
        const p = 0.3 + (i / 26) * 0.5;
        return rnd() < p ? pick([15, 45, 45, 45, 90]) : 0;
      }));
      return { mins, ships: [{ w: 4, t: "CS50P final project" }, { w: 11, t: "repoman on Vercel" }, { w: 19, t: "Product scorer script" }, { w: 24, t: "FORGE v1" }] };
    },
    takeaway(d) {
      const last8 = d.mins.slice(-8).flat().filter((m) => m > 0);
      return `<b>${d.ships.length} things shipped</b> in 26 weeks. <b>${last8.length} build sessions</b> in the last 8 weeks, ${f1(sum(last8) / 60)} hours.`;
    },
    legend: [{ k: "rgba(200,133,14,.35)", l: "15 min" }, { k: "rgba(200,133,14,.65)", l: "45 min" }, { k: "var(--business)", l: "90 min" }, { k: "var(--gold)", l: "Shipped", t: "diamond" }],
    render(w, d) {
      const weeks = d.mins.length, gap = 3, gx = 34, gy = 22;
      const cs = Math.max(8, Math.min(24, Math.floor((w - gx - 8) / weeks) - gap));
      let out = "";
      for (let i = 0; i < weeks; i++) {
        const monday = day(-((weeks - 1 - i) * 7) - 5);
        if (monday.getDate() <= 7 || i === 0) out += `<text x="${gx + i * (cs + gap)}" y="12">${monday.toLocaleDateString("en-US", { month: "short" })}</text>`;
        for (let j = 0; j < 7; j++) {
          const m = d.mins[i][j]; if (m === null) continue;
          const x = gx + i * (cs + gap), y = gy + j * (cs + gap), dt = day(-((weeks - 1 - i) * 7) - 5 + j);
          const op = m === 0 ? 0 : m < 30 ? 0.35 : m < 60 ? 0.65 : 1;
          out += `<rect x="${x}" y="${y}" width="${cs}" height="${cs}" rx="3" fill="${m ? "var(--c)" : "rgba(255,255,255,.045)"}" fill-opacity="${m ? op : 1}" data-tip="${esc(`${wd(dt)} ${md(dt)}: ${m ? m + " min" : "no session"}`)}"/>`;
        }
      }
      ["M", "", "W", "", "F", "", ""].forEach((l, j) => l && (out += `<text x="${gx - 10}" y="${gy + j * (cs + gap) + cs / 2 + 3.5}" text-anchor="end">${l}</text>`));
      const ty = gy + 7 * (cs + gap) + 26, x1 = gx + weeks * (cs + gap) - gap;
      out += `<line x1="${gx}" x2="${x1}" y1="${ty}" y2="${ty}" stroke="rgba(255,255,255,.12)"/>`;
      d.ships.forEach((sh, k) => {
        const x = gx + sh.w * (cs + gap) + cs / 2, ly = ty + (k % 2 ? 36 : 22);
        const anchor = x < 80 ? "start" : x > w - 80 ? "end" : "middle";
        out += `<line x1="${x}" x2="${x}" y1="${gy + 7 * (cs + gap) - 2}" y2="${ty}" stroke="rgba(212,175,55,.35)" stroke-dasharray="2 3"/>
          <path d="${diamond(x, ty, 9)}" fill="rgba(212,175,55,.18)"/><path d="${diamond(x, ty, 5)}" fill="var(--gold)" data-tip="${esc("Shipped: " + sh.t)}"/>
          <text class="lab" x="${x}" y="${ly}" text-anchor="${anchor}" fill="var(--ink)">${esc(sh.t)}</text>`;
      });
      return svg(w, ty + 46, `Build sessions over 26 weeks and ${d.ships.length} shipped projects`, out);
    },
    log: { cta: "Log a ship", fields: [{ n: "t", l: "What shipped", ph: "Store listing generator", type: "text" }],
      apply(d, v) { if (!v.t) return null; d.ships.push({ w: 25, t: v.t }); return `Logged ship: ${v.t}.`; } },
    empty: "Log a build session or a ship to start the log.",
  };

  VIZ.dropshipping = {
    title: "Unit economics", sample() {
      return { rev: [0, 0, 0, 45, 120, 180, 310, 260, 380, 420, 560, 690], ad: [0, 0, 40, 90, 110, 140, 180, 170, 200, 210, 240, 260], orders: [0, 0, 0, 1, 3, 4, 7, 6, 9, 10, 13, 16] };
    },
    profit: (d, i) => Math.round(d.rev[i] * 0.65 - d.ad[i]),
    takeaway(d) {
      const i = d.rev.length - 1, roas = d.ad[i] ? d.rev[i] / d.ad[i] : 0;
      return `<b>$${comma(d.rev[i])} revenue</b> this week on $${comma(d.ad[i])} in ads, a return of <b>${f1(roas)}x</b>. Profit after ads and product cost: <b>$${comma(this.profit(d, i))}</b>.`;
    },
    legend: [{ k: "var(--business)", l: "Revenue" }, { k: MUTED, l: "Ad spend" }, { k: "var(--ink)", l: "Profit after ads and product cost", t: "line" }],
    render(w, d) {
      const h = 250, P = { l: 48, r: 92, t: 16, b: 26 }, n = d.rev.length;
      const prof = d.rev.map((_, i) => this.profit(d, i));
      const top = Math.ceil(Math.max(...d.rev) / 200) * 200, bot = Math.floor(Math.min(0, ...prof) / 100) * 100;
      const y = lin(bot, top, h - P.b, P.t), bw = (w - P.l - P.r) / n;
      let out = gridY(P.l, w - P.r, y, [bot, 0, top / 2, top].filter((v, k, a) => a.indexOf(v) === k), (v) => "$" + comma(v));
      d.rev.forEach((r, i) => {
        const x = P.l + i * bw;
        out += `<path d="${topBar(x + bw * 0.16, y(r), bw * 0.32, y(0) - y(r))}" fill="var(--c)"/><path d="${topBar(x + bw * 0.52, y(d.ad[i]), bw * 0.32, y(0) - y(d.ad[i]))}" fill="${MUTED}"/>`;
        out += hit(x, P.t, bw, h - P.t - P.b, `Week of ${md(day(-(n - 1 - i) * 7 - 5))}: revenue $${comma(r)}, ads $${comma(d.ad[i])}, profit $${comma(prof[i])}, ${d.orders[i]} orders`);
      });
      const pts = prof.map((p, i) => [P.l + i * bw + bw / 2, y(p)]);
      out += `<path d="${pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("")}" fill="none" stroke="var(--ink)" stroke-width="2"/>`;
      out += pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="var(--ink)"/>`).join("");
      const L = pts[n - 1];
      out += `<text class="lab" x="${L[0] + 12}" y="${L[1] + 4}" fill="var(--ink)">Profit $${comma(prof[n - 1])}</text>`;
      out += `<text class="lab" x="${P.l + (n - 1) * bw + bw * 0.32}" y="${y(d.rev[n - 1]) - 8}" text-anchor="middle" fill="var(--ct)">$${comma(d.rev[n - 1])}</text>`;
      out += `<text x="${P.l}" y="${h - 6}">12 weeks ago</text><text x="${w - P.r}" y="${h - 6}" text-anchor="end">This week</text>`;
      return svg(w, h, "Weekly revenue, ad spend and profit for 12 weeks", out);
    },
    log: { cta: "Save this week", fields: [{ n: "rev", l: "Revenue", ph: "690", type: "number", pre: "$" }, { n: "ad", l: "Ad spend", ph: "260", type: "number", pre: "$" }, { n: "orders", l: "Orders", ph: "16", type: "number" }],
      apply(d, v) { const i = d.rev.length - 1; if (v.rev) d.rev[i] = +v.rev; if (v.ad) d.ad[i] = +v.ad; if (v.orders) d.orders[i] = +v.orders; return "Saved this week's numbers."; } },
    empty: "Enter a week of revenue and ad spend to see what the store really makes.",
  };

  const letter = (p) => (p >= 93 ? "A" : p >= 90 ? "A-" : p >= 87 ? "B+" : p >= 83 ? "B" : p >= 80 ? "B-" : "C");
  VIZ.academics = {
    title: "Course board", sample() {
      return {
        courses: [{ code: "MATH 1210", name: "Calculus I", grade: 91.5, target: 93 }, { code: "CMPS 1500", name: "Intro to Computer Science", grade: 96.2, target: 93 }, { code: "ARCH 1110", name: "Architecture studio", grade: 88.4, target: 90 }, { code: "ECON 1020", name: "Macroeconomics", grade: 93.8, target: 93 }, { code: "HISA 1500", name: "Art history", grade: 95.1, target: 93 }, { code: "INFO 1010", name: "Information literacy", grade: 98, target: 93 }],
        due: [{ c: "MATH 1210", t: "Problem set 6", d: 1.25 }, { c: "CMPS 1500", t: "Lab 4", d: 3 }, { c: "ARCH 1110", t: "Studio pinup", d: 5 }, { c: "ECON 1020", t: "Quiz 3", d: 6 }, { c: "MATH 1210", t: "Midterm 2", d: 11 }],
      };
    },
    takeaway(d) {
      const ok = d.courses.filter((c) => c.grade >= c.target), worst = d.courses.filter((c) => c.grade < c.target).sort((a, b) => (a.grade - a.target) - (b.grade - b.target))[0];
      const next = d.due.slice().sort((a, b) => a.d - b.d)[0];
      return `<b>${ok.length} of ${d.courses.length} courses</b> at or above target.${worst ? ` ${worst.code} is ${f1(worst.target - worst.grade)} points under.` : ""} ${next ? `<b>${esc(next.t)}</b> is due in ${next.d < 2 ? Math.round(next.d * 24) + " h" : Math.round(next.d) + " days"}.` : ""}`;
    },
    legend: [{ k: "var(--school)", l: "Current grade" }, { k: "var(--ink)", l: "Your target", t: "line" }, { k: "var(--school-text)", l: "Due within 48 h", t: "dot" }],
    render(w, d) {
      const rowH = 34, lw = Math.min(210, w * 0.28), gw = 74, x = lin(60, 100, lw, w - gw);
      let out = [60, 70, 80, 90, 100].map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="4" y2="${d.courses.length * rowH}" stroke="${GRID}"/><text x="${x(t)}" y="${d.courses.length * rowH + 14}" text-anchor="middle">${t}</text>`).join("");
      d.courses.forEach((c, i) => {
        const yy = 8 + i * rowH;
        out += `<text class="lab" x="0" y="${yy + 9}" fill="var(--ink)">${esc(c.code)}</text><text x="0" y="${yy + 22}" style="font-family:var(--display)">${esc(c.name)}</text>
          <rect x="${lw}" y="${yy + 6}" width="${w - gw - lw}" height="8" rx="4" fill="rgba(255,255,255,.05)"/>
          <rect x="${lw}" y="${yy + 6}" width="${Math.max(0, x(c.grade) - lw)}" height="8" rx="4" fill="var(--c)" data-tip="${esc(`${c.code}: ${f1(c.grade)}%, target ${c.target}%`)}"/>
          <line x1="${x(c.target)}" x2="${x(c.target)}" y1="${yy + 1}" y2="${yy + 19}" stroke="var(--ink)" stroke-width="2"/>
          <text x="${w}" y="${yy + 14}" text-anchor="end" style="font-size:12px;font-weight:600" fill="${c.grade >= c.target ? "var(--ink)" : "var(--ink-muted)"}">${f1(c.grade)} ${letter(c.grade)}</text>`;
      });
      const y0 = d.courses.length * rowH + 52, tx = lin(0, 14, lw, w - gw);
      out += `<text x="0" y="${y0 + 4}" style="font-family:var(--display);font-weight:700;letter-spacing:.14em;font-size:10px">NEXT 14 DAYS</text><line x1="${lw}" x2="${w - gw}" y1="${y0}" y2="${y0}" stroke="rgba(255,255,255,.14)"/>`;
      for (let k = 0; k <= 14; k += 2) out += `<line x1="${tx(k)}" x2="${tx(k)}" y1="${y0 - 3}" y2="${y0 + 3}" stroke="rgba(255,255,255,.2)"/><text x="${tx(k)}" y="${y0 + 46}" text-anchor="middle">${k === 0 ? "Today" : wd(day(k)) + " " + day(k).getDate()}</text>`;
      d.due.forEach((it, k) => {
        const soon = it.d <= 2, xx = tx(it.d), ly = y0 + (k % 2 ? 30 : -12);
        out += `<circle cx="${xx}" cy="${y0}" r="${soon ? 6 : 4.5}" fill="${soon ? "var(--ct)" : "var(--ink-muted)"}" ${soon ? 'style="filter:drop-shadow(0 0 6px var(--c))"' : ""} data-tip="${esc(`${it.c}: ${it.t}`)}"/><text class="lab" x="${xx}" y="${ly}" text-anchor="middle" fill="${soon ? "var(--ct)" : "var(--ink-muted)"}">${esc(it.t)}</text>`;
      });
      return svg(w, y0 + 56, "Grade in each course against your target, and deadlines in the next 14 days", out);
    },
    log: { cta: "Update grade", fields: [{ n: "c", l: "Course", type: "select", opts: ["MATH 1210", "CMPS 1500", "ARCH 1110", "ECON 1020", "HISA 1500", "INFO 1010"] }, { n: "g", l: "Grade %", ph: "92.5", type: "number" }],
      apply(d, v) { const c = d.courses.find((x) => x.code === v.c); if (!c || !v.g) return null; c.grade = +v.g; return `${c.code} now ${f1(c.grade)}%.`; } },
    empty: "Grades and due dates fill in from Canvas, or add a course by hand.",
  };

  VIZ.reading = {
    title: "Shelf and rate", sample() {
      return { books: [{ t: "Meditations", p: 254, r: 254 }, { t: "Atomic Habits", p: 320, r: 320 }, { t: "The Lean Startup", p: 336, r: 190 }, { t: "Deep Work", p: 296, r: 0 }, { t: "Can't Hurt Me", p: 364, r: 0 }], tests: [{ d: "Sep 2", v: 268 }, { d: "Sep 16", v: 281 }, { d: "Sep 30", v: 296 }, { d: "Oct 14", v: 312 }] };
    },
    takeaway(d) {
      const done = d.books.filter((b) => b.r >= b.p).length, cur = d.books.find((b) => b.r > 0 && b.r < b.p), t0 = d.tests[0].v, t1 = d.tests[d.tests.length - 1].v;
      return `<b>${done} books finished</b>${cur ? `, ${esc(cur.t)} at ${Math.round((100 * cur.r) / cur.p)}%` : ""}. Effective rate <b>${t1} wpm</b>, ${t1 >= t0 ? "+" : ""}${Math.round((100 * (t1 - t0)) / t0)}% over your baseline.`;
    },
    legend: [{ k: "var(--school)", l: "Pages read" }, { k: "var(--gold)", l: "Finished", t: "line" }, { k: "var(--school-text)", l: "Effective rate (wpm times comprehension)", t: "line" }],
    render(w, d) {
      const h = 260, base = h - 30, sw = Math.min(w * 0.44, 340), spw = Math.min(46, (sw - 20) / d.books.length - 8);
      let out = `<rect x="0" y="${base}" width="${sw}" height="6" rx="2" fill="#1d1e29"/><rect x="0" y="${base + 6}" width="${sw}" height="2" fill="rgba(0,0,0,.5)"/>`;
      d.books.forEach((b, i) => {
        const bh = 100 + (b.p / 364) * 110, x = 10 + i * (spw + 8), y = base - bh, rh = (bh * Math.min(b.r, b.p)) / b.p;
        out += `<rect x="${x}" y="${y}" width="${spw}" height="${bh}" rx="3" fill="#101018" stroke="rgba(255,255,255,.12)"/>`;
        if (rh) out += `<rect x="${x}" y="${base - rh}" width="${spw}" height="${rh}" rx="3" fill="var(--c)" fill-opacity="${b.r >= b.p ? 0.9 : 0.6}"/>`;
        if (b.r >= b.p) out += `<rect x="${x}" y="${y}" width="${spw}" height="4" rx="2" fill="var(--gold)"/>`;
        out += `<text x="${x + spw / 2 + 4}" y="${base - 10}" transform="rotate(-90 ${x + spw / 2 + 4} ${base - 10})" style="font-family:var(--display);font-weight:700;font-size:11px" fill="${rh > bh * 0.5 ? "#0b0b13" : "var(--ink-muted)"}">${esc(b.t)}</text>`;
        out += hit(x, y, spw, bh, `${b.t}: ${b.r} of ${b.p} pages`);
      });
      const x0 = sw + 70, x1 = w - 40, y = lin(240, 340, base, 20), x = lin(0, d.tests.length - 1, x0, x1);
      out += gridY(x0, x1, y, [250, 300]);
      out += `<line x1="${x0}" x2="${x1}" y1="${y(d.tests[0].v)}" y2="${y(d.tests[0].v)}" stroke="${MUTED}" stroke-dasharray="4 4"/><text x="${x1}" y="${y(d.tests[0].v) + 16}" text-anchor="end">Baseline ${d.tests[0].v}</text>`;
      out += `<path d="${d.tests.map((t, i) => (i ? "L" : "M") + x(i) + " " + y(t.v)).join("")}" fill="none" stroke="var(--ct)" stroke-width="2.5"/>`;
      d.tests.forEach((t, i) => (out += `<circle cx="${x(i)}" cy="${y(t.v)}" r="4" fill="var(--ct)" data-tip="${t.d}: ${t.v} wpm"/><text class="lab" x="${x(i)}" y="${y(t.v) - 10}" text-anchor="middle" fill="var(--ink)">${t.v}</text><text x="${x(i)}" y="${h - 6}" text-anchor="middle">${t.d}</text>`));
      return svg(w, h, "Books on the shelf by pages read, and effective reading rate over time", out);
    },
    log: { cta: "Log pages", fields: [{ n: "b", l: "Book", type: "select", opts: ["The Lean Startup", "Deep Work", "Can't Hurt Me"] }, { n: "p", l: "Pages read", ph: "25", type: "number" }],
      apply(d, v) { const b = d.books.find((x) => x.t === v.b); if (!b || !v.p) return null; b.r = Math.min(b.p, b.r + +v.p); return `${v.p} pages of ${b.t}.`; } },
    empty: "Add the book you are reading and take the baseline test.",
  };

  VIZ["college-integration"] = {
    title: "Your people", sample() {
      return {
        people: [{ l: "Lab partner", c: "Classes", m: 9, last: 1 }, { l: "Calc study group", c: "Classes", m: 6, last: 3 }, { l: "ECON seatmate", c: "Classes", m: 3, last: 8 }, { l: "Run club", c: "Clubs", m: 5, last: 2 }, { l: "Tulane Entrepreneurs", c: "Clubs", m: 3, last: 6 }, { l: "Chess club", c: "Clubs", m: 2, last: 13 }, { l: "Roommate", c: "Dorm", m: 14, last: 0 }, { l: "Floor 3 group", c: "Dorm", m: 8, last: 1 }, { l: "Front desk", c: "Dorm", m: 2, last: 10 }, { l: "MATH 1210 professor", c: "Professors", m: 3, last: 4 }, { l: "CMPS 1500 professor", c: "Professors", m: 1, last: 9 }, { l: "ARCH 1110 professor", c: "Professors", m: 0, last: 30 }],
        weeks: [2, 3, 5, 4, 6, 5, 7, 6], hours: [0, 0, 1, 0, 1, 1, 0, 1],
      };
    },
    takeaway(d) {
      const known = d.people.filter((p) => p.m > 0), week = known.filter((p) => p.last <= 6), profs = d.people.filter((p) => p.c === "Professors");
      return `<b>${known.length} people</b> you know by name, <b>${week.length} seen this week</b>. Office hours with ${profs.filter((p) => p.m > 0).length} of ${profs.length} professors.`;
    },
    legend: [{ k: "var(--school)", l: "Bigger means more conversations, closer means more recent", t: "dot" }, { k: "var(--gold)", l: "Office hours", t: "dot" }],
    render(w, d) {
      const h = 300, lw = Math.min(w * 0.56, 560), cx = lw / 2, cy = h / 2, R = Math.min(lw / 2 - 30, 130);
      const quad = { Classes: [-180, -90], Clubs: [-90, 0], Dorm: [90, 180], Professors: [0, 90] };
      let out = [0.33, 0.66, 1].map((k) => `<circle cx="${cx}" cy="${cy}" r="${R * k}" fill="none" stroke="${GRID}" stroke-dasharray="3 5"/>`).join("");
      out += `<line x1="${cx - R - 10}" x2="${cx + R + 10}" y1="${cy}" y2="${cy}" stroke="${GRID}"/><line x1="${cx}" x2="${cx}" y1="${cy - R - 10}" y2="${cy + R + 10}" stroke="${GRID}"/>`;
      out += `<text class="lab" x="${cx - R - 12}" y="${cy - R + 4}" text-anchor="start" fill="var(--ink-muted)">Classes</text><text class="lab" x="${cx + R + 12}" y="${cy - R + 4}" text-anchor="end" fill="var(--ink-muted)">Clubs</text><text class="lab" x="${cx - R - 12}" y="${cy + R + 4}" fill="var(--ink-muted)">Dorm</text><text class="lab" x="${cx + R + 12}" y="${cy + R + 4}" text-anchor="end" fill="var(--ink-muted)">Professors</text>`;
      Object.entries(quad).forEach(([c, [a0, a1]]) => {
        const list = d.people.filter((p) => p.c === c);
        list.forEach((p, i) => {
          const a = ((a0 + ((i + 1) * (a1 - a0)) / (list.length + 1)) * Math.PI) / 180, r = 26 + (Math.min(p.last, 21) / 21) * (R - 26);
          const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a), size = p.m ? 3.5 + Math.sqrt(p.m) * 2.2 : 4;
          out += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--c)" stroke-opacity="${p.m ? 0.18 : 0.06}"/>`;
          out += p.m ? `<circle cx="${x}" cy="${y}" r="${size}" fill="var(--c)" fill-opacity="${(1 - Math.min(p.last, 21) / 30).toFixed(2)}" data-tip="${esc(`${p.l}: ${p.m} conversations, last ${p.last ? p.last + " days ago" : "today"}`)}"/>`
            : `<circle cx="${x}" cy="${y}" r="${size}" fill="none" stroke="var(--ink-muted)" stroke-dasharray="2 2" data-tip="${esc(p.l + ": not yet")}"/>`;
          if (p.m >= 5 || !p.m) out += `<text x="${x + (Math.cos(a) > 0 ? size + 5 : -size - 5)}" y="${y + 3.5}" text-anchor="${Math.cos(a) > 0 ? "start" : "end"}" style="font-family:var(--display);font-weight:600">${esc(p.l)}</text>`;
        });
      });
      out += `<circle cx="${cx}" cy="${cy}" r="16" fill="#1d1e29" stroke="rgba(255,255,255,.2)"/><text class="lab" x="${cx}" y="${cy + 4}" text-anchor="middle" fill="var(--ink)">You</text>`;
      const x0 = lw + 50, x1 = w - 10, top = Math.max(...d.weeks) + 1, y = lin(0, top, h - 30, 40), bw = (x1 - x0) / d.weeks.length;
      out += `<text x="${x0}" y="20" style="font-family:var(--display);font-weight:700;letter-spacing:.14em;font-size:10px">CONVERSATIONS PER WEEK</text>`;
      out += gridY(x0, x1, y, [0, Math.round(top / 2), top]);
      d.weeks.forEach((v, i) => {
        const x = x0 + i * bw;
        out += `<path d="${topBar(x + bw * 0.2, y(v), bw * 0.6, y(0) - y(v))}" fill="var(--c)" fill-opacity="${i === d.weeks.length - 1 ? 1 : 0.7}" data-tip="${esc(`Week of ${md(day(-(d.weeks.length - 1 - i) * 7 - 5))}: ${v} conversations${d.hours[i] ? ", office hours" : ""}`)}"/>`;
        if (d.hours[i]) out += `<circle cx="${x + bw / 2}" cy="${y(v) - 9}" r="3.5" fill="var(--gold)"/>`;
      });
      out += `<text x="${x0}" y="${h - 8}">8 weeks ago</text><text x="${x1}" y="${h - 8}" text-anchor="end">This week</text>`;
      return svg(w, h, "People you know by context and recency, and conversations per week", out);
    },
    log: { cta: "Log a conversation", fields: [{ n: "l", l: "Who", ph: "Studio partner", type: "text" }, { n: "c", l: "Where", type: "select", opts: ["Classes", "Clubs", "Dorm", "Professors"] }],
      apply(d, v) { if (!v.l) return null; const p = d.people.find((x) => x.l.toLowerCase() === v.l.toLowerCase()); if (p) { p.m++; p.last = 0; } else d.people.push({ l: v.l, c: v.c, m: 1, last: 0 }); d.weeks[d.weeks.length - 1]++; return `Logged a conversation with ${v.l}.`; } },
    empty: "Log the people you meet. The map fills in by where you met them.",
  };

  VIZ["time-blocking"] = {
    title: "Plan versus day", sample() {
      const base = [[9 * 60, 10.5 * 60, "Study"], [12 * 60, 13 * 60, "Class"], [15 * 60, 16.5 * 60, "Store work"], [17 * 60, 18 * 60, "Class"], [19 * 60, 20.25 * 60, "Training"], [21.5 * 60, 22 * 60, "Plan tomorrow"]];
      const days = [];
      for (let k = 6; k >= 0; k--) {
        const dt = day(-k), planned = k !== 3;
        const now = 10.7 * 60;
        const blocks = planned ? base.map(([s0, e0, t]) => ({ s: s0 + (rnd() < 0.3 ? 30 : 0), e: e0, t, kept: k === 0 ? (e0 < now ? rnd() < 0.8 : null) : rnd() < 0.76 })) : [];
        days.push({ dt, planned, blocks });
      }
      return { days };
    },
    pct(dd) { const b = dd.blocks.filter((x) => x.kept !== null); return b.length ? Math.round((100 * b.filter((x) => x.kept).length) / b.length) : null; },
    takeaway(d) {
      const planned = d.days.filter((x) => x.planned).length, all = d.days.flatMap((x) => x.blocks).filter((b) => b.kept !== null);
      const pm = all.filter((b) => b.s >= 14 * 60), am = all.filter((b) => b.s < 14 * 60);
      const r = (a) => (a.length ? a.filter((b) => b.kept).length / a.length : 0);
      return `Planned <b>${planned} of 7</b> nights. Kept <b>${Math.round(100 * r(all))}%</b> of blocks this week; ${r(pm) < r(am) ? "afternoons" : "mornings"} slip most.`;
    },
    legend: [{ k: "var(--mind)", l: "Kept" }, { k: "transparent", l: "Missed", t: "dash" }, { k: "rgba(255,255,255,.2)", l: "Still ahead" }],
    render(w, d) {
      const rowH = 30, lw = 58, rw = 54, x = lin(6 * 60, 24 * 60, lw, w - rw), h = d.days.length * rowH + 34;
      let out = [6, 9, 12, 15, 18, 21, 24].map((t) => `<line x1="${x(t * 60)}" x2="${x(t * 60)}" y1="0" y2="${d.days.length * rowH}" stroke="${GRID}"/><text x="${x(t * 60)}" y="${h - 8}" text-anchor="middle">${String(t % 24).padStart(2, "0")}:00</text>`).join("");
      d.days.forEach((dd, i) => {
        const y = i * rowH + 5, today = i === d.days.length - 1;
        out += `<text class="lab" x="0" y="${y + 14}" fill="${today ? "var(--ink)" : "var(--ink-muted)"}">${wd(dd.dt)} ${dd.dt.getDate()}</text>`;
        if (!dd.planned) out += `<text x="${lw + 6}" y="${y + 14}" style="font-family:var(--display);font-style:italic">No plan that night</text>`;
        dd.blocks.forEach((b) => {
          const bx = x(b.s), bw = x(b.e) - x(b.s), tip = `${wd(dd.dt)} ${b.t}, ${String(Math.floor(b.s / 60)).padStart(2, "0")}:${String(b.s % 60).padStart(2, "0")}: ${b.kept === null ? "ahead" : b.kept ? "kept" : "missed"}`;
          out += b.kept === true ? `<rect x="${bx}" y="${y}" width="${bw}" height="20" rx="4" fill="var(--c)" data-tip="${esc(tip)}"/>`
            : b.kept === false ? `<rect x="${bx + 0.5}" y="${y + 0.5}" width="${bw - 1}" height="19" rx="4" fill="none" stroke="var(--ct)" stroke-dasharray="3 3" data-tip="${esc(tip)}"/>`
            : `<rect x="${bx}" y="${y}" width="${bw}" height="20" rx="4" fill="rgba(255,255,255,.08)" data-tip="${esc(tip)}"/>`;
        });
        const p = this.pct(dd);
        out += `<text x="${w}" y="${y + 14}" text-anchor="end" style="font-size:12px;font-weight:600" fill="${p === null ? "var(--ink-label)" : "var(--ink)"}">${p === null ? "-" : p + "%"}</text>`;
      });
      const nx = x(10.7 * 60), ny = (d.days.length - 1) * rowH;
      out += `<line x1="${nx}" x2="${nx}" y1="${ny}" y2="${ny + 30}" stroke="var(--ink)" stroke-width="1.5"/><circle cx="${nx}" cy="${ny}" r="3" fill="var(--ink)"/>`;
      return svg(w, h, "Planned blocks for the last 7 days, kept and missed", out);
    },
    log: { cta: "Rate tonight", fields: [{ n: "a", l: "Blocks kept today", type: "seg", opts: ["0%", "25%", "50%", "75%", "100%"] }],
      apply(d, v) { if (!v.a) return null; const dd = d.days[d.days.length - 1], k = parseInt(v.a, 10) / 100; dd.blocks.forEach((b, i) => (b.kept = i < Math.round(dd.blocks.length * k))); return `Rated today at ${v.a}.`; } },
    empty: "Plan tomorrow tonight and the week starts drawing itself.",
  };

  VIZ.chess = {
    title: "Rating", sample() {
      const r = [1000]; for (let i = 1; i < 42; i++) r.push(r[i - 1] + Math.round((rnd() - 0.38) * 14));
      const off = 1086 - r[41]; const ratings = r.map((v, i) => v + Math.round((off * i) / 41));
      const games = Array.from({ length: 30 }, () => { const x = rnd(); return x < 0.5 ? "W" : x < 0.6 ? "D" : "L"; });
      return { ratings, games, next: 1100 };
    },
    takeaway(d) {
      const n = d.ratings.length, last = d.ratings[n - 1], gain = last - d.ratings[0], c = (k) => d.games.filter((x) => x === k).length;
      return `Rapid <b>${last}</b>, ${gain >= 0 ? "+" : ""}${gain} in 6 weeks. <b>${d.next}</b> is ${Math.max(0, d.next - last)} points away. Last 30 games: ${c("W")} wins, ${c("D")} draws, ${c("L")} losses.`;
    },
    legend: [{ k: "var(--mind)", l: "Rapid rating", t: "line" }, { k: "var(--gold)", l: "Next step", t: "dash" }, { k: "var(--mind)", l: "Win" }, { k: MUTED, l: "Draw" }, { k: "transparent", l: "Loss", t: "dash" }],
    render(w, d) {
      const h = 270, P = { l: 48, r: 60, t: 16 }, ch = 180, n = d.ratings.length;
      const lo = Math.floor((Math.min(...d.ratings) - 20) / 50) * 50, hi = Math.max(d.next + 20, Math.max(...d.ratings) + 20);
      const y = lin(lo, hi, ch, P.t), x = lin(0, n - 1, P.l, w - P.r);
      let out = gridY(P.l, w - P.r, y, [lo, lo + 50, lo + 100, lo + 150].filter((v) => v < hi));
      out += `<line x1="${P.l}" x2="${w - P.r}" y1="${y(d.next)}" y2="${y(d.next)}" stroke="var(--gold)" stroke-dasharray="5 5" stroke-opacity=".8"/><text class="lab" x="${P.l + 6}" y="${y(d.next) - 7}" fill="var(--gold)">Next step ${d.next}</text>`;
      const line = d.ratings.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join("");
      out += `<path d="${line}L${x(n - 1)} ${ch}L${x(0)} ${ch}Z" fill="var(--c)" fill-opacity=".1"/><path d="${line}" fill="none" stroke="var(--ct)" stroke-width="2.2" stroke-linejoin="round"/>`;
      out += `<circle cx="${x(n - 1)}" cy="${y(d.ratings[n - 1])}" r="5" fill="var(--ct)" style="filter:drop-shadow(0 0 6px var(--c))"/><text class="lab" x="${x(n - 1) + 10}" y="${y(d.ratings[n - 1]) + 4}" fill="var(--ink)">${d.ratings[n - 1]}</text>`;
      out += d.ratings.map((v, i) => hit(x(i) - 6, P.t, 12, ch - P.t, `${md(day(i - n + 1))}: ${v}`)).join("");
      out += `<text x="${P.l}" y="${ch + 16}">${md(day(-n + 1))}</text><text x="${w - P.r}" y="${ch + 16}" text-anchor="end">Today</text>`;
      const gy = ch + 44, gs = Math.min(20, (w - P.l - P.r) / d.games.length - 4);
      out += `<text x="${P.l - 8}" y="${gy + gs / 2 + 3}" text-anchor="end">Games</text>`;
      d.games.forEach((r, i) => {
        const gx = P.l + i * (gs + 4);
        out += r === "W" ? `<rect x="${gx}" y="${gy}" width="${gs}" height="${gs}" rx="3" fill="var(--c)" data-tip="Game ${i + 1}: win"/>`
          : r === "D" ? `<rect x="${gx}" y="${gy}" width="${gs}" height="${gs}" rx="3" fill="${MUTED}" data-tip="Game ${i + 1}: draw"/>`
          : `<rect x="${gx + 0.5}" y="${gy + 0.5}" width="${gs - 1}" height="${gs - 1}" rx="3" fill="none" stroke="rgba(255,255,255,.22)" data-tip="Game ${i + 1}: loss"/>`;
      });
      return svg(w, gy + gs + 6, "Rapid rating over 6 weeks and the last 30 games", out);
    },
    log: { cta: "Save rating", fields: [{ n: "r", l: "Rapid rating", ph: "1092", type: "number" }],
      apply(d, v) { if (!v.r) return null; d.ratings.push(+v.r); d.ratings.shift(); return `Rating saved: ${v.r}.`; } },
    empty: "Connect Chess.com or Lichess by username, or enter your rating.",
  };

  VIZ.meditation = {
    title: "Thirty sits", sample() {
      return { mins: Array.from({ length: 30 }, (_, i) => (i === 29 ? 0 : rnd() < 0.13 ? 0 : pick([10, 10, 10, 12, 15, 20, 8]))) };
    },
    takeaway(d) {
      const sat = d.mins.filter((m) => m > 0); let streak = 0; for (let i = d.mins.length - 2; i >= 0 && d.mins[i] > 0; i--) streak++;
      return `Sat <b>${sat.length} of ${d.mins.length}</b> days, <b>${Math.round(avg(sat))} min</b> on average. Streak <b>${streak}</b>; today is still open.`;
    },
    legend: [{ k: "var(--mind)", l: "Minutes that day", t: "line" }, { k: "rgba(255,255,255,.35)", l: "10 minute target", t: "dash" }],
    render(w, d) {
      const h = 280, cx = Math.min(150, w * 0.25), cy = h / 2, r0 = 38, r1 = 122, sc = (m) => r0 + (Math.min(m, 25) / 25) * (r1 - r0), n = d.mins.length;
      let out = `<circle cx="${cx}" cy="${cy}" r="${sc(10)}" fill="none" stroke="rgba(255,255,255,.3)" stroke-dasharray="3 4"/><text x="${cx + sc(10) * 0.72 + 4}" y="${cy - sc(10) * 0.72 - 4}">10 min</text><circle cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke="${GRID}"/>`;
      d.mins.forEach((m, i) => {
        const a = ((-90 + (i * 360) / n) * Math.PI) / 180, last = i === n - 1;
        const x0 = cx + (r0 + 2) * Math.cos(a), y0 = cy + (r0 + 2) * Math.sin(a), x1 = cx + sc(m) * Math.cos(a), y1 = cy + sc(m) * Math.sin(a);
        out += m ? `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="var(--ct)" stroke-width="5" stroke-linecap="round" ${i === n - 2 ? 'style="filter:drop-shadow(0 0 5px var(--c))"' : 'stroke-opacity=".85"'}/>`
          : `<circle cx="${x0}" cy="${y0}" r="2" fill="${last ? "var(--ink)" : MUTED}"/>`;
        out += `<line x1="${cx}" y1="${cy}" x2="${cx + r1 * Math.cos(a)}" y2="${cy + r1 * Math.sin(a)}" stroke="transparent" stroke-width="10" data-tip="${esc(`${md(day(i - n + 1))}: ${m ? m + " min" : last ? "open" : "missed"}`)}"/>`;
      });
      const tot = sum(d.mins);
      out += `<text x="${cx}" y="${cy + 2}" text-anchor="middle" style="font-size:20px;font-weight:700" fill="var(--ink)">${f1(tot / 60)} h</text><text x="${cx}" y="${cy + 18}" text-anchor="middle">30 days</text>`;
      out += `<text x="${cx}" y="${cy - r1 - 8}" text-anchor="middle">${md(day(-n + 1))}, then clockwise</text>`;
      const x0 = cx * 2 + 60, x1 = w - 60, weeks = [0, 1, 2, 3].map((k) => sum(d.mins.slice(Math.max(0, n - 7 * (k + 1)), n - 7 * k))), x = lin(0, Math.max(...weeks, 70), x0 + 90, x1);
      out += `<text x="${x0}" y="58" style="font-family:var(--display);font-weight:700;letter-spacing:.14em;font-size:10px">MINUTES PER WEEK</text>`;
      ["This week", "Last week", "2 weeks ago", "3 weeks ago"].forEach((l, k) => {
        const y = 84 + k * 42;
        out += `<text class="lab" x="${x0}" y="${y + 9}" fill="var(--ink-muted)">${l}</text><rect x="${x0 + 90}" y="${y}" width="${x1 - x0 - 90}" height="12" rx="4" fill="rgba(255,255,255,.05)"/><rect x="${x0 + 90}" y="${y}" width="${x(weeks[k]) - x0 - 90}" height="12" rx="4" fill="var(--c)" fill-opacity="${k ? 0.6 : 1}"/><text x="${x(weeks[k]) + 8}" y="${y + 10}" style="font-size:12px;font-weight:600" fill="var(--ink)">${weeks[k]}</text>`;
      });
      return svg(w, h, "Minutes meditated on each of the last 30 days, and minutes per week", out);
    },
    log: { cta: "Log sit", fields: [{ n: "m", l: "Minutes", ph: "10", type: "number" }],
      apply(d, v) { if (!v.m) return null; d.mins[d.mins.length - 1] = +v.m; return `Logged ${v.m} min.`; } },
    empty: "Sit for three minutes. The first spoke goes in at the top.",
  };

  VIZ.visualization = {
    title: "Vividness", sample() {
      return { days: Array.from({ length: 30 }, (_, i) => (i === 29 || rnd() < 0.27 ? null : Math.max(1, Math.min(5, Math.round(2.6 + (i / 29) * 1.4 + (rnd() - 0.5) * 1.6))))), rewrite: 12 };
    },
    takeaway(d) {
      const done = d.days.filter((v) => v !== null), first = d.days.slice(0, 7).filter((v) => v !== null), rest = d.days.slice(-7).filter((v) => v !== null);
      return `<b>${done.length} of ${d.days.length}</b> days. Vividness averages <b>${f1(avg(rest))}</b> this week, up from ${f1(avg(first))} in the first.`;
    },
    legend: [{ k: "var(--mind)", l: "Session vividness, 1 to 5", t: "dot" }, { k: "var(--ink)", l: "7 day average", t: "line" }, { k: "var(--gold)", l: "Vision rewritten", t: "diamond" }],
    render(w, d) {
      const h = 240, P = { l: 70, r: 24, t: 20, b: 32 }, n = d.days.length, x = lin(0, n - 1, P.l, w - P.r), y = lin(1, 5, h - P.b - 18, P.t);
      let out = [1, 2, 3, 4, 5].map((v) => `<line x1="${P.l}" x2="${w - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}"/><text x="${P.l - 10}" y="${y(v) + 3.5}" text-anchor="end">${v === 1 ? "1 faint" : v === 5 ? "5 vivid" : v}</text>`).join("");
      let seg = "";
      d.days.forEach((v, i) => { if (v !== null) seg += (i && d.days[i - 1] !== null ? "L" : "M") + x(i) + " " + y(v); });
      out += `<path d="${seg}" fill="none" stroke="var(--ct)" stroke-opacity=".45" stroke-width="1.5"/>`;
      const roll = d.days.map((_, i) => { const win = d.days.slice(Math.max(0, i - 6), i + 1).filter((v) => v !== null); return win.length ? avg(win) : null; });
      out += `<path d="${roll.map((v, i) => (v === null ? "" : (i && roll[i - 1] !== null ? "L" : "M") + x(i) + " " + y(v))).join("")}" fill="none" stroke="var(--ink)" stroke-width="2.2"/>`;
      d.days.forEach((v, i) => (out += v !== null ? `<circle cx="${x(i)}" cy="${y(v)}" r="4.5" fill="var(--ct)" data-tip="${md(day(i - n + 1))}: ${v} of 5"/>` : `<circle cx="${x(i)}" cy="${h - P.b - 2}" r="3" fill="none" stroke="${MUTED}" data-tip="${md(day(i - n + 1))}: ${i === n - 1 ? "open" : "missed"}"/>`));
      out += `<text x="${P.l - 10}" y="${h - P.b + 1}" text-anchor="end">Missed</text>`;
      const rx = x(d.rewrite);
      out += `<path d="${diamond(rx, P.t - 8, 6)}" fill="var(--gold)"/><text class="lab" x="${rx + 10}" y="${P.t - 4}" fill="var(--gold)">Vision rewritten</text>`;
      out += `<text x="${P.l}" y="${h - 6}">${md(day(-n + 1))}</text><text x="${w - P.r}" y="${h - 6}" text-anchor="end">Today</text>`;
      return svg(w, h, "Visualization sessions and vividness over 30 days", out);
    },
    log: { cta: "Log session", fields: [{ n: "v", l: "How vivid", type: "seg", opts: ["1", "2", "3", "4", "5"] }],
      apply(d, v) { if (!v.v) return null; d.days[d.days.length - 1] = +v.v; return `Logged vividness ${v.v}.`; } },
    empty: "Do one session and rate how vivid it was.",
  };

  VIZ.strength = {
    title: "Lifts", sample() {
      return { focus: "Bench", lifts: { Bench: [205, 210, 215, 215, 220, 225, 230, 230, 235, 240, 240, 245], Squat: [255, 260, 270, 275, 275, 285, 290, 290, 300, 300, 305, 305], Deadlift: [315, 320, 325, 335, 335, 340, 345, 350, 350, 355, 360, 365] }, goals: { Bench: [225, 255], Squat: [315], Deadlift: [405] }, sessions: [5, 6, 6, 4, 6, 6, 5, 6, 6, 6, 5, 4] };
    },
    takeaway(d) {
      const b = d.lifts.Bench.at(-1), s0 = d.lifts.Squat.at(-1);
      return `Bench <b>${b}</b> estimated max, ${b - 225} past 225 and ${255 - b} from 255. Squat <b>${s0}</b>, ${315 - s0} lb from 315.`;
    },
    controls: (d) => `<div class="seg" role="group" aria-label="Lift">${Object.keys(d.lifts).map((k) => `<button type="button" data-focus="${k}" aria-pressed="${d.focus === k}">${k}</button>`).join("")}</div>`,
    legend: [{ k: "var(--athletics)", l: "Selected lift, estimated 1 rep max", t: "line" }, { k: MUTED, l: "Other lifts", t: "line" }, { k: "var(--gold)", l: "Step on your list, or a PR", t: "dash" }],
    render(w, d) {
      const h = 270, P = { l: 48, r: 110, t: 18, b: 30 }, n = 12, all = Object.values(d.lifts).flat().concat(d.goals[d.focus]);
      const lo = Math.floor((Math.min(...all) - 15) / 50) * 50, hi = Math.ceil((Math.max(...all) + 10) / 50) * 50;
      const y = lin(lo, hi, h - P.b, P.t), x = lin(0, n - 1, P.l, w - P.r);
      let out = gridY(P.l, w - P.r, y, Array.from({ length: (hi - lo) / 50 + 1 }, (_, k) => lo + k * 50));
      const path = (v) => v.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p).toFixed(1)).join("");
      Object.entries(d.lifts).forEach(([k, v]) => {
        if (k === d.focus) return;
        out += `<path d="${path(v)}" fill="none" stroke="${MUTED}" stroke-width="1.6"/><text class="lab" x="${x(n - 1) + 10}" y="${y(v[n - 1]) + 4}" fill="var(--ink-muted)">${k} ${v[n - 1]}</text>`;
      });
      d.goals[d.focus].forEach((gv) => {
        const reached = Math.max(...d.lifts[d.focus]) >= gv;
        out += `<line x1="${P.l}" x2="${w - P.r}" y1="${y(gv)}" y2="${y(gv)}" stroke="var(--gold)" stroke-dasharray="5 5" stroke-opacity="${reached ? 0.45 : 0.85}"/><text class="lab" x="${P.l + 6}" y="${y(gv) - 6}" fill="var(--gold)">${d.focus} ${gv}${reached ? ", reached" : ""}</text>`;
      });
      const v = d.lifts[d.focus];
      out += `<path d="${path(v)}L${x(n - 1)} ${h - P.b}L${x(0)} ${h - P.b}Z" fill="var(--c)" fill-opacity=".1"/><path d="${path(v)}" fill="none" stroke="var(--ct)" stroke-width="2.6" stroke-linejoin="round"/>`;
      let best = 0;
      v.forEach((p, i) => { const pr = p > best; best = Math.max(best, p); out += `<circle cx="${x(i)}" cy="${y(p)}" r="${pr && i ? 4.5 : 3}" fill="${pr && i ? "var(--gold)" : "var(--ct)"}" data-tip="Week of ${md(day(-(n - 1 - i) * 7 - 5))}: ${d.focus} ${p}${pr && i ? ", PR" : ""}"/>`; });
      out += `<text class="lab" x="${x(n - 1) + 10}" y="${y(v[n - 1]) + 4}" fill="var(--ct)" style="font-size:13px">${d.focus} ${v[n - 1]}</text>`;
      out += `<text x="${P.l}" y="${h - 8}">12 weeks ago</text><text x="${w - P.r}" y="${h - 8}" text-anchor="end">This week</text>`;
      return svg(w, h, `${d.focus} estimated one rep max over 12 weeks`, out);
    },
    log: { cta: "Log top set", fields: [{ n: "l", l: "Lift", type: "select", opts: ["Bench", "Squat", "Deadlift"] }, { n: "wt", l: "Weight (lb)", ph: "235", type: "number" }, { n: "reps", l: "Reps", ph: "3", type: "number" }],
      apply(d, v) { if (!v.wt || !v.reps) return null; const e = Math.round(+v.wt * (1 + +v.reps / 30)); const a = d.lifts[v.l]; a[a.length - 1] = Math.max(a[a.length - 1], e); d.focus = v.l; return `${v.l} ${v.wt} x ${v.reps}, about ${e} max.`; } },
    empty: "Log a top set or connect Lifta. Each lift gets its own line.",
  };

  VIZ.running = {
    title: "Build to January 9", sample() {
      return { plan: [8, 10, 10, 12, 13, 12, 15, 16, 17, 18, 16, 20, 21, 22, 18, 24, 25, 20, 15, 13.1], actual: [8, 10, 9, 12, 13, 11, 15, 16], longPlan: [4, 5, 5, 6, 6, 5, 7, 7, 8, 8, 6, 9, 10, 10, 8, 11, 12, 10, 6, 13.1], longActual: [4, 5, 5, 6, 6, 5, 7, 7] };
    },
    takeaway(d) {
      const i = d.actual.length - 1, wk = d.plan.length - 1 - i;
      return `<b>${d.actual[i]} mi</b> this week, ${d.actual[i] >= d.plan[i] ? "on plan" : `${f1(d.plan[i] - d.actual[i])} under plan`}. <b>${wk} weeks</b> to race day. Long run ${d.longActual[i]} mi; the plan peaks at ${Math.max(...d.longPlan.slice(0, -1))}.`;
    },
    legend: [{ k: "var(--athletics)", l: "Miles run" }, { k: "rgba(255,255,255,.18)", l: "Planned" }, { k: "var(--ink)", l: "Long run", t: "line" }, { k: "var(--gold)", l: "Race", t: "diamond" }],
    render(w, d) {
      const h = 260, P = { l: 40, r: 20, t: 26, b: 30 }, n = d.plan.length, y = lin(0, 28, h - P.b, P.t), bw = (w - P.l - P.r) / n, cur = d.actual.length - 1;
      let out = gridY(P.l, w - P.r, y, [0, 10, 20], (v) => v + " mi");
      d.plan.forEach((p, i) => {
        const x = P.l + i * bw + bw * 0.16, bwid = bw * 0.68, race = i === n - 1;
        if (i <= cur) out += `<path d="${topBar(x, y(d.actual[i]), bwid, y(0) - y(d.actual[i]))}" fill="var(--c)" ${i === cur ? 'style="filter:drop-shadow(0 0 8px var(--c))"' : 'fill-opacity=".75"'} data-tip="Week of ${md(day((i - cur) * 7 - 5))}: ${d.actual[i]} of ${p} mi"/>`;
        else out += `<path d="${topBar(x + 0.5, y(p), bwid - 1, y(0) - y(p))}" fill="${race ? "rgba(212,175,55,.08)" : "rgba(255,255,255,.035)"}" stroke="${race ? "var(--gold)" : "rgba(255,255,255,.18)"}" stroke-dasharray="${race ? "0" : "3 3"}" data-tip="Week of ${md(day((i - cur) * 7 - 5))}: ${p} mi planned"/>`;
      });
      const lx = (i) => P.l + i * bw + bw / 2;
      out += `<path d="${d.longActual.map((v, i) => (i ? "L" : "M") + lx(i) + " " + y(v)).join("")}" fill="none" stroke="var(--ink)" stroke-width="2"/>`;
      out += `<path d="M${lx(cur)} ${y(d.longActual[cur])}${d.longPlan.slice(cur + 1).map((v, k) => "L" + lx(cur + 1 + k) + " " + y(v)).join("")}" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="4 4" stroke-opacity=".6"/>`;
      d.longActual.forEach((v, i) => (out += `<circle cx="${lx(i)}" cy="${y(v)}" r="3" fill="var(--ink)"/>`));
      out += `<path d="${diamond(lx(n - 1), y(13.1) - 16, 6)}" fill="var(--gold)"/><text class="lab" x="${lx(n - 1)}" y="${y(13.1) - 28}" text-anchor="end" fill="var(--gold)">Half marathon</text>`;
      out += `<text class="lab" x="${lx(cur)}" y="${y(d.actual[cur]) - 10}" text-anchor="middle" fill="var(--ct)">${d.actual[cur]}</text>`;
      out += `<text x="${P.l}" y="${h - 8}">${md(day(-cur * 7 - 5))}</text><text x="${lx(cur)}" y="${h - 8}" text-anchor="middle">This week</text><text x="${w - P.r}" y="${h - 8}" text-anchor="end">Jan 9</text>`;
      return svg(w, h, "Weekly miles against the plan to the half marathon on January 9", out);
    },
    log: { cta: "Log run", fields: [{ n: "mi", l: "Miles", ph: "4.5", type: "number" }, { n: "k", l: "Type", type: "select", opts: ["Easy", "Long", "Tempo", "Intervals"] }],
      apply(d, v) { if (!v.mi) return null; const i = d.actual.length - 1; d.actual[i] = Math.round((d.actual[i] + +v.mi) * 10) / 10; if (v.k === "Long") d.longActual[i] = Math.max(d.longActual[i], +v.mi); return `Logged ${v.mi} mi ${v.k.toLowerCase()}.`; } },
    empty: "Log a run. The plan to January 9 is drawn ahead of you.",
  };

  const hm = (m) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(Math.round(m % 60)).padStart(2, "0"); };
  VIZ.sleep = {
    title: "Sleep window", sample() {
      const nights = [];
      for (let k = 13; k >= 0; k--) {
        const anchor = k > 6 ? 825 : 810, inWin = rnd() < 0.68, bed = anchor + (inWin ? Math.round((rnd() - 0.5) * 60) : 55 + Math.round(rnd() * 50)), hrs = 6.6 + rnd() * 1.6;
        nights.push({ dt: day(-k), bed, wake: bed + hrs * 60, anchor });
      }
      return { nights };
    },
    inWin: (nt) => Math.abs(nt.bed - nt.anchor) <= 45,
    takeaway(d) {
      const hrs = d.nights.map((nt) => (nt.wake - nt.bed) / 60), ok = d.nights.filter(this.inWin).length;
      return `<b>${f1(avg(hrs))} h</b> on average over 14 nights. In window <b>${ok} of 14</b>. Lights-out anchor is <b>${hm(d.nights.at(-1).anchor + 720)}</b>, stepping 15 min earlier each week to 00:45.`;
    },
    legend: [{ k: "var(--athletics)", l: "In bed, inside the window" }, { k: "#4a4d5e", l: "In bed, outside the window" }, { k: "var(--gold)", l: "Anchor", t: "line" }],
    render(w, d) {
      const rowH = 20, lw = 62, rw = 54, x = lin(540, 1440, lw, w - rw), h = d.nights.length * rowH + 36;
      let out = [540, 720, 900, 1080, 1260, 1440].map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${d.nights.length * rowH}" stroke="${GRID}"/><text x="${x(t)}" y="${h - 10}" text-anchor="middle">${hm(t + 720)}</text>`).join("");
      d.nights.forEach((nt, i) => {
        const y = i * rowH + 4, ok = this.inWin(nt), hrs = (nt.wake - nt.bed) / 60;
        out += `<text x="0" y="${y + 9}" style="font-family:var(--display);font-weight:600" fill="${i === d.nights.length - 1 ? "var(--ink)" : "var(--ink-muted)"}">${wd(nt.dt)} ${nt.dt.getDate()}</text>`;
        out += `<rect x="${x(nt.bed)}" y="${y}" width="${x(nt.wake) - x(nt.bed)}" height="12" rx="4" fill="${ok ? "var(--c)" : "#4a4d5e"}" data-tip="${esc(`Night of ${md(day(-(d.nights.length - i)))}: ${hm(nt.bed + 720)} to ${hm(nt.wake + 720)}, ${f1(hrs)} h${ok ? "" : ", outside window"}`)}"/>`;
        out += `<line x1="${x(nt.anchor)}" x2="${x(nt.anchor)}" y1="${y - 3}" y2="${y + 15}" stroke="var(--gold)" stroke-width="2"/>`;
        out += `<text x="${w}" y="${y + 10}" text-anchor="end" style="font-size:12px;font-weight:600" fill="var(--ink)">${f1(hrs)} h</text>`;
      });
      return svg(w, h, "Bedtime and wake time for 14 nights against the lights-out anchor", out);
    },
    log: { cta: "Log night", fields: [{ n: "b", l: "Lights out", type: "time", ph: "01:20" }, { n: "wk", l: "Woke", type: "time", ph: "08:45" }],
      apply(d, v) { if (!v.b || !v.wk) return null; const toM = (s) => { const [hh, mm] = s.split(":").map(Number); return ((hh * 60 + mm - 720 + 1440) % 1440); }; const b = toM(v.b); let wk = toM(v.wk); if (wk < b) wk += 1440; d.nights.push({ dt: day(0), bed: b, wake: wk, anchor: 810 }); d.nights.shift(); return `Logged ${f1((wk - b) / 60)} h.`; } },
    empty: "Log last night, or connect a sleep tracker later.",
  };

  VIZ.triathlon = {
    title: "Three disciplines", sample() {
      return { run: [60, 75, 70, 95, 105, 90, 120, 130, 140, 150, 140, 160], bike: [45, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], swim: [0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    },
    takeaway(d) { return `Dormant while Running builds to January 9. Your runs still count here: <b>${d.run.at(-1)} min</b> this week, no swims or rides since August.`; },
    legend: [{ k: "var(--athletics)", l: "Run" }, { k: "rgba(242,95,102,.5)", l: "Bike" }, { k: "rgba(255,255,255,.4)", l: "Swim" }],
    render(w, d) {
      const h = 220, P = { l: 48, r: 16, t: 14, b: 28 }, n = d.run.length, y = lin(0, 240, h - P.b, P.t), bw = (w - P.l - P.r) / n;
      let out = gridY(P.l, w - P.r, y, [0, 120, 240], (v) => v + " m");
      for (let i = 0; i < n; i++) {
        const x = P.l + i * bw + bw * 0.2, bwid = bw * 0.6; let acc = 0;
        [["swim", "rgba(255,255,255,.4)"], ["bike", "rgba(242,95,102,.5)"], ["run", "var(--c)"]].forEach(([k, c]) => { const v = d[k][i]; if (!v) return; out += `<rect x="${x}" y="${y(acc + v)}" width="${bwid}" height="${y(acc) - y(acc + v)}" fill="${c}"/>`; acc += v; });
        out += hit(x, P.t, bwid, h - P.t - P.b, `Week of ${md(day(-(n - 1 - i) * 7 - 5))}: run ${d.run[i]}, bike ${d.bike[i]}, swim ${d.swim[i]} min`);
      }
      out += `<text x="${P.l}" y="${h - 8}">12 weeks ago</text><text x="${w - P.r}" y="${h - 8}" text-anchor="end">This week</text>`;
      return svg(w, h, "Weekly minutes by discipline for 12 weeks", out);
    },
    log: { cta: "Log session", fields: [{ n: "k", l: "Discipline", type: "select", opts: ["Swim", "Bike", "Run"] }, { n: "m", l: "Minutes", ph: "40", type: "number" }],
      apply(d, v) { if (!v.m) return null; const k = v.k.toLowerCase(); d[k][d[k].length - 1] += +v.m; return `Logged ${v.m} min ${k}.`; } },
    empty: "Wake Triathlon to start tracking swims and rides.",
  };

  VIZ.food = {
    title: "Fuel", sample() {
      const cal = Array.from({ length: 14 }, (_, i) => (i === 13 ? 1840 : Math.round(2450 + rnd() * 900)));
      const pro = Array.from({ length: 14 }, (_, i) => (i === 13 ? 112 : Math.round(150 + rnd() * 55)));
      return { cal, pro, target: 2900, tol: 0.1, ptarget: 180 };
    },
    takeaway(d) {
      const n = d.cal.length - 1, pOk = d.pro.slice(0, n).filter((p) => p >= d.ptarget).length, cOk = d.cal.slice(0, n).filter((c) => Math.abs(c - d.target) <= d.target * d.tol).length;
      return `Protein hit <b>${pOk} of ${n}</b> days, calories in range <b>${cOk} of ${n}</b>. Today so far: ${comma(d.cal[n])} kcal and ${d.pro[n]} g protein.`;
    },
    legend: [{ k: "var(--nutrition)", l: "On target" }, { k: "#4a4d5e", l: "Off target" }, { k: "rgba(255,255,255,.08)", l: "Calorie range" }, { k: "var(--ink)", l: "Protein target", t: "dash" }],
    render(w, d) {
      const P = { l: 56, r: 16 }, n = d.cal.length, bw = (w - P.l - P.r) / n, cx = (i) => P.l + i * bw + bw / 2;
      const y1 = lin(2000, 3600, 120, 16), lo = d.target * (1 - d.tol), hi = d.target * (1 + d.tol);
      let out = `<text x="0" y="10" style="font-family:var(--display);font-weight:700;letter-spacing:.14em;font-size:10px">CALORIES</text>`;
      out += gridY(P.l, w - P.r, y1, [2000, 2800, 3600], comma);
      out += `<rect x="${P.l}" y="${y1(hi)}" width="${w - P.l - P.r}" height="${y1(lo) - y1(hi)}" fill="rgba(255,255,255,.06)"/><text x="${w - P.r - 4}" y="${y1(hi) - 5}" text-anchor="end">Range ${comma(lo)} to ${comma(hi)}</text>`;
      out += `<path d="${d.cal.map((c, i) => (i ? "L" : "M") + cx(i) + " " + y1(c)).join("")}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.5"/>`;
      d.cal.forEach((c, i) => { const ok = c >= lo && c <= hi, today = i === n - 1; out += `<circle cx="${cx(i)}" cy="${y1(c)}" r="${today ? 5 : 4.5}" fill="${today ? "none" : ok ? "var(--c)" : "#4a4d5e"}" stroke="${today ? "var(--ink)" : "none"}" stroke-dasharray="${today ? "2 2" : 0}" data-tip="${md(day(i - n + 1))}: ${comma(c)} kcal${today ? " so far" : ""}"/>`; });
      const top2 = 150, y2 = lin(0, 220, top2 + 100, top2 + 6);
      out += `<text x="0" y="${top2}" style="font-family:var(--display);font-weight:700;letter-spacing:.14em;font-size:10px">PROTEIN</text>`;
      out += gridY(P.l, w - P.r, y2, [0, 100, 200], (v) => v + " g");
      d.pro.forEach((p, i) => { const ok = p >= d.ptarget, today = i === n - 1; out += `<path d="${topBar(P.l + i * bw + bw * 0.2, y2(p), bw * 0.6, y2(0) - y2(p))}" fill="${today ? "rgba(255,255,255,.12)" : ok ? "var(--c)" : "#4a4d5e"}" data-tip="${md(day(i - n + 1))}: ${p} g${today ? " so far" : ""}"/>`; });
      out += `<line x1="${P.l}" x2="${w - P.r}" y1="${y2(d.ptarget)}" y2="${y2(d.ptarget)}" stroke="var(--ink)" stroke-dasharray="4 4"/><text x="${w - P.r - 4}" y="${y2(d.ptarget) - 5}" text-anchor="end" fill="var(--ink)">${d.ptarget} g</text>`;
      out += `<text x="${P.l}" y="${top2 + 120}">${md(day(-n + 1))}</text><text x="${w - P.r}" y="${top2 + 120}" text-anchor="end">Today</text>`;
      return svg(w, top2 + 126, "Calories against the range and protein against the target for 14 days", out);
    },
    log: { cta: "Log meal", fields: [{ n: "c", l: "Calories", ph: "650", type: "number" }, { n: "p", l: "Protein g", ph: "45", type: "number" }],
      apply(d, v) { if (!v.c && !v.p) return null; const n = d.cal.length - 1; d.cal[n] += +v.c || 0; d.pro[n] += +v.p || 0; return `Meal logged: ${v.c || 0} kcal, ${v.p || 0} g.`; } },
    empty: "Snap a meal or enter calories and protein.",
  };

  VIZ["gut-health"] = {
    title: "Habit grid", sample() {
      const rates = [0.62, 0.4, 0.9, 0.7];
      return { habits: ["Fiber 38 g", "Fermented food", "Water 3 L", "No late snack"], grid: rates.map((r) => Array.from({ length: 28 }, (_, i) => (i === 27 ? null : rnd() < r))) };
    },
    takeaway(d) {
      const tot = d.grid.map((r) => r.filter(Boolean).length), best = tot.indexOf(Math.max(...tot)), worst = tot.indexOf(Math.min(...tot));
      return `${d.habits[best]} is steady, <b>${tot[best]} of 27</b>. ${d.habits[worst]} is the gap, <b>${tot[worst]} of 27</b>.`;
    },
    legend: [{ k: "var(--nutrition)", l: "Done" }, { k: "rgba(255,255,255,.05)", l: "Not done" }],
    render(w, d) {
      const lw = 120, rw = 64, n = 28, gap = 3, wk = 8, cs = Math.max(10, Math.min(26, Math.floor((w - lw - rw - wk * 3) / n) - gap));
      const cx = (i) => lw + i * (cs + gap) + Math.floor(i / 7) * wk;
      let out = "";
      d.grid.forEach((row, r) => {
        const y = r * (cs + 8);
        out += `<text class="lab" x="0" y="${y + cs / 2 + 4}" fill="var(--ink-muted)">${esc(d.habits[r])}</text>`;
        row.forEach((v, i) => (out += v === null ? `<rect x="${cx(i) + 0.5}" y="${y + 0.5}" width="${cs - 1}" height="${cs - 1}" rx="4" fill="none" stroke="var(--ink)" stroke-dasharray="2 2" data-tip="Today: open"/>`
          : `<rect x="${cx(i)}" y="${y}" width="${cs}" height="${cs}" rx="4" fill="${v ? "var(--c)" : "rgba(255,255,255,.05)"}" fill-opacity="${v ? 0.9 : 1}" data-tip="${esc(`${md(day(i - n + 1))}, ${d.habits[r]}: ${v ? "done" : "not done"}`)}"/>`));
        out += `<text x="${w}" y="${y + cs / 2 + 4}" text-anchor="end" style="font-size:12px;font-weight:600" fill="var(--ink)">${row.filter(Boolean).length}/27</text>`;
      });
      const by = d.grid.length * (cs + 8) + 12;
      [0, 7, 14, 21].forEach((i) => (out += `<text x="${cx(i)}" y="${by}">${md(day(i - n + 1))}</text>`));
      return svg(w, by + 6, "Four gut habits over 28 days", out);
    },
    log: { cta: "Save today", fields: [{ n: "h", l: "Done today", type: "multi", opts: ["Fiber 38 g", "Fermented food", "Water 3 L", "No late snack"] }],
      apply(d, v) { const on = (v.h || "").split("|").filter(Boolean); d.habits.forEach((hb, r) => (d.grid[r][27] = on.includes(hb))); return `Saved ${on.length} of 4 for today.`; } },
    empty: "Check off today's habits and the grid starts filling.",
  };

  window.FORGE = { CATS, REGIONS, TIERS, SKILLS, VIZ, SIZE_PTS, ICONS, icon, esc, f1, comma, lin, sum, avg, day, md, wd, mulberry32, TODAY };
})();

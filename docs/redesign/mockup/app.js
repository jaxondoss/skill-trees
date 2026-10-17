/* FORGE mockup app: the board, skill pages, the field, lighting and the power-up. */
(() => {
  const F = window.FORGE, { icon, esc, f1, comma, sum, avg } = F;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = (k) => getComputedStyle(document.documentElement).getPropertyValue("--" + k).trim();
  const TIER_LABEL = { floor: "Floor", standard: "Standard", stretch: "Stretch" };
  const DAY_L = ["S", "M", "T", "W", "T", "F", "S"];
  const GAIN = { floor: 0.3, standard: 0.6, stretch: 1 };
  const opts = { data: "sample", bg: "live", power: "comic", tier: null, sound: true };
  const CATN = Object.fromEntries(F.CATS.map((c) => [c.id, c.name]));

  // ---------------------------------------------------------------- state
  const SAMPLE_VIZ = Object.fromEntries(F.SKILLS.map((s) => [s.slug, F.VIZ[s.slug].sample()]));
  const SAMPLE = {
    weight: [181.2, 181.6, 181.9, 182.1, 182.4, 182.3, 182.9, 183.2, 183.4, 183.6, 183.9, 184.0, 184.2],
    trend: [38.0, 38.3, 38.4, 38.9, 39.1, 39.0, 39.6, 39.8, 40.1, 40.0, 40.4, 40.9, 41.2, 41.0, 41.3, 41.6, 41.5, 41.9, 42.2, 42.1, 42.5, 42.8, 42.7, 43.0, 43.4, 43.2, 43.6, 43.9, 44.0, 44.2],
    completion: [72, 88, 91, 64, 85, 93, 100, 58, 76, 86, 89, 92, 70, 44, 81, 88, 95, 90, 86, 62, 79, 87, 92, 96, 88, 91, 83, 89, 94, 57],
    cal: { 1: 88, 2: 91, 3: 64, 4: 85, 5: 93, 6: 100, 7: 58, 8: 76, 9: 86, 10: 89, 11: 92, 12: 70, 13: 44, 14: 87, 15: 92, 16: 95 },
    sched: [{ t: "08:00", name: "Long run", sub: "Audubon Park loop", cat: "athletics" }, { t: "10:30", name: "Store work", sub: "Listings and ad review", cat: "business", now: true }, { t: "13:00", name: "Problem set 6", sub: "Howard-Tilton, 3rd floor", cat: "school" }, { t: "16:30", name: "Training session", sub: "Reily Center", cat: "athletics" }, { t: "21:30", name: "Plan tomorrow", sub: "Then screens off", cat: "mind" }],
    due: [{ c: "MATH 1210", t: "Problem set 6", h: 30 }, { c: "CMPS 1500", t: "Lab 4", h: 74 }, { c: "ARCH 1110", t: "Studio pinup", h: 122 }],
    journal: [{ text: "Skipped the late snack. Noticed I was bored, not hungry.", mood: "Clear", when: "Yesterday, 22:12" }, { text: "Calc quiz went fine. Still rushing the setup on series problems.", mood: "Steady", when: "Thu, 15:40" }],
    activity: [{ cat: "athletics", what: "Logged Planned run at Standard", kind: "Goal", when: "09:05", skill: "running" }, { cat: "nutrition", what: "Logged Gut habits at Standard", kind: "Goal", when: "08:40", skill: "gut-health" }, { cat: "athletics", what: "Logged Training session at Standard", kind: "Goal", when: "Yesterday", skill: "strength" }, { cat: "athletics", what: "Bench top set 235 x 3", kind: "Number", when: "Yesterday", skill: "strength" }, { cat: "mind", what: "Journal: Skipped the late snack", kind: "Journal", when: "Yesterday", skill: "meditation" }, { cat: "business", what: "Store revenue this week $690", kind: "Number", when: "Thu", skill: "dropshipping" }, { cat: "school", what: "Logged Deep study block at Floor", kind: "Goal", when: "Thu", skill: "academics" }, { cat: "mind", what: "Chess rating 1086", kind: "Number", when: "Thu", skill: "chess" }],
  };
  let S;
  function build(mode) {
    const fresh = mode === "fresh";
    const skills = F.SKILLS.map((sk) => {
      const c = structuredClone(sk);
      c.viz = structuredClone(SAMPLE_VIZ[sk.slug]);
      c.ideas = { goals: structuredClone(sk.goals).map((x) => ({ ...x, today: null, result: null })), steps: structuredClone(sk.steps).map((x) => ({ ...x, done: false })) };
      c.goals.forEach((x, i) => (x.id = `${sk.slug}-g${i}`));
      c.steps.forEach((x, i) => (x.id = `${sk.slug}-s${i}`));
      if (fresh) { c.goals = []; c.steps = []; c.identity = ""; c.vizEmpty = true; if (c.score !== null) c.score = 0; }
      return c;
    });
    S = {
      fresh, skills, editing: null, scope: "today", filter: null, uid: 0, numOverride: {},
      weight: fresh ? [] : SAMPLE.weight.slice(),
      trend: fresh ? [] : SAMPLE.trend.slice(), completion: fresh ? [] : SAMPLE.completion.slice(), cal: fresh ? {} : { ...SAMPLE.cal },
      sched: SAMPLE.sched, due: SAMPLE.due, streak: fresh ? 0 : 6, best: fresh ? 0 : 12,
      journal: fresh ? [] : structuredClone(SAMPLE.journal), activity: fresh ? [] : structuredClone(SAMPLE.activity),
    };
  }
  const skill = (slug) => S.skills.find((s) => s.slug === slug);
  const catScore = (cat) => { const a = S.skills.filter((s) => s.cat === cat && s.score !== null); return a.length ? avg(a.map((s) => s.score)) : 0; };
  const overall = () => avg(F.CATS.map((c) => catScore(c.id)));
  const tierFor = (o) => F.TIERS.slice().reverse().find((t) => o >= t.at) || F.TIERS[0];
  const tier = () => (opts.tier ? F.TIERS[opts.tier - 1] : tierFor(overall()));
  const todayGoals = () => S.skills.flatMap((sk) => sk.goals.filter((g) => g.today).map((g) => ({ sk, g })));
  const todayPct = () => { const core = todayGoals().filter((x) => x.g.today !== "Stretch"); return core.length ? Math.round((100 * sum(core.map((x) => (x.g.result ? (x.g.result === "floor" ? 0.5 : 1) : 0)))) / core.length) : 0; };

  // ---------------------------------------------------------------- small pieces
  const ramp = (p) => (p === null || p === undefined ? null : p >= 85 ? css("r5") : p >= 70 ? css("r4") : p >= 50 ? css("r3") : p >= 25 ? css("r2") : p > 0 ? css("r1") : css("r0"));
  function spark(v, color) {
    if (v.length < 2) return "";
    const w = 120, h = 30, lo = Math.min(...v), hi = Math.max(...v), sp = hi - lo || 1;
    const pts = v.map((x, i) => [(i / (v.length - 1)) * (w - 6) + 3, h - 4 - ((x - lo) / sp) * (h - 8)]);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="2.5" fill="${color}"/></svg>`;
  }
  const daysText = (d) => (d.length === 7 ? "Daily" : d.join() === "1,2,3,4,5" ? "Weekdays" : d.map((x) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x]).join(" "));

  // ---------------------------------------------------------------- goal and step rows
  function goalRow(sk, g, where) {
    const timed = g.progress !== undefined && g.mins;
    const t = g.result || "standard";
    let h = `<li class="row c-${sk.cat} ${g.result ? "done" : ""}" data-goal="${g.id}">
      <button class="check" type="button" aria-pressed="${!!g.result}" aria-label="${g.result ? "Undo" : "Log"} ${esc(g.title)}"><span></span></button>
      <div class="rt"><div class="t1">${esc(g.title)}</div><div class="t2">${where === "today" ? `<em>${esc(sk.name)}</em>` : `<em>${daysText(g.days)}</em>`}<span>${esc(g.note || g[t] || g.standard || "Add details")}</span></div></div>
      <div class="rside">${g.today === "Stretch" ? `<span class="tier stretch">Stretch</span>` : g.floor || g.stretch ? `<span class="tier ${g.result === "stretch" ? "stretch" : ""}">${TIER_LABEL[t]}</span>` : ""}${g.mins ? `<span class="m">${g.mins[t]}m</span>` : ""}<button class="pencil" type="button" data-edit-goal="${g.id}" aria-label="Edit ${esc(g.title)}">${icon("pencil")}</button></div>`;
    if (timed) {
      const tierNow = g.progress >= g.mins.stretch ? "stretch" : g.progress >= g.mins.standard ? "standard" : g.progress >= g.mins.floor ? "floor" : null;
      h += `<div class="prog"><label class="sr" for="pr-${g.id}">Minutes on ${esc(g.title)}</label><input type="range" id="pr-${g.id}" data-prog="${g.id}" min="0" max="${g.mins.stretch}" step="5" value="${g.progress}" style="--p:${(100 * g.progress) / g.mins.stretch}%"><output>${g.progress} of ${g.mins.standard} min${tierNow ? ", " + TIER_LABEL[tierNow] : ""}</output></div>`;
    }
    if (S.editing === g.id) h += goalEditor(sk, g, where);
    return h + "</li>";
  }
  function goalEditor(sk, g, where) {
    return `<form class="editor" data-goal-editor="${g.id}">
      <label>Title<input class="field" name="title" value="${esc(g.title)}" autocomplete="off" required></label>
      <label>What the task involves<textarea class="field" name="note" rows="2" placeholder="Where, how, what counts as done" autocomplete="off">${esc(g.note)}</textarea></label>
      <div class="tiers">${["floor", "standard", "stretch"].map((t) => `<label>${TIER_LABEL[t]}<input class="field" name="${t}" value="${esc(g[t])}" placeholder="${t === "standard" ? "What a normal day looks like" : t === "floor" ? "The bad-day minimum" : "The great-day version"}" autocomplete="off"></label><label>Min<input class="field" name="${t}-m" type="number" min="0" inputmode="numeric" value="${g.mins ? g.mins[t] : ""}" placeholder="0"></label>`).join("")}</div>
      <div><div class="lbl" style="margin-bottom:6px">Repeats on</div><div class="days" role="group" aria-label="Repeats on">${DAY_L.map((l, i) => `<button type="button" data-day="${i}" aria-pressed="${g.days.includes(i)}" aria-label="${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}">${l}</button>`).join("")}</div></div>
      <div class="acts">${where === "today" ? `<div class="seg" role="group" aria-label="Apply to"><button type="button" data-scope="today" aria-pressed="${S.scope === "today"}">Today only</button><button type="button" data-scope="always" aria-pressed="${S.scope === "always"}">From now on</button></div>` : `<button class="btn quiet" type="button" data-del-goal="${g.id}">Delete</button>`}
        <div><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary c-${sk.cat}" type="submit">Save</button></div></div></form>`;
  }
  function stepRow(sk, st) {
    let h = `<li class="row step c-${sk.cat} ${st.done ? "done" : ""}" data-step="${st.id}">
      <button class="check" type="button" aria-pressed="${st.done}" aria-label="${st.done ? "Unclaim" : "Claim"} ${esc(st.title)}"><span></span></button>
      <div class="rt"><div class="t1">${esc(st.title)}</div>${st.note ? `<div class="t2"><span>${esc(st.note)}</span></div>` : ""}</div>
      <div class="rside"><span class="pts">+${F.SIZE_PTS[st.size]}</span><button class="pencil" type="button" data-edit-step="${st.id}" aria-label="Edit ${esc(st.title)}">${icon("pencil")}</button></div>`;
    if (S.editing === st.id) h += `<form class="editor" data-step-editor="${st.id}">
      <label>Step<input class="field" name="title" value="${esc(st.title)}" autocomplete="off" required></label>
      <label>Details<textarea class="field" name="note" rows="2" placeholder="What done looks like, links, who to ask" autocomplete="off">${esc(st.note)}</textarea></label>
      <label>Done when, optional<input class="field" name="rule" value="${esc(st.rule || "")}" placeholder="Claims itself when a number reaches a value" autocomplete="off"></label>
      <div><div class="lbl" style="margin-bottom:6px">Size</div><div class="seg" role="group" aria-label="Size">${["S", "M", "L"].map((z) => `<button type="button" data-size="${z}" aria-pressed="${st.size === z}">${{ S: "Small", M: "Medium", L: "Large" }[z]}, ${F.SIZE_PTS[z]}</button>`).join("")}</div></div>
      <div class="acts"><button class="btn quiet" type="button" data-del-step="${st.id}">Delete</button><div><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary c-${sk.cat}" type="submit">Save</button></div></div></form>`;
    return h + "</li>";
  }
  const emptyBlock = (title, body, ideas, kind, slug) => `<div class="empty">${icon("list").replace("<svg", '<svg class="ico"')}<b>${title}</b><span>${body}</span>${ideas.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:4px">${ideas.slice(0, 3).map((x, i) => `<button class="chip n" type="button" data-idea="${kind}:${slug}:${i}">${icon("plus").replace("<svg", '<svg class="ico" style="width:12px;height:12px"')}${esc(x.title)}</button>`).join("")}</div>` : ""}</div>`;

  // ---------------------------------------------------------------- dashboard
  function viewBoard() {
    const t = tier(), o = overall(), next = F.TIERS[t.n] || null, pct = todayPct();
    const tg = todayGoals(), groups = ["Rack", "Balance", "Stretch"];
    const today = tg.length
      ? groups.map((k) => { const list = tg.filter((x) => x.g.today === k); return list.length ? `<div class="group lbl">${k === "Stretch" ? "Stretch, optional" : k}</div><ul class="rows">${list.map((x) => goalRow(x.sk, x.g, "today")).join("")}</ul>` : ""; }).join("")
      : emptyBlock("Nothing planned for today", "Add a goal here or on any skill page. Goals repeat on the days you pick.", [], "", "");
    const nums = numTiles();
    return `
    <section class="tile hero c-gold" id="hero" style="--aura:${t.aura}" aria-label="The statue">
      <div class="left">
        <div class="lbl">The statue</div>
        <div class="score" id="score">${f1(o)}</div>
        <div class="tiername">${t.num} ${t.name}</div>
        <div class="next">${next ? `Next tier at <b>${next.at}</b>` : "Top tier"}</div>
        <div class="cats">${F.CATS.map((c) => `<div class="catrow c-${c.id}" data-cat="${c.id}"><span>${c.name}</span><b>${Math.round(catScore(c.id))}</b><i><em style="--p:${catScore(c.id)}%"></em></i></div>`).join("")}</div>
      </div>
      <div class="stage" id="stage">
        <div class="halo"></div><div class="halftone"></div>
        <svg class="rays" id="rays" viewBox="0 0 400 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${rays()}</svg>
        <div class="statue" id="statue" style="--reach:${t.reach}%"><div class="px" id="px">
          <img src="assets/statue-base.webp" alt="">
          <div class="veinwrap">${Object.entries(F.REGIONS).map(([k, poly]) => { const c = F.CATS.find((x) => x.regions.includes(k)); return `<img class="vein" data-cat="${c.id}" src="assets/statue-veins.webp" alt="" style="opacity:${(0.55 + 0.45 * (catScore(c.id) / 100)).toFixed(2)};clip-path:polygon(${poly.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(",")})">`; }).join("")}<img class="bloom" src="assets/statue-bloom.png" alt=""></div>
          <div class="surge" id="surge"><img class="b" src="assets/statue-bloom.png" alt=""><img src="assets/statue-veins.webp" alt=""></div>
        </div></div>
      </div>
    </section>

    <section class="tile today" aria-labelledby="h-today">
      <div class="thead"><span class="lbl" id="h-today">Today</span><span class="meta">${tg.filter((x) => x.g.result && x.g.today !== "Stretch").length} of ${tg.filter((x) => x.g.today !== "Stretch").length} done</span></div>
      <div class="progress" aria-hidden="true"><b style="width:${pct}%"></b></div>
      <div>${today}</div>
      <form class="adder" data-add-today><label class="sr" for="add-today">New goal</label><input class="field" id="add-today" name="title" placeholder="Add a goal for today…" autocomplete="off"><label class="sr" for="add-today-sk">Skill</label><select class="field" id="add-today-sk" name="skill">${S.skills.filter((s) => !s.dormant).map((s) => `<option value="${s.slug}">${esc(s.name)}</option>`).join("")}</select><button class="btn ghost" type="submit">${icon("plus").replace("<svg", '<svg class="ico" style="width:14px;height:14px"')}Add</button></form>
    </section>

    <div class="rcol">
      <section class="tile ringtile" aria-label="Today and streak">
        <div class="ring" style="--p:${pct}"><span>${pct}<small>%</small></span></div>
        <div class="kv"><div><span>Today</span><b>${pct}%</b></div><div><span>Streak</span><b class="gold">${S.streak} days</b></div><div><span>Best</span><b>${S.best}</b></div></div>
      </section>
      <section class="tile" aria-labelledby="h-sched"><div class="thead"><span class="lbl" id="h-sched">Next up</span><span class="meta">Sat</span></div>
        <ul class="list">${S.sched.map((s) => `<li class="sched c-${s.cat} ${s.now ? "now" : ""}"><time>${s.t}</time><div class="blk"><b>${esc(s.name)}</b><span>${esc(s.sub)}</span></div></li>`).join("")}</ul></section>
      <section class="tile" aria-labelledby="h-due"><div class="thead"><span class="lbl" id="h-due">Due soon</span><span class="meta">Canvas</span></div>
        <ul class="list">${S.due.map((d) => `<li class="due ${d.h <= 48 ? "soon" : ""}"><div><b>${esc(d.t)}</b><span>${esc(d.c)}</span></div><span class="when">${d.h <= 48 ? d.h + " h" : Math.round(d.h / 24) + " days"}</span></li>`).join("")}</ul></section>
    </div>

    <div class="sec"><h2>Skills</h2><span class="meta">${S.skills.filter((s) => !s.dormant).length} active</span>${S.filter ? `<span class="tools"><button class="btn quiet" type="button" data-clear-filter>Show all</button></span>` : ""}</div>
    <div class="skills ${S.filter ? "filter" : ""}">${S.skills.map(skillTile).join("")}</div>

    <div class="sec"><h2>Numbers</h2><span class="meta">Tap to log</span></div>
    <div class="nums">${nums}</div>

    <div class="sec"><h2>Record</h2></div>
    <section class="tile r-cal" aria-labelledby="h-cal"><div class="thead"><span class="lbl" id="h-cal">October</span><span class="meta">Streak ${S.streak}, best ${S.best}</span></div>${calendar()}
      <div class="calkey" aria-hidden="true"><span>Less</span>${[1, 2, 3, 4, 5].map((k) => `<i style="background:var(--r${k})"></i>`).join("")}<span>More</span><span class="gl"></span><span>Kept run</span></div></section>
    <section class="tile r-trend" aria-labelledby="h-trend"><div class="thead"><span class="lbl" id="h-trend">${S.trendMode === "done" ? "Completion, 30 days" : "Overall score, 30 days"}</span><div class="seg" role="group" aria-label="Chart"><button type="button" data-trend="score" aria-pressed="${S.trendMode !== "done"}">Score</button><button type="button" data-trend="done" aria-pressed="${S.trendMode === "done"}">Completion</button></div></div><div data-chart="trend"></div></section>
    <section class="tile r-journal c-mind" aria-labelledby="h-journal"><div class="thead"><span class="lbl" id="h-journal">Journal</span><button class="btn ghost" type="button" data-open-log>New entry</button></div>
      ${S.journal.length ? `<ul class="jlist">${S.journal.slice(0, 3).map((j) => `<li><span>${esc(j.text)}</span><span class="jm">${j.mood ? `<b>${esc(j.mood)}</b>` : ""}<span>${esc(j.when)}</span></span></li>`).join("")}</ul>` : emptyBlock("No entries yet", "Quick notes about your day and your head. They save to Mind.", [], "", "")}</section>
    <section class="tile r-act" aria-labelledby="h-act"><div class="thead"><span class="lbl" id="h-act">Activity</span></div>
      ${S.activity.length ? `<ul class="acts">${S.activity.slice(0, 8).map((a) => `<li class="c-${a.cat}"><i></i><span>${esc(a.what)}</span><span class="k">${a.kind}</span><span class="w">${a.when}</span></li>`).join("")}</ul>` : `<div class="sub">Everything you log shows up here, newest first.</div>`}</section>`;
  }
  function skillTile(sk) {
    const core = sk.goals[0], doneSteps = sk.steps.filter((s) => s.done).length;
    let sub, status, quiet = false;
    if (sk.dormant) { sub = "Dormant"; status = "Wake it when you are ready"; quiet = true; }
    else if (!sk.goals.length && !sk.steps.length) { sub = "Empty to-do list"; status = "Add your first goal"; quiet = true; }
    else {
      sub = `${sk.rack ? "Rack, " : ""}${sk.goals.length} goal${sk.goals.length === 1 ? "" : "s"}, ${doneSteps} of ${sk.steps.length} steps`;
      const tg = sk.goals.find((g) => g.today);
      status = tg ? (tg.result ? `${tg.title}, ${TIER_LABEL[tg.result]}` : tg.progress !== undefined ? `${tg.title}, ${tg.progress} of ${tg.mins.standard} min` : `${tg.title} is open`) : core ? `${core.title}, ${daysText(core.days).toLowerCase()}` : "Steps only";
      quiet = !tg || !tg.result;
    }
    return `<a class="tile glow skill c-${sk.cat} ${S.filter === sk.cat ? "on" : ""} ${sk.dormant ? "dormant" : ""}" href="#/skill/${sk.slug}" data-skill-tile="${sk.slug}">
      <span class="icon">${icon(sk.slug)}</span><span class="corner">${sk.score === null ? "-" : Math.round(sk.score)}</span>
      <div class="title">${esc(sk.name)}</div><div class="sub">${esc(sub)}</div><div class="status ${quiet ? "quiet" : ""}">${esc(status)}</div>
      <div class="bar"><b style="--p:${sk.score || 0}%"></b></div></a>`;
  }
  const NUMS = [
    { k: "weight", l: "Bodyweight", u: "lb", cat: "athletics", get: () => S.weight.at(-1), series: () => S.weight, set: (v) => S.weight.push(v) },
    { k: "sleep", l: "Sleep, 14 nights", u: "h", cat: "athletics", sk: "sleep", get: (d) => avg(d.nights.map((n) => (n.wake - n.bed) / 60)), series: (d) => d.nights.map((n) => (n.wake - n.bed) / 60), set: (v, d) => { const b = 810; d.nights.push({ dt: F.day(0), bed: b, wake: b + v * 60, anchor: 810 }); d.nights.shift(); } },
    { k: "chess", l: "Chess, rapid", u: "", cat: "mind", sk: "chess", get: (d) => d.ratings.at(-1), series: (d) => d.ratings, set: (v, d) => { d.ratings.push(v); d.ratings.shift(); } },
    { k: "rev", l: "Revenue, this week", u: "$", cat: "business", sk: "dropshipping", get: (d) => d.rev.at(-1), series: (d) => d.rev, set: (v, d) => (d.rev[d.rev.length - 1] = v) },
    { k: "miles", l: "Miles, this week", u: "mi", cat: "athletics", sk: "running", get: (d) => d.actual.at(-1), series: (d) => d.actual, set: (v, d) => (d.actual[d.actual.length - 1] = v) },
    { k: "wpm", l: "Reading rate", u: "wpm", cat: "school", sk: "reading", get: (d) => d.tests.at(-1).v, series: (d) => d.tests.map((t) => t.v), set: (v, d) => d.tests.push({ d: "Oct 17", v }) },
  ];
  function numVal(n) {
    if (S.numOverride[n.k] !== undefined) return S.numOverride[n.k];
    if (S.fresh) return null;
    return n.sk ? n.get(skill(n.sk).viz) : n.get();
  }
  function numTiles() {
    return NUMS.map((n) => {
      const v = numVal(n), d = n.sk ? skill(n.sk).viz : null, series = S.fresh ? [] : n.sk ? n.series(d) : n.series();
      const shown = v === null ? `<span style="color:var(--ink-label)">-</span>` : n.u === "$" ? `$${comma(v)}` : `${n.k === "sleep" || n.k === "weight" || n.k === "miles" ? f1(v) : comma(v)}<small>${n.u}</small>`;
      return `<button class="tile glow num c-${n.cat}" type="button" data-num="${n.k}"><span class="lbl">${n.l}</span>${spark(series, "var(--ct)")}<div class="val">${shown}</div><div class="sub">${v === null ? "Tap to log the first one" : "Tap to log"}</div><div class="bar"><b style="--p:0%"></b></div></button>`;
    }).join("");
  }
  function calendar() {
    const first = 3, kept = (d) => (S.cal[d] ?? -1) >= 85;
    let h = `<div class="cal">${["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="dow" aria-hidden="true">${d}</div>`).join("")}`;
    for (let i = 0; i < first; i++) h += "<span></span>";
    for (let d = 1; d <= 31; d++) {
      const p = d === 17 ? todayPct() : S.cal[d] ?? null, c7 = (first + d - 1) % 7, bg = d <= 17 && p !== null && (d < 17 || p > 0) ? ramp(p) : null;
      let streak = "";
      if (kept(d)) { const l = c7 > 0 && kept(d - 1), r = c7 < 6 && kept(d + 1); streak = `<span class="streak" style="border-left-width:${l ? 0 : 2}px;border-right-width:${r ? 0 : 2}px;border-radius:${l ? 0 : 9}px ${r ? 0 : 9}px ${r ? 0 : 9}px ${l ? 0 : 9}px;${l ? "left:-3px;" : ""}${r ? "right:-6px;" : ""}"></span>`; }
      h += `<button type="button" class="${bg ? "lit" : ""} ${d === 17 ? "is-today" : ""} ${bg && p >= 50 ? "dark" : ""}" style="${bg ? `background:${bg};--bg:${bg}` : ""}" data-tip="Oct ${d}: ${p === null ? (d > 17 ? "ahead" : "no plan") : p + "%"}" aria-label="October ${d}, ${p === null ? "no plan" : p + "%"}${kept(d) ? ", kept" : ""}">${d}${streak}</button>`;
    }
    return h + "</div>";
  }
  function rays() {
    const cx = 200, cy = 200; let d = "";
    for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2 + (i % 3) * 0.02, r1 = 120 + ((i * 37) % 40), r2 = 260 + ((i * 53) % 120); d += `M${(cx + r1 * Math.cos(a)).toFixed(1)} ${(cy + r1 * Math.sin(a)).toFixed(1)}L${(cx + r2 * Math.cos(a)).toFixed(1)} ${(cy + r2 * Math.sin(a)).toFixed(1)}`; }
    return `<path d="${d}" stroke="var(--gold-hi)" stroke-width="2" stroke-linecap="round" opacity=".6"/><path d="${d}" stroke="var(--ink)" stroke-width=".8" opacity=".45" transform="rotate(2.5 ${cx} ${cy})"/>`;
  }
  function trendChart(w) {
    const h = 170, P = { l: 34, r: 10, t: 12, b: 22 };
    if (S.trendMode === "done") {
      const v = S.completion; if (!v.length) return `<div class="sub">Completion shows up after your first day with goals.</div>`;
      const bw = (w - P.l - P.r) / v.length, y = F.lin(0, 100, h - P.b, P.t);
      let out = `<line x1="${P.l}" x2="${w - P.r}" y1="${y(85)}" y2="${y(85)}" stroke="var(--gold)" stroke-dasharray="3 4" stroke-opacity=".7"/><text x="${P.l - 6}" y="${y(85) + 3.5}" text-anchor="end">85</text><text x="${P.l - 6}" y="${y(0) + 3.5}" text-anchor="end">0</text>`;
      v.forEach((p, i) => { const x = P.l + i * bw + 1; out += `<rect x="${x}" y="${y(p)}" width="${bw - 2}" height="${y(0) - y(p)}" rx="2" fill="${ramp(p)}" data-tip="${i === v.length - 1 ? "Today" : v.length - 1 - i + " days ago"}: ${p}%"/>${p >= 85 ? `<rect x="${x}" y="${y(p)}" width="${bw - 2}" height="2" fill="var(--gold)"/>` : ""}`; });
      return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Daily completion for 30 days">${out}</svg>`;
    }
    const v = S.trend; if (!v.length) return `<div class="sub">Your score line starts with the first logged goal.</div>`;
    const lo = Math.floor(Math.min(...v) - 2), hi = Math.ceil(Math.max(...v) + 2), x = F.lin(0, v.length - 1, P.l, w - P.r), y = F.lin(lo, hi, h - P.b, P.t);
    const line = v.map((s, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(s).toFixed(1)).join("");
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Overall score from ${f1(v[0])} to ${f1(v.at(-1))} over 30 days">
      <defs><linearGradient id="tg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#d4af37" stop-opacity=".28"/><stop offset="1" stop-color="#d4af37" stop-opacity="0"/></linearGradient></defs>
      ${[lo, Math.round((lo + hi) / 2), hi].map((g) => `<line x1="${P.l}" x2="${w - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="rgba(255,255,255,.06)"/><text x="${P.l - 6}" y="${y(g) + 3.5}" text-anchor="end">${g}</text>`).join("")}
      <path d="${line}L${x(v.length - 1)} ${h - P.b}L${x(0)} ${h - P.b}Z" fill="url(#tg)"/><path d="${line}" fill="none" stroke="var(--gold)" stroke-width="2.2"/>
      <circle cx="${x(v.length - 1)}" cy="${y(v.at(-1))}" r="4.5" fill="var(--gold)" style="filter:drop-shadow(0 0 6px #d4af37)"/><text class="lab" x="${x(v.length - 1) - 8}" y="${y(v.at(-1)) - 10}" text-anchor="end" fill="var(--gold)">${f1(v.at(-1))}</text>
      <text x="${P.l}" y="${h - 4}">Sep 18</text><text x="${w - P.r}" y="${h - 4}" text-anchor="end">Today</text>
      ${v.map((s, i) => `<rect x="${x(i) - 6}" y="${P.t}" width="12" height="${h - P.t - P.b}" fill="transparent" data-tip="${i === v.length - 1 ? "Today" : v.length - 1 - i + " days ago"}: ${f1(s)}"/>`).join("")}</svg>`;
  }

  // ---------------------------------------------------------------- skill page
  function viewSkill(slug) {
    const sk = skill(slug); if (!sk) { location.hash = "#/"; return ""; }
    const V = F.VIZ[slug], doneSteps = sk.steps.filter((s) => s.done), lvl = Math.min(100, sum(doneSteps.map((s) => F.SIZE_PTS[s.size])));
    const recent = S.activity.filter((a) => a.skill === slug);
    return `
    <section class="tile glow sk-head c-${sk.cat}">
      <span class="icon" style="width:52px;height:52px;border-radius:14px">${icon(slug).replace("<svg", '<svg style="width:26px;height:26px"')}</span>
      <div style="min-width:0"><a class="back" href="#/">${icon("back").replace("<svg", '<svg class="ico"')}Overview</a>
        <div class="lbl" style="margin-top:8px">${CATN[sk.cat]}${sk.rack ? ", on the rack" : ""}${sk.dormant ? ", dormant" : ""}</div>
        <h1>${esc(sk.name)}</h1>
        <div class="identity" contenteditable="plaintext-only" role="textbox" aria-label="Who you are becoming" data-identity="${slug}" data-ph="Write who you are becoming in ${esc(sk.name)}.">${esc(sk.identity)}</div></div>
      <div class="stats">${sk.dormant ? `<button class="btn primary c-${sk.cat}" type="button" data-wake="${slug}">Wake ${esc(sk.name)}</button>` : ""}
        <div class="kv"><div><span>Goals</span><b>${sk.goals.length}</b></div><div><span>Steps</span><b>${doneSteps.length} of ${sk.steps.length}</b></div><div><span>Level from steps</span><b class="gold">${lvl}</b></div></div>
        <div class="ring cat" style="--p:${sk.score || 0};--size:96px"><span>${sk.score === null ? "-" : Math.round(sk.score)}</span></div></div>
    </section>

    <div class="sec"><h2>To do</h2><span class="meta">Tap a row to fill in the details</span></div>
    <section class="tile sk-goals c-${sk.cat}" aria-labelledby="h-goals">
      <div class="thead"><span class="lbl" id="h-goals">Goals</span><span class="meta">Repeat on the days you pick</span></div>
      ${sk.goals.length ? `<ul class="rows">${sk.goals.map((g) => goalRow(sk, g, "skill")).join("")}</ul>` : emptyBlock("No goals yet", `What will you do for ${esc(sk.name)}, and on which days?`, sk.ideas.goals, "goal", slug)}
      <form class="adder" data-add-goal="${slug}" style="grid-template-columns:minmax(0,1fr) auto"><label class="sr" for="ag-${slug}">New goal</label><input class="field" id="ag-${slug}" name="title" placeholder="Add a goal for ${esc(sk.name)}…" autocomplete="off"><button class="btn ghost" type="submit">${icon("plus").replace("<svg", '<svg class="ico" style="width:14px;height:14px"')}Add</button></form>
    </section>
    <section class="tile sk-steps c-${sk.cat}" aria-labelledby="h-steps">
      <div class="thead"><span class="lbl" id="h-steps">Steps</span><span class="meta">One time, each raises the level</span></div>
      ${sk.steps.length ? `<ul class="rows">${sk.steps.map((st) => stepRow(sk, st)).join("")}</ul>` : emptyBlock("No steps yet", `The milestones between you and 100 in ${esc(sk.name)}.`, sk.ideas.steps, "step", slug)}
      <form class="adder" data-add-step="${slug}" style="grid-template-columns:minmax(0,1fr) auto"><label class="sr" for="as-${slug}">New step</label><input class="field" id="as-${slug}" name="title" placeholder="Add a step…" autocomplete="off"><button class="btn ghost" type="submit">${icon("plus").replace("<svg", '<svg class="ico" style="width:14px;height:14px"')}Add</button></form>
    </section>

    <div class="sec"><h2>The numbers</h2><span class="meta">${esc(V.title)}</span></div>
    <section class="tile glow sk-viz c-${sk.cat}" aria-labelledby="h-viz">
      <div class="viz-head"><div><div class="lbl">${esc(sk.name)}</div><h3 id="h-viz">${esc(V.title)}</h3><p class="takeaway">${sk.vizEmpty ? esc(V.empty) : V.takeaway.call(V, sk.viz)}</p></div>${V.controls && !sk.vizEmpty ? V.controls(sk.viz) : ""}</div>
      <div class="viz-body" data-chart="viz" data-slug="${slug}"></div>
      <div class="viz-legend">${V.legend.map((l) => `<span><i class="${l.t === "line" ? "line" : l.t === "dash" ? "dash" : ""}" style="--k:${l.k};${l.t === "dot" ? "border-radius:50%" : l.t === "diamond" ? "transform:rotate(45deg) scale(.8);border-radius:2px" : ""}"></i>${esc(l.l)}</span>`).join("")}</div>
      ${vizLog(sk, V)}
    </section>

    <section class="tile sk-log c-${sk.cat}" aria-labelledby="h-rec"><div class="thead"><span class="lbl" id="h-rec">Recent</span></div>
      ${recent.length ? `<ul class="acts" style="grid-template-columns:1fr">${recent.slice(0, 6).map((a) => `<li class="c-${a.cat}"><i></i><span>${esc(a.what)}</span><span class="k">${a.kind}</span><span class="w">${a.when}</span></li>`).join("")}</ul>` : `<div class="sub">Logs for ${esc(sk.name)} show up here.</div>`}</section>
    <section class="tile sk-hist c-${sk.cat}" aria-labelledby="h-hist"><div class="thead"><span class="lbl" id="h-hist">Score, 30 days</span><span class="meta">${sk.score === null ? "-" : Math.round(sk.score)}</span></div><div data-chart="skhist" data-slug="${slug}"></div></section>`;
  }
  function vizLog(sk, V) {
    if (sk.dormant) return "";
    const L = V.log;
    const field = (f) => {
      const id = `vl-${sk.slug}-${f.n}`;
      if (f.type === "select") return `<label for="${id}">${f.l}<select class="field" id="${id}" name="${f.n}">${f.opts.map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>`;
      if (f.type === "seg" || f.type === "multi") return `<div style="display:grid;gap:4px"><span class="lbl" style="font-size:10px">${f.l}</span><div class="seg" role="group" aria-label="${f.l}" data-${f.type}="${f.n}">${f.opts.map((o) => `<button type="button" data-v="${esc(o)}" aria-pressed="false">${esc(o)}</button>`).join("")}</div><input type="hidden" name="${f.n}"></div>`;
      return `<label for="${id}">${f.l}<input class="field" id="${id}" name="${f.n}" type="${f.type === "number" ? "number" : f.type === "time" ? "time" : "text"}" ${f.type === "number" ? 'inputmode="decimal" step="any"' : ""} placeholder="${esc(f.ph || "")}" autocomplete="off"></label>`;
    };
    return `<form class="viz-log" data-viz-log="${sk.slug}">${L.fields.map(field).join("")}<button class="btn primary c-${sk.cat}" type="submit" style="min-height:38px">${esc(L.cta)}</button></form>`;
  }
  function skHist(w, sk) {
    if (S.fresh || sk.score === null) return `<div class="sub">Your score line starts with the first log.</div>`;
    const r = F.mulberry32(sk.slug.length * 991), v = []; let x = sk.score - 7 - r() * 4;
    for (let i = 0; i < 30; i++) { x += (sk.score - x) / (30 - i) + (r() - 0.45) * 0.8; v.push(i === 29 ? sk.score : x); }
    const h = 150, P = { l: 30, r: 10, t: 10, b: 20 }, lo = Math.floor(Math.min(...v) - 1), hi = Math.ceil(Math.max(...v) + 1), X = F.lin(0, 29, P.l, w - P.r), Y = F.lin(lo, hi, h - P.b, P.t);
    const line = v.map((s, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(s).toFixed(1)).join("");
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(sk.name)} score over 30 days">${[lo, hi].map((g) => `<line x1="${P.l}" x2="${w - P.r}" y1="${Y(g)}" y2="${Y(g)}" stroke="rgba(255,255,255,.06)"/><text x="${P.l - 6}" y="${Y(g) + 3.5}" text-anchor="end">${g}</text>`).join("")}<path d="${line}L${X(29)} ${h - P.b}L${X(0)} ${h - P.b}Z" fill="var(--c)" fill-opacity=".12"/><path d="${line}" fill="none" stroke="var(--ct)" stroke-width="2"/><circle cx="${X(29)}" cy="${Y(v[29])}" r="4" fill="var(--ct)"/><text x="${P.l}" y="${h - 4}">Sep 18</text><text x="${w - P.r}" y="${h - 4}" text-anchor="end">Today</text></svg>`;
  }

  // ---------------------------------------------------------------- render and charts
  let route = "";
  function render(keepScroll) {
    const y = scrollY;
    route = location.hash.replace(/^#/, "") || "/";
    const m = route.match(/^\/skill\/([\w-]+)/);
    $("#view").innerHTML = m ? viewSkill(m[1]) : viewBoard();
    renderDock(m ? skill(m[1])?.cat : null);
    $("#pill-streak").textContent = S.streak; $("#pill-today").textContent = todayPct() + "%";
    drawCharts();
    tiles = $$(".tile, .pill, .dock");
    if (keepScroll) scrollTo(0, y);
  }
  function drawCharts() {
    $$("[data-chart]").forEach((el) => {
      const w = Math.max(240, Math.floor(el.clientWidth));
      if (el.dataset.chart === "trend") el.innerHTML = trendChart(w);
      else if (el.dataset.chart === "skhist") el.innerHTML = skHist(w, skill(el.dataset.slug));
      else if (el.dataset.chart === "viz") {
        const sk = skill(el.dataset.slug), V = F.VIZ[sk.slug];
        const chart = V.render.call(V, w, sk.viz);
        if (sk.vizEmpty || sk.dormant) el.innerHTML = `<div class="ghost-chart" aria-hidden="true">${chart}</div><div class="viz-empty"><div><b>${sk.dormant ? `${esc(sk.name)} is dormant` : "Nothing logged yet"}</b><span>${esc(sk.dormant ? V.takeaway.call(V, sk.viz).replace(/<[^>]+>/g, "") : V.empty)}</span></div></div>`;
        else el.innerHTML = chart;
      }
    });
  }
  let rzT; new ResizeObserver(() => { clearTimeout(rzT); rzT = setTimeout(drawCharts, 120); }).observe(document.body);
  function renderDock(activeCat) {
    const onBoard = route === "/";
    $("#dock").innerHTML = `<a href="#/" ${onBoard ? 'aria-current="page"' : ""}>${icon("home")}<span class="tx">Overview</span></a>
      ${F.CATS.map((c) => `<button type="button" class="cat c-${c.id}" data-dock-cat="${c.id}" aria-pressed="${S.filter === c.id || activeCat === c.id}">${icon(c.id)}<span class="tx">${c.name}</span></button>`).join("")}
      <span class="sep" aria-hidden="true"></span>
      <button type="button" data-open-log>${icon("journal")}<span class="tx">Journal</span></button>
      <button type="button" data-soon="Weekly review">${icon("review")}<span class="tx">Review</span></button>
      <button type="button" data-soon="Settings">${icon("settings")}<span class="tx">Settings</span></button>`;
  }

  // ---------------------------------------------------------------- the field
  const field = (() => {
    const cv = $("#field"), ctx = cv.getContext("2d");
    const COLORS = ["200,133,14", "70,118,242", "227,70,75", "169,102,229", "0,167,93", "212,175,55"];
    let W = 0, H = 0, dpr = 1, layer, traces = [], pulses = [], bursts = [], last = 0, raf = 0, mode = "live";
    const mouse = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4 };
    function resize() {
      dpr = Math.min(1.5, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      buildLayer(); if (mode === "off") frame(performance.now(), true);
    }
    function buildLayer() {
      layer = document.createElement("canvas"); layer.width = cv.width; layer.height = cv.height;
      const c = layer.getContext("2d"); c.scale(dpr, dpr);
      const step = 28, r = F.mulberry32(9);
      c.fillStyle = "rgba(160,170,255,0.075)";
      for (let x = step / 2; x < W; x += step) for (let y = step / 2; y < H; y += step) c.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      traces = [];
      const count = Math.round((W * H) / 26000);
      for (let k = 0; k < count; k++) {
        let x = Math.floor(r() * (W / step)) * step + step / 2, y = Math.floor(r() * (H / step)) * step + step / 2;
        const pts = [[x, y]], segs = 2 + Math.floor(r() * 4); let dir = r() < 0.5 ? 0 : 1;
        for (let s = 0; s < segs; s++) {
          const len = (2 + Math.floor(r() * 7)) * step * (r() < 0.5 ? -1 : 1);
          if (dir === 0) x += len; else y += len;
          if (s % 2 === 1 && r() < 0.45) { const dd = step * (r() < 0.5 ? -1 : 1); x += dd; y += dd; } // a 45 degree jog, like a board trace
          pts.push([x, y]); dir = 1 - dir;
        }
        const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
        traces.push({ pts, lens, total: sum(lens) });
      }
      c.lineWidth = 1; c.strokeStyle = "rgba(150,160,255,0.065)"; c.lineJoin = "round";
      traces.forEach((t) => { c.beginPath(); t.pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); const e = t.pts.at(-1); c.fillStyle = "rgba(150,160,255,0.12)"; c.beginPath(); c.arc(e[0], e[1], 2, 0, 7); c.fill(); });
    }
    function at(t, d) { let k = 0; while (k < t.lens.length - 1 && d > t.lens[k]) { d -= t.lens[k]; k++; } const a = t.pts[k], b = t.pts[k + 1], f = Math.max(0, Math.min(1, d / (t.lens[k] || 1))); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
    function spawn(color, near) {
      if (!traces.length) return;
      let t = traces[Math.floor(Math.random() * traces.length)];
      if (near) { let best = 1e9; traces.forEach((tr) => { const dd = Math.hypot(tr.pts[0][0] - near[0], tr.pts[0][1] - near[1]); if (dd < best && Math.random() < 0.6) { best = dd; t = tr; } }); }
      pulses.push({ t, d: 0, v: 60 + Math.random() * 90, c: color || COLORS[Math.floor(Math.random() * 5)], len: 40 + Math.random() * 50, a: near ? 0.9 : 0.35 + Math.random() * 0.25 });
    }
    function frame(now, force) {
      raf = 0;
      if (!force && (document.hidden || mode === "off")) return;
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      if (!force && now - last < 30) { raf = requestAnimationFrame(frame); return; }
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const t = now / 1000, live = mode === "live" ? 1 : 0.6;
      // ambient light: three slow pools that breathe
      [[0.18 + 0.06 * Math.sin(t / 11), 0.12 + 0.05 * Math.cos(t / 13), "124,96,255", 0.13], [0.86 + 0.05 * Math.cos(t / 12), 0.3 + 0.08 * Math.sin(t / 9), "70,118,242", 0.1], [0.4 + 0.1 * Math.sin(t / 15), 1.02, "212,175,55", 0.07]].forEach(([fx, fy, col, a], i) => {
        const x = fx * W, y = fy * H, rr = Math.max(W, H) * 0.55, al = a * (0.8 + 0.2 * Math.sin(t / 4 + i * 2)) * live;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(${col},${al})`); gr.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      });
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t / 3.2); ctx.drawImage(layer, 0, 0, W, H); ctx.globalAlpha = 1;
      // pointer light, eased
      mouse.x += (mouse.tx - mouse.x) * 0.12; mouse.y += (mouse.ty - mouse.y) * 0.12;
      if (mouse.x > -1000) { const gr = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 300); gr.addColorStop(0, "rgba(180,190,255,0.075)"); gr.addColorStop(1, "rgba(180,190,255,0)"); ctx.fillStyle = gr; ctx.fillRect(mouse.x - 300, mouse.y - 300, 600, 600); }
      // data pulses along the traces
      if (!force) { const want = mode === "live" ? 10 : 3; if (pulses.length < want && Math.random() < (mode === "live" ? 0.08 : 0.02)) spawn(); }
      ctx.lineCap = "round";
      pulses = pulses.filter((p) => {
        if (!force) p.d += p.v * dt;
        const head = at(p.t, Math.min(p.d, p.t.total)), tailD = Math.max(0, p.d - p.len), steps = 8;
        for (let k = 0; k < steps; k++) { const d0 = tailD + ((p.d - tailD) * k) / steps, d1 = tailD + ((p.d - tailD) * (k + 1)) / steps; if (d0 > p.t.total) break; const a = at(p.t, d0), b = at(p.t, Math.min(d1, p.t.total)); ctx.strokeStyle = `rgba(${p.c},${(p.a * (k + 1)) / steps})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        if (p.d <= p.t.total) { const gr = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], 9); gr.addColorStop(0, `rgba(${p.c},${p.a})`); gr.addColorStop(1, `rgba(${p.c},0)`); ctx.fillStyle = gr; ctx.fillRect(head[0] - 9, head[1] - 9, 18, 18); }
        return p.d < p.t.total + p.len;
      });
      // bursts from a power-up
      bursts = bursts.filter((b) => { const k = (now - b.t0) / 1100; if (k >= 1) return false; const rr = 40 + k * 700; ctx.strokeStyle = `rgba(${b.c},${0.5 * (1 - k)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b.x, b.y, rr, 0, 7); ctx.stroke(); const gr = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, rr); gr.addColorStop(0, `rgba(${b.c},${0.12 * (1 - k)})`); gr.addColorStop(1, `rgba(${b.c},0)`); ctx.fillStyle = gr; ctx.fillRect(b.x - rr, b.y - rr, rr * 2, rr * 2); return true; });
      if (!force) raf = requestAnimationFrame(frame);
    }
    function start() { if (!raf && mode !== "off") raf = requestAnimationFrame(frame); }
    addEventListener("resize", () => { clearTimeout(resize.t); resize.t = setTimeout(resize, 150); });
    document.addEventListener("visibilitychange", start);
    addEventListener("pointermove", (e) => { mouse.tx = e.clientX; mouse.ty = e.clientY; if (mouse.x < -1000) { mouse.x = e.clientX; mouse.y = e.clientY; } }, { passive: true });
    resize();
    return {
      setMode(m) { mode = reduce ? "off" : m; if (mode === "off") { cancelAnimationFrame(raf); raf = 0; frame(performance.now(), true); } else start(); },
      burst(x, y, cat) { const c = COLORS[["business", "school", "athletics", "mind", "nutrition", "gold"].indexOf(cat)] || COLORS[5]; bursts.push({ x, y, c, t0: performance.now() }); for (let i = 0; i < 6; i++) spawn(c, [x, y]); start(); },
    };
  })();

  // ---------------------------------------------------------------- pointer lighting on tiles
  let tiles = [], pRaf = 0, px = -1e4, py = -1e4;
  addEventListener("pointermove", (e) => {
    px = e.clientX; py = e.clientY;
    if (pRaf) return;
    pRaf = requestAnimationFrame(() => {
      pRaf = 0;
      for (const el of tiles) { const r = el.getBoundingClientRect(); if (r.bottom < -300 || r.top > innerHeight + 300) continue; el.style.setProperty("--mx", px - r.left + "px"); el.style.setProperty("--my", py - r.top + "px"); }
      const hero = $("#hero"), p = $("#px");
      if (hero && p && !reduce) { const r = hero.getBoundingClientRect(), nx = (px - r.left) / r.width - 0.5, ny = (py - r.top) / r.height - 0.5; if (Math.abs(nx) < 1 && Math.abs(ny) < 1) p.style.transform = `translate(${(-nx * 8).toFixed(1)}px, ${(-ny * 5).toFixed(1)}px)`; }
    });
  }, { passive: true });

  // ---------------------------------------------------------------- sound and the power-up
  let audio, tinks = 0;
  function tink(step) {
    if (!opts.sound) return;
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime; o.type = "sine"; o.frequency.value = 660 * Math.pow(2, step / 12); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6); o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.62); } catch (e) { /* sound is optional */ }
  }
  function portPoint(cat) {
    const st = $("#statue"); if (!st) return null;
    const r = st.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return null;
    const p = F.CATS.find((c) => c.id === cat).port;
    return [r.left + p[0] * r.width, r.top + p[1] * r.height];
  }
  function powerUp(cat, gain, fromEl, slug, after) {
    tink(tinks++ % 12);
    const color = css(cat), fr = fromEl?.getBoundingClientRect();
    const start = fr ? [fr.left + fr.width / 2, fr.top + fr.height / 2] : [innerWidth / 2, innerHeight / 2];
    let end = portPoint(cat), toRing = null;
    if (!end) { toRing = $(".sk-head .ring"); if (toRing) { const rr = toRing.getBoundingClientRect(); end = [rr.left + rr.width / 2, rr.top + rr.height / 2]; } }
    const done = () => { impact(cat, color, gain, end, toRing, slug); setTimeout(after, reduce ? 0 : 620); };
    if (reduce || !end) { done(); return; }
    const dx = end[0] - start[0], dy = end[1] - start[1], lift = Math.min(220, Math.abs(dx) * 0.35 + 80);
    const d = `M${start[0]} ${start[1]} C${start[0] + dx * 0.15} ${start[1] - lift} ${end[0] - dx * 0.25} ${end[1] - lift} ${end[0]} ${end[1]}`;
    const fx = $("#fx");
    fx.innerHTML = `<path d="${d}" fill="none" stroke="${color}" stroke-width="6" stroke-opacity=".25" stroke-linecap="round" id="trail-h"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" id="trail"/>`;
    const len = $("#trail").getTotalLength();
    ["#trail", "#trail-h"].forEach((id) => { const p = $(id); p.style.strokeDasharray = `${len} ${len}`; p.animate([{ strokeDashoffset: len, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.7 }, { strokeDashoffset: 0, opacity: 0 }], { duration: 760, easing: "cubic-bezier(.55,0,.6,1)" }); });
    const bead = document.createElement("div"); bead.className = "bead"; bead.style.setProperty("--c", color); bead.style.offsetPath = `path("${d}")`;
    document.body.appendChild(bead);
    bead.animate([{ offsetDistance: "0%", opacity: 0.5 }, { offsetDistance: "100%", opacity: 1 }], { duration: 540, easing: "cubic-bezier(.55,0,.75,.25)" }).onfinish = () => { bead.remove(); done(); setTimeout(() => (fx.innerHTML = ""), 300); };
  }
  function impact(cat, color, gain, end, toRing, slug) {
    const comic = opts.power === "comic" && !reduce;
    if (end) field.burst(end[0], end[1], cat);
    $$(`[data-skill-tile="${slug}"]`).forEach((t) => { t.classList.remove("flare"); void t.offsetWidth; t.classList.add("flare"); });
    if (toRing) { toRing.animate([{ transform: "scale(1)" }, { transform: "scale(1.12)", offset: 0.3 }, { transform: "scale(1)" }], { duration: 520, easing: "cubic-bezier(.2,.8,.3,1)" }); return; }
    const surge = $("#surge"), stage = $("#stage"); if (!surge) return;
    const p = F.CATS.find((c) => c.id === cat).port, at = `${p[0] * 100}% ${p[1] * 100}%`;
    if (reduce) { surge.animate([{ opacity: 0 }, { opacity: 0.7 }, { opacity: 0 }], { duration: 500 }); return; }
    surge.animate([{ opacity: 1, clipPath: `circle(0% at ${at})` }, { opacity: 1, offset: 0.55, clipPath: `circle(80% at ${at})` }, { opacity: 0, clipPath: `circle(140% at ${at})` }], { duration: 1100, easing: "cubic-bezier(.2,.7,.3,1)" });
    $("#statue").animate([{ scale: "1" }, { scale: "1.02", translate: "0 -4px", offset: 0.25 }, { scale: "1" }], { duration: 520, easing: "cubic-bezier(.2,.8,.3,1)" });
    $(`.catrow[data-cat="${cat}"]`)?.animate([{ background: "rgba(255,255,255,.12)" }, { background: "transparent" }], { duration: 900 });
    if (!comic) return;
    $("#rays").animate([{ opacity: 0, transform: "scale(.88)" }, { opacity: 1, offset: 0.2 }, { opacity: 0, transform: "scale(1.12)" }], { duration: 620, easing: "ease-out" });
    $(".halftone").animate([{ opacity: 0.7 }, { opacity: "" }], { duration: 800, easing: "ease-out" });
    const sr = stage.getBoundingClientRect(), cap = document.createElement("div");
    cap.className = "caption"; cap.style.setProperty("--c", color); cap.textContent = `${CATN[cat]} +${gain.toFixed(1)}`;
    const left = p[0] < 0.5; cap.style.left = (left ? Math.max(4, end[0] - sr.left - 170) : end[0] - sr.left + 24) + "px"; cap.style.top = Math.max(6, end[1] - sr.top - 60) + "px";
    stage.appendChild(cap);
    cap.animate([{ opacity: 0, transform: "skewX(-8deg) scale(.6) translateY(10px)" }, { opacity: 1, transform: "skewX(-8deg) scale(1.08)", offset: 0.18 }, { opacity: 1, transform: "skewX(-8deg) scale(1)", offset: 0.75 }, { opacity: 0, transform: "skewX(-8deg) translateY(-12px)" }], { duration: 1500, easing: "ease-out" }).onfinish = () => cap.remove();
  }
  function tierUp() {
    opts.tier = Math.min(5, tier().n + 1); renderTierOpts(); render(true);
    const t = tier();
    if (reduce || !$("#hero")) return;
    $("#rays").animate([{ opacity: 0, transform: "scale(.8)" }, { opacity: 1, offset: 0.3 }, { opacity: 0, transform: "scale(1.2)" }], { duration: 1600, easing: "ease-out" });
    $("#surge").animate([{ opacity: 0, clipPath: "none" }, { opacity: 1, offset: 0.4, clipPath: "none" }, { opacity: 0, clipPath: "none" }], { duration: 1800 });
    const r = $("#statue").getBoundingClientRect(); field.burst(r.left + r.width / 2, r.top + r.height * 0.3, "gold");
    const cap = document.createElement("div"); cap.className = "caption"; cap.style.setProperty("--c", css("gold"));
    cap.style.cssText += "left:50%;top:38%;font-size:30px;padding:10px 20px 12px"; cap.textContent = `Tier ${t.num}: ${t.name}`;
    $("#stage").appendChild(cap);
    cap.animate([{ opacity: 0, transform: "translate(-50%,-50%) skewX(-8deg) scale(.5)" }, { opacity: 1, transform: "translate(-50%,-50%) skewX(-8deg) scale(1.1)", offset: 0.15 }, { opacity: 1, transform: "translate(-50%,-50%) skewX(-8deg) scale(1)", offset: 0.8 }, { opacity: 0, transform: "translate(-50%,-60%) skewX(-8deg)" }], { duration: 2400, easing: "ease-out" }).onfinish = () => cap.remove();
    for (let i = 0; i < 3; i++) setTimeout(() => tink(7 + i * 5), i * 140);
  }

  // ---------------------------------------------------------------- actions
  const findGoal = (id) => { for (const sk of S.skills) { const g = sk.goals.find((x) => x.id === id); if (g) return { sk, g }; } return {}; };
  const findStep = (id) => { for (const sk of S.skills) { const st = sk.steps.find((x) => x.id === id); if (st) return { sk, st }; } return {}; };
  const bump = (sk, d) => { if (sk.score === null) return; const before = overall(); sk.score = Math.max(0, Math.min(100, Math.round((sk.score + d) * 10) / 10)); if (S.trend.length) S.trend[S.trend.length - 1] = Math.round(overall() * 10) / 10; else if (d > 0 && before === 0) S.trend = [overall()]; };
  function logGoal(id, el, tierPick) {
    const { sk, g } = findGoal(id); if (!g) return;
    const prev = g.result, next = tierPick !== undefined ? tierPick : prev ? null : "standard";
    if (next === prev) return;
    const delta = (next ? GAIN[next] : 0) - (prev ? GAIN[prev] : 0);
    g.result = next;
    const finish = () => { bump(sk, delta); render(true); };
    if (next && !prev) {
      S.activity.unshift({ cat: sk.cat, what: `Logged ${g.title} at ${TIER_LABEL[next]}`, kind: "Goal", when: "Just now", skill: sk.slug });
      if (S.fresh && !S.streak) S.streak = 1;
      powerUp(sk.cat, Math.abs(delta), el, sk.slug, finish);
    } else finish();
    toast(next ? `Logged ${g.title} at ${TIER_LABEL[next]}.` : `${g.title} is open again.`, () => { g.result = prev; bump(sk, -delta); render(true); });
  }
  function claimStep(id, el) {
    const { sk, st } = findStep(id); if (!st) return;
    st.done = !st.done; const pts = F.SIZE_PTS[st.size], delta = (st.done ? 1 : -1) * pts * 0.5;
    const finish = () => { bump(sk, delta); render(true); };
    if (st.done) { S.activity.unshift({ cat: sk.cat, what: `Claimed ${st.title}, +${pts}`, kind: "Step", when: "Just now", skill: sk.slug }); powerUp(sk.cat, pts * 0.5, el, sk.slug, finish); }
    else finish();
    toast(st.done ? `Claimed ${st.title}.` : `${st.title} is open again.`, () => { st.done = !st.done; bump(sk, -delta); render(true); });
  }
  function addGoal(slug, title, fromToday) {
    const sk = skill(slug); if (!title.trim()) return;
    const g = { id: `u${S.uid++}`, title: title.trim(), standard: "", floor: "", stretch: "", mins: null, days: [0, 1, 2, 3, 4, 5, 6], today: fromToday || sk.rack ? (sk.rack ? "Rack" : "Balance") : null, result: null, note: "" };
    sk.goals.push(g); S.editing = fromToday ? null : g.id; render(true);
    if (!fromToday) $(`[data-goal-editor="${g.id}"] textarea`)?.focus();
    toast(fromToday ? `Added ${g.title} to ${sk.name}. It repeats daily until you change it.` : `Added. Fill in the details, or leave it simple.`, () => { sk.goals = sk.goals.filter((x) => x !== g); S.editing = null; render(true); });
  }
  function addStep(slug, title) {
    const sk = skill(slug); if (!title.trim()) return;
    const st = { id: `u${S.uid++}`, title: title.trim(), size: "M", done: false, note: "" };
    sk.steps.push(st); S.editing = st.id; render(true);
    $(`[data-step-editor="${st.id}"] textarea`)?.focus();
  }

  // ---------------------------------------------------------------- toast, tooltip, journal
  let toastT;
  function toast(msg, undo) {
    $(".toast")?.remove();
    const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status");
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button">Undo</button>` : ""}`;
    document.body.appendChild(el);
    if (undo) el.querySelector("button").onclick = () => { undo(); el.remove(); };
    clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 6000);
  }
  const tip = $("#tip");
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (!el) { tip.style.opacity = 0; return; }
    tip.textContent = el.dataset.tip; tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px"; tip.style.opacity = 1;
  });
  const MOODS = ["Heavy", "Strained", "Steady", "Clear", "Locked in"];
  const PROMPTS = ["What is in your control right now?", "What did you do well today?", "What got in your way, and was it yours to fix?", "What would the person you are becoming do next?"];
  const dlg = $("#logdlg"); let mood = null;
  function openLog() {
    $("#log-prompt").textContent = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    $("#moods").innerHTML = MOODS.map((m) => `<button type="button" data-mood="${m}" aria-pressed="false">${m}</button>`).join("");
    $("#log-text").value = ""; mood = null; dlg.showModal(); $("#log-text").focus();
  }
  $("#moods").addEventListener("click", (e) => { const b = e.target.closest("[data-mood]"); if (!b) return; mood = b.dataset.mood; $$("#moods button").forEach((x) => x.setAttribute("aria-pressed", x === b)); });
  $("#log-cancel").addEventListener("click", () => dlg.close());
  $("#logform").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#log-text").value.trim(); if (!text && !mood) { $("#log-text").focus(); return; }
    const entry = { text: text || `Head: ${mood}`, mood, when: "Just now" };
    S.journal.unshift(entry); S.activity.unshift({ cat: "mind", what: "Journal: " + entry.text, kind: "Journal", when: "Just now", skill: "meditation" });
    dlg.close();
    powerUp("mind", 0.2, $("[data-open-log]"), null, () => render(true));
    toast("Saved to Mind.", () => { S.journal.shift(); S.activity.shift(); render(true); });
  });

  // ---------------------------------------------------------------- events
  document.addEventListener("click", (e) => {
    const t = e.target;
    const chk = t.closest(".check");
    if (chk) { const row = chk.closest(".row"); if (row.dataset.goal) logGoal(row.dataset.goal, chk); else claimStep(row.dataset.step, chk); return; }
    const eg = t.closest("[data-edit-goal]"); if (eg) { S.editing = S.editing === eg.dataset.editGoal ? null : eg.dataset.editGoal; S.scope = "today"; render(true); $(`[data-goal-editor] input`)?.focus(); return; }
    const es = t.closest("[data-edit-step]"); if (es) { S.editing = S.editing === es.dataset.editStep ? null : es.dataset.editStep; render(true); $(`[data-step-editor] input`)?.focus(); return; }
    const rt = t.closest(".row .rt"); if (rt && !t.closest(".editor")) { const row = rt.closest(".row"); S.editing = row.dataset.goal || row.dataset.step; render(true); return; }
    if (t.closest("[data-cancel]")) { S.editing = null; render(true); return; }
    const dy = t.closest("[data-day]"); if (dy) { dy.setAttribute("aria-pressed", dy.getAttribute("aria-pressed") !== "true"); return; }
    const sc = t.closest("[data-scope]"); if (sc) { S.scope = sc.dataset.scope; $$("[data-scope]").forEach((b) => b.setAttribute("aria-pressed", b === sc)); return; }
    const sz = t.closest("[data-size]"); if (sz) { $$("[data-size]", sz.parentElement).forEach((b) => b.setAttribute("aria-pressed", b === sz)); return; }
    const dg = t.closest("[data-del-goal]"); if (dg) { const { sk, g } = findGoal(dg.dataset.delGoal); const i = sk.goals.indexOf(g); sk.goals.splice(i, 1); S.editing = null; render(true); toast(`Deleted ${g.title}.`, () => { sk.goals.splice(i, 0, g); render(true); }); return; }
    const ds = t.closest("[data-del-step]"); if (ds) { const { sk, st } = findStep(ds.dataset.delStep); const i = sk.steps.indexOf(st); sk.steps.splice(i, 1); S.editing = null; render(true); toast(`Deleted ${st.title}.`, () => { sk.steps.splice(i, 0, st); render(true); }); return; }
    const idea = t.closest("[data-idea]"); if (idea) { const [kind, slug, i] = idea.dataset.idea.split(":"); const sk = skill(slug), src = structuredClone(sk.ideas[kind === "goal" ? "goals" : "steps"][+i]); src.id = `u${S.uid++}`; (kind === "goal" ? sk.goals : sk.steps).push(src); render(true); toast(`Added ${src.title}. Edit it to make it yours.`); return; }
    const segv = t.closest(".viz-log [data-v]"); if (segv) { const seg = segv.parentElement, multi = seg.hasAttribute("data-multi"); if (multi) segv.setAttribute("aria-pressed", segv.getAttribute("aria-pressed") !== "true"); else $$("[data-v]", seg).forEach((b) => b.setAttribute("aria-pressed", b === segv)); seg.nextElementSibling.value = $$('[data-v][aria-pressed="true"]', seg).map((b) => b.dataset.v).join(multi ? "|" : ""); return; }
    const fc = t.closest("[data-focus]"); if (fc) { const m = route.match(/^\/skill\/([\w-]+)/); skill(m[1]).viz.focus = fc.dataset.focus; render(true); return; }
    const tr = t.closest("[data-trend]"); if (tr) { S.trendMode = tr.dataset.trend; render(true); return; }
    const wk = t.closest("[data-wake]"); if (wk) { const sk = skill(wk.dataset.wake); sk.dormant = false; sk.score = 0; render(true); toast(`${sk.name} is awake. Add a goal to start.`, () => { sk.dormant = true; sk.score = null; render(true); }); return; }
    const num = t.closest("[data-num]"); if (num && !num.querySelector("form")) { openNum(num); return; }
    const dc = t.closest("[data-dock-cat]"); if (dc) { const c = dc.dataset.dockCat; S.filter = S.filter === c ? null : c; if (route !== "/") location.hash = "#/"; else render(true); requestAnimationFrame(() => $(".skills")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" })); return; }
    if (t.closest("[data-clear-filter]")) { S.filter = null; render(true); return; }
    if (t.closest("[data-open-log]")) { openLog(); return; }
    const soon = t.closest("[data-soon]"); if (soon) { toast(`${soon.dataset.soon} keeps its own page; it gets this look in the build.`); return; }
    if (t.closest("#mockbtn")) { const p = $("#mockpanel"); p.hidden = !p.hidden; $("#mockbtn").setAttribute("aria-expanded", !p.hidden); return; }
    const opt = t.closest(".mockpanel [data-v]"); if (opt) { const grp = opt.parentElement.id; $$("[data-v]", opt.parentElement).forEach((b) => b.setAttribute("aria-pressed", b === opt)); setOpt(grp, opt.dataset.v); return; }
    const tb = t.closest("[data-tier]"); if (tb) { opts.tier = +tb.dataset.tier || null; renderTierOpts(); render(true); return; }
    if (t.closest("#play-tier")) { tierUp(); return; }
    if (t.closest("#sound-btn")) { opts.sound = !opts.sound; $("#sound-btn").setAttribute("aria-pressed", opts.sound); $("#sound-btn").textContent = opts.sound ? "Sound on" : "Sound off"; return; }
  });
  function setOpt(grp, v) {
    if (grp === "opt-data") { opts.data = v; opts.tier = null; build(v); renderTierOpts(); render(); toast(v === "fresh" ? "Fresh start: every to-do list is empty until you fill it." : "Sample month loaded."); }
    if (grp === "opt-bg") { opts.bg = v; field.setMode(v); }
    if (grp === "opt-power") opts.power = v;
  }
  document.addEventListener("submit", (e) => {
    const f = e.target; const fd = new FormData(f);
    if (f.matches("[data-add-today]")) { e.preventDefault(); addGoal(fd.get("skill"), fd.get("title") || "", true); return; }
    if (f.matches("[data-add-goal]")) { e.preventDefault(); addGoal(f.dataset.addGoal, fd.get("title") || ""); return; }
    if (f.matches("[data-add-step]")) { e.preventDefault(); addStep(f.dataset.addStep, fd.get("title") || ""); return; }
    if (f.matches("[data-goal-editor]")) {
      e.preventDefault(); const { sk, g } = findGoal(f.dataset.goalEditor), before = structuredClone(g);
      g.title = fd.get("title").trim() || g.title; g.note = fd.get("note").trim();
      ["floor", "standard", "stretch"].forEach((t) => (g[t] = fd.get(t).trim()));
      const mins = ["floor", "standard", "stretch"].map((t) => +fd.get(t + "-m") || 0);
      g.mins = mins.some(Boolean) ? { floor: mins[0], standard: mins[1], stretch: mins[2] } : null;
      if (!g.mins) delete g.progress;
      const days = $$("[data-day]", f).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => +b.dataset.day);
      g.days = days.length ? days : g.days;
      S.editing = null; render(true);
      toast(f.querySelector("[data-scope]") && S.scope === "today" ? "Saved for today." : "Saved. Future days use this.", () => { Object.assign(g, before); render(true); });
      return;
    }
    if (f.matches("[data-step-editor]")) {
      e.preventDefault(); const { st } = findStep(f.dataset.stepEditor);
      st.title = fd.get("title").trim() || st.title; st.note = fd.get("note").trim(); st.rule = fd.get("rule").trim();
      const z = $('[data-size][aria-pressed="true"]', f); if (z) st.size = z.dataset.size;
      S.editing = null; render(true); toast("Step saved."); return;
    }
    if (f.matches("[data-viz-log]")) {
      e.preventDefault(); const sk = skill(f.dataset.vizLog), V = F.VIZ[sk.slug], v = Object.fromEntries(fd.entries());
      const msg = V.log.apply(sk.viz, v);
      if (!msg) { f.querySelector("input:not([type=hidden]), select")?.focus(); return; }
      const wasEmpty = sk.vizEmpty; sk.vizEmpty = false;
      S.activity.unshift({ cat: sk.cat, what: msg.replace(/\.$/, ""), kind: "Number", when: "Just now", skill: sk.slug });
      render(true); toast(wasEmpty ? `${msg} The chart shows a sample month so you can see where it goes.` : msg);
      $(".sk-viz")?.classList.add("flare");
    }
  });
  document.addEventListener("input", (e) => {
    const r = e.target.closest("[data-prog]"); if (!r) return;
    const { g } = findGoal(r.dataset.prog); g.progress = +r.value;
    const t = g.progress >= g.mins.stretch ? "stretch" : g.progress >= g.mins.standard ? "standard" : g.progress >= g.mins.floor ? "floor" : null;
    r.style.setProperty("--p", (100 * g.progress) / g.mins.stretch + "%");
    r.nextElementSibling.textContent = `${g.progress} of ${g.mins.standard} min${t ? ", " + TIER_LABEL[t] : ""}`;
  });
  document.addEventListener("change", (e) => {
    const r = e.target.closest("[data-prog]"); if (!r) return;
    const { g } = findGoal(r.dataset.prog);
    const t = g.progress >= g.mins.stretch ? "stretch" : g.progress >= g.mins.standard ? "standard" : g.progress >= g.mins.floor ? "floor" : null;
    if (t !== g.result) logGoal(g.id, r, t);
  });
  document.addEventListener("focusout", (e) => {
    const id = e.target.closest?.("[data-identity]"); if (!id) return;
    const sk = skill(id.dataset.identity), v = id.textContent.trim();
    if (v !== sk.identity) { const before = sk.identity; sk.identity = v; toast("Identity line saved.", () => { sk.identity = before; render(true); }); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("[data-identity]") && e.key === "Enter") { e.preventDefault(); e.target.blur(); return; }
    if (e.target.matches("input, textarea, select, [contenteditable]")) { if (e.key === "Escape" && S.editing) { S.editing = null; render(true); } return; }
    if (e.key === "l" || e.key === "L") { e.preventDefault(); openLog(); }
  });
  // Hover a goal, a skill or a category row: its region of the statue lights up.
  document.addEventListener("pointerover", (e) => {
    const hero = $("#hero"); if (!hero) return;
    const el = e.target.closest?.(".row, .skill, .catrow, .num");
    const cat = el ? [...el.classList].find((c) => c.startsWith("c-"))?.slice(2) || el.dataset.cat : null;
    if (!cat || cat === "gold") { hero.classList.remove("hl"); $$(".catrow").forEach((r) => r.classList.remove("on")); return; }
    hero.classList.add("hl");
    $$(".vein").forEach((v) => v.classList.toggle("on", v.dataset.cat === cat));
    $$(".catrow").forEach((r) => r.classList.toggle("on", r.dataset.cat === cat));
  });
  function openNum(card) {
    const n = NUMS.find((x) => x.k === card.dataset.num), id = "num-" + n.k, val = card.querySelector(".val"), sub = card.querySelector(".sub");
    val.outerHTML = `<form data-numform><label class="sr" for="${id}">${n.l}</label><input class="field" id="${id}" type="number" step="any" inputmode="decimal" placeholder="${numVal(n) ?? ""}" autocomplete="off"></form>`;
    sub.textContent = "Enter to save, Esc to cancel";
    const input = card.querySelector("input"); input.focus();
    input.addEventListener("keydown", (ev) => { if (ev.key === "Escape") render(true); });
    input.addEventListener("blur", () => setTimeout(() => { if (!card.contains(document.activeElement)) render(true); }, 150));
    card.querySelector("form").addEventListener("submit", (ev) => {
      ev.preventDefault(); const v = +input.value; if (!v) return render(true);
      if (!S.fresh) { if (n.sk) n.set(v, skill(n.sk).viz); else n.set(v); } else S.numOverride[n.k] = v;
      if (n.k === "weight" && S.fresh) S.weight.push(v);
      S.activity.unshift({ cat: n.cat, what: `${n.l} ${n.u === "$" ? "$" + v : v + " " + n.u}`, kind: "Number", when: "Just now", skill: n.sk || "strength" });
      render(true); toast(`Logged ${n.l.toLowerCase()}: ${n.u === "$" ? "$" + v : v + " " + n.u}.`);
    });
  }
  function renderTierOpts() { $("#opt-tier").innerHTML = `<button type="button" data-tier="0" aria-pressed="${!opts.tier}">Auto</button>` + F.TIERS.map((t) => `<button type="button" data-tier="${t.n}" aria-pressed="${opts.tier === t.n}">${t.num}</button>`).join(""); }

  // ---------------------------------------------------------------- clock and boot
  function tick() { const d = new Date(); $("#clock").textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
  tick(); setInterval(tick, 15000);
  addEventListener("hashchange", () => { S.editing = null; render(); scrollTo(0, 0); });
  build("sample"); renderTierOpts(); render(); field.setMode(opts.bg);
})();

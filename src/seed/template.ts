import type { NonNegotiableTemplate, SeedTemplate, Weekday } from "./types";

/**
 * Starting content (spec Section 12 and Section 8).
 * Seeded per user on first sign-in; after that each user owns and edits their copy.
 */

const DAILY: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const MON_TO_SAT: Weekday[] = [1, 2, 3, 4, 5, 6];
const RUN_DAYS: Weekday[] = [2, 4, 6]; // Tue, Thu, Sat long run

function nn(n: Omit<NonNegotiableTemplate, "defaultTier" | "daysOfWeek"> & Partial<NonNegotiableTemplate>): NonNegotiableTemplate {
  return { defaultTier: "standard", daysOfWeek: DAILY, ...n };
}

export const SEED_TEMPLATE: SeedTemplate = {
  version: 1,
  profile: { timezone: "America/Chicago", rolloverHour: 4, dailyBudgetMin: 120 },
  rack: ["dropshipping", "strength", "running", "time-blocking", "academics"],

  categories: [
    // ───────────────────────────── BUSINESS
    {
      slug: "business",
      name: "Business",
      color: "#E8A33D",
      icon: "briefcase",
      region: "left_arm",
      position: "top_left",
      goalWeight: 1.3,
      skills: [
        {
          slug: "ai-building",
          name: "AI Building",
          priorityWeight: 3,
          status: "active",
          identity: "I build real products with AI, fast.",
          hundredMeans:
            "Has shipped multiple AI-built products with real users and revenue, including AI-run dropshipping stores, and can take an idea to a deployed product in one weekend.",
          metricsNote: "Shipped projects (manual log with link). Commits via optional GitHub integration later.",
          milestones: [
            { title: "Completed CS50P and the UPenn AI certificate", points: 8, type: "manual", suggestClaim: true },
            { title: "Deployed a project publicly (repoman on Vercel counts)", points: 7, type: "manual" },
            { title: "Shipped FORGE v1 and used it 14 days straight", points: 8, type: "streak", rule: { key: "app_use_streak_days", op: "gte", value: 14 } },
            { title: "Built a complete dropshipping storefront with AI tools end to end", points: 8, type: "manual" },
            { title: "Built an AI product-research pipeline that finds and scores products", points: 10, type: "manual" },
            { title: "Automated store operations with AI (listings, descriptions, customer emails)", points: 10, type: "manual" },
            { title: "An AI-built product earns its first dollar", points: 12, type: "manual" },
            { title: "3 shipped products with real users", points: 12, type: "count", rule: { key: "shipped_products", op: "gte", value: 3 } },
            { title: "A product or tool with 100+ users or $1,000 revenue", points: 12, type: "manual" },
            { title: "Idea to deployed product in one weekend, documented", points: 13, type: "manual" },
          ],
          nonNegotiables: [
            nn({
              name: "Build session",
              floor: "15 min, ship one small change",
              standard: "45 min focused build session ending in a commit",
              stretch: "90 min session ending in a deploy",
              minutes: { floor: 15, standard: 45, stretch: 90 },
              countsAgainstBudget: true,
              intention: "After my last class, I open Claude Code and ship one commit.",
            }),
          ],
          tips: {
            foundation: [
              "Ship small and daily; a deployed ugly thing beats a perfect local thing.",
              "Write the spec before prompting.",
              "Keep a \"prompts that worked\" file.",
            ],
            development: [
              "Build reusable pieces (product research, listing generator) instead of one-offs.",
              "Add evals: check AI outputs against examples before trusting them.",
              "Put every build in front of a real user within a week.",
            ],
            mastery: [
              "Productize your internal tools.",
              "Measure time-to-ship and cut it.",
              "Teach what you build (a YouTube channel or posts), which forces clarity and attracts users.",
            ],
          },
        },
        {
          slug: "dropshipping",
          name: "Dropshipping",
          priorityWeight: 3,
          status: "active",
          identity: "I run a store that makes money.",
          hundredMeans: "Owns a profitable store doing $10,000+ monthly revenue for 3 consecutive months, or has sold a store.",
          metricsNote: "Revenue, ad spend, orders (manual weekly entry in the Sunday review; Shopify integration later).",
          milestones: [
            { title: "One-page business model written: margins, ad cost per sale, fulfillment, returns", points: 5, type: "manual" },
            { title: "10 successful store teardowns logged", points: 6, type: "count", rule: { key: "store_teardowns", op: "gte", value: 10 } },
            { title: "Niche picked and 5 products validated with data", points: 7, type: "manual" },
            { title: "Store live with 3+ products", points: 8, type: "manual" },
            { title: "First ad test with tracked results", points: 7, type: "manual" },
            { title: "First sale", points: 10, type: "manual" },
            { title: "$1,000 total revenue", points: 10, type: "metric", rule: { key: "revenue_total_usd", op: "gte", value: 1000 } },
            { title: "First profitable month", points: 12, type: "manual" },
            { title: "A $5,000 revenue month", points: 15, type: "metric", rule: { key: "revenue_best_month_usd", op: "gte", value: 5000 } },
            { title: "$10,000+ revenue months, 3 in a row", points: 20, type: "metric", rule: { key: "revenue_10k_month_streak", op: "gte", value: 3 } },
          ],
          nonNegotiables: [
            nn({
              name: "Store work",
              floor: "10 min, log one store teardown or one product idea",
              standard: "40 min on the store (research, listings, ad review, supplier work)",
              stretch: "Launch or test one new product",
              minutes: { floor: 10, standard: 40, stretch: 60 },
              countsAgainstBudget: true,
              intention: "After my build session, I spend 40 minutes on the store.",
            }),
          ],
          tips: {
            foundation: [
              "Learn unit economics before spending on ads.",
              "Study stores that are winning now, not courses.",
              "Pick one niche and stay in it.",
            ],
            development: [
              "Test products cheaply and kill losers fast.",
              "Track cost per purchase daily during tests.",
              "Fix supplier shipping times before scaling.",
            ],
            mastery: [
              "Systematize (SOPs plus AI automation) so the store runs without you daily.",
              "Build a brand, not a product list.",
              "Know your numbers weekly without looking them up.",
            ],
          },
        },
      ],
    },

    // ───────────────────────────── SCHOOL
    {
      slug: "school",
      name: "School",
      color: "#4A7BF7",
      icon: "book",
      region: "right_arm",
      position: "top_right",
      goalWeight: 1.0,
      skills: [
        {
          slug: "academics",
          name: "Academics",
          priorityWeight: 2,
          status: "active",
          identity: "I'm a student who is never behind.",
          hundredMeans: "4.0 semesters are the norm, 3.9+ cumulative GPA at graduation.",
          metricsNote: "Canvas assignments, due dates, grades (Phase 6). Semester GPA (manual).",
          config: {
            rule48h: true,
            courses: [
              "MATH 1210 Calc I (+ MATH 1211 recitation)",
              "CMPS 1500 Intro to CS I (+ CMPS 1501 lab)",
              "ECON 1020 Macroeconomics",
              "HISA 1500 Dante's Divine Comedy",
              "INFO 1010 Intro to Business Computing",
              "ARCH 1110",
            ],
          },
          milestones: [
            { title: "Canvas connected (or all fall assignments entered)", points: 5, type: "manual" },
            { title: "2 full weeks with zero late or last-minute assignments", points: 8, type: "streak", rule: { key: "on_time_streak_days", op: "gte", value: 14 } },
            { title: "An A in every class at midterm", points: 10, type: "manual" },
            { title: "First semester GPA 3.7+", points: 10, type: "metric", rule: { key: "first_semester_gpa", op: "gte", value: 3.7 } },
            { title: "First 4.0 semester", points: 15, type: "metric", rule: { key: "best_semester_gpa", op: "gte", value: 4.0 } },
            { title: "Dean's List twice", points: 12, type: "count", rule: { key: "deans_list_count", op: "gte", value: 2 } },
            { title: "Cumulative 3.8+ after sophomore year", points: 12, type: "metric", rule: { key: "cumulative_gpa_after_year_2", op: "gte", value: 3.8 } },
            { title: "Three 4.0 semesters", points: 13, type: "count", rule: { key: "semesters_at_4_0", op: "gte", value: 3 } },
            { title: "Graduate with 3.9+ cumulative", points: 15, type: "metric", rule: { key: "graduation_gpa", op: "gte", value: 3.9 } },
          ],
          nonNegotiables: [
            nn({
              name: "Deep study block",
              floor: "20 min reviewing today's notes",
              standard: "75 min deep work on the nearest-due Canvas item",
              stretch: "2 hours including extra Calc practice problems",
              minutes: { floor: 20, standard: 75, stretch: 120 },
              countsAgainstBudget: true,
              intention: "After my last class, I go to the library and open the next Canvas item.",
              dayTypes: ["class_light", "class_heavy", "weekend"],
            }),
          ],
          tips: {
            foundation: [
              "Use active recall and practice problems, not rereading.",
              "Go to office hours before you are lost.",
              "Calc needs daily reps.",
            ],
            development: [
              "Spaced repetition for anything memorized.",
              "Do past exams under timed conditions.",
              "Teach concepts out loud.",
            ],
            mastery: [
              "Build relationships with professors that lead to research or recs.",
              "Help classmates (teaching locks in learning).",
              "Choose harder courses on purpose.",
            ],
          },
        },
        {
          slug: "reading",
          name: "Reading",
          priorityWeight: 2,
          status: "active",
          identity: "I'm a reader who understands fast.",
          hundredMeans: "Effective reading rate 50% above baseline, sustained, and 80 books finished by graduation.",
          metricsNote:
            "Effective rate = wpm x comprehension. Reading test every 2 weeks. Baseline estimate of 360 to 720 wpm is unverified; the first test sets the real baseline.",
          config: { testEveryDays: 14 },
          milestones: [
            { title: "Baseline reading test recorded", points: 5, type: "metric", rule: { key: "reading_tests_taken", op: "gte", value: 1 } },
            { title: "5 books finished", points: 8, type: "count", rule: { key: "books_finished", op: "gte", value: 5 } },
            { title: "Effective rate +10% over baseline", points: 8, type: "metric", rule: { key: "effective_rate_gain_pct", op: "gte", value: 10 } },
            { title: "15 books finished", points: 10, type: "count", rule: { key: "books_finished", op: "gte", value: 15 } },
            { title: "Effective rate +20%", points: 10, type: "metric", rule: { key: "effective_rate_gain_pct", op: "gte", value: 20 } },
            { title: "30 books finished", points: 12, type: "count", rule: { key: "books_finished", op: "gte", value: 30 } },
            { title: "Effective rate +35%", points: 12, type: "metric", rule: { key: "effective_rate_gain_pct", op: "gte", value: 35 } },
            { title: "50 books finished", points: 15, type: "count", rule: { key: "books_finished", op: "gte", value: 50 } },
            // Compound condition: claimed by hand until a rule can express both parts.
            { title: "Effective rate +50% on 2 consecutive tests, and 80 books", points: 20, type: "metric" },
          ],
          nonNegotiables: [
            nn({
              name: "Read",
              floor: "10 pages",
              standard: "30 min reading plus a 3-line summary",
              stretch: "60 min plus a 5-minute speed drill (pacer, reduced subvocalization)",
              minutes: { floor: 15, standard: 30, stretch: 65 },
              countsAgainstBudget: true,
              intention: "When I get in bed, I read 30 minutes before my phone.",
            }),
          ],
          tips: {
            foundation: [
              "Use a pacer (finger or pen).",
              "Read in focused blocks with the phone in another room.",
              "Always write the 3-line summary.",
            ],
            development: [
              "Preview chapter headings first.",
              "Practice slightly faster than comfortable for short drills, then return to normal speed.",
              "Adjust speed to material: slow for Calc, fast for familiar topics.",
            ],
            mastery: [
              "Read across fields and connect ideas.",
              "Keep a notes system you revisit.",
              "Re-read the best books yearly.",
            ],
          },
        },
        {
          slug: "college-integration",
          name: "College Integration",
          priorityWeight: 2,
          status: "active",
          identity: "I'm someone people at Tulane know and trust.",
          hundredMeans:
            "A leadership role in an org, a close friend group, two professors who would write a strong recommendation, and an opportunity (internship or similar) that came through campus relationships.",
          metricsNote: "Friends, clubs, professors. Office hours once a week, rotating classes.",
          milestones: [
            { title: "Joined 2 orgs and attended first meetings", points: 8, type: "manual" },
            // "Every class" depends on the course list, so this is claimed by hand for now.
            { title: "Attended office hours for every class once this semester", points: 8, type: "count" },
            { title: "5 people you could text to hang out", points: 8, type: "manual" },
            { title: "A regular weekly social commitment", points: 10, type: "manual" },
            { title: "3+ conversations outside class with one professor", points: 10, type: "count", rule: { key: "max_professor_conversations", op: "gte", value: 3 } },
            { title: "80% org meeting attendance for a full semester", points: 10, type: "metric", rule: { key: "org_attendance_semester_pct", op: "gte", value: 80 } },
            { title: "Committee or project role in an org", points: 10, type: "manual" },
            { title: "Exec or leadership role", points: 14, type: "manual" },
            { title: "Two professors who would write strong recs", points: 10, type: "manual" },
            { title: "Internship or opportunity from a campus relationship", points: 12, type: "manual" },
          ],
          nonNegotiables: [
            nn({
              name: "Connect",
              floor: "Start one genuine conversation",
              standard: "Initiate a plan with someone, or attend a club meeting or event",
              stretch: "Host something, or go to office hours",
              minutes: { floor: 5, standard: 30, stretch: 60 },
              countsAgainstBudget: true,
              intention: "After class, I talk to one person before leaving the room.",
            }),
          ],
          tips: {
            foundation: [
              "Say yes to invitations early in the semester; groups form fast.",
              "Learn names and use them.",
              "Office hours are relationship time, not just help time.",
            ],
            development: [
              "Go deep in 1 to 2 orgs instead of shallow in many.",
              "Be the person who organizes.",
              "Follow up with professors about their work.",
            ],
            mastery: ["Run something.", "Connect people to each other.", "Mentor younger students."],
          },
        },
      ],
    },

    // ───────────────────────────── MIND
    {
      slug: "mind",
      name: "Mind",
      color: "#A77BFF",
      icon: "brain",
      region: "head",
      position: "top_center",
      goalWeight: 1.2,
      skills: [
        {
          slug: "time-blocking",
          name: "Time Blocking",
          priorityWeight: 3,
          status: "active",
          identity: "My day is designed before it starts.",
          hundredMeans: "Every day planned the night before, 85%+ block adherence, and a weekly planning session never missed for a year.",
          metricsNote: "Google Calendar (Phase 6). Evening one-tap adherence rating: 0 / 25 / 50 / 75 / 100% of blocks kept.",
          config: { minBlocksForPlanned: 5 },
          milestones: [
            { title: "Google Calendar connected and tomorrow planned", points: 5, type: "manual" },
            { title: "7 nights in a row planned", points: 8, type: "streak", rule: { key: "planned_nights_streak", op: "gte", value: 7 } },
            { title: "First Sunday weekly planning session", points: 5, type: "manual" },
            { title: "14 days at 70%+ adherence", points: 10, type: "metric", rule: { key: "adherence_70_streak_days", op: "gte", value: 14 } },
            { title: "30 nights planned at 85%+", points: 10, type: "metric", rule: { key: "planned_nights_30d_pct", op: "gte", value: 85 } },
            { title: "30 days at 80%+ adherence", points: 12, type: "metric", rule: { key: "adherence_80_streak_days", op: "gte", value: 30 } },
            { title: "A full semester planned on 90% of nights", points: 14, type: "metric", rule: { key: "planned_nights_semester_pct", op: "gte", value: 90 } },
            { title: "90 days at 85%+ adherence", points: 16, type: "metric", rule: { key: "adherence_85_streak_days", op: "gte", value: 90 } },
            { title: "Weekly planning never missed for a year", points: 20, type: "streak", rule: { key: "weekly_planning_streak_weeks", op: "gte", value: 52 } },
          ],
          nonNegotiables: [
            nn({
              name: "Plan tomorrow",
              floor: "Tomorrow's 3 most important blocks in the calendar",
              standard: "Tomorrow fully blocked (classes, training, skill blocks, meals) before bed",
              stretch: "Standard plus a review of today's adherence and one adjustment",
              minutes: { floor: 5, standard: 10, stretch: 15 },
              countsAgainstBudget: true,
              intention: "Before I brush my teeth, I block tomorrow in Google Calendar.",
            }),
          ],
          tips: {
            foundation: [
              "Block the non-negotiables first, then everything else.",
              "Leave buffer between blocks.",
              "Plan for your real energy, not your ideal one.",
            ],
            development: [
              "Theme days or time-of-day for deep work (late night and early day are your strongest).",
              "Track what breaks plans and design around it.",
              "Batch shallow tasks.",
            ],
            mastery: [
              "Weekly and monthly planning layers.",
              "Protect deep-work blocks from everyone.",
              "Your calendar reflects your priorities exactly.",
            ],
          },
        },
        {
          slug: "chess",
          name: "Chess",
          priorityWeight: 2,
          status: "active",
          identity: "I think several moves ahead.",
          hundredMeans: "2000 rating.",
          metricsNote: "Chess.com or Lichess public API by username (platform and time control to confirm). Current rating about 1000.",
          config: { platform: null, username: null, timeControl: "rapid" },
          milestones: [
            { title: "Baseline rating recorded", points: 5, type: "metric", rule: { key: "chess_ratings_recorded", op: "gte", value: 1 }, suggestClaim: true },
            ...[1100, 1200, 1300].map((r) => ({ title: `${r}`, points: 8, type: "metric" as const, rule: { key: "chess_rating", op: "gte" as const, value: r } })),
            ...[1400, 1500].map((r) => ({ title: `${r}`, points: 9, type: "metric" as const, rule: { key: "chess_rating", op: "gte" as const, value: r } })),
            ...[1600, 1700].map((r) => ({ title: `${r}`, points: 10, type: "metric" as const, rule: { key: "chess_rating", op: "gte" as const, value: r } })),
            ...[1800, 1900, 2000].map((r) => ({ title: `${r}`, points: 11, type: "metric" as const, rule: { key: "chess_rating", op: "gte" as const, value: r } })),
          ],
          nonNegotiables: [
            nn({
              name: "Chess training",
              floor: "10 puzzles",
              standard: "30 min, puzzles plus one rapid game you review",
              stretch: "60 min including a study session (endgames or your opening)",
              minutes: { floor: 10, standard: 30, stretch: 60 },
              countsAgainstBudget: true,
              intention: "After dinner on chess days, I do puzzles before anything else on my phone.",
            }),
          ],
          tips: {
            foundation: [
              "Tactics puzzles daily.",
              "Play rapid (10+0 or longer), not blitz.",
              "Review every loss for the first mistake.",
            ],
            development: [
              "Learn core endgames.",
              "Build a small, consistent opening repertoire.",
              "Analyze games without an engine first, then check.",
            ],
            mastery: [
              "Study master games in your openings.",
              "Calculate deeper in training positions.",
              "Play longer time controls and OTB.",
            ],
          },
        },
        {
          slug: "meditation",
          name: "Meditation",
          priorityWeight: 2,
          status: "active",
          identity: "I control where my attention goes.",
          hundredMeans: "Daily practice for a year, comfortable 30-minute sits, and calm under pressure at races and exams.",
          milestones: [
            { title: "First 7 days", points: 8, type: "streak", rule: { key: "meditation_streak_days", op: "gte", value: 7 } },
            { title: "First 10-minute sit", points: 6, type: "manual" },
            { title: "30 days at 85%", points: 10, type: "metric", rule: { key: "meditation_30d_pct", op: "gte", value: 85 } },
            { title: "First 20-minute sit", points: 10, type: "manual" },
            { title: "60 days at 85%", points: 12, type: "metric", rule: { key: "meditation_60d_pct", op: "gte", value: 85 } },
            { title: "First 30-minute sit", points: 12, type: "manual" },
            { title: "6 months at 85%", points: 18, type: "metric", rule: { key: "meditation_182d_pct", op: "gte", value: 85 } },
            { title: "One year at 85%", points: 24, type: "metric", rule: { key: "meditation_365d_pct", op: "gte", value: 85 } },
          ],
          nonNegotiables: [
            nn({
              name: "Sit",
              floor: "3 minutes of breathing",
              standard: "10 minutes",
              stretch: "20 minutes",
              minutes: { floor: 3, standard: 10, stretch: 20 },
              countsAgainstBudget: true,
              intention: "Right after I wake up, before my phone, I sit for 10 minutes.",
            }),
          ],
          tips: {
            foundation: [
              "Short and daily beats long and rare.",
              "Noticing a wandered mind is the rep.",
              "Same spot, same time.",
            ],
            development: [
              "Try body scans and open awareness, not only breath.",
              "Use 2-minute sits before exams and races.",
            ],
            mastery: ["Longer sits, occasional half-day practice.", "Calm becomes your default under pressure."],
          },
        },
        {
          slug: "visualization",
          name: "Visualization",
          priorityWeight: 2,
          status: "active",
          identity: "I've already seen it happen, and I know what's in the way.",
          hundredMeans: "Daily WOOP practice for a year, a rehearsal before every key event, and a vision rewritten every quarter.",
          metricsNote:
            "Mental contrasting (WOOP: Wish, Outcome, Obstacle, Plan), not pure positive fantasy. Dream board image upload lives on this skill.",
          milestones: [
            { title: "WOOP written for top 3 goals", points: 8, type: "manual" },
            { title: "First 7 days", points: 8, type: "streak", rule: { key: "visualization_streak_days", op: "gte", value: 7 } },
            { title: "Race rehearsal script for the half marathon", points: 10, type: "manual" },
            { title: "30 days at 85%", points: 12, type: "metric", rule: { key: "visualization_30d_pct", op: "gte", value: 85 } },
            { title: "Rehearsed before every key event for a month", points: 12, type: "manual" },
            { title: "90 days at 85%", points: 16, type: "metric", rule: { key: "visualization_90d_pct", op: "gte", value: 85 } },
            { title: "Quarterly vision rewrite (4 completed)", points: 14, type: "count", rule: { key: "vision_rewrites", op: "gte", value: 4 } },
            { title: "One year at 85%", points: 20, type: "metric", rule: { key: "visualization_365d_pct", op: "gte", value: 85 } },
          ],
          nonNegotiables: [
            nn({
              name: "Visualize",
              floor: "2 minutes with the dream board",
              standard: "5-minute WOOP for today's hardest goal",
              stretch: "10-minute full rehearsal of an upcoming event (race, exam, lift test)",
              minutes: { floor: 2, standard: 5, stretch: 10 },
              countsAgainstBudget: true,
              intention: "After I meditate, I run a WOOP on today's hardest goal.",
            }),
          ],
          tips: {
            foundation: ["See the obstacle as clearly as the outcome.", "Make the if-then plan specific."],
            development: [
              "Rehearse in first person with full sensory detail.",
              "Rehearse handling things going wrong.",
            ],
            mastery: ["Quarterly vision rewrites.", "Link every vision to this app's milestones."],
          },
        },
      ],
    },

    // ───────────────────────────── ATHLETICS
    {
      slug: "athletics",
      name: "Athletics",
      color: "#E5484D",
      icon: "dumbbell",
      region: "left_leg_core",
      position: "bottom_left",
      goalWeight: 1.3,
      skills: [
        {
          slug: "strength",
          name: "Strength",
          priorityWeight: 3,
          status: "active",
          identity: "I'm strong and I train like an athlete.",
          hundredMeans: "Bench 315, squat 455, at a lean bodyweight around 190 to 195.",
          metricsNote:
            "Lifta API (Phase 6): sessions auto-complete the goal, top sets auto-claim lift milestones. Manual entry until connected. Bodyweight weekly.",
          config: {
            current: { bench: 240, squat: 365, bodyweight: 183, asOf: "2026-10" },
            bodyweightGoal: 190,
            bodyweightStretch: 195,
            weeklyGainLb: 0.5,
            sessionsPerWeek: 6,
            raceBuildLegVolumeCut: 0.5,
          },
          milestones: [
            { title: "Bench 225", points: 8, type: "metric", rule: { key: "bench_1rm", op: "gte", value: 225 }, suggestClaim: true },
            { title: "Squat 315", points: 8, type: "metric", rule: { key: "squat_1rm", op: "gte", value: 315 }, suggestClaim: true },
            { title: "4 straight weeks of 6 sessions", points: 5, type: "streak", rule: { key: "weeks_with_6_sessions_streak", op: "gte", value: 4 } },
            { title: "Bench 255", points: 7, type: "metric", rule: { key: "bench_1rm", op: "gte", value: 255 } },
            { title: "190 lb lean bodyweight", points: 7, type: "metric", rule: { key: "bodyweight_lb", op: "gte", value: 190 } },
            { title: "Bench 275", points: 13, type: "metric", rule: { key: "bench_1rm", op: "gte", value: 275 } },
            { title: "Squat 405", points: 11, type: "metric", rule: { key: "squat_1rm", op: "gte", value: 405 } },
            { title: "Bench 295", points: 9, type: "metric", rule: { key: "bench_1rm", op: "gte", value: 295 } },
            { title: "Squat 425", points: 9, type: "metric", rule: { key: "squat_1rm", op: "gte", value: 425 } },
            { title: "Bench 315", points: 12, type: "metric", rule: { key: "bench_1rm", op: "gte", value: 315 } },
            { title: "Squat 455", points: 11, type: "metric", rule: { key: "squat_1rm", op: "gte", value: 455 } },
          ],
          nonNegotiables: [
            nn({
              name: "Training session",
              floor: "Main lift plus one accessory (about 25 min)",
              standard: "Full planned session logged in Lifta",
              stretch: "Full session plus a PR attempt or extra volume",
              minutes: { floor: 25, standard: 75, stretch: 90 },
              countsAgainstBudget: false,
              intention: "After my last class, I go straight to the gym.",
              daysOfWeek: MON_TO_SAT,
            }),
          ],
          tips: {
            foundation: [
              "Log every top set.",
              "Progress load or reps weekly on the main lifts.",
              "Sleep and protein drive the bulk as much as training does.",
            ],
            development: [
              "Run focused bench blocks (more bench frequency and volume) toward 275.",
              "Track bar speed and form on top sets.",
              "Deload every 5 to 7 weeks.",
            ],
            mastery: [
              "Peak deliberately for test days.",
              "Manage fatigue between running and lifting.",
              "Keep joints healthy with mobility work.",
            ],
          },
        },
        {
          slug: "running",
          name: "Running",
          priorityWeight: 3,
          status: "active",
          identity: "I'm a distance runner.",
          hundredMeans: "Marathon under 3:30 and half marathon under 1:30.",
          metricsNote: "Manual run log (distance, time, auto pace). Strava or Apple Health later. Current: about 5 mi/week, longest recent run 4 mi.",
          config: {
            runDays: RUN_DAYS,
            // Long runs by week, ending the week before race day. Editable.
            longRunLadderMi: [5, 6, 7, 5, 8, 9, 10, 7, 11, 12, 10, 8],
            weeklyMileage: { start: 9, peakMin: 22, peakMax: 25 },
            caloriesPerMile: 100,
          },
          milestones: [
            { title: "Long run 4 miles", points: 5, type: "metric", rule: { key: "long_run_mi", op: "gte", value: 4 }, suggestClaim: true },
            { title: "Long run 6 miles", points: 5, type: "metric", rule: { key: "long_run_mi", op: "gte", value: 6 } },
            { title: "3 runs per week for 4 straight weeks", points: 6, type: "streak", rule: { key: "weeks_with_3_runs_streak", op: "gte", value: 4 } },
            { title: "Long run 10 miles", points: 8, type: "metric", rule: { key: "long_run_mi", op: "gte", value: 10 } },
            { title: "Half marathon finished", points: 10, type: "manual" },
            { title: "Half marathon under 1:45", points: 10, type: "metric", rule: { key: "half_marathon_best_s", op: "lte", value: 6299 } },
            { title: "16-mile long run", points: 8, type: "metric", rule: { key: "long_run_mi", op: "gte", value: 16 } },
            { title: "Marathon finished", points: 14, type: "manual" },
            { title: "Marathon under 3:45", points: 9, type: "metric", rule: { key: "marathon_best_s", op: "lte", value: 13499 } },
            { title: "Half marathon under 1:30", points: 12, type: "metric", rule: { key: "half_marathon_best_s", op: "lte", value: 5399 } },
            { title: "Marathon under 3:30", points: 13, type: "metric", rule: { key: "marathon_best_s", op: "lte", value: 12599 } },
          ],
          nonNegotiables: [
            nn({
              name: "Planned run",
              floor: "20 min easy",
              standard: "Today's planned run",
              stretch: "Planned run plus 4 to 6 strides, or 1 extra easy mile",
              minutes: { floor: 20, standard: 45, stretch: 55 },
              countsAgainstBudget: false,
              intention: "On run days, I change into running gear right after class.",
              daysOfWeek: RUN_DAYS,
            }),
          ],
          tips: {
            foundation: [
              "Most runs easy.",
              "Increase long run gradually.",
              "Shoes matter; replace around 300 to 500 miles.",
            ],
            development: [
              "One quality session per week (tempo or intervals at goal pace).",
              "Practice race-day fueling on long runs.",
              "Run the last mile of long runs at goal pace.",
            ],
            mastery: [
              "Periodize around races.",
              "Taper properly.",
              "Race-specific workouts at 1:45 and later 1:30 pace.",
            ],
          },
        },
        {
          slug: "sleep",
          name: "Sleep and Recovery",
          priorityWeight: 2,
          status: "active",
          identity: "I protect my sleep like it's training.",
          hundredMeans: "A consistent 8-hour window held 85%+ of nights for a full year, and no sub-6-hour nights.",
          metricsNote: "One tap \"Going to sleep\" at night, one tap \"Awake\" in the morning. In-window = within 45 minutes of the anchor.",
          config: {
            // Anchor moves 15 minutes earlier per week from the current pattern to the final anchor.
            startLightsOut: "02:00",
            finalLightsOut: "00:45",
            finalWake: "08:45",
            stepMinPerWeek: 15,
            inWindowToleranceMin: 45,
          },
          milestones: [
            { title: "Sleep logged 7 days", points: 6, type: "count", rule: { key: "sleep_logged_days", op: "gte", value: 7 } },
            { title: "7 days in-window", points: 8, type: "streak", rule: { key: "sleep_in_window_streak", op: "gte", value: 7 } },
            { title: "Average 7.5+ hours for 2 weeks", points: 10, type: "metric", rule: { key: "sleep_avg_hours_14d", op: "gte", value: 7.5 } },
            { title: "Reached the final anchor", points: 12, type: "manual" },
            { title: "30 days at 85%+ in-window", points: 14, type: "metric", rule: { key: "sleep_in_window_30d_pct", op: "gte", value: 85 } },
            { title: "A full month with no sub-6-hour nights", points: 12, type: "metric", rule: { key: "sleep_months_without_sub6", op: "gte", value: 1 } },
            { title: "90 days at 85%+", points: 18, type: "metric", rule: { key: "sleep_in_window_90d_pct", op: "gte", value: 85 } },
            { title: "A full semester at 85%+", points: 20, type: "metric", rule: { key: "sleep_in_window_semester_pct", op: "gte", value: 85 } },
          ],
          nonNegotiables: [
            nn({
              name: "Sleep window",
              floor: "In bed within 60 min of the anchor",
              standard: "Screens off and in bed at the anchor",
              stretch: "Anchor plus a 30-minute no-phone wind-down",
              minutes: { floor: 0, standard: 0, stretch: 0 },
              countsAgainstBudget: false,
              intention: "When my alarm says wind down, I plug my phone in across the room.",
            }),
          ],
          tips: {
            foundation: [
              "Same wake time every day, weekends included.",
              "Morning daylight within an hour of waking.",
              "No caffeine late afternoon or later.",
            ],
            development: [
              "Cool, dark room.",
              "Pre-race and pre-exam weeks: protect sleep first.",
              "Watch how sleep tracks with lift and run performance in your notes.",
            ],
            mastery: [
              "Plan travel and race sleep in advance.",
              "Use naps strategically.",
              "Sleep becomes automatic, not effortful.",
            ],
          },
        },
        {
          slug: "triathlon",
          name: "Triathlon",
          priorityWeight: 1,
          status: "dormant",
          identity: "I'm a triathlete.",
          hundredMeans: "Half Ironman (70.3) finished, under 5:30.",
          metricsNote: "Awaken after the marathon.",
          milestones: [
            { title: "Swim 500 m continuous", points: 8, type: "metric", rule: { key: "swim_continuous_m", op: "gte", value: 500 } },
            { title: "Bike 25 miles", points: 8, type: "metric", rule: { key: "bike_ride_mi", op: "gte", value: 25 } },
            { title: "Swim 1,500 m continuous", points: 10, type: "metric", rule: { key: "swim_continuous_m", op: "gte", value: 1500 } },
            { title: "Sprint triathlon finished", points: 12, type: "manual" },
            { title: "Bike 56 miles", points: 12, type: "metric", rule: { key: "bike_ride_mi", op: "gte", value: 56 } },
            { title: "Olympic triathlon finished", points: 14, type: "manual" },
            { title: "70.3 finished", points: 20, type: "manual" },
            { title: "70.3 under 5:30", points: 16, type: "metric", rule: { key: "half_ironman_best_s", op: "lte", value: 19799 } },
          ],
          nonNegotiables: [
            nn({
              name: "Swim or bike session",
              floor: "20 min",
              standard: "Planned session",
              stretch: "Planned session plus a brick (bike to run)",
              minutes: { floor: 20, standard: 60, stretch: 90 },
              countsAgainstBudget: false,
              intention: "On swim and bike days, I pack my bag the night before.",
              daysOfWeek: [1, 3, 0],
            }),
          ],
          tips: {
            foundation: ["Swim technique first (lessons pay off fastest)."],
            development: ["Brick workouts."],
            mastery: ["Race nutrition and pacing across all three legs."],
          },
        },
      ],
    },

    // ───────────────────────────── NUTRITION
    {
      slug: "nutrition",
      name: "Nutrition",
      color: "#2FBF71",
      icon: "leaf",
      region: "right_leg_chest",
      position: "bottom_right",
      goalWeight: 1.0,
      skills: [
        {
          slug: "food",
          name: "Food",
          priorityWeight: 2,
          status: "active",
          identity: "I fuel like an athlete.",
          hundredMeans: "Hits fuel targets automatically 90%+ of days, can cook 15 go-to meals, and reached goal physique on plan.",
          metricsNote:
            "Food photo analysis (Phase 6): portions confirmed in one quick step before numbers are saved. Manual quick-add until connected.",
          config: {
            caloriesTarget: 3500,
            proteinTargetG: 200,
            trackMicros: ["sodium", "potassium", "magnesium", "fiber"],
            longRunCaloriesPerMile: 100,
            calorieTolerancePct: 10,
          },
          milestones: [
            { title: "All meals logged for 7 days", points: 6, type: "streak", rule: { key: "meals_logged_streak", op: "gte", value: 7 } },
            { title: "200 g protein on 5 of 7 days", points: 8, type: "metric", rule: { key: "protein_target_days_7d", op: "gte", value: 5 } },
            { title: "Calories within 10% of target for 14 days", points: 10, type: "metric", rule: { key: "calorie_target_streak", op: "gte", value: 14 } },
            { title: "5 go-to home-cooked meals learned", points: 8, type: "count", rule: { key: "go_to_meals", op: "gte", value: 5 } },
            { title: "Bodyweight on pace (0.5 lb per week) for 8 weeks", points: 10, type: "metric", rule: { key: "bodyweight_on_pace_weeks", op: "gte", value: 8 } },
            { title: "30 days at 85%+ on both targets", points: 12, type: "metric", rule: { key: "fuel_targets_30d_pct", op: "gte", value: 85 } },
            { title: "15 go-to meals learned", points: 10, type: "count", rule: { key: "go_to_meals", op: "gte", value: 15 } },
            { title: "Run-day fueling dialed for a full training block", points: 10, type: "manual" },
            { title: "90 days at 85%+", points: 12, type: "metric", rule: { key: "fuel_targets_90d_pct", op: "gte", value: 85 } },
            { title: "A full semester at 85%+", points: 14, type: "metric", rule: { key: "fuel_targets_semester_pct", op: "gte", value: 85 } },
          ],
          nonNegotiables: [
            nn({
              name: "Fuel",
              floor: "Protein at every meal, every meal photographed",
              standard: "200 g protein and calories within 10% of target",
              stretch: "Both, plus cook one meal",
              minutes: { floor: 0, standard: 0, stretch: 0 },
              countsAgainstBudget: false,
              intention: "Before I eat, I take the photo.",
            }),
          ],
          tips: {
            foundation: [
              "Protein anchor at every meal.",
              "Liquid calories (shakes) close the gap on a bulk.",
              "Photograph before eating, every time.",
            ],
            development: [
              "Carbs around runs and lifts.",
              "Batch cook twice a week.",
              "Weigh weekly at the same time and adjust calories by trend, not single days.",
            ],
            mastery: [
              "Periodize intake with training phases.",
              "Race-week fueling plan.",
              "Eat well while traveling.",
            ],
          },
        },
        {
          slug: "gut-health",
          name: "Gut Health",
          priorityWeight: 1,
          status: "active",
          identity: "My body runs clean.",
          hundredMeans:
            "Fiber, fermented foods, plant variety, and hydration are automatic, with a clearly higher daily wellness rating than at the start.",
          metricsNote: "Daily one-tap rating (1 to 5: energy and digestion) plus habit consistency. Fiber from food analysis.",
          config: { fiberTargetG: 38, waterTargetL: 3, plantsWeeklyTarget: 30 },
          milestones: [
            { title: "7 days of ratings logged", points: 6, type: "count", rule: { key: "gut_ratings_logged", op: "gte", value: 7 } },
            { title: "30 g+ fiber on 5 of 7 days", points: 8, type: "metric", rule: { key: "fiber_30g_days_7d", op: "gte", value: 5 } },
            { title: "Fermented food on 14 days", points: 8, type: "count", rule: { key: "fermented_food_days", op: "gte", value: 14 } },
            { title: "38 g fiber for 14 days", points: 10, type: "metric", rule: { key: "fiber_38g_streak", op: "gte", value: 14 } },
            { title: "30 different plants in one week", points: 10, type: "count", rule: { key: "plants_best_week", op: "gte", value: 30 } },
            { title: "Average rating up 1 point vs first month", points: 12, type: "metric", rule: { key: "gut_rating_gain", op: "gte", value: 1 } },
            { title: "30 days at 85% habits", points: 12, type: "metric", rule: { key: "gut_habits_30d_pct", op: "gte", value: 85 } },
            { title: "90 days at 85%", points: 16, type: "metric", rule: { key: "gut_habits_90d_pct", op: "gte", value: 85 } },
            { title: "A full semester at 85%", points: 18, type: "metric", rule: { key: "gut_habits_semester_pct", op: "gte", value: 85 } },
          ],
          nonNegotiables: [
            nn({
              name: "Gut habits",
              floor: "One fermented food or one high-fiber food",
              standard: "38 g fiber, one fermented food, water target (3 L)",
              stretch: "Standard plus 5+ different plants today",
              minutes: { floor: 0, standard: 0, stretch: 0 },
              countsAgainstBudget: false,
              intention: "With breakfast, I eat something fermented.",
            }),
          ],
          tips: {
            foundation: [
              "Increase fiber gradually with more water.",
              "Fermented foods daily (yogurt, kefir, kimchi).",
              "Track how you feel, not just what you eat.",
            ],
            development: [
              "Aim for 30 plants per week.",
              "Notice which foods hurt your energy or training.",
              "Keep sleep consistent; gut and sleep are linked.",
            ],
            mastery: ["Personal rules based on your own logged patterns.", "Fuel strategies that sit well on race day."],
          },
        },
      ],
    },
  ],

  schedule: {
    name: "Fall 2026",
    startsOn: "2026-08-17",
    endsOn: "2026-12-12",
    days: [
      {
        weekday: 1,
        dayType: "class_light",
        classes: [
          { course: "MATH 1210 Calc I", start: "12:00", end: "12:50" },
          { course: "HISA 1500", start: "13:00", end: "13:50" },
          { course: "CMPS 1500", start: "17:00", end: "17:50", confirm: true },
        ],
        trainingTime: "18:15",
      },
      {
        weekday: 2,
        dayType: "class_heavy",
        classes: [
          { course: "MATH 1211 recitation", start: "09:30", end: "10:45" },
          { course: "ARCH 1110", start: "11:00", end: "12:15", confirm: true },
          { course: "ECON 1020", start: "14:00", end: "15:15" },
        ],
        trainingTime: "16:00",
        notes: "Earliest class of the week. The sleep anchor is set by this day.",
      },
      {
        weekday: 3,
        dayType: "class_light",
        classes: [
          { course: "MATH 1210 Calc I", start: "12:00", end: "12:50" },
          { course: "HISA 1500", start: "13:00", end: "13:50" },
          { course: "CMPS 1500", start: "17:00", end: "17:50", confirm: true },
        ],
        trainingTime: "18:15",
      },
      {
        weekday: 4,
        dayType: "class_heavy",
        classes: [
          { course: "ARCH 1110", start: "11:00", end: "12:15", confirm: true },
          { course: "ECON 1020", start: "14:00", end: "15:15" },
          { course: "CMPS 1501 lab", start: "17:00", end: "18:15" },
        ],
        trainingTime: "18:30",
        notes: "Longest evening. A short 3:30 PM session also works.",
      },
      {
        weekday: 5,
        dayType: "class_light",
        classes: [
          { course: "MATH 1210 Calc I", start: "12:00", end: "12:50" },
          { course: "HISA 1500", start: "13:00", end: "13:50" },
          { course: "INFO 1010", start: "15:00", end: "15:50" },
          { course: "CMPS 1500", start: "17:00", end: "17:50", confirm: true },
        ],
        trainingTime: "18:15",
      },
      { weekday: 6, dayType: "weekend", classes: [], trainingTime: null, notes: "Long run day." },
      { weekday: 0, dayType: "weekend", classes: [], trainingTime: null, notes: "Weekly review and weekly plan." },
    ],
  },

  keyDates: [
    {
      kind: "race",
      label: "Half marathon",
      // Location TBD (Frankfort, KY over winter break or New Orleans area). Date matches the seeded long-run ladder; edit when booked.
      date: "2027-01-09",
      tentative: true,
      skillSlug: "running",
      goal: "1:45 (about 8:01 per mile)",
    },
    { kind: "race", label: "Marathon", date: null, tentative: true, skillSlug: "running", goal: "About 3:30. Finishing strong first." },
  ],
};

/**
 * Curated reading tests (spec 12.4, v1). Original passages written for this app.
 * Word counts are computed from the text, so the wpm math is exact.
 */
export type Passage = {
  id: string;
  title: string;
  text: string;
  questions: { question: string; options: [string, string, string, string]; answerIndex: 0 | 1 | 2 | 3 }[];
};

export const PASSAGES: Passage[] = [
  {
    id: "easy-miles",
    title: "Why Most Runs Should Feel Easy",
    text: `Ask a new runner how to get faster and the answer is usually some version of "run harder." It sounds obvious. If speed is the goal, practice speed. Yet coaches who prepare people for marathons spend most of their energy convincing athletes to slow down.

The reason starts inside the muscle. Long, gentle running asks the body to supply energy steadily for a long time, and the body responds by building the machinery for that job. Muscle cells add mitochondria, the small structures that turn fuel and oxygen into usable energy. New capillaries grow around the fibers, so more blood, and more oxygen, reaches them. The heart's chambers adapt to move more blood with each beat. None of these changes is dramatic in a single week, but together they raise the pace a runner can hold before breathing turns ragged.

Hard running builds fitness too, but it is expensive. A fast workout leaves damage that takes days to repair, and a body that is always repairing cannot absorb much more training. Runners who push every session tend to stall, get hurt, or burn out. They also tend to run their easy days too fast and their hard days too slow, so every run lands in a gray middle zone that is tiring without being targeted.

Researchers who studied the training logs of elite endurance athletes found a consistent pattern. Roughly four out of five sessions were easy, often easy enough to hold a conversation. The remaining sessions were genuinely hard. Very little time was spent in between. This split lets athletes accumulate a large volume of training while keeping enough freshness for the workouts that matter.

For a student balancing classes, lifting, and sleep, the lesson is practical. Easy runs should feel almost too easy, especially on days after heavy leg training. The weekly long run should grow slowly, by about a mile at a time, with lighter weeks mixed in so the body can catch up. One quality session each week, such as a tempo run or intervals at goal pace, provides most of the speed stimulus.

It takes patience. Easy running rarely feels heroic, and progress shows up over months rather than days. But the runner who respects easy days usually arrives at race day healthy, fresh, and faster than the runner who tried to win every workout.`,
    questions: [
      {
        question: "What is the passage's main argument?",
        options: [
          "Hard workouts are unnecessary for marathon runners.",
          "Most training should be easy because it builds aerobic machinery while leaving room for a few hard sessions.",
          "Running and lifting should never be combined.",
          "Elite runners train harder than amateurs on every day.",
        ],
        answerIndex: 1,
      },
      {
        question: "Which change does the passage say long, gentle running produces?",
        options: ["Larger lungs", "More mitochondria and capillaries in the muscles", "Faster reaction times", "Stronger bones in the feet"],
        answerIndex: 1,
      },
      {
        question: "What problem does the passage describe with a \"gray middle zone\"?",
        options: [
          "Runs that are tiring without being targeted, because easy days are too fast and hard days too slow",
          "Running in bad weather",
          "Training without a watch",
          "Doing too many long runs in one week",
        ],
        answerIndex: 0,
      },
      {
        question: "According to the passage, roughly what share of elite athletes' sessions were easy?",
        options: ["One in five", "Half", "Four in five", "All of them"],
        answerIndex: 2,
      },
      {
        question: "What can be inferred about why easy days matter after heavy leg training?",
        options: [
          "They let the body recover while still adding aerobic volume.",
          "They replace the need for sleep.",
          "They are the best time for intervals.",
          "They make the long run unnecessary.",
        ],
        answerIndex: 0,
      },
    ],
  },
  {
    id: "small-bets",
    title: "Small Bets",
    text: `Most new online stores fail for a simple reason: they spend money proving an idea they never tested. A founder falls in love with a product, builds a polished site, buys inventory or ads, and only then discovers that customers do not care, or that every sale loses money. The money is gone before the lesson arrives.

Experienced operators work the other way around. They treat each product as a small bet and try to learn as much as possible for as little as possible. Before building anything elaborate, they look for evidence that people already want the thing. Are similar products selling? Are customers complaining about current options in reviews? Is the problem specific enough that an ad can describe it in one sentence?

The next question is arithmetic, and it decides more businesses than creativity does. A product that sells for forty dollars might cost twelve to make and ship, which looks like a healthy margin. But if it takes twenty-five dollars of advertising to win each customer, and a few orders are returned, the profit shrinks to almost nothing. Operators call this unit economics: what one sale actually earns after every cost attached to it. Knowing these numbers before launch turns a vague hope into a decision.

When a test does run, the goal is speed. A cheap ad campaign with a clear budget and a short deadline answers a narrow question: will strangers click, and will some of them buy? If the answer is no, the product is dropped without regret. Most tests should fail. A store that only tests ideas it is confident about learns very little, because confidence and demand are not the same thing.

Winning products earn more money, but they also earn more scrutiny. Shipping times, supplier reliability, and customer emails start to matter more than they did during the test, because problems now repeat at scale. Many stores that found a winner still failed because they scaled a broken process.

The habit underneath all of this is honesty about evidence. A small bet is not a lack of ambition. It is a way to stay in the game long enough for ambition to pay off.`,
    questions: [
      {
        question: "Why does the passage say many new stores fail?",
        options: [
          "They choose products that are too cheap.",
          "They spend heavily before testing whether the idea works.",
          "They use too many suppliers.",
          "They do not build a polished website.",
        ],
        answerIndex: 1,
      },
      {
        question: "What does \"unit economics\" mean in the passage?",
        options: [
          "The number of units in stock",
          "What one sale actually earns after every attached cost",
          "The total revenue of a store in a month",
          "The price of advertising per day",
        ],
        answerIndex: 1,
      },
      {
        question: "In the passage's example, what mainly erodes the profit on a forty-dollar product?",
        options: ["Taxes", "The cost of advertising to win each customer, plus returns", "Website hosting fees", "Packaging design"],
        answerIndex: 1,
      },
      {
        question: "Why does the author say most tests should fail?",
        options: [
          "Failure is cheaper than success.",
          "Testing only ideas you are confident in teaches little, since confidence is not demand.",
          "Ads rarely work.",
          "Suppliers prefer failed products.",
        ],
        answerIndex: 1,
      },
      {
        question: "What risk comes after finding a winning product?",
        options: [
          "Customers lose interest immediately.",
          "Process problems like shipping and supplier issues repeat at scale.",
          "Ads stop working entirely.",
          "The product becomes too cheap to sell.",
        ],
        answerIndex: 1,
      },
    ],
  },
  {
    id: "forgetting-curve",
    title: "The Forgetting Curve",
    text: `In the 1880s, the German psychologist Hermann Ebbinghaus ran an unusual experiment on himself. He memorized long lists of nonsense syllables, short strings like "wid" or "zof" that carried no meaning, and then tested how much he could recall after different delays. Using meaningless material was deliberate. He wanted to measure memory itself, without the help of stories or associations.

What he found has held up for more than a century. Forgetting is fastest right after learning. A large share of new material slips away within the first day, and the losses slow down after that. Plotted on a graph, the pattern forms a steep drop that gradually flattens, now known as the forgetting curve.

Ebbinghaus also noticed something more hopeful. Each time he relearned a list, it took less effort than before, and the memory faded more slowly afterward. Reviewing material at the right moments did not just restore what was lost. It changed the shape of the curve. This idea, that spacing out review strengthens memory more than cramming it into one session, is called the spacing effect.

Modern research adds a second principle: retrieval. Rereading notes feels productive because the material looks familiar, but familiarity is not the same as being able to recall something on demand. Trying to pull information out of memory, through practice questions, flashcards, or explaining a topic without notes, strengthens the memory far more than passive review. The effort of retrieval is part of what makes it work.

For students, the combination is powerful and a little uncomfortable. Effective studying often feels harder than ineffective studying. Testing yourself reveals gaps that rereading hides. Spreading review across days means starting earlier than the deadline seems to require. But the payoff is knowledge that survives until the exam, and well beyond it.

A practical routine follows naturally. After a lecture, spend a few minutes recalling the main points from memory. Review again a day later, then a few days after that, then a week later, each time trying to answer questions before checking notes. Calculus problems, vocabulary, and historical dates all respond to the same treatment. Ebbinghaus could not have known about modern apps or flashcard software, but the curve he drew still explains why they work.`,
    questions: [
      {
        question: "Why did Ebbinghaus use nonsense syllables?",
        options: [
          "They were easier to pronounce.",
          "To measure memory without help from meaning or associations.",
          "Because real words had not been studied yet.",
          "To make the experiment faster.",
        ],
        answerIndex: 1,
      },
      {
        question: "What does the forgetting curve show?",
        options: [
          "Forgetting happens at a constant rate.",
          "Forgetting is fastest right after learning and then slows down.",
          "Memories improve with time if left alone.",
          "Only meaningless material is forgotten.",
        ],
        answerIndex: 1,
      },
      {
        question: "What is the spacing effect?",
        options: [
          "Studying in a quiet space",
          "Spreading review over time strengthens memory more than cramming",
          "Leaving space between lines in notes",
          "Taking long breaks between semesters",
        ],
        answerIndex: 1,
      },
      {
        question: "Why does the passage say rereading can be misleading?",
        options: [
          "It takes too long.",
          "Familiarity feels like knowing, but it is not the same as recall on demand.",
          "Notes are usually wrong.",
          "It causes the forgetting curve.",
        ],
        answerIndex: 1,
      },
      {
        question: "What can be inferred about effective studying from the passage?",
        options: [
          "It should feel easy if done correctly.",
          "It often feels harder because self-testing exposes gaps.",
          "It works only for vocabulary.",
          "It requires flashcard software.",
        ],
        answerIndex: 1,
      },
    ],
  },
];

/** Spec 12.4: a test every two weeks. */
export const READING_TEST_EVERY_DAYS = 14;

export const passageById = (id: string) => PASSAGES.find((p) => p.id === id);

export const wordCount = (text: string) => text.trim().split(/\s+/).length;

/** Words per minute, comprehension percent, and effective rate = wpm x comprehension (spec 12.4). */
export function scoreReading(words: number, seconds: number, correct: number, total: number) {
  const wpm = (words / Math.max(1, seconds)) * 60;
  const comprehensionPct = (100 * correct) / Math.max(1, total);
  return { wpm, comprehensionPct, effectiveRate: wpm * (comprehensionPct / 100) };
}

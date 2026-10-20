import "server-only";
import { analyzeMeal, claudeAvailable, generateReadingTest, writeDebrief } from "./claude";
import type { MealAnalysis, ReadingTest, WeeklyFacts } from "./claude-prompts";
import { analyzeMealWithGemini, geminiAvailable, generateReadingTestWithGemini, writeDebriefWithGemini } from "./gemini";

/** The app's AI work goes to Gemini first, Claude second. Without either key, every feature has a manual path. */
export const aiAvailable = () => geminiAvailable() || claudeAvailable();
export const aiName = () => (geminiAvailable() ? "Gemini" : "Claude");

export const readMealPhoto = (base64: string, media: "image/jpeg" | "image/png" | "image/webp"): Promise<MealAnalysis> =>
  geminiAvailable() ? analyzeMealWithGemini(base64, media) : analyzeMeal(base64, media);

export const debrief = (facts: WeeklyFacts): Promise<string> => (geminiAvailable() ? writeDebriefWithGemini(facts) : writeDebrief(facts));

export const readingTest = (topic: string): Promise<ReadingTest> => (geminiAvailable() ? generateReadingTestWithGemini(topic) : generateReadingTest(topic));

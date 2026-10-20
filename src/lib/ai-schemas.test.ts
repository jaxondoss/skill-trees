import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MealSchema, ReadingTestSchema } from "./claude-prompts";

describe("structured output schemas", () => {
  it("convert to JSON Schema for Gemini's responseJsonSchema", () => {
    const meal = z.toJSONSchema(MealSchema) as { type: string; required: string[] };
    expect(meal.type).toBe("object");
    expect(meal.required).toEqual(["items", "notes"]);
    expect((z.toJSONSchema(ReadingTestSchema) as { required: string[] }).required).toContain("questions");
  });
});

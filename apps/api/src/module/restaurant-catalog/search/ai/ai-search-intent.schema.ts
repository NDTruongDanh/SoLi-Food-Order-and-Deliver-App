import { z } from 'zod';

const optionalMoney = z.number().int().min(0).max(10_000_000).optional();
const optionalNutrition = z.number().min(0).max(5_000).optional();

export const aiSearchFiltersSchema = z
  .object({
    minPriceVnd: optionalMoney,
    maxPriceVnd: optionalMoney,
    minProteinG: z.number().min(0).max(300).optional(),
    maxCalories: optionalNutrition,
    maxFatG: z.number().min(0).max(500).optional(),
    maxCarbsG: z.number().min(0).max(1_000).optional(),
    minRating: z.number().min(0).max(5).optional(),
    minReviewCount: z.number().int().min(0).max(100_000).optional(),
    itemKind: z.enum(['food', 'beverage', 'mixed']).optional(),
    isVegetarian: z.boolean().optional(),
    isVegan: z.boolean().optional(),
    isHalal: z.boolean().optional(),
    isGlutenFree: z.boolean().optional(),
    isDairyFree: z.boolean().optional(),
  })
  .strict();

export const aiSearchIntentSchema = z
  .object({
    filters: aiSearchFiltersSchema,
    semanticQuery: z.string().trim().min(1).max(300),
  })
  .strict();

export type AiSearchFiltersSchema = z.infer<typeof aiSearchFiltersSchema>;
export type AiSearchIntentSchema = z.infer<typeof aiSearchIntentSchema>;

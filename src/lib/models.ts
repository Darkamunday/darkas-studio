// Shared by server and client: Suno model options and their input limits.

export const MODELS = ["V6", "V6_MINI", "V6_WILD", "V5_5", "V5", "V4_5PLUS", "V4_5ALL", "V4_5", "V4"] as const;
export type SunoModel = (typeof MODELS)[number];

export const MODEL_LABELS: Record<SunoModel, string> = {
  V5_5: "v5.5",
  V6: "v6",
  V6_MINI: "v6 mini",
  V6_WILD: "v6 wild",
  V5: "v5",
  V4_5PLUS: "v4.5+",
  V4_5ALL: "v4.5 all",
  V4_5: "v4.5",
  V4: "v4",
};

export const TITLE_MAX = 80;
export const SIMPLE_PROMPT_MAX = 3000;

export function limitsFor(model: SunoModel) {
  return model === "V4" ? { lyrics: 3000, style: 200 } : { lyrics: 5000, style: 1000 };
}

export function isModel(v: unknown): v is SunoModel {
  return typeof v === "string" && (MODELS as readonly string[]).includes(v);
}

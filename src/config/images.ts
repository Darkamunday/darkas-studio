// Image generation in chat (Comfy Cloud, via its MCP server) — edit freely, then rebuild and restart.
// Shared by server and client, so keep secrets out of here (the key is COMFY_CLOUD_API_KEY in .env.local).

export type ImageModel = {
  id: string;
  /** What people see in the image model picker. */
  label: string;
  /**
   * "workflow": runs our own ComfyUI graph on Comfy Cloud GPUs (billed in GPU seconds).
   * "partner": a Comfy Cloud partner model via partner_generate (billed in credits). `slug` and
   * `params` are what partner_generate takes for it.
   */
  kind: "workflow" | "partner";
  slug?: string;
  params?: Record<string, unknown>;
  /** Only admins can pick it (the pricier ones). */
  adminOnly?: boolean;
};

export const IMAGE_MODELS: ImageModel[] = [
  { id: "z-image-turbo", label: "Z-Image Turbo", kind: "workflow" },
  { id: "nano-banana-2-lite", label: "Nano Banana 2 Lite", kind: "partner", slug: "vertexai/nano-banana-2-lite" },
  { id: "flux-2-pro", label: "Flux 2 Pro", kind: "partner", slug: "bfl/flux-2-pro", adminOnly: true },
  { id: "gpt-image-2", label: "GPT Image 2", kind: "partner", slug: "openai/images-generations", params: { model: "gpt-image-2" }, adminOnly: true },
  { id: "nano-banana-pro", label: "Nano Banana Pro", kind: "partner", slug: "vertexai/nano-banana-pro", adminOnly: true },
];

/** Used when none is picked — and by the chat model when it decides to make an image itself. Not admin-only. */
export const DEFAULT_IMAGE_MODEL = "z-image-turbo";

/** Shapes on offer: the ratio partner models take, and the pixel size for our own workflow. */
export const IMAGE_ASPECTS = {
  square: { ratio: "1:1", width: 1024, height: 1024 },
  portrait: { ratio: "3:4", width: 896, height: 1152 },
  landscape: { ratio: "16:9", width: 1344, height: 768 },
} as const;
export type ImageAspect = keyof typeof IMAGE_ASPECTS;

/** Images a person can make per day (Europe/London), unless the admin page sets their own cap. Admins have no cap. */
export const DEFAULT_IMAGE_DAILY_CAP = 10;

/** Longest image description, in characters. */
export const MAX_IMAGE_PROMPT_CHARS = 2_000;

/** Remembers the image model and shape a browser picked last. */
export const IMAGE_PREFS_COOKIE = "chat-image";

export function findImageModel(id: unknown): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

export function imageModelsFor(isAdmin: boolean): ImageModel[] {
  return IMAGE_MODELS.filter((m) => isAdmin || !m.adminOnly);
}

export function allowedImageModel(id: unknown, isAdmin: boolean): ImageModel | undefined {
  const model = findImageModel(id);
  return model && (isAdmin || !model.adminOnly) ? model : undefined;
}

export const isImageAspect = (v: unknown): v is ImageAspect => typeof v === "string" && v in IMAGE_ASPECTS;

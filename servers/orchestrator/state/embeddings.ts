/**
 * Local, in-process embedding model wrapper. Pinned to Xenova/all-MiniLM-L6-v2
 * (384-dim output) -- see README.md "Embedding model" section for the full
 * rationale. Runs entirely through transformers.js' ONNX runtime; no network
 * calls are made after the model weights are cached locally on first load.
 */
import type { FeatureExtractionPipeline } from "@xenova/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/** Output dimension of MODEL_ID. Also used to size the `memories_vec` virtual table. */
export const EMBED_DIM = 384;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // Lazy/dynamic import so loading the state-store module doesn't eagerly
      // pull in the ONNX runtime for callers that only need run/step CRUD.
      const { pipeline } = await import("@xenova/transformers");
      return (await pipeline("feature-extraction", MODEL_ID)) as unknown as FeatureExtractionPipeline;
    })();
  }
  return extractorPromise;
}

/**
 * Embeds a single string into a normalized, EMBED_DIM-length float vector
 * using the local model. Throws if the loaded model's actual output size
 * doesn't match EMBED_DIM, so a model swap can't silently corrupt the vector
 * index.
 */
export async function embedText(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  const data = output.data as Float32Array;

  if (data.length !== EMBED_DIM) {
    throw new Error(
      `Embedding model "${MODEL_ID}" returned ${data.length} dims, expected ${EMBED_DIM}. ` +
        "Update EMBED_DIM in embeddings.ts and the memories_vec schema together if the model was intentionally changed."
    );
  }

  return data instanceof Float32Array ? data : new Float32Array(data);
}

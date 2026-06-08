export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

type OpenAiEmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
};

export function getOpenAiApiKey(): string {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!apiKey) {
    throw new Error("embedding_failed_missing_api_key");
  }
  return apiKey;
}

function formatEmbeddingForStorage(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function embedText(text: string): Promise<{
  model: string;
  embedding: string;
  dimensions: number;
}> {
  const input = text.trim();
  if (!input) {
    throw new Error("embedding_failed_empty_content");
  }

  let response: Response;
  try {
    response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getOpenAiApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network_error";
    throw new Error(`embedding_failed: ${detail}`);
  }

  const responseText = await response.text();
  let payload: OpenAiEmbeddingResponse;
  try {
    payload = JSON.parse(responseText) as OpenAiEmbeddingResponse;
  } catch {
    throw new Error(`embedding_failed: http_${response.status} invalid_json`);
  }

  if (!response.ok) {
    const apiMessage = payload.error?.message?.slice(0, 120) ?? responseText.slice(0, 120);
    throw new Error(`embedding_failed: http_${response.status} ${apiMessage}`);
  }

  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("embedding_failed: invalid_dimensions");
  }

  return {
    model: EMBEDDING_MODEL,
    embedding: formatEmbeddingForStorage(vector),
    dimensions: EMBEDDING_DIMENSIONS,
  };
}

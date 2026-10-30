const BASE = "https://yce-api-01.makeupar.com";
type Json = Record<string, unknown>;
function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export class ProviderError extends Error {
  constructor(
    public code: string,
    public httpStatus?: number,
  ) {
    super(`YouCam request failed (${code}).`);
  }
}
export function providerFileUrl(value: string) {
  const url = new URL(value);
  const suffixes = ["amazonaws.com", "makeupar.com", "perfectcorp.com", "cloudfront.net"];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !suffixes.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  )
    throw new ProviderError("UNEXPECTED_FILE_HOST");
  return url.toString();
}
export class YouCamClient {
  constructor(
    private readonly key: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!key.trim()) throw new ProviderError("MISSING_API_KEY");
  }
  private async json(path: string, method = "GET", body?: unknown): Promise<Json> {
    let response: Response;
    try {
      response = await this.request(`${BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      });
    } catch {
      throw new ProviderError(method === "POST" ? "SUBMISSION_UNCERTAIN" : "NETWORK_ERROR");
    }
    let value: Json;
    try {
      value = record(await response.json());
    } catch {
      throw new ProviderError("INVALID_JSON", response.status);
    }
    if (!response.ok || (typeof value.status === "number" && value.status >= 400)) {
      const code =
        text(value.error_code)
          .replace(/[^A-Za-z0-9_-]/g, "")
          .slice(0, 60) || `HTTP_${response.status}`;
      throw new ProviderError(code, response.status);
    }
    return value;
  }
  async upload(bytes: Uint8Array, name: string) {
    const registration = await this.json("/s2s/v2.0/file", "POST", {
      files: [{ content_type: "image/jpeg", file_name: name, file_size: bytes.byteLength }],
    });
    const files = record(registration.data).files;
    const file = record(Array.isArray(files) ? files[0] : null);
    const requests = file.requests;
    const upload = record(Array.isArray(requests) ? requests[0] : null);
    if (!text(file.file_id) || !text(upload.url) || upload.method !== "PUT")
      throw new ProviderError("UNEXPECTED_UPLOAD_RESPONSE");
    const headers = record(upload.headers);
    const safeHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (
        typeof value === "string" &&
        !["authorization", "host", "cookie"].includes(key.toLowerCase())
      )
        safeHeaders[key] = value;
    }
    let response: Response;
    try {
      response = await this.request(providerFileUrl(text(upload.url)), {
        method: "PUT",
        headers: safeHeaders,
        body: Buffer.from(bytes),
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      });
    } catch {
      throw new ProviderError("UPLOAD_FAILED");
    }
    if (!response.ok) throw new ProviderError("UPLOAD_FAILED", response.status);
    return text(file.file_id);
  }
  async submit(personFileId: string, garmentFileId: string) {
    const value = await this.json("/s2s/v2.0/task/cloth-v3", "POST", {
      src_file_id: personFileId,
      ref_file_id: garmentFileId,
      garment_category: "upper_body",
      change_shoes: false,
    });
    const id = text(record(value.data).task_id);
    if (!id) throw new ProviderError("SUBMISSION_UNCERTAIN");
    return id;
  }
  async status(taskId: string) {
    const value = await this.json(`/s2s/v2.0/task/cloth-v3/${encodeURIComponent(taskId)}`);
    const data = record(value.data);
    const status = text(data.task_status);
    if (!["success", "error", "running", "queued", "processing", "pending"].includes(status))
      throw new ProviderError("UNEXPECTED_TASK_STATUS");
    const results = record(data.results);
    return {
      status,
      url: status === "success" ? providerFileUrl(text(results.url)) : null,
      error: status === "error" ? "PROVIDER_TASK_ERROR" : null,
    };
  }
  async download(url: string) {
    const response = await this.request(providerFileUrl(url), {
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
    if (!response.ok) throw new ProviderError("RESULT_DOWNLOAD_FAILED", response.status);
    if (Number(response.headers.get("content-length") || 0) > 20_000_000)
      throw new ProviderError("RESULT_TOO_LARGE");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 20_000_000) throw new ProviderError("RESULT_TOO_LARGE");
    return bytes;
  }
}

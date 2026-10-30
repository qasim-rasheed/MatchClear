import { describe, expect, it, vi } from "vitest";
import { YouCamClient, providerFileUrl } from "../src/server/youcam/client";
import { PrivateFiles } from "../src/server/storage/private-files";

describe("provider boundary", () => {
  it("keeps the bearer key out of presigned file uploads and sends V3 file IDs", async () => {
    const request = vi.fn<typeof fetch>();
    request.mockResolvedValueOnce(
      Response.json({
        data: {
          files: [
            {
              file_id: "person-file",
              requests: [
                {
                  method: "PUT",
                  url: "https://example.s3.amazonaws.com/upload",
                  headers: { "Content-Type": "image/jpeg" },
                },
              ],
            },
          ],
        },
      }),
    );
    request.mockResolvedValueOnce(new Response(null, { status: 200 }));
    request.mockResolvedValueOnce(Response.json({ data: { task_id: "task-123" } }));
    const api = new YouCamClient("test-only-key", request);
    expect(await api.upload(new Uint8Array([1, 2]), "person.jpg")).toBe("person-file");
    expect(request.mock.calls[1][1]?.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(await api.submit("person-file", "shirt-file")).toBe("task-123");
    expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toMatchObject({
      src_file_id: "person-file",
      ref_file_id: "shirt-file",
      garment_category: "upper_body",
      change_shoes: false,
    });
  });
  it("reports a lost submission response as uncertain rather than silently retrying", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("contains private request details"));
    await expect(new YouCamClient("test", request).submit("person", "shirt")).rejects.toThrow(
      "SUBMISSION_UNCERTAIN",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("recognizes documented success and safely rejects unfamiliar states and remote hosts", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            task_status: "success",
            results: { url: "https://example.s3.amazonaws.com/output.jpg" },
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: { task_status: "unexpected" } }));
    const api = new YouCamClient("test", request);
    expect((await api.status("test-task")).status).toBe("success");
    await expect(api.status("test-task")).rejects.toThrow("UNEXPECTED_TASK_STATUS");
    expect(() => providerFileUrl("http://127.0.0.1/private")).toThrow();
    expect(() => providerFileUrl("https://amazonaws.com.attacker.example/input")).toThrow();
  });
  it("blocks private file traversal", () => {
    const files = new PrivateFiles(".local/files");
    expect(() => files.path("../outside.txt")).toThrow();
    expect(() => files.path(".")).toThrow();
  });
});

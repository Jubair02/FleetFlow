import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudinaryDownloadUrl, cloudinarySignature, detectImageMime, readPodFile, savePodFile } from "@/lib/storage";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const cloud = { cloudName: "demo", apiKey: "123", apiSecret: "abcd" };

describe("cloudinarySignature", () => {
  it("matches Cloudinary's documented example", () => {
    // https://cloudinary.com/documentation/authentication_signatures
    const sig = cloudinarySignature(
      { timestamp: 1315060510, public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop" },
      "abcd"
    );
    expect(sig).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });
});

describe("cloudinaryDownloadUrl", () => {
  it("signs a private download that expires in five minutes", () => {
    const url = new URL(cloudinaryDownloadUrl(cloud, "fleetflow/pod/abc", "png", 1_700_000_000_000));
    expect(url.pathname).toBe("/v1_1/demo/image/download");
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({ public_id: "fleetflow/pod/abc", format: "png", type: "private", api_key: "123" });
    expect(Number(q.expires_at) - Number(q.timestamp)).toBe(300);
    const { signature, api_key: _key, ...signed } = q;
    expect(signature).toBe(cloudinarySignature(signed, "abcd"));
  });
});

describe("savePodFile", () => {
  it("rejects files that aren't PNG, JPEG or WebP by content", async () => {
    await expect(savePodFile(Buffer.from("<svg></svg>.........."), "x.png")).rejects.toThrow(/Only PNG, JPEG or WebP/);
  });

  it("rejects files over 4 MB", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]);
    await expect(savePodFile(big, "big.png")).rejects.toThrow(/max 4 MB/);
  });

  it("refuses to write to local disk on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    await expect(savePodFile(PNG, "sig.png")).rejects.toThrow(/storage is not configured/);
  });

  it("uploads to Cloudinary as a private asset when configured", async () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
    vi.stubEnv("CLOUDINARY_API_KEY", "123");
    vi.stubEnv("CLOUDINARY_API_SECRET", "abcd");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ public_id: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const stored = await savePodFile(PNG, "sig.png");
    expect(stored.fileKey).toMatch(/^cloudinary:fleetflow\/pod\/[a-f0-9]{24}\.png$/);
    expect(stored.mimeType).toBe("image/png");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    const form = init.body as FormData;
    expect(form.get("type")).toBe("private");
    expect(form.get("api_key")).toBe("123");
    expect(form.get("api_secret")).toBeNull(); // the secret only signs; it is never sent
  });
});

describe("readPodFile", () => {
  it("rejects malformed keys instead of touching the filesystem", async () => {
    await expect(readPodFile("../../.env")).rejects.toThrow(/Invalid file key/);
    await expect(readPodFile("cloudinary:../x.png")).rejects.toThrow();
  });
});

describe("detectImageMime", () => {
  it("sniffs PNG magic bytes", () => {
    expect(detectImageMime(PNG)).toBe("image/png");
  });
});

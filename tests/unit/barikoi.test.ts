import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autocomplete,
  barikoiMapKey,
  barikoiStyleUrl,
  geocodeAddress,
  geocodingEnabled,
  parseAutocomplete,
  parseGeocode,
  parseReverse,
  reverseGeocode,
} from "@/lib/barikoi";

// Barikoi client: config from env, defensive parsing, and HTTP with a mocked fetch.

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("BARIKOI_API_KEY", "bk_server");
  vi.stubEnv("BARIKOI_MAP_KEY", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("config", () => {
  it("uses the map key for styles, falling back to the API key", () => {
    expect(barikoiMapKey()).toBe("bk_server");
    vi.stubEnv("BARIKOI_MAP_KEY", "bk_browser");
    expect(barikoiStyleUrl()).toBe("https://map.barikoi.com/styles/osm-liberty/style.json?key=bk_browser");
  });

  it("is off without keys — no style, no lookups, no requests", async () => {
    vi.stubEnv("BARIKOI_API_KEY", "");
    expect(geocodingEnabled()).toBe(false);
    expect(barikoiStyleUrl()).toBeNull();
    expect(await geocodeAddress("House 12, Road 5, Dhanmondi")).toBeNull();
    expect(await autocomplete("gulshan")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("parsing", () => {
  const good = {
    address_status: "complete",
    confidence_score_percentage: "82",
    fixed_address: "house 12, road 5, dhanmondi, dhaka",
    geocoded_address: { latitude: "23.746512345", longitude: "90.376", address: "House 12, Road 5, Dhanmondi", city: "Dhaka" },
  };

  it("reads string coordinates and rounds them", () => {
    expect(parseGeocode(good)).toEqual({ lat: 23.74651, lng: 90.376, confidence: 82, formatted: "House 12, Road 5, Dhanmondi" });
  });

  it("rejects low confidence, points outside Bangladesh and junk", () => {
    expect(parseGeocode({ ...good, confidence_score_percentage: 25 })).toBeNull();
    expect(parseGeocode({ ...good, geocoded_address: { latitude: "51.5", longitude: "-0.12" } })).toBeNull();
    expect(parseGeocode({ ...good, geocoded_address: { latitude: "", longitude: null } })).toBeNull();
    expect(parseGeocode({ ...good, geocoded_address: undefined })).toBeNull();
    expect(parseGeocode(null)).toBeNull();
    expect(parseGeocode("oops")).toBeNull();
  });

  it("keeps usable autocomplete places only", () => {
    const places = parseAutocomplete({
      places: [
        { latitude: "23.7925", longitude: "90.4078", address: "Gulshan 1, Dhaka", address_bn: "গুলশান ১", area: "Gulshan", city: "Dhaka" },
        { latitude: 90.4, longitude: 23.79, address: "Swapped" },
        { latitude: "23.8", longitude: "90.4" },
        "bad",
      ],
    });
    expect(places).toEqual([{ lat: 23.7925, lng: 90.4078, address: "Gulshan 1, Dhaka", addressBn: "গুলশান ১", area: "Gulshan", city: "Dhaka" }]);
    expect(parseAutocomplete({})).toEqual([]);
  });

  it("reads reverse geocode places", () => {
    expect(parseReverse({ place: { address: "Road 5", area: "Dhanmondi", city: "Dhaka" } })).toEqual({ address: "Road 5", area: "Dhanmondi", city: "Dhaka" });
    expect(parseReverse({ place: {} })).toBeNull();
    expect(parseReverse({})).toBeNull();
  });
});

describe("HTTP", () => {
  it("geocodes with a form POST and the key as a query param", async () => {
    fetchMock.mockResolvedValue(json({ confidence_score_percentage: 90, geocoded_address: { latitude: 23.75, longitude: 90.39 } }));
    expect(await geocodeAddress("  House 12, Road 5, Dhanmondi  ")).toMatchObject({ lat: 23.75, lng: 90.39, confidence: 90 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://barikoi.xyz/v2/api/search/rupantor/geocode");
    expect(u.searchParams.get("api_key")).toBe("bk_server");
    expect(init.method).toBe("POST");
    expect(new URLSearchParams(String(init.body)).get("q")).toBe("House 12, Road 5, Dhanmondi");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null on HTTP errors and network failures without logging the key", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "bad key" }, 401));
    expect(await geocodeAddress("House 12, Road 5")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("socket hang up bk_server"));
    expect(await autocomplete("gulshan")).toEqual([]);
    for (const call of vi.mocked(console.warn).mock.calls) expect(call.join(" ")).not.toContain("bk_server");
  });

  it("searches and reverse-geocodes", async () => {
    fetchMock.mockResolvedValueOnce(json({ places: [{ latitude: "23.79", longitude: "90.41", address: "Gulshan" }] }));
    expect(await autocomplete("gul")).toHaveLength(1);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("bangla")).toBe("true");
    fetchMock.mockResolvedValueOnce(json({ place: { address: "Road 5", area: "Dhanmondi", city: "Dhaka" } }));
    expect(await reverseGeocode(23.746, 90.376)).toEqual({ address: "Road 5", area: "Dhanmondi", city: "Dhaka" });
    // outside the service area: no request
    expect(await reverseGeocode(51.5, -0.12)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips queries that are too short", async () => {
    expect(await autocomplete("a")).toEqual([]);
    expect(await geocodeAddress("ab")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

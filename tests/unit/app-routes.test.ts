import { describe, expect, it } from "vitest";
import { appLocation, appPath, historyMode, parseAppPath, resolveAppLocation, type AppView } from "@/lib/app-routes";
import { matchesCacheKey } from "@/lib/data-cache";

describe("company app addresses", () => {
  it("gives every screen its own address", () => {
    const paths: Record<AppView, string> = {
      dashboard: "/dashboard",
      deliveries: "/deliveries",
      dispatch: "/dispatch",
      map: "/map",
      drivers: "/drivers",
      vehicles: "/vehicles",
      reports: "/reports",
      cod: "/cod",
      notifications: "/notifications",
      audit: "/audit",
      settings: "/settings",
      "driver-jobs": "/jobs",
      "driver-history": "/history",
    };
    for (const [view, path] of Object.entries(paths) as [AppView, string][]) {
      expect(appPath(appLocation(view))).toBe(path);
      expect(parseAppPath(path)).toEqual(appLocation(view));
    }
  });

  it("round-trips details, tabs and the status filter", () => {
    const cases = [
      appLocation("deliveries", { deliveryId: "cmabc123xyz" }),
      appLocation("deliveries", { status: "FAILED" }),
      appLocation("driver-jobs", { deliveryId: "cmjob1" }),
      appLocation("driver-history", { deliveryId: "cmjob2" }),
      appLocation("settings", { settingsTab: "team" }),
      appLocation("settings", { settingsTab: "plan" }),
      appLocation("settings", { settingsTab: "developers" }),
      appLocation("settings", { settingsTab: "zones" }),
      appLocation("settings", { settingsTab: "tracking" }),
    ];
    for (const loc of cases) {
      const href = appPath(loc);
      const [pathname, search = ""] = href.split("?");
      expect(parseAppPath(pathname, search ? `?${search}` : "")).toEqual(loc);
    }
    expect(appPath(appLocation("deliveries", { deliveryId: "d1" }))).toBe("/deliveries/d1");
    expect(appPath(appLocation("deliveries", { status: "FAILED" }))).toBe("/deliveries?status=FAILED");
    expect(appPath(appLocation("driver-jobs", { deliveryId: "d1" }))).toBe("/jobs/d1");
    expect(appPath(appLocation("settings", { settingsTab: "plan" }))).toBe("/settings/plan");
    expect(appPath(appLocation("settings", { settingsTab: "zones" }))).toBe("/settings/zones");
  });

  it("drops state that doesn't belong to the screen", () => {
    expect(appPath(appLocation("dashboard", { deliveryId: "d1", status: "FAILED", settingsTab: "plan" }))).toBe("/dashboard");
    // A detail address carries no filter.
    expect(appPath(appLocation("deliveries", { deliveryId: "d1", status: "FAILED" }))).toBe("/deliveries/d1");
    expect(parseAppPath("/settings/company")).toEqual(appLocation("settings"));
    expect(appPath(appLocation("settings", { settingsTab: "company" }))).toBe("/settings");
  });

  it("is lenient with case, trailing slashes and junk", () => {
    expect(parseAppPath("/Deliveries/")).toEqual(appLocation("deliveries"));
    expect(parseAppPath("/deliveries", "?status=failed")).toEqual(appLocation("deliveries", { status: "FAILED" }));
    expect(parseAppPath("/deliveries", "?status=ALL")).toEqual(appLocation("deliveries"));
    expect(parseAppPath("/deliveries", "?status=<script>")).toEqual(appLocation("deliveries"));
    expect(parseAppPath("/deliveries/bad%20id")).toEqual(appLocation("deliveries"));
    expect(parseAppPath("/settings/nope")).toEqual(appLocation("settings"));
    expect(parseAppPath("/settings/PLAN")).toEqual(appLocation("settings", { settingsTab: "plan" }));
  });

  it("returns null for the root and anything that isn't a screen", () => {
    expect(parseAppPath("/")).toBeNull();
    expect(parseAppPath("")).toBeNull();
    expect(parseAppPath("/nope")).toBeNull();
    expect(parseAppPath("/driver-jobs")).toBeNull(); // view ids aren't addresses
    expect(parseAppPath("/%E0%A4%A")).toBeNull(); // malformed escape
  });
});

describe("role guard", () => {
  it("opens allowed screens as addressed", () => {
    const loc = appLocation("settings", { settingsTab: "team" });
    expect(resolveAppLocation(loc, "ADMIN")).toEqual(loc);
    expect(resolveAppLocation(appLocation("driver-jobs", { deliveryId: "d1" }), "DRIVER")).toEqual(appLocation("driver-jobs", { deliveryId: "d1" }));
    expect(resolveAppLocation(appLocation("notifications"), "DRIVER")).toEqual(appLocation("notifications"));
  });

  it("sends unknown or not-allowed screens to the role's home", () => {
    expect(resolveAppLocation(null, "ADMIN")).toEqual(appLocation("dashboard"));
    expect(resolveAppLocation(null, "DRIVER")).toEqual(appLocation("driver-jobs"));
    expect(resolveAppLocation(appLocation("settings"), "DISPATCHER")).toEqual(appLocation("dashboard"));
    expect(resolveAppLocation(appLocation("audit"), "DISPATCHER")).toEqual(appLocation("dashboard"));
    // the live map is for staff only
    expect(resolveAppLocation(appLocation("map"), "DISPATCHER")).toEqual(appLocation("map"));
    expect(resolveAppLocation(appLocation("map"), "ADMIN")).toEqual(appLocation("map"));
    expect(resolveAppLocation(appLocation("map"), "DRIVER")).toEqual(appLocation("driver-jobs"));
    expect(resolveAppLocation(appLocation("deliveries", { deliveryId: "d1" }), "DRIVER")).toEqual(appLocation("driver-jobs"));
    expect(resolveAppLocation(appLocation("driver-jobs"), "ADMIN")).toEqual(appLocation("dashboard"));
  });
});

describe("history mode", () => {
  const list = appLocation("deliveries");
  const detail = appLocation("deliveries", { deliveryId: "d1" });

  it("pushes a new entry for another screen", () => {
    expect(historyMode(appLocation("dashboard"), list)).toBe("push");
    expect(historyMode(appLocation("dashboard"), detail)).toBe("push");
    expect(historyMode(detail, appLocation("dashboard"))).toBe("push");
  });

  it("treats a detail dialog over its list as an overlay", () => {
    expect(historyMode(list, detail)).toBe("push-overlay");
    expect(historyMode(detail, list)).toBe("close-overlay");
    expect(historyMode(appLocation("driver-jobs"), appLocation("driver-jobs", { deliveryId: "j1" }))).toBe("push-overlay");
  });

  it("replaces for tabs, filters and detail-to-detail", () => {
    expect(historyMode(appLocation("settings"), appLocation("settings", { settingsTab: "plan" }))).toBe("replace");
    expect(historyMode(list, appLocation("deliveries", { status: "FAILED" }))).toBe("replace");
    expect(historyMode(detail, appLocation("deliveries", { deliveryId: "d2" }))).toBe("replace");
  });
});

describe("request cache key matching (bump)", () => {
  it("matches everything without a matcher", () => {
    expect(matchesCacheKey("/api/org")).toBe(true);
    expect(matchesCacheKey(["not", "a", "url"])).toBe(false);
  });

  it("matches a prefix on a path boundary", () => {
    expect(matchesCacheKey("/api/deliveries", "/api/deliveries")).toBe(true);
    expect(matchesCacheKey("/api/deliveries?page=2&pageSize=20", "/api/deliveries")).toBe(true);
    expect(matchesCacheKey("/api/deliveries/abc", "/api/deliveries")).toBe(true);
    expect(matchesCacheKey("/api/deliveries-export", "/api/deliveries")).toBe(false);
    expect(matchesCacheKey("/api/dispatch", "/api/deliveries")).toBe(false);
    expect(matchesCacheKey("/api/my/jobs?scope=history", "/api/my/jobs")).toBe(true);
    expect(matchesCacheKey("/api/platform/plans", "/api/platform")).toBe(true);
  });

  it("takes explicit prefixes, lists and predicates", () => {
    expect(matchesCacheKey("/api/my/jobs?scope=history", "/api/my/jobs?")).toBe(true);
    expect(matchesCacheKey("/api/my/jobs", "/api/my/jobs?")).toBe(false);
    expect(matchesCacheKey("/api/staff", ["/api/org", "/api/staff"])).toBe(true);
    expect(matchesCacheKey("/api/drivers", ["/api/org", "/api/staff"])).toBe(false);
    expect(matchesCacheKey("/api/notifications", (k) => k !== "/api/notifications")).toBe(false);
    expect(matchesCacheKey("/api/dashboard?tz=60", (k) => k !== "/api/notifications")).toBe(true);
  });
});

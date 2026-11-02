import { lookup as dnsLookup, type LookupAddress } from "dns";
import http from "http";
import https from "https";
import { BlockList, isIP } from "net";

// ─────────────────────────────────────────────────────────────
// SSRF protection for outgoing webhooks. A webhook URL is chosen by a
// customer, so FleetFlow must never be usable to reach its own network:
//
//   • https only — http is allowed for localhost / 127.0.0.1 / [::1] only
//     when NODE_ENV !== "production" (local testing)
//   • no credentials in the URL, no internal-looking host names
//   • the host is resolved at SEND time and every address is checked
//     against private, loopback, link-local (incl. cloud metadata
//     169.254.169.254), CGNAT, multicast and reserved ranges. The socket
//     then connects to the address that was checked (custom `lookup`),
//     so a DNS answer can't change between check and connect (rebinding).
//   • redirects are never followed (a 3xx is a failed attempt)
//   • 10 s overall timeout; at most a few KB of the response are read
// ─────────────────────────────────────────────────────────────

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 96], // unspecified, loopback, IPv4-compatible (deprecated)
  ["64:ff9b::", 96], // NAT64 — could reach any IPv4 address
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 — embeds an IPv4 address
  ["fc00::", 7], // unique local (incl. fd00:ec2::254 metadata)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}
// IPv4-mapped IPv6 (::ffff:a.b.c.d) is matched against the IPv4 rules by BlockList.

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

function family(address: string): "ipv4" | "ipv6" | null {
  const v = isIP(address);
  return v === 4 ? "ipv4" : v === 6 ? "ipv6" : null;
}

/** True for any address a webhook must not reach (non-IP strings count as blocked). */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const fam = family(bare);
  if (!fam) return true;
  return BLOCKED.check(bare, fam);
}

function isLoopbackAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  const fam = family(bare);
  return !!fam && LOOPBACK.check(bare, fam);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const INTERNAL_HOST_RE = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i;

/** Local http(s) targets are allowed outside production only. */
export function allowsLocalTargets(env: string | undefined = process.env.NODE_ENV): boolean {
  return env !== "production";
}

export class WebhookUrlError extends Error {}

/**
 * Check a webhook URL when it is saved (the address check is repeated at
 * send time, see postWebhook). Returns the normalized URL.
 */
export function validateWebhookUrl(raw: string, opts: { allowLocal?: boolean } = {}): string {
  const allowLocal = opts.allowLocal ?? allowsLocalTargets();
  const text = raw.trim();
  if (!text) throw new WebhookUrlError("Enter the URL that should receive webhooks");
  if (text.length > 2048) throw new WebhookUrlError("The URL is too long (max 2048 characters)");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new WebhookUrlError("Enter a valid URL, e.g. https://shop.example.com/fleetflow/webhook");
  }
  const host = url.hostname.toLowerCase();
  const local = LOCAL_HOSTS.has(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local && allowLocal)) {
    throw new WebhookUrlError(
      allowLocal ? "The URL must start with https:// (http:// is only allowed for localhost)" : "The URL must start with https://"
    );
  }
  if (url.username || url.password) throw new WebhookUrlError("The URL must not contain a username or password");
  if (local) {
    if (!allowLocal) throw new WebhookUrlError("Webhooks can't be sent to localhost");
  } else if (family(host.replace(/^\[|\]$/g, ""))) {
    if (isBlockedAddress(host)) throw new WebhookUrlError("Webhooks can't be sent to private or reserved IP addresses");
  } else if (!host.includes(".") || INTERNAL_HOST_RE.test(host)) {
    throw new WebhookUrlError("Use a public host name — internal or local network addresses aren't allowed");
  }
  url.hash = "";
  return url.toString();
}

// ── sending ──────────────────────────────────────────────────

export class WebhookSendError extends Error {}

export interface WebhookResponse {
  status: number;
  /** First bytes of the response body (for error messages). */
  body: string;
  location: string | null;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** dns.lookup replacement that refuses blocked addresses and pins the checked one (exported for tests). */
export function guardedLookup(allowLoopback: boolean) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, "");
      const list = addresses as LookupAddress[];
      const bad = list.find((a) => isBlockedAddress(a.address) && !(allowLoopback && isLoopbackAddress(a.address)));
      if (!list.length || bad) {
        return callback(Object.assign(new WebhookSendError(`${hostname} resolves to a private or reserved address — refused`), { code: "EBLOCKED" }), "");
      }
      if (typeof options === "object" && options?.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

export interface PostWebhookInput {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs?: number;
  maxBodyBytes?: number;
  allowLocal?: boolean;
}

/** POST the payload once. Resolves with any HTTP response; rejects on refusal, network error or timeout. */
export function postWebhook(input: PostWebhookInput): Promise<WebhookResponse> {
  const timeoutMs = input.timeoutMs ?? 10_000;
  const maxBodyBytes = input.maxBodyBytes ?? 4096;
  const allowLocal = input.allowLocal ?? allowsLocalTargets();

  let url: URL;
  try {
    url = new URL(validateWebhookUrl(input.url, { allowLocal }));
  } catch (e) {
    return Promise.reject(new WebhookSendError(e instanceof Error ? e.message : "Invalid URL"));
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const local = LOCAL_HOSTS.has(url.hostname.toLowerCase());
  if (family(host) && isBlockedAddress(host) && !(local && allowLocal)) {
    return Promise.reject(new WebhookSendError("Webhooks can't be sent to private or reserved IP addresses"));
  }

  const transport = url.protocol === "https:" ? https : http;
  return new Promise<WebhookResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...input.headers, "Content-Length": Buffer.byteLength(input.body).toString() },
        lookup: guardedLookup(local && allowLocal) as unknown as typeof dnsLookup,
        agent: false, // fresh socket: no connection reuse past the address check
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () =>
          finish(() =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8").slice(0, maxBodyBytes),
              location: typeof res.headers.location === "string" ? res.headers.location : null,
            })
          );
        res.on("data", (chunk: Buffer) => {
          if (size >= maxBodyBytes) return;
          chunks.push(chunk);
          size += chunk.length;
          if (size >= maxBodyBytes) {
            done();
            res.destroy();
          }
        });
        res.on("end", done);
        res.on("error", done); // headers arrived: the status is what matters
        res.on("close", done);
      }
    );
    const timer = setTimeout(() => {
      finish(() => reject(new WebhookSendError(`Timed out after ${Math.round(timeoutMs / 1000)}s`)));
      req.destroy();
    }, timeoutMs);
    req.on("error", (e) => finish(() => reject(e instanceof WebhookSendError ? e : new WebhookSendError(e.message || "Connection failed"))));
    req.end(input.body);
  });
}

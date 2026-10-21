import { describe, expect, it } from "vitest";
import {
  appBaseUrl,
  customerDeliveredEmail,
  customerFailedEmail,
  customerTrackingEmail,
  escapeHtml,
  renderHtml,
  senderName,
  trackingUrl,
} from "@/lib/email/templates";

const base = { companyName: "Rahman Traders", recipientName: "Karim", trackingCode: "FF-AB12" };

describe("email templates", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe("&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;");
  });

  it("builds tracking URLs from APP_URL without double slashes", () => {
    expect(trackingUrl("tok_1", "https://app.example.com/")).toBe("https://app.example.com/?track=tok_1");
    expect(trackingUrl("a b", "https://x.io")).toBe("https://x.io/?track=a%20b");
    expect(appBaseUrl("")).toBe("http://localhost:3000");
  });

  it("uses '<Company> via FleetFlow' as sender context", () => {
    expect(senderName("Rahman Traders")).toBe("Rahman Traders via FleetFlow");
    expect(senderName(null)).toBe("FleetFlow");
  });

  it("tracking email contains the code and link", () => {
    const e = customerTrackingEmail({ ...base, trackingUrl: "https://x.io/?track=t1" });
    expect(e.subject).toBe("Your delivery FF-AB12 from Rahman Traders");
    expect(e.text).toContain("Hello Karim,");
    expect(e.text).toContain("https://x.io/?track=t1");
  });

  it("delivered email follows the required subject", () => {
    const e = customerDeliveredEmail({ ...base, trackingUrl: "https://x.io/?track=t1" });
    expect(e.subject).toBe("Your delivery FF-AB12 was delivered");
  });

  it("failed email is neutral — no reasons or notes", () => {
    const e = customerFailedEmail(base);
    expect(e.subject).toContain("unsuccessful");
    expect(e.text).toContain("Rahman Traders will contact you");
    expect(e.text).not.toMatch(/reason|note|refused|address/i);
  });

  it("renders HTML with escaped content and linked URLs", () => {
    const html = renderHtml({
      subject: "<script>x</script>",
      text: "Hi <b>you</b>\n\nTrack: https://x.io/?track=t1",
      companyName: "A & B <Co>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Hi &lt;b&gt;you&lt;/b&gt;");
    expect(html).toContain('<a href="https://x.io/?track=t1"');
    expect(html).toContain("A &amp; B &lt;Co&gt; via FleetFlow");
  });
});

import { describe, expect, it } from "vitest";
import { ipBucket } from "./rateLimit";

describe("ipBucket", () => {
  it("IPv4 adresini olduğu gibi bırakır", () => {
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });
  it("aynı /64 içindeki IPv6 adreslerini tek kovaya indirir", () => {
    const a = ipBucket("2001:db8:1:2:aaaa::1");
    expect(a).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:0db8:0001:0002:ffff:1:2:3")).toBe(a);
    expect(ipBucket("2001:db8:1:3::1")).not.toBe(a);
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
  });
});

import { describe, it, expect } from "vitest";
import { buildTRA } from "./wsaa";

describe("buildTRA", () => {
  it("arma el TRA con service, uniqueId y tiempos con offset -03:00", () => {
    const tra = buildTRA("wsfe");
    expect(tra).toContain("<service>wsfe</service>");
    expect(tra).toMatch(/<uniqueId>\d+<\/uniqueId>/);
    const gen = tra.match(/<generationTime>(.*?)<\/generationTime>/)?.[1] ?? "";
    const exp = tra.match(/<expirationTime>(.*?)<\/expirationTime>/)?.[1] ?? "";
    expect(gen).toContain("-03:00");
    expect(exp).toContain("-03:00");
    // generation es anterior a expiration
    expect(new Date(gen).getTime()).toBeLessThan(new Date(exp).getTime());
  });
});

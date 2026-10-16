import { describe, expect, it } from "vitest";
import { missingSeedServices } from "@/lib/onboardingServiceSeed";
const seeds = [{ name: "Knippen" }, { name: "Kleuren" }, { name: "Föhnen" }];
describe("missingSeedServices", () => {
  it("lege salon krijgt alle standaarddiensten", () => expect(missingSeedServices(seeds, []).map(s => s.name)).toEqual(["Knippen", "Kleuren", "Föhnen"]));
  it("gedeeltelijke seed vult alleen ontbrekende aan", () => expect(missingSeedServices(seeds, ["knippen "]).map(s => s.name)).toEqual(["Kleuren", "Föhnen"]));
  it("volledige seed voegt niets toe", () => expect(missingSeedServices(seeds, ["Knippen", "Kleuren", "Föhnen"])).toEqual([]));
  it("eigen dienst van de salon blokkeert aanvullen", () => expect(missingSeedServices(seeds, ["Knippen", "Eigen behandeling"])).toEqual([]));
});

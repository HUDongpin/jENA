import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accumulateData, accumulateDataChunked } from "../src/index.js";
import type { Row } from "../src/index.js";

// The chunked/streaming engine re-implements the accumulation semantics
// (advisory F-007); until the two engines are consolidated, this suite pins
// streaming == batch for every golden model configuration on both datasets.
const fixturePath = new URL("../fixtures/goldens/sena-configs.generated.json", import.meta.url);

if (!existsSync(fixturePath)) {
  describe.skip("streaming equivalence", () => {
    it("requires the golden fixture", () => undefined);
  });
} else {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

  type Spec = {
    name: string;
    input: Row[];
    codes: string[];
    units: string[];
    conversation: string[];
    metadata: string[];
    configs: Record<string, { options: Record<string, unknown> }>;
  };

  const specs: Spec[] = [
    {
      name: "toy",
      input: fixture.input as Row[],
      codes: fixture.codes as string[],
      units: ["unit"],
      conversation: ["conv"],
      metadata: ["group"],
      configs: fixture.configs
    },
    {
      name: "research",
      input: fixture.research.input as Row[],
      codes: fixture.research.codes as string[],
      units: ["person"],
      conversation: ["team", "stanza"],
      metadata: ["group", "role"],
      configs: fixture.research.configs
    }
  ];

  describe("streaming equivalence with batch accumulation", () => {
    for (const spec of specs) {
      for (const [configName, config] of Object.entries(spec.configs)) {
        it(`chunked === batch for ${spec.name} ${configName}`, () => {
          const options = {
            rows: spec.input,
            units: spec.units,
            conversation: spec.conversation,
            codes: spec.codes,
            metadata: spec.metadata,
            model: config.options.model as never,
            weightBy: config.options.weightBy as never,
            window: config.options.window as never,
            windowSizeBack: config.options.windowSizeBack as number,
            windowSizeForward: config.options.windowSizeForward as number
          };
          const batch = accumulateData(options);
          for (const chunkSize of [1, 5, 1000]) {
            const chunked = accumulateDataChunked({ ...options, chunkSize });
            expect(chunked.unitLabels).toEqual(batch.unitLabels);
            expect(chunked.connectionMatrix).toEqual(batch.connectionMatrix);
            expect(chunked.rowConnectionCounts).toEqual(batch.rowConnectionCounts);
            expect(chunked.metaData).toEqual(batch.metaData);
            expect(chunked.trajectories ?? null).toEqual(batch.trajectories ?? null);
          }
        });
      }
    }
  });
}

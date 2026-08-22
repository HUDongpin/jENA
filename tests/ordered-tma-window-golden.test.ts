import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { accumulateData } from "../src/index.js";
import type { Row } from "../src/index.js";

interface WindowGoldenCase {
  tmaWindowSize: number;
  jenaWindowSizeBack: number;
  connectionCounts: number[];
}

interface WindowGolden {
  schemaVersion: number;
  generatedAt: string;
  generator: {
    r: string;
    platform: string;
    tma: string;
    rENA: string;
    jsonlite: string;
    digest: string;
    dataTable: string;
    rlang: string;
    Rcpp: string;
    tmaSourceArchiveUrl: string;
    tmaSourceArchiveSha256: string;
    generatorScript: string;
    generatorScriptSha256: string;
    functionHashSpec: string;
    tmaFunctionBodySha256: Record<string, string>;
    tmaFunctionDefinitionSha256: Record<string, string>;
  };
  parameterMapping: { equation: string };
  codes: string[];
  rows: Row[];
  codeColumns: string[];
  cases: WindowGoldenCase[];
}

const fixturePath = fileURLToPath(
  new URL("../fixtures/goldens/ordered-window-tma.generated.json", import.meta.url)
);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as WindowGolden;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("ordered finite-window parity with a distinguishing tma oracle", () => {
  it("pins the generator environment, script, and documented artifact digest", () => {
    expect(fixture.schemaVersion).toBe(2);
    expect(fixture.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/);
    expect(fixture.generator.r).toBe("R version 4.4.2 (2024-10-31)");
    expect(fixture.generator.platform).toBe("aarch64-apple-darwin20");
    expect(fixture.generator.tma).toBe("0.3.1");
    expect(fixture.generator.rENA).toBe("0.3.1");
    expect(fixture.generator.jsonlite).toBe("2.0.0");
    expect(fixture.generator.digest).toBe("0.6.39");
    expect(fixture.generator.dataTable).toBe("1.18.2.1");
    expect(fixture.generator.rlang).toBe("1.1.7");
    expect(fixture.generator.Rcpp).toBe("1.1.1");
    expect(fixture.generator.tmaSourceArchiveUrl)
      .toBe("https://cran.r-project.org/src/contrib/tma_0.3.1.tar.gz");
    expect(fixture.generator.tmaSourceArchiveSha256)
      .toBe("d661721d133055f3143c79742d4da08ae2427e9ec6b576fd5c8ef69d459ee260");
    expect(fixture.generator.functionHashSpec)
      .toBe("sha256:R-serialize-v2:ascii=false");
    expect(fixture.generator.tmaFunctionBodySha256).toEqual({
      conversation_rules: "43082398a579f566fb6de45b8923c7f52a5812fa67455577b9e93adbd7dc664c",
      contexts: "3fd744d6fe9071c4af4b3bb2b9e531250b5d5aa62b19e4a8ec0a99356a5788e7",
      accumulate_contexts: "d6f44cddc0978ec26682bc2a0481b7ee7dabfd4fb1b133c8e0a2167ee2462ea0",
      decay: "e7773715bb45433330c0b4b2e2fe1e130287de263f989beba8951be52847631c",
      simple_window: "aeef752d401ecee64b0777e108666b52eb364f328b09a4ee6acbbd1729547854"
    });
    expect(fixture.generator.tmaFunctionDefinitionSha256).toEqual({
      conversation_rules: "5cf01315da17e68b9c8bcca177767c7661df7f289b1b5b0b6c7a20ca42341eef",
      contexts: "f874983adb39b1b0975b818177bd072a1ad30c1b10d2ece51dc476d835d58e5d",
      accumulate_contexts: "67eaac0d04100b46d6aa52fba847325548491e2995431a3d383cb691dd472c67",
      decay: "73eced92c691cc51b46299bff177df730b7e16b83d4a4e51dc5d0c01d65d4a2a",
      simple_window: "336b0e4b9cf16041c8f035c62760ba648c2023090b45d8c09c1284d8a09a496f"
    });
    expect(fixture.generator.generatorScript)
      .toBe("scripts/generate-ordered-window-golden.R");

    const generatorPath = fileURLToPath(
      new URL(`../${fixture.generator.generatorScript}`, import.meta.url)
    );
    expect(fixture.generator.generatorScriptSha256)
      .toBe(sha256(readFileSync(generatorPath)));

    const provenance = readFileSync(
      fileURLToPath(new URL("../PROVENANCE.md", import.meta.url)),
      "utf8"
    );
    expect(provenance).toContain(
      `| Distinguishing tma window golden | \`fixtures/goldens/ordered-window-tma.generated.json\` | \`${sha256(fixtureBytes)}\` |`
    );
  });

  it("records the explicit parameter conversion instead of claiming equal-number parity", () => {
    expect(fixture.parameterMapping.equation)
      .toBe("jenaWindowSizeBack = tmaWindowSize + 1");
    for (const testCase of fixture.cases) {
      expect(testCase.jenaWindowSizeBack).toBe(testCase.tmaWindowSize + 1);
    }
  });

  it.each(fixture.cases)(
    "matches tma window_size=$tmaWindowSize at jENA windowSizeBack=$jenaWindowSizeBack",
    ({ jenaWindowSizeBack, connectionCounts }) => {
      const result = accumulateData({
        rows: fixture.rows,
        units: ["unit"],
        conversation: ["horizon"],
        codes: fixture.codes,
        networkType: "ordered",
        windowSizeBack: jenaWindowSizeBack,
        weightBy: "sum"
      });

      expect(result.codeColumns).toEqual(fixture.codeColumns);
      expect(result.connectionMatrix).toEqual([connectionCounts]);
    }
  );
});

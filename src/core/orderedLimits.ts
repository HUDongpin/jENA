const ORDERED_RESERVED_OUTPUT_COLUMNS = new Set(['ENA_UNIT', 'TRAJ_UNIT']);

/** Canonical Yu ONA oracle size recorded by the verified descriptive contract. */
export const ORDERED_VERIFIED_CODE_COUNT = 7;

/**
 * Hard allocation boundary for the descriptive SVD phase. Twelve codes means
 * 144 directed edges and remained below the local performance knee; the
 * measured 16- and 20-code cases were already materially slow. There is no
 * override because this package phase has no separately verified large-model
 * solver contract.
 */
export const ORDERED_MAX_CODE_COUNT = 12;
export const ORDERED_MAX_EDGE_COUNT = ORDERED_MAX_CODE_COUNT * ORDERED_MAX_CODE_COUNT;

/**
 * Deterministic work proxy for the only supported ordered model: descriptive
 * SVD. With E directed edges, covariance costs units×E² and the dense
 * eigensolver costs E³. Eight million keeps the verified 7-code/87-unit Yu
 * contract (326,536) far inside the boundary while rejecting the scale where
 * the measured 16- and 20-code probes had already exposed a steep runtime
 * curve. This is deliberately not caller-configurable.
 */
export const ORDERED_MAX_SVD_WORK_UNITS = 8_000_000;

/**
 * Numeric-payload proxy for the dense matrices created by makeSet: two
 * units×E matrices (normalized and centered rows), plus three E² matrices
 * (covariance/eigen working storage), at eight bytes per number. The 1 MiB
 * ceiling retains more than eight times the verified Yu payload (125,832
 * bytes) but prevents a seemingly acceptable work count from hiding a large
 * dense allocation. JavaScript array overhead makes the real heap cost higher,
 * so this threshold is a safety boundary rather than a heap-size promise.
 */
export const ORDERED_MAX_SVD_MATRIX_BYTES = 1024 * 1024;

const FLOAT64_BYTES = 8;

export function assertOrderedAdjacencyBudget(codeCount: number): number {
  const edgeCount = codeCount * codeCount;
  if (codeCount > ORDERED_MAX_CODE_COUNT || edgeCount > ORDERED_MAX_EDGE_COUNT) {
    throw new Error(
      `Ordered network analysis descriptive SVD budget allows at most ${ORDERED_MAX_CODE_COUNT} codes ` +
      `(${ORDERED_MAX_EDGE_COUNT} directed edges); got ${codeCount} codes (${edgeCount} directed edges). ` +
      `The verified Yu contract uses ${ORDERED_VERIFIED_CODE_COUNT} codes, while 16/20-code probes are outside this safe bound.`
    );
  }
  return edgeCount;
}

export function assertOrderedSvdBudget(unitCount: number, edgeCount: number): void {
  const edgeSquared = edgeCount * edgeCount;
  const estimatedWork = unitCount * edgeSquared + edgeSquared * edgeCount;
  if (estimatedWork > ORDERED_MAX_SVD_WORK_UNITS) {
    throw new Error(
      `Ordered descriptive SVD work budget exceeded: units=${unitCount}, edges=${edgeCount}, ` +
      `estimated work=${estimatedWork} (units×E²+E³), limit=${ORDERED_MAX_SVD_WORK_UNITS}.`
    );
  }

  const estimatedMatrixBytes = FLOAT64_BYTES * (3 * edgeSquared + 2 * unitCount * edgeCount);
  if (estimatedMatrixBytes > ORDERED_MAX_SVD_MATRIX_BYTES) {
    throw new Error(
      `Ordered descriptive SVD matrix budget exceeded: units=${unitCount}, edges=${edgeCount}, ` +
      `estimated bytes=${estimatedMatrixBytes} (8×(3×E²+2×units×E)), ` +
      `limit=${ORDERED_MAX_SVD_MATRIX_BYTES}.`
    );
  }
}

export interface OrderedColumnNamespaces {
  codes: readonly string[];
  units: readonly string[];
  conversation: readonly string[];
  metadata?: readonly string[];
}

function isGeneratedOrderedHeader(
  column: string,
  codes: readonly string[],
  codeSet: ReadonlySet<string>
): boolean {
  for (const response of codes) {
    const suffix = ` & ${response}`;
    if (column.endsWith(suffix) && codeSet.has(column.slice(0, -suffix.length))) {
      return true;
    }
  }
  return false;
}

function assertUniqueOrderedHeaders(codes: readonly string[]): void {
  const generatedHeaders = new Set<string>();
  for (const response of codes) {
    for (const ground of codes) {
      const header = `${ground} & ${response}`;
      if (generatedHeaders.has(header)) {
        throw new Error(
          'Ordered adjacency headers collide; use unambiguous code labels so every "<ground> & <response>" header is unique.'
        );
      }
      generatedHeaders.add(header);
    }
  }
}

/**
 * Keeps generated ordered edge keys disjoint from caller and internal Row
 * columns. The accumulator stores both in the same object, so overlap would
 * overwrite analytic identity or metadata before the model sees it.
 */
export function validateOrderedColumnNamespace(namespaces: OrderedColumnNamespaces): void {
  const nonCodeNamespaces = [
    ['units', namespaces.units],
    ['conversation', namespaces.conversation],
    ['metadata', namespaces.metadata ?? []]
  ] as const;
  const declaredNamespaces = [...nonCodeNamespaces, ['codes', namespaces.codes] as const];

  const codeSet = new Set<string>();
  for (const code of namespaces.codes) {
    codeSet.add(code);
    if (ORDERED_RESERVED_OUTPUT_COLUMNS.has(code)) {
      throw new Error(
        `Ordered input column "${code}" collides with reserved output column "${code}".`
      );
    }
  }

  for (const [role, columns] of nonCodeNamespaces) {
    for (const column of columns) {
      if (codeSet.has(column)) {
        throw new Error(
          `Ordered code column "${column}" cannot also belong to the ${role} namespace; ` +
          'code and analytic identity/metadata roles must use distinct input columns.'
        );
      }
      if (ORDERED_RESERVED_OUTPUT_COLUMNS.has(column)) {
        throw new Error(
          `Ordered input column "${column}" collides with reserved output column "${column}".`
        );
      }
    }
  }

  // Resolve namespace conflicts before materializing the p×p header set.
  // Matching a declared column against response suffixes uses only bounded
  // scans of the already-capped code list and can fail before accumulator work.
  const collisionNamespaces = [
    ...declaredNamespaces,
    ['reserved output', [...ORDERED_RESERVED_OUTPUT_COLUMNS]] as const
  ];
  for (const [namespace, columns] of collisionNamespaces) {
    for (const column of columns) {
      if (isGeneratedOrderedHeader(column, namespaces.codes, codeSet)) {
        throw new Error(
          `Ordered adjacency header "${column}" collides with ${namespace} column "${column}"; ` +
          'rename the input column or code label.'
        );
      }
    }
  }

  assertUniqueOrderedHeaders(namespaces.codes);
}

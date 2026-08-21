const RUNTIME_DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
]);
const BUNDLED_DEPENDENCY_FIELDS = Object.freeze([
  "bundleDependencies",
  "bundledDependencies",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function populatedOrMalformedObjectFields(record, fields) {
  return fields.filter((field) => {
    if (!Object.hasOwn(record, field)) return false;
    const value = record[field];
    return !isRecord(value) || Object.keys(value).length > 0;
  });
}

function populatedOrMalformedBundleFields(record) {
  return BUNDLED_DEPENDENCY_FIELDS.filter((field) => {
    if (!Object.hasOwn(record, field)) return false;
    const value = record[field];
    return !Array.isArray(value) || value.length > 0;
  });
}

function dependencyFindings(record) {
  return [
    ...populatedOrMalformedObjectFields(record, RUNTIME_DEPENDENCY_FIELDS),
    ...populatedOrMalformedBundleFields(record),
  ];
}

export function assertZeroRuntimeDependencyContract(pkg, lock) {
  if (!isRecord(pkg) || typeof pkg.name !== "string" || typeof pkg.version !== "string") {
    throw new Error("package.json must contain a named, versioned package object.");
  }

  const packageFindings = dependencyFindings(pkg);
  if (packageFindings.length > 0) {
    throw new Error(
      `package.json must declare zero runtime dependencies; found ${packageFindings.join(", ")}.`,
    );
  }

  if (
    !isRecord(lock) ||
    lock.lockfileVersion !== 3 ||
    !isRecord(lock.packages) ||
    !Object.hasOwn(lock.packages, "") ||
    !isRecord(lock.packages[""])
  ) {
    throw new Error('package-lock.json must be lockfileVersion 3 with an object root at packages[""].');
  }

  const lockRoot = lock.packages[""];
  if (
    lock.name !== pkg.name ||
    lock.version !== pkg.version ||
    lockRoot.name !== pkg.name ||
    lockRoot.version !== pkg.version
  ) {
    throw new Error("package-lock.json top-level and root package identity must match package.json.");
  }

  const lockFindings = dependencyFindings(lockRoot);
  if (lockFindings.length > 0) {
    throw new Error(
      `package-lock.json root must declare zero runtime dependencies; found ${lockFindings.join(", ")}.`,
    );
  }
}

import assert from "node:assert/strict";
import test from "node:test";

import { assertZeroRuntimeDependencyContract } from "./package-contract.mjs";

const PACKAGE_NAME = "jena-js";
const PACKAGE_VERSION = "0.6.3";
const OBJECT_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];
const BUNDLE_DEPENDENCY_FIELDS = ["bundleDependencies", "bundledDependencies"];

function validPackage() {
  return { name: PACKAGE_NAME, version: PACKAGE_VERSION };
}

function validLock() {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    lockfileVersion: 3,
    packages: {
      "": { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    },
  };
}

test("accepts a matching zero-runtime package and lock root", () => {
  assert.doesNotThrow(() => assertZeroRuntimeDependencyContract(validPackage(), validLock()));
});

test("rejects every manifest runtime-dependency alias", async (context) => {
  for (const field of OBJECT_DEPENDENCY_FIELDS) {
    await context.test(field, () => {
      const pkg = { ...validPackage(), [field]: { unexpected: "1.0.0" } };
      assert.throws(
        () => assertZeroRuntimeDependencyContract(pkg, validLock()),
        new RegExp(`package\\.json.*${field}`, "u"),
      );
    });
  }
  for (const field of BUNDLE_DEPENDENCY_FIELDS) {
    await context.test(field, () => {
      const pkg = { ...validPackage(), [field]: ["unexpected"] };
      assert.throws(
        () => assertZeroRuntimeDependencyContract(pkg, validLock()),
        new RegExp(`package\\.json.*${field}`, "u"),
      );
    });
  }
});

test("rejects malformed manifest dependency fields", () => {
  for (const value of [null, [], "unexpected", true]) {
    assert.throws(
      () => assertZeroRuntimeDependencyContract({ ...validPackage(), dependencies: value }, validLock()),
      /package\.json must declare zero runtime dependencies/u,
    );
  }
  for (const value of [null, {}, "unexpected", true]) {
    assert.throws(
      () => assertZeroRuntimeDependencyContract({ ...validPackage(), bundledDependencies: value }, validLock()),
      /package\.json must declare zero runtime dependencies/u,
    );
  }
});

test("rejects every lock-root runtime-dependency alias", async (context) => {
  for (const field of OBJECT_DEPENDENCY_FIELDS) {
    await context.test(field, () => {
      const lock = validLock();
      lock.packages[""][field] = { unexpected: "1.0.0" };
      assert.throws(
        () => assertZeroRuntimeDependencyContract(validPackage(), lock),
        new RegExp(`package-lock\\.json root.*${field}`, "u"),
      );
    });
  }
  for (const field of BUNDLE_DEPENDENCY_FIELDS) {
    await context.test(field, () => {
      const lock = validLock();
      lock.packages[""][field] = ["unexpected"];
      assert.throws(
        () => assertZeroRuntimeDependencyContract(validPackage(), lock),
        new RegExp(`package-lock\\.json root.*${field}`, "u"),
      );
    });
  }
});

test("rejects malformed lock-root dependency fields", () => {
  for (const value of [null, [], "", 0, false]) {
    const lock = validLock();
    lock.packages[""].dependencies = value;
    assert.throws(
      () => assertZeroRuntimeDependencyContract(validPackage(), lock),
      /package-lock\.json root must declare zero runtime dependencies/u,
    );
  }
  for (const value of [null, {}, "", 0, false]) {
    const lock = validLock();
    lock.packages[""].bundledDependencies = value;
    assert.throws(
      () => assertZeroRuntimeDependencyContract(validPackage(), lock),
      /package-lock\.json root must declare zero runtime dependencies/u,
    );
  }
});

test("rejects missing or malformed lock roots", () => {
  const cases = [
    { ...validLock(), lockfileVersion: 2 },
    { ...validLock(), packages: undefined },
    { ...validLock(), packages: null },
    { ...validLock(), packages: [] },
    { ...validLock(), packages: {} },
    { ...validLock(), packages: { "": null } },
    { ...validLock(), packages: { "": [] } },
  ];
  for (const lock of cases) {
    assert.throws(
      () => assertZeroRuntimeDependencyContract(validPackage(), lock),
      /lockfileVersion 3 with an object root/u,
    );
  }
});

test("rejects top-level and root package identity drift", () => {
  for (const mutation of [
    (lock) => { lock.name = "other"; },
    (lock) => { lock.version = "9.9.9"; },
    (lock) => { lock.packages[""].name = "other"; },
    (lock) => { lock.packages[""].version = "9.9.9"; },
  ]) {
    const lock = validLock();
    mutation(lock);
    assert.throws(
      () => assertZeroRuntimeDependencyContract(validPackage(), lock),
      /identity must match package\.json/u,
    );
  }
});

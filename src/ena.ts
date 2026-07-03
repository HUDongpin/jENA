import type { AccumulateOptions, ENASet, MakeSetOptions } from './types.js';
import { accumulateData } from './accumulate.js';
import { makeSet } from './model.js';

export interface ENAOptions extends AccumulateOptions, MakeSetOptions {}

export function ena(options: ENAOptions): ENASet {
  const enadata = accumulateData(options);
  const makeOptions: MakeSetOptions = {};
  if (options.dimensions !== undefined) makeOptions.dimensions = options.dimensions;
  if (options.centerAlignToOrigin !== undefined) makeOptions.centerAlignToOrigin = options.centerAlignToOrigin;
  if (options.rotation !== undefined) makeOptions.rotation = options.rotation;
  if (options.rotationSet !== undefined) makeOptions.rotationSet = options.rotationSet;
  if (options.nodePositionMethod !== undefined) makeOptions.nodePositionMethod = options.nodePositionMethod;
  return makeSet(enadata, makeOptions);
}

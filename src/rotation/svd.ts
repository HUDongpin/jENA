/*
 * Derived from rENA 0.3.1 (GPL-3), (c) the rENA authors: Cody L Marquart,
 * Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, and
 * David Williamson Shaffer. This file ports the SVD rotation of R/ena.svd.R.
 * TypeScript translation and modifications for jena-js, GPL-3.0-only.
 * See PROVENANCE.md for the upstream NOTICE and version pin.
 */
import type { Matrix } from '../types.js';
import { covarianceLike, symmetricJacobiEigen } from '../core/linear.js';

export interface SvdRotationResult {
  rotationMatrix: Matrix;
  rotationColumns: string[];
  eigenvalues: number[];
}

export function svdRotation(pointsForProjection: Matrix): SvdRotationResult {
  const covariance = covarianceLike(pointsForProjection);
  const eigen = symmetricJacobiEigen(covariance);
  const divisor = Math.max(1, pointsForProjection.length - 1);
  const eigenvalues = eigen.eigenvalues.map((value) => value / divisor);
  return {
    rotationMatrix: eigen.eigenvectors,
    rotationColumns: eigen.eigenvalues.map((_value, index) => `SVD${index + 1}`),
    eigenvalues
  };
}

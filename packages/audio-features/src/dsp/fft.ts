/**
 * Minimal, dependency-free radix-2 FFT (iterative Cooley–Tukey), pure TypeScript.
 *
 * The DEPENDENCY_POLICY forbids librosa / torch / openSMILE / any heavy DSP or ML
 * library, so the spectral feature group computes its own FFT here. This is the
 * ONLY place the extractor needs the frequency domain; every other feature is
 * computed in the time domain. Frames are zero-padded up to a power of two before
 * transforming, so callers don't have to pick power-of-two window sizes.
 *
 * Not a general-purpose FFT library — just enough, correct, and small.
 */

/** True iff `n` is a positive power of two. */
export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Smallest power of two that is >= `n` (and >= 1). */
export function ceilPow2(n: number): number {
  if (n < 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * In-place complex FFT over `re`/`im` (both length N, a power of two).
 * `sign = -1` is the forward transform; `+1` the inverse (unscaled).
 */
export function fftInPlace(re: Float64Array, im: Float64Array, sign: -1 | 1 = -1): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wLenR = Math.cos(ang);
    const wLenI = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wR = 1;
      let wI = 0;
      for (let k = 0; k < half; k++) {
        const aR = re[i + k] as number;
        const aI = im[i + k] as number;
        const bR0 = re[i + k + half] as number;
        const bI0 = im[i + k + half] as number;
        const bR = bR0 * wR - bI0 * wI;
        const bI = bR0 * wI + bI0 * wR;
        re[i + k] = aR + bR;
        im[i + k] = aI + bI;
        re[i + k + half] = aR - bR;
        im[i + k + half] = aI - bI;
        const nextWR = wR * wLenR - wI * wLenI;
        wI = wR * wLenI + wI * wLenR;
        wR = nextWR;
      }
    }
  }
}

/**
 * One-sided magnitude spectrum (length `N/2 + 1`) of a real frame.
 * The frame is copied and zero-padded up to the next power of two, so any frame
 * length is accepted.
 */
export function magnitudeSpectrum(frame: ArrayLike<number>): Float64Array {
  const n = ceilPow2(frame.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < frame.length; i++) re[i] = frame[i] as number;

  fftInPlace(re, im, -1);

  const half = n >> 1;
  const mags = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    const r = re[k] as number;
    const i = im[k] as number;
    mags[k] = Math.hypot(r, i);
  }
  return mags;
}

/**
 * Branded identifier and primitive types.
 *
 * Branding prevents accidentally passing a raw `string` where a `UserId` is
 * expected. The brand is a compile-time phantom only — it is erased at runtime,
 * so these constructors are zero-cost identity functions.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Stable per-user identifier (never a raw audio fingerprint). */
export type UserId = Brand<string, "UserId">;

/** Identifier for a single accepted hum session. */
export type HumId = Brand<string, "HumId">;

/** Semantic version string for a model/contract, e.g. "fusion-v1". */
export type ModelVersion = Brand<string, "ModelVersion">;

/** ISO-8601 timestamp string, e.g. "2026-06-18T19:17:00.000Z". */
export type IsoTimestamp = Brand<string, "IsoTimestamp">;

export const asUserId = (value: string): UserId => value as UserId;
export const asHumId = (value: string): HumId => value as HumId;
export const asModelVersion = (value: string): ModelVersion => value as ModelVersion;
export const asIsoTimestamp = (value: string): IsoTimestamp => value as IsoTimestamp;

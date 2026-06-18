# apps/mobile (placeholder)

Mobile wrapper for Hum (Capacitor-style), sharing the same `packages/*`
contracts and engines as `apps/web`. **Not built in this pass.**

Mobile-specific concerns deferred: native microphone permissions, background
capture constraints, on-device storage, and push notifications. All affect/
privacy logic stays in the shared packages so the model behaves identically
across platforms.

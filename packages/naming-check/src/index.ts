import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Naming-consistency checker.
// Verifies root pkg name, package scope, README title, and absence of legacy scope.

export interface NamingViolation {
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

export function checkNaming(repoRoot: string): NamingViolation[] {
  const violations: NamingViolation[] = [];

  // 1. Root package.json name must be "hum-ai"
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as Record<string, unknown>;
  if (rootPkg["name"] !== "hum-ai") {
    violations.push({
      file: "package.json",
      rule: "root-name",
      detail: `Root package.json "name" must be "hum-ai", got: "${String(rootPkg["name"])}"`,
    });
  }

  // 2. All packages/* must use @hum-ai/ scope
  const pkgDir = join(repoRoot, "packages");
  for (const dir of readdirSync(pkgDir)) {
    const pkgPath = join(pkgDir, dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      const name = String(pkg["name"] ?? "");
      if (!name.startsWith("@hum-ai/")) {
        violations.push({
          file: `packages/${dir}/package.json`,
          rule: "package-scope",
          detail: `Package name must start with "@hum-ai/", got: "${name}"`,
        });
      }
    } catch {
      // skip if package.json absent
    }
  }

  // 3. README.md h1 must contain "Hum AI"
  let readmeContent: string;
  try {
    readmeContent = readFileSync(join(repoRoot, "README.md"), "utf8");
  } catch {
    violations.push({
      file: "README.md",
      rule: "readme-exists",
      detail: "README.md is missing from repo root",
    });
    return violations;
  }
  const h1Match = /^# (.+)$/m.exec(readmeContent);
  if (!h1Match || !h1Match[1]?.includes("Hum AI")) {
    violations.push({
      file: "README.md",
      rule: "readme-title",
      detail: `README.md h1 must contain "Hum AI", got: "${h1Match ? h1Match[1] : "(no h1)"}"`,
    });
  }

  // 4. No legacy @hum/ scope (without -ai) in any packages/* package.json
  const LEGACY_SCOPE_RE = /"@hum\//;
  for (const dir of readdirSync(pkgDir)) {
    const pkgPath = join(pkgDir, dir, "package.json");
    try {
      const content = readFileSync(pkgPath, "utf8");
      if (LEGACY_SCOPE_RE.test(content)) {
        violations.push({
          file: `packages/${dir}/package.json`,
          rule: "no-legacy-scope",
          detail: `Found legacy "@hum/" scope in package.json (should be "@hum-ai/")`,
        });
      }
    } catch {
      // skip
    }
  }

  // 5. Root name must not be bare "hum"
  if (rootPkg["name"] === "hum") {
    violations.push({
      file: "package.json",
      rule: "no-bare-hum",
      detail: `Root package.json "name" is bare "hum" — must be "hum-ai"`,
    });
  }

  return violations;
}

export function assertNaming(repoRoot: string): void {
  const violations = checkNaming(repoRoot);
  if (violations.length > 0) {
    const lines = violations.map((v) => `  [${v.rule}] ${v.file}: ${v.detail}`).join("\n");
    throw new Error(`Naming consistency violations (${violations.length}):\n${lines}`);
  }
}

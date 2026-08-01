/**
 * Version gates shared by migration/bootstrap callers.  The checker is
 * deliberately transport-neutral: callers provide the versions advertised by
 * Desktop, Server, the bundled UI, bootstrap, or signaling.  It reports the
 * first incompatible component deterministically and never includes payloads
 * or credentials in an error.
 */
export type CompatibilityComponent = "desktop" | "server" | "ui" | "bootstrap" | "signaling";

export interface CompatibilityRequirement {
  readonly minimum: string;
  readonly maximum?: string;
}

export type CompatibilityMatrix = Readonly<Partial<Record<CompatibilityComponent, CompatibilityRequirement>>>;
export type CompatibilityVersions = Readonly<Partial<Record<CompatibilityComponent, string>>>;

export interface CompatibilityFailure {
  readonly component: CompatibilityComponent;
  readonly actual: string | null;
  readonly minimum: string;
  readonly maximum?: string;
  readonly code: "missing_version" | "below_minimum" | "above_maximum";
}

export class CompatibilityError extends Error {
  readonly code: CompatibilityFailure["code"];
  readonly component: CompatibilityComponent;
  readonly actual: string | null;
  readonly minimum: string;
  readonly maximum?: string;

  constructor(failure: CompatibilityFailure) {
    const bound = failure.code === "below_minimum" ? `requires >= ${failure.minimum}` : failure.maximum === undefined ? "has no compatible version" : `supports <= ${failure.maximum}`;
    super(`${failure.component} version ${failure.actual ?? "is missing"}; ${bound}`);
    this.name = "CompatibilityError";
    this.code = failure.code;
    this.component = failure.component;
    this.actual = failure.actual;
    this.minimum = failure.minimum;
    this.maximum = failure.maximum;
  }
}

const COMPONENT_ORDER: readonly CompatibilityComponent[] = ["desktop", "server", "ui", "bootstrap", "signaling"];
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u;

export function checkCompatibilityMatrix(versions: CompatibilityVersions, requirements: CompatibilityMatrix): readonly CompatibilityFailure[] {
  const failures: CompatibilityFailure[] = [];
  for (const component of COMPONENT_ORDER) {
    const requirement = requirements[component];
    if (requirement === undefined) continue;
    const minimum = normalizeVersion(requirement.minimum, `${component} minimum version`);
    const maximum = requirement.maximum === undefined ? undefined : normalizeVersion(requirement.maximum, `${component} maximum version`);
    if (maximum !== undefined && compareVersions(minimum, maximum) > 0) throw new RangeError(`${component} compatibility range is invalid`);
    const raw = versions[component];
    const actual = raw === undefined ? null : normalizeVersion(raw, `${component} version`);
    if (actual === null) {
      failures.push({ component, actual, minimum, ...(maximum === undefined ? {} : { maximum }), code: "missing_version" });
    } else if (compareVersions(actual, minimum) < 0) {
      failures.push({ component, actual, minimum, ...(maximum === undefined ? {} : { maximum }), code: "below_minimum" });
    } else if (maximum !== undefined && compareVersions(actual, maximum) > 0) {
      failures.push({ component, actual, minimum, maximum, code: "above_maximum" });
    }
  }
  return Object.freeze(failures);
}

export function assertCompatibleVersions(versions: CompatibilityVersions, requirements: CompatibilityMatrix): void {
  const failure = checkCompatibilityMatrix(versions, requirements)[0];
  if (failure !== undefined) throw new CompatibilityError(failure);
}

function normalizeVersion(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !SEMVER.test(value)) throw new TypeError(`${label} is invalid`);
  const match = SEMVER.exec(value);
  if (match === null) throw new TypeError(`${label} is invalid`);
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] as number) !== (b[index] as number)) return (a[index] as number) - (b[index] as number);
  }
  return 0;
}

export type Env = Record<string, string | undefined>;

export function requireEnv(env: Env, name: string): string {
  const v = env[name];
  if (v === undefined || v === '') throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function intEnv(env: Env, name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  if (!/^-?\d+$/.test(v)) throw new Error(`${name} must be an integer`);
  return Number(v);
}

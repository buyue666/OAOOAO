/** Reviewed bundled versions only. No arbitrary URLs or remotely installed code. */
export const DIRECTOR_VERSIONS = ['0.1.0'] as const;
export const DIRECTOR_LATEST = DIRECTOR_VERSIONS[0];
export type PluginPreference = { version: string; autoUpdate: boolean };
export function validDirectorVersion(value: unknown): value is typeof DIRECTOR_VERSIONS[number] {
  return typeof value === 'string' && (DIRECTOR_VERSIONS as readonly string[]).includes(value);
}
export function directorPreference(version: string, autoUpdate: boolean): PluginPreference {
  return { version: autoUpdate ? DIRECTOR_LATEST : validDirectorVersion(version) ? version : '0.1.0', autoUpdate };
}

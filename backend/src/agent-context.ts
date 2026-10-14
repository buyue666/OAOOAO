/** Bounded project facts for planning; original media bytes never enter text prompts. */
export function summarizeAgentProject(project: Record<string, unknown>): Record<string, unknown> & { contextTruncated: boolean } {
  // Count serialized keys, scalar values and container delimiters, not only
  // readable strings: numerical matrices and escaped text also consume tokens.
  let remaining = 60000;
  let truncated = false;
  const reserve = (size: number) => {
    if (size > remaining) { truncated = true; return false; }
    remaining -= size; return true;
  };
  const visit = (value: unknown, depth: number): unknown => {
    if (remaining <= 0 || depth > 7) { truncated = true; return undefined; }
    if (typeof value === 'string') {
      if (/^data:|^blob:/i.test(value)) { truncated = true; return reserve(24) ? '[media content omitted]' : undefined; }
      // A UTF-16 code unit needs at most six JSON characters (e.g. \u0000).
      const limit = Math.min(Math.max(0, Math.floor((remaining - 2) / 6)), 2000);
      if (value.length > limit) truncated = true;
      const text = value.slice(0, limit); return reserve(JSON.stringify(text).length) ? text : undefined;
    }
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return reserve(JSON.stringify(value).length) ? value : undefined;
    if (Array.isArray(value)) {
      if (value.length > 80) truncated = true;
      if (!reserve(2)) return undefined;
      const output: unknown[] = [];
      for (const item of value.slice(0, 80)) {
        if (!reserve(1)) break;
        const next = visit(item, depth + 1);
        if (next === undefined) break;
        output.push(next);
      }
      return output;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length > 50) truncated = true;
      if (!reserve(2)) return undefined;
      const output: [string, unknown][] = [];
      for (const [key, item] of entries.slice(0, 50)) {
        if (!reserve(JSON.stringify(key).length + 2)) break;
        const next = visit(item, depth + 1);
        if (next !== undefined) output.push([key, next]);
        if (remaining <= 0) break;
      }
      return Object.fromEntries(output);
    }
    return undefined;
  };
  const result = visit(project, 0) as Record<string, unknown>;
  return { ...result, contextTruncated: truncated };
}

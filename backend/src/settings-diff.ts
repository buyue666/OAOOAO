/** Compare JSON settings by value; object key order and omitted undefined are not edits. */
export function sameSetting(left: any, right: any): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameSetting(value, right[index]));
  }
  const keys = Object.keys(left).filter(key => left[key] !== undefined);
  const other = Object.keys(right).filter(key => right[key] !== undefined);
  return keys.length === other.length && keys.every(key => Object.hasOwn(right, key) && sameSetting(left[key], right[key]));
}

/** New objects receive full validation. Existing objects validate changed dependencies. */
export function settingChanged(previous: Record<string, any> | undefined, next: Record<string, any>, ...keys: string[]): boolean {
  return previous === undefined || keys.some(key => !sameSetting(previous[key], next[key]));
}

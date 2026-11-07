export function isStudioPreview() {
  return process.env.NODE_ENV === 'development'
}

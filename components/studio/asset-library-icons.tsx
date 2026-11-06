import type { ReactNode, SVGProps } from 'react'

// OAO asset icons: 24px geometry, rounded 1.65px strokes and one quiet tonal layer.
// All colours inherit currentColor so selected, disabled and dark states stay coherent.
const shapes = {
  collection: <><rect x="3" y="8" width="14" height="13" rx="3" opacity=".15" fill="currentColor" stroke="none" /><rect x="7" y="3" width="14" height="14" rx="3" /><path d="M4 8v10a3 3 0 0 0 3 3h10M10 13l3-3 2.5 2.5L18 10" /><circle cx="16.5" cy="7.5" r="1" fill="currentColor" stroke="none" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="3.5" fill="currentColor" opacity=".12" stroke="none" /><rect x="3" y="4" width="18" height="16" rx="3.5" /><path d="M3.5 16l5-5 5 5 3-3 4 4" /><circle cx="16" cy="8.5" r="1.5" /></>,
  video: <><rect x="3" y="4" width="18" height="16" rx="3" opacity=".12" fill="currentColor" stroke="none" /><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 4v16M17 4v16M3 8h4M3 16h4M17 8h4M17 16h4" /><path d="m10.5 9 4.5 3-4.5 3Z" fill="currentColor" stroke="none" /></>,
  audio: <><rect x="6" y="3" width="12" height="18" rx="6" fill="currentColor" opacity=".12" stroke="none" /><path d="M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4" /></>,
  folder: <><path d="M3 8h18v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z" fill="currentColor" opacity=".12" stroke="none" /><path d="M3 8V6a3 3 0 0 1 3-3h4l3 4h5a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8ZM3 10h18" /></>,
  general: <><path d="m3 16 9-5 9 5-9 5Z" fill="currentColor" opacity=".14" stroke="none" /><path d="m3 7 9-5 9 5-9 5ZM3 12l9 5 9-5M3 17l9 5 9-5" /></>,
  character: <><path d="M5 21v-2a7 7 0 0 1 14 0v2Z" fill="currentColor" opacity=".14" stroke="none" /><circle cx="12" cy="7" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2M9 21v-3M15 21v-3" /></>,
  scene: <><path d="m3 19 6-10 5 7 3-4 4 7Z" fill="currentColor" opacity=".14" stroke="none" /><path d="M3 19 9 9l5 7 3-4 4 7ZM6.5 13l2.5 2 2.5-2" /><circle cx="17" cy="6" r="2.5" /></>,
  prop: <><path d="m12 3 9 5-9 5-9-5Z" fill="currentColor" opacity=".14" stroke="none" /><path d="m12 3 9 5v9l-9 5-9-5V8ZM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5" /></>,
  style: <><path d="M12 3a9 9 0 1 0 0 18h1a2.5 2.5 0 0 0 1.8-4.2 1.7 1.7 0 0 1 1.2-2.9h2A3 3 0 0 0 21 11a9 9 0 0 0-9-8Z" fill="currentColor" opacity=".12" stroke="none" /><path d="M12 3a9 9 0 1 0 0 18h1a2.5 2.5 0 0 0 1.8-4.2 1.7 1.7 0 0 1 1.2-2.9h2A3 3 0 0 0 21 11a9 9 0 0 0-9-8Z" /><path d="M7 10h.01M10 6.5h.01M15 7h.01M6.5 14.5h.01" strokeWidth="2.8" /></>,
  garment: <><path d="m8 3-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0Z" fill="currentColor" opacity=".12" stroke="none" /><path d="m8 3-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0ZM8 17h8" /></>,
  upload: <><path d="M3 13h5l2 3h4l2-3h5v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z" fill="currentColor" opacity=".14" stroke="none" /><path d="M3 13v5a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-5M3 13h5l2 3h4l2-3h5M12 12V3M7.5 7.5 12 3l4.5 4.5" /></>,
  history: <><circle cx="12" cy="12" r="9" fill="currentColor" opacity=".12" stroke="none" /><path d="M3 9a9 9 0 1 1 .8 7M3 4v5h5M12 7v5l3.5 2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" fill="currentColor" opacity=".1" stroke="none" /><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  edit: <><path d="M4 17v4h4L19.5 9.5l-4-4Z" fill="currentColor" opacity=".14" stroke="none" /><path d="M4 17v4h4L20 9a2.8 2.8 0 0 0-4-4ZM13.5 7.5l4 4M4 17l4 4" /></>,
  preview: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" fill="currentColor" opacity=".1" stroke="none" /><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  delete: <><path d="m6 7 1 14h10l1-14Z" fill="currentColor" opacity=".12" stroke="none" /><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
  more: <><rect x="1" y="7" width="22" height="10" rx="5" fill="currentColor" opacity=".08" stroke="none" />{[5, 12, 19].map(cx => <circle key={cx} cx={cx} cy="12" r="1.7" fill="currentColor" stroke="none" />)}</>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="2" fill="currentColor" opacity=".2" stroke="none" /><rect x="14" y="14" width="7" height="7" rx="2" fill="currentColor" opacity=".2" stroke="none" /><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  list: <><rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" opacity=".1" stroke="none" /><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="3" /></>,
  select: <><rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity=".12" stroke="none" /><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m7 12 3.5 3.5L17 9" /></>,
  project: <><path d="M3 10h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" fill="currentColor" opacity=".12" stroke="none" /><path d="M3 10V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM12 11v6M9 14h6" /></>,
} satisfies Record<string, ReactNode>

function glyph(name: keyof typeof shapes) {
  return function AssetIcon(props: SVGProps<SVGSVGElement>) {
    return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{shapes[name]}</svg>
  }
}

export const AssetIcons = {
  Collection: glyph('collection'), Image: glyph('image'), Video: glyph('video'), Audio: glyph('audio'), Folder: glyph('folder'),
  General: glyph('general'), Character: glyph('character'), Scene: glyph('scene'), Prop: glyph('prop'), Style: glyph('style'), Garment: glyph('garment'),
  Upload: glyph('upload'), History: glyph('history'), Search: glyph('search'), Edit: glyph('edit'), Preview: glyph('preview'), Delete: glyph('delete'), More: glyph('more'),
  Grid: glyph('grid'), List: glyph('list'), Select: glyph('select'), Project: glyph('project'),
}

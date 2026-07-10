export function creatorDetailHref(id: string): string {
  return `/creator?id=${encodeURIComponent(id)}`;
}

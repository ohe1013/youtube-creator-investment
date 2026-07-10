export function creatorDetailHref(id: string): string {
  return `/creator?id=${encodeURIComponent(id)}`;
}

export function marketTickerHref(id: string): string {
  return `/?${new URLSearchParams({ ticker: id }).toString()}`;
}

import type { CatalogItem } from "@/lib/types";

function searchTerms(query: string): string[] {
  return query
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function textMatchesCatalogSearch(value: string, query: string): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;

  const searchableText = value.toLocaleLowerCase();
  return terms.every(term => searchableText.includes(term));
}

export function catalogItemMatchesSearch(item: CatalogItem, query: string): boolean {
  const searchableText = [
    item.description,
    item.materialType,
    item.brand,
    item.unitType,
    item.section,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return textMatchesCatalogSearch(searchableText, query);
}

export function filterCatalogItems(items: CatalogItem[], query: string): CatalogItem[] {
  return items.filter(item => catalogItemMatchesSearch(item, query));
}

export function filterCatalogValues(values: string[], query: string): string[] {
  return values.filter(value => textMatchesCatalogSearch(value, query));
}
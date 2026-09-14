import type { CatalogItem, MaterialSpec } from "@/lib/types";

export async function fetchCatalog(filters?: {
  category?: string;
  roomType?: string;
  unitType?: string;
}): Promise<CatalogItem[]> {
  const params = new URLSearchParams();
  if (filters?.category) params.set('category', filters.category);
  if (filters?.roomType) params.set('roomType', filters.roomType);
  if (filters?.unitType) params.set('unitType', filters.unitType);
  
  const response = await fetch(`/api/catalog?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch catalog');
  }
  return response.json();
}

export async function fetchMaterialSpecs(category: string): Promise<MaterialSpec> {
  const response = await fetch(`/api/catalog/material-specs/${category}`);
  if (!response.ok) {
    throw new Error('Failed to fetch material specs');
  }
  return response.json();
}

export async function refreshCatalog(): Promise<{ success: boolean; itemCount: number; message: string }> {
  const response = await fetch('/api/catalog/refresh', { method: 'POST' });
  if (!response.ok) {
    throw new Error('Failed to refresh catalog');
  }
  return response.json();
}

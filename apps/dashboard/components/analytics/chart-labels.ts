export function formatCategoryAxisLabel(value: string, maxLength = 20): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

/** Sequential async filter: keeps database reads in order and bounded to one connection at a time. */
export async function filterAsync<T>(items: readonly T[], keep: (item: T) => Promise<boolean> | boolean): Promise<T[]> {
  const out: T[] = []
  for (const item of items) if (await keep(item)) out.push(item)
  return out
}

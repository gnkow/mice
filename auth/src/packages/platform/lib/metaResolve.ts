import type { EntityRef, MetaRecord } from './metaTypes.js'

export type GetOwn = (ref: EntityRef) => Promise<MetaRecord | null>

export type EffectiveMeta = {
  ref: EntityRef
  own: MetaRecord | null
  effective: {
    tags: { value: string }[]
    labels: Record<string, { value: string }>
  }
}

/** The response envelope is shared by entity panels, search, and batch list views. */
export async function resolveEffective(ref: EntityRef, getOwn: GetOwn): Promise<EffectiveMeta> {
  const own = await getOwn(ref)
  return {
    ref,
    own,
    effective: {
      tags: (own?.tags ?? []).map(value => ({ value })).sort((a, b) => a.value.localeCompare(b.value)),
      labels: Object.fromEntries(Object.entries(own?.labels ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { value }])),
    },
  }
}

import { isGroupObjectId } from './groupBinding.js'

export type GroupBindingMode = 'id-based' | 'name-based'

export const GROUP_BINDING_ID_BASED_MESSAGE = 'Group binding mode: ID-based (recommended)'
export const GROUP_BINDING_NAME_BASED_MESSAGE =
  'Group IDs not available. Binding uses names. IdP group rename will break access.'

export type GroupBindingAssessment = {
  mode: GroupBindingMode
  message: string
}

/**
 * Decide instance group-binding mode from sample IdP group claim values
 * (or directory group ids). UUID-shaped values are id-based; anything else
 * (or an empty sample) means name-based fallback.
 */
export function assessGroupBindingMode(sampleGroups: readonly string[]): GroupBindingAssessment {
  const samples = sampleGroups.map((g) => g.trim()).filter(Boolean)
  if (samples.length === 0 || samples.some((g) => !isGroupObjectId(g))) {
    return { mode: 'name-based', message: GROUP_BINDING_NAME_BASED_MESSAGE }
  }
  return { mode: 'id-based', message: GROUP_BINDING_ID_BASED_MESSAGE }
}

import { isGroupObjectId } from './groupBinding.js'

/** Only id-based grants are allowed; `name-based` is retained for legacy stored status rows. */
export type GroupBindingMode = 'id-based' | 'name-based'

export const GROUP_BINDING_ID_BASED_MESSAGE = 'Group binding mode: ID-based (required)'
export const GROUP_BINDING_NAME_BASED_MESSAGE =
  'Group object ids required. Name-based group grants are not allowed.'

/** @deprecated Use GROUP_BINDING_NAME_BASED_MESSAGE — name-based grants are forbidden. */
export const GROUP_BINDING_IDS_REQUIRED_MESSAGE = GROUP_BINDING_NAME_BASED_MESSAGE

export type GroupBindingAssessment = {
  mode: GroupBindingMode
  message: string
  /** True when samples lack object ids (IdP not ready for grants). */
  warning: boolean
}

/** Package mode + message with the warning flag the UI expects. */
export function groupBindingAssessment(
  mode: GroupBindingMode,
  message?: string,
): GroupBindingAssessment {
  if (mode === 'id-based') {
    const text = message ?? GROUP_BINDING_ID_BASED_MESSAGE
    return {
      mode: 'id-based',
      message: text,
      warning: text === GROUP_BINDING_NAME_BASED_MESSAGE,
    }
  }
  return {
    mode: 'name-based',
    message: message ?? GROUP_BINDING_NAME_BASED_MESSAGE,
    warning: true,
  }
}

/**
 * Decide instance group-binding readiness from sample IdP group claim values
 * (or directory group ids). Only UUID object ids pass; name-shaped samples
 * fail the check — name-based grants are not allowed.
 */
export function assessGroupBindingMode(sampleGroups: readonly string[]): GroupBindingAssessment {
  const samples = sampleGroups.map((g) => g.trim()).filter(Boolean)
  if (samples.length === 0 || samples.some((g) => !isGroupObjectId(g))) {
    return {
      mode: 'id-based',
      message: GROUP_BINDING_NAME_BASED_MESSAGE,
      warning: true,
    }
  }
  return {
    mode: 'id-based',
    message: GROUP_BINDING_ID_BASED_MESSAGE,
    warning: false,
  }
}

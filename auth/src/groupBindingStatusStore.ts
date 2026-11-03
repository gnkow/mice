import { eq } from 'drizzle-orm'
import { directoryNow } from './authentication/directory/directory.js'
import { getDb } from './db/database.js'
import { groupBindingStatus } from './db/schema.js'
import {
  assessGroupBindingMode,
  type GroupBindingAssessment,
  type GroupBindingMode,
} from './groupBindingMode.js'

const ROW_ID = 'instance'

export type GroupBindingStatus = GroupBindingAssessment & {
  warning: boolean
  checkedAt: string | null
}

export async function getGroupBindingStatus(): Promise<GroupBindingStatus> {
  const [row] = await getDb()
    .select()
    .from(groupBindingStatus)
    .where(eq(groupBindingStatus.id, ROW_ID))
    .limit(1)
  if (!row) {
    return {
      mode: 'name-based',
      message: assessGroupBindingMode([]).message,
      warning: true,
      checkedAt: null,
    }
  }
  return {
    mode: row.mode as GroupBindingMode,
    message: row.message,
    warning: row.mode === 'name-based',
    checkedAt: row.checkedAt.toISOString(),
  }
}

export async function saveGroupBindingAssessment(
  assessment: GroupBindingAssessment,
): Promise<GroupBindingStatus> {
  const now = new Date()
  await getDb()
    .insert(groupBindingStatus)
    .values({
      id: ROW_ID,
      mode: assessment.mode,
      message: assessment.message,
      checkedAt: now,
    })
    .onConflictDoUpdate({
      target: groupBindingStatus.id,
      set: {
        mode: assessment.mode,
        message: assessment.message,
        checkedAt: now,
      },
    })
  return {
    ...assessment,
    warning: assessment.mode === 'name-based',
    checkedAt: now.toISOString(),
  }
}

/**
 * Run validation from an explicit sample and/or the directory's group search.
 * Explicit samples win when provided (admin Check with known claims).
 */
export async function checkGroupBindingMode(sampleGroups?: string[]): Promise<GroupBindingStatus> {
  let samples = (sampleGroups ?? []).map((g) => g.trim()).filter(Boolean)
  if (samples.length === 0) {
    const directory = directoryNow()
    if (directory.configured) {
      try {
        const hits = await directory.searchGroups('', 20)
        samples = hits.map((h) => h.group).filter(Boolean)
      } catch {
        samples = []
      }
    }
  }
  return saveGroupBindingAssessment(assessGroupBindingMode(samples))
}

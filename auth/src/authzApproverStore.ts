import { APPROVER_ROLE } from './authzContract.js'
import { parseUserKey, userKey, type UserKey } from './authzTypes.js'
import * as authzRepo from './authzRepository.js'

export { APPROVER_ROLE }

export type ApproverDecision = {
  allow: boolean
  status: number
  reason: string
}

const ALLOWED: ApproverDecision = Object.freeze({ allow: true, status: 200, reason: 'ok' })

function denied(reason: string, status = 403): ApproverDecision {
  return { allow: false, status, reason }
}

export async function grantApprover(scope: authzRepo.ApproverScope, target: UserKey): Promise<boolean> {
  return authzRepo.addApprover(scope, userKey(target))
}

export async function revokeApprover(scope: authzRepo.ApproverScope, target: UserKey): Promise<boolean> {
  return authzRepo.removeApprover(scope, userKey(target))
}

export async function listApprovers(scope: authzRepo.ApproverScope): Promise<UserKey[]> {
  return (await authzRepo.listApproverKeys(scope)).map((k) => parseUserKey(k))
}

export async function isApprover(ns: string, repo: string, user: UserKey): Promise<boolean> {
  return authzRepo.isApproverKey(ns, repo, userKey(user))
}

/**
 * "Approver for this repository": holds an explicit approver grant on the repository or its
 * namespace. `maintain`, Owner, admin and bootstrap grants never imply it.
 */
export async function decideIsApprover(
  user: UserKey,
  ns: string,
  repo: string,
): Promise<ApproverDecision> {
  return (await isApprover(ns, repo, user)) ? ALLOWED : denied('Approver role required')
}

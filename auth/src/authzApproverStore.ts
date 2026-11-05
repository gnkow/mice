import { APPROVER_ROLE } from './authzContract.js'
import { parseUserKey, userKey, type UserKey } from './authzTypes.js'
import * as authzRepo from './authzRepository.js'

export { APPROVER_ROLE }

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

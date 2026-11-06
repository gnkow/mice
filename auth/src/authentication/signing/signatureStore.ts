import { createHash, randomUUID } from 'node:crypto'
import { and, eq, or } from 'drizzle-orm'
import type { Ledger, LedgerProof } from '../../auditLedger.js'
import { immudbConfig, openLedger } from '../../auditLedger.js'
import { getDb } from '../../db/database.js'
import { signatureIndex, principals } from '../../db/schema.js'
import { principalKey } from '../session/principal.js'
import type { MfaEvidence, SignatureMeaning, VerificationMetadata } from './signingCeremony.js'

export type SignatureBinding = {
  repo: string
  sourceHead: string
  targetHead: string
  /** SHA-256 of the merge-result manifest; the manifest itself is stored before the signature. */
  manifestDigest: string
}

export type NewSignature = {
  signer: { iss: string; sub: string; name: string }
  meaning: SignatureMeaning
  contentHash: string
  mfaEvidence?: MfaEvidence
  verificationMetadata?: VerificationMetadata
  binding?: SignatureBinding
  manifest?: string
  /** QMS change-control id required on merge signatures (GxP ticket 04). */
  changeControlId?: string
}

export type SignatureRecord = {
  id: string
  kind: 'esign.created'
  signer: { iss: string; sub: string; name: string }
  meaning: SignatureMeaning
  contentHash: string
  /** Server time, ISO 8601. */
  signedAt: string
  mfaEvidence?: MfaEvidence
  verificationMetadata?: VerificationMetadata
  binding?: SignatureBinding
  changeControlId?: string
}

export type SignatureQuery = {
  repo?: string
  /** Matches either the source or the target head of the binding. */
  commit?: string
  signer?: { iss: string; sub: string }
}

export type IndexedSignature = { id: string; seq: number; repo?: string; signerKey: string; meaning: SignatureMeaning; signedAt: string }

export type SignatureStore = {
  record(input: NewSignature): Promise<{ id: string; seq: number }>
  find(query: SignatureQuery): Promise<IndexedSignature[]>
  /** Re-creates any missing index rows from the ledger; never removes rows. */
  rebuildIndex(): Promise<number>

  get(id: string): Promise<{ seq: number; record: SignatureRecord } | undefined>
  getManifest(digest: string): Promise<{ seq: number; manifest: string } | undefined>
  proof(id: string, opts?: Parameters<Ledger['prove']>[1]): Promise<LedgerProof | undefined>
  /** The signed snapshot plus the signer's current IdP name when it differs from the printed one. */
  view(id: string): Promise<SignatureView | undefined>
}

export type SignatureView = {
  id: string
  meaning: SignatureMeaning
  signedAt: string
  signer: { iss: string; sub: string; name: string }
  nowKnownAs?: string
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/**
 * The authoritative signature records live in the append-only ledger. Nothing here edits or
 * removes a record; the store has no update or delete operation.
 */
export function openSignatureStore(ledger: Ledger): SignatureStore {
  const indexRow = (record: SignatureRecord, seq: number) => ({
    signatureId: record.id,
    ledgerSeq: seq,
    repo: record.binding?.repo ?? null,
    sourceHead: record.binding?.sourceHead ?? null,
    targetHead: record.binding?.targetHead ?? null,
    signerKey: principalKey(record.signer),
    meaning: record.meaning,
    signedAt: new Date(record.signedAt),
  })
  const index = (record: SignatureRecord, seq: number) =>
    getDb().insert(signatureIndex).values(indexRow(record, seq)).onConflictDoNothing()

  return {
    async find(q) {
      const where = and(
        q.repo ? eq(signatureIndex.repo, q.repo) : undefined,
        q.commit ? or(eq(signatureIndex.sourceHead, q.commit), eq(signatureIndex.targetHead, q.commit)) : undefined,
        q.signer ? eq(signatureIndex.signerKey, principalKey(q.signer)) : undefined,
      )
      const rows = await getDb().select().from(signatureIndex).where(where)
      return rows.map((r) => ({
        id: r.signatureId,
        seq: r.ledgerSeq,
        ...(r.repo ? { repo: r.repo } : {}),
        signerKey: r.signerKey,
        meaning: r.meaning as SignatureMeaning,
        signedAt: r.signedAt.toISOString(),
      }))
    },
    async rebuildIndex() {
      let count = 0
      for (const entry of await ledger.readAll()) {
        if (!entry.key.includes('signature/')) continue
        await index(JSON.parse(entry.value) as SignatureRecord, entry.seq)
        count++
      }
      return count
    },
    async record(input) {
      const id = randomUUID()
      const { manifest, changeControlId, ...rest } = input
      const trimmedCc = changeControlId?.trim()
      if (input.binding) {
        if (manifest === undefined || sha256(manifest) !== input.binding.manifestDigest) {
          throw new Error('manifest is missing or does not match the bound digest')
        }
        if (!trimmedCc) {
          throw new Error('change-control id is required for a merge signature')
        }
        await ledger.append(`manifest/${input.binding.manifestDigest}`, manifest)
      }
      const record: SignatureRecord = {
        id,
        kind: 'esign.created',
        ...rest,
        ...(trimmedCc ? { changeControlId: trimmedCc } : {}),
        signedAt: new Date().toISOString(),
      }
      const seq = await ledger.append(`signature/${id}`, JSON.stringify(record))
      await index(record, seq).catch(() => undefined) // the ledger is authoritative; rebuildIndex repairs a failed write
      return { id, seq }
    },
    async get(id) {
      const found = (await ledger.readAll()).find((r) => r.key.endsWith(`signature/${id}`))
      return found ? { seq: found.seq, record: JSON.parse(found.value) as SignatureRecord } : undefined
    },
    async view(id) {
      const found = await this.get(id)
      if (!found) return undefined
      const { signer } = found.record
      const [principal] = await getDb()
        .select({ name: principals.name })
        .from(principals)
        .where(and(eq(principals.iss, signer.iss), eq(principals.sub, signer.sub)))
      return {
        id,
        meaning: found.record.meaning,
        signedAt: found.record.signedAt,
        signer,
        ...(principal?.name && principal.name !== signer.name ? { nowKnownAs: principal.name } : {}),
      }
    },
    async proof(id, opts) {
      return ledger.prove(`signature/${id}`, opts)
    },
    async getManifest(digest) {
      const found = (await ledger.readAll()).find((r) => r.key.endsWith(`manifest/${digest}`))
      return found ? { seq: found.seq, manifest: found.value } : undefined
    },
  }
}

let current: SignatureStore | undefined

/** The process-wide store: signature records share the audit immudb database under their own key prefix. */
export async function signatureStore(): Promise<SignatureStore> {
  current ??= openSignatureStore(await openLedger({ ...immudbConfig(), prefix: 'esign/' }))
  return current
}

/** Swaps the store (tests point it at a private key prefix). */
export function useSignatureStore(next: SignatureStore): void {
  current = next
}

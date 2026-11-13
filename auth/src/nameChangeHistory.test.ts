import './db/testSchema.js'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  trackNameChange,
  getNameHistory,
  getCurrentName,
  getNameAtTime,
  toAdminNameHistory,
  decideNameHistoryWrite,
  nameValidAt,
} from './authentication/session/nameChangeHistory.js'
import { ensurePrincipal } from './authentication/session/session.js'

/**
 * Name Change History Tests (Ticket 22)
 * 
 * Round 8 decision U11: Track name changes per Principal for audit trail.
 * 
 * Scenario: Dr. Jane Smith signs documents in 2021. She gets married and changes
 * her legal name to Dr. Jane Jones in 2023. The IdP now returns "Dr. Jane Jones"
 * for the same iss|sub. Without history, auditors see signatures from two
 * apparently different people.
 * 
 * Solution: Track name changes in principal_name_history table. Auditors can
 * see the complete timeline and understand it's the same person.
 * 
 * Related:
 * - .scratch/authentication/issues/22-name-change-history.md
 * - Round 8 decision U11
 */

describe('decideNameHistoryWrite', () => {
  it('no-ops when the name is unchanged and history already exists', () => {
    assert.deepEqual(
      decideNameHistoryWrite({
        currentName: 'Dr. Jane Smith',
        hasHistory: true,
        newName: 'Dr. Jane Smith',
      }),
      { kind: 'unchanged' },
    )
  })

  it('writes a seed row when history is missing', () => {
    assert.deepEqual(
      decideNameHistoryWrite({
        currentName: 'Dr. Jane Smith',
        hasHistory: false,
        newName: 'Dr. Jane Smith',
      }),
      {
        kind: 'write',
        closeOpenInterval: false,
        previousName: 'Dr. Jane Smith',
        name: 'Dr. Jane Smith',
      },
    )
  })

  it('closes the open interval when the name changes', () => {
    assert.deepEqual(
      decideNameHistoryWrite({
        currentName: 'Dr. Jane Smith',
        hasHistory: true,
        newName: 'Dr. Jane Jones',
      }),
      {
        kind: 'write',
        closeOpenInterval: true,
        previousName: 'Dr. Jane Smith',
        name: 'Dr. Jane Jones',
      },
    )
  })
})

describe('nameValidAt (Ticket 22)', () => {
  it('uses validFrom ≤ t < validTo (open interval when validTo is null)', () => {
    const records = [
      {
        name: 'Julia Smith',
        validFrom: new Date('2021-03-15T00:00:00.000Z'),
        validTo: new Date('2023-06-01T00:00:00.000Z'),
      },
      {
        name: 'Julia Jones',
        validFrom: new Date('2023-06-01T00:00:00.000Z'),
        validTo: null,
      },
    ]
    assert.equal(nameValidAt(records, new Date('2022-01-15T12:00:00.000Z')), 'Julia Smith')
    assert.equal(nameValidAt(records, new Date('2023-06-01T00:00:00.000Z')), 'Julia Jones')
    assert.equal(nameValidAt(records, new Date('2024-01-01T00:00:00.000Z')), 'Julia Jones')
    assert.equal(nameValidAt(records, new Date('2020-01-01T00:00:00.000Z')), null)
  })
})

describe('Name Change History (U11)', () => {
  it('tracks first name for a principal', async () => {
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'alice-name1',
      name: 'Dr. Alice Smith',
    })
    
    const history = await getNameHistory(principalId)
    
    assert.equal(history.length, 1, 'Should have one history record')
    assert.equal(history[0].name, 'Dr. Alice Smith')
    assert.ok(history[0].validFrom, 'Should have validFrom')
    assert.equal(history[0].validTo, null, 'Current name has null validTo')
  })

  it('tracks name change and closes previous record', async () => {
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'bob-name2',
      name: 'Dr. Bob Smith',
    })
    
    // Name changes (marriage)
    const changeTime = new Date()
    await trackNameChange(principalId, 'Dr. Bob Jones', changeTime)
    
    const history = await getNameHistory(principalId)
    
    assert.equal(history.length, 2, 'Should have two history records')
    
    // Old name (closed)
    assert.equal(history[0].name, 'Dr. Bob Smith')
    assert.ok(history[0].validTo, 'Old name should have validTo set')
    
    // New name (current)
    assert.equal(history[1].name, 'Dr. Bob Jones')
    assert.equal(history[1].validTo, null, 'Current name has null validTo')
  })

  it('getCurrentName returns most recent name', async () => {
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'charlie-name3',
      name: 'Charlie Original',
    })
    
    await trackNameChange(principalId, 'Charlie Updated')
    await trackNameChange(principalId, 'Charlie Final')
    
    const currentName = await getCurrentName(principalId)
    
    assert.equal(currentName, 'Charlie Final', 'Should return most recent name')
  })

  it('multiple name changes create complete timeline', async () => {
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'diana-name4',
      name: 'Diana Smith',
    })
    
    // Add sequential name changes
    await trackNameChange(principalId, 'Diana Jones')
    await trackNameChange(principalId, 'Diana Williams')
    
    const history = await getNameHistory(principalId)
    
    assert.equal(history.length, 3, 'Should have three history records')
    assert.equal(history[0].name, 'Diana Smith')
    assert.equal(history[1].name, 'Diana Jones')
    assert.equal(history[2].name, 'Diana Williams')
    
    // Only last one is current
    assert.ok(history[0].validTo !== null, 'First name closed')
    assert.ok(history[1].validTo !== null, 'Second name closed')
    assert.equal(history[2].validTo, null, 'Third name is current')
  })

  it('unchanged name does not create duplicate history', async () => {
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'eve-name5',
      name: 'Dr. Eve Johnson',
    })
    
    // Track same name again (e.g., user logs in multiple times)
    const result1 = await trackNameChange(principalId, 'Dr. Eve Johnson')
    const result2 = await trackNameChange(principalId, 'Dr. Eve Johnson')
    
    assert.equal(result1.changed, false, 'Should not report change for same name')
    assert.equal(result2.changed, false)
    
    const history = await getNameHistory(principalId)
    assert.equal(history.length, 1, 'Should still have only one history record')
  })

  it('ensurePrincipal tracks name on first login', async () => {
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'frank-name6',
      name: 'Frank Thompson',
    })
    
    const history = await getNameHistory(principalId)
    
    assert.equal(history.length, 1)
    assert.equal(history[0].name, 'Frank Thompson')
  })

  it('ensurePrincipal tracks name change on subsequent login', async () => {
    // First login
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'grace-name7',
      name: 'Grace Lee',
    })
    
    // Second login with new name (IdP returns updated name)
    await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'grace-name7',
      name: 'Grace Kim',
    })
    
    const history = await getNameHistory(principalId)
    
    assert.equal(history.length, 2, 'Should track name change on login')
    assert.equal(history[0].name, 'Grace Lee')
    assert.equal(history[1].name, 'Grace Kim')
    assert.equal(history[1].validTo, null, 'New name is current')
  })

  it('signature records capture name at signing time', async () => {
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'helen-name8',
      name: 'Dr. Helen Martinez',
    })
    
    // Simulate signature creation with name snapshot
    const signaturePrincipal = {
      iss: 'https://idp.test',
      sub: 'helen-name8',
      name: 'Dr. Helen Martinez',
    }
    
    // Later, name changes (user gets married)
    await trackNameChange(principalId, 'Dr. Helen Garcia')
    
    // Current name is different from signing time
    const currentName = await getCurrentName(principalId)
    assert.equal(currentName, 'Dr. Helen Garcia')
    
    // Signature still shows name at signing time
    assert.equal(signaturePrincipal.name, 'Dr. Helen Martinez', 'Signature preserves original name')
    
    // History shows both names
    const history = await getNameHistory(principalId)
    assert.equal(history.length, 2)
    assert.equal(history[0].name, 'Dr. Helen Martinez')
    assert.equal(history[1].name, 'Dr. Helen Garcia')
  })

  it('name history ordered chronologically', async () => {
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'ivan-name9',
      name: 'Ivan First',
    })
    
    // Add names sequentially
    await trackNameChange(principalId, 'Ivan Second')
    await trackNameChange(principalId, 'Ivan Third')
    
    const history = await getNameHistory(principalId)
    
    // Should be ordered oldest first (by validFrom)
    assert.equal(history.length, 3)
    assert.equal(history[0].name, 'Ivan First')
    assert.equal(history[1].name, 'Ivan Second')
    assert.equal(history[2].name, 'Ivan Third')
    
    // Verify ordering by timestamp
    assert.ok(history[0].validFrom <= history[1].validFrom)
    assert.ok(history[1].validFrom <= history[2].validFrom)
  })

  it('getNameAtTime returns the name valid during an interval, not only at validFrom', async () => {
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'julia-name10',
      email: 'julia@example.com',
    })
    const first = new Date('2021-03-15T00:00:00.000Z')
    const married = new Date('2023-06-01T00:00:00.000Z')
    await trackNameChange(principalId, 'Julia Smith', first)
    await trackNameChange(principalId, 'Julia Jones', married)

    const midFirst = await getNameAtTime(principalId, new Date('2022-01-15T12:00:00.000Z'))
    const atChange = await getNameAtTime(principalId, married)
    const afterChange = await getNameAtTime(principalId, new Date('2024-01-01T00:00:00.000Z'))

    assert.equal(midFirst, 'Julia Smith')
    assert.equal(atChange, 'Julia Jones')
    assert.equal(afterChange, 'Julia Jones')
  })

  it('toAdminNameHistory derives currentName from the open interval', async () => {
    const principalId = await ensurePrincipal({
      iss: 'https://idp.test',
      sub: 'kate-name11',
      email: 'kate@example.com',
    })
    await trackNameChange(principalId, 'Kate Smith', new Date('2021-03-15T00:00:00.000Z'))
    await trackNameChange(principalId, 'Kate Jones', new Date('2023-06-01T00:00:00.000Z'))

    assert.deepEqual(toAdminNameHistory(await getNameHistory(principalId)), {
      currentName: 'Kate Jones',
      history: [
        {
          name: 'Kate Smith',
          validFrom: '2021-03-15T00:00:00.000Z',
          validTo: '2023-06-01T00:00:00.000Z',
        },
        {
          name: 'Kate Jones',
          validFrom: '2023-06-01T00:00:00.000Z',
          validTo: null,
        },
      ],
    })
  })
})

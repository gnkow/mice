import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatPermissionLabel,
  groupPermissions,
  humanizePermissionSegment,
  permissionResource,
} from './permissionPicker.ts'

describe('permission picker helpers', () => {
  it('splits resource from a catalog id', () => {
    assert.equal(permissionResource('repo:files:read'), 'repo')
    assert.equal(permissionResource('namespace:list'), 'namespace')
    assert.equal(permissionResource('session_create'), 'session_create')
  })

  it('humanizes segments', () => {
    assert.equal(humanizePermissionSegment('custom_roles'), 'Custom Roles')
    assert.equal(humanizePermissionSegment('namespace'), 'Namespace')
  })

  it('formats a readable title with the raw id as detail', () => {
    assert.deepEqual(formatPermissionLabel('repo:files:read'), {
      title: 'Files · Read',
      detail: 'repo:files:read',
    })
  })

  it('groups and filters the catalog', () => {
    const catalog = [
      'namespace:list',
      'namespace:create',
      'repo:read',
      'repo:files:write',
    ]
    assert.deepEqual(groupPermissions(catalog), [
      {
        resource: 'namespace',
        label: 'Namespace',
        permissions: ['namespace:list', 'namespace:create'],
      },
      {
        resource: 'repo',
        label: 'Repository',
        permissions: ['repo:read', 'repo:files:write'],
      },
    ])
    assert.deepEqual(groupPermissions(catalog, 'files'), [
      {
        resource: 'repo',
        label: 'Repository',
        permissions: ['repo:files:write'],
      },
    ])
    assert.deepEqual(groupPermissions(catalog, 'zzz'), [])
  })
})

// SPDX-License-Identifier: MPL-2.0
import { expect, it, vi } from 'vitest'
import { HomeConnection } from './home-connection'

it('reconnects a refreshed document and invalidates old asynchronous replies', () => {
  const connection = new HomeConnection<{ close(): void }>()
  const old = { close: vi.fn() }
  const next = { close: vi.fn() }
  expect(connection.connect('a'.repeat(32), () => old)).toBe(old)
  expect(connection.connect('a'.repeat(32), () => next)).toBeNull()
  expect(old.close).not.toHaveBeenCalled()
  expect(connection.connect('b'.repeat(32), () => next)).toBe(next)
  expect(old.close).toHaveBeenCalledOnce()
  expect(connection.isCurrent(old)).toBe(false)
  expect(connection.isCurrent(next)).toBe(true)
  connection.close()
  expect(connection.isCurrent(next)).toBe(false)
  expect(next.close).toHaveBeenCalledOnce()
})

it('accepts legacy clients once and ignores malformed document IDs', () => {
  const connection = new HomeConnection<{ close(): void }>()
  const create = vi.fn(() => ({ close: vi.fn() }))
  for (const invalid of [null, 1, '', 'invalid'])
    expect(connection.connect(invalid, create)).toBeNull()
  expect(create).not.toHaveBeenCalled()
  expect(connection.connect(undefined, create)).not.toBeNull()
  expect(connection.connect(undefined, create)).toBeNull()
  expect(create).toHaveBeenCalledOnce()
})

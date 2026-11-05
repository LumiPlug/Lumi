// SPDX-License-Identifier: MPL-2.0

/** Owns one document's channel; a refreshed iframe keeps its WindowProxy. */
export class HomeConnection<T extends { close(): void }> {
  port: T | null = null
  private document: string | null = null

  connect(documentId: unknown, create: () => T): T | null {
    // Missing IDs support existing bridge-v1 clients.
    if (
      documentId !== undefined &&
      (typeof documentId !== 'string' || !/^[a-f0-9]{32}$/.test(documentId))
    )
      return null
    const next = documentId === undefined ? 'legacy' : (documentId as string)
    if (this.document === next) return null
    this.port?.close()
    this.document = next
    this.port = create()
    return this.port
  }

  isCurrent(port: T): boolean {
    return this.port === port
  }

  close(): void {
    this.port?.close()
    this.port = null
    this.document = null
  }
}

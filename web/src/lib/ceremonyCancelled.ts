/** Thrown when the user dismisses the reason/signature ceremony without completing it. */
export class CeremonyCancelled extends Error {
  constructor() {
    super('Signing cancelled')
    this.name = 'CeremonyCancelled'
  }
}

export function isCeremonyCancelled(err: unknown): boolean {
  return err instanceof CeremonyCancelled
}

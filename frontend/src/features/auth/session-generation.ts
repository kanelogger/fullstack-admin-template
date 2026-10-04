let authOperationRevision = 0;

export function getAuthOperationRevision(): number {
  return authOperationRevision;
}

/** Start a new login/reset transition and invalidate any older pending one. */
export function beginAuthOperation(): number {
  authOperationRevision += 1;
  return authOperationRevision;
}

/** Invalidate pending auth work when the user signs out or changes session. */
export function invalidateAuthOperations(): number {
  authOperationRevision += 1;
  return authOperationRevision;
}

export function isCurrentAuthOperation(revision: number): boolean {
  return authOperationRevision === revision;
}

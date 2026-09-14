export type AsyncOperationLock = {
  current: boolean;
};

export const tryAcquireAsyncOperationLock = (lock: AsyncOperationLock): boolean => {
  if (lock.current) {
    return false;
  }

  lock.current = true;
  return true;
};

export const releaseAsyncOperationLock = (lock: AsyncOperationLock): void => {
  lock.current = false;
};

/**
 * Compares two objects and returns an object with the properties that have changed.
 * @param original The original object.
 * @param updated The updated object.
 * @returns An object with only the properties that have changed.
 */
export const getChangedValues = <T extends Record<string, any>>(original: Partial<T>, updated: Partial<T>): Partial<T> => {
    const changes: Partial<T> = {};
    Object.keys(updated).forEach(key => {
      if (updated[key] !== original[key]) {
        changes[key as keyof T] = updated[key];
      }
    });
    return changes;
};
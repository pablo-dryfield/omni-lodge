// getChangedValues.ts
/**
 * Compares two objects and returns an object with properties that have changed,
 * including setting 'updatedBy' to 3 if present before comparison.
 * @param original The original object.
 * @param updated The updated object, 'updatedBy' is checked before comparison.
 * @returns An object with only the properties that have changed.
 */
export const getChangedValues = <T extends Record<string, any>>(original: Partial<T>, updated: Partial<T>, loggedUserId: number): Partial<T> => {
  const changes: Record<string, any> = {}; // Use a more flexible intermediate type

  // Perform the comparison
  Object.keys(updated).forEach(key => {
      if (updated[key] !== original[key]) {
          changes[key] = updated[key];
      }
  });

  // Adjust 'updatedBy', if applicable, without direct type assertion issues
  if (changes.hasOwnProperty('updatedBy') || original.hasOwnProperty('updatedBy') || updated.hasOwnProperty('updatedBy')) {
      changes['updatedBy'] = loggedUserId;
  }

  return changes as Partial<T>; // Cast the result to Partial<T> when returning
};

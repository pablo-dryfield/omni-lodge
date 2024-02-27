/**
 * Compares two objects and returns an object with properties that have changed,
 * including setting 'updatedBy' to 3 if present before comparison.
 * @param original The original object.
 * @param updated The updated object, 'updatedBy' is checked before comparison.
 * @returns An object with only the properties that have changed.
 */
export const getChangedValues = <T extends Record<string, any>>(
    original: Partial<T>,
    updated: Partial<T>,
    loggedUserId: number
  ): Partial<T> => {
    const changes = Object.entries(updated).reduce((acc: Record<string, any>, [key, value]) => {
      if (value !== original[key]) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, any>);
    
    if ('updatedBy' in original || 'updatedBy' in updated) {
      changes.updatedBy = loggedUserId;
    }
  
    return changes as Partial<T>; 
  };
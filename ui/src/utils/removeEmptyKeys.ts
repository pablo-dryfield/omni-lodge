/**
 * Removes keys with empty string values from the given object.
 * If 'createdBy' exists, it sets its value to 2 before removing empty fields.
 * @param obj The object to filter.
 * @returns A new object of type Partial<T> with non-empty values and 'createdBy' updated if present.
 */
export const removeEmptyKeys = <T extends Record<string, any>>(obj: Partial<T>, loggedUserId: number): Partial<T> => {
  let cleaned: Partial<T> = {};

  // Initialize cleaned object with updated 'createdBy' if it exists in the original object
  if ('createdBy' in obj) {
      cleaned = { ...cleaned, createdBy: loggedUserId };
  }

  // Filter out keys with empty values
  cleaned = Object.entries(obj).reduce((acc, [key, value]) => {
      if (value !== "") {
          acc[key as keyof T] = value;
      }
      return acc;
  }, cleaned);

  return cleaned;
};
/**
 * Removes keys with empty string values from the given object.
 * If 'createdBy' exists, it sets its value to 2 before removing empty fields.
 * @param obj The object to filter.
 * @returns A new object of type Partial<T> with non-empty values and 'createdBy' updated if present.
 */
export const removeEmptyKeys = <T extends Record<string, any>>(obj: Partial<T>, loggedUserId: number): Partial<T> => {
  const cleaned = Object.entries(obj).reduce<Record<string, any>>((acc, [key, value]) => {
    if (value !== "") {
      acc[key] = value;
    }
    return acc;
  }, {});

  // Optionally update 'createdBy' if it exists, using spread operator to conditionally add it
  return {
    ...cleaned,
    ...(obj.createdBy !== undefined && { createdBy: loggedUserId })
  } as Partial<T>;
};
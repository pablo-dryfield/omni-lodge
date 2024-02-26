/**
 * Removes keys with empty string values from the given object.
 * @param obj The object to filter.
 * @returns A new object of type Partial<T> with non-empty values.
 */
export const removeEmptyKeys = <T extends Record<string, any>>(obj: T): Partial<T> => {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (value !== "") {
        acc[key as keyof T] = value;
      }
      return acc;
    }, {} as Partial<T>);
};
import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * usePersistedFilter
 *
 * A generic hook that keeps a filter value in sync with AsyncStorage so the
 * user's last-used filter survives app restarts.
 *
 * @param key           AsyncStorage key to persist the value under.
 * @param defaultValue  Value used before the stored value is loaded, and as
 *                      fallback when the stored value is not among `validValues`.
 * @param validValues   Array of every valid value; used to reject stale/unknown
 *                      stored values.
 */
export function usePersistedFilter<T extends string>(
  key: string,
  defaultValue: T,
  validValues: readonly T[]
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(defaultValue);

  // Restore persisted value on mount
  useEffect(() => {
    AsyncStorage.getItem(key)
      .then((stored) => {
        if (stored && (validValues as readonly string[]).includes(stored)) {
          setValue(stored as T);
        }
      })
      .catch(() => {/* ignore storage errors */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setPersistedValue = useCallback(
    (next: T) => {
      setValue(next);
      AsyncStorage.setItem(key, next).catch(() => {/* ignore storage errors */});
    },
    [key]
  );

  return [value, setPersistedValue];
}

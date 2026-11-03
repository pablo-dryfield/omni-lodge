import { useCallback, useEffect, useRef, useState } from 'react';

type Options = {
  contextKey: string;
  saveCounter: () => Promise<boolean>;
  syncVenueNumbers: () => Promise<void>;
  close: () => void;
};

export const useCounterSaveAndExit = ({ contextKey, saveCounter, syncVenueNumbers, close }: Options) => {
  const inFlight = useRef(false);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [contextKey]);

  const save = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    let counterSaved = false;
    try {
      if (!await saveCounter()) return;
      counterSaved = true;
      if (currentContext.current !== contextKey) return;
      await syncVenueNumbers();
      if (currentContext.current === contextKey) close();
    } catch (failure) {
      if (currentContext.current !== contextKey) return;
      const detail = typeof failure === 'string' ? failure
        : failure instanceof Error ? failure.message : 'Please try again.';
      setError(counterSaved
        ? `Counter attendance was saved, but Venue Numbers could not be updated. ${detail}`
        : `Unable to save the counter. ${detail}`);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [close, contextKey, saveCounter, syncVenueNumbers]);

  return { save, saving, error };
};

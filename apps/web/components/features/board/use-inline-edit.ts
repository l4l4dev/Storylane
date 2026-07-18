"use client";

import { useEffect, useRef, useState } from "react";

export function useInlineEdit({
  initialValue,
  onCommit,
  fallbackError,
  shouldCommit = () => true,
  resetAfterCommit = false,
}: {
  initialValue: string;
  onCommit: (value: string) => Promise<void>;
  fallbackError: string;
  shouldCommit?: (value: string) => boolean;
  resetAfterCommit?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValueState] = useState(initialValue);
  const [synced, setSynced] = useState(initialValue);
  const [lastInitialValue, setLastInitialValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);

  if (lastInitialValue !== initialValue) {
    setLastInitialValue(initialValue);
    setSynced(initialValue);
    setValueState(initialValue);
    setError(null);
  }

  useEffect(() => {
    if (!editing && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  function setValue(next: string) {
    setValueState(next);
    setError(null);
  }

  function startEditing() {
    setValueState(synced);
    setError(null);
    setEditing(true);
  }

  function closeAndRestoreFocus() {
    restoreFocusRef.current = true;
    setEditing(false);
  }

  function cancel() {
    setValueState(synced);
    setError(null);
    closeAndRestoreFocus();
  }

  async function commit(): Promise<boolean> {
    const trimmed = value.trim();
    if (!shouldCommit(trimmed) || trimmed === synced) {
      return true;
    }
    if (savingRef.current) {
      return false;
    }

    savingRef.current = true;
    setError(null);
    setIsSaving(true);
    try {
      await onCommit(trimmed);
      if (resetAfterCommit) {
        setSynced(initialValue);
        setValueState(initialValue);
      } else {
        setSynced(trimmed);
        setValueState(trimmed);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError);
      return false;
    } finally {
      setIsSaving(false);
      savingRef.current = false;
    }
  }

  function commitAndClose(): Promise<void> {
    const trimmed = value.trim();
    if (!shouldCommit(trimmed) || trimmed === synced) {
      closeAndRestoreFocus();
      return Promise.resolve();
    }
    return commit().then((committed) => {
      if (committed) {
        closeAndRestoreFocus();
      }
    });
  }

  return {
    buttonRef,
    cancel,
    commitAndClose,
    editing,
    error,
    isSaving,
    setValue,
    startEditing,
    synced,
    value,
  };
}

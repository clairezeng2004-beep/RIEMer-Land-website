import { createContext, useContext, useState, useCallback } from 'react';

const WysiwygContext = createContext(null);

export function WysiwygProvider({ children }) {
  const [editing, setEditing] = useState(false);
  const [changedKeys, setChangedKeys] = useState(new Set());

  const enterEdit = useCallback(() => {
    setEditing(true);
    setChangedKeys(new Set());
  }, []);

  const exitEdit = useCallback(() => {
    setEditing(false);
    setChangedKeys(new Set());
  }, []);

  const markChanged = useCallback((key) => {
    setChangedKeys((prev) => new Set(prev).add(key));
  }, []);

  return (
    <WysiwygContext.Provider value={{ editing, enterEdit, exitEdit, changedKeys, markChanged }}>
      {children}
    </WysiwygContext.Provider>
  );
}

export const useWysiwyg = () => {
  const ctx = useContext(WysiwygContext);
  if (!ctx) throw new Error('useWysiwyg must be used within WysiwygProvider');
  return ctx;
};

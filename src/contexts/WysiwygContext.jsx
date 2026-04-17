import { createContext, useContext, useState, useCallback, useRef } from 'react';

const WysiwygContext = createContext(null);

export function WysiwygProvider({ children }) {
  const [editing, setEditing] = useState(false);
  const [changedKeys, setChangedKeys] = useState(new Set());

  // 编辑入口调用方（WysiwygToolbar）通过 ref 登记"取消时如何回滚"
  // 避免 SiteContentContext 反向依赖 Wysiwyg
  const cancelHandlerRef = useRef(null);
  const saveHandlerRef = useRef(null);

  const enterEdit = useCallback((handlers) => {
    // handlers: { onCancel?: () => void, onSave?: () => void }
    cancelHandlerRef.current = handlers?.onCancel || null;
    saveHandlerRef.current = handlers?.onSave || null;
    setChangedKeys(new Set());
    setEditing(true);
  }, []);

  const saveEdit = useCallback(() => {
    try {
      saveHandlerRef.current?.();
    } finally {
      cancelHandlerRef.current = null;
      saveHandlerRef.current = null;
      setEditing(false);
      setChangedKeys(new Set());
    }
  }, []);

  const cancelEdit = useCallback(() => {
    try {
      cancelHandlerRef.current?.();
    } finally {
      cancelHandlerRef.current = null;
      saveHandlerRef.current = null;
      setEditing(false);
      setChangedKeys(new Set());
    }
  }, []);

  // 兼容保留：等价于 saveEdit（不回滚）
  const exitEdit = saveEdit;

  const markChanged = useCallback((key) => {
    setChangedKeys((prev) => new Set(prev).add(key));
  }, []);

  return (
    <WysiwygContext.Provider
      value={{
        editing,
        enterEdit,
        exitEdit,
        saveEdit,
        cancelEdit,
        changedKeys,
        markChanged,
      }}
    >
      {children}
    </WysiwygContext.Provider>
  );
}

export const useWysiwyg = () => {
  const ctx = useContext(WysiwygContext);
  if (!ctx) throw new Error('useWysiwyg must be used within WysiwygProvider');
  return ctx;
};

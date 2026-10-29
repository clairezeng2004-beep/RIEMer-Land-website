import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const FIELDS = {
  folder: { title: '新建文件夹', label: '文件夹名称', required: true },
  name: { title: '修改名称', label: '名称', required: true },
  note: { title: '编辑备注', label: '备注', maxLength: 200, multiline: true, hint: '最多 200 字，留空可清除备注。' },
  contributors: { title: '编辑内容贡献者', label: '内容贡献者', maxLength: 500, multiline: true, hint: '多人用顿号分隔；清空后恢复自动显示。' },
};

export default function InternalFilesTextEditor({ draft, busy, onSave, onClose }) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const [value, setValue] = useState(draft.value);
  const [error, setError] = useState('');
  const field = FIELDS[draft.kind];
  const Input = field.multiline ? 'textarea' : 'input';

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    inputRef.current.focus();
    inputRef.current.select();
    return () => dialog.close();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || (field.required && !value.trim())) return;
    setError('');
    try {
      await onSave(value);
      onClose();
    } catch (err) {
      setError(err?.message || '保存失败，请稍后重试。');
    }
  };

  return (
    <dialog ref={dialogRef} className="if-publish" aria-labelledby="if-edit-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={submit}>
        <div className="if-detail__head">
          <h2 id="if-edit-title" className="if-detail__title">{field.title}</h2>
          <button type="button" className="if-icon-btn" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18} /></button>
        </div>
        {draft.node && <p className="if-link-form__tip">{draft.node.name}</p>}
        <label className="if-link-form__label" htmlFor="if-edit-value">{field.label}</label>
        <Input ref={inputRef} id="if-edit-value" className="if-link-form__input"
          value={value} onChange={(e) => setValue(e.target.value)} disabled={busy}
          required={field.required} maxLength={field.maxLength} rows={field.multiline ? 4 : undefined}
          aria-describedby={field.hint ? 'if-edit-hint' : undefined} />
        {field.hint && <p id="if-edit-hint" className="if-link-form__tip">{field.hint}</p>}
        {error && <p className="if-link-form__status is-error" role="alert">{error}</p>}
        <div className="if-link-form__actions">
          <button type="button" className="if-btn if-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className="if-btn" disabled={busy || (field.required && !value.trim())}>
            {busy ? '保存中…' : draft.kind === 'folder' ? '创建' : '保存'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

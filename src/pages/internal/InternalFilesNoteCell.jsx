import { useState } from 'react';
import { StickyNote } from 'lucide-react';

export default function InternalFilesNoteCell({ node, editable, busy, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hasNote = !!node.note?.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (saving || busy) return;
    setSaving(true);
    setError('');
    try {
      await onSave(node, value);
      setEditing(false);
    } catch (err) {
      setError(err?.message || '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  if (editable && editing) {
    return (
      <form className="if-col-note if-note-editor" onSubmit={submit}
        onPointerDown={(e) => e.stopPropagation()} onDragStart={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}>
        <textarea className="if-note-editor__input" aria-label={`编辑 ${node.name} 的备注`}
          autoFocus rows={3} maxLength={200} placeholder="填写备注，留空可清除"
          value={value} disabled={saving || busy} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !saving && !busy) { e.preventDefault(); setEditing(false); }
          }} />
        {error && <span className="if-note-editor__error" role="alert">{error}</span>}
        <div className="if-note-editor__actions">
          <button type="button" className="if-btn if-btn--ghost" disabled={saving || busy} onClick={() => setEditing(false)}>取消</button>
          <button type="submit" className="if-btn" disabled={saving || busy}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </form>
    );
  }
  if (editable) {
    return (
      <button type="button" className={`if-col-note if-note-btn ${hasNote ? '' : 'is-empty'}`}
        onClick={() => { setValue(node.note || ''); setError(''); setEditing(true); }}
        disabled={busy} title={hasNote ? `${node.note}（点击编辑）` : '点击添加备注'}>
        {!hasNote && <StickyNote size={13} className="if-note-icon" />}
        <span className="if-note-text">{hasNote ? node.note : '添加备注'}</span>
      </button>
    );
  }
  return (
    <span className={`if-col-note if-note-readonly ${hasNote ? '' : 'is-empty'}`} title={node.note || ''}>
      {hasNote ? <span className="if-note-text">{node.note}</span>
        : <span className="if-note-dash">—</span>}
    </span>
  );
}

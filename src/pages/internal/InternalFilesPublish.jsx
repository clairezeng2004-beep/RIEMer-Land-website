import { useEffect, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { parseSharedLink } from '../../utils/sharedLink';

const TYPES = [
  ['files', '上传文件'], ['folder', '上传文件夹'],
  ['zip', '上传压缩包'], ['link', '添加链接'],
];

export default function InternalFilesPublish({ destination, busy, progress, onClose, onPublish }) {
  const dialogRef = useRef(null);
  const [type, setType] = useState('files');
  const [files, setFiles] = useState([]);
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [text, setText] = useState('');
  const [contributors, setContributors] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const parsed = parseSharedLink(text);
  const showName = type === 'link' || (type === 'files' && files.length === 1 && !/\.zip$/i.test(files[0].name));

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    try {
      const done = await onPublish({ type, files, name: showName ? name : '', text, contributors, note });
      if (done) onClose();
    } catch (err) {
      setError(err?.message || '发布失败，请稍后重试。');
    }
  };

  return (
    <dialog ref={dialogRef} className="if-publish" aria-labelledby="if-publish-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={submit}>
        <div className="if-detail__head">
          <h2 id="if-publish-title" className="if-detail__title">发布资料</h2>
          <button type="button" className="if-icon-btn" aria-label="关闭" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <p className="if-link-form__tip">发布到：{destination}。选择资料并填写信息，确认后再发布。</p>
        <fieldset disabled={busy} className="if-publish__fields">
          <label className="if-link-form__label" htmlFor="if-publish-type">资料类型</label>
          <select id="if-publish-type" className="if-link-form__input" value={type}
            onChange={(e) => { setType(e.target.value); setFiles([]); setName(''); setNameEdited(false); setError(''); }}>
            {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {type === 'link' ? <>
            <label className="if-link-form__label" htmlFor="if-publish-link">分享内容或网址</label>
            <textarea id="if-publish-link" className="if-link-form__input" rows={3} required value={text}
              placeholder="大文件建议先上传网盘，再粘贴分享链接"
              onChange={(e) => { setText(e.target.value); if (!nameEdited) setName(parseSharedLink(e.target.value).name); }} />
            {text && <p className={`if-link-form__status ${parsed.url ? '' : 'is-error'}`}>
              {parsed.url ? `已识别链接${parsed.code ? '，提取码会自动写入备注' : ''}` : '请填写包含 http:// 或 https:// 的链接'}
            </p>}
          </> : <>
            <label className="if-link-form__label" htmlFor="if-publish-files">选择{type === 'folder' ? '文件夹' : type === 'zip' ? '压缩包' : '文件'}</label>
            <input key={type} id="if-publish-files" className="if-link-form__input" type="file" multiple required
              accept={type === 'zip' ? '.zip,application/zip,application/x-zip-compressed' : undefined}
              {...(type === 'folder' ? { webkitdirectory: '', directory: '' } : {})}
              onChange={(e) => { const picked = Array.from(e.target.files || []); setFiles(picked); setName(picked.length === 1 ? picked[0].name : ''); setNameEdited(false); }} />
            <p className="if-link-form__tip">{files.length ? `已选择 ${files.length} 个文件。` : '选好后点击下方“发布资料”才会上传。'}文件夹、压缩包及批量上传保留原有名称和目录结构。</p>
          </>}
          {showName && <>
            <label className="if-link-form__label" htmlFor="if-publish-name">标题</label>
            <input id="if-publish-name" className="if-link-form__input" required value={name}
              onChange={(e) => { setName(e.target.value); setNameEdited(true); }} />
          </>}
          <label className="if-link-form__label" htmlFor="if-publish-contributors">内容贡献者（选填，多人用顿号分隔）</label>
          <input id="if-publish-contributors" className="if-link-form__input" value={contributors} maxLength={500}
            placeholder="留空则自动显示上传者" onChange={(e) => setContributors(e.target.value)} />
          <label className="if-link-form__label" htmlFor="if-publish-note">备注（选填）</label>
          <textarea id="if-publish-note" className="if-link-form__input" value={note} rows={3} maxLength={200}
            placeholder="补充资料范围、适用课程或其他说明" onChange={(e) => setNote(e.target.value)} />
        </fieldset>
        {error && <p className="if-link-form__status is-error" role="alert">{error}</p>}
        {busy && <p className="if-link-form__status" role="status">{progress ? `${progress.label || '正在上传'} ${progress.done}/${progress.total} ${progress.current}` : '正在发布…'}</p>}
        <div className="if-link-form__actions">
          <button type="button" className="if-btn if-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className="if-btn" disabled={busy || (showName && !name.trim()) || (type === 'link' ? !parsed.url : files.length === 0)}>
            <Upload size={16} />{busy ? '发布中…' : '发布资料'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

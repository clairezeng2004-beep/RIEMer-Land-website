import { useRef, useState } from 'react';
import FolderItemsEditor from './FolderItemsEditor';
import { appendSharingFolderItems } from '../services/memberSharingService';

export default function MemberSharingFolderUpload({ postId, onSaved }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState('');
  const lock = useRef(false);

  const publish = async () => {
    if (lock.current || reading || !items.length) return;
    lock.current = true;
    setBusy(true);
    setStatus('');
    try {
      const saved = await appendSharingFolderItems(postId, items);
      onSaved(saved);
      setItems([]);
      setStatus('已添加到文件夹。');
    } catch (err) {
      setStatus(err?.message || '上传失败，请重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return <section className="msd-folder-upload" aria-label="向文件夹添加资料">
    <fieldset disabled={busy}>
      <FolderItemsEditor items={items} onChange={setItems} title="添加文件或链接" maxItems={Infinity} disabled={busy} onReadingChange={setReading} />
      <div className="msd-folder-upload__actions">
        <button type="button" className="btn btn-secondary" disabled={reading || !items.length} onClick={() => { setItems([]); setStatus(''); }}>取消</button>
        <button type="button" className="btn btn-primary" disabled={reading || !items.length} onClick={publish}>{busy ? '上传中…' : '上传到此文件夹'}</button>
      </div>
    </fieldset>
    {status && <p role="status">{status}</p>}
  </section>;
}

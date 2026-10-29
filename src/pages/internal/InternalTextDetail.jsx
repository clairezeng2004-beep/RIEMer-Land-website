import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Download } from 'lucide-react';
import { fetchNode } from '../../services/internalFilesService';
import { createMemberSharingFolderService } from '../../services/memberSharingFolderService';
import { downloadInternalFile, internalFilePreviewType, isTextMaterial } from '../../utils/internalFilePreview';
import { plainTextToEditorHtml } from '../../utils/cleanPastedWordHtml';
import { renderInternalMarkdown, sanitizeInternalTextHtml } from '../../utils/internalTextHtml';
import MemberSharingDetail from './MemberSharingDetail';

export default function InternalTextDetail() {
  const { id, folderId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [material, setMaterial] = useState(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const fallbackBase = folderId ? `/internal/member-sharing?sharingFolder=${encodeURIComponent(folderId)}` : '/internal/internal-files';
  const fallback = `${fallbackBase}${file?.parentId ? `${folderId ? '&' : '?'}folder=${encodeURIComponent(file.parentId)}` : ''}`;
  const returnTo = location.state?.returnTo?.startsWith('/internal/') ? location.state.returnTo : fallback;
  const back = () => navigate(returnTo);

  useEffect(() => {
    const controller = new AbortController();
    setMaterial(null); setError('');
    (async () => {
      try {
        const node = folderId ? await createMemberSharingFolderService(folderId, null, false).fetchNode(id) : await fetchNode(id);
        if (!node || !isTextMaterial(node)) throw new Error('文本资料不存在或已被删除。');
        const response = await fetch(node.url, { signal: controller.signal });
        if (!response.ok) throw new Error('正文加载失败，请稍后重试。');
        const text = await response.text();
        if (controller.signal.aborted) return;
        const type = internalFilePreviewType(node);
        const content = type === 'rich' ? sanitizeInternalTextHtml(text) : type === 'markdown' ? renderInternalMarkdown(text) : plainTextToEditorHtml(text);
        setFile(node);
        setMaterial({
          id: `${folderId ? `sharing-file-${folderId}` : 'internal-file'}-${node.id}`,
          title: node.name, format: 'word', content, category: '文本资料',
          author: node.contributorsOverride || node.createdBy || '未知',
          authorId: node.contributorsOverride ? null : node.createdById,
          contributorIds: [], createdAt: node.createdAt || '', attachments: [], likes: [],
        });
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message || '资料加载失败。');
      }
    })();
    return () => controller.abort();
  }, [id, folderId]);

  if (!material) return <div className="msd-page">
    <div className="msd-topbar"><button className="msd-topbar__back" onClick={back}><ChevronLeft size={20} />返回列表</button></div>
    <div className="msd-content"><div className="msd-not-found" role={error ? 'alert' : 'status'}>{error || '正在加载正文…'}</div></div>
  </div>;

  return <MemberSharingDetail key={material.id} material={material} onBack={back} materialActions={<>
    {downloadError && <span role="alert">{downloadError}</span>}
    <button type="button" className="msd-topbar__back msd-topbar__edit" disabled={downloading} onClick={async () => {
      setDownloading(true); setDownloadError('');
      try { await downloadInternalFile(file); } catch (err) { setDownloadError(err.message); } finally { setDownloading(false); }
    }}><Download size={16} />{downloading ? '下载中…' : '下载'}</button>
  </>} />;
}

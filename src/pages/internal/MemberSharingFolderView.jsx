import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import InternalFiles from './InternalFiles';
import { createMemberSharingFolderService } from '../../services/memberSharingFolderService';

export default function MemberSharingFolderView({ post, user, canWrite }) {
  const navigate = useNavigate();
  const service = useMemo(() => createMemberSharingFolderService(post.id, user, canWrite), [post.id, user, canWrite]);
  return <InternalFiles key={post.id} fileService={service} title="成员经验分享" rootLabel={post.title}
    canWrite={canWrite} onBack={() => navigate('/internal/member-sharing')} />;
}

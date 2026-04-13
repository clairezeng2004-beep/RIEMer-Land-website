import Documents from './Documents';

export default function MemberSharing() {
  return (
    <Documents
      filterTypes={['course', 'history', 'experience']}
      customTitle="成员内部分享"
      customDesc="浏览课程资料、历史会议记录及成员经验分享"
      configSection="memberSharing"
    />
  );
}

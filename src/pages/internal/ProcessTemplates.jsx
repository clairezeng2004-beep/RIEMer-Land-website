import Documents from './Documents';

export default function ProcessTemplates() {
  return (
    <Documents
      filterTypes={['process', 'regulation', 'history']}
      customTitle="流程模板文件"
      customDesc="查看和管理流程手册、模版文件、规章制度及历史会议"
      configSection="processTemplates"
    />
  );
}

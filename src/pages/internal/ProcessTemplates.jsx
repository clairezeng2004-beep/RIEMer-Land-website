import Documents from './Documents';

export default function ProcessTemplates() {
  return (
    <Documents
      filterTypes={['process', 'regulation']}
      customTitle="流程模板文件"
      customDesc="查看和管理流程手册、模版文件及规章制度"
      configSection="processTemplates"
    />
  );
}

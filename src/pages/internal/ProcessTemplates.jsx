import Documents from './Documents';
import { PROCESS_TEMPLATE_TYPE_KEYS } from '../../utils/documentTypeScope';

export default function ProcessTemplates() {
  return (
    <Documents
      filterTypes={PROCESS_TEMPLATE_TYPE_KEYS}
      customTitle="流程模板文件"
      customDesc="查看和管理流程手册、模版文件、规章制度及历史会议"
      configSection="processTemplates"
    />
  );
}

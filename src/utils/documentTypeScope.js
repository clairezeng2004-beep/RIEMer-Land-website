export const DEFAULT_DOCUMENT_TYPE_LABELS = {
  course: '课程及考试资料',
  history: '历史会议',
  process: '流程手册及模版文件',
  regulation: '规章制度',
  experience: '成员经验分享',
};

export const PROCESS_TEMPLATE_TYPE_KEYS = ['process', 'regulation', 'history'];
export const PROCESS_TEMPLATE_SCOPE = 'processTemplates';

export function getScopedDocumentTypeKeys({
  builtinKeys = [],
  documentTypes = [],
  extraTypeKeys = [],
  hiddenBuiltinKeys = [],
  scope,
}) {
  const availableKeys = new Set(documentTypes.map((type) => type.key));
  const hiddenKeys = new Set(hiddenBuiltinKeys);
  const scopedKeys = scope
    ? documentTypes
        .filter((type) => Array.isArray(type.scopes) && type.scopes.includes(scope))
        .map((type) => type.key)
    : [];

  return [...new Set([
    ...builtinKeys.filter((key) => !hiddenKeys.has(key)),
    ...extraTypeKeys.filter((key) => availableKeys.has(key)),
    ...scopedKeys.filter((key) => availableKeys.has(key)),
  ])];
}

import { match } from 'pinyin-pro';

/**
 * 拼音模糊匹配：判断 text 是否能被 keyword 匹配
 * 支持中文直接匹配 + 拼音全拼 + 拼音首字母
 * @param {string} text - 待搜索的文本
 * @param {string} keyword - 用户输入的搜索关键词
 * @returns {boolean}
 */
export function pinyinMatch(text, keyword) {
  if (!keyword) return true;
  if (!text) return false;

  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();

  // 1. 普通文本包含匹配
  if (lowerText.includes(lowerKeyword)) return true;

  // 2. 拼音匹配（全拼 + 首字母）
  const result = match(text, lowerKeyword);
  return result !== null;
}

/**
 * 对多个字段进行拼音搜索，任一字段匹配即返回 true
 * @param {string[]} fields - 待搜索的文本字段数组
 * @param {string} keyword - 用户输入的搜索关键词
 * @returns {boolean}
 */
export function pinyinMatchAny(fields, keyword) {
  if (!keyword) return true;
  return fields.some((field) => pinyinMatch(field, keyword));
}

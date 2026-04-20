/**
 * sortWithOtherLast —— "其他"永远沉到最后一个的稳定排序工具
 *
 * 背景：
 *   产品要求所有筛选项（活动分类 / 事项分类 / 未来可能的标签等）在列表中
 *   把名为"其他"的项固定放到末尾。原来的数据源（本地默认值、云端
 *   site_settings、老数据动态补回、用户手动新增顺序）无法保证这一点，
 *   所以统一在渲染前用这个工具做一次稳定排序。
 *
 * 设计要点：
 *   1. 只改"其他"的位置 —— 其余项保持原有顺序（稳定排序），避免把
 *      用户手工编辑的分类顺序搅乱。
 *   2. 不做小写/空白归一化：项目里分类都是中文硬编码"其他"，完全一致
 *      匹配即可；若以后出现变体（如"Other"）再扩展 trailingLabels。
 *   3. 非数组 / 空数组 / 不含"其他" 都能安全直通。
 *   4. 返回新数组，不修改入参（避免误改 context / state）。
 *
 * 参数：
 *   list —— 原始字符串数组（例如 ['全部', '腾讯会议分享', '其他', ...]）
 *   trailingLabels —— 需要沉底的标签集合，默认只包含"其他"；如果将来
 *                     还想把"未分类""Other"也沉底，直接扩充这个数组即可。
 *
 * 例：
 *   sortWithOtherLast(['全部', '腾讯会议分享', '团队招新', '其他', '分享会'])
 *   → ['全部', '腾讯会议分享', '团队招新', '分享会', '其他']
 */
export function sortWithOtherLast(list, trailingLabels = ['其他']) {
  if (!Array.isArray(list) || list.length === 0) return list || [];
  const trailingSet = new Set(trailingLabels);
  const head = [];
  const tail = [];
  for (const item of list) {
    if (trailingSet.has(item)) tail.push(item);
    else head.push(item);
  }
  // 若"其他"出现多次（理论上去重后不会），仍保留全部并都放末尾
  return [...head, ...tail];
}

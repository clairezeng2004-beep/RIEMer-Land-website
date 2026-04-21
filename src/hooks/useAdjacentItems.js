import { useMemo } from 'react';

/**
 * 给"文章详情页"通用地计算"上一篇 / 下一篇"的公共 hook。
 *
 * 设计要点：
 *   1. 传入的 items 已是列表页上呈现的顺序（调用侧自己保证排序一致），
 *      这样用户从列表点进详情、滑到底部看到的"下一篇"方向才与列表直觉一致。
 *   2. 同作者优先：若当前作者的其他条目至少有 2 条，就把 prev/next 都
 *      从"同作者子集"里取；不够的用全量列表补齐，并在补齐出来的条目上
 *      标 `sameAuthor: false`，调用侧可据此选择是否显示"同作者推荐"徽标。
 *   3. 列表循环：到达两端时默认不回环（prev/next 可能为 null）。
 *      如果调用方希望闭环，可以设 loop=true。
 *
 * @param {Object} opts
 * @param {Array<Object>} opts.items         列表页顺序的条目数组
 * @param {string|number} opts.currentId     当前详情对应的 id
 * @param {(item:Object)=>string|number|null} opts.getId     从 item 取 id 的函数
 * @param {(item:Object)=>string|number|null} opts.getAuthorKey 从 item 取"作者匹配键"的函数（id 或去空格后的作者名）
 * @param {boolean} [opts.loop=false]        两端是否回环
 * @returns {{
 *   prev: Object|null,
 *   next: Object|null,
 *   prevSameAuthor: boolean,
 *   nextSameAuthor: boolean,
 *   sameAuthorCount: number,
 * }}
 */
export default function useAdjacentItems({
  items,
  currentId,
  getId,
  getAuthorKey,
  loop = false,
}) {
  return useMemo(() => {
    const empty = {
      prev: null,
      next: null,
      prevSameAuthor: false,
      nextSameAuthor: false,
      sameAuthorCount: 0,
    };
    if (!Array.isArray(items) || items.length === 0) return empty;

    const idOf = (x) => {
      const v = getId ? getId(x) : x?.id;
      return v == null ? null : String(v);
    };
    const currentKey = currentId == null ? null : String(currentId);
    if (!currentKey) return empty;

    const currentIdx = items.findIndex((x) => idOf(x) === currentKey);
    if (currentIdx === -1) return empty;

    const current = items[currentIdx];
    const currentAuthor = getAuthorKey ? getAuthorKey(current) : null;
    // 仅当作者键存在且非空时才能做"同作者优先"。
    // 否则（比如内置示例缺 uploadedById）直接退化为纯列表相邻。
    const normalizedAuthor =
      currentAuthor == null || currentAuthor === ''
        ? null
        : String(currentAuthor).trim().toLowerCase();

    const sameAuthorItems = normalizedAuthor
      ? items.filter((x) => {
          const k = getAuthorKey ? getAuthorKey(x) : null;
          if (k == null || k === '') return false;
          return String(k).trim().toLowerCase() === normalizedAuthor;
        })
      : [];

    // 在某个候选列表里，找当前项的左右邻居
    const pickNeighbors = (list) => {
      const idx = list.findIndex((x) => idOf(x) === currentKey);
      if (idx === -1) return { prev: null, next: null };
      let prev = idx > 0 ? list[idx - 1] : null;
      let next = idx < list.length - 1 ? list[idx + 1] : null;
      if (loop && list.length > 1) {
        if (!prev) prev = list[list.length - 1];
        if (!next) next = list[0];
      }
      return { prev, next };
    };

    // 同作者条目至少要 2 条（当前 1 + 其他 ≥ 1）才有必要走"同作者优先"
    const sameAuthorCount = sameAuthorItems.length;
    let prev = null;
    let next = null;
    let prevSameAuthor = false;
    let nextSameAuthor = false;

    if (sameAuthorCount >= 2) {
      const n = pickNeighbors(sameAuthorItems);
      prev = n.prev;
      next = n.next;
      prevSameAuthor = Boolean(prev);
      nextSameAuthor = Boolean(next);
    }

    // 缺哪边就用全量兄弟列表补哪边，保证 prev/next 尽量都有
    if (!prev || !next) {
      const n = pickNeighbors(items);
      if (!prev && n.prev) prev = n.prev;
      if (!next && n.next) next = n.next;
    }

    return {
      prev,
      next,
      prevSameAuthor,
      nextSameAuthor,
      sameAuthorCount: Math.max(0, sameAuthorCount - 1), // 扣掉当前篇本身
    };
  }, [items, currentId, getId, getAuthorKey, loop]);
}

export function safeParseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  // 把中间的空格替换为 'T'（Postgres TIMESTAMPTZ 输出常见格式）
  s = s.replace(' ', 'T');
  // 处理 '+00' / '-05' 这类单段时区（需补成 '+00:00'）
  s = s.replace(/([+-])(\d{2})$/, '$1$2:00');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function compareMemberJoinedAt(a, b) {
  const first = safeParseDate(a.joined_at)?.getTime() ?? Infinity;
  const second = safeParseDate(b.joined_at)?.getTime() ?? Infinity;
  return first === second ? 0 : first < second ? -1 : 1;
}

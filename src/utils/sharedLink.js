// ============================================
// 在线文档 / 网盘分享链接的识别
// ============================================
// 内部资料「添加链接」与成员分享的链接附件共用：
// 从粘贴的分享文案里拆出网址、名称、提取码，并按域名认出来源。

/* 常见网盘 / 在线文档的域名 → 来源名称（用于条目标签） */
const LINK_SOURCES = [
  [/(^|\.)(kdocs\.cn|wps\.cn|wps\.com)$/i, 'WPS'],
  [/(^|\.)docs\.qq\.com$/i, '腾讯文档'],
  [/(^|\.)weiyun\.com$/i, '微云'],
  [/(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com)$/i, '飞书'],
  [/(^|\.)dingtalk\.com$/i, '钉钉'],
  [/(^|\.)pan\.baidu\.com$/i, '百度网盘'],
  [/(^|\.)(alipan\.com|aliyundrive\.com)$/i, '阿里云盘'],
  [/(^|\.)pan\.quark\.cn$/i, '夸克网盘'],
  [/(^|\.)(123pan\.com|123pan\.cn)$/i, '123 云盘'],
  [/(^|\.)shimo\.im$/i, '石墨文档'],
  [/(^|\.)yuque\.com$/i, '语雀'],
  [/(^|\.)notion\.(so|site)$/i, 'Notion'],
  [/(^|\.)(onedrive\.live\.com|1drv\.ms|sharepoint\.com)$/i, 'OneDrive'],
  [/(^|\.)(drive|docs)\.google\.com$/i, 'Google 云端硬盘'],
];

/* 网址所属的来源名称；认不出的返回空串（界面上统一显示「链接」） */
export function linkSourceLabel(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return '';
  }
  const hit = LINK_SOURCES.find(([re]) => re.test(host));
  return hit ? hit[1] : '';
}

/* 从粘贴内容里拆出网址、名称与提取码
 *   不绑定某一家网盘，按各家分享文案的共性来拆：
 *     「【金山文档 | WPS云文档】 期末复习小专题笔记 https://www.kdocs.cn/l/xxxx」
 *     「【腾讯文档】期末复习小专题笔记 https://docs.qq.com/doc/xxxx」
 *     「通过百度网盘分享的文件：笔记.pdf 链接：https://pan.baidu.com/s/xxxx 提取码：abcd」
 *     「我用夸克网盘分享了「笔记.pdf」，点击链接即可保存。链接：https://pan.quark.cn/s/xxxx」
 *   名称只从网址「之前」的文字里取（之后的多是提取码 / 广告语）；
 *   拆不出名称时返回空串，由用户自己填。
 *   返回 { url, name, code }；找不到 http(s) 网址时 url 为空串 */
export function parseSharedLink(text) {
  const raw = String(text || '').trim();
  // 网址只取 ASCII 合法字符，避免把紧跟着的中文标点 / 文字吞进去
  const match = raw.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/i);
  if (!match) return { url: '', name: '', code: '' };
  const url = match[0].replace(/[.,;:!?'()]+$/, '');

  const codeMatch = raw.match(/(?:提取码|访问码|密码)\s*[:：]?\s*([A-Za-z0-9]{3,8})/);
  const code = codeMatch ? codeMatch[1] : '';

  const before = raw.slice(0, match.index);
  let name = '';
  const quoted = before.match(/「([^」]+)」/);
  if (quoted) {
    name = quoted[1];
  } else {
    name = before
      .replace(/(?:提取码|访问码|密码)\s*[:：]?\s*[A-Za-z0-9]{3,8}/g, ' ')
      .replace(/【[^】]*】/g, ' ')
      .replace(/(?:链接|地址|网址)\s*[:：]\s*$/, ' ')
      .replace(/^.*(?:分享的文件|分享了文件|分享文件|给你分享|邀请你查看|邀请你编辑|邀请你加入)\s*[:：]?/, ' ');
  }
  name = name.replace(/\s+/g, ' ').replace(/^[\s:：,，-]+|[\s:：,，-]+$/g, '');
  return { url, name, code };
}

/* 链接附件（成员分享 attachments 里的一项）
 *   与 FolderItemsEditor 既有的链接项同一结构，详情页 / 列表页无需区分来源 */
export function buildLinkAttachment({ name, url }) {
  return {
    id: `link_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'link',
    name: (name || '').trim() || url,
    url,
    type: 'link',
  };
}

/* 链接输入框的「粘贴即拆分」
 *   输入框里出现「分享文案 + 网址」时，返回拆好的 { url, name }；
 *   只是一条纯网址（或还在手打）时返回 null，交回输入框原样处理。 */
export function splitPastedLink(value) {
  const text = String(value || '').trim();
  // 纯网址不含空白和中文；只有带了文案才拆，免得手打网址时被改写
  if (!/[\s\u0080-￿]/.test(text)) return null;
  const parsed = parseSharedLink(text);
  return parsed.url ? { url: parsed.url, name: parsed.name } : null;
}

/* 手填网址补全协议头（docs.qq.com/xxx → https://docs.qq.com/xxx） */
export function normalizeLinkUrl(value) {
  const parsed = parseSharedLink(value).url;
  if (parsed) return parsed;
  const url = String(value || '').trim();
  return url ? `https://${url}` : '';
}

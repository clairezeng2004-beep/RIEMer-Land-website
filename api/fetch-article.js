// Vercel Serverless Function: 代理抓取微信公众号文章内容
// 路径: /api/fetch-article?url=<encoded_url>

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: '缺少 url 参数' });
  }

  // 仅允许微信公众号链接
  if (!url.includes('mp.weixin.qq.com')) {
    return res.status(400).json({ error: '仅支持微信公众号文章链接' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `抓取失败: ${response.status}` });
    }

    const html = await response.text();
    return res.status(200).json({ html });
  } catch (error) {
    return res.status(500).json({ error: `抓取异常: ${error.message}` });
  }
}

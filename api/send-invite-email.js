// ============================================
// Vercel Serverless Function: 发送管理员邀请邮件
// ============================================
// 路径: POST /api/send-invite-email
// 管理员在"用户管理 → 邮箱授权"输入邮箱后，自动给被授权者发邀请信。
// 复用 send-reset-code.js 同款 Resend 配置。
//
// 环境变量:
//   RESEND_API_KEY  — Resend API Key（必填，否则接口 503）
//   RESEND_FROM     — 发件人，默认 'RIEMer Land <onboarding@resend.dev>'
//   INVITE_SITE_URL — 邀请链接指向的站点首页（可选），默认 'https://riemerland.com'
//
// 请求体:
//   { email: string, inviterName?: string, mode?: 'invite'|'authorized' }
//     - mode = 'invite'     : 邮箱尚未注册 → 发"邀请注册"邮件（默认）
//     - mode = 'authorized' : 邮箱已注册且被授权 → 发"授权通过"邮件
// ============================================

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  const { email, inviterName, mode } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: '请提供邮箱地址' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const sendMode = mode === 'authorized' ? 'authorized' : 'invite';

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM || 'RIEMer Land <onboarding@resend.dev>';
  const siteUrl = (process.env.INVITE_SITE_URL || 'https://riemerland.com').replace(/\/$/, '');
  const loginUrl = `${siteUrl}/login`;

  if (!resendApiKey) {
    console.error('[send-invite-email] RESEND_API_KEY 未配置，无法发送邀请邮件');
    return res.status(503).json({
      error: '邮件服务未配置（管理员未设置 RESEND_API_KEY 环境变量），邀请邮件未发送。',
    });
  }

  const inviter = (inviterName && String(inviterName).trim()) || '管理员';

  // 两种文案
  const subject =
    sendMode === 'authorized'
      ? '【RIEMer Land】您的账号已被管理员授权'
      : '【RIEMer Land】邀请您加入 RIEMer Land 内部空间';

  const headline =
    sendMode === 'authorized'
      ? '您的账号已获得授权'
      : '您已被邀请加入 RIEMer Land';

  const bodyHtml =
    sendMode === 'authorized'
      ? `
        <p style="color: #555; font-size: 15px; line-height: 1.7; margin: 0 0 12px;">
          ${escapeHtml(inviter)} 已为您开通 <strong>RIEMer Land 内部空间</strong>的访问权限。
        </p>
        <p style="color: #555; font-size: 15px; line-height: 1.7; margin: 0 0 20px;">
          您现在可以直接使用已注册的账号登录，查看任务、文档、相册与团队动态。
        </p>
      `
      : `
        <p style="color: #555; font-size: 15px; line-height: 1.7; margin: 0 0 12px;">
          ${escapeHtml(inviter)} 邀请您加入 <strong>RIEMer Land 内部空间</strong>。
        </p>
        <p style="color: #555; font-size: 15px; line-height: 1.7; margin: 0 0 12px;">
          RIEMer Land 是我们团队共创、记录与沉淀的地方。点击下方按钮前往登录页，选择"注册"Tab 并使用本邮箱
          <strong style="color: #333;">${escapeHtml(normalizedEmail)}</strong> 创建账号，
          设置您自己的密码即可——您的邮箱已在白名单中，注册完成即拥有访问权限，无需再次等待审批。
        </p>
      `;

  const ctaText = sendMode === 'authorized' ? '立即登录' : '前往注册';

  const html = `
    <div style="max-width: 520px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; background: #fafafa; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #333; margin: 0;">RIEMer Land</h2>
        <p style="color: #888; font-size: 14px; margin: 4px 0 0;">${headline}</p>
      </div>
      <div style="background: white; border-radius: 8px; padding: 28px; border: 1px solid #eee;">
        ${bodyHtml}
        <div style="text-align: center; margin: 24px 0 12px;">
          <a href="${loginUrl}"
             style="display: inline-block; background: #5b8c3e; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 600;">
            ${ctaText}
          </a>
        </div>
        <p style="color: #999; font-size: 12px; text-align: center; margin: 16px 0 0;">
          如果按钮无法点击，请复制以下链接到浏览器：<br />
          <span style="color: #5b8c3e; word-break: break-all;">${loginUrl}</span>
        </p>
      </div>
      <p style="color: #bbb; font-size: 12px; text-align: center; margin-top: 16px;">
        如果这封邮件与您无关，请忽略它。
      </p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [normalizedEmail],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[send-invite-email] Resend API 错误:', response.status, errorData);
      const detail =
        errorData?.message ||
        errorData?.error ||
        `Resend 返回 HTTP ${response.status}`;
      return res.status(502).json({ error: `邀请邮件发送失败：${detail}` });
    }

    return res.status(200).json({
      success: true,
      message: '邀请邮件已发送',
    });
  } catch (err) {
    console.error('[send-invite-email] 发送异常:', err);
    return res.status(502).json({
      error: `邀请邮件发送失败：${err.message || '网络异常'}`,
    });
  }
}

/** 极简 HTML 转义，防止 inviterName 被注入 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

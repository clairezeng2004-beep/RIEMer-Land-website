// ============================================
// Vercel Cron Function: 未读消息邮件汇总提醒
// ============================================
// 路径: GET /api/send-unread-digest（由 vercel.json 的 cron 定时触发）
// 作用: 给「有未读站内通知」的已授权用户发送一封未读汇总邮件（每人最多每 7 天一封）。
//
// 依赖环境变量（多数已被 send-reset-code 复用，应已配置）:
//   VITE_SUPABASE_URL            — Supabase 项目 URL
//   SUPABASE_SERVICE_ROLE_KEY    — 服务端密钥（绕过 RLS 读取所有用户/通知/已读）
//   RESEND_API_KEY               — Resend 发信密钥
//   RESEND_FROM                  — 发件人（可选，默认 onboarding@resend.dev）
//   SITE_URL                     — 站点地址（可选，用于邮件里的"去查看"链接）
//   CRON_SECRET                  — 定时任务密钥（可选但建议；Vercel Cron 会带 Authorization: Bearer <CRON_SECRET>）
//
// 还需在 Supabase 执行 supabase-notification-email-log.sql 建去重表（notification_email_log）。
// ============================================

const MIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 每人最多每 7 天一封
const MAX_LIST = 12; // 邮件里最多列出多少条未读

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** PostgREST GET（service role，绕过 RLS） */
async function sbGet(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function sendDigest({ resendApiKey, fromAddress, to, name, unread, siteUrl }) {
  const items = unread
    .slice(0, MAX_LIST)
    .map((n) => {
      const title = escapeHtml(n.title || '通知');
      const msg = escapeHtml((n.message || '').slice(0, 90));
      return `<li style="margin:0 0 12px;"><strong style="color:#333;">${title}</strong>${
        msg ? `<br/><span style="color:#888;font-size:13px;">${msg}</span>` : ''
      }</li>`;
    })
    .join('');
  const more =
    unread.length > MAX_LIST
      ? `<p style="color:#999;font-size:13px;margin:8px 0 0;">…以及其它 ${unread.length - MAX_LIST} 条未读</p>`
      : '';
  const hi = name ? `${escapeHtml(name)}，` : '';

  const html = `
    <div style="max-width: 520px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; background: #fafafa; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #333; margin: 0;">RIEMer Land</h2>
        <p style="color: #888; font-size: 14px; margin: 4px 0 0;">未读消息提醒</p>
      </div>
      <div style="background: white; border-radius: 8px; padding: 24px; border: 1px solid #eee;">
        <p style="color: #555; font-size: 14px; margin: 0 0 16px;">${hi}你在 RIEMer Land 还有 <strong style="color:#5b8c3e;">${unread.length}</strong> 条未读消息：</p>
        <ul style="padding-left: 18px; margin: 0;">${items}</ul>
        ${more}
        <div style="text-align:center; margin-top: 24px;">
          <a href="${escapeHtml(siteUrl)}/internal/notifications" style="display:inline-block; background:#5b8c3e; color:#fff; text-decoration:none; padding:10px 22px; border-radius:6px; font-size:14px;">去查看消息</a>
        </div>
      </div>
      <p style="color: #bbb; font-size: 12px; text-align: center; margin-top: 16px;">这是系统自动发送的未读汇总提醒（每周最多一封）。</p>
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
        to: [to],
        subject: `【RIEMer Land】你有 ${unread.length} 条未读消息`,
        html,
      }),
    });
    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      const detail = e?.message || e?.error || `HTTP ${response.status}`;
      console.error('[send-unread-digest] Resend 发送失败:', to, response.status, detail);
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (e) {
    console.error('[send-unread-digest] 发送异常:', to, e.message);
    return { ok: false, error: e.message || '网络异常' };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  // 鉴权：配置了 CRON_SECRET 时强制校验（Vercel Cron 会自动带上）
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM || 'RIEMer Land <onboarding@resend.dev>';
  const siteUrl = (process.env.SITE_URL || 'https://riemer-land-website.vercel.app').replace(/\/$/, '');

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: 'Supabase 服务端环境变量未配置（VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）' });
  }
  if (!resendApiKey) {
    return res.status(503).json({ error: 'RESEND_API_KEY 未配置' });
  }

  try {
    const [profiles, notifications, reads, logRows] = await Promise.all([
      sbGet(supabaseUrl, serviceKey, 'profiles?select=id,email,role,nickname,name&authorized=eq.true'),
      sbGet(supabaseUrl, serviceKey, 'notifications?select=id,title,message,type,target_role,created_at&order=created_at.desc&limit=500'),
      sbGet(supabaseUrl, serviceKey, 'notification_reads?select=notification_id,user_id&limit=50000'),
      sbGet(supabaseUrl, serviceKey, 'notification_email_log?select=user_id,last_sent_at').catch(() => []),
    ]);

    const readSet = new Set((reads || []).map((r) => `${r.notification_id}|${r.user_id}`));
    const lastSentMap = new Map(
      (logRows || []).map((r) => [r.user_id, new Date(r.last_sent_at).getTime()])
    );
    const now = Date.now();

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const logUpserts = [];
    const errorSamples = []; // 收集去重后的失败原因，直接返回方便排查
    let firstSend = true;

    for (const p of profiles) {
      if (!p.email) { skipped += 1; continue; }

      // 该用户可见的未读：target_role 为空=所有人，或与其角色一致；且没有已读记录
      const unread = notifications.filter((n) => {
        const role = n.target_role;
        const visible = !role || role === p.role;
        if (!visible) return false;
        return !readSet.has(`${n.id}|${p.id}`);
      });
      if (unread.length === 0) { skipped += 1; continue; }

      // 频率限制：每人最多每 7 天一封
      const last = lastSentMap.get(p.id) || 0;
      if (now - last < MIN_INTERVAL_MS) { skipped += 1; continue; }

      // 限流：Resend 免费版约 2 封/秒，这里每封间隔 ~600ms，避免 429 失败
      if (!firstSend) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(600);
      }
      firstSend = false;

      // eslint-disable-next-line no-await-in-loop
      const result = await sendDigest({
        resendApiKey,
        fromAddress,
        to: p.email,
        name: p.nickname || p.name || '',
        unread,
        siteUrl,
      });
      if (result.ok) {
        sent += 1;
        logUpserts.push({
          user_id: p.id,
          last_sent_at: new Date().toISOString(),
          last_unread_count: unread.length,
        });
      } else {
        failed += 1;
        if (result.error && !errorSamples.includes(result.error) && errorSamples.length < 5) {
          errorSamples.push(result.error);
        }
      }
    }

    // 写入发送日志（去重，下次 7 天内不再重复发）
    if (logUpserts.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/notification_email_log`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(logUpserts),
      }).catch((e) => console.warn('[send-unread-digest] 写入发送日志失败:', e.message));
    }

    return res.status(200).json({
      ok: true,
      users: profiles.length,
      sent,
      skipped,
      failed,
      ...(errorSamples.length > 0 ? { errors: errorSamples } : {}),
    });
  } catch (err) {
    console.error('[send-unread-digest] 失败:', err);
    return res.status(500).json({ error: err.message || '未知错误' });
  }
}

// ============================================
// Vercel Serverless Function: 发送密码重置验证码
// ============================================
// 路径: POST /api/send-reset-code
// 使用 Resend（免费 100 封/天）发送 6 位数字验证码
// 验证码存储在内存 Map 中，5 分钟过期
//
// 环境变量:
//   RESEND_API_KEY — Resend API Key（在 https://resend.com/api-keys 创建）
// ============================================

// 简易内存存储（Serverless 冷启动后会清空，生产环境可换 Redis/KV）
// 格式: { email: { code, expiresAt, attempts } }
const codeStore = new Map();

// 配置
const CODE_LENGTH = 6;
const CODE_EXPIRY_MS = 5 * 60 * 1000; // 5 分钟
const MAX_ATTEMPTS = 5; // 单个验证码最大验证尝试次数
const COOLDOWN_MS = 60 * 1000; // 同一邮箱发送冷却 60 秒

/** 生成 N 位随机数字验证码 */
function generateCode(length = CODE_LENGTH) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10);
  }
  return code;
}

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

  const { action, email, code, newPassword } = req.body;

  // ==================== 发送验证码 ====================
  if (action === 'send') {
    if (!email) {
      return res.status(400).json({ error: '请提供邮箱地址' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 冷却检查
    const existing = codeStore.get(normalizedEmail);
    if (existing && Date.now() - (existing.createdAt || 0) < COOLDOWN_MS) {
      const remainSec = Math.ceil((COOLDOWN_MS - (Date.now() - existing.createdAt)) / 1000);
      return res.status(429).json({ error: `请 ${remainSec} 秒后再试` });
    }

    // 生成验证码
    const resetCode = generateCode();
    codeStore.set(normalizedEmail, {
      code: resetCode,
      expiresAt: Date.now() + CODE_EXPIRY_MS,
      createdAt: Date.now(),
      attempts: 0,
    });

    // 使用 Resend 发送邮件
    // ⚠️ 安全原则：除非邮件成功送达用户邮箱，否则绝不能把验证码返回给前端，
    //    否则任何人只要在登录页输入目标邮箱就能看到验证码并改别人密码。
    //    以下所有失败分支一律清除已生成的验证码并返回错误。
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.RESEND_FROM || 'RIEMer Land <onboarding@resend.dev>';

    if (!resendApiKey) {
      console.error('[send-reset-code] RESEND_API_KEY 未配置，无法发送验证码');
      codeStore.delete(normalizedEmail); // 清除已生成但无法送达的验证码
      return res.status(503).json({
        error:
          '邮件服务未配置（管理员未设置 RESEND_API_KEY 环境变量），暂时无法发送验证码，请联系管理员。',
      });
    }

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
          subject: '【RIEMer Land】密码重置验证码',
          html: `
            <div style="max-width: 480px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; background: #fafafa; border-radius: 12px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h2 style="color: #333; margin: 0;">RIEMer Land</h2>
                <p style="color: #888; font-size: 14px; margin: 4px 0 0;">密码重置验证码</p>
              </div>
              <div style="background: white; border-radius: 8px; padding: 24px; text-align: center; border: 1px solid #eee;">
                <p style="color: #555; font-size: 14px; margin: 0 0 16px;">你正在重置 RIEMer Land 的账号密码，验证码为：</p>
                <div style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #5b8c3e; padding: 16px 0;">${resetCode}</div>
                <p style="color: #999; font-size: 12px; margin: 16px 0 0;">验证码 5 分钟内有效，请勿泄露给他人。</p>
              </div>
              <p style="color: #bbb; font-size: 12px; text-align: center; margin-top: 16px;">如果这不是你本人的操作，请忽略此邮件。</p>
            </div>
          `,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[send-reset-code] Resend API 错误:', response.status, errorData);
        codeStore.delete(normalizedEmail); // 未送达就清除
        // 把 Resend 的详细错误透传给前端（含 "domain not verified" 等常见提示），
        // 便于管理员在页面上直接看到问题原因。
        const detail =
          errorData?.message ||
          errorData?.error ||
          `Resend 返回 HTTP ${response.status}`;
        return res.status(502).json({
          error: `邮件发送失败：${detail}`,
        });
      }

      return res.status(200).json({
        success: true,
        message: '验证码已发送到你的邮箱，请查收（注意检查垃圾邮件）',
      });
    } catch (err) {
      console.error('[send-reset-code] 发送异常:', err);
      codeStore.delete(normalizedEmail);
      return res.status(502).json({
        error: `邮件发送失败：${err.message || '网络异常'}`,
      });
    }
  }

  // ==================== 验证验证码 ====================
  if (action === 'verify') {
    if (!email || !code) {
      return res.status(400).json({ error: '请提供邮箱和验证码' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const stored = codeStore.get(normalizedEmail);

    if (!stored) {
      return res.status(400).json({ error: '未找到验证码记录，请重新发送' });
    }

    if (Date.now() > stored.expiresAt) {
      codeStore.delete(normalizedEmail);
      return res.status(400).json({ error: '验证码已过期，请重新发送' });
    }

    if (stored.attempts >= MAX_ATTEMPTS) {
      codeStore.delete(normalizedEmail);
      return res.status(400).json({ error: '验证码尝试次数过多，请重新发送' });
    }

    stored.attempts += 1;

    if (stored.code !== code.trim()) {
      return res.status(400).json({ error: `验证码不正确，还剩 ${MAX_ATTEMPTS - stored.attempts} 次机会` });
    }

    // 验证成功 — 标记为已验证（不删除，留给 reset 阶段确认）
    stored.verified = true;

    return res.status(200).json({
      success: true,
      message: '验证码验证成功',
    });
  }

  // ==================== 重置密码（验证码已通过后）====================
  if (action === 'reset') {
    if (!email || !newPassword) {
      return res.status(400).json({ error: '请提供邮箱和新密码' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少需要 6 个字符' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const stored = codeStore.get(normalizedEmail);

    if (!stored || !stored.verified) {
      return res.status(400).json({ error: '请先完成验证码验证' });
    }

    // 验证码已使用，清除
    codeStore.delete(normalizedEmail);

    // 尝试通过 Supabase Admin API 重置密码
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseServiceKey) {
      try {
        // 1. 先通过邮箱查找用户
        const listRes = await fetch(
          `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=50`,
          {
            headers: {
              apikey: supabaseServiceKey,
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
          }
        );

        if (listRes.ok) {
          const { users } = await listRes.json();
          const targetUser = users?.find(
            (u) => u.email?.toLowerCase() === normalizedEmail
          );

          if (targetUser) {
            // 2. 使用 Admin API 更新密码
            const updateRes = await fetch(
              `${supabaseUrl}/auth/v1/admin/users/${targetUser.id}`,
              {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  apikey: supabaseServiceKey,
                  Authorization: `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({ password: newPassword }),
              }
            );

            if (updateRes.ok) {
              return res.status(200).json({
                success: true,
                message: '密码重置成功！请使用新密码登录。',
                target: 'supabase',
              });
            }
          }
        }
      } catch (err) {
        console.warn('[send-reset-code] Supabase Admin 重置失败:', err.message);
      }
    }

    // Supabase 不可用或用户不存在 → 返回成功（让前端处理本地模式）
    return res.status(200).json({
      success: true,
      message: '验证通过，请在前端完成密码重置',
      target: 'local',
    });
  }

  return res.status(400).json({ error: '未知的 action，支持：send / verify / reset' });
}

// ============================================
// Vercel Serverless Function: 彻底删除用户
// ============================================
// 路径: POST /api/delete-user
// 按顺序清理：
//   1) auth.users（Admin API）
//   2) profiles 表（同一 id / email 兜底）
//   3) pre_authorized_emails 表（若有同邮箱的残留预授权项）
// 这样后续用同一邮箱重新注册不会再触发 409。
//
// 请求体：
//   { userId?: string, email?: string }
//   userId 与 email 至少提供一个。优先用 userId 精确命中 auth.users。
//
// 环境变量（与 register-preauth 相同）:
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
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

  const { userId: rawUserId, email: rawEmail } = req.body || {};
  const userId = typeof rawUserId === 'string' ? rawUserId.trim() : '';
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';

  if (!userId && !email) {
    return res.status(400).json({ error: '请提供 userId 或 email' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Supabase 配置缺失' });
  }

  const adminHeaders = {
    'Content-Type': 'application/json',
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
  };

  const result = {
    authUserDeleted: false,
    profileDeleted: false,
    preAuthDeleted: false,
    resolvedUserId: userId || null,
    resolvedEmail: email || null,
    warnings: [],
  };

  try {
    // 1) 若未提供 userId，根据 email 去 auth.users 查找
    let targetUserId = userId;
    let targetEmail = email;

    if (!targetUserId && targetEmail) {
      try {
        // Admin API 支持按 email 过滤（per_page=1 足够，列表接口）
        const listUrl = `${supabaseUrl}/auth/v1/admin/users?filter=email.eq.${encodeURIComponent(targetEmail)}&per_page=1`;
        const listRes = await fetch(listUrl, { headers: adminHeaders });
        if (listRes.ok) {
          const listData = await listRes.json().catch(() => ({}));
          const users = Array.isArray(listData?.users) ? listData.users : [];
          if (users[0]?.id) {
            targetUserId = users[0].id;
            if (!targetEmail) targetEmail = users[0].email;
          }
        } else {
          result.warnings.push(`按邮箱查询 auth.users 失败（HTTP ${listRes.status}）`);
        }
      } catch (err) {
        result.warnings.push(`按邮箱查询 auth.users 异常：${err.message}`);
      }
    }

    // 2) 若仍未定位到 userId，但提供了 email，则无法调用 auth.admin.delete。
    //    仍然继续清 profiles/pre_authorized_emails，尽可能回到一致状态。
    if (targetUserId) {
      try {
        const delRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${targetUserId}`, {
          method: 'DELETE',
          headers: adminHeaders,
        });
        if (delRes.ok || delRes.status === 204) {
          result.authUserDeleted = true;
        } else if (delRes.status === 404) {
          // 已不存在，视为成功
          result.authUserDeleted = true;
          result.warnings.push('auth.users 中未找到该用户（可能已被删除）');
        } else {
          const errData = await delRes.json().catch(() => ({}));
          result.warnings.push(
            `删除 auth.users 失败（HTTP ${delRes.status}）：${errData.msg || errData.message || errData.error || '未知错误'}`
          );
        }
      } catch (err) {
        result.warnings.push(`删除 auth.users 异常：${err.message}`);
      }
    } else {
      result.warnings.push('未能在 auth.users 中定位用户（仅 email 且未匹配到记录）');
    }

    result.resolvedUserId = targetUserId || null;
    result.resolvedEmail = targetEmail || null;

    // 3) 清 profiles（按 id 优先；没有 id 再按 email）
    try {
      const profileParams = targetUserId
        ? `id=eq.${encodeURIComponent(targetUserId)}`
        : `email=ilike.${encodeURIComponent(targetEmail)}`;
      const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?${profileParams}`, {
        method: 'DELETE',
        headers: { ...adminHeaders, Prefer: 'return=representation' },
      });
      if (profileRes.ok) {
        result.profileDeleted = true;
      } else if (profileRes.status === 404) {
        result.profileDeleted = true;
      } else {
        const txt = await profileRes.text().catch(() => '');
        result.warnings.push(`删除 profiles 失败（HTTP ${profileRes.status}）：${txt.slice(0, 200)}`);
      }
    } catch (err) {
      result.warnings.push(`删除 profiles 异常：${err.message}`);
    }

    // 4) 清 pre_authorized_emails（按 email）
    if (targetEmail) {
      try {
        const preRes = await fetch(
          `${supabaseUrl}/rest/v1/pre_authorized_emails?email=ilike.${encodeURIComponent(targetEmail)}`,
          { method: 'DELETE', headers: adminHeaders }
        );
        if (preRes.ok || preRes.status === 404) {
          result.preAuthDeleted = true;
        } else {
          const txt = await preRes.text().catch(() => '');
          result.warnings.push(`删除 pre_authorized_emails 失败（HTTP ${preRes.status}）：${txt.slice(0, 200)}`);
        }
      } catch (err) {
        result.warnings.push(`删除 pre_authorized_emails 异常：${err.message}`);
      }
    }

    const overallSuccess = result.authUserDeleted || result.profileDeleted;
    if (!overallSuccess) {
      return res.status(500).json({
        success: false,
        error: '未能删除任何记录，请检查服务端日志',
        ...result,
      });
    }

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[delete-user] 异常:', err);
    return res.status(500).json({ error: '服务异常：' + err.message });
  }
}

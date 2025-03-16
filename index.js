let KV_BINDING;
const banPath = [
  'login', 'admin', '__total_count',
  // static files
  'admin.html', 'login.html',
  'daisyui@5.css', 'tailwindcss@4.js',
  'qr-code-styling.js', 'zxing.js',
  'robots.txt', 'wechat.svg',
  'favicon.svg',
];

// Cookie 相关函数
function verifyAuthCookie(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const authToken = cookie.split(';').find(c => c.trim().startsWith('token='));
  if (!authToken) return false;
  return authToken.split('=')[1].trim() === env.PASSWORD;
}

function setAuthCookie(password) {
  return {
    'Set-Cookie': `token=${password}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
    'Content-Type': 'application/json'
  };
}

function clearAuthCookie() {
  return {
    'Set-Cookie': 'token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    'Content-Type': 'application/json'
  };
}

// KV 操作相关函数
async function listMappings(page = 1, pageSize = 10) {
  const TOTAL_COUNT_KEY = "__total_count";
  let count;

  try {
    count = await KV_BINDING.get(TOTAL_COUNT_KEY, { type: "json" });
  } catch (e) {
    count = null;
  }

  const mappings = {};
  const skip = (page - 1) * pageSize;
  let validCount = 0;  // 用于记录有效的映射数量

  if (page === 1 || skip < 100) {
    let cursor = null;
    let processedCount = 0;

    do {
      const listResult = await KV_BINDING.list({ cursor, limit: Math.min(1000, skip + pageSize) });

      for (const key of listResult.keys) {
        // 跳过 banPath 中的路径
        if (!banPath.includes(key.name)) {
          if (processedCount >= skip && Object.keys(mappings).length < pageSize) {
            const value = await KV_BINDING.get(key.name, { type: "json" });
            mappings[key.name] = value;
          }
          processedCount++;
        }
      }

      cursor = listResult.cursor;
      if (count === null && cursor) {
        const remaining = await KV_BINDING.list({ cursor, limit: 1000 });
        // 计算剩余有效记录数（排除 banPath）
        processedCount += remaining.keys.filter(key => !banPath.includes(key.name)).length;
        cursor = remaining.cursor;
      }
    } while (cursor && Object.keys(mappings).length < pageSize);

    if (count === null) {
      count = processedCount;
      await KV_BINDING.put(TOTAL_COUNT_KEY, JSON.stringify(count));
    }
  } else {
    let cursor = null;
    const batchSize = 1000;
    let validSkip = skip;
    let processedValid = 0;

    // 继续获取数据直到找到足够的有效记录
    while (processedValid < validSkip + pageSize) {
      const listResult = await KV_BINDING.list({ cursor, limit: batchSize });

      // 过滤掉 banPath 中的路径
      const validKeys = listResult.keys.filter(key => !banPath.includes(key.name));

      // 如果已经跳过了足够的记录，开始收集数据
      if (processedValid + validKeys.length > validSkip) {
        const startIndex = validSkip - processedValid;
        for (let i = startIndex; i < validKeys.length && Object.keys(mappings).length < pageSize; i++) {
          const value = await KV_BINDING.get(validKeys[i].name, { type: "json" });
          mappings[validKeys[i].name] = value;
        }
      }

      processedValid += validKeys.length;
      cursor = listResult.cursor;

      if (!cursor) break;
    }
  }

  return {
    mappings,
    total: count,
    page,
    pageSize,
    totalPages: Math.ceil(count / pageSize)
  };
}

async function createMapping(path, target, name, expiry, enabled = true, isWechat = false, qrCodeData = null) {
  if (!path || !target || typeof path !== 'string' || typeof target !== 'string') {
    throw new Error('Invalid input');
  }

  // 检查短链名是否在禁用列表中
  if (banPath.includes(path)) {
    throw new Error('该短链名已被系统保留，请使用其他名称');
  }

  if (expiry && isNaN(Date.parse(expiry))) {
    throw new Error('Invalid expiry date');
  }

  // 如果是微信二维码，必须提供二维码数据
  if (isWechat && !qrCodeData) {
    throw new Error('微信二维码必须提供原始二维码数据');
  }

  const mapping = {
    target,
    name: name || null,
    expiry: expiry || null,
    enabled: enabled,
    isWechat: isWechat,
    qrCodeData: qrCodeData
  };

  await KV_BINDING.put(path, JSON.stringify(mapping));
  await updateTotalCount(1);
}

async function deleteMapping(path) {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid input');
  }

  // 检查是否在禁用列表中
  if (banPath.includes(path)) {
    throw new Error('系统保留的短链名无法删除');
  }

  await KV_BINDING.delete(path);
  await updateTotalCount(-1);
}

async function updateMapping(originalPath, newPath, target, name, expiry, enabled = true, isWechat = false, qrCodeData = null) {
  if (!originalPath || !newPath || !target) {
    throw new Error('Invalid input');
  }

  // 检查新短链名是否在禁用列表中
  if (banPath.includes(newPath)) {
    throw new Error('该短链名已被系统保留，请使用其他名称');
  }

  if (expiry && isNaN(Date.parse(expiry))) {
    throw new Error('Invalid expiry date');
  }

  // 如果是微信二维码，必须提供二维码数据
  if (isWechat && !qrCodeData) {
    throw new Error('微信二维码必须提供原始二维码数据');
  }

  if (originalPath !== newPath) {
    await KV_BINDING.delete(originalPath);
  }

  const mapping = {
    target,
    name: name || null,
    expiry: expiry || null,
    enabled: enabled,
    isWechat: isWechat,
    qrCodeData: qrCodeData
  };

  await KV_BINDING.put(newPath, JSON.stringify(mapping));
  await updateTotalCount(1);
}

async function getExpiringMappings() {
  const mappings = {
    expiring: [],  // 2天内过期
    expired: []    // 已过期
  };
  let cursor = null;
  const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const now = new Date();

  do {
    const listResult = await KV_BINDING.list({ cursor, limit: 1000 });

    for (const key of listResult.keys) {
      const mapping = await KV_BINDING.get(key.name, { type: "json" });
      if (mapping && mapping.expiry) {
        const expiryDate = new Date(mapping.expiry);
        const mappingInfo = {
          path: key.name,
          name: mapping.name,
          target: mapping.target,
          expiry: mapping.expiry
        };

        if (expiryDate < now) {
          mappings.expired.push(mappingInfo);
        } else if (expiryDate <= twoDaysFromNow) {
          mappings.expiring.push(mappingInfo);
        }
      }
    }

    cursor = listResult.cursor;
  } while (cursor);

  return mappings;
}

// 在创建、更新、删除操作后更新总数缓存
async function updateTotalCount(change = 0) {
  const TOTAL_COUNT_KEY = "__total_count";
  try {
    const currentCount = await KV_BINDING.get(TOTAL_COUNT_KEY, { type: "json" });
    if (currentCount !== null) {
      await KV_BINDING.put(TOTAL_COUNT_KEY, JSON.stringify(currentCount + change));
    }
  } catch (e) {
    // 如果缓存不存在或出错，忽略更新
  }
}

export default {
  async fetch(request, env) {
    KV_BINDING = env.KV_BINDING;
    const url = new URL(request.url);
    const path = url.pathname.slice(1);

    // 根目录跳转到 管理后台
    if (path === '') {
      return Response.redirect(url.origin + '/admin.html', 302);
    }

    // API 路由处理
    if (path.startsWith('api/')) {
      // 登录 API
      if (path === 'api/login' && request.method === 'POST') {
        const { password } = await request.json();
        if (password === env.PASSWORD) {
          return new Response(JSON.stringify({ success: true }), {
            headers: setAuthCookie(password)
          });
        }
        return new Response('Unauthorized', { status: 401 });
      }

      // 登出 API
      if (path === 'api/logout' && request.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), {
          headers: clearAuthCookie()
        });
      }

      // 需要认证的 API
      if (!verifyAuthCookie(request, env)) {
        return new Response('Unauthorized', { status: 401 });
      }

      try {
        // 获取即将过期和已过期的映射
        if (path === 'api/expiring-mappings') {
          const result = await getExpiringMappings();
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 获取映射列表
        if (path === 'api/mappings') {
          const params = new URLSearchParams(url.search);
          const page = parseInt(params.get('page')) || 1;
          const pageSize = parseInt(params.get('pageSize')) || 10;

          const result = await listMappings(page, pageSize);
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 映射管理 API
        if (path === 'api/mapping') {
          // 创建映射
          if (request.method === 'POST') {
            const data = await request.json();
            await createMapping(data.path, data.target, data.name, data.expiry, data.enabled, data.isWechat, data.qrCodeData);
            return new Response(JSON.stringify({ success: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }

          // 更新映射
          if (request.method === 'PUT') {
            const data = await request.json();
            await updateMapping(
              data.originalPath,
              data.path,
              data.target,
              data.name,
              data.expiry,
              data.enabled,
              data.isWechat,
              data.qrCodeData
            );
            return new Response(JSON.stringify({ success: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }

          // 删除映射
          if (request.method === 'DELETE') {
            const { path } = await request.json();
            await deleteMapping(path);
            return new Response(JSON.stringify({ success: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        return new Response('Not Found', { status: 404 });
      } catch (error) {
        console.error('API operation error:', error);
        return new Response(JSON.stringify({
          error: error.message || 'Internal Server Error'
        }), {
          status: error.message === 'Invalid input' ? 400 : 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // URL 重定向处理
    if (path) {
      try {
        const mapping = await KV_BINDING.get(path, { type: "json" });
        if (mapping) {
          // 检查是否启用
          if (!mapping.enabled) {
            return new Response('Not Found', { status: 404 });
          }

          // 检查是否过期
          if (mapping.expiry && new Date(mapping.expiry) < new Date()) {
            await KV_BINDING.delete(path);
            return new Response('Not Found', { status: 404 });
          }

          // 如果是微信二维码，返回活码页面
          if (mapping.isWechat && mapping.qrCodeData) {
            const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>微信群二维码</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            min-height: 100vh;
            display: flex;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .container {
            margin: auto;
            width: 100%;
            border-radius: 0;
        }
        .title {
            font-size: 18px;
            margin: 0 0 12px;
            color: #333;
        }
        .qr-code {
            width: 100%;
            max-width: 240px;
            margin: 16px 0;
        }
        .notice {
            font-size: 14px;
            color: #666;
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1 class="title">微信群二维码</h1>
        <p class="notice">请长按下方二维码图片<br>选择"前往图中包含的群聊"来加入群聊</p>
        <img class="qr-code" src="${mapping.qrCodeData}" alt="微信群二维码">
        <p class="notice">二维码失效请联系群主</p>
    </div>
</body>
</html>`;
            return new Response(html, {
              headers: {
                'Content-Type': 'text/html;charset=UTF-8',
                'Cache-Control': 'no-store'
              }
            });
          }

          // 如果不是微信二维码，执行普通重定向
          return Response.redirect(mapping.target, 302);
        }
        return new Response('Not Found', { status: 404 });
      } catch (error) {
        console.error('Redirect error:', error);
        return new Response('Internal Server Error', { status: 500 });
      }
    }
  },

  async scheduled(controller, env, ctx) {
    KV_BINDING = env.KV_BINDING;
    const result = await getExpiringMappings();

    console.log(`Cron job report: Found ${result.expired.length} expired mappings`);
    if (result.expired.length > 0) {
      console.log('Expired mappings:', JSON.stringify(result.expired, null, 2));
    }

    console.log(`Found ${result.expiring.length} mappings expiring in 2 days`);
    if (result.expiring.length > 0) {
      console.log('Expiring soon mappings:', JSON.stringify(result.expiring, null, 2));
    }
  },

};
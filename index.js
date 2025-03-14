let KV_BINDING;
const banPath = [
  'login', 'admin',
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
  const mappings = {};
  let cursor = null;
  let count = 0;

  const skip = (page - 1) * pageSize;

  do {
    const listResult = await KV_BINDING.list({ cursor, limit: 1000 });

    for (const key of listResult.keys) {
      if (count >= skip && Object.keys(mappings).length < pageSize) {
        const value = await KV_BINDING.get(key.name, { type: "json" });
        mappings[key.name] = value;
      }
      count++;
    }

    cursor = listResult.cursor;
  } while (cursor && Object.keys(mappings).length < pageSize);

  return {
    mappings,
    total: count,
    page,
    pageSize,
    totalPages: Math.ceil(count / pageSize)
  };
}

async function createMapping(path, target, name, expiry) {
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

  const mapping = {
    target,
    name: name || null,
    expiry: expiry || null
  };

  await KV_BINDING.put(path, JSON.stringify(mapping));
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
}

async function updateMapping(originalPath, newPath, target, name, expiry) {
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

  if (originalPath !== newPath) {
    await KV_BINDING.delete(originalPath);
  }

  const mapping = {
    target,
    name: name || null,
    expiry: expiry || null
  };

  await KV_BINDING.put(newPath, JSON.stringify(mapping));
}

export default {
  async fetch(request, env) {
    KV_BINDING = env.KV_BINDING;
    const url = new URL(request.url);
    const path = url.pathname.slice(1);

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
            await createMapping(data.path, data.target, data.name, data.expiry);
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
              data.expiry
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
    try {
      const mapping = await KV_BINDING.get(path, { type: "json" });
      if (mapping) {
        // 检查是否过期
        if (mapping.expiry && new Date(mapping.expiry) < new Date()) {
          await KV_BINDING.delete(path);
          return new Response('Not Found', { status: 404 });
        }
        return Response.redirect(mapping.target, 302);
      }
      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Redirect error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};
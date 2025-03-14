import ADMIN_HTML from "./admin.html";
import LOGIN_HTML from "./login.html";

let KV_BINDING;

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

  // 计算需要跳过的记录数
  const skip = (page - 1) * pageSize;

  do {
    // 使用 cursor 进行分页查询
    const listResult = await KV_BINDING.list({ cursor, limit: 1000 });

    // 处理当前批次的键
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

  // // 验证 URL 格式
  // try {
  //   new URL(target);
  // } catch (e) {
  //   throw new Error('Invalid target URL');
  // }

  // 验证过期时间格式
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
  await KV_BINDING.delete(path);
}

// 添加更新映射的函数
async function updateMapping(originalPath, newPath, target, name, expiry) {
  if (!originalPath || !newPath || !target) {
    throw new Error('Invalid input');
  }

  // // 验证 URL 格式
  // try {
  //   new URL(target);
  // } catch (e) {
  //   throw new Error('Invalid target URL');
  // }

  // 验证过期时间格式
  if (expiry && isNaN(Date.parse(expiry))) {
    throw new Error('Invalid expiry date');
  }

  // 如果路径发生变化，需要删除旧的映射
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

    // 基础路由处理
    if (!path) {
      return Response.redirect(`${url.origin}/login`, 302);
    }

    if (path === 'wechat.svg') {
      return new Response(
        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M15.85 8.14c.39 0 .77.03 1.14.08C16.31 5.25 13.19 3 9.44 3c-4.25 0-7.7 2.88-7.7 6.43c0 2.05 1.15 3.86 2.94 5.04L3.67 16.5l2.76-1.19c.59.21 1.21.38 1.87.47c-.09-.39-.14-.79-.14-1.21c-.01-3.54 3.44-6.43 7.69-6.43M12 5.89a.96.96 0 1 1 0 1.92a.96.96 0 0 1 0-1.92M6.87 7.82a.96.96 0 1 1 0-1.92a.96.96 0 0 1 0 1.92"/><path fill="currentColor" d="M22.26 14.57c0-2.84-2.87-5.14-6.41-5.14s-6.41 2.3-6.41 5.14s2.87 5.14 6.41 5.14c.58 0 1.14-.08 1.67-.2L20.98 21l-1.2-2.4c1.5-.94 2.48-2.38 2.48-4.03m-8.34-.32a.96.96 0 1 1 .96-.96c.01.53-.43.96-.96.96m3.85 0a.96.96 0 1 1 0-1.92a.96.96 0 0 1 0 1.92"/></svg>`
        , {
          headers: { 'Content-Type': 'image/svg+xml' }
        });
    }

    if (path === 'login') {
      return new Response(LOGIN_HTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // 管理后台路由处理
    if (path.startsWith('admin')) {

      // 无需认证的 API
      if (path === 'admin/login' && request.method === 'POST') {
        const { password } = await request.json();
        if (password === env.PASSWORD) {
          return new Response(JSON.stringify({ success: true }), {
            headers: setAuthCookie(password)
          });
        }
        return new Response('Unauthorized', { status: 401 });
      }

      if (path === 'admin/logout' && request.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), {
          headers: clearAuthCookie()
        });
      }

      // 需要认证的路由
      if (!verifyAuthCookie(request, env)) {
        return Response.redirect(`${url.origin}/login`, 302);
      }

      try {
        // 管理页面
        if (path === 'admin') {
          return new Response(ADMIN_HTML, {
            headers: { 'Content-Type': 'text/html' }
          });
        }

        // 映射列表
        if (path === 'admin/mappings') {
          const params = new URLSearchParams(url.search);
          const page = parseInt(params.get('page')) || 1;
          const pageSize = parseInt(params.get('pageSize')) || 10;

          try {
            const result = await listMappings(page, pageSize);
            return new Response(JSON.stringify(result), {
              headers: { 'Content-Type': 'application/json' }
            });
          } catch (error) {
            console.error('List mappings error:', error);
            return new Response(JSON.stringify({
              error: 'Failed to fetch mappings'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        // 映射管理
        if (path === 'admin/mapping') {
          if (request.method === 'POST') {
            try {
              const data = await request.json();
              await createMapping(data.path, data.target, data.name, data.expiry);
              return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json' }
              });
            } catch (error) {
              console.error('Create mapping error:', error);
              return new Response(JSON.stringify({
                error: error.message || 'Invalid input'
              }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }

          if (request.method === 'PUT') {
            try {
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
            } catch (error) {
              console.error('Update mapping error:', error);
              return new Response(JSON.stringify({
                error: error.message || 'Invalid input'
              }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          }

          if (request.method === 'DELETE') {
            const { path } = await request.json();
            await deleteMapping(path);
            return new Response('OK');
          }
        }

        return new Response('Not Found', { status: 404 });
      } catch (error) {
        console.error('Admin operation error:', error);
        if (error.message === 'Invalid input') {
          return new Response(error.message, { status: 400 });
        }
        return new Response('Internal Server Error', { status: 500 });
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
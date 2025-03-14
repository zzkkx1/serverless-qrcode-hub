let KV_BINDING;

// 验证 cookie 的函数
function verifyAuthCookie(request, env) {
    const cookie = request.headers.get('Cookie') || '';
    const authToken = cookie.split(';').find(c => c.trim().startsWith('auth_token='));
    if (!authToken) return false;

    const token = authToken.split('=')[1].trim();
    return token === env.PASSWORD;
}

// 设置 cookie 的函数
function setAuthCookie(password) {
    return {
        'Set-Cookie': `auth_token=${password}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
        'Content-Type': 'application/json'
    };
}

// 清除 cookie 的函数
function clearAuthCookie() {
    return {
        'Set-Cookie': 'auth_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
        'Content-Type': 'application/json'
    };
}

export default {
    async fetch(request, env) {
        KV_BINDING = env.KV_BINDING;
        const url = new URL(request.url);
        const path = url.pathname.slice(1);

        // 处理根路径访问
        if (!path) {
            return Response.redirect(`${url.origin}/login`, 302);
        }

        // 处理登录页面
        if (path === 'login') {
            return new Response(LOGIN_HTML, {
                headers: { 'Content-Type': 'text/html' }
            });
        }

        // 处理后台相关请求
        if (path.startsWith('admin')) {
            // 处理登录请求
            if (path === 'admin/login' && request.method === 'POST') {
                const { password } = await request.json();
                if (password === env.PASSWORD) {
                    return new Response(JSON.stringify({ success: true }), {
                        headers: setAuthCookie(password)
                    });
                }
                return new Response('Unauthorized', { status: 401 });
            }

            // 处理登出请求
            if (path === 'admin/logout' && request.method === 'POST') {
                return new Response(JSON.stringify({ success: true }), {
                    headers: clearAuthCookie()
                });
            }

            // 验证其他管理请求的认证状态
            if (!verifyAuthCookie(request, env)) {
                if (path === 'admin') {
                    return Response.redirect(`${url.origin}/login`, 302);
                }
                return new Response('Unauthorized', { status: 401 });
            }

            // 处理管理页面请求
            if (path === 'admin') {
                return new Response(ADMIN_HTML, {
                    headers: { 'Content-Type': 'text/html' }
                });
            }

            // 处理 URL 映射列表请求
            if (path === 'admin/mappings') {
                try {
                    const { keys } = await KV_BINDING.list();
                    const mappings = {};
                    for (const key of keys) {
                        mappings[key.name] = await KV_BINDING.get(key.name);
                    }
                    return new Response(JSON.stringify(mappings), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (error) {
                    console.error('Error listing mappings:', error);
                    return new Response('Internal Server Error', { status: 500 });
                }
            }

            // 处理 URL 映射管理请求
            if (path === 'admin/mapping') {
                if (request.method === 'POST') {
                    const { path, target } = await request.json();
                    if (!path || !target || typeof path !== 'string' || typeof target !== 'string') {
                        return new Response('Invalid input', { status: 400 });
                    }
                    await KV_BINDING.put(path, target);
                    return new Response('OK');
                }

                if (request.method === 'DELETE') {
                    const { path } = await request.json();
                    if (!path || typeof path !== 'string') {
                        return new Response('Invalid input', { status: 400 });
                    }
                    await KV_BINDING.delete(path);
                    return new Response('OK');
                }
            }

            return new Response('Not Found', { status: 404 });
        }

        // 处理 URL 重定向
        try {
            const target = await KV_BINDING.get(path);
            if (target) {
                return Response.redirect(target, 302);
            }
        } catch (error) {
            console.error('Error fetching URL mapping:', error);
            return new Response('Internal Server Error', { status: 500 });
        }

        return new Response('Not Found', { status: 404 });
    }
};

// ======================================

const LOGIN_HTML = `
<!DOCTYPE html>
<html>
<head>
    <title>登录</title>
    <meta charset="UTF-8">
    <style>
        body { 
            font-family: Arial, sans-serif; 
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #f5f5f5;
        }
        .login-container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            width: 300px;
        }
        h1 { margin-top: 0; }
        input {
            width: 100%;
            padding: 8px;
            margin: 8px 0;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
        }
        button {
            width: 100%;
            padding: 10px;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        button:hover { 
            background-color: #0056b3;
            transform: translateY(-1px);
            transition: all 0.2s ease;
        }
        .error { 
            color: #dc3545;
            display: none;
            margin-top: 10px;
            font-size: 0.9em;
            text-align: center;
        }
        .footer { 
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            text-align: center;
            color: #6c757d;
            font-size: 0.9em;
            width: 100%;
        }
        .footer a { 
            color: #007bff;
            text-decoration: none;
            transition: all 0.2s ease;
            padding: 2px 4px;
            border-radius: 4px;
            display: inline-block;
        }
        .footer a:hover { 
            text-decoration: none;
            background-color: #e7f1ff;
            color: #0056b3;
            transform: translateY(-1px);
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h1>登录</h1>
        <div>
            <input type="password" id="password" placeholder="请输入密码">
            <button onclick="login()">登录</button>
            <p id="error" class="error">密码错误</p>
        </div>
    </div>
    <div class="footer">
        <p>GitHub: <a href="https://github.com/xxnuo/serverless-qrcode-hub" target="_blank">xxnuo/serverless-qrcode-hub</a></p>
        <p>给我个 Star ⭐️ 吧</p>
    </div>

    <script>
        async function login() {
            const password = document.getElementById('password').value;
            const error = document.getElementById('error');
            
            try {
                const response = await fetch('/admin/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ password })
                });
                
                if (response.ok) {
                    window.location.href = '/admin';
                } else {
                    error.style.display = 'block';
                }
            } catch (e) {
                error.style.display = 'block';
            }
        }

        document.getElementById('password').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                login();
            }
        });
    </script>
</body>
</html>
`;

const ADMIN_HTML = `
<!DOCTYPE html>
<html>

<head>
    <title>管理面板</title>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 20px auto;
            padding: 0 20px;
        }

        .container {
            margin-top: 20px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th,
        td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }

        input[type="text"] {
            width: 100%;
            padding: 5px;
        }

        button {
            padding: 8px 16px;
            margin: 5px;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        button:hover {
            background-color: #0056b3;
            transform: translateY(-1px);
        }

        .qr-section {
            margin-top: 30px;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .logout {
            background-color: #dc3545;
        }

        .logout:hover {
            background-color: #c82333;
        }

        #qrcode-container {
            margin-top: 20px;
            text-align: center;
        }

        #qrcode {
            margin: 20px auto;
            max-width: 100%;
            height: auto;
        }

        .qr-controls {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }

        .qr-controls input {
            flex: 1;
        }

        .qr-options {
            margin-top: 15px;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }

        .qr-option {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .download-btn {
            background-color: #28a745;
        }

        .download-btn:hover {
            background-color: #218838;
        }

        .hidden {
            display: none;
        }
    </style>
</head>

<body>
    <div class="header">
        <h1>管理面板</h1>
        <button class="logout" id="logoutBtn">退出登录</button>
    </div>

    <div class="container">
        <h2>URL 映射管理</h2>
        <table id="urlTable">
            <tr>
                <th>短链接</th>
                <th>目标 URL</th>
                <th>操作</th>
            </tr>
            <tr>
                <td><input type="text" id="newPath" placeholder="例如: url1"></td>
                <td><input type="text" id="newTarget" placeholder="https://target.com/xxx"></td>
                <td><button id="addMappingBtn">添加</button></td>
            </tr>
        </table>
    </div>

    <div class="qr-section">
        <h2>URL 转二维码</h2>
        <div class="qr-controls">
            <input type="text" id="qrUrl" placeholder="输入要转换的 URL">
            <button id="generateQRBtn">生成二维码</button>
        </div>
        <div class="qr-options">
            <div class="qr-option">
                <label for="qr-size">尺寸:</label>
                <select id="qr-size">
                    <option value="300">300x300</option>
                    <option value="400" selected>400x400</option>
                    <option value="500">500x500</option>
                </select>
            </div>
            <div class="qr-option">
                <label for="qr-style">样式:</label>
                <select id="qr-style">
                    <option value="square">方形</option>
                    <option value="circle" selected>圆形</option>
                </select>
            </div>
            <div class="qr-option">
                <label for="qr-color">颜色:</label>
                <input type="color" id="qr-color" value="#000000">
            </div>
        </div>
        <div id="qrcode-container">
            <canvas id="qrcode"></canvas>
            <div>
                <button class="download-btn hidden" id="download-btn">下载二维码</button>
            </div>
        </div>
    </div>

    <script type="text/javascript" src="https://qrcode.cdn.mcpport.com/qrcode.iife.js"></script>
    <script>
            document.addEventListener('DOMContentLoaded', function () {
                var QRCode = window.QRCode.default;
                var currentQRCode = null;

                // 绑定事件监听器
                document.getElementById('generateQRBtn').addEventListener('click', generateQR);
                document.getElementById('download-btn').addEventListener('click', downloadQR);
                document.getElementById('logoutBtn').addEventListener('click', logout);
                document.getElementById('addMappingBtn').addEventListener('click', addMapping);

                // 函数定义
                async function addMapping() {
                    const path = document.getElementById('newPath').value;
                    const target = document.getElementById('newTarget').value;

                    const response = await fetch('/admin/mapping', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path, target })
                    });

                    if (response.status === 401) {
                        window.location.href = '/login';
                        return;
                    }

                    if (response.ok) {
                        location.reload();
                    }
                }

                async function deleteMapping(path) {
                    const response = await fetch('/admin/mapping', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path })
                    });

                    if (response.status === 401) {
                        window.location.href = '/login';
                        return;
                    }

                    if (response.ok) {
                        location.reload();
                    }
                }

                function generateQR() {
                    const url = document.getElementById('qrUrl').value;
                    if (!url) {
                        alert('请输入 URL');
                        return;
                    }

                    const size = parseInt(document.getElementById('qr-size').value);
                    const style = document.getElementById('qr-style').value;
                    const color = document.getElementById('qr-color').value;
                    
                    const canvas = document.getElementById('qrcode');
                    
                    currentQRCode = QRCode.generate({
                        data: url,
                        width: size,
                        height: size,
                        type: 'canvas',
                        shape: style,
                        dotsOptions: {
                            color: color,
                            type: style === 'circle' ? 'rounded' : 'square'
                        },
                        backgroundOptions: {
                            color: "#ffffff"
                        },
                        cornersSquareOptions: {
                            type: style === 'circle' ? 'extra-rounded' : 'square',
                            color: color
                        },
                        cornersDotOptions: {
                            type: style === 'circle' ? 'dot' : 'square',
                            color: color
                        }
                    }, canvas);

                    document.getElementById('download-btn').classList.remove('hidden');
                }

                async function downloadQR() {
                    if (!currentQRCode) return;
                    
                    const fileName = new Date().toISOString()
                        .replace(/[:.]/g, '-')
                        .replace('T', '_')
                        .replace('Z', '');
                        
                    await QRCode.download(currentQRCode, {
                        name: 'qr-' + fileName,
                        extension: 'png'
                    });
                }

                function logout() {
                    fetch('/admin/logout', { method: 'POST' }).then(() => {
                        window.location.href = '/login';
                    });
                }

                // 加载现有映射
                async function loadMappings() {
                    const response = await fetch('/admin/mappings');

                    if (response.status === 401) {
                        window.location.href = '/login';
                        return;
                    }

                    if (response.ok) {
                        const mappings = await response.json();
                        const table = document.getElementById('urlTable');
                        for (const [path, target] of Object.entries(mappings)) {
                            const row = table.insertRow(1);
                            row.insertCell(0).textContent = path;
                            row.insertCell(1).textContent = target;
                            const deleteButton = document.createElement('button');
                            deleteButton.textContent = '删除';
                            deleteButton.onclick = () => deleteMapping(path);
                            row.insertCell(2).appendChild(deleteButton);
                        }
                    }
                }

                // 初始加载
                loadMappings();
            });
    </script>
</body>

</html>

`;


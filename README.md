# serverless-qrcode-hub

苦于微信群聊二维码频繁变动，开发这个能生成永久二维码的工具，不需要服务器。基于 Cloudflare Workers 和 KV 存储实现。

> 部署方面未完善！等待后续更新，大佬可以自己克隆部署

## 功能特性

- 🔗 生成永久短链接，指向微信群二维码
- 🎨 自定义二维码样式和 Logo
- 💻 管理后台可随时更新
- 🔐 密码保护
- 😋 可当短链接生成器
- ☁️ 无需服务器

## 预览图

- 登录
  ![preview-login](./images/preview-login.png)
- 管理后台
  ![preview-admin](./images/preview-admin.png)
- 生成二维码
  ![preview-qr](./images/preview-qr.png)

## 使用步骤

- Fork 仓库
- 创建 KV 命名空间
- 创建 Worker
- 绑定 KV 命名空间 KV_BINDING
- 创建环境变量 PASSWORD (英文大小写字母和数字，尽量长点复杂点，建议使用小写的 uuid 字符串)
- 绑定自定义域名

### 参考截图

**步骤不需要和我这个完全一致，只要能部署成功就行。我这里有一些错误，请忽略。**

1. Fork 本项目
   ![fork](./images/fork.png)
2. 创建 KV 命名空间
   ![create kv](./images/create-kv.png)
3. 创建 Worker
   ![create worker](./images/create-worker.png)
4. 选择你 Fork 的项目
   ![select fork](./images/create-worker2.png)
5. 修改构建配置
   ![build config](./images/create-worker3.png)
6. 绑定 KV 命名空间 KV_BINDING
   ![bind kv](./images/bind-kv.png)
7. 点击保存版本
   ![save](./images/save.png)
8. 创建环境变量 PASSWORD，注意格式是英文大小写字母、数字或者符号，尽量搞复杂点
   ![create env](./images/create-env.png)
9. 点击保存版本
   ![save](./images/save.png)
10. 最终效果
    ![final](./images/final.png)
11. 回到部署页，点击 `您的上一次构建失败。查看构建` 然后点击 `重试构建`
12. 部署成功
13. 绑定自定义域名
    ![bind domain](./images/domain.png)

## TODO

- [ ] 实现定时检查过期短链功能
  - [x] 自动检查过期的短链接
  - [ ] 发送邮件通知管理员
  - [x] 自动清理过期数据
- [ ] 添加访问统计功能
- [ ] 支持批量导入导出
- [ ] 支持多租户
- [ ] 支持多语言
- [ ] 支持多 Serverless 平台
- [ ] 手机端快捷更新二维码功能

欢迎提交 Issue 和 Pull Request！

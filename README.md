<h1><center>京东发票自动下载</center></h1>

![图片](./screenshot.png)

## 使用方法

### 项目下载

`git clone git@github.com:mydaoyuan/jd-invoice.git` 下载项目代码. 

`cd jd-invoice && npm i` 进入目录, 安装依赖.


### 启动项目

❗️**如果需要进行换开发票, 请修改 `src/config.js` 配置, 填入换开的公司名称和税号.** 

```
companyName: '', // 需要换开的公司名
companyTaxNo: '', // 需要换开的税号
pageNum: 1, // 发票列表初始页码
maxPageNo: 1, // 最大页码 为 1 时不进行检测
```

`npm run start` 进行自动化下载. 随后发票文件会自动下载到 `src/file` 目录下. 🎉

❗️ 第一次使用需要进行扫码登录.

Mac 下会自动打开登录图片, 如果不能自动打开, 请在命令执行后, 手动打开目录下的 login.png, 使用京东 APP 扫码登录. 后续会将 `cookie` 保存在**本地使用**.✅



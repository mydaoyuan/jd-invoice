import path from 'path'
import fs from 'fs'
import https from 'https'
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'
import queryString from 'query-string'
import config from './config'
import {
  sleep,
  restTime,
  setCookie,
  saveCookie,
  existsInvoice,
  ensureDirectoryExists,
} from './utils'

// 发票列表页
const targetUrl = 'https://myivc.jd.com/fpzz/index.action'
const getDefaultOsPath = () => {
  if (process.platform === 'win32') {
    return 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  } else {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  }
}

let pageNum = config.pageNum
const maxPageNo = config.maxPageNo
let browser
let page

async function init() {
  await ensureDirectoryExists(path.resolve(process.cwd(), '../file'))
  browser = await puppeteer.launch({
    headless: false,
    defaultViewport: {
      width: 1440,
      height: 800,
    },
    // executablePath: chromiumExecutablePath,
    // executablePath: puppeteer.executablePath(),
    executablePath: getDefaultOsPath(),
  })
  page = await browser.newPage()
  if (fs.existsSync(path.resolve(process.cwd(), './cookies.json'))) {
    await setCookie(page)
  }
}
async function start() {
  await init()

  console.log(` 💾 发票保存路径 ${path.resolve(process.cwd())}/file`)

  await page.goto(targetUrl)
  let currentURL = await page.url()
  if (currentURL !== targetUrl) {
    console.log(' ❌ 未登录, 需要登录')
    await login()
  }
  while (currentURL !== targetUrl) {
    currentURL = await page.url()
    await sleep(2000)
  }
  // 登录处理
  console.log(' ✅ 登录成功')
  if (!fs.existsSync(path.resolve(process.cwd(), './cookies.json')))
    await saveCookie(page)
  if (pageNum > 1) {
    await jumpPage(pageNum)
  }
  await downloadNextPage()
}

// 下载一页 递归加载
async function downloadNextPage() {
  await page.waitForSelector('.operate a')
  const tableBody = await page.$$('.order-tb tbody')
  // 获取订单号
  const orderNumList = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll('.order-tb .tr-th .number')
    ).map((el) => el.innerText.match(/(\d)+/)[0])
  })
  // 获取订单状态信息
  const statusList = await Promise.all(
    tableBody.map(async (row) => {
      return await row.evaluate((el) => {
        let ele = el.querySelector('td:nth-child(3)')
        if (!ele) {
          ele = el.querySelector('td:nth-child(2)')
          return ele.innerText
        }
        return ele.innerText
      })
    })
  )
  const rowList = orderNumList.map((orderId, index) => {
    return { row: tableBody[index], orderId, status: statusList[index], index }
  })
  const pageText = await page.evaluate(
    () => document.querySelector('.ui-page-curr').innerText
  )
  console.log(` 📗 当前页码${pageText}`)
  console.table(
    rowList.map(({ orderId, status }) => {
      return { 单号: orderId, 状态: status }
    })
  )

  /**
   * 两种情况: 换开\无法开票
   * 其中换开需要判断发票是否是个人. 如果是个人,就进行换开,否则进行发票下载
   */
  for (let index = 0; index < rowList.length; index++) {
    const item = rowList[index]
    const { orderId, row, status } = item
    const isDownloadComplete = existsInvoice(orderId)
    if (isDownloadComplete) continue
    if (status === '已开票') {
      await downInvoice(item)
    } else if (status === '未开票') {
      const text = await row.evaluate(
        (el) => el.querySelector('.operate a').innerText
      )
      if (text === '发票申请') {
        // 开具发票
        console.log(' ⭕️ 进行发票申请', orderId)
      } else {
        // 无法开具发票
        console.log(' ❌ 无法开具发票', orderId)
      }
    }
  }

  await sleep(3000)

  // 还有下一页的话
  if ((await page.$('.ui-pager-next')) !== null) {
    pageNum++
    if (pageNum > maxPageNo && maxPageNo != 1) {
      console.log(` ⏹ 达到最大页码 ${pageNum} , 停止下载`)
      return
    }
    await jumpPage(pageNum)
    await downloadNextPage()
  }
}

async function downInvoice(item) {
  const { row, orderId } = item
  // 如果是发票详情就访问并且下载发票至 file 目录
  // urlLinkHash{'发票详情' , '换开申请', '该订单暂不支持发票开具业务'}
  await restTime()

  const urlLinkHash = await row.evaluate((el) => {
    const hash = {}
    Array.from(el.querySelectorAll('.operate a')).map((i) => {
      hash[i.innerText] = i.href
    })
    return hash
  })
  if (!urlLinkHash['发票详情']) return
  const needChange = await needChangeSubject(urlLinkHash['发票详情'])
  if (needChange && config.companyName && config.companyTaxNo) {
    // 监听新打开的页面
    const newPagePromise = new Promise((resolve) => page.once('popup', resolve))
    // 点击按钮打开新页面
    await row.evaluate((el) => {
      el.querySelector('.operate a').click()
    })
    // 获取新打开的页面
    const newPage = await newPagePromise
    console.log(` 🔄 开始[换开] ${orderId} 发票`)
    await changeInvoice(newPage)
    return
  } else {
    await download(urlLinkHash['发票详情'])
    await restTime()
  }
}

/**
 *
 * @param {发票详情地址} url
 * @returns 是否需要进行换开发票
 */
async function needChangeSubject(url) {
  const popupPage = await browser.newPage()
  await popupPage.goto(url)
  // 获取当前发票抬头	 个人/企业
  const query =
    '.invoice-detail .tb-void:nth-child(2) tr:nth-child(3) td:nth-child(2)'
  await popupPage.waitForSelector(query)

  const text = await popupPage.evaluate(
    () =>
      document.querySelector(
        '.invoice-detail .tb-void:nth-child(2) tr:nth-child(3) td:nth-child(2)'
      ).innerText
  )
  // 进行换开
  if (text === '个人') {
    popupPage.close()
    return true
  }
  popupPage.close()
}

async function changeInvoice(popupPage) {
  const query = '#ivcTitleType'
  try {
    await popupPage.waitForSelector(query)
    await popupPage.waitForSelector('#ivcContentSpan100', { idleTime: 1000 })
    // 选择类别
    await popupPage.click('#ivcContentSpan100')

    // 选择单位
    // const select = await popupPage.$('select#ivcTitleType')
    await popupPage.select('select#ivcTitleType', '5')
    await sleep(100)
    // 输入单位
    await popupPage.type('input#company', config.companyName)
    await popupPage.type('input#taxNo', config.companyTaxNo)
    await restTime()
    // 提交
    await popupPage.click('.invoice-main .form.mt10:last-child a:first-child', {
      delay: 100,
    })
  } catch (error) {
    console.log('无法直接换开')
  }
  await restTime()
  popupPage.close()
}

async function download(url) {
  if (url.indexOf('orderId') > 0) {
    // 通过当前链接 的 orderId 来命名发票 名称 TODO 优化命名
    const { query } = queryString.parseUrl(url)
    const invoicePath = `../file/${query.orderId}.pdf`
    const filename = path.resolve(process.cwd(), invoicePath)
    const popupPage = await browser.newPage()
    await popupPage.goto(url)
    try {
      await popupPage.waitForSelector('.download-trigger', {
        timeout: 2000,
      })
      const href = await popupPage.$eval('.download-trigger', (el) => el.href)

      // 获取发票的下载链接
      const file = fs.createWriteStream(filename)
      console.log(` ⬇️ 开始下载 ${query.orderId} 发票`)

      // 开始下载
      https.get(href, (response) => {
        response.pipe(file)
        file.on('finish', () => {
          console.log(` ✅ 发票  ${invoicePath} 下载完成`)
          file.close()
        })
      })
    } catch (e) {
      console.log(
        ` ❌ ${query.orderId} 下载发票失败, 或许是退货订单, 请手动下载.`
      )
    }

    await popupPage.close()
  }
}

async function jumpPage(pageNum) {
  await page.waitForSelector('#page')
  await page.evaluate(`jQuery('#page').val('${pageNum}')
      document.getElementById('indexForm').submit()`)
}

async function login() {
  page.on('response', async (response) => {
    const url = response.url()
    if (url.indexOf('qr.m.jd.com') > 0 && queryString.parseUrl(url).query.t) {
      const buffer = await response.buffer()
      const filePath = './login.png'
      fs.writeFileSync(filePath, buffer)
      spawn('open', [filePath])
    }
  })
  await page.reload({
    waitUntil: 'networkidle0',
  })
}

start()

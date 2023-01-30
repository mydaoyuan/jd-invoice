import fs from 'fs'
import path from 'path'
import util from 'util'

const stat = util.promisify(fs.stat)
const mkdir = util.promisify(fs.mkdir)
/**
 * @param int ms
 * @returns {Promise<any>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function restTime() {
  const time = Math.random() * 1000 + 500
  await sleep(time)
}

export async function setCookie(page) {
  const cookies = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, './cookies.json'), 'utf-8')
  )
  for (const cookie of cookies) {
    await page.setCookie(cookie)
  }
}

export async function saveCookie(page) {
  const cookies = await page.cookies()

  fs.writeFileSync(
    path.resolve(__dirname, './cookies.json'),
    JSON.stringify(cookies)
  )
}

export function existsInvoice(orderId) {
  const invoicePath = `../file/${orderId}.pdf`
  const filename = path.resolve(__dirname, invoicePath)
  if (fs.existsSync(filename)) {
    // 如果发票 已经存在，就不需要重复下载
    console.log(` ✅ 发票  ${orderId} 已经存在,跳过下载`)

    return true
  }
}

export async function ensureDirectoryExists(directory) {
  try {
    // 判断文件夹是否存在
    await stat(directory)
  } catch (err) {
    // 如果文件夹不存在，则创建文件夹
    if (err.code === 'ENOENT') {
      await mkdir(directory)
    } else {
      console.error(err)
    }
  }
}

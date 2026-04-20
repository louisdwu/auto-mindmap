import { defineManifest } from '@crxjs/vite-plugin'
import packageJson from './package.json'

const { version } = packageJson
const [major, minor] = version.replace(/[^\d.-]+/g, '').split(/[.-]/)

// 生成基于日期的动态版本号：major.minor.MMDD.HHMM
const now = new Date()
const mmdd = (now.getMonth() + 1) * 100 + now.getDate()
const hhmm = now.getHours() * 100 + now.getMinutes()

export default defineManifest({
  name: '自动思维导图',
  description: '自动使用视频字幕并生成思维导图',
  version: `${major}.${minor}.${mmdd}.${hhmm}`,
  manifest_version: 3,
  permissions: [
    'storage',
    'activeTab',
    'scripting',
    'downloads'
  ],
  host_permissions: [
    'https://*.bilibili.com/*',
    'https://www.youtube.com/*',
    'https://api.bilibili.com/*',
    'https://api.xiaomimimo.com/*',
    "<all_urls>"
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  content_scripts: [
    {
      matches: [
        'https://*.bilibili.com/*',
        'https://www.youtube.com/*'
      ],
      js: ['src/content/index.ts'],
      run_at: 'document_idle'
    }
  ],
  web_accessible_resources: [
    {
      resources: ['src/content/youtubeInterceptor.js'],
      matches: ['https://www.youtube.com/*']
    }
  ],
  options_page: 'options.html',
  action: {
    default_title: '点击暂停/恢复自动思维导图',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png'
    }
  },
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
  }
})
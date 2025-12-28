import { defineManifest } from '@crxjs/vite-plugin'
import packageJson from './package.json'

const { version } = packageJson
const [major, minor, patch] = version.replace(/[^\d.-]+/g, '').split(/[.-]/)

export default defineManifest({
  name: '自动思维导图',
  description: '自动使用视频字幕并生成思维导图',
  version: `${major}.${minor}.${patch}`,
  manifest_version: 3,
  permissions: [
    'storage',
    'activeTab',
    'scripting',
    'downloads'
  ],
  host_permissions: [
    'https://*.bilibili.com/*',
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
      matches: ['https://*.bilibili.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle'
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
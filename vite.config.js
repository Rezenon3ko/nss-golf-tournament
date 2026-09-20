import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // index.html 里的 preconnect 需要项目地址；未配置时兜底为空串，
  // 避免产物里残留 %VITE_SUPABASE_URL% 占位符
  process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL || ''

  return {
    base: '/',
    plugins: [
      vue(),
      // devtools 只在开发时启用，不进入生产构建
      ...(mode === 'development' ? [vueDevTools()] : []),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})

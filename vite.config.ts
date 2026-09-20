import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,                 // 监听 0.0.0.0 + ::，IPv4/IPv6 双栈
    // 避免 CORS：开发期把 /api/* 转发到本地后端
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5180',
        changeOrigin: true,
      },
    },
  },
})

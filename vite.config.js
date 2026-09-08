import { defineConfig } from 'vite'

let base = process.env.PUBLIC_PATH || '/'

export default defineConfig({
  base,
})

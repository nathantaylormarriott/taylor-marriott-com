import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import netlify from '@netlify/vite-plugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('OPS_') || key === 'SAM_API_KEY') {
      if (!process.env[key]) process.env[key] = value
    }
  }

  return {
    plugins: [react(), netlify()],
  }
})

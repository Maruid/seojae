import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages 는 https://<id>.github.io/<repo>/ 아래에서 서빙되므로 base 경로가 필요
//   로컬: VITE_BASE 없음 → '/'
//   배포: deploy.yml 이 VITE_BASE=/seojae/ 로 빌드
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.VITE_BASE || '/',
    plugins: [tailwindcss()],
    server: { port: 5173 },
    build: { target: 'es2020' },
  };
});

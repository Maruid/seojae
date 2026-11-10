import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import crypto from 'node:crypto';

// 빌드 결과 파일 목록을 넣어 dist/sw.js 생성 (src/sw/sw.js 가 원본)
function serviceWorker() {
  return {
    name: 'seojae-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const pub = fs.readdirSync('public').filter((f) => !f.startsWith('.'));
      const list = [...new Set(['./', 'index.html', ...built, ...pub])].filter((f) => f !== 'sw.js');
      const version = crypto.createHash('sha1').update(JSON.stringify(built.sort())).digest('hex').slice(0, 10);
      const src = fs.readFileSync('src/sw/sw.js', 'utf8')
        .replace("const VERSION = '__VERSION__';", `const VERSION = ${JSON.stringify(version)};`)
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(list)};`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

// GitHub Pages 는 https://<id>.github.io/<repo>/ 아래에서 서빙되므로 base 경로가 필요
//   로컬: VITE_BASE 없음 → '/'
//   배포: deploy.yml 이 VITE_BASE=/seojae/ 로 빌드
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.VITE_BASE || '/',
    plugins: [tailwindcss(), serviceWorker()],
    server: { port: 5173 },
    build: { target: 'es2020' },
  };
});

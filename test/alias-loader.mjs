// 把 `@/…` 解析到 src/，并把 config / supabase 换成测试替身
import { existsSync } from 'node:fs'

const srcRoot = new URL('../src/', import.meta.url)
const overrides = {
  '@/config': new URL('./fixtures/config-stub.js', import.meta.url).href,
  '@/lib/supabase': new URL('./fixtures/supabase-stub.js', import.meta.url).href,
}

export function resolve(specifier, context, nextResolve) {
  if (overrides[specifier]) return { url: overrides[specifier], shortCircuit: true }
  if (specifier.startsWith('@/')) {
    const target = new URL(specifier.slice(2), srcRoot)
    const candidates = [target]
    // 模拟 Vite 的扩展名补全（源码里是 `@/lib/sync` 这种写法）
    if (!/\.[a-z]+$/i.test(target.pathname)) {
      candidates.push(
        new URL(`${target.pathname}.js`, target),
        new URL(`${target.pathname}/index.js`, target),
      )
    }
    const found = candidates.find((candidate) => existsSync(candidate))
    return {
      url: (found || target).href,
      shortCircuit: true,
    }
  }
  return nextResolve(specifier, context)
}

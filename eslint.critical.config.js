// 部署前强校验配置：只拦截"会让页面真正崩溃"的致命错误
// 其他 react-hooks 类 warning 不纳入此处，避免阻塞部署
// 如果这里报错，build 会直接失败，绝不会让坏代码部署到 Vercel
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [js.configs.recommended],
    plugins: {
      // 注册 react-hooks 插件 —— 即便规则都 off，也要先注册，
      // 否则代码里的 `eslint-disable-next-line react-hooks/xxx` 会被当成未知规则报错。
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    // 不对"未使用的 disable 注释"告警（业务代码里已有大量 hook disable 注释）
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      // 致命错误：使用了未定义的变量（比如 allTags is not defined 这类线上崩溃的直接元凶）
      'no-undef': 'error',
      // 严重语法/引用错误
      'no-undef-init': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      // 以下规则关闭，避免被既存代码卡住（保留给常规 `npm run lint`）
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'off',
      // react-hooks 相关规则一律关闭（critical 配置不负责风格 / hook 依赖告警），
      // 但必须显式列出，让 disable 注释不会被判定为"未知规则"。
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
])

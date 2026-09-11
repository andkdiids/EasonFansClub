import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

test('共享密码输入组件提供独立的显示/隐藏状态和可访问按钮', () => {
  const component = source('components/PasswordInput.tsx')
  const icons = source('components/UiIcon.tsx')

  assert.match(component, /Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>/)
  assert.match(component, /useState\(false\)/)
  assert.match(component, /type=\{isVisible \? 'text' : 'password'\}/)
  assert.match(component, /type="button"/)
  assert.match(component, /aria-label=\{toggleLabel\}/)
  assert.match(component, /title=\{toggleLabel\}/)
  assert.match(component, /name=\{isVisible \? 'eye-off' : 'eye'\}/)
  assert.match(component, /setIsVisible\(\(current\) => !current\)/)
  assert.match(icons, /aria-hidden="true"/)
  assert.match(icons, /eye-off/)
  assert.doesNotMatch(component, /(localStorage|sessionStorage|console\.log)/)
})

test('登录和注册页面复用密码输入组件并保留表单与自动填充行为', () => {
  const login = source('app/login/LoginForm.tsx')
  const register = source('app/register/RegisterForm.tsx')

  assert.match(login, /import \{ PasswordInput \} from '@\/components\/PasswordInput'/)
  assert.match(login, /<PasswordInput[\s\S]*id="login-password"[\s\S]*name="password"[\s\S]*autoComplete="current-password"/)
  assert.match(login, /new FormData\(form\)/)
  assert.match(login, /formData\.get\('password'\)/)

  assert.match(register, /import \{ PasswordInput \} from '@\/components\/PasswordInput'/)
  assert.equal((register.match(/<PasswordInput/g) || []).length, 2)
  assert.match(register, /value=\{form\.password\}[\s\S]*autoComplete="new-password"[\s\S]*data-register-field="password"/)
  assert.match(register, /value=\{form\.confirmPassword\}[\s\S]*autoComplete="new-password"[\s\S]*data-register-field="confirmPassword"/)
  assert.match(register, /updateField\('password', event\.target\.value\)/)
  assert.match(register, /updateField\('confirmPassword', event\.target\.value\)/)
})

test('密码按钮使用输入框内定位并为右侧图标预留空间', () => {
  const css = source('app/globals.css')

  assert.match(css, /\.password-input-shell \{[^}]*position:relative;[^}]*width:100%;/)
  assert.match(css, /\.password-input-field \{[^}]*padding-right:2\.75rem!important;/)
  assert.match(css, /\.password-input-toggle \{[^}]*top:50%;[^}]*right:\.65rem;[^}]*transform:translateY\(-50%\)/)
  assert.match(css, /\.password-input-toggle:focus-visible \{[^}]*outline:2px/)
  assert.match(css, /\.password-input-icon \{[^}]*width:1rem;[^}]*height:1rem;/)
})

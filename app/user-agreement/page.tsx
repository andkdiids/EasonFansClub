import Link from 'next/link'
import { AuthFormShell } from '@/components/AuthFormShell'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function UserAgreementPage() {
  const config = await getSiteAppearance()

  return (
    <AuthFormShell
      title="《私家E院用户协议》"
      subtitle="加入社区前，请阅读并理解以下约定"
      siteName={config.text.siteName}
      backgroundUrl={config.images.registerBackgroundUrl}
      logoUrl={config.images.navLogoUrl || config.images.logoUrl}
      pageClassName="register-auth-page"
      footer={
        <Link href="/register" className="font-black text-brand-700">
          返回注册页面
        </Link>
      }
    >
      <article className="space-y-5 text-sm leading-7 text-white/80">
        <p className="border-b border-white/10 pb-4 text-xs font-bold text-white/60">
          欢迎来到私家E院。使用本站服务，即表示你理解并同意遵守以下协议与社区管理规范。
        </p>

        <section className="border-b border-white/10 pb-4">
          <h2 className="text-base font-black text-white">1. 服务说明</h2>
          <p className="mt-2">私家E院为陈奕迅粉丝交流社区，提供音乐交流、社区互动及相关粉丝服务。</p>
        </section>

        <section className="border-b border-white/10 pb-4">
          <h2 className="text-base font-black text-white">2. 用户账号</h2>
          <p className="mt-2">用户负责账号及验证信息的安全，不得冒用他人身份注册、登录或使用本站服务。</p>
        </section>

        <section className="border-b border-white/10 pb-4">
          <h2 className="text-base font-black text-white">3. 社区规范</h2>
          <p className="mt-2">用户不得发布或传播以下内容：</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>恶意攻击、骚扰或人身伤害性内容</li>
            <li>垃圾信息、恶意刷屏或破坏社区秩序的内容</li>
            <li>色情内容</li>
            <li>违法或可能危害他人及公共安全的内容</li>
            <li>未经许可的商业广告或推广信息</li>
          </ul>
        </section>

        <section className="border-b border-white/10 pb-4">
          <h2 className="text-base font-black text-white">4. 内容版权</h2>
          <p className="mt-2">用户发布的文字、图片、音频及其他内容应保证来源合法，并承担相应的版权与法律责任。</p>
        </section>

        <section>
          <h2 className="text-base font-black text-white">5. 管理权限</h2>
          <p className="mt-2">管理员有权根据协议和社区规范，对违规内容进行删除、限制展示、限制账号功能等处理。</p>
        </section>
      </article>
    </AuthFormShell>
  )
}

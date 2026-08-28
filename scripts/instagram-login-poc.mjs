import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { chromium } from "playwright";

const LOGIN_URL = "https://www.instagram.com/accounts/login/";
const PROXY_URL = "http://127.0.0.1:7890";
const STATE_PATH = path.resolve(
  process.cwd(),
  "tmp",
  "instagram-login",
  "storageState.json",
);

for (const key of [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
]) {
  delete process.env[key];
}

function findChromeExecutable() {
  const candidates = [
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PROGRAMFILES &&
      path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] &&
      path.join(
        process.env["PROGRAMFILES(X86)"],
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
    process.env.PROGRAMFILES &&
      path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["PROGRAMFILES(X86)"] &&
      path.join(
        process.env["PROGRAMFILES(X86)"],
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe",
      ),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function isUnsafeLoginState(url) {
  return /\/(?:challenge|checkpoint)(?:\/|$)/i.test(url);
}

const executablePath = findChromeExecutable();
if (!executablePath) {
  throw new Error("未找到本机 Chrome 或 Edge；请先安装可见 Chromium 浏览器。");
}

fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });

const browser = await chromium.launch({
  headless: false,
  executablePath,
  proxy: { server: PROXY_URL },
});

const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(LOGIN_URL, {
    timeout: 20_000,
    waitUntil: "domcontentloaded",
  });

  console.log("已启动可见浏览器窗口。");
  console.log("代理：已配置（HTTP；127.0.0.1:7890）。");
  console.log("请只在浏览器窗口中手动完成 Instagram 登录和 2FA。");
  console.log("不要在此终端输入密码、验证码或恢复码。");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("登录完成且确认不在 challenge 页面后，回到此处按 Enter 保存 Session：");
  rl.close();

  const currentUrl = page.url();
  if (isUnsafeLoginState(currentUrl)) {
    console.error("检测到 challenge/checkpoint，未保存 Session。");
    process.exitCode = 2;
  } else if (/\/accounts\/login(?:\/|$)/i.test(new URL(currentUrl).pathname)) {
    console.error("仍停留在登录页，未保存 Session。");
    process.exitCode = 3;
  } else {
    await context.storageState({ path: STATE_PATH });
    console.log(`Session 已保存至 ${path.relative(process.cwd(), STATE_PATH)}（未输出 Cookie 内容）。`);
  }
} finally {
  await browser.close();
}

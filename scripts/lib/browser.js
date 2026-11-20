import { setTimeout as delay } from 'node:timers/promises';
import { CLASSROOM_ME, CLASSROOM_ORIGIN, VIDEO_HOME } from './classroom.js';

const HEADERS = { accept: 'application/json', referer: VIDEO_HOME };

export function createBrowserSession({ canvas, chromePath = '', timeoutMs = 30000, manualTimeoutMs = 300000 }) {
  let browser = null;
  let context = null;
  let loggingIn = null;

  async function close() {
    const oldBrowser = browser;
    browser = null;
    context = null;
    if (oldBrowser) await oldBrowser.close().catch(() => {});
  }

  async function launch(headless) {
    const { chromium } = await import('playwright-core');
    const options = headless ? { headless: true } : { headless: false };
    if (chromePath) {
      options.executablePath = chromePath;
      return chromium.launch(options);
    }
    try {
      return await chromium.launch({ ...options, channel: 'chrome' });
    } catch {
      return chromium.launch(options);
    }
  }

  async function identityOk(candidate) {
    try {
      const response = await candidate.request.get(CLASSROOM_ME, { headers: HEADERS, timeout: timeoutMs });
      if (response.status() !== 200) return false;
      const payload = await response.json();
      return String(payload?.code) === '0' && Boolean(payload?.result?.user);
    } catch {
      return false;
    }
  }

  async function automaticLogin(signal) {
    const loginUrl = await canvas.classroomLoginUrl(signal);
    const candidateBrowser = await launch(true);
    try {
      const candidate = await candidateBrowser.newContext();
      const page = await candidate.newPage();
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForURL((url) => url.hostname === 'v.sjtu.edu.cn', { timeout: timeoutMs });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        signal?.throwIfAborted();
        if (await identityOk(candidate)) return { browser: candidateBrowser, context: candidate };
        await delay(500, { signal });
      }
      throw new Error('login failed');
    } catch (error) {
      await candidateBrowser.close().catch(() => {});
      throw error;
    }
  }

  async function manualLogin(signal) {
    const candidateBrowser = await launch(false);
    try {
      const candidate = await candidateBrowser.newContext();
      const page = await candidate.newPage();
      await page.goto(VIDEO_HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      const deadline = Date.now() + manualTimeoutMs;
      while (Date.now() < deadline) {
        signal?.throwIfAborted();
        if (page.isClosed()) throw new Error('登录窗口已关闭');
        if (await identityOk(candidate)) return { browser: candidateBrowser, context: candidate };
        await delay(1500, { signal });
      }
      throw new Error('等待登录超时');
    } catch (error) {
      await candidateBrowser.close().catch(() => {});
      throw error;
    }
  }

  async function login(signal) {
    await close();
    let session;
    try {
      session = await automaticLogin(signal);
    } catch (automaticError) {
      if (signal?.aborted) throw automaticError;
      try {
        session = await manualLogin(signal);
      } catch {
        throw new Error('交大视频登录未完成。请在打开的官方页面完成 jAccount 登录后重试；不要在聊天中发送 Cookie、JWT 或 cURL。');
      }
    }
    browser = session.browser;
    context = session.context;
    return context;
  }

  async function ensureContext(signal) {
    if (context && await identityOk(context)) return context;
    if (!loggingIn) {
      loggingIn = login(signal).finally(() => {
        loggingIn = null;
      });
    }
    return loggingIn;
  }

  async function requestJson(url, signal) {
    const target = new URL(url);
    if (target.origin !== CLASSROOM_ORIGIN) throw new Error('交大视频地址无效');
    const candidate = await ensureContext(signal);
    let response;
    try {
      response = await candidate.request.get(target, { headers: HEADERS, timeout: timeoutMs });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('交大视频请求失败，请检查网络后重试');
    }
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('交大视频没有返回预期数据，请重新登录');
    }
    if (!response.ok() || payload?.status === 401 || payload?.status === 403 || String(payload?.code) === '-1') {
      await close();
      throw new Error('校园会话已失效，请重试以重新登录交大视频');
    }
    return payload;
  }

  return { requestJson, close };
}

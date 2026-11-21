#!/usr/bin/env node

import { createInstallerServer, openBrowserWindow } from './lib/server.js';

try {
  const instance = await createInstallerServer();
  const opened = openBrowserWindow(instance.url);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    message: '安装向导已启动。完成向导后此窗口会自动结束；取消安装可关闭此终端。',
    url: instance.url,
    browser: opened,
  }, null, 2)}\n`);
  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  process.stderr.write(`安装向导启动失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

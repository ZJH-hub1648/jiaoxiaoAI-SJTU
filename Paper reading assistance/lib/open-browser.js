import { spawn } from 'node:child_process';
export function openBrowserWindow(url) {
  if (process.env.PAPER_READER_NO_OPEN === '1' || process.env.JIAOXIAOAI_INSTALLER_NO_OPEN === '1') return 'disabled';
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('只能打开本机阅读器地址');
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); child.unref();
  return 'default-browser';
}

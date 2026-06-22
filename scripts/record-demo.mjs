// Records the guided demo tour to a video file by driving the real toolbar with
// the same tour.js routine the live "Play the guided tour" button uses.
//
// Output: demo/assets/a11y-companion-demo.webm  (Playwright native)
//         demo/assets/a11y-companion-demo.mp4   (H.264, if ffmpeg available)
//         demo/assets/poster.png                (a representative still)
import { serve } from './static-server.mjs';
import { launch } from './launch.mjs';
import { mkdir, rm, readdir, rename, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileP = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 800;
const tmpDir = join(root, '.video-tmp');
const assetsDir = join(root, 'demo', 'assets');

async function main() {
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });

  const { server, url } = await serve('demo');
  const browser = await launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: tmpDir, size: { width: W, height: H } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('→ loading demo …');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!document.getElementById('__a11y-companion-host')?.shadowRoot, null, { timeout: 10000 });
  await page.waitForTimeout(800);

  console.log('→ running guided tour (this takes ~90s) …');
  await page.evaluate(() => {
    window.__tourDone = false;
    document.addEventListener('a11y-tour-done', () => { window.__tourDone = true; }, { once: true });
    window.A11yTour.start();
  });
  await page.waitForFunction(() => window.__tourDone === true, null, { timeout: 240000 });
  await page.waitForTimeout(600);

  const video = page.video();
  await context.close(); // finalises the webm
  await browser.close();
  server.close();

  const rawPath = await video.path();
  const webmOut = join(assetsDir, 'a11y-companion-demo.webm');
  await cp(rawPath, webmOut);
  console.log('✓ wrote', webmOut);
  if (errors.length) console.warn('  (page errors during record:', errors.length, '— first:', errors[0], ')');

  // Transcode to MP4 + extract a poster, if an ffmpeg binary is available.
  let ffmpeg = null;
  try { ffmpeg = (await import('ffmpeg-static')).default; } catch {}
  if (ffmpeg && existsSync(ffmpeg)) {
    const mp4Out = join(assetsDir, 'a11y-companion-demo.mp4');
    console.log('→ transcoding to MP4 …');
    await execFileP(ffmpeg, [
      '-y', '-i', webmOut,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'veryfast',
      '-movflags', '+faststart', '-vf', `scale=${W}:${H}:flags=lanczos`,
      mp4Out,
    ]);
    console.log('✓ wrote', mp4Out);

    const posterOut = join(assetsDir, 'poster.png');
    await execFileP(ffmpeg, ['-y', '-ss', '00:00:14', '-i', webmOut, '-frames:v', '1', posterOut]);
    console.log('✓ wrote', posterOut);
  } else {
    console.log('• ffmpeg not available — keeping webm only. Install ffmpeg to also produce MP4.');
  }

  await rm(tmpDir, { recursive: true, force: true });
  console.log('\nDone. Drop the video into your README/portfolio from demo/assets/.');
}

main().catch((e) => { console.error(e); process.exit(1); });

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');

const GAME_URL = process.env.GAME_URL || 'https://dabanko.pages.dev/';
const PLAYER_COUNT = 6;
const MATCH_TIMEOUT_MS = 10 * 60 * 1000;
const ROOM_NAME = `اختبار آلي ${Date.now()}`;

const report = {
  gameUrl: GAME_URL,
  startedAt: new Date().toISOString(),
  playerCount: PLAYER_COUNT,
  roomName: ROOM_NAME,
  connectedPages: 0,
  joinedPlayers: 0,
  matchStarted: false,
  matchEnded: false,
  winner: null,
  durationSeconds: null,
  consoleErrors: [],
  pageErrors: [],
  networkFailures: [],
  players: []
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function visible(page, selector) {
  return page.locator(selector).isVisible().catch(() => false);
}

async function setPlayerName(page, name) {
  await page.locator('#btn-edit-name').click();
  await page.locator('#inp-player-name').fill(name);
  await page.locator('#btn-save-name').click();
  await page.locator('#modal-player-name').waitFor({ state: 'hidden', timeout: 5000 });
}

async function installAutoPilot(page, botNumber) {
  await page.evaluate((index) => {
    if (window.__dabankoAutoPilot) clearInterval(window.__dabankoAutoPilot);

    let changeDirectionAt = 0;
    let moveX = 0;
    let moveY = 0;

    window.__dabankoAutoPilot = setInterval(() => {
      try {
        if (typeof gameState === 'undefined' || gameState !== 'game') return;
        if (typeof player === 'undefined' || !player || player.dead) return;
        if (!Array.isArray(allTanks)) return;

        const targets = allTanks.filter(t => t && t !== player && !t.dead);
        if (!targets.length) return;

        targets.sort((a, b) =>
          Math.hypot(a.x - player.x, a.y - player.y) -
          Math.hypot(b.x - player.x, b.y - player.y)
        );

        const target = targets[0];

        // التصويب على أقرب لاعب مع قيادة بسيطة لحركته.
        const distance = Math.hypot(target.x - player.x, target.y - player.y);
        const travel = distance / (typeof SHELL_SPEED === 'number' ? SHELL_SPEED : 5.2);
        const aimX = target.x + (target.vx || 0) * travel * 0.45;
        const aimY = target.y + (target.vy || 0) * travel * 0.45;

        if (typeof mouse !== 'undefined') {
          mouse.x = aimX;
          mouse.y = aimY;
          mouse.down = true;
        }

        const now = performance.now();
        if (now >= changeDirectionAt) {
          changeDirectionAt = now + 900 + Math.random() * 1300;

          const towardX = target.x - player.x;
          const towardY = target.y - player.y;
          const len = Math.hypot(towardX, towardY) || 1;

          // يتحرك باتجاه الخصم إذا كان بعيدًا ويبتعد قليلًا إذا صار قريبًا.
          const sign = distance > 270 ? 1 : -1;
          moveX = (towardX / len) * sign + (Math.random() - 0.5) * 1.3;
          moveY = (towardY / len) * sign + (Math.random() - 0.5) * 1.3;
        }

        if (typeof keys !== 'undefined') {
          keys.w = moveY < -0.22;
          keys.s = moveY > 0.22;
          keys.a = moveX < -0.22;
          keys.d = moveX > 0.22;
        }
      } catch (_) {
        // يبقى الاختبار مستمرًا وتُلتقط أخطاء الصفحة من Playwright.
      }
    }, 50);
  }, botNumber);
}

async function main() {
  const browser = await chromium.launch({
    headless: true
  });

  const bots = [];
  const started = Date.now();

  try {
    // كل BrowserContext يمثل لاعبًا مستقلًا بذاكرة وLocalStorage منفصلين.
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        locale: 'ar-SA'
      });

      const page = await context.newPage();
      const name = `Test Bot ${i + 1}`;
      const playerReport = {
        name,
        pageLoaded: false,
        joinedRoom: false,
        ready: false,
        errors: []
      };
      report.players.push(playerReport);

      page.on('console', msg => {
        if (msg.type() === 'error') {
          const error = `${name}: ${msg.text()}`;
          report.consoleErrors.push(error);
          playerReport.errors.push(error);
        }
      });

      page.on('pageerror', error => {
        const message = `${name}: ${error.message}`;
        report.pageErrors.push(message);
        playerReport.errors.push(message);
      });

      page.on('requestfailed', request => {
        const failure = request.failure();
        report.networkFailures.push({
          player: name,
          url: request.url(),
          error: failure ? failure.errorText : 'unknown'
        });
      });

      await page.goto(GAME_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      await page.locator('#screen-main').waitFor({
        state: 'visible',
        timeout: 30000
      });

      playerReport.pageLoaded = true;
      report.connectedPages++;

      await setPlayerName(page, name);

      bots.push({ context, page, name, playerReport });
    }

    const host = bots[0];

    // الهوست يفتح قائمة السيرفرات وينشئ رومًا مفتوحًا لستة لاعبين.
    await host.page.locator('#btn-to-rooms').click();
    await host.page.locator('#screen-rooms').waitFor({ state: 'visible', timeout: 30000 });
    await host.page.locator('#btn-open-create').click();
    await host.page.locator('#inp-room-name').fill(ROOM_NAME);
    await host.page.locator('#inp-room-max').selectOption('6');
    await host.page.locator('#inp-room-access').selectOption('open');
    await host.page.locator('#btn-confirm-create').click();

    await host.page.locator('#hud-lobby').waitFor({ state: 'visible', timeout: 30000 });
    host.playerReport.joinedRoom = true;
    report.joinedPlayers++;

    // بقية اللاعبين يدخلون شاشة السيرفرات ويبحثون عن اسم الروم.
    for (let i = 1; i < bots.length; i++) {
      const bot = bots[i];

      await bot.page.locator('#btn-to-rooms').click();
      await bot.page.locator('#screen-rooms').waitFor({ state: 'visible', timeout: 30000 });

      const card = bot.page.locator('.room-card').filter({
        hasText: ROOM_NAME
      }).first();

      // تحديث القائمة عدة مرات لأن السيرفر قد يتأخر.
      let found = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        if (await card.count()) {
          found = true;
          break;
        }

        await bot.page.evaluate(() => {
          try {
            if (typeof socket !== 'undefined') socket.emit('dabanko:getRooms');
          } catch (_) {}
        });
        await sleep(1000);
      }

      if (!found) {
        throw new Error(`${bot.name}: لم يجد روم الاختبار`);
      }

      await card.getByRole('button', { name: 'انضمام' }).click();
      await bot.page.locator('#hud-lobby').waitFor({ state: 'visible', timeout: 30000 });

      bot.playerReport.joinedRoom = true;
      report.joinedPlayers++;
    }

    // التأكد أن الهوست يرى 6 لاعبين.
    await host.page.waitForFunction(
      expected => document.querySelectorAll('#lobby-players .player-row').length === expected,
      PLAYER_COUNT,
      { timeout: 30000 }
    );

    // جميع اللاعبين يضغطون استعداد.
    for (const bot of bots) {
      await bot.page.locator('#btn-ready').click();
      bot.playerReport.ready = true;
    }

    // انتظار تفعيل زر بدء المباراة.
    await host.page.locator('#btn-start').waitFor({ state: 'visible', timeout: 15000 });
    await host.page.waitForFunction(() => {
      const button = document.querySelector('#btn-start');
      return button && !button.disabled;
    }, { timeout: 30000 });

    await host.page.locator('#btn-start').click();

    // انتظار تحول حالة اللعبة إلى game على الجميع.
    for (const bot of bots) {
      await bot.page.waitForFunction(
        () => typeof gameState !== 'undefined' && gameState === 'game',
        { timeout: 30000 }
      );
      await installAutoPilot(bot.page, bots.indexOf(bot));
    }

    report.matchStarted = true;
    report.matchStartedAt = new Date().toISOString();

    // انتظار شاشة النهاية على أي لاعب.
    const winnerResult = await Promise.race([
      ...bots.map(async bot => {
        await bot.page.locator('#game-over').waitFor({
          state: 'visible',
          timeout: MATCH_TIMEOUT_MS
        });
        return {
          observer: bot.name,
          winnerText: await bot.page.locator('#go-winner').innerText()
        };
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('المباراة لم تنته خلال 10 دقائق')),
          MATCH_TIMEOUT_MS
        )
      )
    ]);

    report.matchEnded = true;
    report.winner = winnerResult.winnerText;
    report.observedBy = winnerResult.observer;
    report.status = 'PASSED';
  } catch (error) {
    report.status = 'FAILED';
    report.failureReason = error.message;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.durationSeconds = Number(((Date.now() - started) / 1000).toFixed(2));

    // جمع النتيجة النهائية من كل جلسة قبل إغلاقها.
    for (const bot of bots) {
      try {
        bot.playerReport.finalState = await bot.page.evaluate(() => ({
          gameState: typeof gameState !== 'undefined' ? gameState : null,
          socketConnected:
            typeof socket !== 'undefined' ? !!socket.connected : false,
          socketId:
            typeof socket !== 'undefined' ? socket.id : null,
          tankCount:
            typeof allTanks !== 'undefined' && Array.isArray(allTanks)
              ? allTanks.length
              : null,
          myKills:
            typeof player !== 'undefined' && player ? player.kills : null,
          myHp:
            typeof player !== 'undefined' && player ? player.hp : null,
          myDead:
            typeof player !== 'undefined' && player ? player.dead : null
        }));
      } catch (error) {
        bot.playerReport.errors.push(`تعذر جمع الحالة النهائية: ${error.message}`);
      }
    }

    fs.writeFileSync(
      'dabanko-online-report.json',
      JSON.stringify(report, null, 2),
      'utf8'
    );

    await browser.close();

    console.log('\n================================');
    console.log(`النتيجة: ${report.status}`);
    console.log(`اللاعبون الذين دخلوا: ${report.joinedPlayers}/${PLAYER_COUNT}`);
    console.log(`بدأت المباراة: ${report.matchStarted ? 'نعم' : 'لا'}`);
    console.log(`انتهت المباراة: ${report.matchEnded ? 'نعم' : 'لا'}`);
    console.log(`الفائز: ${report.winner || 'لا يوجد'}`);
    console.log(`المدة: ${report.durationSeconds} ثانية`);
    console.log('التقرير: dabanko-online-report.json');
    console.log('================================\n');

    process.exitCode = report.status === 'PASSED' ? 0 : 1;
  }
}

main();
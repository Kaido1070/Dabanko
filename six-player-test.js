'use strict';

const { chromium } = require('playwright');
const fs = require('fs');

const GAME_URL = process.env.GAME_URL || 'https://dabanko.pages.dev/';
const PLAYER_COUNT = 6;
const JOIN_TIMEOUT_MS = 120000;
const MATCH_TIMEOUT_MS = 600000;
const ROOM_NAME = `اختبار آلي ${Date.now()}`;

const report = {
  version: 2,
  gameUrl: GAME_URL,
  startedAt: new Date().toISOString(),
  playerCount: PLAYER_COUNT,
  roomName: ROOM_NAME,
  roomId: null,
  connectedPages: 0,
  joinedPlayers: 0,
  readyPlayers: 0,
  matchStarted: false,
  matchEnded: false,
  winner: null,
  consoleErrors: [],
  pageErrors: [],
  networkFailures: [],
  socketEvents: {},
  players: []
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setPlayerName(page, name) {
  await page.locator('#btn-edit-name').click();
  await page.locator('#inp-player-name').fill(name);
  await page.locator('#btn-save-name').click();
  await page.locator('#modal-player-name').waitFor({ state: 'hidden', timeout: 8000 });
}

async function waitForSocket(page) {
  await page.waitForFunction(() => typeof socket !== 'undefined' && socket && socket.connected, {
    timeout: 30000
  });
}

async function installObserver(page) {
  await page.evaluate(() => {
    if (window.__testObserverInstalled) return;
    window.__testObserverInstalled = true;
    window.__testEvents = {};
    if (typeof socket !== 'undefined' && socket && typeof socket.onAny === 'function') {
      socket.onAny(eventName => {
        window.__testEvents[eventName] = (window.__testEvents[eventName] || 0) + 1;
      });
    }
  });
}

async function installAutoPilot(page, index) {
  await page.evaluate((botIndex) => {
    if (window.__dabankoAutoPilot) clearInterval(window.__dabankoAutoPilot);

    let moveX = 0;
    let moveY = 0;
    let changeAt = 0;

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
        const dx = target.x - player.x;
        const dy = target.y - player.y;
        const distance = Math.hypot(dx, dy) || 1;
        const shellSpeed = typeof SHELL_SPEED === 'number' ? SHELL_SPEED : 5.2;
        const travel = distance / shellSpeed;

        if (typeof mouse !== 'undefined') {
          mouse.x = target.x + (target.vx || 0) * travel * 0.45;
          mouse.y = target.y + (target.vy || 0) * travel * 0.45;
          mouse.down = true;
        }

        const now = performance.now();
        if (now >= changeAt) {
          changeAt = now + 700 + Math.random() * 900;
          const nx = dx / distance;
          const ny = dy / distance;
          const forward = distance > 260 ? 1 : -1;
          const side = (botIndex % 2 === 0 ? 1 : -1) * (0.55 + Math.random() * 0.45);

          moveX = nx * forward - ny * side;
          moveY = ny * forward + nx * side;
        }

        if (typeof keys !== 'undefined') {
          keys.w = moveY < -0.18;
          keys.s = moveY > 0.18;
          keys.a = moveX < -0.18;
          keys.d = moveX > 0.18;
          keys[' '] = true;
        }
      } catch (_) {}
    }, 50);
  }, index);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const bots = [];
  const startedAtMs = Date.now();

  try {
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
        socketConnected: false,
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
        report.networkFailures.push({
          player: name,
          url: request.url(),
          error: request.failure()?.errorText || 'unknown'
        });
      });

      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('#screen-main').waitFor({ state: 'visible', timeout: 30000 });

      playerReport.pageLoaded = true;
      report.connectedPages++;

      await waitForSocket(page);
      playerReport.socketConnected = true;

      await setPlayerName(page, name);
      await installObserver(page);

      bots.push({ context, page, name, playerReport });
    }

    const host = bots[0];

    await host.page.locator('#btn-to-rooms').click();
    await host.page.locator('#screen-rooms').waitFor({ state: 'visible', timeout: 30000 });
    await host.page.locator('#btn-open-create').click();
    await host.page.locator('#inp-room-name').fill(ROOM_NAME);
    await host.page.locator('#inp-room-max').selectOption('6');
    await host.page.locator('#inp-room-access').selectOption('open');
    await host.page.locator('#btn-confirm-create').click();
    await host.page.locator('#hud-lobby').waitFor({ state: 'visible', timeout: 30000 });

    let roomId = '';
    for (let i = 0; i < 40 && !roomId; i++) {
      roomId = await host.page.evaluate(() => {
        try {
          return currentRoom ? String(currentRoom.id ?? currentRoom.roomId ?? '') : '';
        } catch (_) {
          return '';
        }
      });
      if (!roomId) await sleep(500);
    }

    if (!roomId) throw new Error('لم يتم الحصول على roomId بعد إنشاء الروم');

    report.roomId = roomId;
    host.playerReport.joinedRoom = true;
    report.joinedPlayers = 1;

    // إدخال البوتات مباشرة بالروم نفسه، ثم الانتظار بعد كل لاعب.
    for (let i = 1; i < bots.length; i++) {
      const bot = bots[i];

      await bot.page.locator('#btn-to-rooms').click();
      await bot.page.locator('#screen-rooms').waitFor({ state: 'visible', timeout: 30000 });

      await bot.page.evaluate(({ roomId, name }) => {
        socket.emit('dabanko:joinOpenRoom', { roomId, playerName: name });
      }, { roomId, name: bot.name });

      await bot.page.waitForFunction(() => {
        try {
          return gameState === 'lobby' &&
            currentRoom &&
            Array.isArray(currentRoom.players) &&
            currentRoom.players.some(p => p.socketId === socket.id);
        } catch (_) {
          return false;
        }
      }, { timeout: JOIN_TIMEOUT_MS });

      bot.playerReport.joinedRoom = true;
      report.joinedPlayers++;

      await host.page.waitForFunction(expected => {
        try {
          return currentRoom &&
            Array.isArray(currentRoom.players) &&
            currentRoom.players.length >= expected;
        } catch (_) {
          return false;
        }
      }, i + 1, { timeout: 30000 });
    }

    // الهوست ينتظر حتى يرى الستة فعلًا.
    await host.page.waitForFunction(expected => {
      try {
        return currentRoom &&
          Array.isArray(currentRoom.players) &&
          currentRoom.players.length === expected;
      } catch (_) {
        return false;
      }
    }, PLAYER_COUNT, { timeout: JOIN_TIMEOUT_MS });

    for (const bot of bots) {
      await bot.page.locator('#btn-ready').click();
      bot.playerReport.ready = true;
      report.readyPlayers++;
      await sleep(250);
    }

    await host.page.locator('#btn-start').waitFor({ state: 'visible', timeout: 30000 });
    await host.page.waitForFunction(() => {
      const btn = document.querySelector('#btn-start');
      return btn && !btn.disabled;
    }, { timeout: 60000 });

    await host.page.locator('#btn-start').click();

    for (const bot of bots) {
      await bot.page.waitForFunction(() => gameState === 'game', { timeout: 60000 });
    }

    report.matchStarted = true;
    report.matchStartedAt = new Date().toISOString();

    for (let i = 0; i < bots.length; i++) {
      await installAutoPilot(bots[i].page, i);
    }

    const result = await Promise.race([
      ...bots.map(async bot => {
        await bot.page.locator('#game-over').waitFor({
          state: 'visible',
          timeout: MATCH_TIMEOUT_MS
        });
        return {
          observer: bot.name,
          winner: await bot.page.locator('#go-winner').innerText()
        };
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('المباراة لم تنته خلال 10 دقائق')), MATCH_TIMEOUT_MS);
      })
    ]);

    report.matchEnded = true;
    report.winner = result.winner;
    report.observedBy = result.observer;
    report.status = 'PASSED';
  } catch (error) {
    report.status = 'FAILED';
    report.failureReason = error.message;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.durationSeconds = Number(((Date.now() - startedAtMs) / 1000).toFixed(2));

    for (const bot of bots) {
      try {
        bot.playerReport.finalState = await bot.page.evaluate(() => ({
          gameState: typeof gameState !== 'undefined' ? gameState : null,
          socketConnected: typeof socket !== 'undefined' ? !!socket.connected : false,
          socketId: typeof socket !== 'undefined' ? socket.id : null,
          roomPlayers:
            typeof currentRoom !== 'undefined' &&
            currentRoom &&
            Array.isArray(currentRoom.players)
              ? currentRoom.players.length
              : null,
          tankCount:
            typeof allTanks !== 'undefined' && Array.isArray(allTanks)
              ? allTanks.length
              : null,
          kills: typeof player !== 'undefined' && player ? player.kills : null,
          hp: typeof player !== 'undefined' && player ? player.hp : null,
          dead: typeof player !== 'undefined' && player ? player.dead : null,
          events: window.__testEvents || {}
        }));

        for (const [eventName, count] of Object.entries(bot.playerReport.finalState.events || {})) {
          report.socketEvents[eventName] = (report.socketEvents[eventName] || 0) + count;
        }
      } catch (error) {
        bot.playerReport.errors.push(`تعذر جمع الحالة النهائية: ${error.message}`);
      }
    }

    report.validation = {
      allPagesLoaded: report.connectedPages === PLAYER_COUNT,
      allPlayersJoined: report.joinedPlayers === PLAYER_COUNT,
      allPlayersReady: report.readyPlayers === PLAYER_COUNT,
      matchStarted: report.matchStarted,
      matchEnded: report.matchEnded,
      fireEventsSeen: (report.socketEvents['dabanko:fire'] || 0) > 0,
      damageEventsSeen: (report.socketEvents['dabanko:playerDamaged'] || 0) > 0,
      respawnEventsSeen: (report.socketEvents['dabanko:playerRespawned'] || 0) > 0,
      gameEndedEventSeen: (report.socketEvents['dabanko:gameEnded'] || 0) > 0
    };

    fs.writeFileSync(
      'dabanko-online-report.json',
      JSON.stringify(report, null, 2),
      'utf8'
    );

    await browser.close();

    console.log(`النتيجة: ${report.status}`);
    console.log(`دخل اللاعبون: ${report.joinedPlayers}/${PLAYER_COUNT}`);
    console.log(`استعد اللاعبون: ${report.readyPlayers}/${PLAYER_COUNT}`);
    console.log(`بدأت المباراة: ${report.matchStarted}`);
    console.log(`انتهت المباراة: ${report.matchEnded}`);
    console.log(`الفائز: ${report.winner || 'لا يوجد'}`);

    process.exitCode = report.status === 'PASSED' ? 0 : 1;
  }
}

main();
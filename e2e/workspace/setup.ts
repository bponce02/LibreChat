import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from '@playwright/test';
import type { FullConfig } from '@playwright/test';
import { getRuntimeEnvPath } from '../setup/env';
import { getE2EUser } from '../setup/user';
import { login } from '../setup/authenticate';

export default async function setup(config: FullConfig) {
  const user = getE2EUser();
  const runtime = JSON.parse(fs.readFileSync(getRuntimeEnvPath(), 'utf8')) as { MONGO_URI: string };
  const db = new MongoClient(runtime.MONGO_URI);
  await db.connect();
  try {
    await db
      .db()
      .collection('users')
      .insertOne({
        _id: new ObjectId('000000000000000000000001'),
        name: user.name,
        email: user.email,
        username: 'workspace-owner',
        password: await bcrypt.hash(user.password, 10),
        provider: 'local',
        role: 'USER',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  } finally {
    await db.close();
  }
  const browser = await chromium.launch({
    channel: config.projects[0].use.channel,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.context().addInitScript(() => localStorage.setItem('navVisible', 'true'));
    await page.goto(`${config.projects[0].use.baseURL}/login`);
    await login(page, user);
    await page.waitForURL('**/c/new');
    await page.context().storageState({ path: String(config.projects[0].use.storageState) });
  } finally {
    await browser.close();
  }
}

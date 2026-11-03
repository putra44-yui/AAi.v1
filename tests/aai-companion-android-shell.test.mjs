import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const bytes = path => readFileSync(new URL('../' + path, import.meta.url));
const service = read('android/app/src/main/java/app/aai/capacitor/CompanionOverlayService.java');
const activity = read('android/app/src/main/java/app/aai/capacitor/MainActivity.java');
const plugin = read('android/app/src/main/java/app/aai/capacitor/AAiCompanionPlugin.java');
const manifest = read('android/app/src/main/AndroidManifest.xml');

test('native overlay yields screen to the in-app AAi companion', () => {
  assert.match(service, /ACTION_APP_FOREGROUND/);
  assert.match(service, /ACTION_APP_BACKGROUND/);
  assert.match(service, /if \(appForeground\)/);
  assert.match(service, /wm\.removeView\(floatingWidget\)/);
  assert.match(service, /!appForeground && widgetParams != null/);
  assert.match(activity, /protected void onResume\(\)/);
  assert.match(activity, /protected void onPause\(\)/);
  assert.match(activity, /setCompanionInApp\(true\)/);
  assert.match(activity, /setCompanionInApp\(false\)/);
  assert.match(plugin, /service\.putExtra\("appVisible", true\)/);
});

test('Android launcher reuses the existing AAi brand PNG exactly', () => {
  assert.match(manifest, /android:icon="@drawable\/aai_brand"/);
  assert.match(manifest, /android:roundIcon="@drawable\/aai_brand"/);
  const hash = data => createHash('sha256').update(data).digest('hex');
  assert.equal(
    hash(bytes('android/app/src/main/res/drawable-nodpi/aai_brand.png')),
    hash(bytes('public/icons/aai-512.png'))
  );
});

test('debug QA app installs beside the existing AAi without overwriting app data', () => {
  const gradle = read('android/app/build.gradle');
  const label = read('android/app/src/debug/res/values/strings.xml');
  assert.match(gradle, /applicationIdSuffix ".qa"/);
  assert.match(gradle, /versionNameSuffix "-qa"/);
  assert.match(label, /AAi Uji/);
});

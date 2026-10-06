import { filterNotificationPlugins, getNotificationCatalogTools } from './catalog';

const notification = { name: 'Notify User', pluginKey: 'notify_user' };
const other = { name: 'Calculator', pluginKey: 'calculator' };

test('notification plugin is hidden unless explicitly enabled', () => {
  expect(filterNotificationPlugins([notification, other])).toEqual([other]);
  expect(filterNotificationPlugins([notification, other], { enabled: false })).toEqual([other]);
  expect(filterNotificationPlugins([notification, other], { enabled: true })).toEqual([
    notification,
    other,
  ]);
});

test('notification catalog respects tool inclusion and exclusion', () => {
  expect(getNotificationCatalogTools(['calculator'], [])).toEqual([]);
  expect(getNotificationCatalogTools([], ['notify_user'])).toEqual([]);
  expect(getNotificationCatalogTools(['notify_user'], [])).toHaveLength(1);
  expect(getNotificationCatalogTools([], [])).toHaveLength(1);
});

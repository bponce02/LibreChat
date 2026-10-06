export function isMutableAppAsset(fileName: string): boolean {
  return (
    fileName === 'index.html' ||
    fileName.endsWith('.webmanifest') ||
    fileName === 'manifest.json' ||
    fileName === 'sw.js' ||
    fileName === 'sw-heal.js' ||
    fileName === 'sw-push.js'
  );
}

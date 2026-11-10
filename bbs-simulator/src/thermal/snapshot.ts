import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { bmpToDataUri } from './render';

// Saves the thermal picture (the CB360 app's photo button). Web: a PNG download, scaled up 4×
// without smoothing so the pixels stay sharp. Native: the BMP via the share sheet.
export async function saveSnapshot(bmp: Uint8Array, at = new Date()): Promise<void> {
  const stamp = at.toISOString().slice(0, 19).replace(/[-:T]/g, '');
  if (Platform.OS === 'web') {
    const img = new (window as any).Image();
    img.src = bmpToDataUri(bmp);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width * 4;
    canvas.height = img.height * 4;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `thermal-${stamp}.png`;
    a.click();
    return;
  }
  const file = new File(Paths.cache, `thermal-${stamp}.bmp`);
  if (file.exists) file.delete();
  file.create();
  file.write(bmp);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'image/bmp', dialogTitle: 'Thermal picture' });
}

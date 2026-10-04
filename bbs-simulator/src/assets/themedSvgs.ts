import { colors, recolor } from '../theme';
import * as svgs from './svgs';

// Figma icons whose colours are baked for the dark background. In light mode the
// white parts would vanish on white cards, so they are recoloured at render time.
// (Nav bar icons sit on the white bar in both themes and need no change.)
const light = () => colors.scheme === 'light';

export const themedSvgs = {
  folder: () => (light() ? recolor(svgs.folder, { white: colors.strong }) : svgs.folder),
  // Inverted: navy disc with a white pencil.
  editButton: () =>
    light() ? recolor(svgs.editButton, { white: colors.strong, '#191629': '#FFFFFF' }) : svgs.editButton,
  swipeCancel: () => (light() ? recolor(svgs.swipeCancel, { '#F2F5FF': colors.muted }) : svgs.swipeCancel),
  sliderThumb: () => recolor(svgs.sliderThumb, { '#FFF8EA': colors.sliderThumb }),
};

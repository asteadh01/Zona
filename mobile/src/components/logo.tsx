import Svg, { Path } from 'react-native-svg';

import { LOGO_VIEW_BOX, LOGO_Z, RING_WIDTH, gaugeArcs } from '@/utils/logo-geometry';

const ARCS = gaugeArcs();

type LogoMarkProps = { size: number; ramp: readonly string[]; ink: string };

// Decorative, so it has no label: wherever it appears, the name "Zona" is next to it or the screen is gone in a second.
export function LogoMark({ size, ramp, ink }: LogoMarkProps) {
  return (
    <Svg width={size} height={size} viewBox={LOGO_VIEW_BOX}>
      {ARCS.map((d, i) => <Path key={d} d={d} fill="none" stroke={ramp[i]} strokeWidth={RING_WIDTH} />)}
      <Path d={LOGO_Z} fill={ink} />
    </Svg>
  );
}

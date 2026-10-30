import * as SplashScreen from 'expo-splash-screen';
import { useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet } from 'react-native';

import { LogoMark } from '@/components/logo';
import { BRAND } from '@/constants/theme';

const LOGO_SIZE = 210;
const NATIVE_SPLASH_WIDTH = 130; // imageWidth in app.json: the overlay starts exactly where the still splash leaves off
const POP_MS = 720;
const HOLD_MS = 200;
const FADE_MS = 240;

type LaunchOverlayProps = { onDone: () => void };

// iOS can only show a still image at launch, so this takes over from it to make the logo pop, then fades into the app.
export function LaunchOverlay({ onDone }: LaunchOverlayProps) {
  const scale = useRef(new Animated.Value(NATIVE_SPLASH_WIDTH / LOGO_SIZE)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const started = useRef(false);

  const handleLayout = async () => {
    if (started.current) return;
    started.current = true;
    const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
    await SplashScreen.hideAsync().catch(() => undefined); // an already hidden splash is fine, the overlay still has to finish
    const fade = Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true });
    const pop = Animated.timing(scale, { toValue: 1, duration: POP_MS, easing: Easing.bezier(0.2, 0.9, 0.25, 1.15), useNativeDriver: true });
    Animated.sequence(reduceMotion ? [fade] : [pop, Animated.delay(HOLD_MS), fade]).start(() => onDone());
  };

  return (
    <Animated.View style={[styles.overlay, { opacity }]} onLayout={() => void handleLayout()} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={{ transform: [{ scale }] }}>
        <LogoMark size={LOGO_SIZE} ramp={BRAND.ramp} ink={BRAND.ink} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: BRAND.bg, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
});

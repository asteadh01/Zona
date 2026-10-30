import { router } from 'expo-router';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Btn, BtnRow, Header, LoadState, Note } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useLoad } from '@/hooks/use-load';
import { api } from '@/services/api';

/** The field names and types of Garmin's latest responses, never the values, so they're safe to share. */
export default function GarminShapesScreen() {
  const theme = useTheme();
  const { data, error, reload } = useLoad(api.garminShapes);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={styles.content}>
      <Header title="Garmin data" small="Field names and types, no values" />
      <BtnRow>
        <Btn label="Share" kind="ghost" disabled={!data} onPress={() => void Share.share({ message: data ?? '' })} />
        <Btn label="Close" kind="ghost" onPress={() => router.back()} />
      </BtnRow>
      <Note>Send this to check that Zona reads calories, sleep, HRV and Body Battery from the right fields.</Note>
      {data == null ? <LoadState error={error} onRetry={() => void reload()} /> : (
        <View style={[styles.box, { backgroundColor: theme.surface }]}>
          <Text selectable style={[styles.text, { color: theme.ink2 }]}>{data}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 24, gap: 12 },
  box: { borderRadius: 14, padding: 12 },
  text: { fontSize: 11.5, lineHeight: 16, fontFamily: 'Courier' },
});

// ─── Cockpit Rail ───────────────────────────────────────────────────────────
// Horizontal scrollable row of 8 arc gauges, matching the web dashboard.

import React from 'react';
import { View, ScrollView, Text } from 'react-native';
import { GaugeArc } from './GaugeArc';
import { C } from '../core/theme';

export function CockpitRail({ gauges = [] }) {
  if (!gauges.length) return null;
  return (
    <View style={{
      backgroundColor: C.surf,
      borderWidth: 0.5,
      borderColor: C.b,
      borderRadius: 12,
      padding: 10,
      marginBottom: 10,
    }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
        {gauges.map((g, i) => (
          <GaugeArc
            key={i}
            label={g.label}
            value={g.value}
            unit={g.unit}
            goal={g.goal}
            color={g.color}
            invert={g.invert}
          />
        ))}
      </ScrollView>
    </View>
  );
}

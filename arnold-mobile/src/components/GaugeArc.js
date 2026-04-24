// ─── Arc Gauge (SVG) ────────────────────────────────────────────────────────
// Compact radial gauge for the cockpit rail. Pure RN + react-native-svg.

import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { C } from '../core/theme';

export function GaugeArc({ label, value, unit, goal, color = '#60a5fa', invert, size = 68 }) {
  const pct = goal && value
    ? Math.min(1, invert ? goal / value : value / goal)
    : 0;
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const stroke = circ * pct;

  return (
    <View style={{ alignItems: 'center', width: size + 4 }}>
      <Svg width={size} height={size}>
        {/* track */}
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={C.elev} strokeWidth={5}
        />
        {/* fill */}
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={`${stroke} ${circ}`}
          strokeDashoffset={circ * 0.25}
          strokeLinecap="round"
          rotation={-90} origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: C.t, fontFamily: 'monospace' }}>
          {value != null ? value : '—'}
        </Text>
        <Text style={{ fontSize: 8, color: C.m }}>{unit}</Text>
      </View>
      <Text style={{ fontSize: 9, color: C.m, marginTop: 2, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

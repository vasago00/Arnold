import React from 'react';
import { View, Text, ScrollView, SafeAreaView, StatusBar } from 'react-native';

const C = {
  bg: '#0a0a0f', surf: '#111118', elev: '#18181f',
  b: 'rgba(255,255,255,0.06)', t: '#e4e4e7',
  m: '#71717a', acc: '#4ade80', accd: 'rgba(74,222,128,0.10)',
};

export default function DashboardScreen() {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>

        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{
              width: 36, height: 36, borderRadius: 8,
              backgroundColor: C.accd, justifyContent: 'center', alignItems: 'center',
            }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: C.acc }}>A</Text>
            </View>
            <View>
              <Text style={{ fontSize: 14, fontWeight: '600', color: C.t, letterSpacing: 2 }}>ARNOLD</Text>
              <Text style={{ fontSize: 10, color: C.m, letterSpacing: 1 }}>Health Intelligence</Text>
            </View>
          </View>
        </View>

        {/* Date */}
        <Text style={{ fontSize: 13, color: C.t, fontStyle: 'italic', marginBottom: 4, textDecorationLine: 'underline' }}>
          Prepared for Emil
        </Text>
        <Text style={{ fontSize: 11, color: C.m, marginBottom: 20 }}>{dateStr}</Text>

        {/* Gauge placeholders */}
        <View style={{
          backgroundColor: C.surf, borderRadius: 12,
          borderWidth: 0.5, borderColor: C.b, padding: 14, marginBottom: 12,
        }}>
          <Text style={{ fontSize: 11, color: C.m, marginBottom: 10, letterSpacing: 1 }}>COCKPIT RAIL</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {['Weekly mi', 'Weekly hrs', 'Avg HR', 'RHR', 'HRV', 'Sleep', 'Protein', 'Body fat'].map((label, i) => (
              <View key={i} style={{
                width: 64, height: 64, borderRadius: 32,
                backgroundColor: C.elev, marginRight: 8,
                justifyContent: 'center', alignItems: 'center',
              }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: C.t }}>—</Text>
                <Text style={{ fontSize: 7, color: C.m, marginTop: 2 }}>{label}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* Focus placeholder */}
        <View style={{
          backgroundColor: C.surf, borderRadius: 12,
          borderWidth: 0.5, borderColor: C.b, padding: 16,
        }}>
          <Text style={{ fontSize: 13, fontWeight: '500', color: C.t, marginBottom: 8 }}>Today's Focus</Text>
          <Text style={{ fontSize: 11, color: C.m, fontStyle: 'italic' }}>
            Upload today's activity and nutrition data to see focus items.
          </Text>
        </View>

        {/* Proof of life */}
        <View style={{ marginTop: 20, alignItems: 'center' }}>
          <Text style={{ fontSize: 10, color: C.m }}>Arnold Mobile v1.0 · React Native</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

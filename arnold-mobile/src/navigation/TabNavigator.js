// ─── Bottom Tab Navigator ───────────────────────────────────────────────────
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import DashboardScreen from '../screens/DashboardScreen';
import { C } from '../core/theme';

// Placeholder screens
const Placeholder = ({ route }) => (
  <React.Fragment>
    <Text style={{ color: C.m, textAlign: 'center', marginTop: 100, fontSize: 14 }}>
      {route.name} — coming soon
    </Text>
  </React.Fragment>
);

const Tab = createBottomTabNavigator();

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.bg,
          borderTopColor: C.b,
          borderTopWidth: 0.5,
          height: 56,
          paddingBottom: 6,
        },
        tabBarActiveTintColor: C.acc,
        tabBarInactiveTintColor: C.dn,
        tabBarLabelStyle: { fontSize: 9, letterSpacing: 0.5 },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◈</Text> }}
      />
      <Tab.Screen
        name="Daily"
        component={Placeholder}
        options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⊕</Text> }}
      />
      <Tab.Screen
        name="Training"
        component={Placeholder}
        options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◉</Text> }}
      />
      <Tab.Screen
        name="Goals"
        component={Placeholder}
        options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◎</Text> }}
      />
      <Tab.Screen
        name="Stack"
        component={Placeholder}
        options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◈</Text> }}
      />
    </Tab.Navigator>
  );
}

// ─── MobileHome: Polished Performance Dashboard ────────────────────────────
// Information-rich cockpit with visual richness: colored card tints, prominent
// sparklines, solid progress bars, and docked bottom navigation. Dense but not
// cramped. Rewards data-obsessed users with rich context on every metric.

import { useState, useEffect, useCallback } from "react";
import { Sparkline } from "./Sparkline.jsx";
import { STATUS, statusFromPct } from "../core/semantics.js";
import { getGoals } from "../core/goals.js";
import { storage } from "../core/storage.js";
import { computeReadiness } from "../core/trainingIntelligence.js";
import { todayPlanned, checkTodayCompletion, DAY_TYPES } from "../core/planner.js";
import { NutritionInput } from "./NutritionInput.jsx";
import { DataSync } from "./DataSync.jsx";

// ─── Color palette ─────────────────────────────────────────────────────────
const COLORS = {
  training: '#60a5fa',      // blue
  sleep: '#22d3ee',         // cyan
  nutrition: '#f472b6',     // pink
  weight: '#f59e0b',        // amber
  pace: '#fbbf24',          // yellow
  hrv: '#34d399',           // emerald
  bodyFat: '#ef4444',       // red
  rhr: '#a78bfa',           // purple
  weeklyRuns: '#60a5fa',    // blue
  raceDays: '#f97316',      // orange
};

const BG_DARK = '#0c0d14';
const BG_DARKER = '#10111a';
const TEXT_PRIMARY = '#ffffff';
const TEXT_SECONDARY = 'rgba(255,255,255,0.7)';
const TEXT_MUTED = 'rgba(255,255,255,0.65)';
const TEXT_DIM = 'rgba(255,255,255,0.45)';

// ─── Updated NAV_ITEMS: 7 main items with icons and labels ──────────────────
export const NAV_ITEMS = [
  { id: 'start',     icon: '⬡', label: 'Start' },
  { id: 'edgeiq',    icon: '◇', label: 'EdgeIQ',  tab: 'weekly' },
  { id: 'play',      icon: '◎', label: 'Play',    tab: 'activity' },
  { id: 'fuel',      icon: '◈', label: 'Fuel',    tab: 'nutrition_mobile' },
  { id: 'core',      icon: '△', label: 'Core',    tab: 'clinical' },
  { id: 'labs',      icon: '◉', label: 'Labs',    tab: 'labs' },
  { id: 'more',      icon: '⋯', label: 'More' },
];

// ─── Swipe order for navigation ──────────────────────────────────────────────
const SWIPE_ORDER = ['start', 'edgeiq', 'play', 'fuel', 'core', 'labs'];

// ─── Swipe navigation hook ────────────────────────────────────────────────────
export function useSwipeNav({ onSwipeLeft, onSwipeRight, threshold = 60 } = {}) {
  const touchRef = useCallback(() => {}, []);
  const startX = { current: 0 };
  const startY = { current: 0 };
  return {
    onTouchStart: (e) => {
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
    },
    onTouchEnd: (e) => {
      const dx = e.changedTouches[0].clientX - startX.current;
      const dy = e.changedTouches[0].clientY - startY.current;
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) onSwipeLeft?.();
        else onSwipeRight?.();
      }
    },
  };
}

// ─── COMPACT HEADER: Greeting + Date in two lines ──────────────────────────
function CompactHeader({ greeting, profileName }) {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      paddingBottom: 8,
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      marginBottom: 12,
    }}>
      <div>
        <div style={{
          fontSize: 11,
          color: TEXT_MUTED,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 2,
        }}>
          ⬡ Arnold [Beta]
        </div>
        <div style={{
          fontSize: 13,
          color: TEXT_SECONDARY,
          fontWeight: 500,
        }}>
          {greeting}, {profileName || 'friend'}
        </div>
      </div>
      <div style={{
        fontSize: 10,
        color: TEXT_MUTED,
        fontWeight: 500,
        textAlign: 'right',
      }}>
        {date}
      </div>
    </div>
  );
}

// ─── READINESS STRIP: 48px colored full-width bar ─────────────────────────
function ReadinessStrip({
  readinessScore,
  readinessStatus,
  factorsSummary,
  nextRace,
}) {
  let statusColor = '#60a5fa';
  let bgTint = 'rgba(96,165,250,0.08)';
  let statusWord = 'On Track';

  if (readinessStatus === STATUS.READY) {
    statusColor = '#22c55e';
    bgTint = 'rgba(34,197,94,0.08)';
    statusWord = 'On Track';
  } else if (readinessStatus === STATUS.CAUTION) {
    statusColor = '#f59e0b';
    bgTint = 'rgba(245,158,11,0.08)';
    statusWord = 'Monitor';
  } else if (readinessStatus === STATUS.CRITICAL) {
    statusColor = '#ef4444';
    bgTint = 'rgba(239,68,68,0.08)';
    statusWord = 'Behind';
  }

  const raceDaysLeft = nextRace?.date ? Math.ceil((new Date(nextRace.date) - new Date()) / 86400000) : null;

  return (
    <div style={{
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      padding: '10px 12px',
      background: bgTint,
      border: `1px solid ${statusColor}26`,
      borderRadius: 14,
      marginBottom: 12,
    }}>
      {/* Readiness Ring: 40px */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <svg width={40} height={40} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={20} cy={20} r={16} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={1.2} />
          <circle
            cx={20}
            cy={20}
            r={16}
            fill="none"
            stroke={statusColor}
            strokeWidth={1.2}
            strokeDasharray={2 * Math.PI * 16}
            strokeDashoffset={2 * Math.PI * 16 * (1 - Math.min(Math.max(readinessScore / 100, 0), 1))}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
              filter: `drop-shadow(0 0 3px ${statusColor}50)`,
            }}
          />
        </svg>
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
        }}>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: TEXT_PRIMARY,
            lineHeight: 1,
          }}>
            {readinessScore}
          </div>
          <div style={{
            fontSize: 6,
            color: TEXT_DIM,
            fontWeight: 600,
            marginTop: 0,
          }}>
            RDY
          </div>
        </div>
      </div>

      {/* Middle: Status word + factor pills */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 700,
          color: statusColor,
          marginBottom: 3,
          lineHeight: 1,
        }}>
          {statusWord}
        </div>
        <div style={{
          fontSize: 8,
          color: TEXT_DIM,
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.2,
        }}>
          {factorsSummary || 'Loading...'}
        </div>
      </div>

      {/* Right: Race pill if applicable */}
      {raceDaysLeft !== null && raceDaysLeft <= 90 && raceDaysLeft > 0 && (
        <div style={{
          display: 'inline-block',
          background: 'rgba(249,115,22,0.1)',
          border: '1px solid rgba(249,115,22,0.3)',
          borderRadius: 12,
          padding: '4px 8px',
          fontSize: 9,
          fontWeight: 700,
          color: '#f97316',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          {raceDaysLeft}d
        </div>
      )}
    </div>
  );
}

// ─── CO-PILOT GAUGES: 2×2 grid, HERO section ─────────────────────────────
function CoPilotGauges({
  dialConfigs,
  onDialTap
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 8,
      marginBottom: 12,
    }}>
      {dialConfigs.map((dial, idx) => (
        <div
          key={idx}
          onClick={() => onDialTap?.(dial)}
          style={{
            padding: '12px',
            borderRadius: 14,
            cursor: 'pointer',
            transition: 'transform 0.15s, box-shadow 0.15s',
            background: `rgba(${hexToRgb(dial.color).join(',')}, 0.06)`,
            borderTop: `2px solid ${dial.color}`,
            border: `1px solid rgba(255,255,255,0.08)`,
            borderTop: `2px solid ${dial.color}`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)`,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 100,
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          {/* Label + Trend Arrow */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}>
            <div style={{
              fontSize: 8,
              fontWeight: 700,
              color: dial.color,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              lineHeight: 1,
              opacity: 0.8,
            }}>
              ↗ {dial.label}
            </div>
            {dial.trend && (
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: dial.trendColor,
              }}>
                {dial.trendIcon}
              </div>
            )}
          </div>

          {/* Value + Unit */}
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 4,
          }}>
            <div style={{
              fontSize: 22,
              fontWeight: 700,
              color: TEXT_PRIMARY,
              lineHeight: 1,
            }}>
              {dial.value}
            </div>
            <div style={{
              fontSize: 10,
              color: TEXT_DIM,
              fontWeight: 500,
            }}>
              {dial.unit}
            </div>
          </div>

          {/* Sparkline: 28px tall, prominent */}
          {dial.sparkData && dial.sparkData.length > 1 && (
            <div style={{
              marginTop: 'auto',
            }}>
              <Sparkline
                data={dial.sparkData}
                width="100%"
                height={28}
                color={dial.color}
                fill={true}
                dot={false}
              />
            </div>
          )}

          {/* Progress bar if goal exists */}
          {dial.goalPct !== undefined && (
            <div style={{
              width: '100%',
              height: 4,
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 2,
              overflow: 'hidden',
              marginTop: 'auto',
            }}>
              <div style={{
                width: `${Math.min(dial.goalPct * 100, 100)}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${dial.color}, ${dial.color}dd)`,
                transition: 'width 0.6s ease',
              }}/>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── DAILY INSIGHT: Compact contextual card ───────────────────────────────
function DailyInsightCard({ icon, headline, detail, color = '#60a5fa' }) {
  return (
    <div style={{
      padding: '12px 12px',
      marginBottom: 12,
      borderTop: `2px solid ${color}`,
      background: `linear-gradient(90deg, rgba(${hexToRgb(color).join(',')}, 0.06), transparent)`,
      border: `1px solid rgba(255,255,255,0.08)`,
      borderTop: `2px solid ${color}`,
      borderRadius: 14,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)`,
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <div style={{
        fontSize: 28,
        lineHeight: 1,
        flexShrink: 0,
        marginTop: 1,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 700,
          color: TEXT_PRIMARY,
          marginBottom: 2,
          lineHeight: 1.2,
        }}>
          {headline}
        </div>
        <div style={{
          fontSize: 11,
          color: TEXT_SECONDARY,
          lineHeight: 1.3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {detail}
        </div>
      </div>
    </div>
  );
}

// ─── SECTION HEADER: Colored underline dot ───────────────────────────────
function SectionHeader({ title, underlineColor = '#60a5fa' }) {
  return (
    <div style={{
      fontSize: 9,
      fontWeight: 700,
      color: TEXT_MUTED,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: 6,
      paddingBottom: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      lineHeight: 1,
    }}>
      {title}
      <div style={{
        width: 4,
        height: 4,
        borderRadius: '50%',
        background: underlineColor,
        opacity: 0.7,
      }}/>
    </div>
  );
}

// ─── THIS WEEK: Weekly narrative card ─────────────────────────────────────
function ThisWeekCard({
  headline,
  miles,
  sessions,
  activeMinutes,
  weeklyMiPct,
  weeklyTarget,
}) {
  const headlineColor = weeklyMiPct > 0.8 ? '#22c55e' : weeklyMiPct > 0.6 ? '#f59e0b' : TEXT_SECONDARY;

  return (
    <div style={{
      padding: '12px',
      marginBottom: 12,
      borderTop: `2px solid ${COLORS.training}`,
      background: `rgba(${hexToRgb(COLORS.training).join(',')}, 0.06)`,
      border: `1px solid rgba(255,255,255,0.08)`,
      borderTop: `2px solid ${COLORS.training}`,
      borderRadius: 14,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)`,
    }}>
      <div style={{
        fontSize: 13,
        fontWeight: 700,
        color: headlineColor,
        marginBottom: 10,
        lineHeight: 1.2,
      }}>
        {headline} — {sessions} runs, {miles} mi
      </div>

      {/* Three-column stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 8,
        marginBottom: 10,
      }}>
        <div>
          <div style={{
            fontSize: 8,
            color: TEXT_MUTED,
            fontWeight: 600,
            marginBottom: 2,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Miles
          </div>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: TEXT_PRIMARY,
            lineHeight: 1,
          }}>
            {miles}
          </div>
        </div>
        <div>
          <div style={{
            fontSize: 8,
            color: TEXT_MUTED,
            fontWeight: 600,
            marginBottom: 2,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Sessions
          </div>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: TEXT_PRIMARY,
            lineHeight: 1,
          }}>
            {sessions}
          </div>
        </div>
        <div>
          <div style={{
            fontSize: 8,
            color: TEXT_MUTED,
            fontWeight: 600,
            marginBottom: 2,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Time
          </div>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: TEXT_PRIMARY,
            lineHeight: 1,
          }}>
            {activeMinutes}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        width: '100%',
        height: 4,
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(weeklyMiPct * 100, 100)}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${COLORS.training}, ${COLORS.sleep})`,
          transition: 'width 0.6s ease',
        }}/>
      </div>
    </div>
  );
}

// ─── COMPACT TREND TILE: 140×85px ────────────────────────────────────────
function TrendTile({ label, value, unit, sparkData, color, delta }) {
  return (
    <div style={{
      padding: '10px 10px',
      borderRadius: 14,
      width: 140,
      height: 85,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      background: `rgba(${hexToRgb(color).join(',')}, 0.06)`,
      border: `1px solid rgba(255,255,255,0.08)`,
      borderTop: `2px solid ${color}`,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)`,
    }}>
      <div style={{
        fontSize: 8,
        fontWeight: 700,
        color: TEXT_MUTED,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 18,
        fontWeight: 700,
        color: TEXT_PRIMARY,
        lineHeight: 1,
      }}>
        {value}
        <span style={{
          fontSize: 8,
          color: TEXT_DIM,
          fontWeight: 500,
          marginLeft: 3,
        }}>
          {unit}
        </span>
      </div>
      {delta !== undefined && (
        <div style={{
          fontSize: 8,
          fontWeight: 600,
          color: delta >= 0 ? '#22c55e' : '#ef4444',
        }}>
          {delta >= 0 ? '+' : ''}{delta}
        </div>
      )}
      {sparkData && sparkData.length > 1 && (
        <div style={{ marginTop: 'auto' }}>
          <Sparkline
            data={sparkData}
            width={120}
            height={24}
            color={color}
            fill={true}
            dot={false}
          />
        </div>
      )}
    </div>
  );
}

// ─── TODAY'S PLAN: Compact action card ──────────────────────────────────────
function TodaysPlanCard({ plan, completed, onTap }) {
  const dayTypeInfo = plan?.type ? DAY_TYPES[plan.type] : null;
  const bgColor = dayTypeInfo ? dayTypeInfo.color : COLORS.training;

  return (
    <div
      onClick={onTap}
      style={{
        padding: '12px',
        marginBottom: 12,
        background: `rgba(${hexToRgb(bgColor).join(',')}, 0.06)`,
        border: `1px solid rgba(255,255,255,0.08)`,
        borderTop: `2px solid ${bgColor}`,
        borderRadius: 14,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)`,
        cursor: 'pointer',
        transition: 'transform 0.15s, box-shadow 0.15s',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.98)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      <div style={{
        fontSize: 20,
        flexShrink: 0,
      }}>
        {plan?.icon || '⚡'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: TEXT_PRIMARY,
          lineHeight: 1.2,
        }}>
          {plan?.label || 'Plan for Today'}
        </div>
        <div style={{
          fontSize: 10,
          color: TEXT_SECONDARY,
          marginTop: 2,
        }}>
          {plan?.description || 'No plan'}
        </div>
      </div>
      <div style={{
        fontSize: 16,
        opacity: completed ? 1 : 0.5,
        flexShrink: 0,
        color: completed ? '#22c55e' : TEXT_DIM,
      }}>
        {completed ? '✓' : '◯'}
      </div>
    </div>
  );
}

// ─── YEAR TO DATE: Annual progress card ────────────────────────────────────
function YearToDateCard({
  totalMi,
  annualTarget,
  totalSessions,
  avgPace,
  ytdPct,
}) {
  return (
    <div style={{
      padding: '12px',
      marginBottom: 12,
      borderTop: `2px solid ${COLORS.pace}`,
      background: `rgba(${hexToRgb(COLORS.pace).join(',')}, 0.06)`,
      border: `1px solid rgba(255,255,255,0.08)`,
      borderTop: `2px solid ${COLORS.pace}`,
      borderRadius: 14,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)`,
    }}>
      {/* Progress bar at top */}
      <div style={{
        width: '100%',
        height: 6,
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 10,
      }}>
        <div style={{
          width: `${Math.min(ytdPct * 100, 100)}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${COLORS.pace}, ${COLORS.training})`,
          transition: 'width 0.6s ease',
        }}/>
      </div>

      {/* Big number + target */}
      <div style={{
        fontSize: 28,
        fontWeight: 700,
        color: TEXT_PRIMARY,
        lineHeight: 1,
        marginBottom: 8,
      }}>
        {totalMi}
        <span style={{
          fontSize: 11,
          color: TEXT_DIM,
          fontWeight: 500,
          marginLeft: 6,
        }}>
          / {annualTarget} mi
        </span>
      </div>

      {/* Two-column stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
      }}>
        <div>
          <div style={{
            fontSize: 8,
            color: TEXT_MUTED,
            fontWeight: 600,
            marginBottom: 2,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Sessions
          </div>
          <div style={{
            fontSize: 14,
            fontWeight: 700,
            color: TEXT_PRIMARY,
            lineHeight: 1,
          }}>
            {totalSessions}
          </div>
        </div>
        <div>
          <div style={{
            fontSize: 8,
            color: TEXT_MUTED,
            fontWeight: 600,
            marginBottom: 2,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Avg Pace
          </div>
          <div style={{
            fontSize: 14,
            fontWeight: 700,
            color: TEXT_PRIMARY,
            lineHeight: 1,
          }}>
            {avgPace}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MORE MENU: Bottom sheet overlay ────────────────────────────────────────
function MoreMenu({ onClose, onMenuTap }) {
  const MORE_ITEMS = [
    { id: 'goals', label: 'Goals', icon: '🎯' },
    { id: 'races', label: 'Races', icon: '🏁' },
    { id: 'stack', label: 'Stack', icon: '💊' },
    { id: 'sync', label: 'Sync', icon: '🔄' },
    { id: 'profile', label: 'Profile', icon: '👤' },
  ];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      zIndex: 40,
      display: 'flex',
      alignItems: 'flex-end',
    }}
    onClick={onClose}
    >
      <div style={{
        borderRadius: '20px 20px 0 0',
        width: '100%',
        padding: '20px 16px 32px',
        background: 'rgba(20, 22, 30, 0.95)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
      onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          width: 40,
          height: 4,
          background: 'rgba(255,255,255,0.2)',
          borderRadius: 2,
          margin: '0 auto 20px',
        }}/>

        {MORE_ITEMS.map((item) => (
          <div
            key={item.id}
            onClick={() => {
              onMenuTap(item.id);
              onClose();
            }}
            style={{
              padding: '12px 16px',
              marginBottom: 8,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              transition: 'background 0.2s, border 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
            }}
          >
            <div style={{ fontSize: 18 }}>{item.icon}</div>
            <div style={{
              fontSize: 13,
              fontWeight: 600,
              color: TEXT_PRIMARY,
              flex: 1,
            }}>
              {item.label}
            </div>
            <div style={{
              fontSize: 16,
              color: TEXT_DIM,
            }}>
              →
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── BOTTOM NAV BAR: DOCKED FIXED NAVIGATION ─────────────────────────────────
function BottomNavBar({ activeNav, onNavTap }) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 200,
      background: 'rgba(10, 11, 16, 0.95)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      padding: '5px 0 env(safe-area-inset-bottom, 6px)',
      height: 52,
    }}>
      {NAV_ITEMS.map((item) => {
        const isActive = activeNav === item.id;
        return (
          <div
            key={item.id}
            onClick={() => onNavTap(item.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              cursor: 'pointer',
              position: 'relative',
              padding: '4px 0',
              minWidth: 44,
              transition: 'color 0.2s',
            }}
          >
            <div style={{
              position: 'relative',
            }}>
              <div style={{
                fontSize: 15,
                color: isActive ? COLORS.training : TEXT_MUTED,
                transition: 'color 0.2s',
              }}>
                {item.icon}
              </div>
              {isActive && (
                <div style={{
                  position: 'absolute',
                  width: 3,
                  height: 3,
                  background: COLORS.training,
                  borderRadius: '50%',
                  bottom: -5,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  boxShadow: `0 0 6px ${COLORS.training}`,
                }}/>
              )}
            </div>
            <div style={{
              fontSize: 7,
              fontWeight: 600,
              color: isActive ? TEXT_PRIMARY : TEXT_MUTED,
              textTransform: 'uppercase',
              letterSpacing: '0.02em',
              transition: 'color 0.2s',
            }}>
              {item.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Utility: Convert hex to RGB ─────────────────────────────────────────────
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ] : [96, 165, 250]; // fallback to blue
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────
export function MobileHome({
  data, focusItems, weeklyStats, avgWeeklyMi, avgWeeklyHrsTotal,
  avgPaceSecs, goalPaceSecs, fmtPace, totalMi, annualRunTarget, totalSessions,
  sortedSleep, hrvData, sortedW, currentWeight, currentBF, latestSleepScore,
  avgHRV30, recentNut, avgProtein, latestRHR, nextRace, onOpenTab, initialView
}) {
  const [activeNav, setActiveNav] = useState(initialView || 'start');
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (initialView && initialView !== activeNav) setActiveNav(initialView);
  }, [initialView]);

  const G = getGoals();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const profileName = (() => {
    try { return (storage.get('profile') || {}).name || 'user'; } catch { return 'user'; }
  })();

  // ── Readiness computation ──
  const readinessScore = (() => {
    try {
      const r = computeReadiness();
      return Math.round(r.score) || 75;
    } catch {
      return 75;
    }
  })();

  const readinessStatus = statusFromPct(readinessScore / 100);

  // ── Trend helper ──
  const getTrendArrow = (current, history) => {
    if (!history || history.length < 2) return { icon: '→', color: TEXT_DIM };
    const past = history[history.length - 1];
    if (!past || current == null) return { icon: '→', color: TEXT_DIM };
    const change = (current - past) / Math.abs(past);
    if (change > 0.02) return { icon: '↑', color: '#22c55e' };
    if (change < -0.02) return { icon: '↓', color: '#ef4444' };
    return { icon: '→', color: TEXT_DIM };
  };

  // ── Generate readiness factor summary ──
  const generateFactorsSummary = () => {
    const factors = [];

    const volumePct = avgWeeklyMi / (G.weeklyRunDistanceTarget || 50);
    if (volumePct > 0.9) factors.push('Volume ✓');
    else if (volumePct > 0.7) factors.push('Volume ◐');
    else factors.push('Volume ✗');

    if (avgPaceSecs <= goalPaceSecs * 1.1) factors.push('Pace ✓');
    else if (avgPaceSecs <= goalPaceSecs * 1.2) factors.push('Pace ◐');
    else factors.push('Pace ✗');

    if (latestSleepScore >= 85) factors.push('Sleep ✓');
    else if (latestSleepScore >= 70) factors.push('Sleep ◐');
    else factors.push('Sleep ✗');

    return factors.join(' ');
  };

  // ── Generate daily insight ──
  const generateDailyInsight = () => {
    const plan = todayPlanned();
    const completed = checkTodayCompletion();

    if (hour < 12) {
      if (latestSleepScore >= 85) {
        return {
          icon: '💪',
          headline: 'Great sleep',
          detail: 'Recovery strong. Good to push today.',
          color: COLORS.sleep,
        };
      } else if (latestSleepScore >= 70) {
        return {
          icon: '😴',
          headline: 'Solid sleep',
          detail: `${latestSleepScore}/100. Pace yourself today.`,
          color: COLORS.sleep,
        };
      } else {
        return {
          icon: '⚠️',
          headline: 'Light sleep',
          detail: 'Consider easier effort today.',
          color: '#ef4444',
        };
      }
    } else if (completed) {
      return {
        icon: '🏃',
        headline: 'Activity logged',
        detail: 'Focus on recovery nutrition.',
        color: COLORS.training,
      };
    } else if (plan?.type === 'rest') {
      return {
        icon: '🧘',
        headline: 'Rest day',
        detail: 'Recovery focus. Hydrate and stretch.',
        color: TEXT_SECONDARY,
      };
    } else {
      return {
        icon: '👋',
        headline: `Good ${hour < 17 ? 'afternoon' : 'evening'}`,
        detail: plan?.label ? `${plan.label} planned.` : 'No plan today.',
        color: TEXT_SECONDARY,
      };
    }
  };

  // ── Build dial configs ──
  const dialConfigs = (() => {
    const stored = storage.get('hero-dials') || [];
    const defaults = [
      { label: 'Miles/Week', key: 'miles' },
      { label: 'Sleep Score', key: 'sleep' },
      { label: 'Protein', key: 'protein' },
      { label: 'Weight', key: 'weight' },
    ];
    const configs = stored.length > 0 ? stored : defaults;

    const mappedConfigs = configs.map(cfg => {
      let value, unit, sparkData, color, goalPct;

      if (cfg.label === 'Miles/Week' || cfg.key === 'miles') {
        value = avgWeeklyMi?.toFixed(1) || '0.0';
        unit = 'mi';
        sparkData = weeklyStats?.map(w => w.miles) || [];
        color = COLORS.training;
        goalPct = avgWeeklyMi / (G.weeklyRunDistanceTarget || 50);
      } else if (cfg.label === 'Sleep Score' || cfg.key === 'sleep') {
        value = latestSleepScore || '—';
        unit = 'pts';
        sparkData = sortedSleep?.slice(-8) || [];
        color = COLORS.sleep;
        goalPct = (latestSleepScore || 0) / 100;
      } else if (cfg.label === 'Protein' || cfg.key === 'protein') {
        value = avgProtein?.toFixed(0) || '0';
        unit = 'g';
        sparkData = recentNut?.map(n => n.protein) || [];
        color = COLORS.nutrition;
        goalPct = (avgProtein || 0) / 160; // typical daily goal
      } else if (cfg.label === 'Weight' || cfg.key === 'weight') {
        value = currentWeight?.toFixed(1) || '—';
        unit = 'lb';
        sparkData = sortedW?.slice(-8) || [];
        color = COLORS.weight;
      } else {
        value = '—';
        unit = '';
        sparkData = [];
        color = COLORS.training;
      }

      const trend = getTrendArrow(
        (cfg.label === 'Miles/Week' || cfg.key === 'miles') ? avgWeeklyMi :
        (cfg.label === 'Sleep Score' || cfg.key === 'sleep') ? latestSleepScore :
        (cfg.label === 'Protein' || cfg.key === 'protein') ? avgProtein :
        (cfg.label === 'Weight' || cfg.key === 'weight') ? currentWeight :
        0,
        sparkData
      );

      return {
        label: cfg.label || cfg.key,
        value,
        unit,
        sparkData,
        color,
        goalPct,
        trend: true,
        trendIcon: trend.icon,
        trendColor: trend.color,
      };
    });

    return mappedConfigs.slice(0, 4);
  })();

  // ── Weekly stats ──
  const weeklyMiPct = avgWeeklyMi / (G.weeklyRunDistanceTarget || 50);
  const weeklyHeadline = weeklyMiPct > 0.8 ? 'Strong week' : weeklyMiPct > 0.6 ? 'Building momentum' : 'Light week';

  // ── YTD stats ──
  const ytdPct = totalMi / (annualRunTarget || 1000);

  const dailyInsight = generateDailyInsight();
  const factorsSummary = generateFactorsSummary();

  const plan = todayPlanned();
  const planCompleted = checkTodayCompletion();

  // ── Swipe handlers ──
  const swipeHandlers = useSwipeNav({
    onSwipeLeft: () => {
      const idx = SWIPE_ORDER.indexOf(activeNav);
      if (idx < SWIPE_ORDER.length - 1) {
        setActiveNav(SWIPE_ORDER[idx + 1]);
      }
    },
    onSwipeRight: () => {
      const idx = SWIPE_ORDER.indexOf(activeNav);
      if (idx > 0) {
        setActiveNav(SWIPE_ORDER[idx - 1]);
      }
    },
  });

  const handleNavTap = (id) => {
    if (id === 'more') {
      setMoreOpen(true);
    } else {
      setActiveNav(id);
      const navItem = NAV_ITEMS.find(n => n.id === id);
      if (navItem?.tab) {
        onOpenTab?.(navItem.tab);
      }
    }
  };

  const handleMoreMenuTap = (id) => {
    if (id === 'goals') onOpenTab?.('goals');
    else if (id === 'races') onOpenTab?.('races');
    else if (id === 'stack') onOpenTab?.('stack');
    else if (id === 'sync') onOpenTab?.('sync');
    else if (id === 'profile') onOpenTab?.('profile');
  };

  if (activeNav !== 'start') {
    return <BottomNavBar activeNav={activeNav} onNavTap={handleNavTap} />;
  }

  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${BG_DARK}, ${BG_DARKER})`,
        color: TEXT_PRIMARY,
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        paddingTop: 0,
        paddingBottom: 72,
      }}
      {...swipeHandlers}
    >
      {/* Compact Header */}
      <div style={{ padding: '12px 12px 0' }}>
        <CompactHeader greeting={greeting} profileName={profileName} />
      </div>

      {/* Readiness Strip */}
      <div style={{ padding: '0 12px' }}>
        <ReadinessStrip
          readinessScore={readinessScore}
          readinessStatus={readinessStatus}
          factorsSummary={factorsSummary}
          nextRace={nextRace}
        />
      </div>

      {/* Co-Pilot Gauges (HERO) */}
      <div style={{ padding: '0 12px' }}>
        <CoPilotGauges
          dialConfigs={dialConfigs}
          onDialTap={(dial) => {
            if (dial.label.includes('Mile')) onOpenTab?.('activity');
            else if (dial.label.includes('Sleep')) onOpenTab?.('clinical');
            else if (dial.label.includes('Protein')) onOpenTab?.('nutrition_mobile');
            else if (dial.label.includes('Weight')) onOpenTab?.('clinical');
          }}
        />
      </div>

      {/* Daily Insight */}
      <div style={{ padding: '0 12px' }}>
        <DailyInsightCard
          icon={dailyInsight.icon}
          headline={dailyInsight.headline}
          detail={dailyInsight.detail}
          color={dailyInsight.color}
        />
      </div>

      {/* This Week */}
      <div style={{ padding: '0 12px' }}>
        <SectionHeader title="This Week" underlineColor={COLORS.training} />
        <ThisWeekCard
          headline={weeklyHeadline}
          miles={avgWeeklyMi?.toFixed(1) || '0'}
          sessions={data?.length || 0}
          activeMinutes={Math.round((avgWeeklyHrsTotal || 0) * 60)}
          weeklyMiPct={weeklyMiPct}
          weeklyTarget={G.weeklyRunDistanceTarget || 50}
        />
      </div>

      {/* 30-Day Trends */}
      <div style={{ padding: '0 12px' }}>
        <SectionHeader title="30-Day Trends" underlineColor={COLORS.sleep} />
        <div style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 4,
          scrollBehavior: 'smooth',
          scrollbarWidth: 'none',
          marginBottom: 12,
        }}>
          <TrendTile
            label="Monthly Miles"
            value={avgWeeklyMi?.toFixed(1) || '0'}
            unit="mi"
            sparkData={weeklyStats?.slice(-4)?.map(w => w.miles) || []}
            color={COLORS.training}
          />
          <TrendTile
            label="Avg Weight"
            value={currentWeight?.toFixed(1) || '—'}
            unit="lb"
            sparkData={sortedW?.slice(-8) || []}
            color={COLORS.weight}
          />
          <TrendTile
            label="Avg Sleep"
            value={latestSleepScore || '—'}
            unit="pts"
            sparkData={sortedSleep?.slice(-8) || []}
            color={COLORS.sleep}
          />
          <TrendTile
            label="Avg Protein"
            value={avgProtein?.toFixed(0) || '0'}
            unit="g"
            sparkData={recentNut?.slice(-8)?.map(n => n.protein) || []}
            color={COLORS.nutrition}
          />
        </div>
      </div>

      {/* Year to Date */}
      <div style={{ padding: '0 12px' }}>
        <SectionHeader title="Year to Date" underlineColor={COLORS.pace} />
        <YearToDateCard
          totalMi={totalMi?.toFixed(0) || '0'}
          annualTarget={annualRunTarget || 1000}
          totalSessions={totalSessions || 0}
          avgPace={fmtPace || '—'}
          ytdPct={ytdPct}
        />
      </div>

      {/* Today's Plan */}
      <div style={{ padding: '0 12px' }}>
        <SectionHeader title="Today's Plan" underlineColor={COLORS.training} />
        <TodaysPlanCard
          plan={plan}
          completed={planCompleted}
          onTap={() => onOpenTab?.('plan')}
        />
      </div>

      {/* Bottom Nav */}
      <BottomNavBar activeNav={activeNav} onNavTap={handleNavTap} />

      {/* More Menu Modal */}
      {moreOpen && (
        <MoreMenu
          onClose={() => setMoreOpen(false)}
          onMenuTap={handleMoreMenuTap}
        />
      )}
    </div>
  );
}
